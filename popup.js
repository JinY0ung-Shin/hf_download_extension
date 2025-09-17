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
    const fileCount = model.files ? model.files.length : 0;
    const modelFiles = model.files ? model.files.filter(f => f.type === 'model').length : 0;
    
    return `
      <div class="repo-info">
        <div class="repo-name">${model.fullName}</div>
        <div class="repo-url">${model.url}</div>
        <div style="margin-top: 8px; font-size: 12px; color: #666;">
          ${model.repoType || 'model'} • ${fileCount}개 파일 • 모델 파일 ${modelFiles}개
        </div>
      </div>
      
      <div class="download-section">
        <button id="download-all" class="download-btn">
          📥 전체 다운로드
        </button>
        <button id="download-models-only" class="download-btn" style="background: #28a745;">
          🎯 모델 파일만 다운로드
        </button>
      </div>
      
      <div class="file-options" style="margin-top: 16px;">
        <details>
          <summary style="cursor: pointer; font-size: 13px; font-weight: 600; margin-bottom: 8px;">
            파일 선택 (${fileCount}개)
          </summary>
          <div class="file-list" style="max-height: 200px; overflow-y: auto;">
            ${this.renderFileList()}
          </div>
          <button id="download-selected" class="download-btn" style="margin-top: 8px; background: #6f42c1;">
            선택 파일 다운로드
          </button>
        </details>
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

  renderFileList() {
    if (!this.currentModel.files || this.currentModel.files.length === 0) {
      return '<div style="color: #666; font-size: 12px; text-align: center; padding: 16px;">파일 목록을 불러올 수 없습니다</div>';
    }

    return this.currentModel.files.map(file => `
      <div class="file-item" style="display: flex; align-items: center; padding: 4px 0; border-bottom: 1px solid #eee;">
        <input type="checkbox" id="file-${file.name}" value="${file.name}" style="margin-right: 8px;">
        <label for="file-${file.name}" style="flex: 1; font-size: 12px; cursor: pointer;">
          <span style="font-family: monospace;">${file.name}</span>
          <span style="color: #666; margin-left: 8px;">${file.size}</span>
          <span class="file-type-badge" style="background: ${this.getFileTypeBadgeColor(file.type)}; color: white; padding: 1px 4px; border-radius: 3px; font-size: 10px; margin-left: 4px;">
            ${file.type}
          </span>
        </label>
      </div>
    `).join('');
  }

  getFileTypeBadgeColor(type) {
    switch (type) {
      case 'model': return '#ff6b35';
      case 'config': return '#28a745';
      default: return '#6c757d';
    }
  }

  attachDownloadHandlers() {
    document.getElementById('download-all')?.addEventListener('click', () => {
      this.startDownload('all');
    });

    document.getElementById('download-models-only')?.addEventListener('click', () => {
      this.startDownload('models-only');
    });

    document.getElementById('download-selected')?.addEventListener('click', () => {
      this.startDownload('selected');
    });

    document.getElementById('transfer-to-closed')?.addEventListener('click', () => {
      this.startTransfer();
    });
  }

  async startDownload(type) {
    if (!this.currentModel) {
      this.showStatus('error', '모델 정보를 찾을 수 없습니다.');
      return;
    }

    let selectedFiles = [];
    
    switch (type) {
      case 'all':
        selectedFiles = this.currentModel.files || [];
        break;
      case 'models-only':
        selectedFiles = (this.currentModel.files || []).filter(f => f.type === 'model');
        break;
      case 'selected':
        const checkboxes = document.querySelectorAll('input[type="checkbox"]:checked');
        const selectedNames = Array.from(checkboxes).map(cb => cb.value);
        selectedFiles = (this.currentModel.files || []).filter(f => selectedNames.includes(f.name));
        break;
    }

    if (selectedFiles.length === 0) {
      this.showStatus('error', '다운로드할 파일이 없습니다.');
      return;
    }

    this.showStatus('info', `다운로드를 시작합니다... (${selectedFiles.length}개 파일)`);
    
    // Disable download buttons
    this.setDownloadButtonsEnabled(false);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'START_DOWNLOAD',
        data: {
          modelInfo: this.currentModel,
          selectedFiles: selectedFiles,
          options: {
            downloadType: type,
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
        this.showStatus('info', '다운로드가 시작되었습니다. 서버에서 처리 중입니다...');
        this.startProgressUpdates();
      } else {
        this.showStatus('error', `다운로드 실패: ${response.error}`);
        this.setDownloadButtonsEnabled(true);
      }
    } catch (error) {
      this.showStatus('error', `오류 발생: ${error.message}`);
      this.setDownloadButtonsEnabled(true);
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
    }, 2000);

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
    }, 3000);

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
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PopupManager();
});

// Refresh data when popup is opened
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden) {
    // Popup is being shown, refresh data
    const popup = new PopupManager();
  }
});