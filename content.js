// Content script for HuggingFace Model Downloader Extension
// Detects HuggingFace repository pages and extracts model information

class HuggingFaceDetector {
    constructor() {
        this.repoInfo = null;
        this.init();
    }

    init() {
        // Debug logging
        console.log('HuggingFace Detector: Initializing on URL:', window.location.href);

        // Check if we're on a HuggingFace repository page
        if (this.isHuggingFaceRepo()) {
            console.log('HuggingFace Detector: Repository detected');
            this.extractRepoInfo();
            this.addDownloadButton();
            this.setupMessageListener();
        } else {
            console.log('HuggingFace Detector: Not a repository page');
        }
    }

    isHuggingFaceRepo() {
        const url = window.location.href;
        // Match pattern: https://huggingface.co/{author}/{repo_name}[/{...path}]
        const pattern = /^https:\/\/huggingface\.co\/([^\/]+)\/([^\/]+)/;
        const isMatch = pattern.test(url);

        console.log('HuggingFace Detector: URL check:', {
            url: url,
            pattern: pattern.toString(),
            match: isMatch
        });

        return isMatch;
    }

    extractRepoInfo() {
        const url = window.location.href;
        const pattern = /^https:\/\/huggingface\.co\/([^\/]+)\/([^\/]+)/;
        const match = url.match(pattern);

        console.log('HuggingFace Detector: Extracting repo info:', {
            url: url,
            match: match
        });

        if (match) {
            this.repoInfo = {
                author: match[1],
                repo_name: match[2],
                url: `https://huggingface.co/${match[1]}/${match[2]}`
            };

            console.log('HuggingFace Detector: Repo info extracted:', this.repoInfo);

            // Store repo info for popup access
            chrome.storage.local.set({
                currentRepo: this.repoInfo,
                isHuggingFaceRepo: true
            });
        }
    }

    addDownloadButton() {
        // Wait for page to fully load
        setTimeout(() => {
            this.insertDownloadButton();
            this.checkForOngoingDownload();
        }, 1000);
    }

    insertDownloadButton() {
        // Find a suitable location to insert the download button
        const headerSection = document.querySelector('header') ||
                             document.querySelector('.repo-header') ||
                             document.querySelector('h1') ||
                             document.querySelector('.space-y-2');

        if (headerSection && !document.getElementById('hf-downloader-btn')) {
            const buttonContainer = document.createElement('div');
            buttonContainer.id = 'hf-downloader-container';
            buttonContainer.style.cssText = `
                margin: 10px 0;
                padding: 10px;
                background: #f8f9fa;
                border: 1px solid #e9ecef;
                border-radius: 8px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            `;

            const button = document.createElement('button');
            button.id = 'hf-downloader-btn';
            button.innerHTML = `
                🤗 Download to Supercomputer
            `;
            button.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 8px;
                padding: 8px 16px;
                background: #007bff;
                color: white;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
                transition: background-color 0.2s;
            `;

            button.addEventListener('mouseover', () => {
                button.style.background = '#0056b3';
            });

            button.addEventListener('mouseout', () => {
                button.style.background = '#007bff';
            });

            button.addEventListener('click', () => {
                console.log('HuggingFace Detector: Download button clicked');
                this.initiateDownload();
            });

            const infoText = document.createElement('div');
            infoText.style.cssText = `
                margin-top: 8px;
                font-size: 12px;
                color: #6c757d;
            `;
            infoText.textContent = `Repository: ${this.repoInfo.author}/${this.repoInfo.repo_name}`;

            buttonContainer.appendChild(button);
            buttonContainer.appendChild(infoText);

            // Insert after header or at the beginning of the main content
            if (headerSection.tagName === 'HEADER' || headerSection.tagName === 'H1') {
                headerSection.insertAdjacentElement('afterend', buttonContainer);
            } else {
                headerSection.insertAdjacentElement('beforebegin', buttonContainer);
            }
        }
    }

    async initiateDownload() {
        const button = document.getElementById('hf-downloader-btn');
        if (!button || !this.repoInfo) return;

        // Update button state
        const originalContent = button.innerHTML;
        button.innerHTML = `
            ⚡ Initializing...
        `;
        button.disabled = true;
        button.style.background = '#28a745';

        try {
            console.log('HuggingFace Detector: Sending download request to background script:', this.repoInfo);

            // Start download (async)
            chrome.runtime.sendMessage({
                action: 'download',
                data: this.repoInfo
            });

            // Start progress polling
            await this.pollProgress(button, originalContent);

        } catch (error) {
            console.error('Download error:', error);
            this.showError(button, originalContent, error.message);
        }
    }

    async pollProgress(button, originalContent) {
        const pollInterval = 1000; // Poll every 1 second
        let pollCount = 0;
        const maxPolls = 300; // Max 5 minutes

        const poll = async () => {
            try {
                const response = await fetch(`http://localhost:8000/progress/${this.repoInfo.author}/${this.repoInfo.repo_name}`);
                const progress = await response.json();

                if (progress.status === 'not_found' && pollCount < 3) {
                    // Still initializing, continue polling
                    pollCount++;
                    setTimeout(poll, pollInterval);
                    return;
                }

                if (progress.status === 'cloning') {
                    button.innerHTML = `
                        📥 Downloading... ${progress.progress}%
                    `;
                    button.style.background = '#ffc107';
                    setTimeout(poll, pollInterval);
                } else if (progress.status === 'transferring') {
                    button.innerHTML = `
                        🚀 Transferring to server...
                    `;
                    button.style.background = '#17a2b8';
                    setTimeout(poll, pollInterval);
                } else if (progress.status === 'transfer_complete' || progress.status === 'exists') {
                    button.innerHTML = `
                        ✅ ${progress.status === 'exists' ? 'Already Downloaded!' : 'Download Complete!'}
                    `;
                    button.style.background = '#28a745';

                    setTimeout(() => {
                        button.innerHTML = originalContent;
                        button.disabled = false;
                        button.style.background = '#007bff';
                    }, 3000);
                } else if (progress.status === 'error') {
                    this.showError(button, originalContent, progress.message);
                } else if (pollCount < maxPolls) {
                    // Continue polling
                    pollCount++;
                    setTimeout(poll, pollInterval);
                } else {
                    // Timeout
                    this.showError(button, originalContent, 'Download timeout');
                }
            } catch (error) {
                console.error('Progress polling error:', error);
                if (pollCount < maxPolls) {
                    pollCount++;
                    setTimeout(poll, pollInterval);
                } else {
                    this.showError(button, originalContent, 'Progress check failed');
                }
            }
        };

        // Start polling
        setTimeout(poll, 1000);
    }

    showError(button, originalContent, errorMessage) {
        button.innerHTML = `
            ❌ Download Failed
        `;
        button.style.background = '#dc3545';

        setTimeout(() => {
            button.innerHTML = originalContent;
            button.disabled = false;
            button.style.background = '#007bff';
        }, 3000);
    }

    async checkForOngoingDownload() {
        if (!this.repoInfo) return;

        try {
            const response = await fetch(`http://localhost:8000/progress/${this.repoInfo.author}/${this.repoInfo.repo_name}`);
            const progress = await response.json();

            // If there's an active download, start polling immediately
            if (progress.status && progress.status !== 'not_found' &&
                progress.status !== 'transfer_complete' && progress.status !== 'error') {
                console.log('HuggingFace Detector: Found ongoing download, resuming progress display');

                const button = document.getElementById('hf-downloader-btn');
                if (button) {
                    const originalContent = button.innerHTML;
                    await this.pollProgress(button, originalContent);
                }
            }
        } catch (error) {
            console.log('HuggingFace Detector: No ongoing download found or server unavailable');
        }
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'getRepoInfo') {
                sendResponse({ repoInfo: this.repoInfo });
            }
            return true;
        });
    }
}

// Global flag to prevent multiple initializations
window.hfDetectorInitialized = false;

function initializeDetector() {
    if (window.hfDetectorInitialized) {
        console.log('HuggingFace Detector: Already initialized, skipping');
        return;
    }

    console.log('HuggingFace Detector: Initializing...');
    window.hfDetectorInitialized = true;
    window.hfDetector = new HuggingFaceDetector();
}

// Initialize immediately if DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDetector);
} else {
    initializeDetector();
}

// Handle navigation changes (for SPAs like HuggingFace)
let lastUrl = location.href;
const urlObserver = new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        console.log('HuggingFace Detector: URL changed from', lastUrl, 'to', url);
        lastUrl = url;

        // Reset initialization flag and reinitialize
        window.hfDetectorInitialized = false;

        // Wait for page to load, then reinitialize
        setTimeout(() => {
            initializeDetector();
        }, 2000);
    }
});

// Observe the entire document for changes
urlObserver.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['href']
});

// Also listen for browser navigation events
window.addEventListener('popstate', () => {
    console.log('HuggingFace Detector: Popstate event');
    window.hfDetectorInitialized = false;
    setTimeout(initializeDetector, 1000);
});

// Listen for pushstate/replacestate (common in SPAs)
const originalPushState = history.pushState;
const originalReplaceState = history.replaceState;

history.pushState = function() {
    originalPushState.apply(history, arguments);
    console.log('HuggingFace Detector: pushState called');
    window.hfDetectorInitialized = false;
    setTimeout(initializeDetector, 1000);
};

history.replaceState = function() {
    originalReplaceState.apply(history, arguments);
    console.log('HuggingFace Detector: replaceState called');
    window.hfDetectorInitialized = false;
    setTimeout(initializeDetector, 1000);
};