// Popup script for HuggingFace Model Downloader Extension

class PopupController {
    constructor() {
        this.repoInfo = null;
        this.serverOnline = false;
        this.downloadInProgress = false;
        this.init();
    }

    async init() {
        await this.checkServerStatus();
        await this.loadRepoInfo();
        this.setupEventListeners();
        this.updateUI();
        await this.checkForOngoingDownload();
    }

    async checkServerStatus() {
        try {
            const response = await fetch('http://localhost:8000/health');
            if (response.ok) {
                this.serverOnline = true;
                this.updateServerStatus('Server Online', 'online');
            } else {
                throw new Error('Server returned error status');
            }
        } catch (error) {
            this.serverOnline = false;
            this.updateServerStatus('Server Offline', 'offline');
            console.error('Server status check failed:', error);
        }
    }

    updateServerStatus(text, status) {
        const indicator = document.getElementById('server-indicator');
        const statusText = document.getElementById('server-status-text');

        indicator.className = `status-indicator ${status}`;
        statusText.textContent = text;
    }

    async loadRepoInfo() {
        try {
            // Get current tab info
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            // Check if we're on a HuggingFace page
            if (tab.url && tab.url.includes('huggingface.co')) {
                // Get repo info from content script
                const response = await chrome.tabs.sendMessage(tab.id, { action: 'getRepoInfo' });
                this.repoInfo = response?.repoInfo;
            }

            // Also check stored repo info
            const stored = await chrome.storage.local.get(['currentRepo', 'isHuggingFaceRepo']);
            if (stored.isHuggingFaceRepo && stored.currentRepo) {
                this.repoInfo = stored.currentRepo;
            }
        } catch (error) {
            console.log('Could not load repo info:', error);
        }
    }

    setupEventListeners() {
        const downloadBtn = document.getElementById('download-btn');
        downloadBtn.addEventListener('click', () => {
            this.initiateDownload();
        });
    }

    updateUI() {
        const repoInfoDiv = document.getElementById('repo-info');
        const noRepoDiv = document.getElementById('no-repo');
        const downloadBtn = document.getElementById('download-btn');

        if (this.repoInfo) {
            repoInfoDiv.classList.add('active');
            noRepoDiv.style.display = 'none';

            document.getElementById('repo-details').innerHTML = `
                <strong>Author:</strong> ${this.repoInfo.author}<br>
                <strong>Repository:</strong> ${this.repoInfo.repo_name}<br>
                <strong>URL:</strong> <a href="${this.repoInfo.url}" target="_blank" style="color: #007bff; text-decoration: none;">${this.repoInfo.url}</a>
            `;

            // Check if model already exists
            this.checkModelStatus();
        } else {
            repoInfoDiv.classList.remove('active');
            noRepoDiv.style.display = 'block';
        }

        // Update download button based on server status
        downloadBtn.disabled = !this.serverOnline || this.downloadInProgress;
        if (!this.serverOnline) {
            downloadBtn.textContent = 'Server Offline';
            downloadBtn.className = 'download-btn error';
        }
    }

    async checkModelStatus() {
        if (!this.repoInfo || !this.serverOnline) return;

        try {
            const response = await fetch(`http://localhost:8000/status/${this.repoInfo.author}/${this.repoInfo.repo_name}`);
            const data = await response.json();

            const downloadBtn = document.getElementById('download-btn');

            if (data.exists_on_supercomputer) {
                downloadBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20,6 9,17 4,12"/>
                    </svg>
                    Already Downloaded
                `;
                downloadBtn.className = 'download-btn success';
                downloadBtn.disabled = true;

                this.addLogEntry(`Model already exists at: ${data.path}`, 'success');
            }
        } catch (error) {
            console.error('Failed to check model status:', error);
        }
    }

    async initiateDownload() {
        if (!this.repoInfo || !this.serverOnline || this.downloadInProgress) return;

        this.downloadInProgress = true;
        const downloadBtn = document.getElementById('download-btn');
        const progressBar = document.getElementById('progress-bar');
        const logSection = document.getElementById('log-section');

        // Update UI
        downloadBtn.innerHTML = `
            <div class="spinner"></div>
            Initializing...
        `;
        downloadBtn.disabled = true;
        progressBar.style.display = 'block';
        logSection.style.display = 'block';

        this.addLogEntry('Starting download request...', 'info');
        this.updateProgress(5);

        try {
            // Start download (async)
            fetch('http://localhost:8000/download', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    author: this.repoInfo.author,
                    repo_name: this.repoInfo.repo_name,
                    url: this.repoInfo.url
                })
            });

            // Start progress polling
            await this.pollProgress(downloadBtn);

        } catch (error) {
            this.addLogEntry(`Error: ${error.message}`, 'error');
            this.showDownloadError(downloadBtn, error.message);
        }
    }

    async pollProgress(downloadBtn) {
        const pollInterval = 1000; // Poll every 1 second
        let pollCount = 0;
        const maxPolls = 300; // Max 5 minutes

        const poll = async () => {
            try {
                const response = await fetch(`http://localhost:8000/progress/${this.repoInfo.author}/${this.repoInfo.repo_name}`);
                const progress = await response.json();

                if (progress.status === 'not_found' && pollCount < 5) {
                    // Still initializing, continue polling
                    pollCount++;
                    this.addLogEntry('Initializing download...', 'info');
                    setTimeout(poll, pollInterval);
                    return;
                }

                if (progress.status === 'cloning') {
                    downloadBtn.innerHTML = `
                        <div class="spinner"></div>
                        Downloading... ${progress.progress}%
                    `;
                    this.updateProgress(progress.progress);
                    this.addLogEntry(`Git clone progress: ${progress.progress}%`, 'info');
                    setTimeout(poll, pollInterval);
                } else if (progress.status === 'clone_complete') {
                    downloadBtn.innerHTML = `
                        <div class="spinner"></div>
                        Preparing transfer...
                    `;
                    this.updateProgress(90);
                    this.addLogEntry('Git clone completed, preparing transfer...', 'info');
                    setTimeout(poll, pollInterval);
                } else if (progress.status === 'transferring') {
                    downloadBtn.innerHTML = `
                        <div class="spinner"></div>
                        Transferring to server...
                    `;
                    this.updateProgress(95);
                    this.addLogEntry('Transferring files to supercomputer...', 'info');
                    setTimeout(poll, pollInterval);
                } else if (progress.status === 'transfer_complete') {
                    this.updateProgress(100);
                    this.addLogEntry('Download completed successfully!', 'success');

                    downloadBtn.innerHTML = `
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20,6 9,17 4,12"/>
                        </svg>
                        Download Complete!
                    `;
                    downloadBtn.className = 'download-btn success';
                    this.downloadInProgress = false;
                } else if (progress.status === 'exists') {
                    this.updateProgress(100);
                    this.addLogEntry('Model already exists on supercomputer', 'success');

                    downloadBtn.innerHTML = `
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20,6 9,17 4,12"/>
                        </svg>
                        Already Downloaded
                    `;
                    downloadBtn.className = 'download-btn success';
                    this.downloadInProgress = false;
                } else if (progress.status === 'error') {
                    this.addLogEntry(`Error: ${progress.message}`, 'error');
                    this.showDownloadError(downloadBtn, progress.message);
                } else if (pollCount < maxPolls) {
                    // Continue polling
                    pollCount++;
                    setTimeout(poll, pollInterval);
                } else {
                    // Timeout
                    this.addLogEntry('Download timeout - please try again', 'error');
                    this.showDownloadError(downloadBtn, 'Download timeout');
                }
            } catch (error) {
                console.error('Progress polling error:', error);
                if (pollCount < maxPolls) {
                    pollCount++;
                    setTimeout(poll, pollInterval);
                } else {
                    this.addLogEntry('Progress check failed', 'error');
                    this.showDownloadError(downloadBtn, 'Progress check failed');
                }
            }
        };

        // Start polling
        setTimeout(poll, 1000);
    }

    showDownloadError(downloadBtn, errorMessage) {
        this.updateProgress(0);

        downloadBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" y1="9" x2="9" y2="15"/>
                <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            Download Failed
        `;
        downloadBtn.className = 'download-btn error';

        // Reset button after 3 seconds
        setTimeout(() => {
            downloadBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7,10 12,15 17,10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Download Model
            `;
            downloadBtn.className = 'download-btn';
            downloadBtn.disabled = false;
            this.downloadInProgress = false;
            document.getElementById('progress-bar').style.display = 'none';
        }, 3000);
    }

    async checkForOngoingDownload() {
        if (!this.repoInfo || !this.serverOnline) return;

        try {
            const response = await fetch(`http://localhost:8000/progress/${this.repoInfo.author}/${this.repoInfo.repo_name}`);
            const progress = await response.json();

            // If there's an active download, resume progress display
            if (progress.status && progress.status !== 'not_found' &&
                progress.status !== 'transfer_complete' && progress.status !== 'error') {
                console.log('Popup: Found ongoing download, resuming progress display');

                this.downloadInProgress = true;
                const downloadBtn = document.getElementById('download-btn');
                const progressBar = document.getElementById('progress-bar');
                const logSection = document.getElementById('log-section');

                progressBar.style.display = 'block';
                logSection.style.display = 'block';

                this.addLogEntry('Resuming ongoing download...', 'info');
                await this.pollProgress(downloadBtn);
            }
        } catch (error) {
            console.log('Popup: No ongoing download found or server unavailable');
        }
    }

    updateProgress(percent) {
        const progressFill = document.getElementById('progress-fill');
        progressFill.style.width = `${percent}%`;
    }

    addLogEntry(message, type = 'info') {
        const logSection = document.getElementById('log-section');
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${type}`;

        const timestamp = new Date().toLocaleTimeString();
        logEntry.textContent = `[${timestamp}] ${message}`;

        logSection.appendChild(logEntry);
        logSection.scrollTop = logSection.scrollHeight;
    }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new PopupController();
});