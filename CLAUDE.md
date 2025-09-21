# HuggingFace Model Downloader Chrome Extension

## 프로젝트 개요
HuggingFace 레포지토리에서 모델을 자동으로 다운로드하고 슈퍼컴 서버로 전송하는 크롬 확장 프로그램

## 아키텍처

### Chrome Extension
- **활성화 조건**: `https://huggingface.co/{author}/{repo_name}/{...path}` 패턴의 URL에서만 동작
- **기능**: HuggingFace 레포지토리 정보를 추출하여 download proxy 서버로 전송

### Download Proxy Server
- **기능**:
  1. Chrome extension으로부터 레포지토리 정보 수신
  2. `git clone https://huggingface.co/{author}/{repo_name}` 실행
  3. 다운로드 완료 후 슈퍼컴 서버로 scp 전송

## 워크플로우
1. 사용자가 HuggingFace 레포지토리 페이지 방문
2. Chrome extension이 URL 패턴 감지 및 레포지토리 정보 추출
3. Extension이 download proxy 서버에 다운로드 요청 전송
4. Proxy 서버가 git clone으로 모델 다운로드
5. 다운로드 완료 후 자동으로 슈퍼컴 서버로 scp 전송

## 필요한 환경변수
- `DOWNLOAD_PROXY_URL`: Download proxy 서버 URL
- `SUPERCOMPUTER_HOST`: 슈퍼컴 서버 호스트
- `SUPERCOMPUTER_USER`: 슈퍼컴 서버 사용자명
- `SUPERCOMPUTER_PATH`: 슈퍼컴 서버 저장 경로
- `SSH_KEY_PATH`: SSH 개인키 파일 경로

## 개발 명령어
- 의존성 설치: `uv sync`
- 서버 실행: `uv run python server.py`
- 린트: `uv run ruff check` (설정 후 추가)
- 포맷: `uv run ruff format` (설정 후 추가)