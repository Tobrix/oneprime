/* ═══════════════════════════════════════════
   ONEPRIMETV — script.js (Fixed 2026)
═══════════════════════════════════════════ */
'use strict';

// ── STATE ─────────────────────────────────
let hls = null;
let isArchive = false;
let isUserBehind = false;
let currentChannelId = localStorage.getItem('lastChannelId') || null;
let currentArchiveData = null;
let favorites = JSON.parse(localStorage.getItem('favs')) || [];
let inactivityTimer = null;
let controlsVisible = true;

// ── DOM REFS ──────────────────────────────
const video    = document.getElementById('video');
const app      = document.getElementById('app');
const controls = document.getElementById('controls');
const loader   = document.getElementById('video-loader');
const tlPos    = document.getElementById('tl-pos');
const tlLive   = document.getElementById('tl-live');
const tlThumb  = document.getElementById('tl-thumb');
const tlHover  = document.getElementById('tl-hover');
const timeline = document.getElementById('timeline');
const tStart   = document.getElementById('t-start');
const tEnd     = document.getElementById('t-end');
const btnPlay  = document.getElementById('btn-play');
const btnMute  = document.getElementById('btn-mute');
const volSlider= document.getElementById('vol-slider');
const volWrap  = document.getElementById('vol-slider-wrap');
const liveBadge= document.getElementById('live-badge');
const liveText = document.getElementById('live-text');
const qualBtn  = document.getElementById('btn-quality');
const qualMenu = document.getElementById('qual-menu');
const qualList = document.getElementById('qual-list');
const qualLabel= document.getElementById('qual-label');
const btnFS    = document.getElementById('btn-fullscreen');
const btnChannels = document.getElementById('btn-channels');
const btnEPG   = document.getElementById('btn-epg');
const qualBadge= document.getElementById('quality-badge');
const panel    = document.getElementById('channels-panel');
const panelBD  = document.getElementById('panel-backdrop');
const panelClose= document.getElementById('panel-close');
const panelSearch= document.getElementById('panel-search');
const channelsList= document.getElementById('channels-list');
const chLogo   = document.getElementById('ch-logo');
const chName   = document.getElementById('ch-name');
const chProgram= document.getElementById('ch-program');
const indLeft  = document.getElementById('ind-left');
const indCenter= document.getElementById('ind-center');
const indRight = document.getElementById('ind-right');
const centerIcon= document.getElementById('center-icon');

// ── HELPERS ──────────────────────────────
function parseEPGDate(s) {
  if (!s) return null;
  const t = s.split(' ')[0];
  return new Date(+t.slice(0,4), +t.slice(4,6)-1, +t.slice(6,8),
    +t.slice(8,10), +t.slice(10,12), +(t.slice(12,14)||0));
}
function fmtTime(d) {
  if (!d) return '--:--';
  const dt = typeof d === 'string' ? parseEPGDate(d) : d;
  if (!dt) return '--:--';
  return dt.getHours().toString().padStart(2,'0') + ':' + dt.getMinutes().toString().padStart(2,'0');
}

// ── CONTROLS VISIBILITY ───────────────────
function showControls() {
  controls.classList.remove('controls-hidden');
  controlsVisible = true;
  resetInactivity();
}
function hideControls() {
  if (!panel.classList.contains('panel-hidden')) return;
  if (!document.getElementById('epg-sheet').classList.contains('sheet-hidden')) return;
  if (qualMenu && !qualMenu.classList.contains('hidden')) return;
  controls.classList.add('controls-hidden');
  controlsVisible = false;
}
function resetInactivity() {
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(hideControls, 3500);
}
app.addEventListener('mousemove', showControls);
app.addEventListener('touchstart', showControls, {passive: true});
app.addEventListener('mousedown', showControls);

// ── VIDEO CLICK ───────────────────────────
controls.addEventListener('click', (e) => {
  if (e.target.closest('#bottombar') || e.target.closest('#topbar')) return;
  if (!qualMenu.classList.contains('hidden')) { qualMenu.classList.add('hidden'); return; }
  video.paused ? video.play() : video.pause();
}, true);

// Touch zones
let tapTimer = null, tapCount = 0;
function handleTouchZone(side) {
  tapCount++;
  if (tapCount === 1) {
    tapTimer = setTimeout(() => {
      tapCount = 0;
      if (!controlsVisible) showControls();
      else { video.paused ? video.play() : video.pause(); }
    }, 250);
  } else if (tapCount >= 2) {
    clearTimeout(tapTimer); tapCount = 0;
    doSkip(side === 'left' ? -10 : 10);
  }
}
document.getElementById('tz-left').addEventListener('click', () => handleTouchZone('left'));
document.getElementById('tz-right').addEventListener('click', () => handleTouchZone('right'));

// ── PLAY / PAUSE ──────────────────────────
function updatePlayIcon() {
  const ic = document.getElementById('play-icon');
  if (!ic) return;
  ic.setAttribute('data-lucide', video.paused ? 'play' : 'pause');
  if (window.lucide) lucide.createIcons();
}
btnPlay.onclick = () => { video.paused ? video.play() : video.pause(); };
video.onplay  = () => { updatePlayIcon(); resetInactivity(); flashCenter('play', false); };
video.onpause = () => { updatePlayIcon(); showControls(); flashCenter('pause', true); };

function flashCenter(icon, stay = false) {
  if (!centerIcon || !indCenter) return;
  centerIcon.setAttribute('data-lucide', icon);
  if (window.lucide) lucide.createIcons();
  indCenter.classList.remove('animating');
  void indCenter.offsetWidth;
  indCenter.classList.add('animating');
  if (!stay) setTimeout(() => indCenter.classList.remove('animating'), 300);
}

// ── SKIP ──────────────────────────────────
window.doSkip = function(s) {
  try { video.currentTime += s; } catch(e) {}
  if (s < 0) isUserBehind = true;
  if (s > 0 && isFinite(video.duration) && video.duration - video.currentTime < 20) isUserBehind = false;
  const el = s < 0 ? indLeft : indRight;
  if (el) {
    el.classList.remove('animating');
    void el.offsetWidth;
    el.classList.add('animating');
    setTimeout(() => el.classList.remove('animating'), 450);
  }
  showControls();
};

// ── VOLUME ────────────────────────────────
function updateMuteIcon() {
  const ic = btnMute.querySelector('[data-lucide]');
  if (!ic) return;
  const name = (video.muted || video.volume === 0) ? 'volume-x'
    : video.volume < 0.5 ? 'volume-1' : 'volume-2';
  ic.setAttribute('data-lucide', name);
  if (window.lucide) lucide.createIcons();
  if (volSlider) volSlider.value = video.muted ? 0 : video.volume;
}
btnMute.onclick = (e) => {
  e.stopPropagation();
  if (video.muted) { video.muted = false; if (video.volume === 0) video.volume = 0.7; updateMuteIcon(); return; }
  volWrap.classList.toggle('open');
  updateMuteIcon();
};
if (volSlider) {
  volSlider.oninput = (e) => {
    const v = parseFloat(e.target.value);
    video.volume = v; video.muted = v === 0;
    updateMuteIcon();
  };
}

// ── FULLSCREEN ────────────────────────────
btnFS.onclick = (e) => {
  e.stopPropagation();
  const isIPad = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isFS = document.fullscreenElement || document.webkitFullscreenElement;
  if (!isFS) {
    if (isIPad && video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    else if (app.requestFullscreen) app.requestFullscreen();
    else if (app.webkitRequestFullscreen) app.webkitRequestFullscreen();
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  }
};
document.addEventListener('fullscreenchange', () => {
  const ic = btnFS.querySelector('[data-lucide]');
  if (!ic) return;
  ic.setAttribute('data-lucide', document.fullscreenElement ? 'minimize-2' : 'maximize-2');
  if (window.lucide) lucide.createIcons();
});

// ── LIVE STATUS ───────────────────────────
function updateLiveStatus() {
  const isApple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const diff = video.duration - video.currentTime;
  if (isApple && isFinite(video.duration) && diff < 15) isUserBehind = false;
  const isBehind = isApple
    ? (!isFinite(video.duration) ? isUserBehind : (diff > 25 || isUserBehind))
    : diff > 16;
  const recording = isArchive || isBehind || video.paused;
  liveBadge.classList.toggle('recording', recording);
  liveText.textContent = isArchive ? 'ARCHIV' : (recording ? 'ZÁZNAM' : 'LIVE');
}
video.addEventListener('play', updateLiveStatus);
video.addEventListener('pause', updateLiveStatus);
video.addEventListener('seeking', updateLiveStatus);
video.addEventListener('timeupdate', updateLiveStatus);

// ── QUALITY ───────────────────────────────
let userQuality = -1;
qualBtn.onclick = (e) => { e.stopPropagation(); qualMenu.classList.toggle('hidden'); if (!qualMenu.classList.contains('hidden')) buildQualMenu(); };
document.addEventListener('click', (e) => { if (!e.target.closest('.qual-wrap')) qualMenu.classList.add('hidden'); });

function buildQualMenu() {
  qualList.innerHTML = '';
  const isApple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isApple || !hls || !hls.levels || !hls.levels.length) {
    qualList.innerHTML = '<div class="qual-opt active">Auto (systém)</div>';
    qualLabel.textContent = 'Auto'; return;
  }
  const addOpt = (text, idx) => {
    const d = document.createElement('div');
    d.className = 'qual-opt' + (idx === userQuality ? ' active' : '');
    d.textContent = text;
    if (idx === userQuality) d.innerHTML += ` <i data-lucide="check" style="width:13px;height:13px;margin-left:6px;"></i>`;
    d.onclick = (e) => {
      e.stopPropagation(); userQuality = idx;
      hls.currentLevel = idx; hls.loadLevel = idx;
      qualLabel.textContent = text; buildQualMenu();
      setTimeout(() => qualMenu.classList.add('hidden'), 200);
    };
    qualList.appendChild(d);
  };
  addOpt('Auto', -1);
  const seen = new Set();
  [...hls.levels].reverse().forEach((lv, i) => {
    const ri = hls.levels.length - 1 - i;
    if (!seen.has(lv.height)) { seen.add(lv.height); addOpt(lv.height + 'p', ri); }
  });
  if (window.lucide) lucide.createIcons();
}

function updateQualBadge() {
  if (!hls || hls.currentLevel < 0 || !hls.levels[hls.currentLevel]) { qualBadge.classList.add('hidden'); return; }
  const h = hls.levels[hls.currentLevel].height;
  qualBadge.classList.remove('hidden');
  qualBadge.textContent = h >= 1080 ? 'FHD' : h >= 720 ? 'HD' : 'SD';
  qualBadge.style.background = h >= 1080 ? '#6366f1' : h >= 720 ? '#10b981' : '#6b7280';
  qualBadge.style.color = '#fff';
}

// ── LOADER ───────────────────────────────
video.addEventListener('waiting',   () => loader.classList.remove('hidden'));
video.addEventListener('playing',   () => loader.classList.add('hidden'));
video.addEventListener('canplay',   () => loader.classList.add('hidden'));
video.addEventListener('loadstart', () => loader.classList.remove('hidden'));

// ── TIMELINE ─────────────────────────────
function getChannelTimes() {
  if (isArchive && currentArchiveData) {
    return { start: parseEPGDate(currentArchiveData.start), stop: parseEPGDate(currentArchiveData.stop) };
  }
  const el = document.querySelector(`.ch-item[data-id="${currentChannelId}"]`);
  if (!el) return null;
  const s = parseEPGDate(el.dataset.start), e = parseEPGDate(el.dataset.stop);
  if (!s || !e) return null;
  return { start: s, stop: e };
}

function updateTimeline() {
  const now = new Date();
  // Update mini bars in panel
  document.querySelectorAll('.ch-item').forEach(item => {
    const s = parseEPGDate(item.dataset.start), e = parseEPGDate(item.dataset.stop);
    if (!s || !e) return;
    const pct = Math.max(0, Math.min(100, (now - s) / (e - s) * 100));
    const bar = item.querySelector('.ch-bar-inner');
    if (bar) bar.style.width = pct + '%';
    if (pct >= 100 && !isArchive) fetchEPG(item.dataset.id);
  });

  const times = getChannelTimes();
  if (!times) return;
  const { start, stop } = times;
  if (!start || !stop) return;
  tStart.textContent = fmtTime(start);
  tEnd.textContent = fmtTime(stop);
  const totalMs = stop - start;
  if (totalMs <= 0) return;

  if (isArchive) {
    const pct = video.duration > 0 ? (video.currentTime / video.duration * 100) : 0;
    tlPos.style.width = pct + '%';
    tlLive.style.width = '100%';
    if (tlThumb) tlThumb.style.left = pct + '%';
  } else {
    const liveEdgePct = Math.max(0, Math.min(100, (now - start) / totalMs * 100));
    tlLive.style.width = liveEdgePct + '%';
    let livePoint = 0;
    if (video.seekable && video.seekable.length > 0) livePoint = video.seekable.end(0);
    else if (hls && hls.liveSyncPosition) livePoint = hls.liveSyncPosition;
    else livePoint = video.duration;
    let posPct;
    if (isFinite(livePoint) && livePoint > 0) {
      const behind = livePoint - video.currentTime;
      const posMs = (now - start) - (behind * 1000);
      posPct = Math.max(0, Math.min(liveEdgePct, (posMs / totalMs) * 100));
    } else {
      posPct = liveEdgePct;
    }
    tlPos.style.width = posPct + '%';
    if (tlThumb) tlThumb.style.left = posPct + '%';
  }
  updateLiveStatus();
  updateQualBadge();
}
setInterval(updateTimeline, 500);
video.addEventListener('seeked', updateTimeline);
video.addEventListener('timeupdate', updateTimeline);

// Timeline hover + seek
timeline.addEventListener('mousemove', (e) => {
  const times = getChannelTimes(); if (!times) return;
  const rect = timeline.getBoundingClientRect();
  const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const hoverT = new Date(times.start.getTime() + (times.stop - times.start) * pos);
  tlHover.style.display = 'block';
  tlHover.style.left = (pos * 100) + '%';
  tlHover.textContent = fmtTime(hoverT);
});
timeline.addEventListener('mouseleave', () => { tlHover.style.display = 'none'; });

function handleSeek(e) {
  if (e.cancelable) e.preventDefault();
  e.stopPropagation();
  const times = getChannelTimes(); if (!times) return;
  const { start, stop } = times;
  const rect = timeline.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  isUserBehind = pos < 0.96;

  if (isArchive) {
    if (isFinite(video.duration) && video.duration > 0) video.currentTime = video.duration * pos;
  } else {
    const totalMs = stop - start;
    const targetMs = start.getTime() + (totalMs * pos);
    const behind = (Date.now() - targetMs) / 1000;
    let livePoint = 0;
    if (video.seekable && video.seekable.length > 0) livePoint = video.seekable.end(0);
    else if (hls && hls.liveSyncPosition) livePoint = hls.liveSyncPosition;
    else livePoint = video.duration;
    if (isFinite(livePoint)) video.currentTime = Math.max(0, livePoint - behind);
  }
  showControls();
}
timeline.addEventListener('mousedown', handleSeek);
timeline.addEventListener('touchstart', handleSeek, { passive: false });

// ── GO TO LIVE ────────────────────────────
// Click on live badge → jump to live edge
liveBadge.addEventListener('click', (e) => {
  e.stopPropagation();
  if (isArchive) return; // In archive mode, clicking live badge goes back to live channel
  // Jump to live edge
  let livePoint = 0;
  if (video.seekable && video.seekable.length > 0) livePoint = video.seekable.end(0);
  else if (hls && hls.liveSyncPosition) livePoint = hls.liveSyncPosition;
  else livePoint = video.duration;
  if (isFinite(livePoint) && livePoint > 0) {
    video.currentTime = livePoint;
    isUserBehind = false;
  }
});

// ── STREAM PLAYBACK ───────────────────────
function playStream(url, name, logo, channelId, startUnix = null, archiveData = null) {
  isUserBehind = false;
  isArchive = !!startUnix;
  currentArchiveData = archiveData;
  currentChannelId = channelId;
  localStorage.setItem('lastChannelId', channelId);
  loader.classList.remove('hidden');

  // Update UI
  chName.textContent = name;
  chProgram.textContent = isArchive ? (archiveData?.title || '') : '';
  if (logo) { chLogo.src = logo; chLogo.classList.remove('hidden'); }
  else chLogo.classList.add('hidden');

  // Highlight active channel in panel — works for both live and archive
  document.querySelectorAll('.ch-item').forEach(el => el.classList.toggle('active', el.dataset.id === channelId));

  const isApple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let finalUrl = url.replace('http://94.241.90.115:8889', '/oneplay');

  if (startUnix) {
    let stopUnix;
    if (archiveData?.stop) stopUnix = Math.floor(parseEPGDate(archiveData.stop).getTime() / 1000);
    else {
      const el = document.querySelector(`.ch-item[data-id="${channelId}"]`);
      stopUnix = Math.floor((el ? parseEPGDate(el.dataset.stop) : new Date()).getTime() / 1000);
    }
    if (stopUnix <= startUnix) stopUnix = startUnix + 3600;
    finalUrl += `${finalUrl.includes('?') ? '&' : '?'}utc=${startUnix}&lutc=${stopUnix}&_t=${Date.now()}`;
  }

  video.pause();
  if (!isApple) { video.src = ''; video.load(); }
  if (hls) { hls.destroy(); hls = null; }

  if (Hls.isSupported() && !isApple) {
    hls = new Hls({
      liveSyncDurationCount: isArchive ? 0 : 3,
      enableWorker: true, startLevel: -1,
      manifestLoadingMaxRetry: 15, levelLoadingMaxRetry: 15
    });
    hls.loadSource(finalUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => {});
      updatePlayIcon(); buildQualMenu();
    });
    hls.on(Hls.Events.FRAG_BUFFERED, () => loader.classList.add('hidden'));
    hls.on(Hls.Events.ERROR, (e, d) => { if (d.fatal) loader.classList.add('hidden'); });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = finalUrl; video.load();
    video.play().catch(() => {});
    updatePlayIcon();
  }

  video.onloadedmetadata = () => updateTimeline();
}

video.addEventListener('ended', () => {
  if (isArchive) playNextProgram();
  else {
    // Restart live
    const el = document.querySelector('.ch-item.active');
    if (el) el.click();
  }
});

// After archive finishes → go back to live automatically and fix timeline
video.addEventListener('timeupdate', () => {
  if (!isArchive || !video.duration) return;
  if (video.duration - video.currentTime < 2) {
    // End of archive segment reached — play next or go live
  }
});

// ── NEXT PROGRAM ─────────────────────────
async function playNextProgram() {
  if (!isArchive || !currentArchiveData || !currentChannelId) return;
  const stopDate = parseEPGDate(currentArchiveData.stop);
  const stopUnix = Math.floor(stopDate.getTime() / 1000);
  const dayStr = stopDate.getFullYear() + (stopDate.getMonth()+1).toString().padStart(2,'0') + stopDate.getDate().toString().padStart(2,'0');

  let dayData = window.epgCache?.[dayStr]?.[currentChannelId];
  if (!dayData) {
    try {
      const r = await fetch(`/epg-data?id=${encodeURIComponent(currentChannelId)}&full=true&date=${dayStr}`);
      dayData = await r.json();
      if (dayData?.length) {
        if (!window.epgCache) window.epgCache = {};
        if (!window.epgCache[dayStr]) window.epgCache[dayStr] = {};
        window.epgCache[dayStr][currentChannelId] = dayData;
      }
    } catch(e) {}
  }
  if (dayData?.length) {
    const next = dayData.find(p => Math.floor(parseEPGDate(p.start).getTime() / 1000) >= stopUnix);
    if (next) {
      const el = document.querySelector(`.ch-item[data-id="${currentChannelId}"]`);
      if (!el) return;
      const startUnix = Math.floor(parseEPGDate(next.start).getTime() / 1000);
      // Check if "next" is current live program → switch to live
      const nowUnix = Math.floor(Date.now() / 1000);
      if (startUnix <= nowUnix && Math.floor(parseEPGDate(next.stop).getTime() / 1000) > nowUnix) {
        // This is the currently airing live program → go to live
        isArchive = false;
        currentArchiveData = null;
        const url = el.dataset.url;
        const name = el.querySelector('.ch-name')?.textContent || '';
        const logo = el.querySelector('img')?.src || '';
        playStream(url, name, logo, currentChannelId);
        return;
      }
      const url = el.dataset.url;
      const name = el.querySelector('.ch-name')?.textContent || '';
      const logo = el.querySelector('img')?.src || '';
      playStream(url, name, logo, currentChannelId, startUnix, next);
      return;
    }
  }
  // Fall back to live
  const el = document.querySelector('.ch-item.active');
  if (el) {
    isArchive = false; currentArchiveData = null;
    const url = el.dataset.url;
    const name = el.querySelector('.ch-name')?.textContent || '';
    const logo = el.querySelector('img')?.src || '';
    playStream(url, name, logo, currentChannelId);
  }
}

// ── EPG DATA ──────────────────────────────
async function fetchEPG(id) {
  try {
    const r = await fetch(`/epg-data?id=${encodeURIComponent(id)}`);
    const d = await r.json();
    const el = document.querySelector(`.ch-item[data-id="${id}"]`);
    if (el && d.title) {
      el.dataset.start = d.start || '';
      el.dataset.stop = d.stop || '';
      el.dataset.title = d.title;
      el.dataset.desc = d.desc || '';
      el.dataset.img = d.image || '';
      const epgEl = el.querySelector('.ch-epg');
      if (epgEl) epgEl.textContent = d.title;
      if (id === currentChannelId && !isArchive) {
        chProgram.textContent = d.title;
      }
    }
  } catch(e) {}
}

// ── KEYBOARD ──────────────────────────────
window.addEventListener('keydown', (e) => {
  if (document.activeElement.tagName === 'INPUT') return;
  switch(e.code) {
    case 'Space': e.preventDefault(); video.paused ? video.play() : video.pause(); break;
    case 'ArrowRight': e.preventDefault(); doSkip(10); break;
    case 'ArrowLeft': e.preventDefault(); doSkip(-10); break;
    case 'KeyF': e.preventDefault();
      if (!document.fullscreenElement) app.requestFullscreen?.();
      else document.exitFullscreen?.(); break;
    case 'Escape': closePanel(); closeEPGSheet(); break;
  }
});

// ── CHANNELS PANEL ────────────────────────
btnChannels.onclick = (e) => { e.stopPropagation(); openPanel(); };
panelClose.onclick = closePanel;
panelBD.onclick = closePanel;

function openPanel() {
  panel.classList.remove('panel-hidden');
  panelBD.classList.remove('hidden');
  // Scroll active channel into view
  setTimeout(() => {
    const active = channelsList.querySelector('.ch-item.active');
    if (active) active.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 350);
  showControls();
}
function closePanel() {
  panel.classList.add('panel-hidden');
  panelBD.classList.add('hidden');
}

panelSearch.oninput = () => {
  const q = panelSearch.value.toLowerCase();
  document.querySelectorAll('.ch-item').forEach(el => {
    el.style.display = el.querySelector('.ch-name').textContent.toLowerCase().includes(q) ? 'flex' : 'none';
  });
};

// ── LOAD PLAYLIST ─────────────────────────
async function loadPlaylist() {
  try {
    const r = await fetch('playlist.m3u');
    const text = await r.text();
    const lines = text.split('\n');
    let channels = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#EXTINF')) continue;
      const nameM = lines[i].match(/tvg-name="([^"]+)"/) || [null, lines[i].split(',')[1]];
      const idM   = lines[i].match(/tvg-id="([^"]+)"/);
      const logoM = lines[i].match(/tvg-logo="([^"]+)"/);
      const name  = nameM[1]?.trim();
      const id    = idM ? idM[1] : name;
      const logo  = logoM ? logoM[1] : '';
      let url = '';
      for (let j = i+1; j < lines.length; j++) { if (lines[j].startsWith('http')) { url = lines[j].trim(); break; } }
      if (url) channels.push({ id, name, logo, url });
    }
    channels.sort((a,b) => (favorites.includes(b.id) ? 1 : 0) - (favorites.includes(a.id) ? 1 : 0));
    renderChannels(channels);
    if (window.lucide) lucide.createIcons();
    if (currentChannelId) {
      const el = document.querySelector(`.ch-item[data-id="${currentChannelId}"]`);
      if (el) setTimeout(() => el.click(), 100);
    }
  } catch(e) { console.error('Playlist error', e); }
}

function renderChannels(channels) {
  channelsList.innerHTML = '';
  channels.forEach(ch => {
    const isFav = favorites.includes(ch.id);
    const el = document.createElement('div');
    el.className = 'ch-item' + (ch.id === currentChannelId ? ' active' : '');
    el.dataset.id  = ch.id;
    el.dataset.url = ch.url;
    el.innerHTML = `
      <i data-lucide="star" class="ch-fav${isFav ? ' starred' : ''}"></i>
      <img class="ch-img" src="${ch.logo}" onerror="this.src='https://via.placeholder.com/38?text=TV'" alt="">
      <div class="ch-info">
        <div class="ch-name">${ch.name}</div>
        <div class="ch-epg">Načítám...</div>
        <div class="ch-bar"><div class="ch-bar-inner" style="width:0%"></div></div>
      </div>`;

    el.querySelector('.ch-fav').addEventListener('click', (e) => {
      e.stopPropagation(); toggleFav(ch.id);
    });

    el.onclick = (e) => {
      if (e.target.closest('.ch-fav')) return;
      document.querySelectorAll('.ch-item').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      isArchive = false; currentArchiveData = null;
      playStream(ch.url, ch.name, ch.logo, ch.id);
      closePanel();
    };

    channelsList.appendChild(el);
    fetchEPG(ch.id);
  });
}

function toggleFav(id) {
  const idx = favorites.indexOf(id);
  if (idx > -1) favorites.splice(idx, 1);
  else favorites.push(id);
  localStorage.setItem('favs', JSON.stringify(favorites));
  loadPlaylist();
}

// ── EPG SHEET ─────────────────────────────
btnEPG.onclick = (e) => { e.stopPropagation(); openEPGSheet(); };
document.getElementById('epg-close').onclick = closeEPGSheet;
document.getElementById('epg-backdrop').onclick = closeEPGSheet;

function openEPGSheet() {
  const sheet = document.getElementById('epg-sheet');
  const bd    = document.getElementById('epg-backdrop');
  sheet.classList.remove('sheet-hidden');
  bd.classList.remove('hidden');
  showControls();
  if (typeof renderEPGGrid === 'function') renderEPGGrid();
}
function closeEPGSheet() {
  document.getElementById('epg-sheet').classList.add('sheet-hidden');
  document.getElementById('epg-backdrop').classList.add('hidden');
}
window.closeEPG = closeEPGSheet;

// Expose state for EPG grid
window.getCurrentChannelId = () => currentChannelId;
window.getCurrentArchiveData = () => currentArchiveData;
window.getIsArchive = () => isArchive;

// ── INIT ──────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  updateMuteIcon();
  if (volSlider) volSlider.value = video.muted ? 0 : video.volume;
  loadPlaylist();
  resetInactivity();
});
