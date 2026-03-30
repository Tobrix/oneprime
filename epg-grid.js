/* ═══════════════════════════════════════════
   ONEPRIMETV — epg-grid.js (Fix v4)
═══════════════════════════════════════════ */
'use strict';

const PX_PER_MIN = 6;
const CH_W = 150;
window.epgCache = {};

let selectedDay = todayStr();
let epgPopup    = null;

// ── DATE HELPERS ──────────────────────────
function todayStr() {
  const d = new Date();
  return d.getFullYear() + (d.getMonth()+1).toString().padStart(2,'0') + d.getDate().toString().padStart(2,'0');
}
function dayStr(offset) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.getFullYear() + (d.getMonth()+1).toString().padStart(2,'0') + d.getDate().toString().padStart(2,'0');
}

// Parse EPG timestamp — handles "+0100" timezone offset
function parseEPG(s) {
  if (!s) return null;
  // Format: "20260330143000 +0100"
  const parts = s.trim().split(' ');
  const t = parts[0];
  const tz = parts[1] || '+0000'; // e.g. "+0100"

  const year = +t.slice(0,4);
  const mon  = +t.slice(4,6) - 1;
  const day  = +t.slice(6,8);
  const h    = +t.slice(8,10);
  const m    = +t.slice(10,12);
  const sec  = +(t.slice(12,14)||0);

  // Parse timezone offset
  const tzSign = tz[0] === '-' ? -1 : 1;
  const tzH    = +(tz.slice(1,3)||0);
  const tzM    = +(tz.slice(3,5)||0);
  const tzOffsetMs = tzSign * (tzH * 60 + tzM) * 60000;

  // Build UTC time then apply offset
  const utc = Date.UTC(year, mon, day, h, m, sec) - tzOffsetMs;
  return new Date(utc);
}

function fmt(d) {
  if (!d) return '--:--';
  // Format in local time
  return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
}

// Get local midnight for a day string YYYYMMDD
function getDayMidnight(dstr) {
  return new Date(+dstr.slice(0,4), +dstr.slice(4,6)-1, +dstr.slice(6,8), 0, 0, 0, 0);
}

// ── DAY TABS ──────────────────────────────
function buildDayTabs() {
  const c = document.getElementById('epg-days');
  if (!c) return;
  c.innerHTML = '';
  [
    { label: 'Včera', str: dayStr(-1) },
    { label: 'Dnes',  str: dayStr(0)  },
    { label: 'Zítra', str: dayStr(1)  },
  ].forEach(({ label, str }) => {
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

// ── MAIN ENTRY ────────────────────────────
window.renderEPGGrid = function() {
  // Auto-select day based on what's currently playing
  const inArchive   = window.getIsArchive?.();
  const archiveData = window.getCurrentArchiveData?.();
  if (inArchive && archiveData?.start) {
    const d = parseEPG(archiveData.start);
    if (d) {
      selectedDay = d.getFullYear() + (d.getMonth()+1).toString().padStart(2,'0') + d.getDate().toString().padStart(2,'0');
    }
  } else {
    selectedDay = dayStr(0);
  }
  buildDayTabs();
  buildGrid();
};

// ── BUILD GRID ────────────────────────────
function buildGrid() {
  const rows    = document.getElementById('epg-rows');
  const ruler   = document.getElementById('epg-time-ruler');
  const nowLine = document.getElementById('epg-now-line');
  if (!rows || !ruler) return;

  Array.from(rows.children).forEach(c => { if (c.id !== 'epg-now-line') c.remove(); });
  ruler.innerHTML = '';

  const totalMins = 24 * 60;
  const gridW     = CH_W + totalMins * PX_PER_MIN;
  ruler.style.width   = gridW + 'px';
  rows.style.minWidth = gridW + 'px';

  // Time ruler — every 30 min
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const mark = document.createElement('div');
      mark.className = 'epg-time-mark';
      mark.style.left = CH_W + (h * 60 + m) * PX_PER_MIN + 'px';
      mark.textContent = h.toString().padStart(2,'0') + ':' + m.toString().padStart(2,'0');
      ruler.appendChild(mark);
    }
  }

  // Now line — only on today
  const isToday = selectedDay === dayStr(0);
  nowLine.style.display = isToday ? 'block' : 'none';
  if (isToday) {
    const midnight = getDayMidnight(selectedDay);
    const nowMins  = (Date.now() - midnight.getTime()) / 60000;
    nowLine.style.left = CH_W + nowMins * PX_PER_MIN + 'px';
  }

  // Rows
  if (!epgCache[selectedDay]) epgCache[selectedDay] = {};
  const channels = Array.from(document.querySelectorAll('.ch-item'));
  if (!channels.length) return;

  channels.forEach(ch => {
    const id   = ch.dataset.id;
    const name = ch.querySelector('.ch-name')?.textContent.replace('★','').trim() || id;
    const logo = ch.querySelector('.ch-img')?.src || '';
    const isFav= ch.querySelector('.ch-fav.starred') !== null;

    const row = document.createElement('div');
    row.className = 'epg-row' + (isFav ? ' epg-row-fav' : '');
    row.dataset.channelId = id;

    const label = document.createElement('div');
    label.className = 'epg-ch-label';
    label.innerHTML = `
      ${isFav ? '<span class="epg-fav-star">★</span>' : ''}
      <img src="${logo}" onerror="this.style.display='none'" alt="">
      <span>${name}</span>`;
    label.onclick = () => { ch.click(); closeEPG(); };
    row.appendChild(label);

    const track = document.createElement('div');
    track.className = 'epg-progs';
    track.style.position  = 'relative';
    track.style.minWidth  = totalMins * PX_PER_MIN + 'px';
    track.style.height    = '100%';
    row.appendChild(track);
    rows.appendChild(row);

    if (epgCache[selectedDay][id]) {
      renderProgs(track, epgCache[selectedDay][id], id, ch);
    } else {
      // For "today" also load yesterday to get overnight programs
      const fetchDay = () => fetch(`/epg-data?id=${encodeURIComponent(id)}&full=true&date=${selectedDay}`)
        .then(r => r.json()).catch(() => []);

      if (selectedDay === dayStr(0)) {
        const ydStr = dayStr(-1);
        const fetchYd = () => {
          if (epgCache[ydStr]?.[id]) return Promise.resolve(epgCache[ydStr][id]);
          return fetch(`/epg-data?id=${encodeURIComponent(id)}&full=true&date=${ydStr}`)
            .then(r => r.json()).catch(() => []);
        };
        Promise.all([fetchYd(), fetchDay()]).then(([ydData, tdData]) => {
          if (!epgCache[ydStr]) epgCache[ydStr] = {};
          epgCache[ydStr][id] = ydData || [];

          // Overnight programs: those from yesterday that end after local midnight
          const midnight = getDayMidnight(selectedDay);
          const overnight = (ydData || []).filter(p => {
            const stop = parseEPG(p.stop);
            return stop && stop > midnight;
          });
          epgCache[selectedDay][id] = [...overnight, ...(tdData || [])];
          renderProgs(track, epgCache[selectedDay][id], id, ch);
          highlightCurrentInEPG();
        });
      } else {
        fetchDay().then(data => {
          epgCache[selectedDay][id] = data || [];
          renderProgs(track, data || [], id, ch);
          highlightCurrentInEPG();
        });
      }
    }
  });

  // Scroll after data loads
  setTimeout(scrollEPGToFocus, 300);
}

// ── SCROLL TO FOCUS — center on current time/program ──
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
  }

  if (targetMins == null && selectedDay === dayStr(0)) {
    targetMins = (Date.now() - midnight.getTime()) / 60000;
  }

  if (targetMins == null) targetMins = 12 * 60; // noon fallback

  // Center the target time in the viewport
  const targetPx = CH_W + targetMins * PX_PER_MIN;
  const centerOffset = scroll.clientWidth / 2;
  scroll.scrollLeft = Math.max(0, targetPx - centerOffset);
}

// ── RENDER PROGRAMS ───────────────────────
function renderProgs(track, programs, channelId, chEl) {
  if (!programs?.length) return;
  const now       = new Date();
  const currentId = window.getCurrentChannelId?.();
  const archData  = window.getCurrentArchiveData?.();
  const inArchive = window.getIsArchive?.();
  const midnight  = getDayMidnight(selectedDay);
  const dayEnd    = new Date(midnight.getTime() + 24*60*60*1000);

  programs.forEach(prog => {
    const start = parseEPG(prog.start);
    const stop  = parseEPG(prog.stop);
    if (!start || !stop || stop <= start) return;
    // Skip programs completely outside this day
    if (stop <= midnight || start >= dayEnd) return;

    // Clamp to day bounds
    const clampedStart = start < midnight ? midnight : start;
    const clampedStop  = stop  > dayEnd   ? dayEnd  : stop;

    const startMins = (clampedStart.getTime() - midnight.getTime()) / 60000;
    const endMins   = (clampedStop.getTime()  - midnight.getTime()) / 60000;
    if (endMins <= 0 || startMins >= 24*60) return;

    const left  = Math.max(0, startMins) * PX_PER_MIN;
    const width = Math.max(2, (endMins - Math.max(0, startMins)) * PX_PER_MIN - 2);

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
    }

    block.style.left  = left + 'px';
    block.style.width = width + 'px';

    const title = document.createElement('div');
    title.className   = 'epg-prog-title';
    title.textContent = prog.title;
    block.appendChild(title);

    // Desktop hover
    block.addEventListener('mouseenter', () => {
      if (window.matchMedia('(hover: none)').matches) return;
      showHoverPopup(prog, block);
    });
    block.addEventListener('mouseleave', () => {
      if (window.matchMedia('(hover: none)').matches) return;
      hideHoverPopup();
    });

    // Click → modal
    block.addEventListener('click', (e) => {
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
  } else if (!inArchive && selectedDay === dayStr(0)) {
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
  const dur = start && stop ? Math.round((stop - start) / 60000) + ' min' : '';
  popup.innerHTML = `
    <div class="epg-popup-time">${fmt(start)} – ${fmt(stop)}${dur ? ' · ' + dur : ''}</div>
    <div class="epg-popup-title">${prog.title || ''}</div>
    ${prog.desc ? `<div class="epg-popup-desc">${prog.desc.slice(0,130)}${prog.desc.length>130?'…':''}</div>` : ''}
    <div class="epg-popup-hint">Klikni pro přehrání</div>`;
  document.body.appendChild(popup);
  epgPopup = popup;
  const rect = blockEl.getBoundingClientRect();
  let top  = rect.bottom + 8;
  let left = rect.left;
  if (top + 160 > window.innerHeight) top = rect.top - 168;
  if (left + 270 > window.innerWidth)  left = window.innerWidth - 275;
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

  const isPast    = now >= stop;
  const isNowLive = now >= start && now < stop;
  const dur = start && stop ? Math.round((stop - start) / 60000) : 0;
  const canPlay   = isPast || isNowLive;
  const playLabel = isNowLive ? '▶ Sledovat živě' : '▶ Přehrát ze záznamu';

  overlay.innerHTML = `
    <div class="epg-modal">
      <button class="epg-modal-close"><i data-lucide="x"></i></button>
      ${prog.image ? `
        <div class="epg-modal-img">
          <img src="${prog.image}" alt="">
          <div class="epg-modal-badge ${isNowLive?'live':isPast?'past':'future'}">
            ${isNowLive ? '● LIVE' : isPast ? 'ZÁZNAM' : 'BRZY'}
          </div>
        </div>` : ''}
      <div class="epg-modal-body">
        <div class="epg-modal-time">${fmt(start)} – ${fmt(stop)}${dur ? ' · ' + dur + ' min' : ''}</div>
        <div class="epg-modal-title">${prog.title || ''}</div>
        <div class="epg-modal-desc">${prog.desc || 'Popis není k dispozici.'}</div>
        <div class="epg-modal-actions">
          ${canPlay
            ? `<button class="epg-modal-play">${playLabel}</button>`
            : `<div class="epg-modal-future">Pořad ještě nezačal</div>`}
          <button class="epg-modal-cancel">Zavřít</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  if (window.lucide) lucide.createIcons();

  overlay.querySelector('.epg-modal-close').onclick  = () => overlay.remove();
  overlay.querySelector('.epg-modal-cancel').onclick = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  if (canPlay) {
    overlay.querySelector('.epg-modal-play').onclick = () => {
      overlay.remove(); closeEPG();
      if (isNowLive) {
        if (chEl) { chEl.click(); }
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
