// Saturday-night review of the week: what was scored, which CVs were made, what was applied for,
// and which job emails WF1 never read (so nothing recommended slips through).
const inWeek = d => daysSince(String(d || '').slice(0, 10)) < 7;
const norm = s => String(s || '').toLowerCase().replace(/\(.*?\)|limited|ltd|plc|agency.*$/g, '').replace(/[^a-z0-9一-鿿]+/g, ' ').trim();
const same = (a, b) => { const x = norm(a), y = norm(b); return x && y && (x.includes(y) || y.includes(x)); };
const all = name => { try { return $(name).all().map(i => i.json); } catch (e) { return []; } };
const csvOf = name => { try { return parseCsv(textOf(name)).rows; } catch (e) { return []; } };

// Scores from the daily /scrape reports, one row per job (best score kept). Week paths reads 30 days:
// the week's reports make the week's totals; older ones only give a score to CVs made this week for
// jobs scored earlier.
const reps = [];
for (const r of all('Extract report')) {
  let rep; try { rep = JSON.parse(r.text); } catch (e) { continue; }
  if (rep && Array.isArray(rep.jobs)) reps.push(rep);
}
const mergeJobs = list => {
  const scored = new Map();
  for (const rep of list) for (const j of rep.jobs) {
    const key = j.url || `${rep.track}|${j.company}|${j.title}`;
    const old = scored.get(key);
    if (!old || j.score > old.score) scored.set(key, { ...j, track: rep.track, date: rep.date });
  }
  // The same job often comes from two boards (LinkedIn and JobsDB): merge on company and title too.
  const out = [];
  for (const j of [...scored.values()].sort((a, b) => b.score - a.score)) if (!out.some(k => same(k.company, j.company) && same(k.title, j.title))) out.push(j);
  return out;
};
const jobs = mergeJobs(reps.filter(r => !r.date || inWeek(r.date)));
const earlierJobs = mergeJobs(reps);
// Jobs queued by hand (Telegram, chat, recruiter emails) never pass /scrape; their queue line may carry the score.
const queuedScore = {};
let queueText = ''; try { queueText = textOf('Extract queue'); } catch (e) { /* no queue file yet */ }
for (const line of queueText.split('\n')) {
  let q; try { q = JSON.parse(line); } catch (e) { continue; }
  if (!q || q.type !== 'job' || !q.id) continue;
  const s = Number(q.score ?? (String(q.source || '').match(/\bscore\s*(\d(?:\.\d)?)/i) || [])[1]);
  if (Number.isFinite(s) && s > 0) queuedScore[q.id] = s;
}

// A CV redone for the same job counts once (the latest).
const cvs = csvOf('Extract apply log').filter(r => inWeek(r.date)).reverse()
  .filter((r, i, a) => a.findIndex(o => same(o.company, r.company) && same(o.role, r.role)) === i).reverse();
const apps = csvOf('Extract applications');
const trackers = all('Extract trackers').flatMap(t => { try { return parseCsv(t.text || '').rows; } catch (e) { return []; } });
const appliedStatus = /applied|submitted|interview|offer|rejected|screen/i;
const applied = [
  ...apps.filter(a => inWeek(a.date_applied)).map(a => ({ company: a.client || a.agency, role: a.role, how: a.source || a.agency || 'applications.csv', date: a.date_applied })),
  ...trackers.filter(t => appliedStatus.test(t.status) && inWeek(t.date)).map(t => ({ company: t.company, role: t.role, how: t.channel || 'tracker', date: t.date })),
];
// Application receipts in Gmail catch applications made outside the pipeline.
const receipts = all('Application receipts').map(m => ({
  from: String(m.From || (m.from && m.from.text) || ''), subject: String(m.Subject || m.subject || ''), snippet: String(m.snippet || ''),
})).filter(m => /thank(s| you) for (your )?appl|application (has been |was )?(received|sent|submitted)|your application|application confirmation/i.test(m.subject + ' ' + m.snippet));
// Company: "applying to X" in the text, else the sender's display name, else the sender's domain
// (no-reply@example.com has no display name). Role: "application for ROLE".
const GENERIC_SENDER = /^(no-?reply|do-?not-?reply|notifications?|careers?|jobs?|recruit(ing|ment)?|talent|hr|admin|info|mailer)$/i;
const receiptInfo = r => {
  const text = r.snippet + ' . ' + r.subject;
  const named = (text.match(/\b(?:applying|applied|application|interest)\s+(?:to|with|in)\s+((?:[A-Z0-9][\w&'’-]*\.?\s*){1,6})/) || [])[1];
  const display = (r.from.match(/^"?([^"<]+?)"?\s*</) || [])[1];
  const addr = ((r.from.match(/<([^>]+)>/) || [])[1] || r.from).trim();
  const domain = (addr.split('@')[1] || '').split('.').slice(-3).filter(p => !/^(com|co|org|net|uk|hk|io|careers|jobs|mail|notify|email)$/i.test(p)).pop() || '';
  const company = String(named || (display && !GENERIC_SENDER.test(display.trim()) ? display : '') || domain || addr).replace(/[.\s]+$/, '').trim();
  const role = ((text.match(/\bapplication for (?:the )?(?:position of |role of )?(.{3,90}?)(?:,|\s+(?:has|was|is|position|role|at|with)\b|\.|$)/i) || [])[1] || r.subject).trim().slice(0, 80);
  return { company, role };
};
for (const r of receipts) {
  const { company, role } = receiptInfo(r);
  if (!applied.some(a => same(a.company, company) || same(r.subject, a.company))) applied.push({ company, role, how: 'email receipt', date: '' });
}
const isApplied = (company, role) => applied.some(a => same(a.company, company) && (!role || !a.role || same(a.role, role) || a.how === 'email receipt'));

// Job emails WF1 never read (no processed label), from any platform or sender address.
// Their text goes to the track inboxes so Monday's /scrape reads and scores the jobs inside, and they get the
// processed label so they are handed over once.
const missed = {}, inbox = { hk: [], uk: [], contract: [] }, labels = [];
const bodyOf = mailText;
for (const m of all('Unread job emails')) {
  const from = String(m.From || (m.from && m.from.text) || ''), subject = String(m.Subject || m.subject || '');
  if (!from || /appl(y|ied|ication)|receipt|interview|password|verify|newsletter/i.test(subject)) continue;
  const addr = ((from.match(/<([^>]+)>/) || [])[1] || from).toLowerCase().trim();
  (missed[addr] = missed[addr] || { n: 0, subject }).n++;
  const body = bodyOf(m).slice(0, 12000);
  if (!body) continue;
  const t = subject + ' ' + body;
  const tracks = mailTracks(subject + ' ' + body);
  for (const tr of tracks) inbox[tr].push(mailBlock(subject, from, body));
  if (m.id) labels.push({ json: { kind: 'label', id: m.id } });
}
const skipped = csvOf('Extract seen').filter(r => inWeek(r.date) && r.track.startsWith('skip'));

const start = addDays(today, -6);
const TRACKS = ['hk', 'uk', 'contract'], TN = { hk: 'HK', uk: 'UK', contract: 'Contract' };
const byTrack = list => TRACKS.map(t => `${TN[t]} ${list.filter(x => x.track === t).length}`).join('、');
const top = jobs.filter(j => j.score >= 4);
const mid = jobs.filter(j => j.score >= 3 && j.score < 4);
// Each CV carries the job's score: this week's /scrape, else an earlier report (30 days), else its queue line.
const scoreOf = c => {
  const hit = list => list.find(k => same(k.company, c.company) && same(k.title, c.role));
  const j = hit(jobs) || hit(earlierJobs);
  return j ? j.score : (queuedScore[c.id] ?? null);
};
for (const c of cvs) c.score = scoreOf(c);
const hasCv = j => cvs.some(c => same(c.company, j.company) && same(c.role, j.title));
const status = (company, role, cv) => isApplied(company, role) ? '✅ 已申請' : cv ? '📝 有 CV' : '❗ 未做 CV';
const NEEDS_JD = /linkedin\.com|indeed\./i;
const cvTop = cvs.filter(c => c.score >= 4).length;
const todo = top.filter(j => !isApplied(j.company, j.title) && !hasCv(j));
const waiting = cvs.filter(c => !isApplied(c.company, c.role)).sort((a, b) => (b.score || 0) - (a.score || 0));
const stale = cvs.filter(c => !isApplied(c.company, c.role) && daysSince(c.date) >= 3);
const ms = Object.entries(missed).sort((a, b) => b[1].n - a[1].n);
const missedMails = Object.values(missed).reduce((n, m) => n + m.n, 0);

// Markdown copy for the record and for Claude.
const L = [`# 每週職位報告 ${start} 至 ${today}`, ''];
L.push('## 摘要',
  `- 評分過嘅職位：${jobs.length}（${byTrack(jobs)}）`,
  `- 4 分或以上：${top.length}（${byTrack(top)}）`,
  `- 做咗 CV：${cvs.length}（${byTrack(cvs)}；其中 ${cvTop} 份係 4 分或以上）`,
  `- 已申請：${applied.length}`,
  `- 可能遺漏嘅 email 來源：${ms.length}（${missedMails} 封）`, '');
L.push('## 已申請');
if (!applied.length) L.push('- 本週冇紀錄。用網站或者 email 申請咗，記得話我知或者喺 tracker 標 applied。');
for (const a of applied) L.push(`- ${a.date ? a.date + ' ' : ''}${a.company}｜${a.role || ''}｜${a.how}`);
L.push('', '## 做咗 CV');
if (!cvs.length) L.push('- 本週冇。');
for (const c of cvs) L.push(`- ${c.date} [${c.track}] ${c.score !== null ? c.score + '分' : '未評分'} ${c.company}｜${c.role} → ${isApplied(c.company, c.role) ? '✅ 已申請' : '⏳ 未申請'}`);
L.push('', '## 高分職位（4 分或以上）');
if (!top.length) L.push('- 冇。');
for (const j of top.slice(0, 20)) L.push(`- ${j.score}分 [${j.track}] ${j.title} @ ${j.company}${j.pay ? '｜' + j.pay : ''} → ${status(j.company, j.title, hasCv(j))}\n  ${j.url || ''}`);
L.push('', '## 3–3.5 分（可以考慮）');
for (const j of mid.slice(0, 15)) L.push(`- ${j.score}分 [${j.track}] ${j.title} @ ${j.company}\n  ${j.url || ''}`);
if (mid.length > 15) L.push(`- 仲有 ${mid.length - 15} 份，睇每日報告。`);
if (!mid.length) L.push('- 冇。');
L.push('', '## 可能遺漏');
if (!ms.length) L.push('- 冇：所有職位 email 都讀過。');
else L.push('以下來源嘅 email WF1 冇讀（未加入 WF1 嘅寄件人）。原文已經放入 inbox，星期一嘅 scrape 會抽取職位同評分：');
for (const [addr, m] of ms.slice(0, 15)) L.push(`- ${addr}：${m.n} 封，例如「${m.subject.slice(0, 70)}」`);
if (skipped.length) {
  L.push('', `職位篩選刪咗 ${skipped.length} 份（職銜唔啱）。如果有應該留低嘅，話我知改篩選：`);
  for (const s of skipped.slice(0, 12)) L.push(`- ${s.title}${s.company ? ' @ ' + s.company : ''}`);
}
L.push('', '## 下星期要跟進');
if (!stale.length && !todo.length) L.push('- 冇。');
for (const c of stale) L.push(`- ${c.company}｜${c.role}：CV ${daysSince(c.date)} 日前做好，未申請。決定申請定放棄。`);
for (const j of todo.slice(0, 8)) L.push(`- ${j.title} @ ${j.company}（${j.score}分）：未做 CV。`);
const report = L.join('\n') + '\n';

// HTML report with tables: saved next to the markdown and sent to Telegram as a file.
const esc = s => String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const link = (url, text) => /^https?:\/\//.test(url || '') ? `<a href="${esc(url)}">${esc(text)}</a>` : esc(text);
// On a phone, list tables turn into one card per row (labels come from data-label); the overview stays a grid.
const table = (head, rows, cls = 'list') => rows.length
  ? `<table class="${cls}"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td data-label="${head[i]}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  : '<p class="none">冇。</p>';
const sc = n => n === null || n === undefined ? '<span class="dim">–</span>' : `<b class="s${n >= 4 ? 'hi' : n >= 3 ? 'mid' : 'lo'}">${n}</b>`;
const H = [];
H.push(`<h1>每週職位報告</h1><p class="dim">${start} 至 ${today}</p>`);
H.push('<h2>總覽</h2>', table(['', '評分', '4 分+', 'CV', 'CV 已申請'], [
  ...TRACKS.map(t => [TN[t], jobs.filter(j => j.track === t).length, top.filter(j => j.track === t).length, cvs.filter(c => c.track === t).length, cvs.filter(c => c.track === t && isApplied(c.company, c.role)).length]),
  ['<b>合計</b>', `<b>${jobs.length}</b>`, `<b>${top.length}</b>`, `<b>${cvs.length}</b>`, `<b>${cvs.filter(c => isApplied(c.company, c.role)).length}</b>`]], 'grid'));
H.push(`<p>已申請（所有來源）：<b>${applied.length}</b>　可能遺漏 email：<b>${missedMails}</b>　篩選刪咗：<b>${skipped.length}</b></p>`);
H.push(`<h2>🔥 4 分或以上（${top.length}）</h2>`, table(['分', '線', '職位', '公司', '薪酬', '狀態'],
  top.map(j => [sc(j.score), TN[j.track] || j.track, link(j.url, j.title) + (NEEDS_JD.test(j.url || '') && !hasCv(j) ? ' <span class="dim">📋 要貼 JD</span>' : ''), esc(j.company), esc(j.pay || ''), status(j.company, j.title, hasCv(j))])));
H.push(`<h2>📝 做咗 CV（${cvs.length}）</h2>`, table(['日期', '線', '分', '公司', '職位', '狀態'],
  cvs.slice().sort((a, b) => (b.score || 0) - (a.score || 0)).map(c => [esc(c.date.slice(5)), TN[c.track] || esc(c.track), sc(c.score), esc(c.company), link(c.url, c.role), isApplied(c.company, c.role) ? '✅ 已申請' : '⏳ 未申請'])));
H.push(`<h2>✅ 已申請（${applied.length}）</h2>`, table(['日期', '公司', '職位', '途徑'], applied.map(a => [esc(a.date), esc(a.company), esc(a.role), esc(a.how)])));
H.push(`<h2>3–3.5 分（${mid.length}）</h2>`, table(['分', '線', '職位', '公司'], mid.slice(0, 25).map(j => [sc(j.score), TN[j.track] || j.track, link(j.url, j.title), esc(j.company)])));
H.push('<h2>📌 下星期要跟進</h2>', !stale.length && !todo.length ? '<p class="none">冇。</p>' : '<ul>'
  + stale.map(c => `<li>${esc(c.company)}｜${esc(c.role)}：CV ${daysSince(c.date)} 日前做好，未申請</li>`).join('')
  + todo.map(j => `<li>${link(j.url, j.title)} @ ${esc(j.company)}（${j.score} 分）：未做 CV${NEEDS_JD.test(j.url || '') ? '，要貼 JD' : ''}</li>`).join('') + '</ul>');
H.push('<h2>📬 可能遺漏</h2>', ms.length ? '<ul>' + ms.slice(0, 15).map(([a, m]) => `<li>${esc(a)}：${m.n} 封</li>`).join('') + '</ul>' : '<p class="none">冇：所有職位 email 都讀過。</p>');
if (skipped.length) H.push(`<details><summary>篩選刪咗 ${skipped.length} 份</summary><ul>${skipped.slice(0, 40).map(s => `<li>${esc(s.title)}${s.company ? ' @ ' + esc(s.company) : ''}</li>`).join('')}</ul></details>`);
const CSS = ':root{--bg:#fff;--fg:#1d1d1f;--dim:#6e6e73;--line:#e5e5ea;--head:#f5f5f7;--hi:#1a7f37;--mid:#9a6700;--lo:#cf222e;--a:#0969da}'
  + '@media (prefers-color-scheme:dark){:root{--bg:#1c1c1e;--fg:#f2f2f7;--dim:#98989f;--line:#38383a;--head:#2c2c2e;--hi:#3fb950;--mid:#d29922;--lo:#f85149;--a:#4493f8}}'
  + 'body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:15px/1.45 -apple-system,"PingFang HK","Noto Sans TC",sans-serif}'
  + 'h1{font-size:22px;margin:0}h2{font-size:17px;margin:24px 0 8px}.dim{color:var(--dim)}.none{color:var(--dim)}a{color:var(--a);text-decoration:none}'
  + 'table{width:100%;border-collapse:collapse;font-size:14px;display:block;overflow-x:auto}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}'
  + 'th{background:var(--head);font-weight:600;white-space:nowrap}.shi{color:var(--hi)}.smid{color:var(--mid)}.slo{color:var(--lo)}ul{padding-left:20px}summary{cursor:pointer;color:var(--dim)}'
  + '@media (max-width:640px){table.list,table.list tbody,table.list tr,table.list td{display:block}table.list thead{display:none}'
  + 'table.list tr{border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin-bottom:8px}table.list td{border:0;padding:2px 0}'
  + 'table.list td::before{content:attr(data-label) "　";color:var(--dim);font-size:12px}table.list td:empty{display:none}'
  + 'table.list td:nth-child(-n+2){display:inline-block;margin-right:12px;font-weight:600}table.list td:nth-child(-n+2)::before{content:none}}';
const html = `<!doctype html><html lang="zh-HK"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>每週職位報告 ${today}</title><style>${CSS}</style></head><body>${H.join('\n')}</body></html>\n`;
const htmlName = `weekly-${today}.html`;
const htmlBinary = { data: { data: Buffer.from(html, 'utf8').toString('base64'), mimeType: 'text/html', fileName: htmlName } };

// Telegram: a short summary card (HTML formatting), then the table report as a file.
const short = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const T = [`📊 <b>每週職位報告</b>｜${start.slice(5)} 至 ${today.slice(5)}`, '',
  `<b>評分</b> ${jobs.length}（${esc(byTrack(jobs))}）`,
  `<b>4 分+</b> ${top.length}（${esc(byTrack(top))}）`,
  `<b>CV</b> ${cvs.length}（其中 ${cvTop} 份 4 分+）`,
  `<b>已申請</b> ${applied.length}`];
const section = (title, items, max) => {
  if (!items.length) return;
  T.push('', title);
  for (const x of items.slice(0, max)) T.push(x);
  if (items.length > max) T.push(`…仲有 ${items.length - max} 份，睇附件`);
};
section(`🔥 <b>4 分+ 未有 CV（${todo.length}）</b>`, todo.map(j => `${j.score}分 ${TN[j.track]}｜${link(j.url, short(j.title, 48))} · ${esc(short(j.company, 30))}${NEEDS_JD.test(j.url || '') ? ' 📋' : ''}`), 10);
section(`⏳ <b>有 CV 未申請（${waiting.length}）</b>`, waiting.map(c => `${c.score !== null ? c.score + '分' : '–'} ${TN[c.track] || esc(c.track)}｜${esc(short(c.company, 30))} · ${esc(short(c.role, 40))}`), 10);
if (ms.length) T.push('', `📬 WF1 漏讀 ${missedMails} 封 email（${ms.length} 個來源），已交畀 scrape`);
if (todo.some(j => NEEDS_JD.test(j.url || ''))) T.push('', '📋 = LinkedIn／Indeed，要貼 JD 先整到 CV');
T.push('', '📎 完整表格報告喺下面嘅附件');
let tgHtml = T.join('\n');
while (tgHtml.length > 4000) { T.splice(T.length - 4, 1); tgHtml = T.join('\n'); }

const out = [fileItem(report, `/shared/weekly/${today}.md`), { json: { kind: 'file', path: `/shared/weekly/${today}.html`, append: false }, binary: htmlBinary }];
for (const t of Object.keys(inbox)) if (inbox[t].length) out.push(fileItem(INBOX_HEAD + inbox[t].join('\n'), `/repos/${t}/inbox/${today}-weekly-emails.md`));
out.push(...labels);
out.push({ json: { kind: 'notify', html: tgHtml, message: '' } });
out.push({ json: { kind: 'doc', caption: `每週職位報告 ${start} 至 ${today}（表格）` }, binary: htmlBinary });
return out;
