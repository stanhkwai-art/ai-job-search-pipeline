// Turns Telegram button taps and messages into apply requests for apply-runner.mjs on the NAS.
const CHAT = 'REPLACE_TELEGRAM_CHAT_ID';
const res = $('Get updates').first().json || {};
const updates = Array.isArray(res.result) ? res.result : [];
if (!updates.length) return [];
const queue = textOf('Extract queue').split('\n').filter(Boolean)
  .map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
const digest = {};
for (const i of $input.all()) {
  try { const d = JSON.parse(i.json.text); for (const [k, j] of Object.entries(d.jobs || {})) digest[`${d.date}:${k}`] = j; } catch (e) { /* no digest yet */ }
}
// LinkedIn and Indeed pages are never fetched; you paste the job description instead.
// JobsDB links go ahead: the runner reads their JD from the freehire mirror and asks for a paste only if that fails.
const NO_FETCH = /linkedin\.com|indeed\./i;
const PREFIX = /^\s*(hk|uk|contract)\b[\s:：,-]*/i;
const guessTrack = (url, text) => /jobsdb|ctgoodjobs|seek\.com|\.hk(\/|$)/i.test(url) || /hong kong|HK\$|香港/i.test(text) ? 'hk'
  : /\bcontract(or)?\b|day rate|per day|\bIR35\b/i.test(text) ? 'contract' : 'uk';
const HELP = '傳職位連結畀我，或者喺摘要撳 ✍️，我就會整 CV 同 cover letter。CV 會喺夜晚整（慳日頭嘅 Claude 額度）；急用就喺開頭加「急」，或者之後傳「急」/「急 公司名」。\n開頭可以加 hk / uk / contract 指定線。\nLinkedIn 同 Indeed 我讀唔到，要將 JD 文字貼過嚟（可以分幾段）。\n申請咗就傳「已申請 公司名」或者「已申請 hk1」（摘要編號），我會記低。';
const NEED_JD = '呢個係 LinkedIn／Indeed 職位，我唔會讀嗰個網站。我會先喺其他網站（JobsDB、公司或者獵頭網站）搵同一份 JD，搵到就直接整 CV；搵唔到會再叫你貼 JD。';
const now = Date.now(), iso = new Date(now).toISOString();
let seq = 0;
const newId = () => `${today.replace(/-/g, '')}-${String(now).slice(-6)}-${++seq}`;
const jobs = queue.filter(q => q.type === 'job');
const added = [], sends = [];
const say = text => sends.push({ json: { kind: 'send', method: 'sendMessage', body: { chat_id: CHAT, text, disable_web_page_preview: true } } });
const enqueue = item => {
  // A link sent again with its JD pasted is a fresh request; the runner retires the older one.
  const dup = item.url && !item.jd && jobs.find(j => j.url === item.url);
  if (dup && item.urgent) { const line = { type: 'urgent', id: dup.id, at: iso }; added.push(line); queue.push(line); say(`⚡ 急件：${dup.title || dup.url}，下一輪（5 分鐘內）開始整。`); return null; }
  if (dup) { say(`呢份工已經喺隊列（${dup.title || dup.url}）。`); return null; }
  const full = { type: 'job', id: newId(), at: iso, jd: '', title: '', company: '', ...item };
  full.needs_jd = Boolean(full.url && NO_FETCH.test(full.url) && !full.jd);
  added.push(full); jobs.push(full);
  say(full.needs_jd ? NEED_JD : `收到 ✍️ ${full.title || full.url || 'JD'}${full.company ? ' @ ' + full.company : ''}（${full.track} 線），${full.urgent ? '急件，即刻整' : '今晚會整（急用就傳「急」）'}，整好 CV 會通知你。`);
  return full;
};
// "已申請 Acme" or "已申請 uk2" records an application made outside the pipeline.
const APP_COLS = ['date_applied', 'track', 'client', 'role', 'agency', 'source', 'url', 'day_rate_or_salary', 'ir35', 'right_to_represent_confirmed', 'status', 'last_update', 'last_followup', 'next_action', 'notes'];
const appRows = [];
const findJob = q => {
  const key = q.match(/^(hk|uk|contract)\d+$/i);
  if (key) { const hit = Object.keys(digest).filter(k => k.endsWith(':' + q.toLowerCase())).sort().pop(); return hit ? digest[hit] : null; }
  const n = q.toLowerCase();
  return jobs.slice().reverse().find(j => String(j.company || '').toLowerCase().includes(n) || String(j.title || '').toLowerCase().includes(n)) || null;
};
let maxId = 0;
for (const u of updates) {
  maxId = Math.max(maxId, u.update_id || 0);
  const cb = u.callback_query;
  if (cb) {
    if (String(cb.message && cb.message.chat && cb.message.chat.id) !== CHAT) continue;
    sends.push({ json: { kind: 'send', method: 'answerCallbackQuery', body: { callback_query_id: cb.id } } });
    const m = String(cb.data || '').match(/^a:(\d{4}-\d{2}-\d{2}):(\w+)$/);
    const job = m && digest[`${m[1]}:${m[2]}`];
    if (!job) { say('搵唔到呢份工，可能摘要太舊。直接傳連結畀我就得。'); continue; }
    enqueue({ track: job.track, title: job.title, company: job.company, url: job.url, score: job.score });
    continue;
  }
  const msg = u.message;
  if (!msg || String(msg.chat && msg.chat.id) !== CHAT) continue;
  let text = String(msg.text || msg.caption || '').trim();
  if (!text || /^\/(start|help)\b/i.test(text)) { say(HELP); continue; }
  const ap = text.match(/^(?:已申請|已申请|applied)\s*[:：]?\s*(.{2,120})$/i);
  if (ap) {
    const q = ap[1].trim(), job = findJob(q);
    const row = { date_applied: today, track: job ? job.track || '' : '', client: safe(job ? job.company || q : q), role: safe(job ? job.title || '' : ''), source: 'telegram', url: job ? job.url || '' : '', status: 'applied', last_update: today, notes: job ? '' : 'recorded from Telegram' };
    appRows.push(row);
    say(`📥 已記錄申請：${row.client}${row.role ? '｜' + row.role : ''}${job ? '' : '（搵唔到對應職位，只記公司名）'}`);
    continue;
  }
  // "急" alone makes the newest queued job urgent; "急 Acme" / "急 hk1" picks one; "急 <link or JD>" queues it urgent.
  const rush = text.match(/^\s*(?:急|urgent)(?![\p{L}\p{N}])[\s:：,-]*/iu);
  if (rush) {
    text = text.slice(rush[0].length).trim();
    const q = text && !/https?:\/\//.test(text) && text.length <= 120 ? text : '';
    if (!text || q) {
      const key = q.match(/^(hk|uk|contract)\d+$/i);
      const d = key ? findJob(q) : null;
      const target = !text ? jobs[jobs.length - 1] : d ? jobs.slice().reverse().find(j => d.url && j.url === d.url) : findJob(q);
      if (target && target.type === 'job') { const line = { type: 'urgent', id: target.id, at: iso }; added.push(line); queue.push(line); say(`⚡ 急件：${target.title || target.url || 'JD'}${target.company ? ' @ ' + target.company : ''}，下一輪（5 分鐘內）開始整。`); }
      else if (d) enqueue({ track: d.track, title: d.title, company: d.company, url: d.url, score: d.score, urgent: true });
      else say('搵唔到隊列入面邊份工。傳「急」加連結，或者「急 公司名」。');
      continue;
    }
  }
  const pre = text.match(PREFIX); if (pre) text = text.slice(pre[0].length);
  const url = (text.match(/https?:\/\/\S+/) || [''])[0];
  const rest = text.replace(url, '').trim();
  const fast = rush ? { urgent: true } : {};
  if (url) { enqueue({ track: pre ? pre[1].toLowerCase() : guessTrack(url, rest), url, jd: rest.length > 200 ? rest : '', hint: rest.length > 200 ? '' : rest, ...fast }); continue; }
  // Text without a link continues the latest request from the last 30 minutes, if it is waiting for a job description.
  const latest = jobs.filter(j => now - Date.parse(j.at) < 30 * 60000).pop();
  const parts = latest ? queue.concat(added).filter(q => q.type === 'jd' && q.id === latest.id).length : 0;
  if (latest && (latest.needs_jd || latest.jd || parts) && !pre) {
    const line = { type: 'jd', id: latest.id, at: iso, text };
    added.push(line); queue.push(line); latest.needs_jd = false;
    say(`收到 JD 第 ${parts + 1} 段。冇其他段嘅話，3 分鐘後開始整 CV。`);
  } else if (text.length > 200) {
    enqueue({ track: pre ? pre[1].toLowerCase() : guessTrack('', text), url: '', jd: text, ...fast });
  } else say(HELP);
}
const out = [fileItem(String(maxId + 1), '/shared/tg-offset.txt')];
if (added.length) out.push(fileItem(added.map(a => JSON.stringify(a)).join('\n') + '\n', '/shared/apply-queue.jsonl', true));
if (appRows.length) out.push(fileItem(toCsv({ header: APP_COLS, rows: appRows }).split('\n').slice(1).join('\n'), '/shared/applications.csv', true));
return out.concat(sends);
