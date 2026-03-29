/* ═══════════════════════════════════════════
   ONEPRIMETV — epg-grid.js (Fixed 2026)
═══════════════════════════════════════════ */
'use strict';

const PX_PER_MIN = 6;
const CH_W = 150;
window.epgCache = {};

let selectedDay = todayStr();
let epgPopup = null; // current popup element

function todayStr() {
  const d = new Date();
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

// ── BUILD DAY TABS ────────────────────────
function buildDayTabs() {
  const c = document.getElementById('epg-days');
  if (!c) return;
  c.innerHTML = '';
  const labels = ['Včera', 'Dnes', 'Zítra'];
  for (let i = -1; i <= 1; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    const str = d.getFullYear() + (d.getMonth()+1).toString().padStart(2,'0') + d.getDate().toString().padStart(2,'0');
    const btn = document.createElement('button');
    btn.className = 'epg-day-btn' + (str === selectedDay ? ' active' : '');
    btn.textContent = labels[i+1];
    btn.onclick = () => {
      selectedDay = str;
      document.querySelectorAll('.epg-day-btn').forEach(b => b.classList.toggle('active', b === btn));
      buildGrid();
    };
    c.appendChild(btn);
  }
}

// ── MAIN RENDER ───────────────────────────
window.renderEPGGrid = function() {
  buildDayTabs();
  buildGrid();
};

function buildGrid() {
  const rows   = document.getElementById('epg-rows');
  const ruler  = document.getElementById('epg-time-ruler');
  const nowLine= document.getElementById('epg-now-line');
  if (!rows || !ruler) return;

  // Clear
  Array.from(rows.children).forEach(c => { if (c.id !== 'epg-now-line') c.remove(); });
  ruler.innerHTML = '';

  const totalMinutes = 24 * 60;
  const gridWidth = CH_W + totalMinutes * PX_PER_MIN;

  // Time ruler
  ruler.style.width = gridWidth + 'px';
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
  const isTodaySelected = selectedDay === todayStr();
  nowLine.style.display = isTodaySelected ? 'block' : 'none';
  if (isTodaySelected) {
    const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
    nowLine.style.left = CH_W + nowMins * PX_PER_MIN + 'px';
  }

  // Rows
  rows.style.minWidth = gridWidth + 'px';
  const channels = Array.from(document.querySelectorAll('.ch-item'));
  if (!channels.length) return;
  if (!epgCache[selectedDay]) epgCache[selectedDay] = {};

  channels.forEach(ch => {
    const id   = ch.dataset.id;
    const name = ch.querySelector('.ch-name')?.textContent || id;
    const logo = ch.querySelector('.ch-img')?.src || '';

    const row = document.createElement('div');
    row.className = 'epg-row';
    row.dataset.channelId = id;

    // Channel label
    const label = document.createElement('div');
    label.className = 'epg-ch-label';
    label.innerHTML = `<img src="${logo}" onerror="this.style.display='none'" alt=""><span>${name}</span>`;
    label.onclick = () => { ch.click(); closeEPG(); };
    row.appendChild(label);

    // Programs track
    const track = document.createElement('div');
    track.className = 'epg-progs';
    track.style.position = 'relative';
    track.style.minWidth = (totalMinutes * PX_PER_MIN) + 'px';
    row.appendChild(track);
    rows.appendChild(row);

    if (epgCache[selectedDay][id]) {
      renderProgs(track, epgCache[selectedDay][id], id, ch);
    } else {
      fetch(`/epg-data?id=${encodeURIComponent(id)}&full=true&date=${selectedDay}`)
        .then(r => r.json())
        .then(data => {
          epgCache[selectedDay][id] = data;
          renderProgs(track, data, id, ch);
          // If this is the active channel, highlight current program
          highlightCurrentInEPG();
        })
        .catch(() => {});
    }
  });

  // Scroll to current time or currently playing program
  setTimeout(() => {
    const scroll = document.getElementById('epg-scroll');
    if (!scroll) return;
    const currentChId = window.getCurrentChannelId?.();
    const archiveData = window.getCurrentArchiveData?.();
    const inArchive   = window.getIsArchive?.();

    if (inArchive && archiveData?.start && isTodaySelected) {
      // Scroll to the archive program being watched
      const startDate = parseEPG(archiveData.start);
      if (startDate) {
        const mins = startDate.getHours() * 60 + startDate.getMinutes();
        scroll.scrollLeft = Math.max(0, CH_W + mins * PX_PER_MIN - 100);
        return;
      }
    }
    // Scroll to current time
    if (isTodaySelected) {
      const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
      scroll.scrollLeft = Math.max(0, CH_W + nowMins * PX_PER_MIN - 200);
    }
  }, 100);

  highlightCurrentInEPG();
}

// ── RENDER PROGRAMS IN A ROW ──────────────
function renderProgs(track, programs, channelId, chEl) {
  if (!programs || !programs.length) return;
  const now = new Date();
  const currentChId   = window.getCurrentChannelId?.();
  const archiveData   = window.getCurrentArchiveData?.();
  const inArchive     = window.getIsArchive?.();

  programs.forEach(prog => {
    const start = parseEPG(prog.start);
    const stop  = parseEPG(prog.stop);
    if (!start || !stop) return;

    const startMins   = start.getHours() * 60 + start.getMinutes();
    const durationMins= Math.max(1, (stop - start) / 60000);
    const left = startMins * PX_PER_MIN;
    const width= Math.max(2, durationMins * PX_PER_MIN - 2);

    const block = document.createElement('div');
    block.className = 'epg-prog';
    block.dataset.progStart = prog.start;
    block.dataset.channelId = channelId;

    const isNowLive = now >= start && now < stop && selectedDay === todayStr();
    const isPast    = now >= stop;
    if (isNowLive) block.classList.add('current');
    if (isPast)    block.classList.add('past');

    // Highlight currently playing program (archive)
    if (inArchive && channelId === currentChId && archiveData) {
      const aStart = parseEPG(archiveData.start);
      const aStop  = parseEPG(archiveData.stop);
      if (aStart && aStop && Math.abs(start - aStart) < 60000) {
        block.classList.add('playing');
      }
    }

    block.style.left  = left + 'px';
    block.style.width = width + 'px';

    const title = document.createElement('div');
    title.className = 'epg-prog-title';
    title.textContent = prog.title;
    block.appendChild(title);

    // HOVER preview (desktop only)
    block.addEventListener('mouseenter', (e) => {
      if (window.matchMedia('(hover: none)').matches) return; // touch device — skip hover
      showProgPopup(prog, channelId, chEl, block, e);
    });
    block.addEventListener('mouseleave', () => {
      if (window.matchMedia('(hover: none)').matches) return;
      hideProgPopup();
    });

    // CLICK — show modal on all devices
    block.addEventListener('click', (e) => {
      e.stopPropagation();
      hideProgPopup();
      showProgModal(prog, channelId, chEl, start, stop, now);
    });

    track.appendChild(block);
  });
}

// ── HIGHLIGHT CURRENTLY PLAYING ───────────
function highlightCurrentInEPG() {
  const currentChId = window.getCurrentChannelId?.();
  const archiveData = window.getCurrentArchiveData?.();
  const inArchive   = window.getIsArchive?.();
  if (!currentChId) return;

  // Remove previous playing highlights
  document.querySelectorAll('.epg-prog.playing').forEach(el => el.classList.remove('playing'));

  if (inArchive && archiveData?.start) {
    const aStart = parseEPG(archiveData.start);
    document.querySelectorAll(`.epg-row[data-channel-id="${currentChId}"] .epg-prog`).forEach(block => {
      const bs = parseEPG(block.dataset.progStart);
      if (bs && aStart && Math.abs(bs - aStart) < 60000) block.classList.add('playing');
    });
  } else if (!inArchive) {
    // Highlight currently airing program for current channel
    const now = new Date();
    document.querySelectorAll(`.epg-row[data-channel-id="${currentChId}"] .epg-prog.current`).forEach(block => {
      block.classList.add('playing');
    });
  }
}

// ── HOVER POPUP (desktop) ─────────────────
function showProgPopup(prog, channelId, chEl, blockEl, e) {
  hideProgPopup();
  const popup = document.createElement('div');
  popup.id = 'epg-hover-popup';
  popup.className = 'epg-hover-popup';

  const start = parseEPG(prog.start), stop = parseEPG(prog.stop);
  const dur = start && stop ? Math.round((stop - start) / 60000) + ' min' : '';

  popup.innerHTML = `
    <div class="epg-popup-time">${fmt(start)} – ${fmt(stop)} ${dur ? '· ' + dur : ''}</div>
    <div class="epg-popup-title">${prog.title || ''}</div>
    ${prog.desc ? `<div class="epg-popup-desc">${prog.desc.slice(0, 120)}${prog.desc.length > 120 ? '…' : ''}</div>` : ''}
    <div class="epg-popup-hint">Klikni pro více možností</div>
  `;

  document.body.appendChild(popup);
  epgPopup = popup;

  // Position near mouse
  const rect = blockEl.getBoundingClientRect();
  let top = rect.bottom + 8;
  let left = rect.left;
  if (top + 150 > window.innerHeight) top = rect.top - 158;
  if (left + 260 > window.innerWidth) left = window.innerWidth - 270;
  popup.style.top  = top + 'px';
  popup.style.left = left + 'px';
}

function hideProgPopup() {
  if (epgPopup) { epgPopup.remove(); epgPopup = null; }
}

// ── PROGRAM MODAL (click) ─────────────────
function showProgModal(prog, channelId, chEl, start, stop, now) {
  // Remove existing modal
  document.getElementById('epg-modal-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'epg-modal-overlay';
  overlay.className = 'epg-modal-overlay';

  const isPast    = now >= stop;
  const isNowLive = now >= start && now < stop;
  const isFuture  = now < start;
  const dur = start && stop ? Math.round((stop - start) / 60000) : 0;

  const canPlay = isPast || isNowLive;
  const playLabel = isNowLive ? '▶ Sledovat živě' : isPast ? '▶ Přehrát ze záznamu' : '';

  overlay.innerHTML = `
    <div class="epg-modal">
      <button class="epg-modal-close"><i data-lucide="x"></i></button>
      ${prog.image ? `<div class="epg-modal-img"><img src="${prog.image}" alt=""><div class="epg-modal-badge ${isNowLive ? 'live' : isPast ? 'past' : 'future'}">${isNowLive ? '● LIVE' : isPast ? 'ZÁZNAM' : 'BRZY'}</div></div>` : ''}
      <div class="epg-modal-body">
        <div class="epg-modal-time">${fmt(start)} – ${fmt(stop)}${dur ? ' · ' + dur + ' min' : ''}</div>
        <div class="epg-modal-title">${prog.title || ''}</div>
        ${prog.desc ? `<div class="epg-modal-desc">${prog.desc}</div>` : '<div class="epg-modal-desc" style="color:var(--c-text3)">Popis není k dispozici.</div>'}
        <div class="epg-modal-actions">
          ${canPlay ? `<button class="epg-modal-play">${playLabel}</button>` : `<div class="epg-modal-future">Pořad ještě nezačal</div>`}
          <button class="epg-modal-cancel">Zavřít</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  if (window.lucide) lucide.createIcons();

  // Close handlers
  overlay.querySelector('.epg-modal-close').onclick = () => overlay.remove();
  overlay.querySelector('.epg-modal-cancel').onclick = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  // Play handler
  if (canPlay) {
    overlay.querySelector('.epg-modal-play').onclick = () => {
      overlay.remove();
      closeEPG();
      if (isNowLive) {
        // Play live
        if (chEl) {
          window.isArchive = false; window.currentArchiveData = null;
          chEl.click();
        }
      } else {
        // Play from archive
        if (chEl) {
          const startUnix = Math.floor(start.getTime() / 1000);
          playStream(chEl.dataset.url,
            chEl.querySelector('.ch-name')?.textContent || '',
            chEl.querySelector('.ch-img')?.src || '',
            channelId, startUnix, prog);
        }
      }
    };
  }
}

// Close all EPG UI on sheet close
const origClose = window.closeEPG;
window.closeEPG = function() {
  hideProgPopup();
  document.getElementById('epg-modal-overlay')?.remove();
  if (origClose) origClose();
  else {
    document.getElementById('epg-sheet')?.classList.add('sheet-hidden');
    document.getElementById('epg-backdrop')?.classList.add('hidden');
  }
};
