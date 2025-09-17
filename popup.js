// Popup script for the HuggingFace Model Downloader extension

class PopupManager {
  constructor() {
    this.currentModel = null;
    this.currentDownload = null;
    this.currentTransfer = null;
    this.init();
  }

  async init() {
    await this.loadServerConfig();
    await this.loadCurrentModel();
    this.setupEventListeners();
    this.setupMessageListener();
    this.updateUI();
    await this.checkInitialServerStatus();
  }

  async loadServerConfig() {
    const result = await chrome.storage.local.get(['serverConfig']);
    const config = result.serverConfig || { ip: '75.12.8.195', port: '8080' };
    document.getElementById('server-ip').value = config.ip;
  }

  async loadCurrentModel() {
    const result = await chrome.storage.local.get(['currentModel']);
    this.currentModel = result.currentModel || null;
  }

  setupEventListeners() {
    // Server IP configuration
    document.getElementById('server-ip').addEventListener('change', (e) => {
      this.saveServerConfig(e.target.value);
    });

    // Listen for download status updates
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'DOWNLOAD_STATUS_UPDATE') {
        this.updateDownloadStatus(message.status);
      } else if (message.type === 'TRANSFER_STATUS_UPDATE') {
        this.updateTransferStatus(message.status);
      }
    });
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'DOWNLOAD_STATUS_UPDATE') {
        this.updateDownloadStatus(message.status);
      } else if (message.type === 'TRANSFER_STATUS_UPDATE') {
        this.updateTransferStatus(message.status);
      }
    });
  }

  async saveServerConfig(ip) {
    await chrome.storage.local.set({
      serverConfig: { ip, port: '8080', endpoint: '/api/download' }
    });
    
    // IP 변경 후 서버 상태 다시 확인
    console.log(`Server IP changed to: ${ip}`);
    await this.checkInitialServerStatus();
  }

  updateUI() {
    const contentDiv = document.getElementById('content');
    
    if (!this.currentModel) {
      contentDiv.innerHTML = `
        <div class="no-repo">
          HuggingFace 모델 페이지에서 이 확장을 사용하세요.
          <br><br>
          <small>현재 페이지가 HuggingFace 모델 페이지인지 확인해주세요.</small>
        </div>
      `;
      return;
    }

    contentDiv.innerHTML = this.renderModelInfo();
    this.attachDownloadHandlers();
  }

  renderModelInfo() {
    const model = this.currentModel;
    
    return `
      <div class="repo-info">
        <div class="repo-name">${model.fullName}</div>
        <div class="repo-url">${model.url}</div>
        <div style="margin-top: 8px; font-size: 12px; color: #666;">
          ${model.repoType || 'model'} • ${model.branch || 'main'} 브랜치
        </div>
      </div>
      
      <div class="download-section">
        <button id="download-repo" class="download-btn">
          📥 레포지토리 다운로드
        </button>
        <div style="margin-top: 8px; font-size: 12px; color: #666; text-align: center;">
          Git clone으로 전체 레포지토리를 다운로드합니다
        </div>
        <div id="server-status" style="margin-top: 8px; font-size: 11px; text-align: center;"></div>
      </div>
      
      <div id="download-status"></div>
      <div id="transfer-section" style="display: none; margin-top: 16px; border-top: 1px solid #e5e5e5; padding-top: 16px;">
        <button id="transfer-to-closed" class="download-btn" style="background: #17a2b8;">
          🚀 폐쇄망으로 전송
        </button>
        <div id="transfer-status"></div>
      </div>
    `;
  }


  attachDownloadHandlers() {
    document.getElementById('download-repo')?.addEventListener('click', () => {
      this.startDownload();
    });

    document.getElementById('transfer-to-closed')?.addEventListener('click', () => {
      this.startTransfer();
    });
  }

  async startDownload() {
    if (!this.currentModel) {
      this.showStatus('error', '모델 정보를 찾을 수 없습니다.');
      return;
    }

    // 서버 연결 확인
    this.showStatus('info', '서버 연결을 확인하는 중...');
    const serverAvailable = await this.checkServerConnection();
    
    if (!serverAvailable) {
      this.showStatus('error', '❌ 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해주세요.');
      return;
    }

    this.showStatus('info', `${this.currentModel.fullName} 다운로드를 시작합니다...`);
    
    // Disable download buttons
    this.setDownloadButtonsEnabled(false);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'START_DOWNLOAD',
        data: {
          modelInfo: this.currentModel,
          options: {
            includeGitHistory: false
          }
        }
      });

      if (response.success) {
        this.currentDownload = {
          id: response.downloadId,
          status: 'started',
          progress: 0
        };
        this.showStatus('info', '다운로드가 시작되었습니다. 서버에서 Git clone 진행 중입니다...');
        this.startProgressUpdates();
      } else {
        let errorMsg = response.error || '알 수 없는 오류';
        if (errorMsg.includes('fetch')) {
          errorMsg = '서버 연결 실패. 네트워크 상태를 확인해주세요.';
        } else if (errorMsg.includes('timeout')) {
          errorMsg = '서버 응답 시간 초과. 잠시 후 다시 시도해주세요.';
        }
        this.showStatus('error', `다운로드 실패: ${errorMsg}`);
        this.setDownloadButtonsEnabled(true);
      }
    } catch (error) {
      let errorMsg = error.message;
      if (errorMsg.includes('fetch')) {
        errorMsg = '서버 연결 실패. 서버가 실행 중인지 확인해주세요.';
      }
      this.showStatus('error', `오류 발생: ${errorMsg}`);
      this.setDownloadButtonsEnabled(true);
    }
  }

  async checkServerConnection() {
    try {
      const result = await chrome.storage.local.get(['serverConfig']);
      const serverConfig = result.serverConfig || { ip: '75.12.8.195', port: '8080' };
      
      const response = await fetch(`http://${serverConfig.ip}:${serverConfig.port}/health`, {
        method: 'GET',
        timeout: 5000  // 5초 타임아웃
      });
      
      return response.ok;
    } catch (error) {
      console.log('Server connection check failed:', error);
      return false;
    }
  }

  startProgressUpdates() {
    const updateInterval = setInterval(async () => {
      if (!this.currentDownload) {
        clearInterval(updateInterval);
        return;
      }

      try {
        const response = await chrome.runtime.sendMessage({
          type: 'GET_DOWNLOAD_STATUS',
          downloadId: this.currentDownload.id
        });

        if (response.success && response.status) {
          this.updateDownloadStatus(response.status);
          
          if (response.status.status === 'completed' || response.status.status === 'failed') {
            clearInterval(updateInterval);
            this.setDownloadButtonsEnabled(true);
            
            // Show transfer section if download completed successfully
            if (response.status.status === 'completed') {
              this.showTransferSection();
            }
          }
        }
      } catch (error) {
        console.error('Status update error:', error);
      }
    }, 1000); // 1초마다 업데이트로 실시간성 향상

    // Stop updates after 1 hour
    setTimeout(() => {
      clearInterval(updateInterval);
      this.setDownloadButtonsEnabled(true);
    }, 3600000);
  }

  updateDownloadStatus(status) {
    const statusDiv = document.getElementById('download-status');
    if (!statusDiv) return;

    const progress = status.progress || 0;
    const currentFile = status.currentFile || '';
    const downloadedSize = status.downloadedSize || '';
    const totalSize = status.totalSize || '';

    let statusClass, statusText;
    
    switch (status.status) {
      case 'started':
      case 'downloading':
        statusClass = 'info';
        statusText = `다운로드 중... ${Math.round(progress)}%`;
        if (currentFile) statusText += `<br><small>현재: ${currentFile}</small>`;
        if (downloadedSize && totalSize) statusText += `<br><small>${downloadedSize} / ${totalSize}</small>`;
        break;
      case 'completed':
        statusClass = 'success';
        statusText = '✅ 다운로드 완료! 폐쇄망으로 복사 준비 완료.';
        break;
      case 'failed':
        statusClass = 'error';
        statusText = `❌ 다운로드 실패: ${status.error || '알 수 없는 오류'}`;
        break;
      default:
        statusClass = 'info';
        statusText = '상태 업데이트 중...';
    }

    statusDiv.innerHTML = `
      <div class="status ${statusClass}">
        ${statusText}
      </div>
      ${progress > 0 ? `
        <div class="progress">
          <div class="progress-bar" style="width: ${progress}%"></div>
        </div>
      ` : ''}
    `;
  }

  showStatus(type, message) {
    const statusDiv = document.getElementById('download-status');
    if (statusDiv) {
      statusDiv.innerHTML = `<div class="status ${type}">${message}</div>`;
    }
  }

  setDownloadButtonsEnabled(enabled) {
    const buttons = document.querySelectorAll('.download-btn');
    buttons.forEach(btn => {
      if (btn.id !== 'transfer-to-closed') { // 전송 버튼은 별도로 관리
        btn.disabled = !enabled;
      }
    });
  }

  showTransferSection() {
    const transferSection = document.getElementById('transfer-section');
    if (transferSection) {
      transferSection.style.display = 'block';
    }
  }

  async startTransfer() {
    if (!this.currentDownload || !this.currentDownload.id) {
      this.showTransferStatus('error', '전송할 다운로드가 없습니다.');
      return;
    }

    this.showTransferStatus('info', '폐쇄망 전송을 시작합니다...');
    
    // Disable transfer button
    this.setTransferButtonEnabled(false);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'START_TRANSFER',
        data: {
          downloadId: this.currentDownload.id,
          targetPath: '/opt/models/'
        }
      });

      if (response.success) {
        this.currentTransfer = {
          id: response.transferId,
          status: 'started',
          progress: 0
        };
        this.showTransferStatus('info', '폐쇄망 전송이 시작되었습니다.');
        this.startTransferProgressUpdates();
      } else {
        this.showTransferStatus('error', `전송 실패: ${response.error}`);
        this.setTransferButtonEnabled(true);
      }
    } catch (error) {
      this.showTransferStatus('error', `오류 발생: ${error.message}`);
      this.setTransferButtonEnabled(true);
    }
  }

  startTransferProgressUpdates() {
    const updateInterval = setInterval(async () => {
      if (!this.currentTransfer) {
        clearInterval(updateInterval);
        return;
      }

      try {
        const response = await chrome.runtime.sendMessage({
          type: 'GET_TRANSFER_STATUS',
          transferId: this.currentTransfer.id
        });

        if (response.success && response.status) {
          this.updateTransferStatus(response.status);
          
          if (response.status.status === 'completed' || response.status.status === 'failed') {
            clearInterval(updateInterval);
            this.setTransferButtonEnabled(true);
          }
        }
      } catch (error) {
        console.error('Transfer status update error:', error);
      }
    }, 1500); // 1.5초마다 업데이트로 전송 진행률 실시간 표시

    // Stop updates after 2 hours
    setTimeout(() => {
      clearInterval(updateInterval);
      this.setTransferButtonEnabled(true);
    }, 7200000);
  }

  updateTransferStatus(status) {
    const statusDiv = document.getElementById('transfer-status');
    if (!statusDiv) return;

    const progress = status.progress || 0;
    const currentFile = status.currentFile || '';
    const transferredSize = status.transferredSize || '';
    const totalSize = status.totalSize || '';

    let statusClass, statusText;
    
    switch (status.status) {
      case 'started':
      case 'transferring':
        statusClass = 'info';
        statusText = `폐쇄망 전송 중... ${Math.round(progress)}%`;
        if (currentFile) statusText += `<br><small>현재: ${currentFile}</small>`;
        if (transferredSize && totalSize) statusText += `<br><small>${transferredSize} / ${totalSize}</small>`;
        break;
      case 'completed':
        statusClass = 'success';
        statusText = '🎉 폐쇄망 전송 완료! 모델이 성공적으로 전송되었습니다.';
        break;
      case 'failed':
        statusClass = 'error';
        statusText = `❌ 전송 실패: ${status.error || '알 수 없는 오류'}`;
        break;
      default:
        statusClass = 'info';
        statusText = '전송 상태 업데이트 중...';
    }

    statusDiv.innerHTML = `
      <div class="status ${statusClass}">
        ${statusText}
      </div>
      ${progress > 0 ? `
        <div class="progress">
          <div class="progress-bar" style="width: ${progress}%"></div>
        </div>
      ` : ''}
    `;
  }

  showTransferStatus(type, message) {
    const statusDiv = document.getElementById('transfer-status');
    if (statusDiv) {
      statusDiv.innerHTML = `<div class="status ${type}">${message}</div>`;
    }
  }

  setTransferButtonEnabled(enabled) {
    const button = document.getElementById('transfer-to-closed');
    if (button) {
      button.disabled = !enabled;
    }
  }

  async checkInitialServerStatus() {
    const statusDiv = document.getElementById('server-status');
    if (!statusDiv) return;

    statusDiv.innerHTML = '<span style="color: #666;">🔄 서버 상태 확인 중...</span>';
    
    const isAvailable = await this.checkServerConnection();
    
    if (isAvailable) {
      statusDiv.innerHTML = '<span style="color: #28a745;">✅ 서버 연결됨</span>';
    } else {
      statusDiv.innerHTML = '<span style="color: #dc3545;">❌ 서버 연결 실패</span>';
      
      // 다운로드 버튼 비활성화
      this.setDownloadButtonsEnabled(false);
    }
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PopupManager();
});

// Refresh data when popup is opened
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden) {
    // Popup is being shown, refresh data
    new PopupManager();
  }
});