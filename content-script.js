// Content script for YouTube Comment History Viewer
// Scans myactivity.google.com for YouTube comments

(function() {
  'use strict';

  // Only run on YouTube comment history pages
  const isCommentHistoryPage =
    window.location.href.includes('myactivity.google.com') &&
    (window.location.href.includes('youtube_comments') ||
     window.location.href.includes('page=youtube_comments'));

  if (!isCommentHistoryPage) {
    console.log('[YT Comments] Not on comment history page, skipping');
    return;
  }

  console.log('[YT Comments] Starting comment scanner');

  // State
  let comments = [];
  let isScanning = false;
  let statusUI = null;

  // Extract video + comment IDs from URL
  function extractIds(url) {
    if (!url) return { videoId: null, commentId: null };

    // Handle Google redirect URLs
    if (url.includes('google.com/url')) {
      try {
        const urlObj = new URL(url);
        url = urlObj.searchParams.get('q') || url;
      } catch (e) {
        const match = url.match(/[?&]q=([^&]+)/);
        if (match) url = decodeURIComponent(match[1]);
      }
    }

    let videoId = null;
    let commentId = null;

    try {
      const urlObj = new URL(url);
      const vParam = urlObj.searchParams.get('v');
      if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) {
        videoId = vParam;
      }

      const lcParam = urlObj.searchParams.get('lc') || urlObj.searchParams.get('comment_id');
      if (lcParam && /^[a-zA-Z0-9._-]+$/.test(lcParam)) {
        commentId = lcParam;
      }

      if (!videoId) {
        const path = urlObj.pathname || '';
        const patterns = [
          /\/shorts\/([a-zA-Z0-9_-]{11})/,
          /\/embed\/([a-zA-Z0-9_-]{11})/,
          /\/live\/([a-zA-Z0-9_-]{11})/,
          /youtu\.be\/([a-zA-Z0-9_-]{11})/
        ];
        for (const pattern of patterns) {
          const match = url.match(pattern);
          if (match) {
            videoId = match[1];
            break;
          }
        }
      }
    } catch (e) {
      // Fallback regex parse
      const patterns = [
        /[?&]v=([a-zA-Z0-9_-]{11})/,
        /youtu\.be\/([a-zA-Z0-9_-]{11})/,
        /embed\/([a-zA-Z0-9_-]{11})/,
        /shorts\/([a-zA-Z0-9_-]{11})/,
        /live\/([a-zA-Z0-9_-]{11})/
      ];
      for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
          videoId = match[1];
          break;
        }
      }

      const lcMatch = url.match(/[?&](?:lc|comment_id)=([^&]+)/);
      if (lcMatch) commentId = decodeURIComponent(lcMatch[1]);
    }

    return { videoId, commentId };
  }

  function isDurationText(text) {
    return /^\s*\d{1,2}:\d{2}(\s*:\d{2})?\s*$/.test(text);
  }

  function looksLikeMetadata(text) {
    if (!text) return true;
    const lower = text.toLowerCase();
    const skip = [
      'delete', 'details', 'share', 'reply', 'replied', 'like', 'dislike', 'subscribe',
      'views', 'ago', 'yesterday', 'today', 'watched', 'posted', 'edited',
      'commented on', 'replied to', 'replied to a comment on'
    ];
    if (skip.some(s => lower === s || lower.includes(` ${s}`) || lower.includes(`${s} `))) return true;
    if (isDurationText(text)) return true;
    if (/^\s*[\d,]+\s*views?\s*$/i.test(text)) return true;
    if (/^\s*\d+\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s*ago\s*$/i.test(text)) return true;
    return false;
  }

  // Find comment text near a YouTube link by walking up the DOM
  function findCommentText(link) {
    // Walk up to find the activity item container
    let container = link;
    for (let i = 0; i < 8 && container; i++) {
      container = container.parentElement;
      if (!container) break;

      // Prefer the activity card's delete button label (contains full comment text)
      const deleteBtn = container.querySelector('button[aria-label^="Delete activity item"]');
      if (deleteBtn) {
        const label = deleteBtn.getAttribute('aria-label') || '';
        const extracted = label.replace(/^Delete activity item\s*/i, '').trim();
        if (extracted) {
          return extracted.replace(/\s+/g, ' ').trim().substring(0, 2000);
        }
      }

      // Gather candidate text blocks near the link
      const candidates = [];
      const elements = container.querySelectorAll('span, div, p');
      elements.forEach(el => {
        if (!el) return;
        const text = el.textContent?.trim();
        if (!text || text.length < 10) return;
        if (link.contains(el)) return; // ignore video title/link
        if (looksLikeMetadata(text)) return;
        // Avoid elements that are just the video title again
        const linkText = link.textContent?.trim();
        if (linkText && (text === linkText || text.includes(linkText))) return;
        candidates.push(text);
      });

      if (candidates.length > 0) {
        // Prefer longer, more sentence-like candidates
        const sorted = candidates
          .map(t => ({ t, score: t.length + (t.includes(' ') ? 10 : 0) }))
          .sort((a, b) => b.score - a.score);
        return sorted[0].t.replace(/\s+/g, ' ').trim().substring(0, 2000);
      }
    }
    return null;
  }

  function parseRelativeDate(text) {
    if (!text) return null;
    const lower = text.toLowerCase();
    if (lower.includes('today')) {
      return new Date().toISOString();
    }
    if (lower.includes('yesterday')) {
      return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    }
    const match = lower.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/);
    if (!match) return null;
    const value = parseInt(match[1], 10);
    if (!value) return null;
    const unit = match[2];
    const now = Date.now();
    const multipliers = {
      second: 1000,
      minute: 60 * 1000,
      hour: 60 * 60 * 1000,
      day: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
      year: 365 * 24 * 60 * 60 * 1000
    };
    return new Date(now - value * multipliers[unit]).toISOString();
  }

  function isTimeOnlyText(text) {
    return /^\s*\d{1,2}:\d{2}(\s*(am|pm))?\s*$/i.test(text);
  }

  function normalizeWhitespace(text) {
    return text ? text.replace(/\s+/g, ' ').trim() : '';
  }

  function extractDateFragment(text) {
    if (!text) return '';
    const monthMatch = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(,\s*\d{4})?/i);
    if (monthMatch) return monthMatch[0];
    const numericMatch = text.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/);
    if (numericMatch) return numericMatch[0];
    const isoMatch = text.match(/\b\d{4}-\d{2}-\d{2}\b/);
    if (isoMatch) return isoMatch[0];
    const yearOnly = text.match(/\b(19|20)\d{2}\b/);
    if (yearOnly) return yearOnly[0];
    return '';
  }

  function findDateText(link, commentText) {
    let container = link;
    for (let i = 0; i < 8 && container; i++) {
      container = container.parentElement;
      if (!container) break;
      const elements = container.querySelectorAll('span, div');
      for (const el of elements) {
        const text = el.textContent?.trim();
        if (!text) continue;
        if (commentText && (text === commentText || text.includes(commentText))) continue;
        if (isDurationText(text) || isTimeOnlyText(text)) continue;

        if (/ago/i.test(text) || /today|yesterday/i.test(text)) {
          return text;
        }

        const dateFragment = extractDateFragment(text);
        if (dateFragment) return dateFragment;

        if (/commented on/i.test(text)) {
          const embedded = extractDateFragment(text);
          if (embedded) return embedded;
        }
      }
    }
    return '';
  }

  function hasYear(text) {
    return /\b(19|20)\d{2}\b/.test(text || '');
  }

  function normalizeDateTextToIso(dateText, timeText) {
    if (!dateText) return '';
    if (isDurationText(dateText) || isTimeOnlyText(dateText)) return '';
    const rel = parseRelativeDate(dateText);
    if (rel) return rel;
    const dateWithTime = timeText ? `${dateText} ${timeText}` : dateText;
    if (hasYear(dateWithTime)) {
      const parsed = Date.parse(dateWithTime);
      if (!isNaN(parsed)) return new Date(parsed).toISOString();
    }

    // Handle dates without year like "Jan 27"
    const noYearMatch = dateText.match(/([A-Z][a-z]{2,})\s+(\d{1,2})/);
    if (noYearMatch) {
      const year = new Date().getFullYear();
      const timePart = timeText ? ` ${timeText}` : '';
      const candidate = `${noYearMatch[1]} ${noYearMatch[2]}, ${year}${timePart}`;
      const parsedCandidate = Date.parse(candidate);
      if (!isNaN(parsedCandidate)) return new Date(parsedCandidate).toISOString();
    }
    return '';
  }

  function findCardContainer(link) {
    return link.closest('[role="listitem"], li') || link.parentElement;
  }

  function findTimeText(container) {
    if (!container) return '';
    const textNodes = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while (node = walker.nextNode()) {
      const text = normalizeWhitespace(node.textContent || '');
      if (!text) continue;
      textNodes.push(text);
    }
    for (const t of textNodes) {
      const match = t.match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
      if (match) return match[1].toUpperCase();
    }
    return '';
  }

  function findDateHeaderFromContainer(container) {
    if (!container) return '';
    let node = container;
    for (let i = 0; i < 4 && node; i++) {
      let prev = node.previousElementSibling;
      while (prev) {
        const heading = prev.querySelector('h1, h2, h3, [role="heading"]') || (prev.matches && prev.matches('h1, h2, h3, [role="heading"]') ? prev : null);
        if (heading) {
          const text = normalizeWhitespace(heading.textContent || '');
          if (text) return text;
        }
        prev = prev.previousElementSibling;
      }
      node = node.parentElement;
    }
    return '';
  }

  // Get video title from link
  function getVideoTitle(link, commentText) {
    const candidates = [];
    const card = findCardContainer(link);
    if (card) {
      const linkEls = card.querySelectorAll('a');
      linkEls.forEach(a => {
        const text = a.textContent?.trim();
        if (!text) return;
        if (isDurationText(text)) return;
        if (/^details$/i.test(text)) return;
        if (/^commented on/i.test(text) || /^replied to/i.test(text)) return;
        if (commentText && (text === commentText || commentText.includes(text))) return;
        if (text.length < 3) return;
        candidates.push(text);
      });
    }

    const linkText = link.textContent?.trim();
    if (linkText && !isDurationText(linkText) && !/^details$/i.test(linkText)) candidates.push(linkText);

    if (!candidates.length) return 'YouTube Video';
    candidates.sort((a, b) => b.length - a.length);
    return candidates[0].substring(0, 200);
  }

  function getActivityType(card) {
    if (!card) return 'comment';
    const text = (card.innerText || '').toLowerCase();
    if (text.includes('replied to a comment on')) return 'reply';
    if (text.includes('replied to a comment')) return 'reply';
    if (text.includes('replied')) return 'reply';
    return 'comment';
  }

  function getReplyTarget(card) {
    if (!card) return '';
    const text = normalizeWhitespace(card.innerText || '');
    if (!/replied to/i.test(text)) return '';
    let match = text.match(/replied to\s+(.+?)'s comment on/i);
    if (!match) match = text.match(/replied to\s+(.+?)\s+on/i);
    if (!match) match = text.match(/replied to\s+(.+?)\s*$/i);
    if (!match) return '';
    const candidate = normalizeWhitespace(match[1]).trim();
    if (!candidate) return '';
    const lower = candidate.toLowerCase();
    if (candidate.length <= 1) return '';
    if (lower === 'a comment' || lower === 'a' || lower === 'comment') return '';
    if (lower.includes('comment')) return '';
    if (lower.startsWith('a ')) return '';
    return candidate.replace(/^@/, '').trim();
  }

  function getUnavailableLabel(card) {
    if (!card) return '';
    const text = (card.innerText || '').toLowerCase();
    if (text.includes('commented on an unavailable video')) return 'Unavailable video';
    if (text.includes('commented on a private video')) return 'Private video';
    return '';
  }

  // Normalize text for comparison
  function normalizeText(text) {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function getCommentKey(comment) {
    if (comment.commentId) return `c:${comment.commentId}`;
    return `v:${comment.videoId}|t:${normalizeText(comment.text)}`;
  }

  function getFallbackKey(comment) {
    return `v:${comment.videoId}|t:${normalizeText(comment.text)}`;
  }

  // Add comment if not duplicate
  function addComment(comment) {
    const normalizedNew = normalizeText(comment.text);

    // Check for duplicates by normalized text + videoId
    const isDupe = comments.some(c => {
      return normalizeText(c.text) === normalizedNew && c.videoId === comment.videoId;
    });

    if (!isDupe) {
      comments.push(comment);
      console.log(`[YT Comments] Added: "${comment.text.substring(0, 40)}..." (${comment.videoId})`);
      return true;
    }
    return false;
  }

  // Scan visible activity cards and extract comments
  function scanPage() {
    const cards = document.querySelectorAll('[role="listitem"], li');
    let newCount = 0;

    for (const card of cards) {
      if (!card || card.dataset.ytCardScanned) continue;

      const links = card.querySelectorAll(
        'a[href*="youtube.com/watch"], a[href*="youtu.be/"], a[href*="youtube.com/shorts/"], a[href*="youtube.com/live/"]'
      );
      if (!links.length) continue;

      const primary = Array.from(links).find(l => /[?&](?:lc|comment_id)=/.test(l.href)) || links[0];
      if (!primary) continue;

      const { videoId, commentId } = extractIds(primary.href);
      if (!videoId) continue;

      const text = findCommentText(primary);
      if (!text || text.length < 10) continue;

      card.dataset.ytCardScanned = 'true';

      const activityType = getActivityType(card);
      const replyToName = activityType === 'reply' ? getReplyTarget(card) : '';
      const unavailableLabel = getUnavailableLabel(card);
      const dateGroup = findDateHeaderFromContainer(card);
      const timeText = findTimeText(card);
      const dateText = normalizeWhitespace([dateGroup, timeText].filter(Boolean).join(' '));
      const publishedAt = normalizeDateTextToIso(dateGroup, timeText);

      let videoTitle = getVideoTitle(primary, text);
      if (videoTitle === 'YouTube Video' && unavailableLabel) {
        videoTitle = unavailableLabel;
      }

      const added = addComment({
        text,
        videoId,
        videoUrl: commentId
          ? `https://www.youtube.com/watch?v=${videoId}&lc=${commentId}`
          : `https://www.youtube.com/watch?v=${videoId}`,
        videoTitle,
        activityType,
        replyToName,
        likes: 0,
        likeFetched: false,
        dateText,
        timeText,
        publishedAt,
        commentId,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
      });

      if (added) newCount++;
    }

    return newCount;
  }

  // Create status UI
  function createStatusUI() {
    // Remove existing if present
    document.getElementById('yt-comment-scanner')?.remove();

    const container = document.createElement('div');
    container.id = 'yt-comment-scanner';
    container.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      width: 280px;
      background: #1a1a2e;
      color: white;
      border-radius: 8px;
      padding: 12px;
      font-family: Arial, sans-serif;
      font-size: 14px;
      z-index: 999999;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;

    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <strong>Scanning Comments</strong>
        <button id="yt-scanner-close" style="background: none; border: none; color: white; font-size: 18px; cursor: pointer; padding: 0 4px;">×</button>
      </div>
      <div id="yt-scanner-status">Initializing...</div>
      <div style="background: #333; height: 6px; border-radius: 3px; margin: 8px 0;">
        <div id="yt-scanner-progress" style="background: #3ea6ff; height: 100%; width: 0%; border-radius: 3px; transition: width 0.3s;"></div>
      </div>
      <div id="yt-scanner-count" style="font-size: 12px; color: #aaa;">0 comments found</div>
    `;

    document.body.appendChild(container);

    document.getElementById('yt-scanner-close').onclick = () => container.remove();

    return {
      setStatus: (text) => {
        const el = document.getElementById('yt-scanner-status');
        if (el) el.textContent = text;
      },
      setProgress: (pct) => {
        const el = document.getElementById('yt-scanner-progress');
        if (el) el.style.width = Math.min(100, pct) + '%';
      },
      setCount: (n) => {
        const el = document.getElementById('yt-scanner-count');
        if (el) el.textContent = n + ' comments found';
      },
      setComplete: (success) => {
        container.style.background = success ? '#1e4620' : '#4a1e1e';
        setTimeout(() => container.remove(), 4000);
      }
    };
  }

  // Wait for new content to load
  function waitForContent(timeout) {
    return new Promise(resolve => {
      let resolved = false;

      const observer = new MutationObserver(() => {
        if (!resolved) {
          resolved = true;
          observer.disconnect();
          setTimeout(resolve, 300);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          observer.disconnect();
          resolve();
        }
      }, timeout);
    });
  }

  // Main scanning function with auto-scroll
  async function startScanning() {
    if (isScanning) {
      console.log('[YT Comments] Already scanning');
      return;
    }

    isScanning = true;
    comments = [];
    let existing = [];
    try {
      const stored = await chrome.storage.local.get(['comments']);
      existing = stored.comments || [];
    } catch (e) {
      console.warn('[YT Comments] Failed to load existing comments for merge');
    }

    const ui = createStatusUI();
    ui.setStatus('Starting scan...');

    // Initial scan
    scanPage();
    ui.setCount(comments.length);

    // Auto-scroll to load more
    let scrollCount = 0;
    const maxScrolls = 50;
    let noNewCount = 0;

    while (scrollCount < maxScrolls && noNewCount < 3) {
      const prevHeight = document.documentElement.scrollHeight;
      const prevComments = comments.length;

      // Scroll down
      window.scrollTo(0, document.documentElement.scrollHeight);
      ui.setStatus(`Scrolling... (${scrollCount + 1}/${maxScrolls})`);
      ui.setProgress((scrollCount / maxScrolls) * 100);

      // Wait for new content
      await waitForContent(2500);

      // Scan new content
      scanPage();
      ui.setCount(comments.length);

      // Check if we got new stuff
      const newHeight = document.documentElement.scrollHeight;
      if (newHeight === prevHeight && comments.length === prevComments) {
        noNewCount++;
        ui.setStatus(`No new content (${noNewCount}/3)...`);
      } else {
        noNewCount = 0;
      }

      scrollCount++;
    }

    // Merge with existing comments to preserve likes/metadata
    const mergedMap = new Map();
    for (const c of existing) {
      const key = getCommentKey(c);
      mergedMap.set(key, c);
      if (c.commentId) {
        const fallbackKey = getFallbackKey(c);
        if (mergedMap.has(fallbackKey) && fallbackKey !== key) {
          mergedMap.delete(fallbackKey);
        }
      }
    }
    for (const c of comments) {
      const key = getCommentKey(c);
      if (c.commentId) {
        const fallbackKey = getFallbackKey(c);
        if (mergedMap.has(fallbackKey) && fallbackKey !== key) {
          const prev = mergedMap.get(fallbackKey);
          mergedMap.delete(fallbackKey);
          mergedMap.set(key, { ...prev, ...c, commentId: c.commentId });
          continue;
        }
      }
      if (mergedMap.has(key)) {
        const prev = mergedMap.get(key);
        mergedMap.set(key, {
          ...c,
          likes: prev.likes || c.likes || 0,
          likeFetched: prev.likeFetched || c.likeFetched,
          lastLikeUpdate: prev.lastLikeUpdate || c.lastLikeUpdate
        });
      } else {
        mergedMap.set(key, c);
      }
    }
    const mergedComments = Array.from(mergedMap.values());

    // Save to storage
    ui.setStatus('Saving...');
    ui.setProgress(100);

    try {
      await chrome.storage.local.set({ comments: mergedComments });
      console.log(`[YT Comments] Saved ${mergedComments.length} comments`);

      // Notify background script
      chrome.runtime.sendMessage({
        action: 'scanningComplete',
        commentCount: mergedComments.length
      });

      ui.setStatus(`Done! ${mergedComments.length} comments saved`);
      ui.setComplete(true);
    } catch (err) {
      console.error('[YT Comments] Save error:', err);
      ui.setStatus('Error saving comments');
      ui.setComplete(false);
    }

    isScanning = false;
  }

  // Message listener
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'startScan') {
      startScanning();
      sendResponse({ success: true });
    }
    if (request.action === 'clearComments') {
      chrome.storage.local.remove('comments');
      comments = [];
      sendResponse({ success: true });
    }
    if (request.action === 'ping') {
      sendResponse({ success: true, url: window.location.href });
    }
    return true;
  });

  // Auto-start after short delay
  setTimeout(() => {
    console.log('[YT Comments] Auto-starting scan...');
    startScanning();
  }, 2000);

})();
