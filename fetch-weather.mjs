/* ─────────────────────────────────────────────────────────────
   fetch-weather.mjs — מזג אוויר ומצב ים לגוש דן, לשבוע קדימה.
   כותב weather.json (חדש, מפורט לפי שעה) וגם waves-data.json
   בפורמט הישן כדי ש-genwaves.mjs ימשיך לעבוד ללא שינוי.
   מקור: Open-Meteo · ללא מפתח · רץ על ראנר של GitHub Actions.
   ───────────────────────────────────────────────────────────── */
import fs from 'fs';

const LAT = 32.0892, LON = 34.7695, TZ = 'Asia%2FJerusalem';
const H0 = 4, H1 = 22;                 /* שומרים רק 04:00–22:00 — כל חלונות האימון */

const get = async u => { const r = await fetch(u);
  if (!r.ok) throw new Error(u + ' -> HTTP ' + r.status); return r.json(); };

const HOURLY = ['temperature_2m','apparent_temperature','relative_humidity_2m',
  'precipitation','precipitation_probability','wind_speed_10m','wind_gusts_10m',
  'wind_direction_10m','uv_index','cloud_cover'].join(',');
const DAILY = ['sunrise','sunset','temperature_2m_max','temperature_2m_min',
  'apparent_temperature_max','uv_index_max','precipitation_sum',
  'precipitation_probability_max','wind_speed_10m_max'].join(',');

const W = await get(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}`
  + `&hourly=${HOURLY}&daily=${DAILY}&timezone=${TZ}&forecast_days=7`);
const M = await get(`https://marine-api.open-meteo.com/v1/marine?latitude=${LAT}&longitude=${LON}`
  + `&hourly=wave_height,wave_period,wave_direction,sea_surface_temperature&timezone=${TZ}&forecast_days=7`);

if (!W.hourly || !W.hourly.time || !W.hourly.apparent_temperature) throw new Error('weather API shape changed');
if (!W.daily  || !W.daily.sunrise)                                 throw new Error('daily API shape changed');
if (!M.hourly || !M.hourly.wave_height)                            throw new Error('marine API shape changed');

const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const dirName = d => d === null ? '—' : COMPASS[Math.round((((d % 360) + 360) % 360) / 22.5) % 16];
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const num  = v => (typeof v === 'number' && isFinite(v)) ? v : null;
const r1   = v => v === null ? null : Math.round(v * 10) / 10;
const r0   = v => v === null ? null : Math.round(v);
const hm   = t => t ? t.split('T')[1].slice(0, 5) : null;

/* onshore בתל אביב = רוח מהמערב */
const seaState = (deg, kmh) => {
  if (kmh === null || kmh < 8) return 'Glassy';
  const d = ((deg % 360) + 360) % 360;
  if (d >= 225 && d <= 315) return 'On-shore';
  if (d >= 45  && d <= 135) return 'Off-shore';
  return 'Cross';
};

/* ---------- ים לפי שעה ---------- */
const sea = {};
M.hourly.time.forEach((t, i) => {
  sea[t] = { h: num(M.hourly.wave_height[i]), p: num(M.hourly.wave_period[i]),
             dir: num(M.hourly.wave_direction[i]), sst: num(M.hourly.sea_surface_temperature[i]) };
});

/* ---------- מזג אוויר לפי שעה, מקובץ לימים ---------- */
const days = {};
W.hourly.time.forEach((t, i) => {
  const [date, clock] = t.split('T'); const hr = +clock.slice(0, 2);
  if (hr < H0 || hr > H1) return;
  const s = sea[t] || {};
  (days[date] = days[date] || { d: date, h: [] }).h.push({
    hr,
    temp: r1(num(W.hourly.temperature_2m[i])),
    app : r1(num(W.hourly.apparent_temperature[i])),
    rh  : r0(num(W.hourly.relative_humidity_2m[i])),
    wind: r0(num(W.hourly.wind_speed_10m[i])),
    gust: r0(num(W.hourly.wind_gusts_10m[i])),
    dir : dirName(num(W.hourly.wind_direction_10m[i])),
    rain: r1(num(W.hourly.precipitation[i])),
    pop : r0(num(W.hourly.precipitation_probability[i])),
    uv  : r1(num(W.hourly.uv_index[i])),
    cld : r0(num(W.hourly.cloud_cover[i])),
    wave: r1(s.h ?? null), wper: r0(s.p ?? null), sst: r1(s.sst ?? null),
    sst_: undefined, wst: seaState(s.dir ?? 270, num(W.hourly.wind_speed_10m[i])),
  });
});

/* ---------- סיכום יומי ---------- */
W.daily.time.forEach((date, i) => {
  const D = days[date]; if (!D) return;
  D.rise = hm(W.daily.sunrise[i]);
  D.set  = hm(W.daily.sunset[i]);
  D.tmin = r1(num(W.daily.temperature_2m_min[i]));
  D.tmax = r1(num(W.daily.temperature_2m_max[i]));
  D.appMax = r1(num(W.daily.apparent_temperature_max[i]));
  D.uvMax  = r1(num(W.daily.uv_index_max[i]));
  D.rainSum = r1(num(W.daily.precipitation_sum[i]));
  D.popMax  = r0(num(W.daily.precipitation_probability_max[i]));
  D.windMax = r0(num(W.daily.wind_speed_10m_max[i]));
  const sst = D.h.map(x => x.sst).filter(v => v !== null);
  const wv  = D.h.map(x => x.wave).filter(v => v !== null);
  if (sst.length) D.sst = r1(mean(sst));
  if (wv.length)  { D.waveMax = r1(Math.max(...wv)); D.waveMin = r1(Math.min(...wv)); }
});

const list = Object.values(days).sort((a, b) => a.d < b.d ? -1 : 1).filter(d => d.h.length >= 8);
if (list.length < 3) throw new Error('only ' + list.length + ' usable days came back');
list.forEach(d => d.h.forEach(x => { delete x.sst_; }));

const out = { fetched: new Date().toISOString(), spot: 'גוש דן · תל אביב',
  lat: LAT, lon: LON, source: 'Open-Meteo Forecast & Marine API',
  hours: [H0, H1], days: list };
fs.writeFileSync('weather.json', JSON.stringify(out));
console.log('weather.json · ימים:', list.length, '· שעות ליום:', list[0].h.length,
            '· בייטים:', fs.statSync('weather.json').size);

/* ---------- תאימות לאחור: waves-data.json בפורמט הישן ---------- */
const pack = rows => {
  rows = rows.filter(r => r.wave !== null);
  if (!rows.length) return null;
  return { h: +Math.max(...rows.map(r => r.wave)).toFixed(1),
           p: Math.round(mean(rows.map(r => r.wper).filter(v => v !== null))) || 6,
           w: Math.round(mean(rows.map(r => r.wind).filter(v => v !== null))),
           dir: rows[Math.floor(rows.length / 2)].dir,
           st: rows[Math.floor(rows.length / 2)].wst };
};
const legacy = list.map(D => {
  const o = { d: D.d,
    am: pack(D.h.filter(x => x.hr >= 6  && x.hr < 12)),
    pm: pack(D.h.filter(x => x.hr >= 12 && x.hr < 18)),
    nt: pack(D.h.filter(x => x.hr >= 18)) };
  if (D.sst  !== undefined) o.seaTemp = D.sst;
  if (D.rise) { o.rise = D.rise; o.set = D.set; }
  return o;
}).filter(o => o.am || o.pm);

fs.writeFileSync('waves-data.json', JSON.stringify({ fetched: out.fetched,
  spot: 'תל אביב · חוף הילטון', lat: LAT, lon: LON,
  seaTemp: legacy[0].seaTemp ?? 24, source: out.source, days: legacy }, null, 2));
console.log('waves-data.json · ימים:', legacy.length, '| ים:', (legacy[0].seaTemp ?? '—') + '°');
