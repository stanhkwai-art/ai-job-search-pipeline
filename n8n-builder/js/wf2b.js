const CHAT = 'REPLACE_TELEGRAM_CHAT_ID';
const reports = {};
for (const i of $input.all()) { try { const r = JSON.parse(i.json.text); reports[r.track] = r; } catch (e) { /* missing or unfinished report */ } }
const out = [`職位摘要 ${today}`, '撳 ✍️ 就會幫你整 CV 同 cover letter。'], counts = [], index = {}, rows = [];
// Jobs scoring 4+ get a CV queued without a tap: at most 3 a day (Claude Pro usage), never a job already queued or
// with a CV. LinkedIn and Indeed jobs wait in the queue until the runner finds their JD elsewhere or you paste it.
const AUTO_MAX = 3, NO_FETCH = /linkedin\.com|indeed\./i;
const tryText = n => { try { return textOf(n); } catch (e) { return ''; } };
const queued = tryText('Extract queue').split('\n').map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(q => q && q.type === 'job');
const made = parseCsv(tryText('Extract apply log') || 'id\n').rows;
const low = s => String(s || '').toLowerCase().trim();
const hasCv = j => queued.some(q => q.url && q.url === j.url) || [...queued, ...made].some(q => low(q.company) && low(q.company) === low(j.company) && low(q.title || q.role) === low(j.title));
const auto = [];
for (const t of ['hk', 'uk', 'contract']) {
  const r = reports[t];
  if (!r) { out.push(`\n【${t}】⚠️ 未有今日報告（scrape 未完成或者失敗）`); continue; }
  counts.push(`${today},${t},${r.jobs.length}`);
  out.push(`\n【${t}】新職位 ${r.jobs.length} 個`);
  const row = [];
  [...r.jobs].sort((a, b) => b.score - a.score).slice(0, 5).forEach((j, n) => {
    const key = `${t}${n + 1}`;
    index[key] = { track: t, score: j.score, title: j.title, company: j.company, pay: j.pay || '', ir35: j.ir35 || '', url: j.url };
    row.push({ text: `✍️ ${key}`, callback_data: `a:${today}:${key}` });
    let tag = '';
    if (j.score >= 4 && j.url && !hasCv(j)) {
      // LinkedIn and Indeed jobs are queued too: the runner looks for the same JD on other sites and asks for a paste only if none is found.
      const li = NO_FETCH.test(j.url);
      if (auto.length < AUTO_MAX) { auto.push({ type: 'job', id: `${today.replace(/-/g, '')}-auto${auto.length + 1}`, at: new Date().toISOString(), track: t, title: j.title, company: j.company, url: j.url, score: j.score, jd: '', needs_jd: li, source: 'auto: score 4+' }); tag = li ? '\n🔎 已自動排隊：先喺其他網站搵 JD，搵唔到會叫你貼' : '\n🤖 已自動排隊整 CV'; }
      else if (li) tag = '\n📋 要貼 JD 先整到 CV（撳 ✍️）';
    }
    out.push(`${key}. ${j.score >= 4 ? '🔥 ' : ''}${j.score}分 ${j.title} @ ${j.company}${j.pay ? ' | ' + j.pay : ''}${t === 'contract' && j.ir35 ? ' | IR35 ' + j.ir35 : ''}\n${j.url}${tag}`);
  });
  if (row.length) rows.push(row);
}
const send = { json: { kind: 'send', method: 'sendMessage', body: { chat_id: CHAT, text: out.join('\n').slice(0, 4000), disable_web_page_preview: true } } };
if (rows.length) send.json.body.reply_markup = { inline_keyboard: rows };
return [
  send,
  fileItem(counts.length ? counts.join('\n') + '\n' : '', '/shared/daily-counts.csv', true),
  fileItem(JSON.stringify({ date: today, jobs: index }), `/shared/digest/${today}.json`),
  ...(auto.length ? [fileItem(auto.map(a => JSON.stringify(a)).join('\n') + '\n', '/shared/apply-queue.jsonl', true)] : []),
];
