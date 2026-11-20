// Pay floors: a job whose alert states pay below its floor is dropped before scoring. 0 turns a floor off.
// Set your own numbers. They live only in n8n and are never written into anything a recruiter sees.
const PAY_FLOOR = { hkLeadMonthly: 0, hkMonthly: 0, contractInsideDay: 0, contractOutsideDay: 0 };
const JOB_LINK = /indeed\.(co\.uk|com)\/(rc\/clk|pagead|viewjob)|adzuna\.co\.uk\/(jobs\/details|details|land\/ad)|totaljobs\.com\/job\/|cv-library\.co\.uk\/job\/|michaelpage\.(com\.hk|co\.uk)\/job-detail|efinancialcareers\.[a-z.]+\/(jobs|job)|reed\.co\.uk\/jobs|cwjobs\.co\.uk\/job|jobserve\.com|linkedin\.com\/(comm\/)?jobs\/view|jobsdb\.com\/.*job|ctgoodjobs\.hk/i;
const strip = s => s.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/<[^>]*$/, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const keyOf = url => { const [base, query = ''] = url.split('?'); const jk = query.match(/(?:^|&)jk=([^&]+)/); return base.toLowerCase() + (jk ? '?jk=' + jk[1] : ''); };
// Alert links carry tracking and one-time login tokens (LinkedIn otpToken); keep only what identifies the job.
// Indeed and SEEK links become plain job pages, which open the job in the phone app.
const cleanUrl = url => {
  const li = url.match(/linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/i);
  if (li) return `https://www.linkedin.com/jobs/view/${li[1]}/`;
  const sk = url.match(/seek\.com(?:\.au)?\/job\/(\d+)/i);
  if (sk) return `https://hk.jobsdb.com/job/${sk[1]}`;
  const [base, query = ''] = url.split('?'); const jk = query.match(/(?:^|&)jk=([^&]+)/);
  const indeed = base.match(/^https?:\/\/([a-z]+\.)?indeed\.(co\.uk|com)/i);
  if (indeed && jk) return `${indeed[0]}/viewjob?jk=${jk[1]}`;
  return base + (jk ? '?jk=' + jk[1] : '');
};
// SEEK recommendation emails list each job as title, company, location and highlights, then a bare link.
function parseSeek(text) {
  const jobs = [], re = /\[?(https?:\/\/[a-z.]*seek\.com(?:\.au)?\/job\/\d+[^\s\]]*)\]?/gi; let m, last = 0;
  while ((m = re.exec(text))) {
    const lines = text.slice(last, m.index).split('\n').map(l => l.trim())
      .filter(l => l && !/^\[?https?:/.test(l));
    last = re.lastIndex;
    const cut = lines.map(l => l.toLowerCase()).lastIndexOf('logo');
    const card = lines.slice(cut + 1).filter(l => !/^recently posted$/i.test(l));
    if (card.length < 2 || card[0].length > 120) continue;
    jobs.push({ url: cleanUrl(m[1]), title: card[0], company: card[1], context: card.slice(1).join(' | ').slice(0, 200) });
  }
  return jobs;
}
function parseAlert(html) {
  const jobs = [], re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi; let m;
  while ((m = re.exec(html))) {
    const raw = m[1].replace(/&amp;/g, '&'), title = strip(m[2]);
    if (!JOB_LINK.test(raw) || /^mailto:/i.test(raw) || title.includes('@') || title.length < 5 || title.length > 120 || /^(view|apply|see|unsubscribe|more jobs)/i.test(title)) continue;
    jobs.push({ url: cleanUrl(raw), title, context: strip(html.slice(re.lastIndex, re.lastIndex + 2000)).slice(0, 200) });
  }
  return jobs;
}
const HK_LEAD = /\b(head|director|chief|cio|cto|ciso|vp|vice president|svp|deputy head|general manager)\b/i;
function hkMonthly(t) {
  const nums = [...t.matchAll(/(?:HK\$|HKD\s?|\$)\s?(\d[\d,]*)(\s?k\b)?/gi)].map(m => Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1)).filter(n => n >= 1000);
  if (!nums.length) return null;
  const top = Math.max(...nums);
  return Math.round(top > 300000 || (/per (year|annum)|a year|annual|p\.a\./i.test(t) && top > 150000) ? top / 12 : top);
}
function route(job) {
  const t = job.title + ' ' + job.context;
  const isHk = /hong kong|\bHK\b|kowloon|HK\$/i.test(t) || /jobsdb|ctgoodjobs/i.test(job.url);
  // LinkedIn cards read "Company · Place". With no place and no UK sign, let both tracks see it; each drops jobs outside its country.
  const noPlace = !/·|&middot;/.test(job.context) && !/united kingdom|\bUK\b|england|scotland|wales|london|£/i.test(t);
  const isContract = /\bcontract(or)?\b|day rate|per day|\/day|\bIR35\b|freelance|\binterim\b/i.test(t);
  const rate = t.match(/£\s?(\d{2,4})(?:\s?-\s?£?\s?(\d{2,4}))?\s*(?:\/|per\s|a\s)\s*(?:day|d\b)/i);
  const top = rate ? Number(rate[2] || rate[1]) : null;
  // HK pay floor by level when the alert states pay (annual figures are divided by 12): leadership titles use
  // PAY_FLOOR.hkLeadMonthly, other roles PAY_FLOOR.hkMonthly.
  if (isHk) { const m = hkMonthly(t), floor = HK_LEAD.test(job.title) ? PAY_FLOOR.hkLeadMonthly : PAY_FLOOR.hkMonthly; return isContract || (m !== null && m < floor) ? null : { track: 'hk', pay: m ? `HK$${m}/月` : '' }; }
  if (!isContract) return { track: noPlace ? 'hk+uk' : 'uk', pay: '' };
  const ir35 = /outside\s+ir35/i.test(t) ? 'Outside' : /inside\s+ir35/i.test(t) ? 'Inside' : '';
  if (top !== null && top < (ir35 === 'Outside' ? PAY_FLOOR.contractOutsideDay : PAY_FLOOR.contractInsideDay)) return null;
  return { track: 'contract', pay: rate ? rate[0] : '需查詢', ir35 };
}
const pick = name => { try { return $(name).all().map(i => i.json); } catch (e) { return []; } };
const mails = [...pick('Gmail job alerts'), ...pick('Backfill search')];
const apps = parseCsv(textOf('Extract applications'));
const seen = parseCsv(textOf('Extract seen'));
const known = new Set([...seen.rows.map(r => r.key), ...apps.rows.map(r => keyOf(r.url))]);
const lines = { hk: [], uk: [], contract: [] }, raw = { hk: [], uk: [], contract: [] }, bad = [], handed = new Set();
for (const mail of mails) {
  const from = (mail.from && mail.from.text) || '';
  // SEEK sends application receipts from the same address; WF10 handles those.
  if (/seek\.com/i.test(from) && !/new jobs|recommend/i.test(mail.subject || '')) continue;
  // jobs-noreply@linkedin.com also sends application receipts; WF10 records those.
  if (/linkedin\.com/i.test(from) && /application (was )?sent|your application/i.test(mail.subject || '')) continue;
  if (/your application|application (was |has been )?(submitted|sent|received)|thank(s| you) for applying/i.test(mail.subject || '')) continue;
  const found = /seek\.com/i.test(from) ? parseSeek(mail.text || '') : parseAlert(mail.html || mail.textAsHtml || '');
  if (!found.length) {
    // A board or format WF1 doesn't know: /scrape reads the email text and scores the jobs in it.
    const body = mailText(mail).slice(0, 12000), key = 'email:' + (mail.id || mail.subject);
    if (body.length < 200) { bad.push(mail.subject || mail.id); continue; }
    if (known.has(key)) continue;
    known.add(key);
    const tracks = mailTracks((mail.subject || '') + ' ' + body);
    for (const tr of tracks) raw[tr].push(mailBlock(mail.subject || '', from, body));
    seen.rows.push({ date: today, key, track: 'email:' + tracks.join('+'), title: safe(mail.subject || ''), company: '', source_email: safe(from) });
    handed.add(((from.match(/<([^>]+)>/) || [])[1] || from).toLowerCase());
    continue;
  }
  for (const job of found) {
    // Indeed sponsored links carry no job id: key them on title and company.
    const key = /indeed\.[a-z.]+\/pagead\//i.test(job.url) && !/[?&]jk=/.test(job.url) ? 'indeed-ad:' + (job.title + '|' + job.context.slice(0, 40)).toLowerCase() : keyOf(job.url), r = route(job);
    if (known.has(key) || !r) continue;
    known.add(key);
    const fit = r.track.split('+').filter(tr => fits(tr, job.title));
    if (!fit.length) { seen.rows.push({ date: today, key, track: 'skip:' + r.track, title: safe(job.title), company: safe(job.company || ''), source_email: safe(from) }); continue; }
    r.track = fit.join('+');
    for (const tr of fit) lines[tr].push(`- [${job.title.replace(/[\[\]]/g, '')}](${job.url}) | ${r.pay || ''} | ${r.ir35 || ''} | ${job.context}`);
    seen.rows.push({ date: today, key, track: r.track, title: safe(job.title), company: safe(job.company || ''), source_email: safe((mail.from && mail.from.text) || '') });
  }
}
const out = [fileItem(toCsv(seen), '/shared/seen-alerts.csv')];
for (const t of Object.keys(lines)) if (lines[t].length) out.push(fileItem(lines[t].join('\n') + '\n', `/repos/${t}/inbox/${today}.md`, true));
for (const t of Object.keys(raw)) if (raw[t].length) out.push(fileItem(INBOX_HEAD + raw[t].join('\n') + '\n', `/repos/${t}/inbox/${today}-emails.md`, true));
if (handed.size) out.push({ json: { kind: 'notify', message: `📨 WF1：${[...handed].join('、')} 嘅 email 格式未識，已經交畀 scrape 讀原文同評分。` } });
if (bad.length) out.push({ json: { kind: 'notify', message: `⚠️ WF1：${bad.length} 封 job alert 抽唔到職位，要睇下個格式：\n` + bad.slice(0, 5).join('\n') } });
return out;
