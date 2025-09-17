#!/usr/bin/env python3
"""
서버 API 테스트 스크립트
확장 프로그램 없이 서버 API를 테스트할 수 있습니다.
"""

import requests
import json
import time
import sys

# 서버 설정
SERVER_URL = "http://75.12.8.195:8080"  # 실제 서버 주소로 변경

def test_health():
    """헬스 체크 테스트"""
    try:
        response = requests.get(f"{SERVER_URL}/health")
        if response.status_code == 200:
            print("✅ 서버가 정상적으로 동작하고 있습니다.")
            print(f"응답: {response.json()}")
            return True
        else:
            print(f"❌ 헬스 체크 실패: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ 서버 연결 실패: {e}")
        return False

def test_download():
    """다운로드 테스트"""
    try:
        # 테스트용 작은 모델
        test_data = {
            "downloadId": f"test_{int(time.time())}",
            "repository": "microsoft/DialoGPT-small",  # 작은 모델로 테스트
            "branch": "main",
            "repoType": "model",
            "files": [
                {"name": "config.json", "type": "config"},
                {"name": "pytorch_model.bin", "type": "model"}
            ],
            "options": {
                "includeGitHistory": False
            }
        }
        
        print("다운로드 시작 요청 중...")
        response = requests.post(f"{SERVER_URL}/api/download", 
                               json=test_data, 
                               timeout=10)
        
        if response.status_code == 200:
            result = response.json()
            download_id = result.get('downloadId')
            print(f"✅ 다운로드 시작됨: {download_id}")
            
            # 상태 모니터링
            monitor_download(download_id)
            
        else:
            print(f"❌ 다운로드 시작 실패: {response.status_code}")
            print(f"응답: {response.text}")
            
    except Exception as e:
        print(f"❌ 다운로드 테스트 실패: {e}")

def monitor_download(download_id, max_wait=300):
    """다운로드 진행 상태 모니터링"""
    print(f"\n다운로드 상태 모니터링 시작: {download_id}")
    print("=" * 50)
    
    start_time = time.time()
    
    while time.time() - start_time < max_wait:
        try:
            response = requests.get(f"{SERVER_URL}/api/status/{download_id}")
            
            if response.status_code == 200:
                status = response.json()
                
                print(f"상태: {status['status']} | "
                      f"진행률: {status.get('progress', 0)}% | "
                      f"현재 파일: {status.get('currentFile', 'N/A')}")
                
                if status['status'] in ['completed', 'failed']:
                    if status['status'] == 'completed':
                        print("🎉 다운로드 완료!")
                    else:
                        print(f"❌ 다운로드 실패: {status.get('error', 'Unknown error')}")
                    break
                    
            else:
                print(f"❌ 상태 조회 실패: {response.status_code}")
                
        except Exception as e:
            print(f"❌ 상태 모니터링 오류: {e}")
            
        time.sleep(5)  # 5초마다 상태 확인
    
    else:
        print("⚠️ 모니터링 시간 초과")

def list_downloads():
    """다운로드 목록 조회"""
    try:
        response = requests.get(f"{SERVER_URL}/api/downloads")
        if response.status_code == 200:
            downloads = response.json()
            print(f"\n현재 다운로드 목록 ({downloads['total']}개):")
            print("=" * 70)
            
            for download in downloads['downloads']:
                print(f"ID: {download['downloadId']}")
                print(f"레포지토리: {download['repository']}")
                print(f"상태: {download['status']}")
                print(f"진행률: {download['progress']}%")
                print(f"시작 시간: {download['startTime']}")
                print("-" * 50)
                
        else:
            print(f"❌ 다운로드 목록 조회 실패: {response.status_code}")
            
    except Exception as e:
        print(f"❌ 다운로드 목록 조회 오류: {e}")

def test_transfer():
    """전송 테스트"""
    try:
        # 먼저 다운로드 목록에서 완료된 다운로드 찾기
        response = requests.get(f"{SERVER_URL}/api/downloads")
        if response.status_code != 200:
            print("❌ 다운로드 목록을 가져올 수 없습니다. 먼저 다운로드를 완료해주세요.")
            return
        
        downloads = response.json()
        completed_downloads = [d for d in downloads['downloads'] if d['status'] == 'completed']
        
        if not completed_downloads:
            print("❌ 완료된 다운로드가 없습니다. 먼저 다운로드를 완료해주세요.")
            return
        
        print("완료된 다운로드 목록:")
        for i, download in enumerate(completed_downloads):
            print(f"{i+1}. {download['repository']} (ID: {download['downloadId']})")
        
        try:
            choice = int(input("전송할 다운로드를 선택하세요 (번호): ")) - 1
            if choice < 0 or choice >= len(completed_downloads):
                print("❌ 잘못된 선택입니다.")
                return
        except ValueError:
            print("❌ 숫자를 입력해주세요.")
            return
        
        selected_download = completed_downloads[choice]
        download_id = selected_download['downloadId']
        
        # 전송 시작
        transfer_data = {
            "downloadId": download_id,
            "targetPath": "/opt/models/"
        }
        
        print(f"전송 시작 중: {selected_download['repository']}")
        response = requests.post(f"{SERVER_URL}/api/transfer", 
                               json=transfer_data, 
                               timeout=10)
        
        if response.status_code == 200:
            result = response.json()
            transfer_id = result.get('transferId')
            print(f"✅ 전송 시작됨: {transfer_id}")
            
            # 전송 상태 모니터링
            monitor_transfer(transfer_id)
            
        else:
            print(f"❌ 전송 시작 실패: {response.status_code}")
            print(f"응답: {response.text}")
            
    except Exception as e:
        print(f"❌ 전송 테스트 실패: {e}")

def monitor_transfer(transfer_id, max_wait=600):
    """전송 진행 상태 모니터링"""
    print(f"\n전송 상태 모니터링 시작: {transfer_id}")
    print("=" * 50)
    
    start_time = time.time()
    
    while time.time() - start_time < max_wait:
        try:
            response = requests.get(f"{SERVER_URL}/api/transfer/status/{transfer_id}")
            
            if response.status_code == 200:
                status = response.json()
                
                print(f"상태: {status['status']} | "
                      f"진행률: {status.get('progress', 0)}% | "
                      f"대상경로: {status.get('targetPath', 'N/A')}")
                
                if status['status'] in ['completed', 'failed']:
                    if status['status'] == 'completed':
                        print("🎉 폐쇄망 전송 완료!")
                    else:
                        print(f"❌ 전송 실패: {status.get('error', 'Unknown error')}")
                    break
                    
            else:
                print(f"❌ 전송 상태 조회 실패: {response.status_code}")
                
        except Exception as e:
            print(f"❌ 전송 상태 모니터링 오류: {e}")
            
        time.sleep(3)  # 3초마다 상태 확인
    
    else:
        print("⚠️ 모니터링 시간 초과")

def list_transfers():
    """전송 목록 조회"""
    try:
        response = requests.get(f"{SERVER_URL}/api/transfers")
        if response.status_code == 200:
            transfers = response.json()
            print(f"\n현재 전송 목록 ({transfers['total']}개):")
            print("=" * 70)
            
            for transfer in transfers['transfers']:
                print(f"전송 ID: {transfer['transferId']}")
                print(f"다운로드 ID: {transfer['downloadId']}")
                print(f"상태: {transfer['status']}")
                print(f"진행률: {transfer['progress']}%")
                print(f"대상 경로: {transfer['targetPath']}")
                print(f"시작 시간: {transfer['startTime']}")
                print("-" * 50)
                
        else:
            print(f"❌ 전송 목록 조회 실패: {response.status_code}")
            
    except Exception as e:
        print(f"❌ 전송 목록 조회 오류: {e}")

def main():
    print("HuggingFace Model Downloader Server 테스트")
    print("=" * 50)
    
    if len(sys.argv) > 1:
        global SERVER_URL
        SERVER_URL = sys.argv[1]
        print(f"서버 URL: {SERVER_URL}")
    
    # 1. 헬스 체크
    if not test_health():
        print("서버가 실행되지 않고 있습니다. 먼저 서버를 시작해주세요.")
        return
    
    print("\n" + "=" * 50)
    
    while True:
        print("\n테스트 옵션:")
        print("1. 다운로드 테스트")
        print("2. 다운로드 목록 조회")
        print("3. 전송 테스트")
        print("4. 전송 목록 조회")
        print("5. 헬스 체크")
        print("6. 종료")
        
        choice = input("\n선택하세요 (1-6): ").strip()
        
        if choice == '1':
            test_download()
        elif choice == '2':
            list_downloads()
        elif choice == '3':
            test_transfer()
        elif choice == '4':
            list_transfers()
        elif choice == '5':
            test_health()
        elif choice == '6':
            print("테스트를 종료합니다.")
            break
        else:
            print("잘못된 선택입니다.")

if __name__ == "__main__":
    main()