// Records applications from job-board receipts (JobsDB/SEEK, Indeed, LinkedIn) so nothing has to be logged by hand.
const pick = name => { try { return $(name).all().map(i => i.json); } catch (e) { return []; } };
const mails = [...pick('Gmail receipts'), ...pick('Backfill search')]
  .sort((a, b) => Date.parse(a.date || 0) - Date.parse(b.date || 0));
const apps = parseCsv(textOf('Extract applications'));
const log = parseCsv(textOf('Extract apply log'));
const norm = s => String(s || '').toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9一-鿿]+/g, ' ').trim();
const plain = s => String(s || '').replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const REJECT = /unlikely to progress|unsuccessful|not been successful|not to proceed|decided not to|other candidates|will not be progressing|regret to inform|leider|nicht berücksichtigen/i;
const RANK = { applied: 1, viewed: 2, interview: 3, offer: 4, rejected: 5, 'no response': 0 };
const fromLog = (company, role) => {
  const c = norm(company), r = norm(role);
  return [...log.rows].reverse().find(l => (r && norm(l.role) === r && (!c || norm(l.company) === c)) || (!r && c && norm(l.company) === c)) || {};
};
// Indeed receipts have no company: the same title on the same day counts as the same application.
const findRow = (company, role, e) => apps.rows.find(r => {
  const sameCo = company && norm(r.client) === norm(company), sameRole = role && norm(r.role) === norm(role);
  if (company && role) return (sameCo && (sameRole || !r.role)) || (sameRole && !r.client);
  if (company) return sameCo;
  if (role) return sameRole && !r.client && r.date_applied === e.date;
  return false;
});
function classify(m) {
  const from = String((m.from && (m.from.text || m.from)) || m.sender || '').toLowerCase();
  const subject = String(m.subject || '').trim();
  const body = plain(m.text || m.html || m.snippet || '');
  const date = m.date ? new Date(m.date).toISOString().slice(0, 10) : today;
  let x;
  if (/seek\.com/.test(from)) {
    if ((x = body.match(/your application for (.+?) was successfully submitted to (.+?)(?=\s+seek\b|\s+Hi\b|\.\s|$)/i)))
      return { event: 'applied', role: x[1], company: x[2], source: 'JobsDB', date };
    if ((x = subject.match(/^(.+?) has viewed your application for (.+)$/i)))
      return { event: 'viewed', role: x[2], company: x[1], source: 'JobsDB', date };
    if ((x = subject.match(/^Application update for (.+?) at (.+)$/i)))
      return { event: REJECT.test(body) ? 'rejected' : 'update', role: x[1], company: x[2], source: 'JobsDB', date };
    return null;
  }
  if (/indeedapply@indeed/.test(from) && (x = subject.match(/^Indeed Application:\s*(.+)$/i)))
    return { event: 'applied', role: x[1], company: '', source: 'Indeed', date };
  if (/indeed\.com/.test(from) && (x = subject.match(/^An update on your application from (.+)$/i))) {
    const pos = body.match(/position of (.+?) with /i);
    return { event: REJECT.test(body) ? 'rejected' : 'update', role: pos ? pos[1] : '', company: x[1], source: 'Indeed', date };
  }
  if (/linkedin\.com/.test(from) && (x = subject.match(/your application was sent to (.+)$/i)))
    return { event: 'applied', role: '', company: x[1], source: 'LinkedIn', date };
  return null;
}
const done = { applied: [], viewed: [], rejected: [], update: [] };
let changed = false;
for (const m of mails) {
  const e = classify(m);
  if (!e) continue;
  const l = fromLog(e.company, e.role);
  const company = e.company || l.company || '', role = e.role || l.role || '';
  let row = findRow(company, role, e);
  if (row && company && !row.client) { row.client = safe(company); changed = true; }
  const label = `${role || '（職位未知）'} @ ${company || '（公司未知）'}`;
  if (e.event === 'update') { done.update.push(label); continue; }
  if (!row) {
    row = { date_applied: e.date, track: l.track || (e.source === 'JobsDB' ? 'hk' : /contract/i.test(role) ? 'contract' : 'uk'), client: safe(company), role: safe(role), agency: '', source: e.source, url: l.url || '', status: 'applied', last_update: e.date, notes: '' };
    apps.rows.push(row); changed = true;
    if (e.event === 'applied') { done.applied.push(label); continue; }
  }
  const status = e.event === 'viewed' ? 'applied' : e.event;
  if (e.event === 'viewed' && !/viewed/.test(row.notes || '')) { row.notes = [row.notes, `viewed ${e.date}`].filter(Boolean).join('; '); row.last_update = e.date; changed = true; done.viewed.push(label); }
  if (status !== row.status && (RANK[status] || 0) > (RANK[row.status] || 0)) { row.status = status; row.last_update = e.date; changed = true; if (status === 'rejected') done.rejected.push(label); }
}
const out = [];
if (changed) out.push(fileItem(toCsv(apps), '/shared/applications.csv'));
const msg = [];
if (done.applied.length) msg.push(`📥 已記錄 ${done.applied.length} 個申請：\n` + done.applied.slice(0, 15).join('\n'));
if (done.viewed.length) msg.push('👀 僱主睇咗你嘅申請：\n' + done.viewed.join('\n'));
if (done.rejected.length) msg.push('❌ 唔成功：\n' + done.rejected.join('\n'));
if (done.update.length) msg.push('📬 有更新，要自己睇 email：\n' + done.update.join('\n'));
if (msg.length) out.push({ json: { kind: 'notify', message: msg.join('\n\n').slice(0, 4000) } });
return out;
