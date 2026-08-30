/* ─────────────────────────────────────────────────────────────
   בונה את vichy.ics ו-vichy-lite.ics ישירות מ-index.html שבמאגר.
   אין תלות חיצונית. רץ על ראנר של GitHub Actions.
   קלט אופציונלי: shifts.json  → {"30":[0,0,0,1,0,1,0], ...}
                  (7 ספרות ליום ראשון..שבת; 1 = משמרת לילה בלילה הזה)
   ───────────────────────────────────────────────────────────── */
import fs from 'fs';

const HTML = fs.readFileSync('index.html', 'utf8');
const i = HTML.lastIndexOf('<script>');
const j = HTML.indexOf('/* ============ INIT ============ */');
if (i < 0 || j < i) throw new Error('לא נמצא בלוק הסקריפט ב-index.html');
const SRC = HTML.slice(i + 8, j);

/* --- מעטפת: מספקת את מה שהדפדפן היה מספק --- */
/* --- מעטפת: הדף כבר מגדיר PROG/sKey/isDone וכו׳ — צריך רק את מה שהדפדפן נותן --- */
/* --- מעטפת: הדף כבר מגדיר PROG/sKey/isDone וכו׳.
       כאן רק מה שהדפדפן נותן. querySelector מחזיר אובייקט־בלימה שסופג כל שרשור,
       ו-getElementById מחזיר null כדי שפונקציות הציור ייצאו מיד. --- */
const PRE = `
const __sink=new Proxy(function(){},{
  get:(t,k)=>{ if(k==='length') return 0;
               if(k===Symbol.toPrimitive||k==='toString'||k==='valueOf') return ()=>'';
               if(k===Symbol.iterator) return function*(){};
               return __sink; },
  set:()=>true, apply:()=>__sink, construct:()=>__sink });
const localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
const document={querySelector:()=>__sink,querySelectorAll:()=>[],getElementById:()=>null,
  addEventListener:()=>{},createElement:()=>__sink,documentElement:__sink,body:__sink,
  head:__sink,title:''};
const window={addEventListener:()=>{},matchMedia:()=>({matches:false,addEventListener(){}}),
  location:{protocol:'file:',hostname:''},navigator:{}};
const navigator={};
const requestAnimationFrame=f=>0;
`;
const API = new Function(PRE + SRC + `
  return {WEEKS,sessionsFor,planWeekAdaptive,weekDates,fuelFor,recoveryFor,MM,PH_META,
          ctxOf,DAYNAME,dayType,dayTarget,heatWeek,rpeOf,PROG};`)();

/* --- אילוצים שהוזנו באתר (מסונכרן משם אוטומטית) --- */
if (fs.existsSync('shifts.json')) {
  const raw = JSON.parse(fs.readFileSync('shifts.json', 'utf8'));
  const cons = {};
  for (const [wk, v] of Object.entries(raw)) {
    if (wk.startsWith('_')) continue;                       /* הערות */
    const arr = Array.isArray(v) ? v : v && v.shift;        /* שתי הצורות נתמכות */
    const pre = (v && !Array.isArray(v) && v.day) || null;
    if (!Array.isArray(arr) || arr.length !== 7) { console.warn('shifts.json: שבוע', wk, 'לא תקין — דולג'); continue; }
    const days = {};
    for (let d = 0; d < 7; d++) {
      days[d] = { shift: arr[d] ? 1 : 0 };
      if (pre && pre[d] && pre[d] !== 'norm') days[d].p = pre[d];
    }
    cons[wk] = { days, ts: Date.now() };
    if (v && !Array.isArray(v) && v.place) cons[wk].place = v.place;   /* סידור ידני מהאתר */
  }
  API.PROG.cons = cons;
  console.log('shifts.json נטען · שבועות:', Object.keys(cons).join(', ') || '—');
}

/* --- כתיבת ICS --- */
const VER  = process.env.VER || String(Math.floor(Date.now() / 864e5));
const LIVE = 'https://natanelaz.github.io/ironman-vichy/';
const LITE = process.env.LITE === '1';
const OUT  = process.env.OUTF || 'vichy.ics';

const ICON = {swim:'🏊',bike:'🚴',run:'🏃',str:'🏋️',str2:'🏋️',mob:'🧘',race:'🏁'};
const CAT  = {swim:'שחייה',bike:'אופניים',run:'ריצה',str:'כוח',str2:'כוח',mob:'ניידות',race:'מרוץ'};
const SHORT= {bikeLong:'רכיבה ארוכה',runBrick:'Brick',runBrick2:'ריצת מעבר',runLong:'ריצה ארוכה',
  bikeKey:'אופניים איכות',bikeEnd:'אופניים נפח',bikeSpin:'ספין שחרור',swimA:'שחייה סטים',
  swimB:'שחיית ים',swimB2:'שחיית ים',swimC:'שחייה קלה',runEasy:'ריצה קלה',
  str:'כוח רגליים',str2:'כוח ליבה',mob:'ניידות',race:'מרוץ'};
const RLBL = {bikeLong:'הרכיבה הארוכה',bikeKey:'אימון האיכות באופניים',bikeEnd:'רכיבת הנפח',
  swimA:'שחיית הסט העיקרי',swimB:'שחיית הים',str:'כוח #1',runLong:'הריצה הארוכה'};

const strip = s => String(s).replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
const esc   = s => String(s).replace(/\\/g,'\\\\').replace(/;/g,'\;').replace(/,/g,'\\,').replace(/\r?\n/g,'\\n');
const pad   = n => String(n).padStart(2,'0');
function fold(line){ const b=Buffer.from(line,'utf8'); if(b.length<=73) return line;
  const out=[]; let k=0, first=true;
  while(k<b.length){ const max=first?73:72; let e=Math.min(k+max,b.length);
    while(e>k&&(b[e]&0xC0)===0x80) e--;
    out.push((first?'':' ')+b.slice(k,e).toString('utf8')); k=e; first=false; }
  return out.join('\r\n'); }
const stamp = (d,h)=>{const hh=Math.floor(h),mm=Math.round((h-hh)*60);
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(hh)}${pad(mm)}00`;};
const HM = m => { const h=Math.floor(m/60), x=Math.round(m%60); return h?`${h}:${pad(x)}`:`${x} דק׳`; };
const shortName = s => s.role==='race'
  ? strip(s.title).replace(/^מרוץ הכנה · /,'').replace(/ · יום ראשון.*$/,'')
  : (SHORT[s.role]||strip(s.title).replace(/^[^·]+· /,''));

const L=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Vichy 2027//Ironman Plan//HE','CALSCALE:GREGORIAN','METHOD:PUBLISH',
 fold('X-WR-CALNAME:Vichy 2027 · אימונים'+(LITE?' (מקוצר)':'')),'X-WR-TIMEZONE:Asia/Jerusalem',
 'REFRESH-INTERVAL;VALUE=DURATION:PT6H','X-PUBLISHED-TTL:PT6H',
 fold('X-WR-CALDESC:'+esc(`תוכנית 52 שבועות ל-IRONMAN Vichy · נבנה אוטומטית ${new Date().toISOString().slice(0,10)} · אירוע נפרד לכל אימון · ${LIVE}`)),
 'BEGIN:VTIMEZONE','TZID:Asia/Jerusalem',
 'BEGIN:STANDARD','DTSTART:19701025T020000','TZOFFSETFROM:+0300','TZOFFSETTO:+0200','RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU','END:STANDARD',
 'BEGIN:DAYLIGHT','DTSTART:19700327T020000','TZOFFSETFROM:+0200','TZOFFSETTO:+0300','RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1FR','END:DAYLIGHT',
 'END:VTIMEZONE'];

let count=0;
for (const w of API.WEEKS) {
  const {days} = API.planWeekAdaptive(w.n), dates = API.weekDates(w.n);
  days.forEach((D,di)=>{
    const items = D.items.filter(it=>!(w.n===52&&it.s.role==='race'));
    if(!items.length) return;
    const day=dates[di], dayMin=items.reduce((a,x)=>a+x.s.dur,0);
    const dt=API.dayType(dayMin), tg=API.dayTarget(dt), ctx=API.ctxOf(w.n,di);
    const blocks=items.filter(x=>x.s.t!=='mob'&&!x.s.after).length;
    const seen={};
    items.forEach((it,ix)=>{
      const s=it.s, f=API.fuelFor(s,w), rv=API.recoveryFor(s,w);
      const k=(seen[s.role]=(seen[s.role]||0)+1), suff=k>1?'-'+k:'';
      const cont=!!s.after, P=[];
      P.push(`שבוע ${w.n}/52 · ${API.PH_META[w.ph].n}${w.rec?' · שבוע התאוששות':''}${w.race?' · שבוע מרוץ':w.prep?' · שבוע עם מרוץ הכנה':''}`);
      P.push(`${ctx.t} · ${blocks===1?'בלוק אחד':blocks+' בלוקים'} ביום · סה"כ ${HM(dayMin)}`);
      if(cont) P.push(`◆ החלק השני של אימון משולב — ${s.after.gap?`${Math.round(s.after.gap*60)} דקות`:'מיד'} אחרי ${RLBL[s.after.role]||s.after.role}.`);
      P.push('');
      P.push(`${HM(s.dur)} · RPE ${s.rpe}${s.dist&&s.dist!=='—'?' · '+strip(s.dist):''}${s.where?' · '+strip(s.where):''}`);
      P.push('');
      if(LITE){
        P.push(strip(s.blocks[0]||''));
        if(f&&f.cho) P.push(`תזונה תוך כדי: ${f.cho} ג׳ פחמימה/שעה · ${f.fl} מ״ל/שעה · ${f.na} מ״ג נתרן/שעה`);
        if(rv) P.push(`מנוחה אחרי: ${rv.next}ש׳ לעומס דומה · ${rv.quality}ש׳ לאיכות באותו ענף`);
      } else {
        s.blocks.forEach(x=>P.push(strip(x)));
        if(s.target) P.push('', '◆ '+strip(s.target));
        (s.cues||[]).forEach(c=>P.push('• '+strip(c)));
        if(f) P.push('', `תזונה — לפני: ${strip(f.pre)}`, `במהלך: ${strip(f.during)}`, `אחרי: ${strip(f.post)}`);
        if(rv) P.push('', `מנוחה אחרי: ${rv.same}ש׳ לאימון קל בענף אחר · ${rv.next}ש׳ לעומס דומה · ${rv.quality}ש׳ לאיכות באותו ענף`);
        if(ix===0) P.push('', `━━━ תזונה יומית · ${dt.n}`,
          `${tg.kcal.toLocaleString('en-US')} קק"ל · ${tg.cho} ג׳ פחמימה · ${tg.pro} ג׳ חלבון · ${tg.fat} ג׳ שומן`,
          `נוזלים ${(2.5+dayMin/60*(API.heatWeek(w.n)?0.85:0.6)).toFixed(1)} ליטר · נתרן ${(Math.round((2500+dayMin/60*(API.heatWeek(w.n)?900:550))/10)*10).toLocaleString('en-US')} מ"ג`);
        P.push('', 'הדף המלא: '+LIVE);
      }
      const st=it.st-di*24, en=Math.min(it.en-di*24,23.9);
      const ev=['BEGIN:VEVENT',
        `UID:vichy-w${w.n}-d${di}${ix===0?'':'-'+s.role+suff}@vichy2027`,
        `SEQUENCE:${VER}`,'DTSTAMP:'+new Date().toISOString().replace(/[-:]/g,'').slice(0,15)+'Z',
        `DTSTART;TZID=Asia/Jerusalem:${stamp(day,st)}`,
        `DTEND;TZID=Asia/Jerusalem:${stamp(day,en)}`,
        fold(`SUMMARY:${ICON[s.t]} ${cont?'↳ ':''}${esc(shortName(s))} · ${HM(s.dur)}`),
        fold(`DESCRIPTION:${esc(P.join('\n'))}`),
        fold(`LOCATION:${esc(strip(s.where||'').replace(/^—$/,''))}`),
        fold(`URL;VALUE=URI:${LIVE}`),
        `CATEGORIES:${CAT[s.t]||'אימון'}`,'TRANSP:OPAQUE'];
      if(!cont&&s.t!=='mob') ev.push('BEGIN:VALARM','TRIGGER:-PT45M','ACTION:DISPLAY',
        fold(`DESCRIPTION:${esc('בעוד 45 דק׳: '+shortName(s)+' · '+HM(s.dur))}`),'END:VALARM');
      ev.push('END:VEVENT'); L.push(...ev); count++;
    });
  });
}
L.push('BEGIN:VEVENT','UID:vichy-raceday@vichy2027',`SEQUENCE:${VER}`,
 'DTSTAMP:'+new Date().toISOString().replace(/[-:]/g,'').slice(0,15)+'Z',
 'DTSTART;TZID=Asia/Jerusalem:20270822T064000','DTEND;TZID=Asia/Jerusalem:20270822T203000',
 fold('SUMMARY:🏁 IRONMAN VICHY · יום המרוץ'),
 fold('DESCRIPTION:'+esc(['3.8 ק"מ שחייה ללא חליפה · 180 ק"מ עם כ-2,400 מ׳ טיפוס · מרתון בחום',
  'השכמה 04:00 · זינוק 06:40','','יעד עבודה 13:45 · חלון ריאלי 13:15–14:30'].join('\n'))),
 'LOCATION:Vichy\\, France',fold(`URL;VALUE=URI:${LIVE}`),'CATEGORIES:מרוץ','TRANSP:OPAQUE',
 'BEGIN:VALARM','TRIGGER:-P1D','ACTION:DISPLAY',fold('DESCRIPTION:'+esc('מחר: IRONMAN VICHY · השכמה 04:00')),'END:VALARM',
 'END:VEVENT','END:VCALENDAR');

fs.writeFileSync(OUT, L.join('\r\n')+'\r\n');
console.log(OUT, '· אירועים:', count+1, '· בייטים:', fs.statSync(OUT).size);
