# HuggingFace Model Downloader Chrome Extension

회사 폐쇄망 환경에서 HuggingFace 모델을 자동으로 다운로드하는 Chrome 확장 프로그램입니다.

## 기능

- HuggingFace 모델 페이지 자동 감지
- 75.12.8.195 서버를 통한 자동 다운로드
- 전체/모델 파일만/선택 파일 다운로드 옵션
- 실시간 다운로드 진행률 표시
- **폐쇄망 자동 전송** (SCP/rsync 지원)
- 전송 진행률 실시간 모니터링

## 설치 및 설정 가이드

### 1. 서버 설치 및 설정 (75.12.8.195에서 실행)

#### 자동 설치 (권장)
```bash
# 1. 서버에 파일 업로드 후
chmod +x install_server.sh
./install_server.sh

# 2. 서비스 시작
sudo systemctl start hf-downloader
sudo systemctl status hf-downloader

# 3. 방화벽 설정 (필요한 경우)
sudo ufw allow 8080
```

#### 수동 설치
```bash
# 필수 패키지 설치
sudo apt-get update
sudo apt-get install -y python3 python3-pip git git-lfs curl

# Git LFS 설정
git lfs install

# Python 가상환경 생성
python3 -m venv venv
source venv/bin/activate

# Python 패키지 설치
pip install flask flask-cors

# 다운로드 디렉토리 생성
sudo mkdir -p /data/huggingface_models
sudo chown $USER:$USER /data/huggingface_models

# 서버 실행
python server_example.py
```

#### 폐쇄망 설정
`server_example.py` 파일의 `CLOSED_NETWORK_CONFIG` 수정:
```python
CLOSED_NETWORK_CONFIG = {
    "host": "192.168.1.100",        # 폐쇄망 서버 IP
    "port": 22,                     # SSH 포트
    "username": "transfer_user",    # SSH 사용자명
    "target_path": "/opt/models/",  # 대상 디렉토리
    "use_scp": True                # SCP 사용 (False면 rsync)
}
```

#### SSH 키 설정 (비밀번호 없는 로그인)
```bash
# 1. SSH 키 생성 (75.12.8.195에서)
ssh-keygen -t rsa -b 4096 -f ~/.ssh/transfer_key

# 2. 공개키를 폐쇄망 서버에 복사
ssh-copy-id -i ~/.ssh/transfer_key.pub transfer_user@192.168.1.100

# 3. SSH 설정 파일 생성
cat >> ~/.ssh/config << EOF
Host closed-network
    HostName 192.168.1.100
    User transfer_user
    IdentityFile ~/.ssh/transfer_key
    StrictHostKeyChecking no
EOF
```

### 2. Chrome 확장 프로그램 설치

#### Chrome 브라우저
1. Chrome 주소창에 `chrome://extensions/` 입력
2. 우측 상단 "개발자 모드" 토글 활성화
3. "압축해제된 확장 프로그램을 로드합니다" 클릭
4. 이 프로젝트 폴더(`download_extension`) 선택
5. 확장 프로그램이 설치되면 주소창 옆에 아이콘 표시

#### Chrome 확장 프로그램 고정
1. 확장 프로그램 아이콘 클릭 (퍼즐 모양)
2. "HuggingFace Model Downloader" 옆 📌 버튼 클릭하여 고정

### 3. Microsoft Edge 확장 프로그램 설치

#### Edge 브라우저
1. Edge 주소창에 `edge://extensions/` 입력
2. 왼쪽 하단 "개발자 모드" 토글 활성화
3. "압축을 푼 확장을 로드합니다" 클릭
4. 이 프로젝트 폴더(`download_extension`) 선택
5. 확장 프로그램이 설치되면 주소창 옆에 아이콘 표시

#### Edge 확장 프로그램 고정
1. 확장 프로그램 아이콘 클릭 (퍼즐 모양)
2. "HuggingFace Model Downloader" 옆 👁️ 버튼 클릭하여 표시

### 4. 확장 프로그램 권한 설정

설치 후 다음 권한이 자동으로 부여됩니다:
- `https://huggingface.co/*` - HuggingFace 사이트 접근
- `http://75.12.8.195/*` - 다운로드 서버 통신
- `activeTab` - 현재 탭 정보 읽기
- `storage` - 설정 저장

### 5. 서버 연결 테스트

#### 웹 브라우저에서 테스트
```
http://75.12.8.195:8080/health
```
정상 응답:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00",
  "downloads": 0
}
```

#### 명령줄에서 테스트
```bash
# 헬스 체크
curl http://75.12.8.195:8080/health

# 또는 테스트 스크립트 실행
python test_server.py
```

## 상세 사용 가이드

### 📝 기본 사용법

#### 1단계: HuggingFace 모델 페이지 방문
```
https://huggingface.co/microsoft/DialoGPT-medium
https://huggingface.co/Qwen/Qwen-Image-Edit
https://huggingface.co/microsoft/codebert-base
```
등 아무 HuggingFace 모델 페이지에 접속

#### 2단계: 확장 프로그램 실행
1. 브라우저 주소창 옆의 🤗 아이콘 클릭
2. 모델 정보가 자동으로 인식되어 표시됨
3. 모델명, URL, 파일 개수 확인

#### 3단계: 다운로드 옵션 선택

**전체 다운로드** 📥
- 모든 파일(모델, 설정, 문서 등) 다운로드
- 완전한 모델 환경 구축 시 선택

**모델 파일만** 🎯  
- `.bin`, `.safetensors`, `.ckpt`, `.pth` 등만 다운로드
- 빠른 다운로드, 핵심 파일만 필요할 때 선택

**선택 파일** 🗂️
- "파일 선택" 영역 펼치기
- 필요한 파일만 체크박스 선택
- "선택 파일 다운로드" 클릭

#### 4단계: 다운로드 모니터링
- 실시간 진행률 표시 (0~100%)
- 현재 다운로드 중인 파일명 표시
- 다운로드 크기 정보 (예: 500MB / 1.2GB)

#### 5단계: 폐쇄망 전송
- 다운로드 완료 시 **"🚀 폐쇄망으로 전송"** 버튼 자동 표시
- 버튼 클릭 → 자동으로 폐쇄망 서버에 전송 시작
- 전송 진행률 실시간 모니터링
- 완료 시 "🎉 폐쇄망 전송 완료!" 메시지

### 🔧 고급 설정

#### 서버 IP 변경
팝업 하단 "다운로드 서버 IP" 입력란에서 변경 가능
- 기본값: `75.12.8.195`
- 변경 후 자동 저장

#### 다운로드 경로 변경
`server_example.py`에서 수정:
```python
DOWNLOAD_BASE_DIR = "/data/huggingface_models"  # 원하는 경로로 변경
```

#### 폐쇄망 설정 변경  
```python
CLOSED_NETWORK_CONFIG = {
    "host": "192.168.1.100",        # 폐쇄망 IP
    "port": 22,                     # SSH 포트
    "username": "your_username",    # SSH 사용자
    "target_path": "/your/path/",   # 저장 경로
    "use_scp": True                # SCP(True) 또는 rsync(False)
}
```

### 🚨 문제 해결

#### 확장 프로그램이 모델을 인식하지 못할 때
- 페이지 새로고침 후 2-3초 대기
- 모델 페이지인지 확인 (dataset, space 페이지 아님)
- 개발자 콘솔에서 오류 메시지 확인

#### 다운로드가 시작되지 않을 때
1. 서버 상태 확인: `http://75.12.8.195:8080/health`
2. 방화벽 설정 확인: `sudo ufw allow 8080`  
3. 서버 로그 확인: `sudo journalctl -u hf-downloader -f`

#### 전송이 실패할 때
1. SSH 키 설정 확인
2. 폐쇄망 서버 연결 테스트: `ssh transfer_user@192.168.1.100`
3. 대상 경로 권한 확인: `ls -la /opt/models/`

#### 대용량 모델 다운로드 시 주의사항
- Git LFS 설치 필수: `git lfs install`
- 충분한 디스크 공간 확보 (모델 크기의 2배 권장)
- 네트워크 안정성 확인

### 📊 지원하는 모델 유형

- **언어 모델**: GPT, BERT, T5, LLaMA 등
- **비전 모델**: ViT, CLIP, YOLO 등  
- **멀티모달**: DALL-E, Stable Diffusion 등
- **코드 모델**: CodeBERT, GitHub Copilot 등
- **데이터셋**: 일부 지원 (dataset 타입 감지)

### 💡 사용 팁

**효율적인 다운로드**
- 큰 모델은 "모델 파일만" 옵션 사용
- 네트워크가 불안정하면 작은 모델부터 테스트
- 여러 모델 동시 다운로드 시 서버 부하 고려

**폐쇄망 전송 최적화**  
- rsync 사용 시 중단된 전송 재개 가능
- SCP는 더 안정적이지만 재개 불가
- 대용량 파일은 압축 후 전송 고려

## 서버 관리 가이드

### 🖥️ 서버 운영 명령어

#### 서비스 관리
```bash
# 서비스 시작
sudo systemctl start hf-downloader

# 서비스 중지  
sudo systemctl stop hf-downloader

# 서비스 재시작
sudo systemctl restart hf-downloader

# 서비스 상태 확인
sudo systemctl status hf-downloader

# 서비스 자동 시작 설정
sudo systemctl enable hf-downloader

# 서비스 자동 시작 해제
sudo systemctl disable hf-downloader
```

#### 로그 모니터링
```bash
# 실시간 로그 확인
sudo journalctl -u hf-downloader -f

# 최근 100줄 로그 확인
sudo journalctl -u hf-downloader -n 100

# 오늘 로그만 확인
sudo journalctl -u hf-downloader --since today

# 특정 시간 이후 로그 확인
sudo journalctl -u hf-downloader --since "2024-01-15 10:00:00"
```

#### 디스크 관리
```bash
# 다운로드 디렉토리 사용량 확인
du -sh /data/huggingface_models/*

# 디스크 공간 확인
df -h /data/huggingface_models

# 오래된 다운로드 정리 (7일 이상)
find /data/huggingface_models -type d -mtime +7 -name "*download_*" -exec rm -rf {} +
```

### 🔍 모니터링 및 성능

#### API 상태 확인
```bash
# 헬스 체크
curl http://75.12.8.195:8080/health

# 현재 다운로드 목록
curl http://75.12.8.195:8080/api/downloads

# 현재 전송 목록  
curl http://75.12.8.195:8080/api/transfers
```

#### 성능 모니터링
```bash
# CPU 및 메모리 사용률
htop

# 네트워크 사용률
iftop

# 디스크 I/O 모니터링
iotop
```

#### 백업 및 복구
```bash
# 다운로드 디렉토리 백업
tar -czf backup_$(date +%Y%m%d).tar.gz /data/huggingface_models

# 설정 파일 백업
cp server_example.py server_backup_$(date +%Y%m%d).py

# 복구 (예시)
tar -xzf backup_20240115.tar.gz -C /
```

### 🔒 보안 설정

#### 방화벽 설정
```bash
# 포트 8080 허용 (Chrome 확장용)
sudo ufw allow 8080

# 특정 IP만 접근 허용
sudo ufw allow from 192.168.1.0/24 to any port 8080

# SSH 포트 보안 (폐쇄망 전송용)
sudo ufw allow 22
```

#### SSL/TLS 설정 (선택사항)
```bash
# Let's Encrypt 인증서 설치
sudo apt-get install certbot
sudo certbot certonly --standalone -d yourdomain.com

# Nginx 리버스 프록시 설정
sudo apt-get install nginx
```

### 📊 성능 최적화

#### 동시 다운로드 제한
`server_example.py`에서 수정:
```python
# 최대 동시 다운로드 수
MAX_CONCURRENT_DOWNLOADS = 3

# 다운로드 타임아웃 설정
DOWNLOAD_TIMEOUT = 3600  # 1시간
```

#### 메모리 사용 최적화
```python
# Git clone 옵션 추가
cmd = ["git", "clone", "--depth", "1", repo_url, repo_path]  # shallow clone
```

### 🚨 장애 대응

#### 일반적인 오류와 해결법

**"Git LFS not installed" 오류**
```bash
sudo apt-get install git-lfs
git lfs install
```

**"Permission denied" 오류**  
```bash
sudo chown -R $USER:$USER /data/huggingface_models
chmod 755 /data/huggingface_models
```

**"Port already in use" 오류**
```bash
# 포트 사용 프로세스 확인
sudo lsof -i :8080

# 프로세스 종료
sudo kill -9 [PID]
```

**SSH 연결 실패**
```bash
# SSH 연결 테스트
ssh -vvv transfer_user@192.168.1.100

# SSH 키 권한 확인
chmod 600 ~/.ssh/transfer_key
```

#### 응급 복구 절차
1. 서비스 중지: `sudo systemctl stop hf-downloader`
2. 로그 확인: `sudo journalctl -u hf-downloader -n 50`
3. 설정 백업에서 복구: `cp server_backup.py server_example.py`
4. 권한 재설정: `sudo chown -R $USER:$USER /data/`
5. 서비스 재시작: `sudo systemctl start hf-downloader`

## 기본 설정 정보

- **서버 주소**: 75.12.8.195:8080
- **다운로드 경로**: /data/huggingface_models  
- **폐쇄망 기본 설정**: 192.168.1.100:22
- **지원 브라우저**: Chrome, Edge (Chromium 기반)
- **팝업에서 서버 IP 변경 가능**

## 서버 API 요구사항

확장 프로그램이 작동하려면 75.12.8.195 서버에 다음 API가 구현되어야 합니다:

### 1. 다운로드 시작
```
POST /api/download
Content-Type: application/json

{
  "downloadId": "download_1234567890_abc123",
  "repository": "Qwen/Qwen-Image-Edit",
  "branch": "main",
  "repoType": "model",
  "files": [
    {"name": "model.safetensors", "size": "1.2GB", "type": "model"},
    {"name": "config.json", "size": "1KB", "type": "config"}
  ],
  "options": {
    "includeGitHistory": false
  }
}
```

### 2. 다운로드 상태 확인
```
GET /api/status/{downloadId}

Response:
{
  "status": "downloading", // "started", "downloading", "completed", "failed"
  "progress": 45, // 0-100
  "currentFile": "model.safetensors",
  "totalFiles": 10,
  "downloadedSize": "500MB",
  "totalSize": "1.2GB",
  "error": null
}
```

### 3. 다운로드 취소
```
POST /api/cancel/{downloadId}
```

### 4. 폐쇄망 전송 시작
```
POST /api/transfer
Content-Type: application/json

{
  "downloadId": "download_1234567890_abc123",
  "targetPath": "/opt/models/"
}
```

### 5. 전송 상태 확인
```
GET /api/transfer/status/{transferId}

Response:
{
  "status": "transferring", // "started", "transferring", "completed", "failed"
  "progress": 65, // 0-100
  "transferId": "transfer_1234567890_download_abc123",
  "downloadId": "download_1234567890_abc123",
  "targetPath": "/opt/models/",
  "error": null
}
```

### 6. 전송 취소
```
POST /api/transfer/cancel/{transferId}
```

## 파일 구조

```
download_extension/
├── manifest.json          # 확장 프로그램 설정
├── popup.html            # 팝업 UI
├── popup.js              # 팝업 로직
├── content.js            # HuggingFace 페이지 파싱
├── background.js         # API 통신 및 다운로드 관리
├── icons/               # 아이콘 파일들
└── README.md
```

## 개발 노트

- Manifest V3 사용
- HuggingFace 페이지의 DOM 구조 변경에 대응
- SPA 라우팅 감지를 위한 MutationObserver 사용
- 실시간 상태 업데이트를 위한 폴링 메커니즘