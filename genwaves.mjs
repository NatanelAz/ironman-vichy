/* ─────────────────────────────────────────────────────────────
   waves.ics — מצב הים בתל אביב, אירוע אחד ליום
   שימוש:  node genwaves.mjs waves-data.json [waves.ics]
   מיזוג:  אם קובץ הפלט כבר קיים, ימים ישנים נשמרים ורק
           הימים שבתחזית החדשה נדרסים. כך ההיסטוריה לא נמחקת.
   ───────────────────────────────────────────────────────────── */
import fs from 'fs';

const IN  = process.argv[2] || 'waves-data.json';
const OUT = process.argv[3] || 'waves.ics';
const D   = JSON.parse(fs.readFileSync(IN, 'utf8'));

/* ---------- עזרי ICS ---------- */
const esc = s => String(s).replace(/\\/g,'\\\\').replace(/;/g,'\;').replace(/,/g,'\\,').replace(/\r?\n/g,'\\n');
function fold(line){
  const b = Buffer.from(line,'utf8'); if (b.length <= 73) return line;
  const out=[]; let i=0, first=true;
  while(i<b.length){ const max=first?73:72; let j=Math.min(i+max,b.length);
    while(j>i && (b[j]&0xC0)===0x80) j--;
    out.push((first?'':' ')+b.slice(i,j).toString('utf8')); i=j; first=false; }
  return out.join('\r\n');
}
const pad = n => String(n).padStart(2,'0');
const ymd = s => s.replace(/-/g,'');
const nextDay = s => { const d=new Date(s+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+1);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}`; };

/* ---------- זריחה ושקיעה (NOAA, מדויק לדקה) ---------- */
function sun(dateStr, lat, lon){
  const rad = Math.PI/180, lr = lat*rad, lw = -lon;
  const days  = Math.floor((Date.parse(dateStr+'T12:00:00Z') - Date.UTC(2000,0,1,12))/864e5);
  const nStar = Math.round(days - 0.0009 - lw/360);
  const Js    = 2451545.0009 + lw/360 + nStar;
  const M  = (357.5291 + 0.98560028*(Js - 2451545)) % 360, Mr = M*rad;
  const C  = 1.9148*Math.sin(Mr) + 0.02*Math.sin(2*Mr) + 0.0003*Math.sin(3*Mr);
  const L  = (M + C + 180 + 102.9372) % 360, Lr = L*rad;
  const Jt = Js + 0.0053*Math.sin(Mr) - 0.0069*Math.sin(2*Lr);
  const dec = Math.asin(Math.sin(Lr)*Math.sin(23.4397*rad));
  const cosW = (Math.sin(-0.833*rad) - Math.sin(lr)*Math.sin(dec))/(Math.cos(lr)*Math.cos(dec));
  if (cosW < -1 || cosW > 1) return null;
  const w  = Math.acos(cosW)/(2*Math.PI);
  const tz = israelOffset(dateStr);                        /* +2 חורף, +3 קיץ */
  const fmt = J => { const h = ((J - Math.floor(J) - 0.5)*24 + tz + 24) % 24;
    let hh = Math.floor(h), mm = Math.round((h-hh)*60);
    if (mm===60){mm=0;hh=(hh+1)%24;}
    return `${pad(hh)}:${pad(mm)}`; };
  return { rise: fmt(Jt - w), set: fmt(Jt + w), noon: fmt(Jt) };
}
/* שעון קיץ בישראל: מיום שישי לפני יום ראשון האחרון של מרץ עד יום ראשון האחרון של אוקטובר */
function israelOffset(dateStr){
  const d = new Date(dateStr+'T12:00:00Z'), y = d.getUTCFullYear();
  const lastSun = m => { const x = new Date(Date.UTC(y, m+1, 0, 12)); x.setUTCDate(x.getUTCDate() - x.getUTCDay()); return x; };
  const start = lastSun(2); start.setUTCDate(start.getUTCDate()-2);   /* שישי שלפני */
  const end   = lastSun(9);
  return (d >= start && d < end) ? 3 : 2;
}

/* ---------- שיפוט לשחיין מים פתוחים (לא לגולש) ---------- */
function verdict(h, wind, state){
  let v, why;
  if (h <= 0.5)      { v='מצוין';  why='ים שקט. סייטינג נוח, אפשר לשחות ישר החוצה.'; }
  else if (h <= 0.8) { v='טוב';    why='גלי קל. הסייטינג ידרוש הרמת ראש תכופה יותר.'; }
  else if (h <= 1.2) { v='גבולי';  why='כניסה ויציאה מהמים הן החלק הקשה. רק אם אתה מרגיש חזק, וקרוב לחוף.'; }
  else               { v='לא';     why='לא לשחות. להעביר את האימון לבריכה או להחליף אותו באימון אחר.'; }
  if (h > 0.5 && wind >= 20 && /on/i.test(state||''))
    why += ' רוח מערבית חזקה לחוף — הצ׳ופ יהיה גרוע מגובה הגל.';
  return { v, why };
}
const VICON = { 'מצוין':'🟢', 'טוב':'🟡', 'גבולי':'🟠', 'לא':'🔴' };
const wetsuit = t => t>=24 ? 'בלי חליפה' : t>=20 ? 'חליפה לפי תחושה' : 'חליפה';
const DIRHE = {N:'צפונית',NNE:'צפונית-מזרחית',NE:'צפונית-מזרחית',ENE:'מזרחית',E:'מזרחית',
  ESE:'מזרחית',SE:'דרום-מזרחית',SSE:'דרומית',S:'דרומית',SSW:'דרומית',SW:'דרום-מערבית',
  WSW:'מערבית',W:'מערבית',WNW:'מערבית',NW:'צפון-מערבית',NNW:'צפונית'};
const SEG = [['am','בוקר'],['pm','אחה״צ'],['nt','לילה']];

/* ---------- בניית האירועים ---------- */
const SEQ = Math.floor(Date.parse(D.fetched)/864e5);   /* עולה בכל משיכה — כך iOS מעדכן */
const events = new Map();

/* 1 · שימור ימים שכבר קיימים בקובץ (היסטוריה) */
if (fs.existsSync(OUT)) {
  const old = fs.readFileSync(OUT,'utf8').split('\r\n');
  let cur=null;
  for (const l of old) {
    if (l === 'BEGIN:VEVENT') cur = [l];
    else if (cur) { cur.push(l);
      if (l === 'END:VEVENT') { const u=cur.find(x=>x.startsWith('UID:'));
        if (u) events.set(u.slice(4).trim(), cur); cur=null; } }
  }
}

/* 2 · כתיבת הימים מהתחזית החדשה */
for (const day of D.days) {
  const c   = sun(day.d, D.lat, D.lon);
  const s   = (day.rise&&day.set) ? {rise:day.rise, set:day.set} : c;
  const hs  = SEG.map(([k])=>day[k]).filter(Boolean).map(x=>x.h);
  const hMax= Math.max(...hs), hMin = Math.min(...hs);
  const am  = day.am || day.pm, pm = day.pm || day.am;
  const vAM = verdict(am.h, am.w, am.st), vPM = verdict(pm.h, pm.w, pm.st);
  const best = ['מצוין','טוב','גבולי','לא'].find(x => x===vAM.v || x===vPM.v);
  const LBL = {'מצוין':'מצוין לשחייה','טוב':'טוב לשחייה','גבולי':'גבולי','לא':'לא לשחות'};
  const temp = day.seaTemp ?? D.seaTemp;

  const title = `${VICON[best]} ים ${hMin===hMax?hMin.toFixed(1):hMin.toFixed(1)+'–'+hMax.toFixed(1)} מ׳ · ${temp}° · ${LBL[best]}`;

  const P = [];
  P.push(`${D.spot} · תחזית מ-${new Date(D.fetched).toLocaleString('he-IL',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Jerusalem'})}`);
  P.push('');
  for (const [k,lbl] of SEG) { const x = day[k]; if (!x) continue;
    P.push(`${lbl}: גל ${x.h.toFixed(1)} מ׳ · תקופה ${x.p} שנ׳ · רוח ${DIRHE[x.dir]||x.dir} ${x.w} קמ״ש${x.st?` · ${x.st}`:''}`); }
  P.push('');
  P.push(`בוקר — ${vAM.v}: ${vAM.why}`);
  P.push(`אחה״צ — ${vPM.v}: ${vPM.why}`);
  P.push('');
  P.push(`טמפרטורת ים ${temp}° · ${wetsuit(temp)}`);
  if (s) P.push(`זריחה ${s.rise} · שקיעה ${s.set}`);
  P.push('');
  P.push('גובה הגל הוא הגורם המכריע לשחיית מים פתוחים, לא הרוח. מעל 1.2 מ׳ — בריכה.');

  const uid = `waves-${ymd(day.d)}@vichy2027`;
  events.set(uid, ['BEGIN:VEVENT', `UID:${uid}`, `SEQUENCE:${SEQ}`,
    `DTSTAMP:${new Date(D.fetched).toISOString().replace(/[-:]/g,'').slice(0,15)}Z`,
    `DTSTART;VALUE=DATE:${ymd(day.d)}`, `DTEND;VALUE=DATE:${nextDay(day.d)}`,
    fold(`SUMMARY:${esc(title)}`), fold(`DESCRIPTION:${esc(P.join('\n'))}`),
    fold(`LOCATION:${esc(D.spot)}`), 'CATEGORIES:ים', 'TRANSP:TRANSPARENT',
    'END:VEVENT']);
}

const L = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Vichy 2027//Tel Aviv Sea//HE','CALSCALE:GREGORIAN','METHOD:PUBLISH',
  fold('X-WR-CALNAME:🌊 מצב הים · תל אביב'), 'X-WR-TIMEZONE:Asia/Jerusalem',
  'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H',
  fold(`X-WR-CALDESC:${esc(`גובה גלים, תקופה, רוח וטמפרטורת ים בחוף הילטון, ולצידם המלצה לשחיית מים פתוחים. מקור: ${D.source}. מתעדכן אוטומטית.`)}`)];
[...events.entries()].sort((a,b)=>a[0].localeCompare(b[0])).forEach(([,v])=>L.push(...v));
L.push('END:VCALENDAR');

fs.writeFileSync(OUT, L.join('\r\n')+'\r\n');
console.log(`waves.ics · ${events.size} ימים · ${fs.statSync(OUT).size} bytes · SEQ ${SEQ}`);
