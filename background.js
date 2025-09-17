// Background script for handling API calls and download management

class DownloadManager {
  constructor() {
    this.downloads = new Map();
    this.transfers = new Map();
    this.setupMessageHandlers();
    this.setupStorageDefaults();
  }

  setupStorageDefaults() {
    chrome.storage.local.get(['serverConfig'], (result) => {
      if (!result.serverConfig) {
        chrome.storage.local.set({
          serverConfig: {
            ip: '75.12.8.195',
            port: '8080',
            endpoint: '/api/download'
          }
        });
      }
    });
  }

  setupMessageHandlers() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      switch (message.type) {
        case 'MODEL_INFO_UPDATED':
          this.handleModelInfoUpdate(message.data);
          break;
        case 'START_DOWNLOAD':
          this.startDownload(message.data, sendResponse);
          return true; // Keep message channel open for async response
        case 'GET_DOWNLOAD_STATUS':
          this.getDownloadStatus(message.downloadId, sendResponse);
          return true;
        case 'CANCEL_DOWNLOAD':
          this.cancelDownload(message.downloadId, sendResponse);
          return true;
        case 'START_TRANSFER':
          this.startTransfer(message.data, sendResponse);
          return true;
        case 'GET_TRANSFER_STATUS':
          this.getTransferStatus(message.transferId, sendResponse);
          return true;
        case 'CANCEL_TRANSFER':
          this.cancelTransfer(message.transferId, sendResponse);
          return true;
      }
    });
  }

  handleModelInfoUpdate(modelInfo) {
    console.log('Model info updated:', modelInfo);
    // Update badge to show extension is active on HuggingFace page
    chrome.action.setBadgeText({ text: '✓' });
    chrome.action.setBadgeBackgroundColor({ color: '#ff6b35' });
  }

  async startDownload(downloadRequest, sendResponse) {
    try {
      const downloadId = this.generateDownloadId();
      const { modelInfo, options } = downloadRequest;
      
      // Get server configuration
      const result = await chrome.storage.local.get(['serverConfig']);
      const serverConfig = result.serverConfig || {
        ip: '75.12.8.195',
        port: '8080',
        endpoint: '/api/download'
      };

      // Create download entry
      this.downloads.set(downloadId, {
        id: downloadId,
        modelInfo,
        options,
        status: 'initiating',
        progress: 0,
        startTime: Date.now(),
        error: null
      });

      // Send request to download server
      const serverUrl = `http://${serverConfig.ip}:${serverConfig.port}${serverConfig.endpoint}`;
      
      const requestPayload = {
        downloadId,
        repository: modelInfo.fullName,
        branch: modelInfo.branch || 'main',
        repoType: modelInfo.repoType || 'model',
        options: {
          includeGitHistory: options?.includeGitHistory || false,
          ...options
        }
      };

      console.log('Sending download request:', requestPayload);

      const response = await fetch(serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestPayload)
      });

      if (!response.ok) {
        throw new Error(`Server responded with status: ${response.status}`);
      }

      const responseData = await response.json();
      
      // Update download status
      this.downloads.set(downloadId, {
        ...this.downloads.get(downloadId),
        status: 'started',
        serverResponse: responseData
      });

      // Start polling for status updates
      this.startStatusPolling(downloadId, serverConfig);

      sendResponse({
        success: true,
        downloadId,
        message: 'Download initiated successfully'
      });

    } catch (error) {
      console.error('Download initiation failed:', error);
      
      if (downloadId && this.downloads.has(downloadId)) {
        this.downloads.set(downloadId, {
          ...this.downloads.get(downloadId),
          status: 'failed',
          error: error.message
        });
      }

      sendResponse({
        success: false,
        error: error.message
      });
    }
  }

  startStatusPolling(downloadId, serverConfig) {
    const pollInterval = setInterval(async () => {
      try {
        const statusUrl = `http://${serverConfig.ip}:${serverConfig.port}/api/status/${downloadId}`;
        const response = await fetch(statusUrl);
        
        if (response.ok) {
          const statusData = await response.json();
          const currentDownload = this.downloads.get(downloadId);
          
          if (currentDownload) {
            this.downloads.set(downloadId, {
              ...currentDownload,
              status: statusData.status,
              progress: statusData.progress || 0,
              currentFile: statusData.currentFile,
              totalFiles: statusData.totalFiles,
              downloadedSize: statusData.downloadedSize,
              totalSize: statusData.totalSize,
              error: statusData.error
            });

            // Send status update to popup if open
            chrome.runtime.sendMessage({
              type: 'DOWNLOAD_STATUS_UPDATE',
              downloadId,
              status: statusData
            });

            // Stop polling if download is complete or failed
            if (statusData.status === 'completed' || statusData.status === 'failed') {
              clearInterval(pollInterval);
              
              // Update badge
              if (statusData.status === 'completed') {
                chrome.action.setBadgeText({ text: '✓' });
                chrome.action.setBadgeBackgroundColor({ color: '#28a745' });
              } else {
                chrome.action.setBadgeText({ text: '✗' });
                chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
              }
            }
          }
        }
      } catch (error) {
        console.error('Status polling error:', error);
      }
    }, 1000); // Poll every 1 second for real-time updates

    // Stop polling after 1 hour to prevent infinite polling
    setTimeout(() => {
      clearInterval(pollInterval);
    }, 3600000);
  }

  getDownloadStatus(downloadId, sendResponse) {
    const download = this.downloads.get(downloadId);
    sendResponse({
      success: true,
      status: download || null
    });
  }

  async cancelDownload(downloadId, sendResponse) {
    try {
      const result = await chrome.storage.local.get(['serverConfig']);
      const serverConfig = result.serverConfig || {
        ip: '75.12.8.195',
        port: '8080'
      };

      const cancelUrl = `http://${serverConfig.ip}:${serverConfig.port}/api/cancel/${downloadId}`;
      const response = await fetch(cancelUrl, { method: 'POST' });

      if (response.ok) {
        const download = this.downloads.get(downloadId);
        if (download) {
          this.downloads.set(downloadId, {
            ...download,
            status: 'cancelled'
          });
        }

        sendResponse({
          success: true,
          message: 'Download cancelled successfully'
        });
      } else {
        throw new Error(`Failed to cancel download: ${response.status}`);
      }
    } catch (error) {
      console.error('Cancel download error:', error);
      sendResponse({
        success: false,
        error: error.message
      });
    }
  }

  async startTransfer(transferRequest, sendResponse) {
    try {
      const { downloadId, targetPath } = transferRequest;
      
      if (!downloadId) {
        sendResponse({
          success: false,
          error: 'Download ID is required'
        });
        return;
      }

      // Get server configuration
      const result = await chrome.storage.local.get(['serverConfig']);
      const serverConfig = result.serverConfig || {
        ip: '75.12.8.195',
        port: '8080',
        endpoint: '/api/transfer'
      };

      const serverUrl = `http://${serverConfig.ip}:${serverConfig.port}/api/transfer`;
      
      const requestPayload = {
        downloadId,
        targetPath: targetPath || '/opt/models/'
      };

      console.log('Sending transfer request:', requestPayload);

      const response = await fetch(serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestPayload)
      });

      if (!response.ok) {
        throw new Error(`Server responded with status: ${response.status}`);
      }

      const responseData = await response.json();
      const transferId = responseData.transferId;
      
      // Store transfer info
      this.transfers.set(transferId, {
        id: transferId,
        downloadId,
        status: 'started',
        progress: 0,
        startTime: Date.now(),
        error: null
      });

      // Start polling for transfer status updates
      this.startTransferStatusPolling(transferId, serverConfig);

      sendResponse({
        success: true,
        transferId,
        message: 'Transfer initiated successfully'
      });

    } catch (error) {
      console.error('Transfer initiation failed:', error);
      sendResponse({
        success: false,
        error: error.message
      });
    }
  }

  startTransferStatusPolling(transferId, serverConfig) {
    const pollInterval = setInterval(async () => {
      try {
        const statusUrl = `http://${serverConfig.ip}:${serverConfig.port}/api/transfer/status/${transferId}`;
        const response = await fetch(statusUrl);
        
        if (response.ok) {
          const statusData = await response.json();
          const currentTransfer = this.transfers.get(transferId);
          
          if (currentTransfer) {
            this.transfers.set(transferId, {
              ...currentTransfer,
              status: statusData.status,
              progress: statusData.progress || 0,
              currentFile: statusData.currentFile,
              totalFiles: statusData.totalFiles,
              transferredSize: statusData.transferredSize,
              totalSize: statusData.totalSize,
              error: statusData.error
            });

            // Send status update to popup if open
            chrome.runtime.sendMessage({
              type: 'TRANSFER_STATUS_UPDATE',
              transferId,
              status: statusData
            });

            // Stop polling if transfer is complete or failed
            if (statusData.status === 'completed' || statusData.status === 'failed') {
              clearInterval(pollInterval);
              
              // Update badge
              if (statusData.status === 'completed') {
                chrome.action.setBadgeText({ text: '✓' });
                chrome.action.setBadgeBackgroundColor({ color: '#28a745' });
              } else {
                chrome.action.setBadgeText({ text: '✗' });
                chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
              }
            }
          }
        }
      } catch (error) {
        console.error('Transfer status polling error:', error);
      }
    }, 1500); // Poll every 1.5 seconds for real-time transfer updates

    // Stop polling after 2 hours
    setTimeout(() => {
      clearInterval(pollInterval);
    }, 7200000);
  }

  getTransferStatus(transferId, sendResponse) {
    const transfer = this.transfers.get(transferId);
    sendResponse({
      success: true,
      status: transfer || null
    });
  }

  async cancelTransfer(transferId, sendResponse) {
    try {
      const result = await chrome.storage.local.get(['serverConfig']);
      const serverConfig = result.serverConfig || {
        ip: '75.12.8.195',
        port: '8080'
      };

      const cancelUrl = `http://${serverConfig.ip}:${serverConfig.port}/api/transfer/cancel/${transferId}`;
      const response = await fetch(cancelUrl, { method: 'POST' });

      if (response.ok) {
        const transfer = this.transfers.get(transferId);
        if (transfer) {
          this.transfers.set(transferId, {
            ...transfer,
            status: 'cancelled'
          });
        }

        sendResponse({
          success: true,
          message: 'Transfer cancelled successfully'
        });
      } else {
        throw new Error(`Failed to cancel transfer: ${response.status}`);
      }
    } catch (error) {
      console.error('Cancel transfer error:', error);
      sendResponse({
        success: false,
        error: error.message
      });
    }
  }

  generateDownloadId() {
    return `download_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}

// Initialize download manager
const downloadManager = new DownloadManager();

// Clear badge when extension starts
chrome.action.setBadgeText({ text: '' });