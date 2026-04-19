/* ═══════════════════════════════════════════
   ONEPRIMETV — script.js (Fix v5)
   Live seek: uses video.currentTime in HLS DVR buffer only,
   NO stream reload on timeline click or skip buttons.
   Archive stall fix: lutc extended + fragLoadingMaxRetry.
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
let channelsData = [];

// ── DOM REFS ──────────────────────────────
const video       = document.getElementById('video');
const app         = document.getElementById('app');
const controls    = document.getElementById('controls');
const loader      = document.getElementById('video-loader');
const tlPos       = document.getElementById('tl-pos');
const tlLive      = document.getElementById('tl-live');
const tlThumb     = document.getElementById('tl-thumb');
const tlHover     = document.getElementById('tl-hover');
const timeline    = document.getElementById('timeline');
const tStart      = document.getElementById('t-start');
const tEnd        = document.getElementById('t-end');
const btnPlay     = document.getElementById('btn-play');
const btnMute     = document.getElementById('btn-mute');
const volSlider   = document.getElementById('vol-slider');
const volWrap     = document.getElementById('vol-slider-wrap');
const liveBadge   = document.getElementById('live-badge');
const liveText    = document.getElementById('live-text');
const qualBtn     = document.getElementById('btn-quality');
const qualMenu    = document.getElementById('qual-menu');
const qualList    = document.getElementById('qual-list');
const qualLabel   = document.getElementById('qual-label');
const btnFS       = document.getElementById('btn-fullscreen');
const btnChannels = document.getElementById('btn-channels');
const btnEPG      = document.getElementById('btn-epg');
const qualBadge   = document.getElementById('quality-badge');
const panel       = document.getElementById('channels-panel');
const panelBD     = document.getElementById('panel-backdrop');
const panelClose  = document.getElementById('panel-close');
const panelSearch = document.getElementById('panel-search');
const channelsList= document.getElementById('channels-list');
const chLogo      = document.getElementById('ch-logo');
const chName      = document.getElementById('ch-name');
const chProgram   = document.getElementById('ch-program');
const indLeft     = document.getElementById('ind-left');
const indCenter   = document.getElementById('ind-center');
const indRight    = document.getElementById('ind-right');
const centerIcon  = document.getElementById('center-icon');

// ── EPG DATE PARSER (with timezone) ──────
function parseEPGDate(s) {
  if (!s) return null;
  const parts = s.trim().split(' ');
  const t  = parts[0];
  const tz = parts[1] || '+0000';
  const sign   = tz[0] === '-' ? -1 : 1;
  const tzOffMs= sign * (+(tz.slice(1,3)||0) * 60 + +(tz.slice(3,5)||0)) * 60000;
  const utcMs  = Date.UTC(+t.slice(0,4), +t.slice(4,6)-1, +t.slice(6,8),
                          +t.slice(8,10), +t.slice(10,12), +(t.slice(12,14)||0));
  return new Date(utcMs - tzOffMs);
}
function fmtTime(d) {
  if (!d) return '--:--';
  const dt = typeof d === 'string' ? parseEPGDate(d) : d;
  if (!dt) return '--:--';
  return dt.getHours().toString().padStart(2,'0') + ':' + dt.getMinutes().toString().padStart(2,'0');
}

// ── GET HLS LIVE EDGE ─────────────────────
function getLiveEdge() {
  if (video.seekable && video.seekable.length > 0) return video.seekable.end(0);
  if (hls?.liveSyncPosition) return hls.liveSyncPosition;
  return isFinite(video.duration) ? video.duration : 0;
}
function getSeekableStart() {
  if (video.seekable && video.seekable.length > 0) return video.seekable.start(0);
  return 0;
}

// ── CONTROLS VISIBILITY ───────────────────
function showControls() {
  controls.classList.remove('controls-hidden');
  controlsVisible = true;
  resetInactivity();
}
function hideControls() {
  // Never hide when EPG, panel or quality menu is open
  const epgSheet = document.getElementById('epg-sheet');
  if (epgSheet && !epgSheet.classList.contains('sheet-hidden')) return;
  if (!panel.classList.contains('panel-hidden')) return;
  if (qualMenu && !qualMenu.classList.contains('hidden')) return;
  controls.classList.add('controls-hidden');
  controlsVisible = false;
}
function resetInactivity() {
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(hideControls, 3500);
}
// FIX: attach mousemove ONLY to video-wrapper (not whole app)
// Moving mouse over EPG sheet won't trigger controls show/hide cycle
const videoWrapper = document.getElementById('video-wrapper');
videoWrapper.addEventListener('mousemove', showControls);
videoWrapper.addEventListener('mousedown', showControls);
videoWrapper.addEventListener('touchstart', showControls, {passive: true});

// ── VIDEO CLICK ───────────────────────────
controls.addEventListener('click', (e) => {
  if (e.target.closest('#bottombar') || e.target.closest('#topbar')) return;
  if (!qualMenu.classList.contains('hidden')) { qualMenu.classList.add('hidden'); return; }
  video.paused ? video.play() : video.pause();
}, true);

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
document.getElementById('tz-left').addEventListener('click',  () => handleTouchZone('left'));
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
  if (!stay) setTimeout(() => indCenter.classList.remove('animating'), 600);
}

// ── SKIP ─────────────────────────────────
// KEY DESIGN: skip NEVER reloads stream.
// Live: seeks within HLS DVR buffer using video.currentTime.
//   - If going back beyond buffer start → clamp to buffer start
//   - If going forward past live edge → jump to live edge
// Archive: seeks video.currentTime normally (range 0..duration)
window.doSkip = function(s) {
  try {
    const liveEdge = getLiveEdge();
    const bufStart = getSeekableStart();
    const target = video.currentTime + s;

    // 1. Live shift mode: video.currentTime = seconds from prog start → just seek
    if (!isArchive && currentArchiveData?._isLiveShift) {
      const times = getChannelTimes();
      if (times) {
        const totalSec = (times.stop.getTime() - times.start.getTime()) / 1000;
        const newTime  = Math.max(0, Math.min(video.currentTime + s, totalSec));
        video.currentTime = newTime;
        isUserBehind = (liveEdge - newTime) > 10;
      }
      // Fall through to indicator animation
    } else if (!isArchive && s < 0 && target < (bufStart + 5)) {
        // Normal live: beyond buffer → load as seeked archive
        const times = getChannelTimes();
        if (times) {
            const behindFromLive = liveEdge - target;
            const targetWallMs = Date.now() - (behindFromLive * 1000);
            seekLiveToWallTime(new Date(targetWallMs), times.start, times.stop);
            return;
        }
    }

    // 1b. Live shift: just move video.currentTime by ±10s
    if (!isArchive && currentArchiveData?._isLiveShift) {
      let maxSec = isFinite(video.duration) ? video.duration : 999999;
      if (video.seekable && video.seekable.length > 0) maxSec = video.seekable.end(0);
      const newT = Math.max(0, Math.min(maxSec, video.currentTime + s));
      video.currentTime = newT;
      isUserBehind = (maxSec - newT) > 10;
    }

    // 2. Pokud už jsme v ARCHIVU (nebo skáčeme v rámci bufferu)
    if (isArchive) {
        video.currentTime = Math.max(0, Math.min(video.duration, target));
    } else {
        // Skok v rámci LIVE bufferu (těch pár vteřin co prohlížeč drží)
        if (target >= bufStart && target <= liveEdge) {
            video.currentTime = target;
            isUserBehind = true;
        } else if (s > 0 && target >= liveEdge - 5) {
            video.currentTime = liveEdge;
            isUserBehind = false;
        }
    }
  } catch(e) {
      console.error("Skip error:", e);
  }

  // Animace ikonky
  const el = s < 0 ? indLeft : indRight;
  if (el) {
    el.classList.remove('animating');
    void el.offsetWidth;
    el.classList.add('animating');
    setTimeout(() => el.classList.remove('animating'), 500);
  }
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
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
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
  // Live shift: check if we're at live edge
  let liveShiftBehind = false;
  if (!isArchive && currentArchiveData?._isLiveShift) {
    let maxSec = isFinite(video.duration) ? video.duration : 0;
    if (video.seekable && video.seekable.length > 0) maxSec = video.seekable.end(0);
    liveShiftBehind = maxSec > 0 && (maxSec - video.currentTime) > 12;
  }
  const recording = isArchive || isBehind || liveShiftBehind || video.paused;
  liveBadge.classList.toggle('recording', recording);
  liveText.textContent = isArchive ? 'ARCHIV'
    : (liveShiftBehind ? 'ZÁZNAM' : recording ? 'ZÁZNAM' : 'LIVE');
}
video.addEventListener('play',       updateLiveStatus);
video.addEventListener('pause',      updateLiveStatus);
video.addEventListener('seeking',    updateLiveStatus);
video.addEventListener('timeupdate', updateLiveStatus);

// ── QUALITY ───────────────────────────────
let userQuality = -1;
qualBtn.onclick = (e) => {
  e.stopPropagation();
  qualMenu.classList.toggle('hidden');
  if (!qualMenu.classList.contains('hidden')) buildQualMenu();
};
document.addEventListener('click', (e) => { if (!e.target.closest('.qual-wrap')) qualMenu.classList.add('hidden'); });

function buildQualMenu() {
  qualList.innerHTML = '';
  const isApple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isApple || !hls?.levels?.length) {
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
  // Live shift mode (live loaded from program start)
  if (!isArchive && currentArchiveData?._isLiveShift) {
    return {
      start: new Date(currentArchiveData._progStartMs),
      stop:  new Date(currentArchiveData._progStopMs),
    };
  }
  // Archive / seek modes
  if (isArchive && currentArchiveData) {
    if (currentArchiveData._progStartMs && currentArchiveData._progStopMs) {
      return {
        start: new Date(currentArchiveData._progStartMs),
        stop:  new Date(currentArchiveData._progStopMs),
      };
    }
    const s = parseEPGDate(currentArchiveData.start);
    const e = parseEPGDate(currentArchiveData.stop);
    if (s && e) return { start: s, stop: e };
  }
  const el = document.querySelector(`.ch-item[data-id="${currentChannelId}"]`);
  if (!el) return null;
  const s = parseEPGDate(el.dataset.start), e = parseEPGDate(el.dataset.stop);
  if (!s || !e) return null;
  return { start: s, stop: e };
}

function updateTimeline() {
  const now = new Date();
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
  tEnd.textContent   = fmtTime(stop);
  const totalMs = stop - start;
  if (totalMs <= 0) return;

  if (isArchive) {
    const times = getChannelTimes();
    if (times) {
      const { start, stop } = times;
      const totalMs = stop - start;
      
      // Vypočítáme aktuální reálný čas (Wall Clock) v archivu
      // currentArchiveData.start je čas, kdy začal tento konkrétní stream
      const streamStartMs = parseEPGDate(currentArchiveData.start).getTime();
      const currentWallTimeMs = streamStartMs + (video.currentTime * 1000);
      
      // Procentuální pozice v rámci CELÉHO pořadu (od začátku do konce na ose)
      const pct = Math.max(0, Math.min(100, (currentWallTimeMs - start.getTime()) / totalMs * 100));

      tlPos.style.width = pct + '%';
      if (tlThumb) tlThumb.style.left = pct + '%';
      tlLive.style.width = '100%'; // V archivu je "budoucnost" vždy plná
    }
  } else {
    // Live: show position relative to program time window
    const liveEdgePct = Math.max(0, Math.min(100, (now - start) / totalMs * 100));
    tlLive.style.width = liveEdgePct + '%';

    let posPct;
    if (!isArchive && currentArchiveData?._isLiveShift) {
      // Live shift: video.currentTime = seconds from program start
      // Direct mapping: 0s = 0%, fullProg = liveEdgePct
      const progDurSec = totalMs / 1000;
      posPct = progDurSec > 0
        ? Math.max(0, Math.min(liveEdgePct, (video.currentTime / progDurSec) * 100))
        : liveEdgePct;
    } else {
      const liveEdge = getLiveEdge();
      if (isFinite(liveEdge) && liveEdge > 0) {
        const behindSec = liveEdge - video.currentTime;
        const posMs     = (now - start) - behindSec * 1000;
        posPct = Math.max(0, Math.min(liveEdgePct, posMs / totalMs * 100));
      } else {
        posPct = liveEdgePct;
      }
    }
    tlPos.style.width = posPct + '%';
    if (tlThumb) tlThumb.style.left = posPct + '%';
  }
  updateLiveStatus();
  updateQualBadge();
}
setInterval(updateTimeline, 500);
video.addEventListener('seeked',     updateTimeline);
video.addEventListener('timeupdate', updateTimeline);

// Timeline hover label
timeline.addEventListener('mousemove', (e) => {
  const times = getChannelTimes(); if (!times) return;
  const rect = timeline.getBoundingClientRect();
  const pos  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const hT   = new Date(times.start.getTime() + (times.stop - times.start) * pos);
  tlHover.style.display = 'block';
  tlHover.style.left    = pos * 100 + '%';
  tlHover.textContent   = fmtTime(hT);
});
timeline.addEventListener('mouseleave', () => { tlHover.style.display = 'none'; });

// ── SEEK ON TIMELINE CLICK ────────────────
// KEY: Never reloads stream. Uses video.currentTime only.
// Live: converts position to seconds-behind-live, seeks in DVR buffer.
// Archive: seeks by proportion of video.duration.
// Seek live stream to a wall-clock target time using shift/catchup URL.
// This reloads the stream with utc= and lutc= params so we can go back
// further than the DVR buffer (which is only ~30s).
// The timeline still shows the full program (start→stop), just offset.
function seekLiveToWallTime(targetWallTime, progStart, progStop) {
  const ch = document.querySelector(`.ch-item[data-id="${currentChannelId}"]`);
  if (!ch) return;

  const startUnix = Math.floor(targetWallTime.getTime() / 1000);
  // Use program stop + buffer so stream doesn't expire mid-seek
  const stopUnix = Math.floor(progStop.getTime() / 1000) + 120;

  // Switch to archive mode but keep the original program times for timeline
  isArchive = true;
  isUserBehind = true;
  currentArchiveData = {
    title: ch.dataset.title || '',
    start: progStart.getFullYear()
      + (progStart.getMonth()+1).toString().padStart(2,'0')
      + progStart.getDate().toString().padStart(2,'0')
      + progStart.getHours().toString().padStart(2,'0')
      + progStart.getMinutes().toString().padStart(2,'0')
      + '00 +0000',
    stop: progStop.getFullYear()
      + (progStop.getMonth()+1).toString().padStart(2,'0')
      + progStop.getDate().toString().padStart(2,'0')
      + progStop.getHours().toString().padStart(2,'0')
      + progStop.getMinutes().toString().padStart(2,'0')
      + '00 +0000',
    desc:  ch.dataset.desc || '',
    image: ch.dataset.img  || '',
  };

  const isApple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let finalUrl = ch.dataset.url.replace('http://94.241.90.115:8889', '/oneplay');
  finalUrl += `?utc=${startUnix}&lutc=${stopUnix}`;

  loader.classList.remove('hidden');
  video.pause();
  if (!isApple) { video.src = ''; video.load(); }
  if (hls) { hls.destroy(); hls = null; }

  if (Hls.isSupported() && !isApple) {
    hls = new Hls({
      liveSyncDurationCount: 0,
      enableWorker: true, startLevel: -1,
      manifestLoadingMaxRetry: 15, levelLoadingMaxRetry: 15,
      fragLoadingMaxRetry: 20, fragLoadingRetryDelay: 1000,
    });
    hls.loadSource(finalUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => {});
      updatePlayIcon(); buildQualMenu();
    });
    hls.on(Hls.Events.FRAG_BUFFERED, () => {
      loader.classList.add('hidden');
    });
    hls.on(Hls.Events.ERROR, (ev, d) => {
      if (d.fatal) {
        loader.classList.add('hidden');
        console.warn('HLS error:', d.type, d.details, d.response?.code);
        if (d.response?.code === 404 || d.response?.code === 403) {
          console.warn('Archive 404/403 — stream not available for this time window');
        } else if (d.type === Hls.ErrorTypes.NETWORK_ERROR) {
          setTimeout(() => { if (hls) hls.startLoad(); }, 2000);
        } else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        }
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = finalUrl; video.load(); video.play().catch(() => {}); updatePlayIcon();
  }
}

function handleSeek(e) {
  if (e.cancelable) e.preventDefault();
  const times = getChannelTimes(); 
  if (!times) return;

  const rect = timeline.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));

  if (isArchive) {
    if (isFinite(video.duration)) video.currentTime = video.duration * pos;
  } else if (!isArchive && currentArchiveData?._isLiveShift) {
    // Live shift: video.currentTime = seconds from prog start, seek directly
    const progDurSec = (times.stop.getTime() - times.start.getTime()) / 1000;
    const targetSec  = progDurSec * pos;
    // Clamp to available seekable range
    let maxSec = isFinite(video.duration) ? video.duration : progDurSec;
    if (video.seekable && video.seekable.length > 0) maxSec = video.seekable.end(0);
    video.currentTime = Math.max(0, Math.min(maxSec, targetSec));
    isUserBehind = (maxSec - video.currentTime) > 10;
  } else {
    // LIVE SEEK
    const totalMs = times.stop - times.start;
    const targetWallMs = times.start.getTime() + (totalMs * pos);
    const nowMs = Date.now();
    const behindSec = (nowMs - targetWallMs) / 1000;

    if (currentArchiveData?._isLiveShift) {
      // Live shift: stream starts at prog start → video.currentTime = wall offset
      const progOffsetSec = (new Date(targetWallMs) - times.start) / 1000;
      const clampedSec = Math.max(0, Math.min(getLiveEdge(), progOffsetSec));
      video.currentTime = clampedSec;
      isUserBehind = (getLiveEdge() - clampedSec) > 10;
    } else if (behindSec < 20) {
      // Near live edge → snap to live
      video.currentTime = getLiveEdge();
      isUserBehind = false;
    } else {
      // Beyond buffer → reload as seeked archive
      seekLiveToWallTime(new Date(targetWallMs), times.start, times.stop);
    }
  }
  showControls();
}
timeline.addEventListener('mousedown',  handleSeek);
timeline.addEventListener('touchstart', handleSeek, { passive: false });

// ── LIVE BADGE CLICK — go to live edge ────
liveBadge.addEventListener('click', (e) => {
  e.stopPropagation();
  if (isArchive) {
    // Exit archive → reload live (with live shift)
    const ch = document.querySelector(`.ch-item[data-id="${currentChannelId}"]`);
    if (ch) {
      isArchive = false; currentArchiveData = null; isUserBehind = false;
      playStream(ch.dataset.url,
        ch.querySelector('.ch-name')?.textContent.replace('★','').trim() || '',
        ch.querySelector('.ch-img')?.src || '',
        currentChannelId);
    }
    return;
  }
  // Snap to live edge (works for both live shift and normal live)
  const liveEdge = getLiveEdge();
  if (isFinite(liveEdge) && liveEdge > 0) {
    video.currentTime = liveEdge;
    isUserBehind = false;
  }
});

// ── STREAM PLAYBACK ───────────────────────
function playStream(url, name, logo, channelId, startUnix = null, archiveData = null) {
  isUserBehind    = false;
  isArchive       = !!startUnix;
  currentArchiveData = archiveData;
  currentChannelId   = channelId;
  localStorage.setItem('lastChannelId', channelId);
  loader.classList.remove('hidden');

  chName.textContent    = name;
  chProgram.textContent = archiveData?.title || '';
  if (logo) { chLogo.src = logo; chLogo.classList.remove('hidden'); }
  else chLogo.classList.add('hidden');

  document.querySelectorAll('.ch-item').forEach(el => el.classList.toggle('active', el.dataset.id === channelId));

  const isApple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let finalUrl = url.replace('http://94.241.90.115:8889', '/oneplay');

  if (startUnix) {
    // Archive / EPG seek: load from specific time
    let stopUnix;
    if (archiveData?.stop) {
      stopUnix = Math.floor(parseEPGDate(archiveData.stop).getTime() / 1000);
    } else {
      const el = document.querySelector(`.ch-item[data-id="${channelId}"]`);
      stopUnix = Math.floor((el ? parseEPGDate(el.dataset.stop) : new Date()).getTime() / 1000);
    }
    if (stopUnix <= startUnix) stopUnix = startUnix + 3600;
    stopUnix += 30 * 60; // 30min buffer so token doesn't expire
    const sep = finalUrl.includes('?') ? '&' : '?';
    finalUrl += `${sep}utc=${startUnix}&lutc=${stopUnix}`;
  } else {
    // LIVE kanál — načíst stream od začátku aktuálního pořadu
    // Tím bude celý pořad v HLS bufferu a půjde volně přetáčet zpět
    const chEl = document.querySelector(`.ch-item[data-id="${channelId}"]`);
    if (chEl && chEl.dataset.start) {
      const progStart = parseEPGDate(chEl.dataset.start);
      const progStop  = parseEPGDate(chEl.dataset.stop);
      const now = new Date();
      if (progStart && progStop && progStart < now && progStop > now) {
        // Pořad právě běží — načíst od začátku, HLS engine skok na live edge
        const progStartUnix = Math.floor(progStart.getTime() / 1000);
        const progStopUnix  = Math.floor(progStop.getTime() / 1000) + 30 * 60;
        const sep = finalUrl.includes('?') ? '&' : '?';
        finalUrl += `${sep}utc=${progStartUnix}&lutc=${progStopUnix}`;
        // Uložit info pro timeline — ale isArchive zůstane false (jsme live)
        currentArchiveData = {
          title:         chEl.dataset.title || '',
          start:         chEl.dataset.start || '',
          stop:          chEl.dataset.stop  || '',
          desc:          chEl.dataset.desc  || '',
          image:         chEl.dataset.img   || '',
          _progStartMs:  progStart.getTime(),
          _progStopMs:   progStop.getTime(),
          _isLiveShift:  true, // příznak: jsme live, ne archiv
        };
      }
    }
  }

  video.pause();
  if (!isApple) { video.src = ''; video.load(); }
  if (hls) { hls.destroy(); hls = null; }

  if (Hls.isSupported() && !isApple) {
    // For live shift: stream has fixed utc/lutc window = full program
    // Must use liveSyncDurationCount:0 so HLS.js doesn't skip to "live edge"
    // and we can freely seek anywhere in the program
    const _isLiveShift = !isArchive && currentArchiveData?._isLiveShift;
    hls = new Hls({
      liveSyncDurationCount: (isArchive || _isLiveShift) ? 0 : 3,
      liveBackBufferLength:  (isArchive || _isLiveShift) ? 0 : 60,
      maxBufferLength:       60,
      enableWorker: true,
      startLevel: -1,
      manifestLoadingMaxRetry: 15,
      levelLoadingMaxRetry:    15,
      fragLoadingMaxRetry:     20,
      fragLoadingRetryDelay:   1000,
    });
    hls.loadSource(finalUrl);
    hls.attachMedia(video);
    // Track if we already seeked for this stream
    let _liveShiftSeeked = false;

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => {});
      updatePlayIcon();
      buildQualMenu();

      // Live shift: seek na aktuální pozici v pořadu
      if (_isLiveShift) {
        const progStartMs = currentArchiveData?._progStartMs;
        if (progStartMs) {
          const elapsedSec = Math.max(0, (Date.now() - progStartMs) / 1000 - 3);
          const progDurSec = currentArchiveData._progStopMs
            ? (currentArchiveData._progStopMs - progStartMs) / 1000
            : 0;
          const seekTo = progDurSec > 0 ? Math.min(elapsedSec, progDurSec - 5) : elapsedSec;
          // Seekneme přímo — HLS.js načte správný segment bez ohledu na seekable range
          video.currentTime = seekTo;
          _liveShiftSeeked = true;
          console.log('⏩ Live shift seek:', Math.round(seekTo) + 's / progDur:', Math.round(progDurSec) + 's');
        }
      }
    });

    hls.on(Hls.Events.FRAG_BUFFERED, () => {
      loader.classList.add('hidden');
      // Pokud seek selhal při MANIFEST_PARSED (seekable ještě nebyl ready),
      // zkusíme znovu při prvním buffered fragmentu
      if (_isLiveShift && !_liveShiftSeeked) {
        const progStartMs = currentArchiveData?._progStartMs;
        if (!progStartMs) return;
        const elapsedSec = Math.max(0, (Date.now() - progStartMs) / 1000 - 3);
        const progDurSec = currentArchiveData._progStopMs
          ? (currentArchiveData._progStopMs - progStartMs) / 1000
          : 0;
        const seekTo = progDurSec > 0 ? Math.min(elapsedSec, progDurSec - 5) : elapsedSec;
        video.currentTime = seekTo;
        _liveShiftSeeked = true;
        console.log('⏩ Live shift seek (fallback FRAG_BUFFERED):', Math.round(seekTo) + 's');
      }
    });
    hls.on(Hls.Events.ERROR, (ev, d) => {
      if (d.fatal) {
        console.warn('HLS fatal error:', d.type, d.details);
        loader.classList.add('hidden');
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR) {
          setTimeout(() => { if (hls) hls.startLoad(); }, 2000);
        }
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = finalUrl;
    video.load();
    video.play().catch(() => {});
    updatePlayIcon();
  }
  video.onloadedmetadata = () => updateTimeline();
}

video.addEventListener('ended', () => {
  if (isArchive) playNextProgram();
  else {
    const el = document.querySelector('.ch-item.active');
    if (el) el.click();
  }
});

// ── NEXT PROGRAM ─────────────────────────
async function playNextProgram() {
  if (!isArchive || !currentArchiveData || !currentChannelId) return;
  const stopDate = parseEPGDate(currentArchiveData.stop);
  const stopUnix = Math.floor(stopDate.getTime() / 1000);
  const dstr = stopDate.getFullYear()
    + (stopDate.getMonth()+1).toString().padStart(2,'0')
    + stopDate.getDate().toString().padStart(2,'0');

  let dayData = window.epgCache?.[dstr]?.[currentChannelId];
  if (!dayData) {
    try {
      const r = await fetch(`/epg-data?id=${encodeURIComponent(currentChannelId)}&full=true&date=${dstr}`);
      dayData = await r.json();
      if (dayData?.length) {
        if (!window.epgCache) window.epgCache = {};
        if (!window.epgCache[dstr]) window.epgCache[dstr] = {};
        window.epgCache[dstr][currentChannelId] = dayData;
      }
    } catch(e) {}
  }
  if (dayData?.length) {
    const next = dayData.find(p => Math.floor(parseEPGDate(p.start).getTime()/1000) >= stopUnix);
    if (next) {
      const el = document.querySelector(`.ch-item[data-id="${currentChannelId}"]`);
      if (!el) return;
      const nextStart = Math.floor(parseEPGDate(next.start).getTime()/1000);
      const nowUnix   = Math.floor(Date.now()/1000);
      const nextStop  = Math.floor(parseEPGDate(next.stop).getTime()/1000);
      if (nextStart <= nowUnix && nextStop > nowUnix) {
        // Currently airing → go live
        isArchive = false; currentArchiveData = null;
        playStream(el.dataset.url,
          el.querySelector('.ch-name')?.textContent.replace('★','').trim() || '',
          el.querySelector('.ch-img')?.src || '',
          currentChannelId);
        return;
      }
      playStream(el.dataset.url,
        el.querySelector('.ch-name')?.textContent.replace('★','').trim() || '',
        el.querySelector('.ch-img')?.src || '',
        currentChannelId, nextStart, next);
      return;
    }
  }
  // Fallback: go live
  const el = document.querySelector('.ch-item.active');
  if (el) { isArchive = false; currentArchiveData = null; el.click(); }
}

// ── EPG FETCH ─────────────────────────────
async function fetchEPG(id) {
  try {
    const r = await fetch(`/epg-data?id=${encodeURIComponent(id)}&tv=oneprime`);
    const d = await r.json();
    const el = document.querySelector(`.ch-item[data-id="${id}"]`);
    if (el && d.title) {
      el.dataset.start = d.start || '';
      el.dataset.stop  = d.stop  || '';
      el.dataset.title = d.title;
      el.dataset.desc  = d.desc  || '';
      el.dataset.img   = d.image || '';
      const epgEl = el.querySelector('.ch-epg');
      if (epgEl) epgEl.textContent = d.title;
      if (id === currentChannelId && !isArchive) {
        chProgram.textContent = d.title;
        // Update live shift data when EPG refreshes (program changed)
        if (currentArchiveData?._isLiveShift && d.start && d.stop) {
          const newStart = parseEPGDate(d.start);
          const newStop  = parseEPGDate(d.stop);
          if (newStart && newStop) {
            currentArchiveData._progStartMs = newStart.getTime();
            currentArchiveData._progStopMs  = newStop.getTime();
            currentArchiveData.start        = d.start;
            currentArchiveData.stop         = d.stop;
            currentArchiveData.title        = d.title;
          }
        }
      }
    }
  } catch(e) {}
}

// ── KEYBOARD ──────────────────────────────
window.addEventListener('keydown', (e) => {
  if (document.activeElement.tagName === 'INPUT') return;
  switch(e.code) {
    case 'Space':      e.preventDefault(); video.paused ? video.play() : video.pause(); break;
    case 'ArrowRight': e.preventDefault(); doSkip(10);  break;
    case 'ArrowLeft':  e.preventDefault(); doSkip(-10); break;
    case 'KeyF': e.preventDefault();
      if (!document.fullscreenElement) app.requestFullscreen?.();
      else document.exitFullscreen?.(); break;
    case 'Escape': closePanel(); closeEPGSheet(); break;
  }
});

// ── CHANNELS PANEL ────────────────────────
btnChannels.onclick = (e) => { e.stopPropagation(); openPanel(); };
panelClose.onclick  = closePanel;
panelBD.onclick     = closePanel;

function openPanel() {
  panel.classList.remove('panel-hidden');
  panelBD.classList.remove('hidden');
  // Stop inactivity timer while panel is open
  clearTimeout(inactivityTimer);
  controls.classList.remove('controls-hidden');
  controlsVisible = true;
  setTimeout(() => {
    const active = channelsList.querySelector('.ch-item.active');
    if (active) active.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 350);
}
function closePanel() {
  panel.classList.add('panel-hidden');
  panelBD.classList.add('hidden');
  resetInactivity();
}
panelSearch.oninput = () => {
  const q = panelSearch.value.toLowerCase();
  document.querySelectorAll('.ch-item').forEach(el => {
    el.style.display = el.querySelector('.ch-name').textContent.toLowerCase().includes(q) ? 'flex' : 'none';
  });
};

// ── FAVORITES ────────────────────────────
function toggleFav(id) {
  const idx = favorites.indexOf(id);
  if (idx > -1) favorites.splice(idx, 1); else favorites.push(id);
  localStorage.setItem('favs', JSON.stringify(favorites));

  // Re-sort channels: favorites first
  const sorted = [...channelsData].sort((a,b) =>
    (favorites.includes(b.id) ? 1 : 0) - (favorites.includes(a.id) ? 1 : 0));

  // Re-render panel without reloading EPG data (preserve dataset)
  const existingEpgData = {};
  document.querySelectorAll('.ch-item[data-id]').forEach(el => {
    existingEpgData[el.dataset.id] = {
      start: el.dataset.start || '',
      stop:  el.dataset.stop  || '',
      title: el.dataset.title || '',
      desc:  el.dataset.desc  || '',
      img:   el.dataset.img   || '',
    };
  });

  renderChannels(sorted, existingEpgData);
  if (window.lucide) lucide.createIcons();
}

// ── LOAD PLAYLIST ─────────────────────────
async function loadPlaylist() {
  try {
    // Zkus nejdřív live playlist ze serveru, fallback na lokální soubor
    let playlistText;
    try {
      const r = await fetch('/get-playlist');
      if (r.ok) { playlistText = await r.text(); }
      else { throw new Error('not ok'); }
    } catch {
      const r2 = await fetch('playlist.m3u');
      playlistText = await r2.text();
    }
    const text = playlistText;
    const lines = text.split('\n');
    channelsData = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#EXTINF')) continue;
      const nameM = lines[i].match(/tvg-name="([^"]+)"/) || [null, lines[i].split(',')[1]];
      const idM   = lines[i].match(/tvg-id="([^"]+)"/);
      const logoM = lines[i].match(/tvg-logo="([^"]+)"/);
      const catchupM = lines[i].match(/catchup-source="([^"]+)"/);
      const name  = nameM[1]?.trim();
      const id    = idM ? idM[1] : name;
      const logo  = logoM ? logoM[1] : '';
      const catchupSrc = catchupM ? catchupM[1] : '';
      let url = '';
      for (let j = i+1; j < lines.length; j++) {
        if (lines[j].trim().startsWith('http')) { url = lines[j].trim(); break; }
        if (lines[j].startsWith('#EXTINF')) break;
      }
      if (url) channelsData.push({ id, name, logo, url, catchupSrc });
    }
    const sorted = [...channelsData].sort((a,b) =>
      (favorites.includes(b.id)?1:0) - (favorites.includes(a.id)?1:0));
    renderChannels(sorted);
    if (window.lucide) lucide.createIcons();
    if (currentChannelId) {
      const el = document.querySelector(`.ch-item[data-id="${currentChannelId}"]`);
      if (el) setTimeout(() => el.click(), 100);
    }
  } catch(e) { console.error('Playlist error', e); }
}

function renderChannels(channels, existingEpgData = null) {
  channelsList.innerHTML = '';
  channels.forEach(ch => {
    const isFav = favorites.includes(ch.id);
    const cached = existingEpgData?.[ch.id];
    const el = document.createElement('div');
    el.className = 'ch-item' + (ch.id === currentChannelId ? ' active' : '');
    el.dataset.id  = ch.id;
    el.dataset.url = ch.url;
    // Restore cached EPG data if available
    if (cached) {
      el.dataset.start = cached.start;
      el.dataset.stop  = cached.stop;
      el.dataset.title = cached.title;
      el.dataset.desc  = cached.desc;
      el.dataset.img   = cached.img;
    }
    const epgText = cached?.title || 'Načítám...';
    el.innerHTML = `
      <i data-lucide="star" class="ch-fav${isFav ? ' starred' : ''}"></i>
      <img class="ch-img" src="${ch.logo}" onerror="this.src='https://via.placeholder.com/38?text=TV'" alt="">
      <div class="ch-info">
        <div class="ch-name">${ch.name}${isFav ? '<span class="fav-dot">★</span>' : ''}</div>
        <div class="ch-epg">${epgText}</div>
        <div class="ch-bar"><div class="ch-bar-inner" style="width:0%"></div></div>
      </div>`;
    el.querySelector('.ch-fav').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFav(ch.id);
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
    // Only fetch EPG if we don't have cached data
    if (!cached || !cached.title) fetchEPG(ch.id);
  });
}

// ── EPG SHEET ─────────────────────────────
btnEPG.onclick = (e) => { e.stopPropagation(); openEPGSheet(); };
document.getElementById('epg-close').onclick   = closeEPGSheet;
document.getElementById('epg-backdrop').onclick = closeEPGSheet;

function openEPGSheet() {
  document.getElementById('epg-sheet').classList.remove('sheet-hidden');
  document.getElementById('epg-backdrop').classList.remove('hidden');
  // IMPORTANT: stop inactivity timer while EPG is open — prevents controls flicker
  clearTimeout(inactivityTimer);
  // Show controls once, then keep them visible
  controls.classList.remove('controls-hidden');
  controlsVisible = true;
  if (typeof renderEPGGrid === 'function') renderEPGGrid();
}
function closeEPGSheet() {
  document.getElementById('epg-sheet').classList.add('sheet-hidden');
  document.getElementById('epg-backdrop').classList.add('hidden');
  // Resume inactivity timer
  resetInactivity();
}
window.closeEPG              = closeEPGSheet;
window.getCurrentChannelId   = () => currentChannelId;
window.getCurrentArchiveData = () => currentArchiveData;
window.getIsArchive          = () => isArchive;

// ── INIT ──────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  updateMuteIcon();
  if (volSlider) volSlider.value = video.muted ? 0 : video.volume;
  loadPlaylist();
  resetInactivity();
});
