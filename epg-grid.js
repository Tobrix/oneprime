/* ═══════════════════════════════════════════
   ONEPRIMETV — epg-grid.js v6
   Modern EPG: horizontal timeline grid
   Works on desktop fullscreen & mobile
═══════════════════════════════════════════ */
'use strict';

const PX_PER_MIN = 7;   // pixels per minute in grid
const CH_W = 160;       // channel label width px
window.epgCache = {};

let selectedDay  = todayStr();
let epgPopup     = null;
let nowLineTimer  = null;

// ── DATE HELPERS ──────────────────────────
function todayStr() {
  const d = new Date();
  return d.getFullYear() + (d.getMonth()+1).toString().padStart(2,'0') + d.getDate().toString().padStart(2,'0');
}
function dayStr(offset) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.getFullYear() + (d.getMonth()+1).toString().padStart(2,'0') + d.getDate().toString().padStart(2,'0');
}
function parseEPG(s) {
  if (!s) return null;
  const parts = s.trim().split(' ');
  const t = parts[0], tz = parts[1] || '+0000';
  const sign = tz[0] === '-' ? -1 : 1;
  const tzOff = sign * (+(tz.slice(1,3)||0)*60 + +(tz.slice(3,5)||0)) * 60000;
  return new Date(Date.UTC(+t.slice(0,4),+t.slice(4,6)-1,+t.slice(6,8),+t.slice(8,10),+t.slice(10,12),+(t.slice(12,14)||0)) - tzOff);
}
function fmt(d) {
  if (!d) return '--:--';
  return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
}
function getDayMidnight(dstr) {
  return new Date(+dstr.slice(0,4), +dstr.slice(4,6)-1, +dstr.slice(6,8), 0, 0, 0, 0);
}

// ── DAY TABS ──────────────────────────────
function buildDayTabs() {
  const c = document.getElementById('epg-days');
  if (!c) return;
  c.innerHTML = '';
  const days = [
    { label: 'Včera', str: dayStr(-1) },
    { label: 'Dnes',  str: dayStr(0)  },
    { label: 'Zítra', str: dayStr(1)  },
  ];
  days.forEach(({ label, str }) => {
    const btn = document.createElement('button');
    btn.className = 'epg-day-btn' + (str === selectedDay ? ' active' : '');
    btn.textContent = label;
    btn.onclick = () => {
      selectedDay = str;
      document.querySelectorAll('.epg-day-btn').forEach(b => b.classList.toggle('active', b === btn));
      buildGrid();
    };
    c.appendChild(btn);
  });
}

// ── PREVIEW STRIP ────────────────────────
function updatePreviewStrip() {
  const prevEl    = document.getElementById('epg-preview');
  const prevImg   = document.getElementById('epg-prev-img');
  const prevTime  = document.getElementById('epg-prev-time');
  const prevTitle = document.getElementById('epg-prev-title');
  const prevDesc  = document.getElementById('epg-prev-desc');
  if (!prevEl) return;

  const currentId = window.getCurrentChannelId?.();
  const archData  = window.getCurrentArchiveData?.();
  const inArchive = window.getIsArchive?.();
  const chEl = currentId ? document.querySelector(`.ch-item[data-id="${currentId}"]`) : null;

  // Get current program info
  let prog = null;
  if (inArchive && archData) {
    prog = archData;
  } else if (chEl) {
    prog = {
      title: chEl.dataset.title,
      start: chEl.dataset.start,
      stop:  chEl.dataset.stop,
      image: chEl.dataset.img,
      desc:  chEl.dataset.desc,
    };
  }

  if (!prog || !prog.title) { prevEl.classList.add('hidden'); return; }
  prevEl.classList.remove('hidden');

  const start = parseEPG(prog.start), stop = parseEPG(prog.stop);
  const dur   = start && stop ? Math.round((stop - start) / 60000) : 0;

  if (prevImg)   { prevImg.src = prog.image || ''; prevImg.style.display = prog.image ? 'block' : 'none'; }
  if (prevTime)  prevTime.textContent = start && stop ? `${fmt(start)} – ${fmt(stop)} · ${dur} min` : '';
  if (prevTitle) prevTitle.textContent = prog.title || '';
  if (prevDesc)  prevDesc.textContent  = prog.desc  || '';

  // Update or add live badge
  let badge = prevEl.querySelector('.epg-preview-live-badge');
  if (!inArchive) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'epg-preview-live-badge';
      prevEl.appendChild(badge);
    }
    badge.textContent = 'LIVE';
  } else {
    if (badge) badge.remove();
  }
}

// ── MAIN ENTRY ────────────────────────────
window.renderEPGGrid = function() {
  const inArchive   = window.getIsArchive?.();
  const archiveData = window.getCurrentArchiveData?.();
  if (inArchive && archiveData?.start) {
    const d = parseEPG(archiveData.start);
    if (d) selectedDay = d.getFullYear() + (d.getMonth()+1).toString().padStart(2,'0') + d.getDate().toString().padStart(2,'0');
  } else {
    selectedDay = dayStr(0);
  }
  updatePreviewStrip();
  buildDayTabs();
  buildGrid();
};

// ── BUILD GRID ────────────────────────────
function buildGrid() {
  const rows    = document.getElementById('epg-rows');
  const ruler   = document.getElementById('epg-time-ruler');
  const nowLine = document.getElementById('epg-now-line');
  if (!rows || !ruler) return;

  // Clear
  Array.from(rows.children).forEach(c => { if (c.id !== 'epg-now-line') c.remove(); });
  ruler.innerHTML = '';
  clearInterval(nowLineTimer);

  const totalMins = 24 * 60;
  const gridW     = CH_W + totalMins * PX_PER_MIN;
  ruler.style.width   = gridW + 'px';
  rows.style.minWidth = gridW + 'px';

  // Time ruler — every 30 min
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const mark = document.createElement('div');
      mark.className = 'epg-time-mark';
      mark.style.left = CH_W + (h*60+m) * PX_PER_MIN + 'px';
      mark.textContent = h.toString().padStart(2,'0') + ':' + m.toString().padStart(2,'0');
      ruler.appendChild(mark);
    }
  }

  // Now line
  const isToday = selectedDay === dayStr(0);
  nowLine.style.display = isToday ? 'block' : 'none';

  function updateNowLine() {
    if (selectedDay !== dayStr(0)) return;
    const midnight = getDayMidnight(selectedDay);
    const nowMins  = (Date.now() - midnight.getTime()) / 60000;
    nowLine.style.left = CH_W + Math.max(0, nowMins) * PX_PER_MIN + 'px';
  }
  updateNowLine();
  nowLineTimer = setInterval(updateNowLine, 30000);

  // Build rows
  if (!epgCache[selectedDay]) epgCache[selectedDay] = {};
  const channels = Array.from(document.querySelectorAll('.ch-item'));
  if (!channels.length) return;

  const favs = JSON.parse(localStorage.getItem('favs') || '[]');

  // Sort: favs first (same as sidebar)
  const sorted = [...channels].sort((a, b) => {
    const af = favs.includes(a.dataset.id) ? 0 : 1;
    const bf = favs.includes(b.dataset.id) ? 0 : 1;
    return af - bf;
  });

  sorted.forEach(ch => {
    const id   = ch.dataset.id;
    const name = ch.querySelector('.ch-name')?.textContent.replace('★','').trim() || id;
    const logo = ch.querySelector('.ch-img')?.src || '';
    const isFav= favs.includes(id);

    const row = document.createElement('div');
    row.className = 'epg-row' + (isFav ? ' epg-row-fav' : '');
    row.dataset.channelId = id;

    // Channel label
    const label = document.createElement('div');
    label.className = 'epg-ch-label';
    label.innerHTML = `
      <img src="${logo}" onerror="this.style.display='none'" alt="">
      <span class="epg-ch-name">${name}</span>
      ${isFav ? '<span class="epg-fav-dot">★</span>' : ''}`;
    label.onclick = () => { ch.click(); closeEPG(); };
    row.appendChild(label);

    const track = document.createElement('div');
    track.className = 'epg-progs';
    track.style.position = 'relative';
    track.style.minWidth = totalMins * PX_PER_MIN + 'px';
    track.style.height   = '100%';
    row.appendChild(track);
    rows.appendChild(row);

    if (epgCache[selectedDay][id]) {
      renderProgs(track, epgCache[selectedDay][id], id, ch);
    } else {
      const fetchDay = (dstr) =>
        fetch(`/epg-data?id=${encodeURIComponent(id)}&full=true&date=${dstr}`)
          .then(r => r.json()).catch(() => []);

      if (selectedDay === dayStr(0)) {
        const ydStr = dayStr(-1);
        Promise.all([
          epgCache[ydStr]?.[id] ? Promise.resolve(epgCache[ydStr][id]) : fetchDay(ydStr),
          fetchDay(selectedDay)
        ]).then(([ydData, tdData]) => {
          if (!epgCache[ydStr]) epgCache[ydStr] = {};
          epgCache[ydStr][id] = ydData || [];
          const midnight  = getDayMidnight(selectedDay);
          const overnight = (ydData || []).filter(p => {
            const stop = parseEPG(p.stop);
            return stop && stop > midnight;
          });
          epgCache[selectedDay][id] = [...overnight, ...(tdData || [])];
          renderProgs(track, epgCache[selectedDay][id], id, ch);
          highlightCurrentInEPG();
        });
      } else {
        fetchDay(selectedDay).then(data => {
          epgCache[selectedDay][id] = data || [];
          renderProgs(track, data || [], id, ch);
          highlightCurrentInEPG();
        });
      }
    }
  });

  setTimeout(scrollEPGToFocus, 200);
}

// ── SCROLL TO CENTER ──────────────────────
function scrollEPGToFocus() {
  const scroll  = document.getElementById('epg-scroll');
  if (!scroll) return;
  const inArchive = window.getIsArchive?.();
  const archData  = window.getCurrentArchiveData?.();
  const midnight  = getDayMidnight(selectedDay);
  let targetMins;

  if (inArchive && archData?.start) {
    const d = parseEPG(archData.start);
    if (d) targetMins = (d.getTime() - midnight.getTime()) / 60000;
  } else if (archData?._isLiveShift && archData._progStartMs) {
    targetMins = (archData._progStartMs - midnight.getTime()) / 60000;
  }
  if (targetMins == null && selectedDay === dayStr(0)) {
    targetMins = (Date.now() - midnight.getTime()) / 60000;
  }
  if (targetMins == null) targetMins = 12 * 60;

  const targetPx     = CH_W + targetMins * PX_PER_MIN;
  const centerOffset = scroll.clientWidth / 2;
  scroll.scrollLeft  = Math.max(0, targetPx - centerOffset);
}

// ── RENDER PROGRAMS ───────────────────────
function renderProgs(track, programs, channelId, chEl) {
  if (!programs?.length) return;
  const now       = new Date();
  const currentId = window.getCurrentChannelId?.();
  const archData  = window.getCurrentArchiveData?.();
  const inArchive = window.getIsArchive?.();
  const midnight  = getDayMidnight(selectedDay);
  const dayEnd    = new Date(midnight.getTime() + 24 * 3600000);

  programs.forEach(prog => {
    const start = parseEPG(prog.start);
    const stop  = parseEPG(prog.stop);
    if (!start || !stop || stop <= start) return;
    if (stop <= midnight || start >= dayEnd) return;

    const clampedStart = start < midnight ? midnight : start;
    const clampedStop  = stop  > dayEnd   ? dayEnd   : stop;
    const startMins = (clampedStart.getTime() - midnight.getTime()) / 60000;
    const endMins   = (clampedStop.getTime()  - midnight.getTime()) / 60000;
    if (endMins <= 0 || startMins >= 24*60) return;

    const left  = Math.max(0, startMins) * PX_PER_MIN;
    const width = Math.max(4, (endMins - Math.max(0, startMins)) * PX_PER_MIN - 2);

    const block = document.createElement('div');
    block.className = 'epg-prog';
    block.dataset.progStart = prog.start;
    block.dataset.channelId = channelId;

    const isNowLive = now >= start && now < stop && selectedDay === dayStr(0);
    const isPast    = now >= stop;
    if (isNowLive) block.classList.add('current');
    if (isPast)    block.classList.add('past');

    // Highlight currently playing
    if (inArchive && channelId === currentId && archData) {
      const aStart = parseEPG(archData.start);
      if (aStart && Math.abs(start.getTime() - aStart.getTime()) < 60000) block.classList.add('playing');
    } else if (!inArchive && isNowLive && channelId === currentId) {
      block.classList.add('playing');
    } else if (!inArchive && archData?._isLiveShift && channelId === currentId && isNowLive) {
      block.classList.add('playing');
    }

    block.style.left  = left + 'px';
    block.style.width = width + 'px';

    // Duration badge for wider blocks
    const durMins = Math.round((stop - start) / 60000);

    block.innerHTML = `
      <div class="epg-prog-inner">
        <div class="epg-prog-title">${prog.title}</div>
        ${width > 80 ? `<div class="epg-prog-time">${fmt(start)}${durMins > 0 ? ' · ' + durMins + 'min' : ''}</div>` : ''}
      </div>`;

    // Desktop hover
    block.addEventListener('mouseenter', () => {
      if (window.matchMedia('(hover: none)').matches) return;
      showHoverPopup(prog, block);
    });
    block.addEventListener('mouseleave', () => {
      if (window.matchMedia('(hover: none)').matches) return;
      hideHoverPopup();
    });
    block.addEventListener('click', e => {
      e.stopPropagation();
      hideHoverPopup();
      showProgModal(prog, channelId, chEl, start, stop, now);
    });

    track.appendChild(block);
  });
}

// ── HIGHLIGHT PLAYING ─────────────────────
function highlightCurrentInEPG() {
  document.querySelectorAll('.epg-prog.playing').forEach(el => el.classList.remove('playing'));
  const currentId = window.getCurrentChannelId?.();
  const archData  = window.getCurrentArchiveData?.();
  const inArchive = window.getIsArchive?.();
  if (!currentId) return;
  if (inArchive && archData?.start) {
    const aStart = parseEPG(archData.start);
    document.querySelectorAll(`.epg-row[data-channel-id="${currentId}"] .epg-prog`).forEach(block => {
      const bs = parseEPG(block.dataset.progStart);
      if (bs && aStart && Math.abs(bs.getTime() - aStart.getTime()) < 60000) block.classList.add('playing');
    });
  } else if (selectedDay === dayStr(0)) {
    document.querySelectorAll(`.epg-row[data-channel-id="${currentId}"] .epg-prog.current`).forEach(b => b.classList.add('playing'));
  }
}

// ── HOVER POPUP ───────────────────────────
function showHoverPopup(prog, blockEl) {
  hideHoverPopup();
  const popup = document.createElement('div');
  popup.id = 'epg-hover-popup';
  popup.className = 'epg-hover-popup';
  const start = parseEPG(prog.start), stop = parseEPG(prog.stop);
  const dur = start && stop ? Math.round((stop - start) / 60000) : 0;
  popup.innerHTML = `
    <div class="ehp-time">${fmt(start)} – ${fmt(stop)} · ${dur} min</div>
    <div class="ehp-title">${prog.title || ''}</div>
    ${prog.desc ? `<div class="ehp-desc">${prog.desc.slice(0,120)}${prog.desc.length>120?'…':''}</div>` : ''}
    <div class="ehp-hint">Klikni pro přehrání →</div>`;
  document.body.appendChild(popup);
  epgPopup = popup;
  const rect = blockEl.getBoundingClientRect();
  let top  = rect.bottom + 8, left = rect.left;
  if (top + 160 > window.innerHeight) top = rect.top - 168;
  if (left + 270 > window.innerWidth)  left = window.innerWidth - 276;
  popup.style.top  = Math.max(4, top)  + 'px';
  popup.style.left = Math.max(4, left) + 'px';
}
function hideHoverPopup() {
  if (epgPopup) { epgPopup.remove(); epgPopup = null; }
}

// ── PROGRAM MODAL ─────────────────────────
function showProgModal(prog, channelId, chEl, start, stop, now) {
  document.getElementById('epg-modal-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'epg-modal-overlay';
  overlay.className = 'epg-modal-overlay';
  const isPast = now >= stop, isLive = now >= start && now < stop;
  const dur = Math.round((stop - start) / 60000);
  const canPlay = isPast || isLive;

  const chLogo = chEl?.querySelector('.ch-img')?.src || '';
  const chNameText = chEl?.querySelector('.ch-name')?.textContent?.replace('★','').trim() || '';

  overlay.innerHTML = `
    <div class="epg-modal">
      <button class="epg-modal-close"><i data-lucide="x"></i></button>
      <div class="epg-modal-img" style="${prog.image ? '' : 'height:60px;background:rgba(99,102,241,0.08);'}">
        ${prog.image ? `<img src="${prog.image}" alt="">` : ''}
        ${(chLogo || chNameText) ? `
          <div class="epg-modal-ch-overlay">
            ${chLogo ? `<img src="${chLogo}" onerror="this.style.display='none'" alt="">` : ''}
            ${chNameText ? `<span>${chNameText}</span>` : ''}
          </div>` : ''}
        <div class="epg-modal-badge ${isLive?'live':isPast?'past':'future'}">
          ${isLive ? 'LIVE' : isPast ? 'ZÁZNAM' : 'BRZY'}
        </div>
      </div>
      <div class="epg-modal-body">
        <div class="epg-modal-time">${fmt(start)} – ${fmt(stop)} · ${dur} min</div>
        <div class="epg-modal-title">${prog.title || ''}</div>
        <div class="epg-modal-desc">${prog.desc || 'Popis není k dispozici.'}</div>
        <div class="epg-modal-actions">
          ${canPlay ? `<button class="epg-modal-play">${isLive ? '▶ Sledovat živě' : '▶ Přehrát ze záznamu'}</button>` : `<div class="epg-modal-future">Pořad ještě nezačal</div>`}
          <button class="epg-modal-cancel">Zavřít</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  if (window.lucide) lucide.createIcons();

  overlay.querySelector('.epg-modal-close').onclick  = () => overlay.remove();
  overlay.querySelector('.epg-modal-cancel').onclick = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  if (canPlay) {
    overlay.querySelector('.epg-modal-play').onclick = () => {
      overlay.remove(); closeEPG();
      if (isLive) {
        if (chEl) chEl.click();
      } else {
        if (chEl) {
          playStream(chEl.dataset.url,
            chEl.querySelector('.ch-name')?.textContent.replace('★','').trim() || '',
            chEl.querySelector('.ch-img')?.src || '',
            channelId, Math.floor(start.getTime() / 1000), prog);
        }
      }
    };
  }
}

// ── CLOSE ─────────────────────────────────
window.closeEPG = function() {
  hideHoverPopup();
  document.getElementById('epg-modal-overlay')?.remove();
  document.getElementById('epg-sheet')?.classList.add('sheet-hidden');
  document.getElementById('epg-backdrop')?.classList.add('hidden');
};
