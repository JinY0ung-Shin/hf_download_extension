#!/usr/bin/env python3
import os
import shutil
import subprocess
import asyncio
import json
import time
from pathlib import Path
from typing import Optional, List
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
from dotenv import load_dotenv
from huggingface_hub import HfApi
from huggingface_hub.utils import HfHubHTTPError

load_dotenv()

app = FastAPI(title="HuggingFace Download Proxy Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class DownloadRequest(BaseModel):
    author: str
    repo_name: str
    url: str = None

class DownloadResponse(BaseModel):
    status: str
    message: str
    local_path: str = None
    supercomputer_path: str = None

class DownloadProxyServer:
    def __init__(self):
        self.local_download_path = Path(os.getenv("LOCAL_DOWNLOAD_PATH", "/tmp/huggingface_downloads"))
        self.supercomputer_host = os.getenv("SUPERCOMPUTER_HOST")
        self.supercomputer_user = os.getenv("SUPERCOMPUTER_USER")
        self.supercomputer_path = os.getenv("SUPERCOMPUTER_PATH")
        self.hf_token = os.getenv("HUGGINGFACE_TOKEN")
        self.hf_api = HfApi(token=self.hf_token) if self.hf_token else HfApi()

        # Create local download directory if it doesn't exist
        self.local_download_path.mkdir(parents=True, exist_ok=True)

        # Progress tracking
        self.progress_file = self.local_download_path / "download_progress.json"
        self.download_progress = self.load_progress_from_file()

    def load_progress_from_file(self):
        """Load progress from file"""
        try:
            if self.progress_file.exists():
                with open(self.progress_file, 'r') as f:
                    data = json.load(f)
                    # Clean up old entries (older than 24 hours)
                    current_time = time.time()
                    cleaned_data = {}
                    for key, progress in data.items():
                        if current_time - progress.get('timestamp', 0) < 86400:  # 24 hours
                            cleaned_data[key] = progress
                    return cleaned_data
        except Exception as e:
            print(f"Failed to load progress file: {e}")
        return {}

    def save_progress_to_file(self):
        """Save progress to file"""
        try:
            with open(self.progress_file, 'w') as f:
                json.dump(self.download_progress, f, indent=2)
        except Exception as e:
            print(f"Failed to save progress file: {e}")

    def update_progress(
        self,
        key: str,
        status: str,
        message: str,
        progress: Optional[int] = None,
        *,
        downloaded_bytes: Optional[int] = None,
        total_bytes: Optional[int] = None
    ):
        """Update download progress"""

        current_entry = self.download_progress.get(key, {})

        if progress is None:
            progress = current_entry.get("progress", 0)

        updated_entry = {
            **current_entry,
            "status": status,
            "message": message,
            "progress": progress,
            "timestamp": time.time(),
        }

        if downloaded_bytes is not None:
            updated_entry["downloaded_bytes"] = downloaded_bytes
        if total_bytes is not None:
            updated_entry["total_bytes"] = total_bytes

        self.download_progress[key] = updated_entry
        print(f"Progress update [{key}]: {status} - {message} ({progress}%)")

        # Save to file
        self.save_progress_to_file()

    def cleanup_completed_progress(self, key: str):
        """Remove completed downloads from progress tracking after delay"""
        async def delayed_cleanup():
            await asyncio.sleep(300)  # Wait 5 minutes
            if key in self.download_progress:
                status = self.download_progress[key].get('status')
                if status in ['transfer_complete', 'exists', 'error']:
                    del self.download_progress[key]
                    self.save_progress_to_file()
                    print(f"Cleaned up completed progress for: {key}")

        # Run cleanup in background
        asyncio.create_task(delayed_cleanup())

    async def get_repo_total_size(self, author: str, repo_name: str) -> Optional[int]:
        """Fetch total repository size from HuggingFace Hub metadata."""
        repo_id = f"{author}/{repo_name}"

        def _fetch_size():
            try:
                info = self.hf_api.model_info(repo_id, files_metadata=True)
                total = 0
                if hasattr(info, "siblings"):
                    for sibling in info.siblings:
                        if sibling.size is not None:
                            total += sibling.size
                return total or None
            except HfHubHTTPError as err:
                if getattr(err, "response", None) is not None and err.response.status_code == 404:
                    return None
                print(f"HuggingFace API error when fetching {repo_id}: {err}")
                return None
            except Exception as err:
                print(f"Failed to fetch repo size for {repo_id}: {err}")
                return None

        return await asyncio.to_thread(_fetch_size)

    def get_directory_size(self, path: Path) -> int:
        """Calculate total size of files within the given directory."""
        if not path.exists():
            return 0

        total = 0
        for root, _, files in os.walk(path):
            for file_name in files:
                file_path = Path(root) / file_name
                try:
                    total += file_path.stat().st_size
                except OSError:
                    continue
        return total

    def format_bytes(self, size: int) -> str:
        """Human readable byte formatter."""
        if size is None:
            return "0 B"
        step_unit = 1024
        units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"]
        idx = 0
        value = float(size)
        while value >= step_unit and idx < len(units) - 1:
            value /= step_unit
            idx += 1
        return f"{value:.2f} {units[idx]}"

    async def monitor_download_progress(
        self,
        repo_path: Path,
        progress_key: str,
        expected_total: Optional[int],
        stop_event: asyncio.Event,
        interval_seconds: float = 2.0
    ):
        """Monitor local repo size and update progress based on actual bytes."""

        last_reported_size = -1

        while True:
            size_bytes = await asyncio.to_thread(self.get_directory_size, repo_path)

            if size_bytes != last_reported_size:
                message: str
                progress_value: Optional[int] = None
                effective_size = size_bytes

                if expected_total and expected_total > 0:
                    clamped = min(size_bytes, expected_total)
                    ratio = clamped / expected_total
                    progress_value = min(99, int(ratio * 100))
                    message = (
                        f"Downloading files... {self.format_bytes(clamped)} / "
                        f"{self.format_bytes(expected_total)}"
                    )
                    effective_size = clamped
                else:
                    message = f"Downloading files... {self.format_bytes(size_bytes)}"

                if progress_value is None:
                    current = self.download_progress.get(progress_key, {})
                    current_progress = current.get("progress", 0)
                    if size_bytes > 0:
                        progress_value = min(99, max(current_progress, 1))
                    else:
                        progress_value = current_progress

                self.update_progress(
                    progress_key,
                    "cloning",
                    message,
                    progress_value,
                    downloaded_bytes=effective_size
                )
                last_reported_size = size_bytes

            try:
                await asyncio.wait_for(stop_event.wait(), timeout=interval_seconds)
                break
            except asyncio.TimeoutError:
                continue

        # Final size update after clone completes
        final_size = await asyncio.to_thread(self.get_directory_size, repo_path)
        if final_size != last_reported_size:
            message: str
            progress_value: Optional[int] = None
            effective_final = final_size

            if expected_total and expected_total > 0:
                clamped = min(final_size, expected_total)
                ratio = clamped / expected_total
                progress_value = min(99, int(ratio * 100))
                message = (
                    f"Downloading files... {self.format_bytes(clamped)} / "
                    f"{self.format_bytes(expected_total)}"
                )
                effective_final = clamped
            else:
                message = f"Downloading files... {self.format_bytes(final_size)}"

            if progress_value is None:
                current = self.download_progress.get(progress_key, {})
                current_progress = current.get("progress", 0)
                if final_size > 0:
                    progress_value = min(99, max(current_progress, 1))
                else:
                    progress_value = current_progress

            self.update_progress(
                progress_key,
                "cloning",
                message,
                progress_value,
                downloaded_bytes=effective_final
            )

    def check_if_exists_on_supercomputer(self, author: str, repo_name: str) -> bool:
        """Check if model already exists on supercomputer"""
        remote_path = f"{self.supercomputer_path}/{author}/{repo_name}"

        try:
            cmd = [
                "ssh",
                f"{self.supercomputer_user}@{self.supercomputer_host}",
                f"test -d {remote_path}"
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)
            return result.returncode == 0
        except Exception as e:
            print(f"Error checking remote directory: {e}")
            return False

    async def git_clone_repo(self, author: str, repo_name: str) -> str:
        """Clone HuggingFace repository"""
        repo_url = f"https://huggingface.co/{author}/{repo_name}"
        local_repo_path = self.local_download_path / f"{author}_{repo_name}"
        progress_key = f"{author}/{repo_name}"

        print(f"Starting git clone for {author}/{repo_name}")
        print(f"Repository URL: {repo_url}")
        print(f"Local path: {local_repo_path}")

        expected_total_size = await self.get_repo_total_size(author, repo_name)
        if expected_total_size:
            print(f"Estimated repository size: {expected_total_size} bytes")
        else:
            print("Repository size metadata unavailable; tracking progress using downloaded bytes only.")

        self.update_progress(
            progress_key,
            "cloning",
            "Starting git clone...",
            0,
            total_bytes=expected_total_size,
            downloaded_bytes=0
        )

        # Remove existing directory if it exists
        if local_repo_path.exists():
            print(f"Removing existing directory: {local_repo_path}")
            shutil.rmtree(local_repo_path)

        try:
            stop_event = asyncio.Event()
            monitor_task = asyncio.create_task(
                self.monitor_download_progress(local_repo_path, progress_key, expected_total_size, stop_event)
            )

            process = None
            stderr_task = None
            stdout_task = None
            success = False

            try:
                cmd = ["git", "clone", "--progress", repo_url, str(local_repo_path)]
                print(f"Executing command: {' '.join(cmd)}")

                process = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )

                async def relay_stream(stream, label: str):
                    if not stream:
                        return
                    async for line in stream:
                        text = line.decode().strip()
                        if text:
                            print(f"Git clone {label}: {text}")

                stderr_task = asyncio.create_task(relay_stream(process.stderr, "stderr"))
                stdout_task = asyncio.create_task(relay_stream(process.stdout, "stdout"))

                await process.wait()
                success = process.returncode == 0

            finally:
                stop_event.set()

                for task in (stderr_task, stdout_task):
                    if task:
                        task.cancel()
                await asyncio.gather(
                    *(task for task in (stderr_task, stdout_task) if task),
                    return_exceptions=True
                )

                try:
                    await monitor_task
                except asyncio.CancelledError:
                    pass

            if not success:
                raise Exception("Git clone failed")

            final_size = await asyncio.to_thread(self.get_directory_size, local_repo_path)
            current_entry = self.download_progress.get(progress_key, {})
            total_bytes = current_entry.get("total_bytes")

            effective_final = final_size
            if total_bytes and total_bytes > 0:
                clamped = min(final_size, total_bytes)
                final_message = (
                    f"Clone complete: {self.format_bytes(clamped)} / {self.format_bytes(total_bytes)}"
                )
                effective_final = clamped
            else:
                final_message = f"Clone complete: {self.format_bytes(final_size)}"

            print(f"Git clone completed successfully: {local_repo_path}")
            self.update_progress(
                progress_key,
                "clone_complete",
                final_message,
                100,
                downloaded_bytes=effective_final
            )
            return str(local_repo_path)
        except Exception as e:
            print(f"Git clone error: {e}")
            self.update_progress(progress_key, "error", f"Git clone failed: {str(e)}", 0)
            raise Exception(f"Failed to clone repository: {e}")

    async def create_remote_directory(self, author: str, repo_name: str):
        """Create directory structure on supercomputer"""
        remote_path = f"{self.supercomputer_path}/{author}"

        try:
            cmd = [
                "ssh",
                f"{self.supercomputer_user}@{self.supercomputer_host}",
                f"mkdir -p {remote_path}"
            ]
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            await process.communicate()

            if process.returncode != 0:
                raise Exception("Failed to create remote directory")
        except Exception as e:
            raise Exception(f"Failed to create remote directory: {e}")

    async def scp_transfer(self, local_path: str, author: str, repo_name: str):
        """Transfer files to supercomputer using scp"""
        remote_path = f"{self.supercomputer_user}@{self.supercomputer_host}:{self.supercomputer_path}/{author}/"
        progress_key = f"{author}/{repo_name}"

        try:
            # Create remote directory first
            await self.create_remote_directory(author, repo_name)

            self.update_progress(progress_key, "transferring", "Starting SCP transfer to supercomputer...", 0)

            removed_git = self.remove_git_directory(local_path)
            if removed_git:
                self.update_progress(progress_key, "transferring", "Removed .git directory before transfer")

            cmd = [
                "scp", "-r",
                local_path,
                f"{remote_path}{repo_name}"
            ]
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )

            captured_logs: List[str] = []

            async def relay_stream(stream: asyncio.StreamReader, label: str):
                buffer = ""
                while True:
                    chunk = await stream.read(1024)
                    if not chunk:
                        break
                    decoded = chunk.decode(errors="ignore")
                    buffer += decoded

                    # Split on both newlines and carriage returns to handle scp progress output
                    while True:
                        split_index = min(
                            (idx for idx in (
                                buffer.find("\n"),
                                buffer.find("\r")
                            ) if idx != -1),
                            default=-1
                        )

                        if split_index == -1:
                            break

                        line = buffer[:split_index]
                        buffer = buffer[split_index + 1:]

                        clean_line = line.strip()
                        if clean_line:
                            print(f"SCP {label}: {clean_line}")
                            captured_logs.append(clean_line)
                            self.update_progress(progress_key, "transferring", clean_line)

                if buffer.strip():
                    clean_line = buffer.strip()
                    print(f"SCP {label}: {clean_line}")
                    captured_logs.append(clean_line)
                    self.update_progress(progress_key, "transferring", clean_line)

            stdout_task = asyncio.create_task(relay_stream(process.stdout, "stdout"))
            stderr_task = asyncio.create_task(relay_stream(process.stderr, "stderr"))

            await asyncio.gather(stdout_task, stderr_task)
            return_code = await process.wait()

            if return_code != 0:
                self.update_progress(progress_key, "error", "SCP transfer failed", 0)
                combined_logs = "\n".join(captured_logs)
                raise Exception(f"SCP transfer failed with exit code {return_code}: {combined_logs}")

            self.update_progress(progress_key, "transfer_complete", "SCP transfer completed", 100)
            self.cleanup_completed_progress(progress_key)
        except Exception as e:
            self.update_progress(progress_key, "error", f"SCP transfer failed: {str(e)}", 0)
            self.cleanup_completed_progress(progress_key)
            raise Exception(f"Failed to transfer files: {e}")

    def cleanup_local_files(self, local_path: str):
        """Remove local files after successful transfer"""
        try:
            if os.path.exists(local_path):
                shutil.rmtree(local_path)
        except Exception as e:
            print(f"Warning: Failed to cleanup local files: {e}")

    def remove_git_directory(self, repo_path: str):
        """Delete the .git directory before transfer to reduce payload size."""
        try:
            git_dir = Path(repo_path) / ".git"
            # Only delete if the path lives under our managed download root
            if git_dir.exists() and git_dir.is_dir():
                git_dir_relative = git_dir.resolve().relative_to(self.local_download_path.resolve())
                print(f"Removing git metadata: {git_dir}")
                shutil.rmtree(git_dir)
                return str(git_dir_relative)
        except ValueError:
            # Path is outside our managed download directory; skip removal for safety
            print(f"Skipping .git removal for unmanaged path: {repo_path}")
        except Exception as e:
            print(f"Warning: Failed to remove .git directory: {e}")
        return None

proxy_server = DownloadProxyServer()

@app.post("/download", response_model=DownloadResponse)
async def download_model(request: DownloadRequest):
    """Download HuggingFace model and transfer to supercomputer"""

    print(f"\n=== DOWNLOAD REQUEST RECEIVED ===")
    print(f"Author: {request.author}")
    print(f"Repository: {request.repo_name}")
    print(f"URL: {request.url}")
    print(f"=====================================\n")

    # Check if model already exists on supercomputer
    print(f"Checking if model exists on supercomputer...")
    if proxy_server.check_if_exists_on_supercomputer(request.author, request.repo_name):
        print(f"Model already exists on supercomputer")
        return DownloadResponse(
            status="exists",
            message=f"Model {request.author}/{request.repo_name} already exists on supercomputer",
            supercomputer_path=f"{proxy_server.supercomputer_path}/{request.author}/{request.repo_name}"
        )

    try:
        # Step 1: Clone repository
        local_path = await proxy_server.git_clone_repo(request.author, request.repo_name)

        # Step 2: Transfer to supercomputer
        await proxy_server.scp_transfer(local_path, request.author, request.repo_name)

        # Step 3: Cleanup local files
        proxy_server.cleanup_local_files(local_path)

        return DownloadResponse(
            status="success",
            message=f"Successfully downloaded and transferred {request.author}/{request.repo_name}",
            local_path=local_path,
            supercomputer_path=f"{proxy_server.supercomputer_path}/{request.author}/{request.repo_name}"
        )

    except Exception as e:
        # Cleanup on error
        if 'local_path' in locals():
            proxy_server.cleanup_local_files(local_path)

        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "message": "Download proxy server is running"}

@app.get("/status/{author}/{repo_name}")
async def check_status(author: str, repo_name: str):
    """Check if model exists on supercomputer"""
    exists = proxy_server.check_if_exists_on_supercomputer(author, repo_name)
    return {
        "author": author,
        "repo_name": repo_name,
        "exists_on_supercomputer": exists,
        "path": f"{proxy_server.supercomputer_path}/{author}/{repo_name}" if exists else None
    }

@app.get("/progress/{author}/{repo_name}")
async def get_progress(author: str, repo_name: str):
    """Get download progress for a specific repository"""
    progress_key = f"{author}/{repo_name}"
    progress = proxy_server.download_progress.get(progress_key)

    if not progress:
        return {
            "author": author,
            "repo_name": repo_name,
            "status": "not_found",
            "message": "No download in progress",
            "progress": 0
        }

    return {
        "author": author,
        "repo_name": repo_name,
        **progress
    }

@app.get("/downloads/active")
async def get_active_downloads():
    """Get all active downloads"""
    active_downloads = []
    current_time = time.time()

    for key, progress in proxy_server.download_progress.items():
        # Include only active downloads (not completed/error, and recent)
        if (progress.get('status') not in ['transfer_complete', 'error'] and
            current_time - progress.get('timestamp', 0) < 3600):  # Active within 1 hour
            author, repo_name = key.split('/', 1)
            active_downloads.append({
                "author": author,
                "repo_name": repo_name,
                "key": key,
                **progress
            })

    return {
        "active_downloads": active_downloads,
        "count": len(active_downloads)
    }

if __name__ == "__main__":
    port = int(os.getenv("DOWNLOAD_PROXY_PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
