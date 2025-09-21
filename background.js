// Background script for HuggingFace Model Downloader Extension
// Handles communication between content script and popup

class BackgroundService {
    constructor() {
        console.log('BackgroundService: Initializing...');
        this.init();
    }

    init() {
        this.setupMessageListeners();
        this.setupTabListeners();
    }

    setupMessageListeners() {
        console.log('BackgroundService: Setting up message listeners...');
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            console.log('BackgroundService: Received message:', request);
            switch (request.action) {
                case 'download':
                    this.handleDownload(request.data, sendResponse);
                    return true; // Will respond asynchronously

                case 'checkServerStatus':
                    this.checkServerStatus(sendResponse);
                    return true; // Will respond asynchronously

                case 'getRepoInfo':
                    this.getRepoInfo(sendResponse);
                    return true; // Will respond asynchronously

                default:
                    sendResponse({ error: 'Unknown action' });
                    return false;
            }
        });
    }

    setupTabListeners() {
        // Update extension state when tab changes
        chrome.tabs.onActivated.addListener(async (activeInfo) => {
            await this.updateExtensionState(activeInfo.tabId);
        });

        chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
            if (changeInfo.status === 'complete') {
                await this.updateExtensionState(tabId);
            }
        });
    }

    async updateExtensionState(tabId) {
        try {
            const tab = await chrome.tabs.get(tabId);
            const isHuggingFace = this.isHuggingFaceUrl(tab.url);

            // Update storage
            await chrome.storage.local.set({
                isHuggingFaceRepo: isHuggingFace,
                currentTabId: tabId
            });

            // Update extension icon and badge
            if (isHuggingFace) {
                await chrome.action.setBadgeText({
                    text: '●',
                    tabId: tabId
                });
                await chrome.action.setBadgeBackgroundColor({
                    color: '#28a745',
                    tabId: tabId
                });
                await chrome.action.setTitle({
                    title: 'HuggingFace Model Downloader - Repository Detected',
                    tabId: tabId
                });
            } else {
                await chrome.action.setBadgeText({
                    text: '',
                    tabId: tabId
                });
                await chrome.action.setTitle({
                    title: 'HuggingFace Model Downloader',
                    tabId: tabId
                });
            }
        } catch (error) {
            console.error('Failed to update extension state:', error);
        }
    }

    isHuggingFaceUrl(url) {
        if (!url) return false;
        const pattern = /^https:\/\/huggingface\.co\/([^\/]+)\/([^\/]+)/;
        return pattern.test(url);
    }

    async handleDownload(repoData, sendResponse) {
        try {
            console.log('Starting download for:', repoData);

            // Validate repo data
            if (!repoData || !repoData.author || !repoData.repo_name) {
                throw new Error('Invalid repository data');
            }

            // Make request to download proxy server
            const response = await fetch('http://localhost:8000/download', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    author: repoData.author,
                    repo_name: repoData.repo_name,
                    url: repoData.url
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || 'Download request failed');
            }

            // Send success response
            sendResponse({
                success: true,
                data: data,
                message: data.message
            });

            // Show notification
            await this.showNotification(
                data.status === 'exists' ? 'Model Already Exists' : 'Download Complete',
                data.message,
                data.status === 'exists' ? 'info' : 'success'
            );

        } catch (error) {
            console.error('Download failed:', error);

            // Send error response
            sendResponse({
                success: false,
                error: error.message
            });

            // Show error notification
            await this.showNotification(
                'Download Failed',
                error.message,
                'error'
            );
        }
    }

    async checkServerStatus(sendResponse) {
        try {
            const response = await fetch('http://localhost:8000/health', {
                method: 'GET',
                timeout: 5000
            });

            const isOnline = response.ok;
            const data = isOnline ? await response.json() : null;

            sendResponse({
                online: isOnline,
                data: data
            });
        } catch (error) {
            sendResponse({
                online: false,
                error: error.message
            });
        }
    }

    async getRepoInfo(sendResponse) {
        try {
            const stored = await chrome.storage.local.get(['currentRepo', 'isHuggingFaceRepo']);
            sendResponse({
                repoInfo: stored.currentRepo,
                isHuggingFaceRepo: stored.isHuggingFaceRepo
            });
        } catch (error) {
            sendResponse({
                repoInfo: null,
                isHuggingFaceRepo: false,
                error: error.message
            });
        }
    }

    async showNotification(title, message, type = 'info') {
        try {
            const iconUrl = this.getIconForType(type);

            await chrome.notifications.create({
                type: 'basic',
                iconUrl: iconUrl,
                title: title,
                message: message,
                priority: type === 'error' ? 2 : 1
            });
        } catch (error) {
            console.error('Failed to show notification:', error);
        }
    }

    getIconForType(type) {
        // For now, use a default icon path
        // In a real implementation, you'd have different icons for different types
        return 'icons/icon48.png';
    }

    // Utility method to extract repo info from URL
    extractRepoFromUrl(url) {
        if (!url) return null;

        const pattern = /^https:\/\/huggingface\.co\/([^\/]+)\/([^\/]+)/;
        const match = url.match(pattern);

        if (match) {
            return {
                author: match[1],
                repo_name: match[2],
                url: `https://huggingface.co/${match[1]}/${match[2]}`
            };
        }

        return null;
    }
}

// Initialize background service
console.log('Background script loaded, initializing service...');
new BackgroundService();
console.log('BackgroundService initialized.');