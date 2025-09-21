// Background script for HuggingFace Model Downloader Extension
// Handles communication between content script and popup

class BackgroundService {
    constructor() {
        console.log('BackgroundService: Initializing...');
        this.init();
    }

    init() {
        this.setupTabListeners();
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

}

// Initialize background service
console.log('Background script loaded, initializing service...');
new BackgroundService();
console.log('BackgroundService initialized.');
