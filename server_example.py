#!/usr/bin/env python3
"""
HuggingFace Model Downloader Server Example
75.12.8.195 서버에서 실행할 API 서버 예시 코드

이 코드는 참고용이며, 실제 서버 환경에 맞게 수정이 필요합니다.
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import subprocess
import threading
import os
import json
import time
import uuid
from datetime import datetime

app = Flask(__name__)
CORS(app)  # Enable CORS for Chrome extension

# 다운로드 상태를 저장하는 딕셔너리
downloads = {}

# 전송 상태를 저장하는 딕셔너리  
transfers = {}

# 다운로드 디렉토리
DOWNLOAD_BASE_DIR = "./data"
os.makedirs(DOWNLOAD_BASE_DIR, exist_ok=True)

# 폐쇄망 설정 (실제 환경에 맞게 수정 필요)
CLOSED_NETWORK_CONFIG = {
    "host": "192.168.1.100",  # 폐쇄망 서버 IP
    "port": 22,
    "username": "transfer_user",
    "target_path": "/opt/models/",
    "use_scp": True  # SCP 사용 여부
}

class DownloadStatus:
    def __init__(self, download_id, repository, branch="main"):
        self.download_id = download_id
        self.repository = repository
        self.branch = branch
        self.status = "started"  # started, downloading, completed, failed
        self.progress = 0
        self.current_file = ""
        self.total_files = 0
        self.downloaded_size = ""
        self.total_size = ""
        self.error = None
        self.start_time = datetime.now()
        self.process = None

class TransferStatus:
    def __init__(self, transfer_id, download_id, target_path):
        self.transfer_id = transfer_id
        self.download_id = download_id
        self.target_path = target_path
        self.status = "started"  # started, transferring, completed, failed
        self.progress = 0
        self.current_file = ""
        self.total_files = 0
        self.transferred_size = ""
        self.total_size = ""
        self.error = None
        self.start_time = datetime.now()
        self.process = None

def run_git_clone(download_status, repo_path):
    """Git clone을 실행하는 함수 - 실시간 진행률 표시"""
    try:
        download_status.status = "downloading"
        
        # HuggingFace repository URL 생성
        repo_url = f"https://huggingface.co/{download_status.repository}"
        
        # Git LFS가 설치되어 있는지 확인
        try:
            subprocess.run(["git", "version"], check=True, capture_output=True)
        except (subprocess.CalledProcessError, FileNotFoundError):
            download_status.status = "failed"
            download_status.error = "Git이 설치되지 않았습니다."
            return
        
        # Clone 명령어 실행 (진행률 표시를 위해 --progress 추가)
        cmd = ["git", "clone", "--progress", repo_url, repo_path]
        if download_status.branch != "main":
            cmd.extend(["--branch", download_status.branch])
        
        print(f"Executing: {' '.join(cmd)}")
        download_status.current_file = "Git clone 시작..."
        
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,  # stderr도 stdout으로 리다이렉트
            text=True,
            universal_newlines=True,
            cwd=DOWNLOAD_BASE_DIR
        )
        
        download_status.process = process
        
        # 실시간 출력 파싱
        while True:
            output = process.stdout.readline()
            if output == '' and process.poll() is not None:
                break
            if output:
                line = output.strip()
                print(f"Git output: {line}")
                
                # 진행률 파싱
                if "Cloning into" in line:
                    download_status.current_file = f"저장소 복제 중: {download_status.repository}"
                    download_status.progress = 5
                elif "remote: Enumerating objects" in line:
                    download_status.current_file = "원격 객체 열거 중..."
                    download_status.progress = 10
                elif "remote: Counting objects" in line:
                    download_status.current_file = "객체 개수 계산 중..."
                    download_status.progress = 15
                elif "remote: Compressing objects" in line:
                    download_status.current_file = "객체 압축 중..."
                    download_status.progress = 25
                elif "Receiving objects:" in line:
                    # Git의 진행률 파싱 (예: "Receiving objects: 45% (123/456)")
                    try:
                        if "%" in line:
                            percent = int(line.split("(")[0].split(":")[1].strip().rstrip("%"))
                            download_status.progress = min(20 + (percent * 0.6), 80)  # 20-80% 범위
                            download_status.current_file = f"객체 수신 중: {percent}%"
                    except:
                        download_status.current_file = "객체 수신 중..."
                        download_status.progress = 40
                elif "Resolving deltas:" in line:
                    # Delta 해결 진행률 파싱
                    try:
                        if "%" in line:
                            percent = int(line.split("(")[0].split(":")[1].strip().rstrip("%"))
                            download_status.progress = min(80 + (percent * 0.15), 95)  # 80-95% 범위
                            download_status.current_file = f"델타 해결 중: {percent}%"
                    except:
                        download_status.current_file = "델타 해결 중..."
                        download_status.progress = 85
                elif "Updating files:" in line:
                    download_status.current_file = "파일 업데이트 중..."
                    download_status.progress = 95
                elif "Filtering content:" in line:
                    download_status.current_file = "LFS 콘텐츠 필터링 중..."
                    download_status.progress = 98
        
        # 프로세스 완료 대기
        process.wait()
        
        if process.returncode == 0:
            download_status.status = "completed"
            download_status.progress = 100
            download_status.current_file = "다운로드 완료!"
            print(f"Download completed for {download_status.repository}")
        else:
            download_status.status = "failed"
            download_status.error = "Git clone 실패"
            print(f"Download failed with return code: {process.returncode}")
            
    except Exception as e:
        download_status.status = "failed"
        download_status.error = str(e)
        print(f"Exception during download: {e}")


def run_transfer_to_closed_network(transfer_status, source_path):
    """폐쇄망으로 파일을 전송하는 함수 - 실시간 진행률 표시"""
    try:
        transfer_status.status = "transferring"
        
        config = CLOSED_NETWORK_CONFIG
        target_host = config["host"]
        target_port = config["port"]
        username = config["username"]
        target_base_path = config["target_path"]
        
        # 모델명으로 대상 경로 생성
        model_name = os.path.basename(source_path)
        target_full_path = os.path.join(target_base_path, model_name)
        
        transfer_status.current_file = f"폐쇄망 전송 시작: {model_name}"
        transfer_status.progress = 5
        
        if config["use_scp"]:
            # SCP를 사용한 전송 (진행률 표시 불가)
            cmd = [
                "scp", "-r", "-P", str(target_port),
                "-o", "StrictHostKeyChecking=no",
                source_path,
                f"{username}@{target_host}:{target_full_path}"
            ]
            
            print(f"Transfer command: {' '.join(cmd)}")
            
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            
            transfer_status.process = process
            transfer_status.current_file = "SCP 전송 중..."
            
            # SCP는 진행률을 제공하지 않으므로 시뮬레이션
            while process.poll() is None:
                if transfer_status.progress < 90:
                    transfer_status.progress += 15
                    transfer_status.current_file = f"SCP 전송 중... ({transfer_status.progress}%)"
                time.sleep(3)
            
            process.communicate()
            
        else:
            # rsync를 사용한 전송 (진행률 표시 가능)
            cmd = [
                "rsync", "-avz", "--progress", "--stats",
                "-e", f"ssh -p {target_port} -o StrictHostKeyChecking=no",
                source_path + "/",
                f"{username}@{target_host}:{target_full_path}/"
            ]
            
            print(f"Transfer command: {' '.join(cmd)}")
            
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                universal_newlines=True
            )
            
            transfer_status.process = process
            
            # rsync 실시간 출력 파싱
            while True:
                output = process.stdout.readline()
                if output == '' and process.poll() is not None:
                    break
                if output:
                    line = output.strip()
                    print(f"Rsync output: {line}")
                    
                    # rsync 진행률 파싱
                    if "sending incremental file list" in line:
                        transfer_status.current_file = "파일 목록 생성 중..."
                        transfer_status.progress = 10
                    elif line.endswith("/"):
                        # 디렉토리명
                        transfer_status.current_file = f"디렉토리 생성: {line}"
                        transfer_status.progress = min(transfer_status.progress + 2, 80)
                    elif "%" in line and "MB/s" in line:
                        # 진행률 파싱 (예: "  1.23M  45%  123.45kB/s    0:00:12")
                        try:
                            parts = line.split()
                            for part in parts:
                                if "%" in part:
                                    percent = int(part.rstrip("%"))
                                    transfer_status.progress = min(10 + (percent * 0.8), 90)
                                    transfer_status.current_file = f"파일 전송 중: {percent}%"
                                    break
                        except:
                            pass
                    elif line.startswith("total size is"):
                        transfer_status.current_file = "전송 완료 검증 중..."
                        transfer_status.progress = 95
                    elif "speedup is" in line:
                        transfer_status.current_file = "전송 완료!"
                        transfer_status.progress = 98
        
        # 프로세스 완료 대기
        process.wait()
        
        if process.returncode == 0:
            transfer_status.status = "completed"
            transfer_status.progress = 100
            transfer_status.current_file = f"폐쇄망 전송 완료: {target_host}"
            print(f"Transfer completed to {target_host}:{target_full_path}")
        else:
            transfer_status.status = "failed"
            if config["use_scp"]:
                transfer_status.error = "SCP 전송 실패"
            else:
                transfer_status.error = "Rsync 전송 실패"
            print(f"Transfer failed with return code: {process.returncode}")
            
    except Exception as e:
        transfer_status.status = "failed"
        transfer_status.error = str(e)
        print(f"Exception during transfer: {e}")

@app.route('/api/download', methods=['POST'])
def start_download():
    """다운로드 시작 API"""
    try:
        data = request.get_json()
        
        download_id = data.get('downloadId')
        repository = data.get('repository')
        branch = data.get('branch', 'main')
        
        if not download_id or not repository:
            return jsonify({'error': 'downloadId and repository are required'}), 400
        
        # 이미 진행 중인 다운로드인지 확인
        if download_id in downloads:
            return jsonify({'error': 'Download already in progress'}), 409
        
        # 다운로드 상태 생성
        download_status = DownloadStatus(download_id, repository, branch)
        downloads[download_id] = download_status
        
        # 다운로드 경로 생성
        repo_name = repository.replace('/', '_')
        repo_path = os.path.join(DOWNLOAD_BASE_DIR, f"{repo_name}_{download_id}")
        
        # 백그라운드에서 다운로드 시작
        thread = threading.Thread(
            target=run_git_clone, 
            args=(download_status, repo_path)
        )
        thread.daemon = True
        thread.start()
        
        return jsonify({
            'success': True,
            'downloadId': download_id,
            'message': 'Download started',
            'repository': repository,
            'downloadPath': repo_path
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/status/<download_id>', methods=['GET'])
def get_download_status(download_id):
    """다운로드 상태 조회 API"""
    try:
        if download_id not in downloads:
            return jsonify({'error': 'Download not found'}), 404
        
        download_status = downloads[download_id]
        
        return jsonify({
            'downloadId': download_id,
            'status': download_status.status,
            'progress': download_status.progress,
            'currentFile': download_status.current_file,
            'totalFiles': download_status.total_files,
            'downloadedSize': download_status.downloaded_size,
            'totalSize': download_status.total_size,
            'error': download_status.error,
            'repository': download_status.repository,
            'startTime': download_status.start_time.isoformat()
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/cancel/<download_id>', methods=['POST'])
def cancel_download(download_id):
    """다운로드 취소 API"""
    try:
        if download_id not in downloads:
            return jsonify({'error': 'Download not found'}), 404
        
        download_status = downloads[download_id]
        
        # 진행 중인 프로세스가 있으면 종료
        if download_status.process:
            download_status.process.terminate()
            download_status.process.wait()
        
        download_status.status = "cancelled"
        
        return jsonify({
            'success': True,
            'message': 'Download cancelled',
            'downloadId': download_id
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/downloads', methods=['GET'])
def list_downloads():
    """전체 다운로드 목록 조회 API"""
    try:
        download_list = []
        for download_id, status in downloads.items():
            download_list.append({
                'downloadId': download_id,
                'repository': status.repository,
                'status': status.status,
                'progress': status.progress,
                'startTime': status.start_time.isoformat()
            })
        
        return jsonify({
            'downloads': download_list,
            'total': len(download_list)
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/transfer', methods=['POST'])
def start_transfer():
    """폐쇄망 전송 시작 API"""
    try:
        data = request.get_json()
        
        download_id = data.get('downloadId')
        target_path = data.get('targetPath', CLOSED_NETWORK_CONFIG['target_path'])
        
        if not download_id:
            return jsonify({'error': 'downloadId is required'}), 400
        
        # 다운로드가 완료되었는지 확인
        if download_id not in downloads:
            return jsonify({'error': 'Download not found'}), 404
        
        download_status = downloads[download_id]
        if download_status.status != 'completed':
            return jsonify({'error': 'Download not completed yet'}), 400
        
        # 전송 ID 생성
        transfer_id = f"transfer_{int(time.time())}_{download_id}"
        
        # 이미 전송 중인지 확인
        existing_transfer = None
        for tid, transfer in transfers.items():
            if transfer.download_id == download_id and transfer.status in ['started', 'transferring']:
                existing_transfer = tid
                break
        
        if existing_transfer:
            return jsonify({'error': 'Transfer already in progress', 'transferId': existing_transfer}), 409
        
        # 전송 상태 생성
        transfer_status = TransferStatus(transfer_id, download_id, target_path)
        transfers[transfer_id] = transfer_status
        
        # 소스 경로 찾기
        repo_name = download_status.repository.replace('/', '_')
        source_path = os.path.join(DOWNLOAD_BASE_DIR, f"{repo_name}_{download_id}")
        
        if not os.path.exists(source_path):
            transfer_status.status = "failed"
            transfer_status.error = "Source path not found"
            return jsonify({'error': 'Source path not found'}), 404
        
        # 백그라운드에서 전송 시작
        thread = threading.Thread(
            target=run_transfer_to_closed_network,
            args=(transfer_status, source_path)
        )
        thread.daemon = True
        thread.start()
        
        return jsonify({
            'success': True,
            'transferId': transfer_id,
            'downloadId': download_id,
            'message': 'Transfer started',
            'targetHost': CLOSED_NETWORK_CONFIG['host'],
            'targetPath': target_path
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/transfer/status/<transfer_id>', methods=['GET'])
def get_transfer_status(transfer_id):
    """전송 상태 조회 API"""
    try:
        if transfer_id not in transfers:
            return jsonify({'error': 'Transfer not found'}), 404
        
        transfer_status = transfers[transfer_id]
        
        return jsonify({
            'transferId': transfer_id,
            'downloadId': transfer_status.download_id,
            'status': transfer_status.status,
            'progress': transfer_status.progress,
            'currentFile': transfer_status.current_file,
            'totalFiles': transfer_status.total_files,
            'transferredSize': transfer_status.transferred_size,
            'totalSize': transfer_status.total_size,
            'error': transfer_status.error,
            'targetPath': transfer_status.target_path,
            'startTime': transfer_status.start_time.isoformat()
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/transfer/cancel/<transfer_id>', methods=['POST'])
def cancel_transfer(transfer_id):
    """전송 취소 API"""
    try:
        if transfer_id not in transfers:
            return jsonify({'error': 'Transfer not found'}), 404
        
        transfer_status = transfers[transfer_id]
        
        # 진행 중인 프로세스가 있으면 종료
        if transfer_status.process:
            transfer_status.process.terminate()
            transfer_status.process.wait()
        
        transfer_status.status = "cancelled"
        
        return jsonify({
            'success': True,
            'message': 'Transfer cancelled',
            'transferId': transfer_id
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/transfers', methods=['GET'])
def list_transfers():
    """전체 전송 목록 조회 API"""
    try:
        transfer_list = []
        for transfer_id, status in transfers.items():
            transfer_list.append({
                'transferId': transfer_id,
                'downloadId': status.download_id,
                'status': status.status,
                'progress': status.progress,
                'targetPath': status.target_path,
                'startTime': status.start_time.isoformat()
            })
        
        return jsonify({
            'transfers': transfer_list,
            'total': len(transfer_list)
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health_check():
    """헬스 체크 API"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'downloads': len(downloads)
    })

if __name__ == '__main__':
    print("Starting HuggingFace Model Downloader Server...")
    print("Make sure Git and Git LFS are installed:")
    print("  sudo apt-get install git git-lfs")
    print("  git lfs install")
    print("")
    print(f"Download directory: {DOWNLOAD_BASE_DIR}")
    print("Server will listen on 0.0.0.0:8080")
    print("")
    
    app.run(host='0.0.0.0', port=8080, debug=True)