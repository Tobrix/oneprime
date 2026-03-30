/* ═══════════════════════════════════════════
   ONEPRIMETV — epg-grid.js (Fix v3)
═══════════════════════════════════════════ */
'use strict';

const PX_PER_MIN = 6;
const CH_W = 150;
window.epgCache = {};

// Track selected day — always reset to "current" day when opening
let selectedDay = todayStr();
let epgPopup    = null;

function todayStr() {
  const d = new Date();
  return d.getFullYear() + (d.getMonth()+1).toString().padStart(2,'0') + d.getDate().toString().padStart(2,'0');
}
function yesterdayStr() {
  const d = new Date(); d.setDate(d.getDate()-1);
  return d.getFullYear() + (d.getMonth()+1).toString().padStart(2,'0') + d.getDate().toString().padStart(2,'0');
}
function tomorrowStr() {
  const d = new Date(); d.setDate(d.getDate()+1);
  return d.getFullYear() + (d.getMonth()+1).toString().padStart(2,'0') + d.getDate().toString().padStart(2,'0');
}

function parseEPG(s) {
  if (!s) return null;
  const t = s.split(' ')[0];
  return new Date(+t.slice(0,4), +t.slice(4,6)-1, +t.slice(6,8), +t.slice(8,10), +t.slice(10,12), +(t.slice(12,14)||0));
}
function fmt(d) {
  if (!d) return '--:--';
  return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
}

// ── DAY TABS ──────────────────────────────
function buildDayTabs() {
  const c = document.getElementById('epg-days');
  if (!c) return;
  c.innerHTML = '';
  const days = [
    { label: 'Včera', str: yesterdayStr() },
    { label: 'Dnes',  str: todayStr()     },
    { label: 'Zítra', str: tomorrowStr()  },
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

// ── MAIN ENTRY ────────────────────────────
window.renderEPGGrid = function() {
  // Auto-set selected day based on what's playing
  const inArchive   = window.getIsArchive?.();
  const archiveData = window.getCurrentArchiveData?.();
  if (inArchive && archiveData?.start) {
    const d = parseEPG(archiveData.start);
    if (d) {
      selectedDay = d.getFullYear() + (d.getMonth()+1).toString().padStart(2,'0') + d.getDate().toString().padStart(2,'0');
    }
  } else {
    selectedDay = todayStr();
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

  // Clear
  Array.from(rows.children).forEach(c => { if (c.id !== 'epg-now-line') c.remove(); });
  ruler.innerHTML = '';

  const totalMins  = 24 * 60;
  const gridWidth  = CH_W + totalMins * PX_PER_MIN;
  ruler.style.width = gridWidth + 'px';
  rows.style.minWidth = gridWidth + 'px';

  // Time ruler marks every 30 min
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const mark = document.createElement('div');
      mark.className = 'epg-time-mark';
      mark.style.left = CH_W + (h * 60 + m) * PX_PER_MIN + 'px';
      mark.textContent = h.toString().padStart(2,'0') + ':' + m.toString().padStart(2,'0');
      ruler.appendChild(mark);
    }
  }

  // Now line
  const isToday = selectedDay === todayStr();
  nowLine.style.display = isToday ? 'block' : 'none';
  if (isToday) {
    const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
    nowLine.style.left = CH_W + nowMins * PX_PER_MIN + 'px';
  }

  // Render channel rows
  const channels = Array.from(document.querySelectorAll('.ch-item'));
  if (!channels.length) return;
  if (!epgCache[selectedDay]) epgCache[selectedDay] = {};

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
    track.style.minWidth = totalMins * PX_PER_MIN + 'px';
    row.appendChild(track);
    rows.appendChild(row);

    if (epgCache[selectedDay][id]) {
      renderProgs(track, epgCache[selectedDay][id], id, ch);
    } else {
      fetch(`/epg-data?id=${encodeURIComponent(id)}&full=true&date=${selectedDay}`)
        .then(r => r.json())
        .then(data => {
          // For "today" also include programs from "yesterday" that bleed into today (past midnight)
          if (selectedDay === todayStr() && !epgCache[yesterdayStr()]?.[id]) {
            return fetch(`/epg-data?id=${encodeURIComponent(id)}&full=true&date=${yesterdayStr()}`)
              .then(r2 => r2.json())
              .then(ydData => {
                if (!epgCache[yesterdayStr()]) epgCache[yesterdayStr()] = {};
                epgCache[yesterdayStr()][id] = ydData || [];
                // Merge: yesterday programs that end today
                const midnight = new Date(); midnight.setHours(0,0,0,0);
                const bleeding = (ydData || []).filter(p => {
                  const stop = parseEPG(p.stop);
                  return stop && stop > midnight;
                });
                epgCache[selectedDay][id] = [...bleeding, ...(data || [])];
                renderProgs(track, epgCache[selectedDay][id], id, ch);
                highlightCurrentInEPG();
              });
          }
          epgCache[selectedDay][id] = data || [];
          renderProgs(track, epgCache[selectedDay][id], id, ch);
          highlightCurrentInEPG();
        })
        .catch(() => {});
    }
  });

  // Scroll after short delay
  setTimeout(() => scrollEPGToFocus(), 200);
}

// ── SCROLL TO FOCUS ───────────────────────
function scrollEPGToFocus() {
  const scroll     = document.getElementById('epg-scroll');
  if (!scroll) return;
  const inArchive  = window.getIsArchive?.();
  const archData   = window.getCurrentArchiveData?.();
  const isToday    = selectedDay === todayStr();

  if (inArchive && archData?.start) {
    const d = parseEPG(archData.start);
    if (d) {
      const mins = d.getHours() * 60 + d.getMinutes();
      // Scroll so playing program is ~1/3 from left
      scroll.scrollLeft = Math.max(0, CH_W + mins * PX_PER_MIN - scroll.clientWidth * 0.33);
      return;
    }
  }
  if (isToday) {
    const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
    scroll.scrollLeft = Math.max(0, CH_W + nowMins * PX_PER_MIN - scroll.clientWidth * 0.33);
  }
}

// ── RENDER PROGRAMS ───────────────────────
function renderProgs(track, programs, channelId, chEl) {
  if (!programs?.length) return;
  const now        = new Date();
  const currentId  = window.getCurrentChannelId?.();
  const archData   = window.getCurrentArchiveData?.();
  const inArchive  = window.getIsArchive?.();

  programs.forEach(prog => {
    const start = parseEPG(prog.start);
    const stop  = parseEPG(prog.stop);
    if (!start || !stop || stop <= start) return;

    // Position within the 24h grid for selectedDay
    const dayStart  = new Date(start);
    dayStart.setFullYear(+selectedDay.slice(0,4), +selectedDay.slice(4,6)-1, +selectedDay.slice(6,8));
    dayStart.setHours(0,0,0,0);

    const startMins = Math.max(0, (start - dayStart) / 60000);
    const endMins   = Math.min(24*60, (stop - dayStart) / 60000);
    if (endMins <= 0 || startMins >= 24*60) return;

    const left  = startMins * PX_PER_MIN;
    const width = Math.max(2, (endMins - startMins) * PX_PER_MIN - 2);

    const block = document.createElement('div');
    block.className = 'epg-prog';
    block.dataset.progStart = prog.start;
    block.dataset.channelId = channelId;

    const isNowLive = now >= start && now < stop && selectedDay === todayStr();
    const isPast    = now >= stop;
    if (isNowLive) block.classList.add('current');
    if (isPast)    block.classList.add('past');

    // Highlight currently playing
    if (inArchive && channelId === currentId && archData) {
      const aStart = parseEPG(archData.start);
      if (aStart && Math.abs(start - aStart) < 60000) block.classList.add('playing');
    } else if (!inArchive && isNowLive && channelId === currentId) {
      block.classList.add('playing');
    }

    block.style.left  = left + 'px';
    block.style.width = width + 'px';

    const title = document.createElement('div');
    title.className   = 'epg-prog-title';
    title.textContent = prog.title;
    block.appendChild(title);

    // Desktop hover popup
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
      if (bs && aStart && Math.abs(bs - aStart) < 60000) block.classList.add('playing');
    });
  } else if (!inArchive && selectedDay === todayStr()) {
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
  const dur = start && stop ? Math.round((stop-start)/60000) + ' min' : '';
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
  const dur = start && stop ? Math.round((stop-start)/60000) : 0;
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
        // Go live
        if (chEl) { window.isArchive = false; window.currentArchiveData = null; chEl.click(); }
      } else {
        // Archive
        if (chEl) {
          playStream(chEl.dataset.url,
            chEl.querySelector('.ch-name')?.textContent.replace('★','').trim() || '',
            chEl.querySelector('.ch-img')?.src || '',
            channelId, Math.floor(start.getTime()/1000), prog);
        }
      }
    };
  }
}

// ── CLOSE OVERRIDE ────────────────────────
const _origClose = window.closeEPG;
window.closeEPG = function() {
  hideHoverPopup();
  document.getElementById('epg-modal-overlay')?.remove();
  const sheet = document.getElementById('epg-sheet');
  const bd    = document.getElementById('epg-backdrop');
  if (sheet) sheet.classList.add('sheet-hidden');
  if (bd)    bd.classList.add('hidden');
};
