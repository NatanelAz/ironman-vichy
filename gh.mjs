/* ─────────────────────────────────────────────────────────────
   gh.mjs — פרסום קבצים ל-GitHub Pages דרך ה-API
   node gh.mjs setup                 יוצר את המאגר ומפעיל Pages
   node gh.mjs push <file> [<file>…] מעלה/מעדכן קבצים
   סביבה:  GH_TOKEN, GH_OWNER, GH_REPO (ברירת מחדל: ironman-vichy)
   ───────────────────────────────────────────────────────────── */
import fs from 'fs';
import path from 'path';

const TOKEN = process.env.GH_TOKEN, OWNER = process.env.GH_OWNER;
const REPO  = process.env.GH_REPO || 'ironman-vichy';
if (!TOKEN || !OWNER) { console.error('חסר GH_TOKEN או GH_OWNER'); process.exit(1); }

const api = async (method, url, body) => {
  const r = await fetch('https://api.github.com'+url, { method,
    headers: { Authorization:`Bearer ${TOKEN}`, Accept:'application/vnd.github+json',
               'X-GitHub-Api-Version':'2022-11-28', 'Content-Type':'application/json',
               'User-Agent':'vichy-cal' },
    body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text();
  let j = null; try { j = txt ? JSON.parse(txt) : null; } catch(e) { j = { raw: txt }; }
  return { ok: r.ok, status: r.status, j };
};

async function setup(){
  let r = await api('GET', `/repos/${OWNER}/${REPO}`);
  if (!r.ok) {
    r = await api('POST', '/user/repos', { name:REPO, private:false, auto_init:true,
      description:'IRONMAN Vichy 2027 — training plan and subscribed calendars',
      homepage:`https://${OWNER}.github.io/${REPO}/` });
    if (!r.ok) { console.error('יצירת מאגר נכשלה', r.status, r.j); process.exit(1); }
    console.log('מאגר נוצר:', r.j.full_name);
    await new Promise(s=>setTimeout(s,3000));
  } else console.log('המאגר כבר קיים:', r.j.full_name);

  const pg = await api('GET', `/repos/${OWNER}/${REPO}/pages`);
  if (!pg.ok) {
    const mk = await api('POST', `/repos/${OWNER}/${REPO}/pages`,
      { source:{ branch:'main', path:'/' }, build_type:'legacy' });
    console.log(mk.ok ? 'Pages הופעל' : `Pages נכשל ${mk.status} ${JSON.stringify(mk.j).slice(0,200)}`);
  } else console.log('Pages כבר פעיל:', pg.j.html_url);
  console.log(`\nכתובות:\n  דף התוכנית   https://${OWNER}.github.io/${REPO}/`
    + `\n  לוח אימונים  https://${OWNER}.github.io/${REPO}/vichy.ics`
    + `\n  לוח הים      https://${OWNER}.github.io/${REPO}/waves.ics`);
}

/* ה-Contents API לא מחזיר sha לקבצים מעל 1MB — לוקחים אותו מעץ הגיט */
async function shaOf(name){
  const c = await api('GET', `/repos/${OWNER}/${REPO}/contents/${encodeURI(name)}?ref=main`);
  if (c.ok && c.j && c.j.sha) return c.j.sha;
  const t = await api('GET', `/repos/${OWNER}/${REPO}/git/trees/main?recursive=1`);
  if (t.ok && t.j && Array.isArray(t.j.tree)) {
    const hit = t.j.tree.find(x => x.path === name);
    if (hit) return hit.sha;
  }
  return null;
}
async function push(files){
  for (const f of files) {
    const name = (process.env.GH_PREFIX || '') + path.basename(f);
    const sha  = await shaOf(name);
    const body = { message:`update ${name}`, branch:'main',
                   content: fs.readFileSync(f).toString('base64') };
    if (sha) body.sha = sha;
    const r = await api('PUT', `/repos/${OWNER}/${REPO}/contents/${encodeURI(name)}`, body);
    console.log(r.ok ? `✓ ${name} (${fs.statSync(f).size} bytes)`
                     : `✗ ${name} ${r.status} ${JSON.stringify(r.j).slice(0,200)}`);
  }
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'setup') await setup();
else if (cmd === 'push') await push(rest);
else { console.error('שימוש: node gh.mjs setup | node gh.mjs push <files…>'); process.exit(1); }
