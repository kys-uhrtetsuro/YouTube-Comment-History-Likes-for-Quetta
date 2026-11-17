// YouTube Comment Viewer - Main Dashboard

class CommentViewer {
  constructor() {
    this.comments = [];
    this.isFetching = false;
    this.userName = 'You';

    // DOM Elements
    this.commentsList = document.getElementById('commentsList');
    this.totalComments = document.getElementById('totalComments');
    this.totalLikes = document.getElementById('totalLikes');
    this.sortSelect = document.getElementById('sortSelect');
    this.fetchLikesBtn = document.getElementById('fetchLikesBtn');
    this.fetchNewCommentsBtn = document.getElementById('fetchNewCommentsBtn');
    this.clearCommentsBtn = document.getElementById('clearCommentsBtn');
    this.likeFetchProgress = document.getElementById('likeFetchProgress');
    this.likeFetchStatus = document.getElementById('likeFetchStatus');
    this.likeFetchProgressBar = document.getElementById('likeFetchProgressBar');
    this.likeFetchCount = document.getElementById('likeFetchCount');
    this.cancelFetchBtn = document.getElementById('cancelFetchBtn');
    this.themeToggleBtn = document.getElementById('themeToggleBtn');
    this.apiKeyInput = document.getElementById('apiKeyInput');
    this.apiKeyStatus = document.getElementById('apiKeyStatus');

    this.init();
  }

  init() {
    this.bindEvents();
    this.initTheme();
    this.loadUser();
    this.loadComments();
    this.loadApiKeyStatus();
  }

  bindEvents() {
    this.sortSelect?.addEventListener('change', () => this.sortAndRender());
    this.fetchLikesBtn?.addEventListener('click', () => this.fetchLikes());
    this.fetchNewCommentsBtn?.addEventListener('click', () => this.fetchNewComments());
    this.clearCommentsBtn?.addEventListener('click', () => this.clearComments());
    this.cancelFetchBtn?.addEventListener('click', () => this.cancelFetch());
    this.themeToggleBtn?.addEventListener('click', () => this.toggleTheme());
    document.getElementById('saveApiKeyBtn')?.addEventListener('click', () => this.saveApiKey());
    document.getElementById('clearApiKeyBtn')?.addEventListener('click', () => this.clearApiKey());

    // Open scan page button
    document.getElementById('scanBtn')?.addEventListener('click', () => this.openScanPage());
    document.getElementById('retryBtn')?.addEventListener('click', () => this.openScanPage());

    // Listen for storage changes
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.comments) {
        this.comments = changes.comments.newValue || [];
        this.updateUI();
      }
    });
  }

  async loadApiKeyStatus() {
    const state = await chrome.storage.local.get(['youtubeApiKey']);
    if (this.apiKeyStatus) this.apiKeyStatus.textContent = state.youtubeApiKey
      ? 'API key saved on this device. Ready for public comment likes.'
      : 'No API key saved. Create one in Google Cloud, then Save / Test.';
    if (this.apiKeyInput) this.apiKeyInput.value = '';
  }

  async saveApiKey() {
    const key = (this.apiKeyInput?.value || '').trim();
    if (!key) { this.showToast('Enter an API key.'); return; }
    const button = document.getElementById('saveApiKeyBtn');
    if (button) button.disabled = true;
    if (this.apiKeyStatus) this.apiKeyStatus.textContent = 'Testing key against YouTube Data API...';
    try {
      const response = await new Promise(resolve => chrome.runtime.sendMessage({action: 'validateApiKey', key}, resolve));
      if (!response?.success) throw new Error(response?.error || 'API key validation failed');
      await chrome.storage.local.set({youtubeApiKey: key});
      if (this.apiKeyInput) this.apiKeyInput.value = '';
      if (this.apiKeyStatus) this.apiKeyStatus.textContent = 'API key verified and saved on this device.';
      this.showToast('API key saved.');
    } catch (e) {
      if (this.apiKeyStatus) this.apiKeyStatus.textContent = 'API key test failed: ' + (e.message || e);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async clearApiKey() {
    await chrome.storage.local.remove(['youtubeApiKey']);
    await this.loadApiKeyStatus();
    this.showToast('API key removed.');
  }

  async loadComments() {
    this.showLoading(true);

    try {
      const result = await chrome.storage.local.get(['comments']);
      this.comments = (result.comments || []).map(c => this.normalizeCommentIds(c));
      this.updateUI();
    } catch (err) {
      console.error('[Viewer] Load error:', err);
      this.showError('Failed to load comments');
    }

    this.showLoading(false);
  }

  normalizeCommentIds(comment) {
    if (comment.commentId) return comment;
    const url = comment.videoUrl || '';
    const extracted = this.extractCommentIdFromUrl(url);
    if (extracted) {
      return { ...comment, commentId: extracted };
    }
    return comment;
  }

  extractCommentIdFromUrl(url) {
    if (!url) return '';
    try {
      const urlObj = new URL(url);
      return urlObj.searchParams.get('lc') || urlObj.searchParams.get('comment_id') || '';
    } catch {
      const match = url.match(/[?&](?:lc|comment_id)=([^&]+)/);
      return match ? decodeURIComponent(match[1]) : '';
    }
  }

  async loadUser() {
    try {
      const cached = await chrome.storage.local.get(['ytUserName']);
      if (cached.ytUserName) {
        this.userName = cached.ytUserName;
        this.updateUI();
      }
      const response = await new Promise(resolve => {
        chrome.runtime.sendMessage({ action: 'getChannelInfo' }, resolve);
      });
      if (response?.success && response.userName) {
        this.userName = response.userName;
        await chrome.storage.local.set({ ytUserName: this.userName });
        this.updateUI();
      }
    } catch (err) {
      console.warn('[Viewer] Failed to load user name:', err);
    }
  }

  updateUI() {
    // Update stats
    this.totalComments.textContent = this.comments.length.toLocaleString();
    const likes = this.comments.reduce((sum, c) => sum + (c.likes || 0), 0);
    this.totalLikes.textContent = likes.toLocaleString();

    // Show appropriate screen
    if (this.comments.length === 0) {
      this.showEmptyState();
    } else {
      this.showComments();
      this.sortAndRender();
    }
  }

  showLoading(show) {
    document.getElementById('loadingScreen')?.classList.toggle('hidden', !show);
    document.getElementById('commentsScreen')?.classList.toggle('hidden', show);
  }

  showEmptyState() {
    document.getElementById('commentsScreen')?.classList.add('hidden');
    document.getElementById('authScreen')?.classList.remove('hidden');

    const authCard = document.querySelector('.auth-card');
    if (authCard) {
      authCard.innerHTML = `
        <div class="auth-icon">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/>
          </svg>
        </div>
        <h2>No comments yet</h2>
        <p>Scan your YouTube comment history to see your comments here.</p>
        <button id="scanBtn" class="btn btn-primary btn-large">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          </svg>
          Scan Comments
        </button>
      `;
    }
    document.getElementById('scanBtn')?.addEventListener('click', () => this.openScanPage());
  }

  initTheme() {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') {
      document.body.classList.toggle('theme-light', saved === 'light');
      document.body.classList.toggle('theme-dark', saved === 'dark');
      this.updateThemeButton(saved);
    } else {
      document.body.classList.remove('theme-dark');
      document.body.classList.add('theme-light');
      localStorage.setItem('theme', 'light');
      this.updateThemeButton('light');
    }
  }

  toggleTheme() {
    const isLight = document.body.classList.contains('theme-light');
    const next = isLight ? 'dark' : 'light';
    document.body.classList.toggle('theme-light', next === 'light');
    document.body.classList.toggle('theme-dark', next === 'dark');
    localStorage.setItem('theme', next);
    this.updateThemeButton(next);
  }

  updateThemeButton(mode) {
    if (!this.themeToggleBtn) return;
    const label = `Theme: ${mode[0].toUpperCase()}${mode.slice(1)}`;
    this.themeToggleBtn.textContent = label;
    this.themeToggleBtn.setAttribute('aria-pressed', mode === 'dark' ? 'true' : 'false');
  }

  showComments() {
    document.getElementById('authScreen')?.classList.add('hidden');
    document.getElementById('commentsScreen')?.classList.remove('hidden');
  }

  showError(msg) {
    document.getElementById('errorMessage').textContent = msg;
    document.getElementById('errorScreen')?.classList.remove('hidden');
  }

  openScanPage() {
    chrome.runtime.sendMessage({ action: 'openHistoryPage' });
  }

  sortAndRender() {
    const sort = this.sortSelect?.value || 'date-desc';

    const getDateValue = (c) => {
      if (c.publishedAt) {
        const t = Date.parse(c.publishedAt);
        if (!isNaN(t)) return t;
      }
      if (c.dateText) {
        const t = Date.parse(c.dateText);
        if (!isNaN(t)) return t;
      }
      return 0;
    };

    switch (sort) {
      case 'date-desc':
        this.comments.sort((a, b) => getDateValue(b) - getDateValue(a));
        break;
      case 'date-asc':
        this.comments.sort((a, b) => getDateValue(a) - getDateValue(b));
        break;
      case 'likes-desc':
        this.comments.sort((a, b) => (b.likes || 0) - (a.likes || 0));
        break;
      case 'likes-asc':
        this.comments.sort((a, b) => (a.likes || 0) - (b.likes || 0));
        break;
    }

    this.renderComments();
  }

  renderComments() {
    if (!this.commentsList) return;

    this.commentsList.innerHTML = this.comments.map(c => this.createCard(c)).join('');
  }

  createCard(comment) {
    const videoUrl = this.getVideoUrl(comment);
    const thumbnail = comment.videoId
      ? `https://img.youtube.com/vi/${comment.videoId}/mqdefault.jpg`
      : 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiA5Ij48cmVjdCBmaWxsPSIjMzMzIiB3aWR0aD0iMTYiIGhlaWdodD0iOSIvPjwvc3ZnPg==';
    const dateLabel = this.getDisplayDate(comment);
    const displayName = this.getDisplayName();
    const replyTarget = this.getReplyTargetName(comment);
    let metaLine = '';
    if (dateLabel) {
      if (comment.activityType === 'reply') {
        if (replyTarget) {
          metaLine = `${displayName} replied to ${replyTarget} on ${this.escapeHtml(dateLabel)}`;
        } else {
          metaLine = `${displayName} replied to a comment on ${this.escapeHtml(dateLabel)}`;
        }
      } else {
        metaLine = `${displayName} commented on ${this.escapeHtml(dateLabel)}`;
      }
    }
    return `
      <div class="comment-card">
        <div class="comment-header">
          <div class="comment-video-info">
            <a href="${videoUrl}" target="_blank" rel="noopener">
              <img class="video-thumbnail" src="${thumbnail}" alt="" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiA5Ij48cmVjdCBmaWxsPSIjMzMzIiB3aWR0aD0iMTYiIGhlaWdodD0iOSIvPjwvc3ZnPg=='">
            </a>
            <div class="video-details">
              <a href="${videoUrl}" target="_blank" rel="noopener" class="video-title">
                ${this.escapeHtml(comment.videoTitle || 'YouTube Video')}
              </a>
            </div>
          </div>
        </div>
        ${metaLine ? `<div class="comment-meta">${metaLine}</div>` : ''}
        <div class="comment-body">${this.formatText(comment.text || '')}</div>
        <div class="comment-footer">
          <div class="comment-stats">
            <div class="comment-stat likes">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/>
              </svg>
              <span>${comment.likeFetched ? (comment.likes || 0).toLocaleString() : "—"}</span>
            </div>
          </div>
          <a href="${videoUrl}" target="_blank" rel="noopener" class="btn btn-secondary">View on YouTube</a>
        </div>
      </div>
    `;
  }

  getVideoUrl(comment) {
    const base = comment.videoUrl || (comment.videoId ? `https://www.youtube.com/watch?v=${comment.videoId}` : '');
    if (!base) return '';
    if (!comment.commentId) return base;
    if (base.includes('lc=')) return base;
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}lc=${encodeURIComponent(comment.commentId)}`;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  formatText(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
      .replace(/\n/g, '<br>');
  }

  formatDateTime(value) {
    const t = Date.parse(value);
    if (isNaN(t)) return '';
    return new Date(t).toLocaleString(undefined, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  getDisplayDate(comment) {
    if (comment.publishedAt) {
      const formatted = this.formatDateTime(comment.publishedAt);
      if (formatted) return formatted;
    }
    if (comment.dateText) {
      const text = comment.dateText.trim();
      if (/^\d{1,2}:\d{2}(\s*(am|pm))?$/i.test(text)) return '';
      if (/^\d{1,2}:\d{2}(\s*:\d{2})?$/.test(text)) return '';
      const formatted = this.formatDateTime(text);
      if (formatted) return formatted;
      return text.replace(/(\d{1,2}:\d{2}):\d{2}/, '$1');
    }
    return '';
  }

  getDisplayName() {
    if (this.userName.startsWith('@')) return this.escapeHtml(this.userName);
    return this.escapeHtml(`@${this.userName}`);
  }

  getReplyTargetName(comment) {
    const raw = (comment.replyToName || '').trim();
    if (!raw) return '';
    const lower = raw.toLowerCase();
    if (raw.length <= 1) return '';
    if (lower === 'a' || lower === 'comment' || lower === 'a comment') return '';
    if (lower.includes('comment')) return '';
    if (lower.startsWith('a ')) return '';
    if (raw.startsWith('@')) return this.escapeHtml(raw);
    return this.escapeHtml(`@${raw}`);
  }

  fetchNewComments() {
    chrome.runtime.sendMessage({ action: 'openHistoryPage' });
    this.showToast('Opening comment history for scan...');
  }

  async clearComments() {
    if (!confirm('Clear all comments? This cannot be undone.')) return;

    await chrome.storage.local.remove('comments');
    this.comments = [];
    this.updateUI();
    this.showToast('Comments cleared');
  }

  showToast(msg) {
    const toast = document.createElement('div');
    toast.textContent = msg;
    toast.style.cssText = `
      position: fixed; top: 20px; right: 20px; background: #4CAF50;
      color: white; padding: 12px 20px; border-radius: 4px; z-index: 10000;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  cancelFetch() {
    this.isFetching = false;
  }

  async fetchLikes() {
    if (this.isFetching || this.comments.length === 0) return;
    const savedKey = await chrome.storage.local.get(['youtubeApiKey']);
    if (!savedKey.youtubeApiKey) {
      this.showToast('Set a YouTube Data API key first.');
      this.apiKeyInput?.focus();
      return;
    }

    this.isFetching = true;

    // Get comments that need fetching
    const sixHours = 6 * 60 * 60 * 1000;
    const toFetch = this.comments.filter(c =>
      (c.videoId || c.commentId) && (!c.lastLikeUpdate || Date.now() - c.lastLikeUpdate > sixHours)
    );

    if (toFetch.length === 0) {
      this.showToast('All likes are up to date');
      this.isFetching = false;
      return;
    }

    // Show progress
    this.likeFetchProgress?.classList.remove('hidden');
    this.fetchLikesBtn.disabled = true;
    this.likeFetchStatus.textContent = 'Fetching likes...';
    this.likeFetchCount.textContent = `0 / ${toFetch.length}`;
    this.likeFetchProgressBar.style.width = '0%';

    // Group by video
    const byVideo = {};
    for (const c of toFetch) {
      const groupId = c.videoId || c.commentId;
      if (!byVideo[groupId]) byVideo[groupId] = [];
      byVideo[groupId].push(c);
    }

    let processed = 0;
    let updatedCount = 0;
    let fetchError = '';
    const videoIds = Object.keys(byVideo);

    for (let i = 0; i < videoIds.length && this.isFetching; i++) {
      const videoId = videoIds[i];
      const videoComments = byVideo[videoId];

      this.likeFetchStatus.textContent = `Fetching video ${i + 1} of ${videoIds.length}...`;

      try {
        const response = await new Promise(resolve => {
          chrome.runtime.sendMessage({
            action: 'fetchLikesForComments',
            comments: videoComments
          }, resolve);
        });

        if (!response?.success) throw new Error(response?.error || 'No response from service worker');
        if (response.comments) {
          for (const updatedComment of response.comments) {
            let idx = -1;
            if (updatedComment.commentId) {
              idx = this.comments.findIndex(c => c.commentId === updatedComment.commentId);
            }
            if (idx === -1) {
              idx = this.comments.findIndex(c =>
                c.text === updatedComment.text && c.videoId === updatedComment.videoId
              );
            }
            if (idx !== -1) {
              this.comments[idx] = { ...this.comments[idx], ...updatedComment };
              if (updatedComment.likeFetched) updatedCount++;
            }
          }
        }
      } catch (err) {
        console.error('[Viewer] Fetch error:', err);
        fetchError = err.message || String(err);
        this.isFetching = false;
        break;
      }

      processed += videoComments.length;
      this.likeFetchCount.textContent = `${processed} / ${toFetch.length}`;
      this.likeFetchProgressBar.style.width = `${(processed / toFetch.length) * 100}%`;

      // Save periodically (less frequent to speed up)
      if (i % 20 === 0) {
        await chrome.storage.local.set({ comments: this.comments });
      }

      await new Promise(r => setTimeout(r, 50));
    }

    // Save final
    await chrome.storage.local.set({ comments: this.comments });
    this.updateUI();

    // Reset UI
    this.likeFetchProgress?.classList.toggle('hidden', !fetchError);
    this.fetchLikesBtn.disabled = false;
    this.likeFetchStatus.textContent = fetchError ? ('Fetch failed: ' + fetchError) : (this.isFetching ? 'Done!' : 'Cancelled');
    if (!fetchError && this.isFetching) {
      this.showToast('Likes retrieved: ' + updatedCount + ' / ' + processed + '. Unavailable comments skipped.');
    }
    this.isFetching = false;
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => new CommentViewer());
