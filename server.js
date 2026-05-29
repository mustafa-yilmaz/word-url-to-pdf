import express from 'express';
import axios from 'axios';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const app = express();
app.use(express.urlencoded({ extended: false, limit: '256kb' }));
app.use(express.json({ limit: '256kb' }));

const PORT = Number(process.env.PORT || 8080);
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 50);
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
const CONVERT_TIMEOUT_MS = Number(process.env.CONVERT_TIMEOUT_MS || 120000);
const SECRET_TOKEN = process.env.SECRET_TOKEN || '';
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'links.json');
const PUBLIC_PDF_RATE_LIMIT_PER_MINUTE = Number(process.env.PUBLIC_PDF_RATE_LIMIT_PER_MINUTE || 30);
const rateBuckets = new Map();

const ALLOWED_HOST_SUFFIXES = (process.env.ALLOWED_HOST_SUFFIXES ||
  '1drv.ms,onedrive.live.com,api.onedrive.com,1drv.com,sharepoint.com,microsoftpersonalcontent.com,my.microsoftpersonalcontent.com')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

class ByteLimitTransform extends Transform {
  constructor(limitBytes) { super(); this.limitBytes = limitBytes; this.totalBytes = 0; }
  _transform(chunk, encoding, callback) {
    this.totalBytes += chunk.length;
    if (this.totalBytes > this.limitBytes) return callback(new Error(`File is larger than the configured limit of ${MAX_FILE_MB} MB.`));
    callback(null, chunk);
  }
}

function htmlEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function sanitizeFilename(name, fallback = 'converted.pdf') {
  const cleaned = String(name || '').replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim();
  return cleaned || fallback;
}
function isAllowedPublicUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch { return { ok: false, message: 'The url parameter is not a valid URL.' }; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false, message: 'Only http/https URLs are allowed.' };
  const hostname = parsed.hostname.toLowerCase();
  const allowed = ALLOWED_HOST_SUFFIXES.some(suffix => hostname === suffix || hostname.endsWith(`.${suffix}`));
  if (!allowed) return { ok: false, message: `Host not allowed: ${hostname}. Configure ALLOWED_HOST_SUFFIXES if this is a trusted Microsoft download host.` };
  return { ok: true, parsed };
}
function checkToken(req, res) {
  if (!SECRET_TOKEN) return true;
  const supplied = req.query.token || req.body?.token || req.get('x-admin-token');
  if (supplied === SECRET_TOKEN) return true;
  res.status(401).type('text/plain').send('Missing or invalid token.');
  return false;
}
function addTokenToUrl(url, token) {
  if (!token) return url;
  const u = new URL(url);
  u.searchParams.set('token', token);
  return u.toString();
}
function filenameFromContentDisposition(contentDisposition = '') {
  const cd = String(contentDisposition || '');
  const utf8Match = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename\*=([^;]+)/i);
  const normalMatch = cd.match(/filename="([^"]+)"/i) || cd.match(/filename=([^;]+)/i);
  let name = '';
  if (utf8Match) {
    name = utf8Match[1].trim().replace(/^"|"$/g, '');
    try { name = decodeURIComponent(name); } catch { /* keep raw value */ }
  } else if (normalMatch) {
    name = normalMatch[1].trim().replace(/^"|"$/g, '');
  }
  return name ? sanitizeFilename(name, '') : '';
}
function filenameFromHeaders(headers, fallback = 'document.docx') {
  return filenameFromContentDisposition(headers['content-disposition']) || fallback;
}
function titleFromWordFilename(filename = '') {
  const clean = sanitizeFilename(path.basename(String(filename || '')), '');
  if (!clean) return '';
  return sanitizeFilename(clean.replace(/\.(docx|docm|doc|rtf)$/i, ''), '');
}

function decodeHtmlEntities(value = '') {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
function filenameFromWordLikeUrl(value = '') {
  const text = decodeHtmlEntities(String(value || ''));
  const match = text.match(/\/([^\/?#]+\.(?:docx|docm|doc|rtf))(?=[?#]|$)/i);
  if (!match) return '';
  try { return sanitizeFilename(decodeURIComponent(match[1]), ''); }
  catch { return sanitizeFilename(match[1], ''); }
}
function filenameFromHtmlHref(html = '') {
  const text = decodeHtmlEntities(String(html || ''));
  const hrefMatches = [...text.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)];
  for (const match of hrefMatches) {
    const name = filenameFromWordLikeUrl(match[1]);
    if (name) return name;
  }
  return filenameFromWordLikeUrl(text);
}
async function streamToStringLimited(stream, maxBytes = 1024 * 1024) {
  let total = 0;
  const chunks = [];
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('Response body was too large to inspect safely.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function extensionFromContentType(contentType = '') {
  const ct = contentType.toLowerCase();
  if (ct.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')) return '.docx';
  if (ct.includes('application/msword')) return '.doc';
  if (ct.includes('application/rtf') || ct.includes('text/rtf')) return '.rtf';
  return '.docx';
}
function collectCookies(setCookieHeaders, cookieStore) {
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : (setCookieHeaders ? [setCookieHeaders] : []);
  for (const header of headers) {
    const firstPart = String(header).split(';')[0];
    const eq = firstPart.indexOf('=');
    if (eq > 0) {
      const name = firstPart.slice(0, eq).trim();
      const value = firstPart.slice(eq + 1).trim();
      if (name) cookieStore.set(name, value);
    }
  }
}
const cookieHeader = cookieStore => [...cookieStore.entries()].map(([name, value]) => `${name}=${value}`).join('; ');

async function ensureStore() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try { await fsp.access(STORE_PATH, fs.constants.R_OK); }
  catch { await fsp.writeFile(STORE_PATH, JSON.stringify({ links: [] }, null, 2)); }
}
async function readStore() {
  await ensureStore();
  const raw = await fsp.readFile(STORE_PATH, 'utf8');
  const parsed = JSON.parse(raw || '{"links":[]}');
  if (!Array.isArray(parsed.links)) parsed.links = [];
  return parsed;
}
async function writeStore(store) {
  await ensureStore();
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(store, null, 2));
  await fsp.rename(tmp, STORE_PATH);
}
function makeId() { return randomBytes(16).toString('hex'); }
async function getLinkOr404(id, res) {
  const store = await readStore();
  const link = store.links.find(x => x.id === id);
  if (!link) { res.status(404).type('text/plain').send('Saved conversion link not found.'); return null; }
  return { store, link };
}

async function fetchFollowingAllowedRedirects(rawUrl, maxRedirects = 12) {
  let currentUrl = rawUrl;
  let detectedWordFilename = filenameFromWordLikeUrl(currentUrl);
  const cookieStore = new Map();
  for (let i = 0; i <= maxRedirects; i++) {
    const validation = isAllowedPublicUrl(currentUrl);
    if (!validation.ok) throw new Error(validation.message);
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/octet-stream,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Upgrade-Insecure-Requests': '1'
    };
    const cookies = cookieHeader(cookieStore);
    if (cookies) headers.Cookie = cookies;
    const response = await axios.get(currentUrl, { responseType: 'stream', maxRedirects: 0, timeout: 45000, validateStatus: () => true, headers });
    collectCookies(response.headers['set-cookie'], cookieStore);

    const location = response.headers.location;
    if (location) {
      const locationName = filenameFromWordLikeUrl(location);
      if (locationName) detectedWordFilename = locationName;
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!location) {
        const body = await streamToStringLimited(response.data);
        const hrefName = filenameFromHtmlHref(body);
        if (hrefName) detectedWordFilename = hrefName;
        const hrefMatch = decodeHtmlEntities(body).match(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i);
        if (!hrefMatch) throw new Error(`Redirect ${response.status} without a Location header.`);
        currentUrl = new URL(hrefMatch[1], currentUrl).toString();
        continue;
      }
      response.data.destroy();
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    const contentType = String(response.headers['content-type'] || '').toLowerCase();
    if (contentType.includes('text/html')) {
      const body = await streamToStringLimited(response.data);
      const hrefName = filenameFromHtmlHref(body);
      if (hrefName) detectedWordFilename = hrefName;
      const hrefMatch = decodeHtmlEntities(body).match(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i);
      if (hrefMatch && filenameFromWordLikeUrl(hrefMatch[1])) {
        currentUrl = new URL(hrefMatch[1], currentUrl).toString();
        continue;
      }
      throw new Error(`The source URL returned HTML instead of a Word file. Make sure it is a public direct-download Word URL.`);
    }

    if (response.status < 200 || response.status >= 300) {
      response.data.destroy();
      throw new Error(`The source URL returned HTTP ${response.status}. Make sure it is a public direct-download Word URL.`);
    }
    response.detectedWordFilename = detectedWordFilename;
    return response;
  }
  throw new Error('Too many redirects while fetching the source file.');
}
async function downloadSourceFile(rawUrl, workDir) {
  const response = await fetchFollowingAllowedRedirects(rawUrl);
  const detectedName = filenameFromContentDisposition(response.headers['content-disposition']) || response.detectedWordFilename || '';
  const headerName = detectedName || 'document.docx';
  const ext = path.extname(headerName) || extensionFromContentType(response.headers['content-type']);
  const baseName = sanitizeFilename(path.basename(headerName, path.extname(headerName)), 'document');
  const inputName = `${baseName}${ext}`;
  const inputPath = path.join(workDir, inputName);
  await pipeline(response.data, new ByteLimitTransform(MAX_FILE_BYTES), fs.createWriteStream(inputPath));
  return { inputPath, detectedBaseName: detectedName ? baseName : '' };
}
async function detectWordFilenameForDisplay(rawUrl) {
  try {
    const response = await fetchFollowingAllowedRedirects(rawUrl);
    const detectedName = filenameFromContentDisposition(response.headers['content-disposition']) || response.detectedWordFilename || '';
    response.data.destroy();
    if (!detectedName) return '';
    return sanitizeFilename(path.basename(detectedName), '');
  } catch (err) {
    console.warn('Could not detect Word filename for display:', err.message);
    return '';
  }
}
async function convertWordToPdf(inputPath, outputDir) {
  await execFileAsync('soffice', ['--headless', '--nologo', '--nofirststartwizard', '--convert-to', 'pdf', '--outdir', outputDir, inputPath], { timeout: CONVERT_TIMEOUT_MS });
  const expectedPdf = path.join(outputDir, `${path.basename(inputPath, path.extname(inputPath))}.pdf`);
  try { await fsp.access(expectedPdf, fs.constants.R_OK); return expectedPdf; }
  catch {
    const pdfs = (await fsp.readdir(outputDir)).filter(file => file.toLowerCase().endsWith('.pdf'));
    if (!pdfs.length) throw new Error('LibreOffice finished but no PDF file was produced.');
    return path.join(outputDir, pdfs[0]);
  }
}
async function cleanup(dir) { try { await fsp.rm(dir, { recursive: true, force: true }); } catch (err) { console.warn('Cleanup failed:', err.message); } }

function renderHome(req, links, message = '') {
  const origin = `${req.protocol}://${req.get('host')}`;
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
  const tokenField = SECRET_TOKEN ? `<label>Admin token <input name="token" type="password" value="${htmlEscape(token)}" placeholder="Required token"></label>` : '';
  const rows = links.map((link, index) => {
    const pdfUrl = `${origin}/pdf/${link.id}`;
    const created = link.createdAt ? new Date(link.createdAt).toLocaleString() : 'Unknown';
    const updated = link.updatedAt ? new Date(link.updatedAt).toLocaleString() : 'Unknown';
    const title = link.title || titleFromWordFilename(link.detectedWordFilename) || link.id;
    return `<details class="link-card" ontoggle="syncToggleButton(this)">
      <summary>
        <span class="summary-main">
          <span class="link-title">${htmlEscape(title)}</span>
          <span class="link-subtitle">/pdf/${htmlEscape(link.id)}</span>
        </span>
        <span class="summary-actions">
          <button class="small-button secondary toggle-button" type="button" onclick="toggleDetails(event, this)">Expand</button>
          <a class="small-button" target="_blank" href="${htmlEscape(pdfUrl)}" onclick="event.stopPropagation()">Open PDF</a>
          <button class="small-button secondary" type="button" data-copy="${htmlEscape(pdfUrl)}" onclick="copyFromButton(event, this)">Copy URL</button>
        </span>
      </summary>
      <div class="details-body">
        <div class="url-panel">
          <div class="label-row"><strong>Stable public PDF URL</strong><button type="button" class="text-button" data-copy="${htmlEscape(pdfUrl)}" onclick="copyFromButton(event, this)">Copy</button></div>
          <a target="_blank" href="${htmlEscape(pdfUrl)}">${htmlEscape(pdfUrl)}</a>
        </div>
        <form id="update-${htmlEscape(link.id)}" method="post" action="/links/${htmlEscape(link.id)}/update${tokenQuery}">
          ${SECRET_TOKEN ? `<input type="hidden" name="token" value="${htmlEscape(token)}">` : ''}
          <label>Title / label <input name="title" value="${htmlEscape(link.title || '')}" placeholder="Example: Proposal PDF"></label>
          <label>Source Word URL <input name="url" value="${htmlEscape(link.url)}"></label>
        </form>
        <form id="delete-${htmlEscape(link.id)}" method="post" action="/links/${htmlEscape(link.id)}/delete${tokenQuery}" onsubmit="return confirm('Delete this saved conversion link?')">
          ${SECRET_TOKEN ? `<input type="hidden" name="token" value="${htmlEscape(token)}">` : ''}
        </form>
        <div class="form-actions split-actions">
          <div class="left-actions">
            <button class="save-button" type="submit" form="update-${htmlEscape(link.id)}">Save changes</button>
            <span class="inline-help">Saves the title/label and source Word URL while keeping the same public PDF URL.</span>
          </div>
          <button class="danger" type="submit" form="delete-${htmlEscape(link.id)}">Delete saved link</button>
        </div>
        <div class="meta-grid">
          <div><span>ID</span><code>${htmlEscape(link.id)}</code></div>
          <div><span>Created</span>${htmlEscape(created)}</div>
          <div><span>Updated</span>${htmlEscape(updated)}</div>
        </div>
      </div>
    </details>`;
  }).join('') || '<div class="empty-state">No saved conversion links yet.</div>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Word URL to PDF</title>
  <style>
    :root{--ink:#17202a;--muted:#637083;--line:#d9dee7;--soft:#f6f8fb;--panel:#ffffff;--accent:#17202a;--danger:#9b1c1c;--success:#e8f5e9}
    *{box-sizing:border-box}
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:1040px;margin:44px auto;padding:0 20px;line-height:1.5;color:var(--ink);background:#fbfcfe}
    h1{margin-bottom:6px} h2{margin-top:30px}.lede{color:var(--muted);margin-top:0}
    input{width:100%;padding:12px;margin:8px 0 16px;border:1px solid #c9d0dc;border-radius:10px;font-size:15px;background:white}
    input:focus{outline:2px solid #cbd5e1;border-color:#94a3b8}
    button,.small-button{padding:10px 14px;border:0;border-radius:9px;cursor:pointer;font-size:15px;background:var(--accent);color:white;text-decoration:none;display:inline-block;white-space:nowrap}
    button.secondary,.small-button.secondary{background:#eef2f7;color:var(--ink);border:1px solid var(--line)}
    button.danger{background:var(--danger);margin-top:8px}.save-button{background:#0f4c81}.text-button{background:transparent;color:var(--ink);border:1px solid var(--line);padding:5px 9px;font-size:13px}.inline-help{color:var(--muted);font-size:13px;align-self:center}
    a{word-break:break-all;color:#0f4c81}.box{background:var(--panel);padding:18px;border:1px solid var(--line);border-radius:16px;margin:18px 0;box-shadow:0 8px 24px rgba(15,23,42,.04)}.message{background:var(--success)}.small{color:var(--muted);font-size:14px}
    .toolbar{display:flex;gap:8px;align-items:center;justify-content:space-between;margin:10px 0 14px;flex-wrap:wrap}.toolbar .small{margin:0}
    .link-card{background:var(--panel);border:1px solid var(--line);border-radius:16px;margin:12px 0;overflow:hidden;box-shadow:0 6px 18px rgba(15,23,42,.035)}
    .link-card[open]{box-shadow:0 10px 28px rgba(15,23,42,.07)}
    summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:15px 16px;cursor:pointer}
    summary::-webkit-details-marker{display:none}summary:before{content:'▸';color:var(--muted);transition:transform .15s ease}.link-card[open] summary:before{transform:rotate(90deg)}
    .summary-main{min-width:0;flex:1}.link-title{font-weight:700;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.link-subtitle{color:var(--muted);font-size:13px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.summary-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .details-body{border-top:1px solid var(--line);padding:16px;background:var(--soft)}.url-panel{background:white;border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:16px}.label-row{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:6px}
    .form-actions{display:flex;gap:10px;flex-wrap:wrap}.split-actions{align-items:center;justify-content:space-between;margin:2px 0 14px}.left-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}button.danger{margin-top:0}.meta-grid{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:10px;margin:12px 0}.meta-grid div{background:white;border:1px solid var(--line);border-radius:10px;padding:10px;min-width:0}.meta-grid span{display:block;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em}.meta-grid code{white-space:normal;word-break:break-all}
    .empty-state{background:var(--soft);border:1px dashed var(--line);border-radius:14px;padding:22px;color:var(--muted);text-align:center}
    @media (max-width:720px){summary{align-items:flex-start}.summary-actions{width:100%}.small-button{flex:1;text-align:center}.meta-grid{grid-template-columns:1fr}}
  </style>
  <script>
    function copyFromButton(event, btn){
      event.preventDefault(); event.stopPropagation();
      const value = btn.getAttribute('data-copy');
      navigator.clipboard.writeText(value).then(() => {
        const old = btn.textContent; btn.textContent = 'Copied';
        setTimeout(() => btn.textContent = old, 1200);
      }).catch(() => { window.prompt('Copy this URL:', value); });
    }
    function syncToggleButton(details){
      const btn = details.querySelector('.toggle-button');
      if (btn) btn.textContent = details.open ? 'Collapse' : 'Expand';
    }
    function toggleDetails(event, btn){
      event.preventDefault(); event.stopPropagation();
      const details = btn.closest('details');
      if (!details) return;
      details.open = !details.open;
      syncToggleButton(details);
    }
  </script>
  </head><body>
  <h1>Word URL to PDF</h1>
  <p class="lede">Create saved conversion links. The <strong>stable PDF URL</strong> stays the same even if you later update the source Word URL.</p>
  ${message ? `<div class="box message">${htmlEscape(message)}</div>` : ''}
  <div class="box"><h2>Create a saved PDF conversion URL</h2>
    <form method="post" action="/links${tokenQuery}">
      ${tokenField}
      <label>Title / label <input name="title" placeholder="Example: Proposal PDF"></label>
      <label>Public Word direct-download URL <input name="url" type="url" placeholder="https://1drv.ms/w/...&download=1" required autofocus></label>
      <button>Create stable PDF URL</button>
    </form>
    <p class="small">Admin functions are token-protected when <code>SECRET_TOKEN</code> is set. Public links use <code>/pdf/:id</code> and do not expose the source Word URL.</p>
  </div>
  <h2>Saved conversion links</h2>
  <p class="small">Each saved link is compact by default. Use the individual Expand / Collapse button on each row to edit its title/source URL, save changes, inspect details, or delete it.</p>
  ${rows}
  </body></html>`;
}

app.get('/', async (req, res) => {
  if (SECRET_TOKEN && !checkToken(req, res)) return;
  const store = await readStore();
  res.type('html').send(renderHome(req, store.links));
});

app.post('/links', async (req, res) => {
  if (!checkToken(req, res)) return;
  const url = String(req.body.url || '').trim();
  const title = String(req.body.title || '').trim();
  const validation = isAllowedPublicUrl(url);
  if (!validation.ok) return res.status(400).type('text/plain').send(validation.message);
  const store = await readStore();
  let id; do { id = makeId(); } while (store.links.some(x => x.id === id));
  const detectedWordFilename = await detectWordFilenameForDisplay(url);
  const now = new Date().toISOString();
  store.links.unshift({ id, title: title || titleFromWordFilename(detectedWordFilename) || id, url, detectedWordFilename, createdAt: now, updatedAt: now });
  await writeStore(store);
  const tokenQuery = SECRET_TOKEN && req.body.token ? `?token=${encodeURIComponent(req.body.token)}` : '';
  res.redirect(`/${tokenQuery}`);
});

app.post('/links/:id/update', async (req, res) => {
  if (!checkToken(req, res)) return;
  const result = await getLinkOr404(req.params.id, res); if (!result) return;
  const url = String(req.body.url || '').trim();
  const title = String(req.body.title || '').trim();
  const validation = isAllowedPublicUrl(url);
  if (!validation.ok) return res.status(400).type('text/plain').send(validation.message);
  const previousUrl = result.link.url;
  result.link.url = url;
  let detectedAfterUpdate = result.link.detectedWordFilename || '';
  if (url !== previousUrl || !result.link.detectedWordFilename) {
    detectedAfterUpdate = await detectWordFilenameForDisplay(url);
    result.link.detectedWordFilename = detectedAfterUpdate;
  }
  result.link.title = title || titleFromWordFilename(detectedAfterUpdate) || result.link.title || result.link.id;
  result.link.updatedAt = new Date().toISOString();
  await writeStore(result.store);
  const tokenQuery = SECRET_TOKEN && req.body.token ? `?token=${encodeURIComponent(req.body.token)}` : '';
  res.redirect(`/${tokenQuery}`);
});

app.post('/links/:id/delete', async (req, res) => {
  if (!checkToken(req, res)) return;
  const store = await readStore();
  store.links = store.links.filter(x => x.id !== req.params.id);
  await writeStore(store);
  const tokenQuery = SECRET_TOKEN && req.body.token ? `?token=${encodeURIComponent(req.body.token)}` : '';
  res.redirect(`/${tokenQuery}`);
});

app.get('/api/links', async (req, res) => {
  if (!checkToken(req, res)) return;
  const store = await readStore();
  const origin = `${req.protocol}://${req.get('host')}`;
  res.json({ links: store.links.map(x => ({ ...x, pdfUrl: `${origin}/pdf/${x.id}` })) });
});


function renderPublicDownloadNotice(req, link) {
  const downloadUrl = `/pdf/${encodeURIComponent(link.id)}?download=1`;
  const displayName = link.detectedWordFilename || (link.title ? `${link.title}.docx` : '') || 'Word document';
  const safeTitle = htmlEscape(link.title || titleFromWordFilename(link.detectedWordFilename) || 'Word document');
  const safeDisplayName = htmlEscape(displayName);
  const safeDownloadUrl = htmlEscape(downloadUrl);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeDisplayName}</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f8fb; color: #172033; }
    .card { width: min(92vw, 560px); background: #fff; border: 1px solid #dfe5ef; border-radius: 24px; padding: 34px; box-shadow: 0 20px 60px rgba(20, 40, 80, .12); text-align: center; }
    .brand-row { display: flex; justify-content: center; align-items: center; gap: 12px; margin-bottom: 22px; flex-wrap: wrap; }
    .ms365-badge { display: inline-flex; align-items: center; gap: 9px; border: 1px solid #d8e0ea; border-radius: 999px; padding: 9px 14px; font-weight: 700; background: #fff; }
    .ms-grid { display: grid; grid-template-columns: repeat(2, 9px); grid-template-rows: repeat(2, 9px); gap: 2px; }
    .ms-grid span:nth-child(1) { background: #f25022; } .ms-grid span:nth-child(2) { background: #7fba00; }
    .ms-grid span:nth-child(3) { background: #00a4ef; } .ms-grid span:nth-child(4) { background: #ffb900; }
    .word-badge { display: inline-flex; align-items: center; gap: 8px; background: #185abd; color: #fff; border-radius: 12px; padding: 9px 12px; font-weight: 800; }
    .word-icon { width: 28px; height: 28px; border-radius: 7px; display: grid; place-items: center; background: #103f91; box-shadow: inset -5px 0 0 rgba(255,255,255,.14); }
    h1 { margin: 0 0 10px; font-size: 1.35rem; }
    p { margin: 8px 0; line-height: 1.5; }
    .muted { color: #637083; font-size: .96rem; }
    .spinner { width: 34px; height: 34px; border: 4px solid #d9e2f1; border-top-color: #185abd; border-radius: 50%; margin: 24px auto 8px; animation: spin .8s linear infinite; }
    .spinner.stopped { animation: none; border-top-color: #7fba00; }
    .button { display: inline-block; margin-top: 18px; padding: 10px 16px; border-radius: 12px; background: #185abd; color: #fff; text-decoration: none; font-weight: 700; border: 0; cursor: pointer; }
    .download-frame { width: 0; height: 0; border: 0; position: absolute; left: -9999px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <main class="card" role="status" aria-live="polite">
    <div class="brand-row" aria-label="Microsoft 365 Word">
      <div class="ms365-badge"><span class="ms-grid" aria-hidden="true"><span></span><span></span><span></span><span></span></span><span>Microsoft 365</span></div>
      <div class="word-badge"><span class="word-icon" aria-hidden="true">W</span><span>Word</span></div>
    </div>
    <h1>${safeDisplayName} Word file to PDF</h1>
    <p><strong>Converting and downloading may take a while<br>depending on the size of the Word file.</strong></p>
    <p class="muted">Saved link: ${safeTitle}</p>
    <div id="spinner" class="spinner" aria-hidden="true"></div>
    <p id="statusText" class="muted">The PDF conversion has started automatically.</p>
    <button class="button" type="button" onclick="startDownload()">Start download now</button>
    <iframe id="downloadFrame" class="download-frame" title="PDF download"></iframe>
  </main>
  <script>
    let started = false;
    function stopAnimation() {
      const spinner = document.getElementById('spinner');
      const statusText = document.getElementById('statusText');
      spinner.classList.add('stopped');
      statusText.textContent = 'The download request is complete.';
    }
    function startDownload() {
      const spinner = document.getElementById('spinner');
      const statusText = document.getElementById('statusText');
      spinner.classList.remove('stopped');
      statusText.textContent = 'The PDF conversion has started automatically.';
      const frame = document.getElementById('downloadFrame');
      frame.onload = stopAnimation;
      frame.src = '${safeDownloadUrl}' + (started ? '&retry=' + Date.now() : '');
      started = true;
    }
    window.addEventListener('load', () => setTimeout(startDownload, 500));
  </script>
</body>
</html>`;
}

async function serveConversion(rawUrl, res) {
  const validation = isAllowedPublicUrl(rawUrl);
  if (!validation.ok) return res.status(400).type('text/plain').send(validation.message);
  const workDir = path.join(os.tmpdir(), `word-url-to-pdf-${randomUUID()}`);
  await fsp.mkdir(workDir, { recursive: true });
  try {
    const { inputPath, detectedBaseName } = await downloadSourceFile(rawUrl, workDir);
    const pdfPath = await convertWordToPdf(inputPath, workDir);
    const downloadName = detectedBaseName ? sanitizeFilename(`${detectedBaseName}.pdf`, 'converted.pdf') : 'document.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'no-store');
    const stream = fs.createReadStream(pdfPath);
    stream.on('error', async err => { console.error(err); if (!res.headersSent) res.status(500).type('text/plain').send('Could not read generated PDF.'); await cleanup(workDir); });
    res.on('close', () => cleanup(workDir));
    stream.pipe(res);
  } catch (err) {
    await cleanup(workDir);
    console.error(err);
    res.status(500).type('text/plain').send(`Conversion failed: ${htmlEscape(err.message)}`);
  }
}

function getClientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}
function checkPublicPdfRateLimit(req, res) {
  if (!PUBLIC_PDF_RATE_LIMIT_PER_MINUTE || PUBLIC_PDF_RATE_LIMIT_PER_MINUTE <= 0) return true;
  const key = `${getClientIp(req)}:${req.params.id || ''}`;
  const now = Date.now();
  const windowMs = 60 * 1000;
  const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > bucket.resetAt) { bucket.count = 0; bucket.resetAt = now + windowMs; }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (bucket.count > PUBLIC_PDF_RATE_LIMIT_PER_MINUTE) {
    res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
    res.status(429).type('text/plain').send('Too many PDF requests. Please try again shortly.');
    return false;
  }
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets.entries()) if (now > bucket.resetAt + 60000) rateBuckets.delete(key);
}, 60000).unref();

app.get('/pdf/:id', async (req, res) => {
  const result = await getLinkOr404(req.params.id, res); if (!result) return;
  if (req.query.download !== '1') {
    res.setHeader('Cache-Control', 'no-store');
    return res.type('html').send(renderPublicDownloadNotice(req, result.link));
  }
  if (!checkPublicPdfRateLimit(req, res)) return;
  await serveConversion(result.link.url, res);
});

app.get('/convert', async (req, res) => {
  if (SECRET_TOKEN && !checkToken(req, res)) return;
  const rawUrl = req.query.url;
  if (!rawUrl || typeof rawUrl !== 'string') return res.status(400).type('text/plain').send('Missing url parameter. Example: /convert?url=https%3A%2F%2F1drv.ms%2Fw%2F...%26download%3D1');
  await serveConversion(rawUrl, res);
});

app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));

ensureStore().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Word URL to PDF service listening on port ${PORT}. Data file: ${STORE_PATH}`);
  });
}).catch(err => {
  console.error("Could not initialize data store:", err);
  process.exit(1);
});
