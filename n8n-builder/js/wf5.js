const ag = parseCsv(textOf('Extract agencies'));
const sent = $input.all().map(i => i.json).filter(m => m.id);
const out = [], noEmail = []; let changed = false;
for (const a of ag.rows) {
  const email = (a.consultant_email || '').toLowerCase();
  if (a.draft_created && email) {
    const done = sent.some(m => String(m.To || m.to || '').toLowerCase().includes(email) && Number(m.internalDate || 0) >= Date.parse(a.draft_created));
    if (done) {
      a.last_contact = today; a.next_contact = addDays(today, Number(a.cadence_days) || 30); a.draft_created = ''; changed = true;
    }
    continue;
  }
  if (a.status === 'dropped' || (a.next_contact && a.next_contact > today)) continue;
  if (!email) { noEmail.push(a.agency); continue; }
  a.draft_created = today; changed = true;
  out.push({ json: { kind: 'draft', to: email, subject: 'Availability update: contractor',
    message: `Hi ${a.consultant_name || ''},\n\nA quick update on my availability for contract work.\n\nAvailability: [填可開工日期]\nDay rate: [填日薪] (part-time or full-time)\nRecent work: [填最近項目]\n\nLatest CV attached. [附 contract 版 CV]\n\nBest,\nREPLACE_YOUR_NAME` } });
  out.push({ json: { kind: 'notify', message: `${a.agency}：check-in 草稿已建立，喺 iPhone 檢查、加 CV 再發` } });
}
if (noEmail.length && new Date(today).getDay() === 1) out.push({ json: { kind: 'notify', message: `要 check-in，但 agencies.csv 未有 consultant email：\n${noEmail.join('\n')}` } });
if (today.endsWith('-01')) {
  const quiet = ag.rows.filter(a => daysSince(a.last_contact) >= 90 && a.status !== 'dropped').map(a => a.agency);
  if (quiet.length) out.push({ json: { kind: 'notify', message: `90 日冇互動（保留定剔走？）：\n${quiet.join('\n')}` } });
}
if (changed) out.push(fileItem(toCsv(ag), '/shared/agencies.csv'));
return out;
