/* ═══════════════════════════════════════════
   ONEPRIMETV — epg-grid.js (Redesign 2026)
═══════════════════════════════════════════ */

'use strict';

const PX_PER_MIN = 5;
const CH_LABEL_W = 150;
window.epgCache = {};

let selectedDay = todayStr();

function todayStr(){
  const d=new Date();
  return d.getFullYear()+(d.getMonth()+1).toString().padStart(2,'0')+d.getDate().toString().padStart(2,'0');
}

function buildDayButtons(){
  const container=document.getElementById('epg-days');
  if(!container) return;
  container.innerHTML='';
  const now=new Date();
  for(let i=-1;i<=1;i++){
    const d=new Date();d.setDate(now.getDate()+i);
    const str=d.getFullYear()+(d.getMonth()+1).toString().padStart(2,'0')+d.getDate().toString().padStart(2,'0');
    const label=i===-1?'Včera':i===0?'Dnes':'Zítra';
    const btn=document.createElement('button');
    btn.className='epg-day-btn'+(str===selectedDay?' active':'');
    btn.textContent=label;
    btn.onclick=()=>{
      selectedDay=str;
      document.querySelectorAll('.epg-day-btn').forEach(b=>b.classList.toggle('active',b.textContent===label));
      renderEPGGrid();
    };
    container.appendChild(btn);
  }
}

window.renderEPGGrid = async function(){
  buildDayButtons();
  const rows=document.getElementById('epg-rows');
  const ruler=document.getElementById('epg-time-ruler');
  const nowLine=document.getElementById('epg-now-line');
  if(!rows||!ruler) return;

  // Clear rows but keep now-line
  Array.from(rows.children).forEach(c=>{ if(c.id!=='epg-now-line') c.remove(); });
  ruler.innerHTML='';

  // Build time ruler (00:00 - 23:30 every 30 min)
  for(let h=0;h<24;h++){
    for(let m=0;m<60;m+=30){
      const label=document.createElement('div');
      label.className='epg-time-mark';
      const minutesFromMidnight=h*60+m;
      label.style.left=CH_LABEL_W+(minutesFromMidnight*PX_PER_MIN)+'px';
      label.textContent=h.toString().padStart(2,'0')+':'+m.toString().padStart(2,'0');
      ruler.appendChild(label);
    }
  }
  const totalW=CH_LABEL_W+24*60*PX_PER_MIN;
  ruler.style.width=totalW+'px';
  rows.style.width=totalW+'px';

  // Position now-line
  const nowMins=new Date().getHours()*60+new Date().getMinutes();
  const isTodaySelected=selectedDay===todayStr();
  nowLine.style.display=isTodaySelected?'block':'none';
  nowLine.style.left=CH_LABEL_W+(nowMins*PX_PER_MIN)+'px';

  // Get channels
  const channels=Array.from(document.querySelectorAll('.ch-item'));
  if(!channels.length){ rows.innerHTML+='<div style="padding:20px;color:var(--c-text2);font-size:.83rem;">Žádné kanály k zobrazení</div>'; return; }

  if(!epgCache[selectedDay]) epgCache[selectedDay]={};

  for(const ch of channels){
    const id=ch.dataset.id;
    const name=ch.querySelector('.ch-name')?.textContent||id;
    const logo=ch.querySelector('img')?.src||'';

    const row=document.createElement('div');
    row.className='epg-row';

    const label=document.createElement('div');
    label.className='epg-ch-label';
    label.innerHTML=`<img src="${logo}" onerror="this.style.display='none'" alt=""><span>${name}</span>`;
    label.onclick=()=>ch.click();
    row.appendChild(label);

    const progs=document.createElement('div');
    progs.className='epg-progs';
    progs.style.position='relative';
    row.appendChild(progs);
    rows.appendChild(row);

    // Load EPG data
    if(!epgCache[selectedDay][id]){
      fetch(`/epg-data?id=${encodeURIComponent(id)}&full=true&date=${selectedDay}`)
        .then(r=>r.json())
        .then(data=>{
          epgCache[selectedDay][id]=data;
          renderRowPrograms(progs, data, id, ch);
        })
        .catch(()=>{});
    } else {
      renderRowPrograms(progs, epgCache[selectedDay][id], id, ch);
    }
  }
};

function renderRowPrograms(container, programs, channelId, chEl){
  if(!programs||!programs.length) return;
  const now=new Date();

  programs.forEach(prog=>{
    const start=parseEPGDate2(prog.start);
    const stop=parseEPGDate2(prog.stop);
    if(!start||!stop) return;

    const startMins=start.getHours()*60+start.getMinutes();
    const durationMins=(stop-start)/(1000*60);
    if(durationMins<=0) return;

    const left=startMins*PX_PER_MIN;
    const width=Math.max(2, durationMins*PX_PER_MIN-2);

    const block=document.createElement('div');
    block.className='epg-prog';
    if(now>=start&&now<stop) block.classList.add('current');
    if(now>=stop) block.classList.add('past');

    block.style.left=left+'px';
    block.style.width=width+'px';

    const title=document.createElement('div');
    title.className='epg-prog-title';
    title.textContent=prog.title;
    block.appendChild(title);

    block.addEventListener('mouseenter',()=>showEPGPreview(prog));
    block.addEventListener('mouseleave',()=>hideEPGPreview());

    block.onclick=(e)=>{
      e.stopPropagation();
      const isTodaySelected = selectedDay===todayStr();
      const isArchivable = now > stop || (now >= start && now < stop);
      if(!isTodaySelected || (isTodaySelected && now > start)){
        // Play from archive
        const startUnix=Math.floor(start.getTime()/1000);
        if(chEl){
          const url=chEl.dataset.url;
          const name=chEl.querySelector('.ch-name')?.textContent||'';
          const logo=chEl.querySelector('img')?.src||'';
          playStream(url,name,logo,channelId,startUnix,prog);
          closeEPG();
        }
      }
    };

    container.appendChild(block);
  });
}

function showEPGPreview(prog){
  const preview=document.getElementById('epg-preview');
  const img=document.getElementById('epg-prev-img');
  const time=document.getElementById('epg-prev-time');
  const title=document.getElementById('epg-prev-title');
  const desc=document.getElementById('epg-prev-desc');
  if(!preview) return;

  if(prog.image){ img.src=prog.image; img.style.display='block'; }
  else img.style.display='none';

  time.textContent=fmtEPGTime(prog.start)+' – '+fmtEPGTime(prog.stop);
  title.textContent=prog.title||'';
  desc.textContent=prog.desc||'Popis není k dispozici.';
  preview.classList.remove('hidden');
}
function hideEPGPreview(){
  const preview=document.getElementById('epg-preview');
  if(preview) preview.classList.add('hidden');
}

// Helpers
function parseEPGDate2(s){
  if(!s) return null;
  const t=s.split(' ')[0];
  return new Date(+t.slice(0,4),+t.slice(4,6)-1,+t.slice(6,8),+t.slice(8,10),+t.slice(10,12),+(t.slice(12,14)||0));
}
function fmtEPGTime(s){
  const d=parseEPGDate2(s);
  if(!d) return '--:--';
  return d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0');
}

// Scroll EPG to current time on open
document.getElementById('btn-epg')?.addEventListener('click',()=>{
  setTimeout(()=>{
    const scroll=document.getElementById('epg-scroll');
    if(!scroll) return;
    const nowMins=new Date().getHours()*60+new Date().getMinutes();
    const scrollTo=CH_LABEL_W+(nowMins*PX_PER_MIN)-200;
    scroll.scrollLeft=Math.max(0,scrollTo);
  },300);
});
