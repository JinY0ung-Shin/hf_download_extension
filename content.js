// HuggingFace 페이지에서 모델 정보를 추출하는 content script

class HuggingFaceParser {
  constructor() {
    this.init();
  }

  init() {
    if (this.isModelPage()) {
      this.extractModelInfo();
    }
  }

  isModelPage() {
    const url = window.location.href;
    const modelPagePattern = /^https:\/\/huggingface\.co\/[^\/]+\/[^\/]+(?:\/.*)?$/;
    return modelPagePattern.test(url) && !url.includes('/discussions') && !url.includes('/community');
  }

  extractModelInfo() {
    const url = window.location.href;
    const pathParts = new URL(url).pathname.split('/').filter(part => part.length > 0);
    
    if (pathParts.length >= 2) {
      const author = pathParts[0];
      const modelName = pathParts[1];
      const fullModelName = `${author}/${modelName}`;
      
      const modelInfo = {
        author: author,
        name: modelName,
        fullName: fullModelName,
        url: url,
        repoType: this.getRepoType(),
        files: this.getFileList(),
        branch: this.getCurrentBranch(),
        description: this.getDescription()
      };

      // 모델 정보를 storage에 저장
      chrome.storage.local.set({ currentModel: modelInfo }, () => {
        console.log('Model info saved:', modelInfo);
      });

      // background script에 모델 정보 전송
      chrome.runtime.sendMessage({
        type: 'MODEL_INFO_UPDATED',
        data: modelInfo
      });
    }
  }

  getRepoType() {
    const breadcrumbs = document.querySelector('[data-testid="breadcrumbs"]');
    if (breadcrumbs) {
      const text = breadcrumbs.textContent.toLowerCase();
      if (text.includes('dataset')) return 'dataset';
      if (text.includes('space')) return 'space';
    }
    return 'model';
  }

  getCurrentBranch() {
    const branchSelector = document.querySelector('[data-testid="branch-selector"]');
    if (branchSelector) {
      const selectedBranch = branchSelector.querySelector('[aria-selected="true"]');
      if (selectedBranch) {
        return selectedBranch.textContent.trim();
      }
    }
    return 'main';
  }

  getDescription() {
    const descElement = document.querySelector('[data-testid="model-card-content"] p');
    return descElement ? descElement.textContent.trim() : '';
  }

  getFileList() {
    const files = [];
    const fileElements = document.querySelectorAll('[data-testid="file-item"]');
    
    fileElements.forEach(element => {
      const nameElement = element.querySelector('[data-testid="file-name"]');
      const sizeElement = element.querySelector('[data-testid="file-size"]');
      
      if (nameElement) {
        files.push({
          name: nameElement.textContent.trim(),
          size: sizeElement ? sizeElement.textContent.trim() : '',
          type: this.getFileType(nameElement.textContent.trim())
        });
      }
    });
    
    return files;
  }

  getFileType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const modelExts = ['bin', 'safetensors', 'ckpt', 'pth', 'pt', 'h5', 'pkl', 'onnx'];
    const configExts = ['json', 'yaml', 'yml', 'txt', 'md'];
    
    if (modelExts.includes(ext)) return 'model';
    if (configExts.includes(ext)) return 'config';
    return 'other';
  }
}

// URL 변경 감지를 위한 observer
let currentUrl = window.location.href;
const parser = new HuggingFaceParser();

// SPA 라우팅 감지
const observer = new MutationObserver(() => {
  if (window.location.href !== currentUrl) {
    currentUrl = window.location.href;
    setTimeout(() => {
      new HuggingFaceParser();
    }, 1000); // DOM 업데이트 대기
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});

// 페이지 로드 완료 후 파서 실행
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => new HuggingFaceParser(), 2000);
  });
} else {
  setTimeout(() => new HuggingFaceParser(), 2000);
}