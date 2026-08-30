import fs from 'fs';
const LAT = 32.0892, LON = 34.7695, TZ = 'Asia%2FJerusalem';
const get = async u => { const r = await fetch(u);
  if (!r.ok) throw new Error(u + ' -> HTTP ' + r.status); return r.json(); };

const M = await get(`https://marine-api.open-meteo.com/v1/marine?latitude=${LAT}&longitude=${LON}`
  + `&hourly=wave_height,wave_period,wave_direction,sea_surface_temperature&timezone=${TZ}&forecast_days=7`);
const W = await get(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}`
  + `&hourly=wind_speed_10m,wind_direction_10m&daily=sunrise,sunset&timezone=${TZ}&forecast_days=7`);

if (!M.hourly || !M.hourly.time || !M.hourly.wave_height) throw new Error('marine API shape changed');
if (!W.hourly || !W.hourly.wind_speed_10m)                throw new Error('weather API shape changed');

const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const dirName = d => COMPASS[Math.round((((d % 360) + 360) % 360) / 22.5) % 16];
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const num  = v => (typeof v === 'number' && isFinite(v)) ? v : null;

/* onshore at Tel Aviv = wind coming from the west sector */
const state = (deg, kmh) => {
  if (kmh < 8) return 'Glassy';
  const d = ((deg % 360) + 360) % 360;
  if (d >= 225 && d <= 315) return 'On-shore';
  if (d >= 45  && d <= 135) return 'Off-shore';
  return 'Cross';
};

const wind = {};                       /* ISO hour -> {s, d} */
W.hourly.time.forEach((t, i) => {
  wind[t] = { s: num(W.hourly.wind_speed_10m[i]), d: num(W.hourly.wind_direction_10m[i]) };
});

const byDay = {};
M.hourly.time.forEach((t, i) => {
  const [date, hm] = t.split('T'); const hour = +hm.slice(0, 2);
  const seg = hour >= 6 && hour < 12 ? 'am' : hour >= 12 && hour < 18 ? 'pm'
            : hour >= 18 ? 'nt' : null;
  if (!seg) return;
  const h = num(M.hourly.wave_height[i]); if (h === null) return;
  (byDay[date] = byDay[date] || { am: [], pm: [], nt: [], sst: [] });
  const wv = wind[t] || {};
  byDay[date][seg].push({ h, p: num(M.hourly.wave_period[i]),
    wd: num(M.hourly.wave_direction[i]), ws: wv.s, wdir: wv.d });
  const s = num(M.hourly.sea_surface_temperature[i]); if (s !== null) byDay[date].sst.push(s);
});

const sun = {};
(W.daily?.time || []).forEach((d, i) => {
  sun[d] = { rise: (W.daily.sunrise[i] || '').slice(11, 16),
             set:  (W.daily.sunset[i]  || '').slice(11, 16) };
});

const pack = rows => {
  if (!rows.length) return null;
  const ws = rows.map(r => r.ws).filter(v => v !== null);
  const wd = rows.map(r => r.wdir).filter(v => v !== null);
  const kmh = Math.round(mean(ws) / 5) * 5;
  const deg = wd.length ? mean(wd) : 270;
  return { h: +Math.max(...rows.map(r => r.h)).toFixed(1),
           p: Math.round(mean(rows.map(r => r.p).filter(v => v !== null))) || 6,
           w: kmh, dir: dirName(deg), st: state(deg, kmh) };
};

const days = Object.keys(byDay).sort().map(d => {
  const o = { d, am: pack(byDay[d].am), pm: pack(byDay[d].pm), nt: pack(byDay[d].nt) };
  if (byDay[d].sst.length) o.seaTemp = +mean(byDay[d].sst).toFixed(1);
  if (sun[d]) { o.rise = sun[d].rise; o.set = sun[d].set; }
  return o;
}).filter(o => o.am || o.pm);

if (days.length < 3) throw new Error('only ' + days.length + ' usable days came back');

const out = { fetched: new Date().toISOString(), spot: 'תל אביב · חוף הילטון',
  lat: LAT, lon: LON, seaTemp: days[0].seaTemp ?? 24,
  source: 'Open-Meteo Marine & Weather API', days };
fs.writeFileSync('waves-data.json', JSON.stringify(out, null, 2));
console.log('days:', days.length, '| sea:', out.seaTemp + '°');
