# HuggingFace Model Downloader Chrome Extension

HuggingFace 레포지토리에서 모델을 자동으로 다운로드하고 슈퍼컴 서버로 전송하는 크롬 확장 프로그램입니다.

## 기능

- **자동 HuggingFace 감지**: `https://huggingface.co/{author}/{repo_name}` 패턴의 URL에서만 활성화
- **원클릭 다운로드**: Chrome extension을 통한 간편한 다운로드 요청
- **자동 서버 전송**: 다운로드 완료 후 슈퍼컴 서버로 자동 SCP 전송
- **중복 방지**: 이미 다운로드된 모델 감지 및 알림
- **자동 정리**: 전송 완료 후 로컬 임시 파일 자동 삭제

## 아키텍처

```
[Chrome Extension] → [Download Proxy Server] → [Supercomputer Server]
     (감지/요청)        (git clone + scp)           (최종 저장)
```

### Chrome Extension
- HuggingFace URL 패턴 감지
- 레포지토리 정보 추출 (author, repo_name)
- Download Proxy 서버에 API 요청

### Download Proxy Server
- FastAPI 기반 REST API 서버
- Git clone을 통한 HuggingFace 모델 다운로드
- SCP를 통한 슈퍼컴 서버 전송
- 경로: `{SUPERCOMPUTER_PATH}/{author}/{repo_name}`

## 설치 및 실행

### 1. 환경 설정
```bash
# 의존성 설치
uv sync

# 환경변수 설정 (.env 파일 수정)
# SUPERCOMPUTER_HOST, SUPERCOMPUTER_USER 등 실제 값으로 설정
```

### 2. SSH 키 인증 설정
```bash
# SSH 키가 없는 경우 생성
ssh-keygen -t rsa -b 4096

# 공개키를 대상 서버에 복사 (로컬 테스트의 경우)
ssh-copy-id username@hostname

# 비밀번호 없이 SSH 접속 확인
ssh username@hostname 'echo "SSH key auth test"'
```

### 3. 서버 실행
```bash
uv run python server.py
```

### 4. Chrome Extension 설치
1. Chrome에서 `chrome://extensions/` 접속
2. 개발자 모드 활성화
3. "압축해제된 확장 프로그램을 로드합니다" 클릭
4. 프로젝트 폴더 선택
5. Extension 아이콘이 툴바에 표시되는지 확인

## API 엔드포인트

### POST /download
HuggingFace 모델 다운로드 및 전송
```json
{
  "author": "microsoft",
  "repo_name": "DialoGPT-medium"
}
```

### GET /status/{author}/{repo_name}
모델 존재 여부 확인
```bash
curl http://localhost:8000/status/microsoft/DialoGPT-medium
```

### GET /health
서버 상태 확인
```bash
curl http://localhost:8000/health
```

## 환경변수

| 변수명 | 설명 | 예시 |
|--------|------|------|
| `DOWNLOAD_PROXY_URL` | 프록시 서버 URL | `http://localhost:8000` |
| `DOWNLOAD_PROXY_PORT` | 서버 포트 | `8000` |
| `SUPERCOMPUTER_HOST` | 슈퍼컴 서버 호스트 | `127.0.0.1` (로컬 테스트) |
| `SUPERCOMPUTER_USER` | 슈퍼컴 사용자명 | `jinyoung` |
| `SUPERCOMPUTER_PATH` | 저장 경로 | `/Users/jinyoung/code/download_extension/data_supercomputer` |
| `LOCAL_DOWNLOAD_PATH` | 로컬 임시 경로 | `/Users/jinyoung/code/download_extension/data` |
| `HUGGINGFACE_TOKEN` | HuggingFace 토큰 (선택) | `hf_xxxxxxxxxxxx` |

**주의사항:**
- SSH 키 경로는 자동으로 탐색됩니다 (`~/.ssh/id_rsa`, `~/.ssh/id_ed25519` 등)
- SSH 키 인증이 설정되어 있어야 비밀번호 없이 작동합니다

## 개발 상태

### ✅ 완료된 기능
- [x] Download Proxy Server 구현 (FastAPI)
- [x] Git clone 기능
- [x] SSH/SCP 전송 with 자동 경로 생성
- [x] 중복 다운로드 방지 및 감지
- [x] 전송 후 자동 로컬 파일 정리
- [x] UV 환경 관리 및 의존성 설정
- [x] Chrome Extension Manifest v3 구현
- [x] HuggingFace URL 패턴 감지 및 SPA 지원
- [x] Extension 팝업 UI/UX 구현
- [x] Content Script - 페이지 내 다운로드 버튼
- [x] Background Script - 메시지 처리 및 상태 관리
- [x] SSH 키 자동 탐색 및 인증
- [x] Extension 아이콘 생성 (자동)
- [x] 서버 상태 확인 및 실시간 피드백

### ✅ 완전 구현 완료
모든 주요 기능이 구현되어 사용 가능한 상태입니다:
- Chrome Extension이 HuggingFace 페이지를 감지
- 원클릭으로 모델 다운로드 및 서버 전송
- SSH 키 인증으로 비밀번호 없는 자동화
- 중복 방지 및 진행 상황 실시간 표시

## 사용 방법

### 방법 1: Extension 팝업 사용
1. HuggingFace 모델 페이지 방문 (예: `https://huggingface.co/microsoft/VibeVoice-1.5B`)
2. Chrome extension 아이콘 클릭 (툴바에서 🤗 아이콘)
3. 팝업에서 "Download Model" 버튼 클릭
4. 진행 상황 실시간 확인 및 완료 대기

### 방법 2: 페이지 내 다운로드 버튼 사용
1. HuggingFace 모델 페이지 방문
2. 페이지 상단에 자동으로 나타나는 "Download to Supercomputer" 버튼 클릭
3. 버튼 상태 변화로 진행 상황 확인

### 기능 특징
- **자동 감지**: HuggingFace URL 패턴 자동 인식
- **중복 방지**: 이미 다운로드된 모델은 "Already Downloaded" 표시
- **실시간 피드백**: 다운로드 진행 상황 실시간 표시
- **에러 처리**: 실패 시 에러 메시지 표시 및 자동 복구

## 기술 스택

- **Backend**: Python 3.8+, FastAPI, Uvicorn, AsyncIO
- **Frontend**: Chrome Extension Manifest v3 (HTML, CSS, JavaScript)
- **Tools**: Git, SSH/SCP, Pillow (아이콘 생성)
- **Package Manager**: UV (Python), Chrome Extension
- **Architecture**: RESTful API, Content Scripts, Background Workers

## 트러블슈팅

### Extension이 HuggingFace 페이지를 감지하지 못하는 경우
1. Chrome에서 `chrome://extensions/` 접속
2. Extension 새로고침 버튼 ⟳ 클릭
3. 페이지 새로고침 후 재시도
4. F12 개발자 도구 → Console에서 "HuggingFace Detector" 로그 확인

### SSH 인증 실패
```bash
# SSH 키 권한 확인
chmod 600 ~/.ssh/id_rsa
chmod 644 ~/.ssh/id_rsa.pub

# SSH 연결 테스트
ssh username@hostname 'echo "test"'

# SSH 키가 없는 경우 생성
ssh-keygen -t rsa -b 4096
ssh-copy-id username@hostname
```

### 서버 연결 실패
```bash
# 서버 상태 확인
curl http://localhost:8000/health

# 포트 사용 확인
lsof -i :8000

# 서버 재시작
uv run python server.py
```