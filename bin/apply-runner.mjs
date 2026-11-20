// Runs inside the ai-job-search container, started every 5 minutes by apply-runner.sh on the NAS.
// Takes one request from /shared/apply-queue.jsonl (written by n8n WF8), runs /apply in the track's repo,
// copies the PDFs to /shared/cv-out/ (Synology: docker/ai-job-search/shared/cv-out) and sends you a Telegram message.
// Nothing is submitted or sent to employers: you apply yourself on the job site.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const SHARED = process.env.SHARED_DIR || '/shared';
const QUEUE = `${SHARED}/apply-queue.jsonl`;
const OUT = `${SHARED}/apply-out`;
const CV_OUT = `${SHARED}/cv-out`;
const LOG = `${SHARED}/apply-log.csv`;
const REPOS = process.env.REPOS_DIR || '/repos';
const CLAUDE = process.env.CLAUDE_BIN || 'claude';
// How prompts and messages refer to you, and the prefix for delivered file names (e.g. "Jane_Doe_").
const WHO = process.env.CANDIDATE_NAME || 'the candidate';
const FILE_PREFIX = process.env.CV_FILE_PREFIX || '';
const QUIET_MS = 3 * 60000; // wait for the last pasted part of a job description
const RETRY_MS = 30 * 60000, GIVE_UP_MS = 12 * 3600000; // freehire can take a few hours to index a new JobsDB post
const JOBSDB = /jobsdb\.com\/job\/\d+/i;
const TIMEOUT_MS = 45 * 60000;
// JobsDB and SEEK answer automated fetches with a bot check (403), so their JDs are pasted like LinkedIn's and Indeed's.
const NO_FETCH = /linkedin\.com|indeed\.|jobsdb\.com|seek\.com/i;
// LinkedIn and Indeed are never fetched, but the same job is often posted on JobsDB, the employer's site or an agency
// site, which freehire.me indexes: look there first and only ask you to paste the JD when no copy is found.
const COPYABLE = /linkedin\.com|indeed\./i;

export function loadRequests(text, now = Date.now()) {
  const jobs = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let q; try { q = JSON.parse(line); } catch { continue; }
    if (q.type === 'job' && q.id) jobs.set(q.id, { ...q, last: Date.parse(q.at) || 0 });
    else if (q.type === 'jd' && jobs.has(q.id)) {
      const j = jobs.get(q.id);
      j.jd = [j.jd, q.text].filter(Boolean).join('\n\n');
      j.needs_jd = false;
      j.last = Math.max(j.last, Date.parse(q.at) || 0);
    } else if (q.type === 'urgent' && jobs.has(q.id)) jobs.get(q.id).urgent = true;
    else if (q.type === 'last' && jobs.has(q.id)) jobs.get(q.id).last_in_line = true; // run after everything else
    else if (q.type === 'prio' && jobs.has(q.id)) jobs.get(q.id).prio = Number(q.n); // lower runs first within a track
    else if (q.type === 'approve' && jobs.has(q.id)) jobs.get(q.id).approved = true; // you said OK to a held job
    else if (q.type === 'cancel') jobs.delete(q.id); // not a fit, never make this CV
  }
  return [...jobs.values()].map(j => ({ ...j, ready: now - j.last >= QUIET_MS && !(j.needs_jd && !j.jd && !(COPYABLE.test(j.url || '') && j.title)) && Boolean(j.url || j.jd) }));
}

// CV quality rules learned from a round of applications with no interviews. They ride on the prompt so they apply
// to every track without editing each repo; move them into tailoring.md once they settle.
export function cvRules(track) {
  const rtw = process.env.RIGHT_TO_WORK_LINE; // e.g. "Full right to work, no sponsorship needed"
  return [
    'CV quality rules (they add to tailoring.md and never relax its truthfulness rules):',
    '- Contact line as plain text: in the CV preamble add \\AtBeginDocument{\\def\\mobilephonesymbol{}\\def\\emailsymbol{}} so icon glyph names ("MOBILE-ALT", "Envelope") stay out of the ATS text layer.'
      + (rtw ? ` The address line must also state "${rtw}".` : ''),
    '- Profile: at most 4 lines (about 60 words), opening with the JD\'s own job title where it truthfully applies. Then a "Key Achievements" section of exactly 3 bullets, each with a number or a concrete outcome taken from a career-bank record.',
    '- Every experience bullet reads action + scope + result. Prefer records that carry numbers. Never open with "Responsible for", and never write a bare "established governance frameworks" without saying what it covered.',
    '- An employer that appears twice in the timeline gets "(rejoined)" on the later entry, so it reads as one employer, not a duplicate.',
    '- Two roles both ending "Present": write "part-time" or "remote, alongside" only if the record says so; otherwise add a question to gaps.md and keep the most relevant one first.',
    `- Pages: fill exactly 2 pages${track === 'contract' ? ' (this contract track may use 1 to 2)' : ''}; compress the earliest roles into one "Earlier career" line.`,
    '- After compiling, run tools/verify_pdf.py --dump-text and confirm the dump contains no "MOBILE-ALT" or "Envelope".',
  ].join('\n');
}

export function buildPrompt(job, dir) {
  const source = job.url && !NO_FETCH.test(job.url) ? job.url : `the job description in ${dir}/jd-input.md`;
  return [
    `/apply ${source}`,
    '',
    `This run is unattended: do not ask questions. Where you would ask ${WHO}, write the question in gaps.md and carry on.`,
    `The CV, cover letter, agency email and screener answers must never mention anything ${WHO} lacks or has not done (no "gaps", "not yet", "no hands-on", "to be upfront"). The career bank is incomplete: a skill it does not record is unrecorded, not missing. Leave it out of those documents and list it in gaps.md as a question for ${WHO}.`,
    cvRules(job.track),
    job.jd ? `The job description is in ${dir}/jd-input.md (source: ${job.jd_source || `pasted by ${WHO}`}). Use it as the JD.` : '',
    // Your own instructions for this one application (queue line "notes"), e.g. how to pitch your interest.
    job.notes ? `${WHO}'s instructions for this application (follow them; they never override the rules above):\n${String(job.notes).slice(0, 2000)}` : '',
    NO_FETCH.test(job.url || '') ? 'Do not fetch the job URL or any linkedin.com, indeed.com, jobsdb.com or seek.com page.' : '',
    `When everything is written, create ${dir}/result.json with exactly these keys:`,
    '{"folder": absolute path of the application folder, "company": "", "role": "", "cv_pdf": absolute path, "cover_pdf": absolute path or "",',
    ' "cover_text": the cover letter or short agency email as plain text (under 1500 characters),',
    ' "worth_applying": "yes" | "maybe" | "no", "gaps": up to 3 short lines naming JD requirements the career bank has no record of yet (phrase as "未有紀錄：…", never as "no experience"),',
    ' "screener": [{"q": "", "a": ""}] for questions this application will likely ask, answers only from answers.md, never a pay floor}',
  ].filter(Boolean).join('\n');
}

// JobsDB blocks direct fetches, but freehire.me (the same public job index /scrape uses) mirrors its postings with the full text.
// Search by title and accept only the hit whose JobsDB id matches the link, so a similar job is never used by mistake.
let fetchImpl = (...a) => fetch(...a);
export const _setFetch = f => { fetchImpl = f; };
export async function freehireJD(job, fetchFn = fetchImpl) {
  const id = (String(job.url || '').match(/jobsdb\.com\/job\/(\d+)/) || [])[1];
  const hints = String(job.hint || '').split(/\s*(?:\n|\||:|–|—| - | at | @ )\s*/i).map(h => h.trim()).filter(h => h.split(/\s+/).length >= 2 && h.length <= 120);
  const queries = job.title ? [`title:"${job.title}"`, job.title] : hints.map(h => `title:"${h}"`);
  if (!id || !queries.length) return null;
  for (const q of queries) {
    try {
      const u = 'https://freehire.me/api/v1/agent/jobs/search?' + new URLSearchParams({ q, limit: '25', description_format: 'text', country: 'hk' });
      const r = await fetchFn(u, { headers: { 'User-Agent': 'ai-job-search-dev/ai-job-search/1.0 (freehire-search)', Accept: 'application/json' } });
      if (!r.ok) continue;
      const hit = ((await r.json()).data || []).find(j => String(j.external_id || '').endsWith(':' + id) || String(j.url || '').includes(`/job/${id}`));
      if (hit && hit.description) return { text: hit.description, company: hit.company || '', title: hit.title || '', closed: hit.closed_at || null, source: `freehire.me mirror of JobsDB job ${id}` };
    } catch { /* network error: try the next query, then give up */ }
  }
  return null;
}

// A LinkedIn or Indeed job's copy on freehire: same title and same company, still open. Both must match, so a
// similar role at another firm is never used.
const words = s => String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\b(limited|ltd|plc|inc|llc|group|holdings?|recruitment|agency|hong kong|hk|uk|the|of|and)\b/g, ' ').replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').trim();
const sameTitle = (a, b) => { const x = words(a), y = words(b); return Boolean(x && y && (x === y || (x.length > 12 && y.length > 12 && (x.includes(y) || y.includes(x))))); };
const GENERIC = new Set(['bank', 'banking', 'international', 'securities', 'technology', 'technologies', 'solutions', 'services', 'financial', 'finance', 'asia', 'pacific', 'china', 'global', 'capital', 'partners', 'consulting', 'company', 'corporation', 'client', 'unnamed', 'leading', 'firm', 'council']);
const keyWords = s => words(s).split(' ').filter(w => w.length > 2 && !GENERIC.has(w));
const sameCompany = (a, b) => { const y = keyWords(b); return keyWords(a).some(w => y.includes(w)); };
export async function copyJD(job, fetchFn = fetchImpl) {
  if (!COPYABLE.test(job.url || '') || !job.title || !job.company) return null;
  const country = job.track === 'hk' ? 'hk' : 'gb';
  for (const q of [`title:"${job.title.replace(/\s*\(ref[^)]*\)/i, '')}"`, job.title]) {
    try {
      const u = 'https://freehire.me/api/v1/agent/jobs/search?' + new URLSearchParams({ q, limit: '25', description_format: 'text', country });
      const r = await fetchFn(u, { headers: { 'User-Agent': 'ai-job-search-dev/ai-job-search/1.0 (freehire-search)', Accept: 'application/json' } });
      if (!r.ok) continue;
      const hit = ((await r.json()).data || []).find(j => !j.closed_at && j.description && String(j.description).length > 300
        && !COPYABLE.test(String(j.url || '')) && sameTitle(j.title, job.title) && sameCompany(job.company, j.company));
      if (hit) return { text: hit.description, url: String(hit.url || '').split('?')[0], source: `copy of the ${/indeed\./i.test(job.url) ? 'Indeed' : 'LinkedIn'} job found on freehire.me (${String(hit.url || '').split('?')[0]})` };
    } catch { /* network error: try the next query */ }
  }
  return null;
}

const slug = s => String(s || '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_').slice(0, 40) || 'Job';

export function deliverFiles(result, job, date) {
  // "Rise Associates Asia Limited (agency; client undisclosed)" -> "Rise_Associates_Asia"
  const shortCo = c => String(c || '').replace(/\([^)]*\)/g, ' ').replace(/[,\s]+(limited|ltd|inc|plc|llc|international financial)\.?\s*$/i, '').replace(/[,\s]+(limited|ltd)\.?\s*$/i, '').trim();
  const company = slug(shortCo(result.company || job.company)), role = slug(result.role || job.title);
  const folder = `${date}_${company}_${role}`;
  const dest = `${CV_OUT}/${folder}`;
  fs.mkdirSync(dest, { recursive: true });
  const files = [];
  const copy = (src, name) => { if (src && fs.existsSync(src)) { fs.copyFileSync(src, `${dest}/${name}`); files.push(name); } };
  // The date goes in every file name so versions for the same company never get mixed up after download.
  copy(result.cv_pdf, `${FILE_PREFIX}CV_${company}_${date}.pdf`);
  copy(result.cover_pdf, `${FILE_PREFIX}Cover_${company}_${date}.pdf`);
  if (result.cover_text) { const t = `Cover_${company}_${date}.txt`; fs.writeFileSync(`${dest}/${t}`, result.cover_text); files.push(t); }
  return { folder, files };
}

export function messages(result, job, delivered) {
  const worth = { yes: '✅ 值得申請', maybe: '🤔 可以試', no: '⚠️ 唔太啱' }[result.worth_applying] || '';
  const head = [
    `📄 CV 整好：${result.role || job.title} @ ${result.company || job.company}`,
    worth,
    result.gaps && result.gaps.length ? '要你確認（career-bank 未有紀錄）：\n' + [].concat(result.gaps).map(g => '• ' + g).join('\n') : '',
    delivered.files.length ? `檔案：Synology › docker › ai-job-search › shared › cv-out › ${delivered.folder}\n${delivered.files.join('\n')}` : '⚠️ 冇 PDF，睇吓 apply-out 入面嘅 log',
    job.url ? `申請：${job.url}` : '',
    '申請完唔使話我知，收到確認 email 會自動記錄。',
  ].filter(Boolean).join('\n\n');
  const out = [head];
  if (result.cover_text) out.push('Cover letter（長按複製）：\n\n' + result.cover_text);
  if (result.screener && result.screener.length) out.push('Screener 建議答案：\n\n' + result.screener.map(s => `Q: ${s.q}\nA: ${s.a}`).join('\n\n'));
  return out.map(t => t.slice(0, 4000));
}

async function telegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) { console.log('[telegram not configured]', text); return; }
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
  });
  if (!r.ok) console.error('telegram', r.status, await r.text());
}

const csvCell = v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);

// "You've hit your 5-hour limit · resets 11:40pm (Europe/London)": the time is local to the container (TZ=Europe/London).
export function limitResetAt(text, now = Date.now()) {
  if (!/hit your .*limit/i.test(text || '')) return null;
  const m = String(text).match(/resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!m) return now + 60 * 60000;
  let h = Number(m[1]) % 12; if (/pm/i.test(m[3])) h += 12;
  const d = new Date(now); d.setHours(h, Number(m[2] || 0), 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime() + 2 * 60000;
}
const PAUSE = `${OUT}/.paused-until`;
// CVs are made at night so they do not use up your Claude quota while you work; a job sent with "急" goes now.
// shared/apply-hours.txt holds the window, e.g. "00:00-08:00" or "always"; without the file it is 19:00-06:00.
const HOURS = `${SHARED}/apply-hours.txt`;
// Keep part of your weekly Claude quota for yourself: shared/apply-budget.json, e.g.
// {"max":7,"since":"2026-11-09T13:00:00Z","until":"2026-11-12T20:00:00Z","model":"sonnet"}
// caps CV runs started between since and until (急 jobs still run, and count), and can force one model.
// shared/apply-hold.txt lists tracks (e.g. "hk uk") whose CVs wait for your OK: an approve line or 急.
const HOLD = `${SHARED}/apply-hold.txt`;
export function heldTracks(text) { return new Set(String(text || '').toLowerCase().match(/\b(hk|uk|contract)\b/g) || []); }
const BUDGET = `${SHARED}/apply-budget.json`, BUDGET_RUNS = `${OUT}/.budget-runs`;
export function budgetState(now, budgetText, runsText) {
  let b; try { b = JSON.parse(budgetText); } catch { return null; }
  const since = Date.parse(b.since) || 0, until = Date.parse(b.until) || 0;
  if (!(now >= since && now < until)) return null;
  const used = String(runsText || '').split('\n').map(Number).filter(t => t >= since && t < until).length;
  return { max: Number(b.max) || 0, used, left: Math.max(0, (Number(b.max) || 0) - used), model: b.model, until: b.until, since: b.since };
}
export function parseHours(text) {
  if (/always|24\s*h/i.test(String(text || ''))) return null;
  const m = String(text || '').match(/(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?/);
  return m ? [Number(m[1]) * 60 + Number(m[2] || 0), Number(m[3]) * 60 + Number(m[4] || 0)] : [19 * 60, 6 * 60];
}
export function inWindow(now, hours) {
  if (!hours) return true;
  const d = new Date(now), m = d.getHours() * 60 + d.getMinutes(), [s, e] = hours;
  return s <= e ? m >= s && m < e : m >= s || m < e;
}
// Score 4+ gets Opus; lower, unscored and recruiter jobs get Sonnet. The helper subagents always use Sonnet.
export const OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-5-5';
export function scoreFor(job, digests = []) {
  if (job.score !== undefined && job.score !== null && job.score !== '' && Number.isFinite(Number(job.score))) return Number(job.score);
  const hits = digests.flatMap(d => Object.values((d && d.jobs) || {})).filter(d => job.url && d.url === job.url).map(d => Number(d.score)).filter(Number.isFinite);
  if (hits.length) return Math.max(...hits);
  const m = String(job.source || '').match(/score\s*(\d(?:\.\d)?)/i);
  return m ? Number(m[1]) : null;
}
// Track order (TRACK_ORDER, space separated): earlier tracks run first; queue order within a track.
const TRACK_ORDER = (process.env.TRACK_ORDER || 'contract uk hk').split(/\s+/).filter(Boolean);
export const trackRank = j => { const i = TRACK_ORDER.indexOf(j.track); return i < 0 ? TRACK_ORDER.length : i; };
export const modelFor = score => score !== null && score >= 4 ? OPUS : SONNET;
function readDigests() {
  try { return fs.readdirSync(`${SHARED}/digest`).filter(f => f.endsWith('.json')).sort().slice(-21).map(f => { try { return JSON.parse(fs.readFileSync(`${SHARED}/digest/${f}`, 'utf8')); } catch { return null; } }); } catch { return []; }
}

export async function runOnce(now = Date.now()) {
  if (!fs.existsSync(QUEUE)) return 'empty';
  if (fs.existsSync(PAUSE) && now < Number(fs.readFileSync(PAUSE, 'utf8'))) return 'paused (Claude usage limit)';
  const candidates = loadRequests(fs.readFileSync(QUEUE, 'utf8'), now).filter(j => j.ready && !fs.existsSync(`${OUT}/${j.id}/status`))
    .sort((a, b) => Number(Boolean(b.urgent)) - Number(Boolean(a.urgent)) || Number(Boolean(a.last_in_line)) - Number(Boolean(b.last_in_line)) || trackRank(a) - trackRank(b) || (a.prio ?? 999) - (b.prio ?? 999));
  let hoursText = ''; try { hoursText = fs.readFileSync(HOURS, 'utf8'); } catch { /* default window */ }
  const awake = inWindow(now, parseHours(hoursText));
  let job = null, waiting = 0;
  // A JD found during the day is kept for the night run, so the search is not repeated.
  const pick = (j, got) => {
    if (got) Object.assign(j, got);
    if (awake || j.urgent) return true;
    if (got) { fs.mkdirSync(`${OUT}/${j.id}`, { recursive: true }); fs.writeFileSync(`${OUT}/${j.id}/jd-found.json`, JSON.stringify(got)); }
    waiting++;
    return false;
  };
  let holdText = ''; try { holdText = fs.readFileSync(HOLD, 'utf8'); } catch { /* nothing held */ }
  const held = heldTracks(holdText);
  for (const j of candidates) {
    if (held.has(j.track) && !j.approved && !j.urgent) {
      const told = `${OUT}/${j.id}/hold-told`;
      if (!fs.existsSync(told)) {
        fs.mkdirSync(`${OUT}/${j.id}`, { recursive: true });
        fs.writeFileSync(told, String(now));
        await telegram(`🙋 ${j.track.toUpperCase()} 工等你批准先整 CV：${j.title || j.url}${j.company ? ' @ ' + j.company : ''}\n${j.url || '（貼咗 JD）'}\n要做就話畀 Claude 知（或者傳「急」）。`);
      }
      continue;
    }
    const found = `${OUT}/${j.id}/jd-found.json`;
    if (!j.jd && fs.existsSync(found)) { try { Object.assign(j, JSON.parse(fs.readFileSync(found, 'utf8'))); } catch { /* search again */ } }
    if (!j.jd && COPYABLE.test(j.url || '')) {
      const tries = `${OUT}/${j.id}/copy-tries`;
      const last = fs.existsSync(tries) ? Number(fs.readFileSync(tries, 'utf8').trim().split('\n').pop()) : 0;
      if (last && (now - last < RETRY_MS || now - j.last >= GIVE_UP_MS)) continue; // waiting for a paste
      const cp = await copyJD(j);
      if (cp) { if (pick(j, { jd: cp.text, jd_source: cp.source })) { job = j; break; } continue; }
      fs.mkdirSync(`${OUT}/${j.id}`, { recursive: true });
      // Ask for the paste once; the search is retried every 30 minutes for 12 hours.
      if (!last) await telegram(`📋 ${j.title}${j.company ? ' @ ' + j.company : ''} 係 LinkedIn／Indeed 職位，其他網站搵唔到同一份 JD。\n請喺 app 複製 JD 貼畀我（開頭加 ${j.track}），我會再試搵 12 個鐘。\n${j.url}`);
      fs.appendFileSync(tries, `${now}\n`);
      continue;
    }
    if (j.jd || !JOBSDB.test(j.url || '')) { if (pick(j)) { job = j; break; } continue; }
    // You re-sent the link with the JD pasted: that newer request replaces this one.
    if (candidates.some(o => o !== j && o.url === j.url && o.jd)) { fs.mkdirSync(`${OUT}/${j.id}`, { recursive: true }); fs.writeFileSync(`${OUT}/${j.id}/status`, 'superseded'); continue; }
    const tries = `${OUT}/${j.id}/freehire-tries`;
    const last = fs.existsSync(tries) ? Number(fs.readFileSync(tries, 'utf8').trim().split('\n').pop()) : 0;
    if (now - last < RETRY_MS) continue;
    const fh = await freehireJD(j);
    if (fh) { if (pick(j, { jd: fh.text, jd_source: fh.source, company: j.company || fh.company })) { job = j; break; } continue; }
    fs.mkdirSync(`${OUT}/${j.id}`, { recursive: true });
    if (now - j.last < GIVE_UP_MS) {
      if (!last) await telegram(`🔎 freehire 仲未有呢份 JobsDB 工嘅 JD：${j.title || j.url}\n每 30 分鐘再試，最多等 12 個鐘。急嘅話直接喺 app 複製 JD 貼畀我。`);
      fs.appendFileSync(tries, `${now}\n`);
      continue;
    }
    fs.writeFileSync(`${OUT}/${j.id}/status`, 'blocked');
    await telegram(`⚠️ 12 個鐘都攞唔到 JD：${j.title || j.url}\n請喺 JobsDB app 複製 JD 文字，連埋條連結一齊貼畀我。`);
    return 'blocked';
  }
  if (!job) return waiting ? `waiting for the night window (${waiting})` : 'nothing ready';
  const readOr = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
  const budget = budgetState(now, readOr(BUDGET), readOr(BUDGET_RUNS));
  if (budget && !budget.left && !job.urgent) {
    const told = `${OUT}/.budget-told`;
    if (readOr(told) !== budget.since) {
      fs.writeFileSync(told, budget.since);
      await telegram(`🪫 今個星期 CV 用量（${budget.max} 份）用完，剩低嘅 token 留畀你。其餘工排住隊，${budget.until.slice(0, 10)} 額度重設後再做。急件照做。`);
    }
    return `budget used (${budget.used}/${budget.max})`;
  }
  const score = scoreFor(job, readDigests());
  const model = budget && /sonnet/i.test(budget.model || '') ? SONNET : budget && /opus/i.test(budget.model || '') ? OPUS : modelFor(score);
  if (budget) fs.appendFileSync(BUDGET_RUNS, `${now}\n`);
  const dir = `${OUT}/${job.id}`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${dir}/status`, 'running');
  if (job.jd) fs.writeFileSync(`${dir}/jd-input.md`, `# Job description (${job.jd_source || `pasted by ${WHO}`})\n\nSource: ${job.url || 'pasted text'}\n\n${job.jd}\n`);
  await telegram(`⏳ 開始整 CV：${job.title || job.url || 'JD'}${job.company ? ' @ ' + job.company : ''}（${model === OPUS ? 'Opus' : 'Sonnet'}${score !== null ? '，' + score + ' 分' : '，未評分'}${job.urgent ? '，急' : ''}）`);

  const cwd = `${REPOS}/${['hk', 'uk', 'contract'].includes(job.track) ? job.track : 'uk'}`;
  // Claude never sees the Telegram token.
  const env = { ...process.env, CLAUDE_CODE_SUBAGENT_MODEL: SONNET }; delete env.TELEGRAM_BOT_TOKEN; delete env.TELEGRAM_CHAT_ID;
  const r = spawnSync(CLAUDE, ['-p', buildPrompt(job, dir), '--model', model, '--output-format', 'text'], { cwd, env, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 });
  fs.writeFileSync(`${dir}/claude.log`, `exit ${r.status}${r.error ? ' ' + r.error.message : ''}\n\n${r.stdout || ''}\n\n${r.stderr || ''}`);

  // Out of Claude quota: put the job back in the queue and wait for the reset instead of failing it.
  const reset = limitResetAt(`${r.stdout || ''}\n${r.stderr || ''}`, now);
  if (reset) {
    fs.rmSync(`${dir}/status`, { force: true });
    fs.writeFileSync(PAUSE, String(reset));
    if (budget) { try { fs.writeFileSync(BUDGET_RUNS, fs.readFileSync(BUDGET_RUNS, 'utf8').split('\n').filter(t => t && t !== String(now)).map(t => t + '\n').join('')); } catch { /* nothing to undo */ } }
    const at = new Date(reset).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    await telegram(`⏸ Claude 額度用完。${job.title || 'JD'}${job.company ? ' @ ' + job.company : ''} 同其餘嘅工 ${at} 之後自動繼續。`);
    return 'paused (Claude usage limit)';
  }
  let result = null;
  try { result = JSON.parse(fs.readFileSync(`${dir}/result.json`, 'utf8')); } catch { /* not written */ }
  if (!result) {
    fs.writeFileSync(`${dir}/status`, 'failed');
    const tail = (r.stdout || r.stderr || String(r.error || '')).trim().split('\n').slice(-8).join('\n');
    await telegram(`❌ 整唔到 CV：${job.title || job.url || 'JD'}\n\n${tail.slice(0, 1500)}\n\nLog：shared/apply-out/${job.id}/claude.log`);
    return 'failed';
  }
  // /apply refuses to draft without a JD; that is a stop, not a finished application.
  if (!result.cv_pdf || !fs.existsSync(result.cv_pdf)) {
    fs.writeFileSync(`${dir}/status`, 'blocked');
    await telegram(`⚠️ 冇整 CV：${result.role || job.title} @ ${result.company || job.company}\n\n${[].concat(result.gaps || []).map(g => '• ' + g).join('\n')}\n\n請喺 app 複製 JD 文字貼畀我。`.slice(0, 4000));
    return 'blocked';
  }
  const date = new Date(now).toISOString().slice(0, 10);
  const delivered = deliverFiles(result, job, date);
  if (!fs.existsSync(LOG)) fs.writeFileSync(LOG, 'id,date,track,company,role,url,folder\n');
  fs.appendFileSync(LOG, [job.id, date, job.track, result.company || job.company, result.role || job.title, job.url || '', delivered.folder].map(csvCell).join(',') + '\n');
  fs.writeFileSync(`${dir}/status`, 'done');
  for (const m of messages(result, job, delivered)) await telegram(m);
  return 'done';
}

// Messages a Claude chat session writes for you: shared/tg-outbox/*.txt, sent in name order, then moved to sent/.
// A file may hold several messages separated by a line containing only "---"; each is cut to Telegram's 4000-character limit.
export async function flushOutbox(dir = `${SHARED}/tg-outbox`, send = telegram) {
  if (!fs.existsSync(dir)) return 0;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.txt')).sort();
  fs.mkdirSync(`${dir}/sent`, { recursive: true });
  let n = 0;
  for (const f of files) {
    const parts = fs.readFileSync(`${dir}/${f}`, 'utf8').split(/^---$/m).map(s => s.trim()).filter(Boolean);
    for (const p of parts) { for (let i = 0; i < p.length; i += 4000) await send(p.slice(i, i + 4000)); n++; }
    fs.renameSync(`${dir}/${f}`, `${dir}/sent/${f}`);
  }
  return n;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  flushOutbox().catch(e => console.error('outbox', e)).then(() => runOnce()).then(s => console.log(new Date().toISOString(), s)).catch(e => { console.error(e); process.exit(1); });
}
