// 募集ごとの小さなページ e/<ID>/index.html を作って _site/ にまとめる（GitHub Actions から5分ごとに実行）。
// 中身は index.html と同じで、<head> の OGP（LINEなどのプレビュー）だけを募集ごとに差しかえる。
// 前回公開した内容（pages-manifest.json）と同じなら changed=false にして、公開をとばす。
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const cfgText = readFileSync('config.js', 'utf8');
const sheetId = (cfgText.match(/"sheetId"\s*:\s*"([^"]*)"/) || [])[1] || '';
const base = (cfgText.match(/"base"\s*:\s*"([^"]*)"/) || [])[1] || '';
const eventName = process.env.EVENT_NAME || 'local';

function out(k, v) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
  console.log(`${k}=${v}`);
}

function parseCSV(t) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const HOL = new Set(('2026-01-01 2026-01-12 2026-02-11 2026-02-23 2026-03-20 2026-04-29 2026-05-03 2026-05-04 2026-05-05 2026-05-06 2026-07-20 2026-08-11 ' +
  '2026-09-21 2026-09-22 2026-09-23 2026-10-12 2026-11-03 2026-11-23 2027-01-01 2027-01-11 2027-02-11 2027-02-23 2027-03-21 2027-03-22 ' +
  '2027-04-29 2027-05-03 2027-05-04 2027-05-05 2027-07-19 2027-08-11 2027-09-20 2027-09-23 2027-10-11 2027-11-03 2027-11-23').split(' '));
function label(k) {
  const d = String(k).slice(0, 10), [y, m, dd] = d.split('-').map(Number);
  if (!y) return '';
  const w = '日月火水木金土'[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()] + (HOL.has(d) ? '・祝' : '');
  const t = String(k).includes('@') ? ' ' + String(k).split('@').slice(1).join('@') : '';
  return `${m}/${dd}(${w})${t}`;
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function loadEvents() {
  if (!sheetId) return {};
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent('募集')}&_=${Date.now()}`;
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok || /^\s*</.test(text)) throw new Error('シートを読めませんでした（共有設定を確認）: HTTP ' + res.status);
  const ev = {};
  for (const r of parseCSV(text).slice(1)) {
    const id = String(r[1] || '').replace(/[^A-Za-z0-9_-]/g, '');
    let j; try { j = JSON.parse(r[3]); } catch { continue; }
    if (!id || !j || !j.title || !Array.isArray(j.dates)) continue;
    ev[id] = j;   // 下の行（新しい行）が正
  }
  return ev;
}

const tpl = readFileSync('index.html', 'utf8');
function pageFor(id, j) {
  const title = (j.decided ? `【決定 ${label(j.decided)}】` : `【〆${label(j.deadline)}】`) + j.title + '｜調整くんっ！';
  const memo = String(j.memo || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  const desc = j.decided ? `${label(j.decided)} に決まりました。` :
    `候補 ${j.dates.length}つ・回答〆切 ${label(j.deadline)}。全員そろう日をさがしています。` + (memo ? ' ' + memo.slice(0, 60) : '');
  const og = [
    `<base href="../../">`,
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="調整くんっ！">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(base + 'e/' + id + '/')}">`,
    `<meta property="og:image" content="${esc(base + 'ogp.png')}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].join('\n');
  return tpl.replace(/<!--OGP-->[\s\S]*?<!--\/OGP-->/, () => og);   // 関数で渡す（タイトルの $ が置換記号にならないように）
}

const events = await loadEvents();
rmSync('_site', { recursive: true, force: true });
mkdirSync('_site', { recursive: true });
for (const f of ['index.html', '404.html', 'config.js', 'ogp.png', 'favicon.png', 'apple-touch-icon.png']) {
  if (existsSync(f)) cpSync(f, '_site/' + f);
}
// マダミスえらび（madamis/）はそのままコピー
if (existsSync('madamis')) cpSync('madamis', '_site/madamis', { recursive: true });
const manifest = {};
for (const [id, j] of Object.entries(events)) {
  const html = pageFor(id, j);
  mkdirSync(`_site/e/${id}`, { recursive: true });
  writeFileSync(`_site/e/${id}/index.html`, html);
  manifest[id] = createHash('sha1').update(html).digest('hex').slice(0, 12);
}
// サイト本体のファイルが変わったときも公開しなおすよう、本体の指紋も入れる
manifest._site = createHash('sha1').update(tpl + readFileSync('404.html', 'utf8') + cfgText + (existsSync('madamis') ? readFileSync('madamis/index.html', 'utf8') + readFileSync('madamis/works.js', 'utf8') : '')).digest('hex').slice(0, 12);

// ---- 幹事の予定（フリカレ）を暗号化して busy.json に ----
// 募集を作る画面のカレンダーで「予定がある日」に色を付けるためだけに使う。
// サイトは誰でも見られるので中身は AES-256-GCM で暗号化し、鍵（BUSY_KEY）を入れた端末でだけ読める。
// FREECAL_PATH（freecal-backup の data/calendar.json）と BUSY_KEY が無ければ何もしない。
const busyPath = process.env.FREECAL_PATH, busyKey = process.env.BUSY_KEY;
if (busyPath && busyKey && existsSync(busyPath)) {
  const cal = JSON.parse(readFileSync(busyPath, 'utf8'));
  const jst = new Date(Date.now() + 9 * 3600e3);
  const from = jst.toISOString().slice(0, 10);
  const to = new Date(jst.getTime() + 730 * 864e5).toISOString().slice(0, 10);
  const days = {};
  for (const d of cal.days || []) {
    const text = String(d.text || '').trim();
    if (!d.date || d.date < from || d.date > to || !text) continue;   // 本文のある日だけ（色ラベルだけの日は除く）
    days[d.date] = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, 3).join(' / ').slice(0, 80);
  }
  const plain = JSON.stringify({ v: 1, at: cal.generated_at || '', days });
  const { createCipheriv, randomBytes } = await import('node:crypto');
  const key = Buffer.from(busyKey.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (key.length !== 32) throw new Error('BUSY_KEY は32バイト（base64url）にしてください');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final(), c.getAuthTag()]);   // WebCrypto と同じ「本文＋タグ」の並び
  writeFileSync('_site/busy.json', JSON.stringify({ v: 1, iv: iv.toString('base64'), ct: ct.toString('base64') }));
  manifest._busy = createHash('sha1').update(plain).digest('hex').slice(0, 12);   // 中身が同じなら公開しなおさない
  console.log(`予定のある日 ${Object.keys(days).length} 日を暗号化しました`);
}
const manifestText = JSON.stringify(manifest);
writeFileSync('_site/pages-manifest.json', manifestText);
console.log(`募集 ${Object.keys(events).length} 件のページを作りました`);

let changed = true;
if (eventName === 'schedule' && base) {
  try {
    const live = await fetch(base + 'pages-manifest.json', { cache: 'no-store' });
    if (live.ok && (await live.text()) === manifestText) changed = false;
  } catch { /* 読めなければ公開する */ }
}
out('changed', changed ? 'true' : 'false');
