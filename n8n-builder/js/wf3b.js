const CATS = ['interview_invite', 'rejection', 'recruiter_outreach', 'right_to_represent_request', 'cv_or_rate_update_request', 'other'];
const LABEL = { interview_invite: '📅 面試邀請', rejection: '拒絕', recruiter_outreach: 'Recruiter 主動接觸', right_to_represent_request: '✍️ Right to represent', cv_or_rate_update_request: '要求更新 CV／日薪', other: '其他' };
const REPLY = {
  interview_invite: 'Thank you, I would be glad to interview. [填可面試時間]\n\nREPLACE_YOUR_NAME',
  right_to_represent_request: 'Thank you. Before I confirm right to represent, please could you send the client name, role, day rate and IR35 status.\n\nREPLACE_YOUR_NAME',
  cv_or_rate_update_request: 'Thank you. [附 CV／填日薪] \n\nREPLACE_YOUR_NAME',
  recruiter_outreach: 'Thank you for getting in touch. Please could you send the client, location, rate and IR35 status.\n\nREPLACE_YOUR_NAME',
};
function parseResult(res) {
  try {
    if (!res || res.stop_reason === 'refusal') throw new Error('refusal');
    const r = JSON.parse(res.content.find(b => b.type === 'text').text);
    if (!CATS.includes(r.category)) throw new Error('bad category');
    return r;
  } catch (e) { return { category: 'other', needs_reply: false, client: '', role: '', agency: '', failed: res && res.stop_reason !== 'refusal' || !res }; }
}
const norm = s => String(s || '').toLowerCase().trim();
const apps = parseCsv(textOf('Extract applications'));
const agencies = parseCsv(textOf('Extract agencies'));
const reqs = $('Build requests').all().map(i => i.json);
const results = $input.all().map(i => i.json);
const out = [], digest = []; let appsChanged = false, agenciesChanged = false;
reqs.forEach((m, n) => {
  const r = parseResult(results[n]);
  if (r.failed) { out.push({ json: { kind: 'notify', message: `⚠️ WF3 分類失敗，要自己睇：\n${m.fromText}\n${m.subject}` } }); return; }
  if (r.category === 'other') return;
  const client = safe(r.client), role = safe(r.role), agency = safe(r.agency);
  const hits = apps.rows.filter(a => client && norm(a.client) === norm(client) && (!role || norm(a.role) === norm(role)));
  let note = '';
  const status = { interview_invite: 'interview', rejection: 'rejected' }[r.category];
  if (status && hits.length === 1) { hits[0].status = status; hits[0].last_update = today; appsChanged = true; }
  else if (hits.length === 1) { hits[0].last_update = today; appsChanged = true; }
  else if (status) note = `\n⚠️ 對唔到 applications.csv 一行（${hits.length} 個結果），要手動更新`;
  if (r.category === 'recruiter_outreach' && agency && !agencies.rows.some(a => norm(a.agency) === norm(agency))) {
    agencies.rows.push({ agency, consultant_email: safe(m.from), cadence_days: '30', status: 'new contact', notes: `auto-added ${today}` });
    agenciesChanged = true;
  }
  if (r.category === 'right_to_represent_request') {
    const others = apps.rows.filter(a => client && norm(a.client) === norm(client) && (!role || norm(a.role) === norm(role)) && a.agency && norm(a.agency) !== norm(agency));
    if (others.length) note += `\n🔴 已經經 ${others.map(a => a.agency).join('、')} 遞交過 ${client}，唔好再 confirm`;
  }
  const line = `${LABEL[r.category]}\n${m.fromText}\n${m.subject}${note}`;
  if (['interview_invite', 'right_to_represent_request'].includes(r.category)) out.push({ json: { kind: 'notify', message: line } });
  else digest.push(`${today},"${line.replace(/\n/g, ' | ').replace(/"/g, '""')}"`);
  if (r.needs_reply && REPLY[r.category]) out.push({ json: { kind: 'draft', to: m.from, subject: 'Re: ' + m.subject, message: REPLY[r.category], threadId: m.threadId } });
});
if (appsChanged) out.push(fileItem(toCsv(apps), '/shared/applications.csv'));
if (agenciesChanged) out.push(fileItem(toCsv(agencies), '/shared/agencies.csv'));
if (digest.length) out.push(fileItem(digest.join('\n') + '\n', '/shared/wf3-digest.csv', true));
return out;
