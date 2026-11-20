const apps = parseCsv(textOf('Extract applications'));
const agencies = parseCsv(textOf('Extract agencies'));
const out = [], quiet = []; let changed = false;
// Job-board applications with no agency have nobody to email, so they only flip to no response.
const board = a => !a.agency && /JobsDB|Indeed|LinkedIn/i.test(a.source || '');
for (const a of apps.rows) {
  if (a.status !== 'applied') continue;
  const age = daysSince(a.last_update);
  if (age >= 21) {
    a.status = 'no response'; changed = true;
    if (board(a)) quiet.push(`${a.client || '?'} / ${a.role}`);
    else out.push({ json: { kind: 'notify', message: `${a.client} / ${a.role}：21 日冇回音，已改 no response` } });
  } else if (age >= 7 && daysSince(a.last_followup) >= 7 && !board(a)) {
    a.last_followup = today; changed = true;
    const to = emailOf(agencies, a.agency);
    if (to) out.push({ json: { kind: 'draft', to, subject: `${a.role} at ${a.client}: any update?`, message: `Hi,\n\nI wanted to check whether there is any update on the ${a.role} role at ${a.client}. I remain interested.\n\nThanks,\nREPLACE_YOUR_NAME` } });
    out.push({ json: { kind: 'notify', message: `跟進 ${a.client} / ${a.role}（${age} 日）：${to ? '已建立 Gmail 草稿' : '冇 consultant email，要自己跟'}` } });
  }
}
if (quiet.length) out.push({ json: { kind: 'notify', message: `${quiet.length} 個網上申請 21 日冇回音，已改 no response：\n` + quiet.slice(0, 15).join('\n') } });
if (changed) out.push(fileItem(toCsv(apps), '/shared/applications.csv'));
return out;
