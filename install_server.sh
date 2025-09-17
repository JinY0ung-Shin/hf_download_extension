#!/bin/bash

# HuggingFace Model Downloader Server 설치 스크립트
# 75.12.8.195 서버에서 실행하세요

echo "HuggingFace Model Downloader Server 설치를 시작합니다..."

# 필수 패키지 설치
echo "1. 시스템 패키지 업데이트 및 설치..."
sudo apt-get update
sudo apt-get install -y python3 python3-pip git git-lfs curl

# Git LFS 초기화
echo "2. Git LFS 설정..."
git lfs install

# Python 가상환경 생성
echo "3. Python 가상환경 설정..."
python3 -m venv venv
source venv/bin/activate

# Python 패키지 설치
echo "4. Python 패키지 설치..."
pip install flask flask-cors

# 다운로드 디렉토리 생성
echo "5. 다운로드 디렉토리 생성..."
sudo mkdir -p /data/huggingface_models
sudo chown $USER:$USER /data/huggingface_models

# 서버 스크립트를 systemd 서비스로 등록
echo "6. systemd 서비스 등록..."
sudo tee /etc/systemd/system/hf-downloader.service > /dev/null <<EOF
[Unit]
Description=HuggingFace Model Downloader Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$PWD
Environment=PATH=$PWD/venv/bin
ExecStart=$PWD/venv/bin/python server_example.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# 서비스 활성화
sudo systemctl daemon-reload
sudo systemctl enable hf-downloader.service

echo ""
echo "설치가 완료되었습니다!"
echo ""
echo "서버 시작: sudo systemctl start hf-downloader"
echo "서버 중지: sudo systemctl stop hf-downloader"
echo "서버 상태: sudo systemctl status hf-downloader"
echo "로그 확인: sudo journalctl -u hf-downloader -f"
echo ""
echo "서버는 포트 8080에서 실행됩니다."
echo "방화벽 설정이 필요한 경우:"
echo "  sudo ufw allow 8080"
echo ""

# 방화벽 확인 및 설정 제안
if command -v ufw &> /dev/null; then
    echo "현재 방화벽 상태:"
    sudo ufw status
    echo ""
    echo "포트 8080을 열려면: sudo ufw allow 8080"
fi

echo "설치 스크립트 완료!"