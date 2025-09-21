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
