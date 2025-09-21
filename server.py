#!/usr/bin/env python3
import os
import shutil
import subprocess
import asyncio
import json
import time
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
from dotenv import load_dotenv

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

    def update_progress(self, key: str, status: str, message: str, progress: int = 0):
        """Update download progress"""
        self.download_progress[key] = {
            "status": status,
            "message": message,
            "progress": progress,
            "timestamp": time.time()
        }
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

    async def simulate_progress_if_needed(self, progress_key: str):
        """Simulate progress if no real progress is detected from git"""
        await asyncio.sleep(5)  # Wait 5 seconds before starting simulation

        progress = self.download_progress.get(progress_key, {})
        if progress.get('progress', 0) <= 5:  # If still very low progress after 5 seconds
            print(f"Starting progress simulation for {progress_key}")

            # Gradually increase progress
            for i in range(10, 80, 5):  # 10% to 75% in 5% increments
                if progress_key not in self.download_progress:
                    break  # Download was cancelled/completed

                current_progress = self.download_progress.get(progress_key, {})
                if current_progress.get('status') != 'cloning':
                    break  # Status changed, stop simulation

                if current_progress.get('progress', 0) < i:  # Only update if real progress hasn't overtaken
                    self.update_progress(progress_key, "cloning", f"Downloading files... (estimated {i}%)", i)

                await asyncio.sleep(3)  # Update every 3 seconds

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

        self.update_progress(progress_key, "cloning", "Starting git clone...", 0)

        # Start a background task to simulate progress if no real progress is detected
        progress_simulation_task = asyncio.create_task(self.simulate_progress_if_needed(progress_key))

        # Remove existing directory if it exists
        if local_repo_path.exists():
            print(f"Removing existing directory: {local_repo_path}")
            shutil.rmtree(local_repo_path)

        try:
            cmd = ["git", "clone", "--progress", repo_url, str(local_repo_path)]
            print(f"Executing command: {' '.join(cmd)}")

            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE  # Keep stderr separate to capture git progress
            )

            # Read stderr (git progress) and stdout separately
            async def read_progress():
                import re
                if process.stderr:
                    async for line in process.stderr:
                        progress_line = line.decode().strip()
                        if progress_line:
                            print(f"Git clone progress: {progress_line}")

                            # Parse git progress - git uses different formats
                            if "Receiving objects:" in progress_line or "remote: Counting objects:" in progress_line:
                                # Look for percentage pattern
                                match = re.search(r'(\d+)%', progress_line)
                                if match:
                                    percentage = int(match.group(1))
                                    self.update_progress(progress_key, "cloning", f"Downloading files... ({percentage}%)", percentage)
                                else:
                                    # If no percentage found, estimate based on activity
                                    self.update_progress(progress_key, "cloning", "Downloading files...", 25)
                            elif "Resolving deltas:" in progress_line:
                                match = re.search(r'(\d+)%', progress_line)
                                if match:
                                    percentage = int(match.group(1))
                                    self.update_progress(progress_key, "cloning", f"Processing files... ({percentage}%)", 80 + (percentage // 5))
                                else:
                                    self.update_progress(progress_key, "cloning", "Processing files...", 85)
                            elif "Checking out files:" in progress_line:
                                match = re.search(r'(\d+)%', progress_line)
                                if match:
                                    percentage = int(match.group(1))
                                    self.update_progress(progress_key, "cloning", f"Checking out files... ({percentage}%)", 90 + (percentage // 10))
                                else:
                                    self.update_progress(progress_key, "cloning", "Checking out files...", 95)
                            elif any(keyword in progress_line.lower() for keyword in ["cloning", "unpacking", "counting"]):
                                # General git activity - show some progress
                                self.update_progress(progress_key, "cloning", f"Git clone: {progress_line}", 10)

            # Start reading progress in background
            progress_task = asyncio.create_task(read_progress())

            # Also read stdout for any error messages
            stdout_data = b''
            if process.stdout:
                async for line in process.stdout:
                    stdout_data += line
                    stdout_line = line.decode().strip()
                    if stdout_line:
                        print(f"Git clone stdout: {stdout_line}")

            # Wait for process to complete
            await process.wait()

            # Cancel progress reading and simulation
            progress_task.cancel()
            progress_simulation_task.cancel()
            try:
                await progress_task
            except asyncio.CancelledError:
                pass
            try:
                await progress_simulation_task
            except asyncio.CancelledError:
                pass

            if process.returncode != 0:
                self.update_progress(progress_key, "error", "Git clone failed", 0)
                raise Exception(f"Git clone failed with return code {process.returncode}")

            print(f"Git clone completed successfully: {local_repo_path}")
            self.update_progress(progress_key, "clone_complete", "Git clone completed", 100)
            return str(local_repo_path)
        except Exception as e:
            print(f"Git clone error: {e}")
            # Cancel simulation on error
            if 'progress_simulation_task' in locals():
                progress_simulation_task.cancel()
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
            _, stderr = await process.communicate()

            if process.returncode != 0:
                self.update_progress(progress_key, "error", "SCP transfer failed", 0)
                raise Exception(f"SCP transfer failed: {stderr.decode()}")

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