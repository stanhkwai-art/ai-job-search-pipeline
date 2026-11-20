import fs from 'fs'; import assert from 'assert';
// Run `python3 build.py` first. The chat id is a placeholder unless the build filled TELEGRAM_CHAT_ID.
const DIR=new URL('./out/',import.meta.url);
const CH0=process.env.TELEGRAM_CHAT_ID||'123456789';
const WF=Object.fromEntries(fs.readdirSync(DIR).filter(f=>f.endsWith('.json')).map(f=>[f.split('-')[0],JSON.parse(fs.readFileSync(new URL(f,DIR),'utf8').replaceAll('REPLACE_TELEGRAM_CHAT_ID',CH0))]));
// Example pay floors for the tests only (the shipped defaults are 0 = off).
{const n=WF.WF1.nodes.find(x=>x.name==='Parse and route'); const before=n.parameters.jsCode;
 n.parameters.jsCode=before.replace(/const PAY_FLOOR = \{[^}]*\};/,'const PAY_FLOOR = { hkLeadMonthly: 70000, hkMonthly: 50000, contractInsideDay: 275, contractOutsideDay: 400 };');
 if(n.parameters.jsCode===before) throw new Error('PAY_FLOOR not found in WF1');}
const AF=Object.getPrototypeOf(async function(){}).constructor;
const run=async(wf,node,{nodes={},input=[],date='2026-11-02'})=>{
  const n=WF[wf].nodes.find(x=>x.name===node); assert(n,node);
  const $=name=>{const v=nodes[name]; assert(v!==undefined,'missing '+name); const arr=Array.isArray(v)?v:[{json:typeof v==='string'?{text:v}:v}]; return {all:()=>arr,first:()=>arr[0]}};
  const $input={all:()=>input};
  const $now={toFormat:()=>date};
  return new AF('$','$input','$now','Buffer',n.parameters.jsCode)($,$input,$now,Buffer);
};
const dec=i=>Buffer.from(i.binary.data.data,'base64').toString('utf8');
const files=o=>o.filter(i=>i.json.kind==='file');
const kind=(o,k)=>o.filter(i=>i.json.kind===k);
let pass=0; const ok=(c,m)=>{assert(c,m);pass++;};
const APPH='date_applied,track,client,role,agency,source,url,day_rate_or_salary,ir35,right_to_represent_confirmed,status,last_update,last_followup,next_action,notes\n';
const AGH='agency,focus,fit_for_me,evidence_2026,consultant_name,consultant_email,consultant_phone,registered,last_contact,next_contact,cadence_days,draft_created,status,notes\n';

// Graph integrity
for(const [k,w] of Object.entries(WF)){
  const names=w.nodes.map(n=>n.name); ok(new Set(names).size===names.length,k+' unique names');
  for(const [a,c] of Object.entries(w.connections)){ok(names.includes(a),k+' src '+a); for(const l of c.main[0]) ok(names.includes(l.node),k+' dst '+l.node);}
  const targets=new Set(Object.values(w.connections).flatMap(c=>c.main[0].map(l=>l.node)));
  for(const n of w.nodes){ if(!/Trigger$/.test(n.type)) ok(targets.has(n.name),k+' orphan '+n.name);
    for(const m of String(n.parameters.jsCode||'').matchAll(/(?:\$|textOf)\('([^']+)'\)/g)) if(m[1]!=='name') ok(names.includes(m[1]),k+' ref '+m[1]);
    if(n.type.endsWith('.gmail')) ok(['addLabels','create','getAll'].includes(n.parameters.operation),k+' gmail op must never send: '+n.parameters.operation);
    if(n.parameters.jsCode) new AF('$','$input','$now','Buffer',n.parameters.jsCode);
  }
}
// WF1
const a=(u,t,c='')=>`<a href="${u}">${t}</a> <span>${c}</span><br><br>`+'x'.repeat(420);
const mail={id:'m1',subject:'alerts',from:{text:'alert@indeed.com'},html:
 a('https://uk.indeed.com/rc/clk?jk=111&x=1','Senior Network Engineer','Northbank London £90,000 a year')+
 a('https://uk.indeed.com/rc/clk?jk=222','Network Contractor','London Contract £250 per day Inside IR35')+
 a('https://uk.indeed.com/rc/clk?jk=333','Low Latency Network Engineer','Contract £450-£550 per day Outside IR35')+
 a('https://uk.indeed.com/rc/clk?jk=555','Network Security Contractor','Contract £280-£350 per day Outside IR35')+
 a('https://uk.indeed.com/rc/clk?jk=444','Infrastructure Engineer','London contract, rate not given')+
 a('https://www.efinancialcareers.com/jobs-Hong_Kong/x.id1','Head of IT','Hong Kong HK$150k')+
 a('https://www.efinancialcareers.com/jobs-Hong_Kong/x.id2','Network Contract Engineer','Hong Kong 6 month contract')+
 a('https://uk.indeed.com/rc/clk?jk=111&y=2','Senior Network Engineer','dup')+
 a('https://www.linkedin.com/comm/jobs/view/4486071346/?trackingId=x&amp;otpToken=SECRET123','Network Engineer Leeds','<p class="x" style="margin: 0; font-weight: 400">Leeds</p><p style="margin:0; very long unclosed')+
 a('https://uk.indeed.com/unsubscribe','Unsubscribe from alerts')};
let o=await run('WF1','Parse and route',{nodes:{'Gmail job alerts':[{json:mail}],'Extract applications':APPH,'Extract seen':'date,key,track,title,company,source_email\n'}});
const f=p=>dec(files(o).find(i=>i.json.path.includes(p)));
ok(f('/uk/').includes('Senior Network Engineer')&&(f('/uk/').match(/Senior Network Engineer/g).length===1),'perm uk, deduped within run');
ok(f('/hk/').includes('Head of IT')&&!f('/hk/').includes('Network Contract'),'hk perm kept, hk contract dropped');
const con=f('/contract/'); ok(!con.includes('Network Contractor'),'£250 dropped'); ok(con.includes('Low Latency')&&con.includes('Outside'),'Outside £450-550 kept with IR35'); ok(con.includes('需查詢'),'no rate flagged'); ok(!con.includes('Network Security Contractor'),'Outside £280-350 dropped (outside floor)');
ok(!JSON.stringify(files(o)).includes('SECRET123')&&f('/uk/').includes('https://www.linkedin.com/jobs/view/4486071346/)'),'linkedin url cleaned, otpToken dropped'); ok(!/<|style=/.test(f('/uk/')),'no html in context'); ok(files(o).find(i=>i.json.path.includes('/uk/')).json.append===true,'inbox appends'); ok(files(o).find(i=>i.json.path.includes('seen')).json.append===false,'seen rewrites');
const seen=dec(files(o).find(i=>i.json.path.includes('seen')));
o=await run('WF1','Parse and route',{nodes:{'Gmail job alerts':[{json:mail}],'Extract applications':APPH,'Extract seen':seen}});
ok(files(o).length===1,'second run adds nothing');
o=await run('WF1','Parse and route',{nodes:{'Gmail job alerts':[{json:{id:'x',subject:'odd format',html:'<p>none</p>'}}],'Extract applications':APPH,'Extract seen':'date,key,track,title,company,source_email\n'}});
ok(kind(o,'notify')[0].json.message.includes('odd format'),'unparsed email alerts');
// WF1 LinkedIn: alert card with tracking token, place-less card, receipts, backfill branch
{ const hero=a('https://www.linkedin.com/comm/jobs/view/4431593003/?trackingId=x&amp;otpToken=T0K3N','Network Operation Centre Engineer - Officer (Shift Rotations)','<p>Example Exchange · Hong Kong</p>');
  const E='date,key,track,title,company,source_email\n';
  let r=await run('WF1','Parse and route',{nodes:{'Backfill search':[{json:{id:'b1',subject:'Exchange NOC',from:{text:'LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>'},html:hero}}],'Extract applications':APPH,'Extract seen':E}});
  const hk=dec(files(r).find(i=>i.json.path.includes('/hk/'))||{binary:{data:{data:''}}});
  ok(dec(files(r).find(i=>i.json.path.includes('seen'))).includes('jobs/view/4431593003/,skip:hk,'),'backfill: exchange NOC alert routed to hk (then gated out as junior)'); ok(!files(r).some(i=>i.json.path.includes('/uk/')),'backfill: nothing to uk');
  ok(!JSON.stringify(r).includes('otpToken'),'backfill: otpToken dropped');
  r=await run('WF1','Parse and route',{nodes:{'Gmail job alerts':[{json:{id:'n1',subject:'x is hiring',from:{text:'LinkedIn <jobs-noreply@linkedin.com>'},html:a('https://www.linkedin.com/comm/jobs/view/999/?otpToken=S','Infrastructure Manager','')}}],'Extract applications':APPH,'Extract seen':E}});
  ok(files(r).some(i=>i.json.path.includes('/hk/'))&&files(r).some(i=>i.json.path.includes('/uk/')),'no place → both hk and uk');
  ok(dec(files(r).find(i=>i.json.path.includes('seen'))).includes(',hk+uk,'),'seen marks both tracks');
  r=await run('WF1','Parse and route',{nodes:{'Gmail job alerts':[{json:{id:'n2',subject:'Your application was sent to Acme',from:{text:'LinkedIn <jobs-noreply@linkedin.com>'},html:a('https://www.linkedin.com/jobs/view/998/','Network Engineer','Acme · London')}}],'Extract applications':APPH,'Extract seen':E}});
  ok(files(r).length===1&&kind(r,'notify').length===0,'linkedin application receipt ignored');
  r=await run('WF1','Parse and route',{nodes:{'Gmail job alerts':[{json:{id:'j1',subject:'JobServe',from:{text:'JobServe <x@jobserve.com>'},html:a('https://www.jobserve.com/gb/en/W1.jsap','Network Engineer','London £500 per day Outside IR35')+a('mailto:Someone.X@apps.jobserve.com','Someone.X@apps.jobserve.com','')+a('https://www.jobserve.com/jslinks.aspx','More jobs like this','')}}],'Extract applications':APPH,'Extract seen':E}});
  const all=files(r).filter(i=>i.json.path.includes('/inbox/')).map(dec).join('');
  ok(all.includes('Network Engineer')&&!all.includes('@apps.jobserve')&&!all.includes('More jobs like this'),'jobserve mailto and more-jobs links skipped');
  r=await run('WF1','Parse and route',{nodes:{'Gmail job alerts':[{json:{id:'f1',subject:'alerts',from:{text:'LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>'},html:
    a('https://www.linkedin.com/jobs/view/701/','Deputy Director, Infrastructure','Harbour Properties · Hong Kong')+a('https://www.linkedin.com/jobs/view/702/','2027 Fresh Grad Hire - Security Compliance Engineer','Brightfin · Hong Kong')+
    a('https://www.linkedin.com/jobs/view/703/','Linux Low Latency Systems Engineer','Quantix · Hong Kong')+a('https://www.linkedin.com/jobs/view/704/','Senior IT Technician','City Health Trust · Sheffield')+a('https://www.linkedin.com/jobs/view/705/','Senior Network Engineer','Northbank · London')}}],'Extract applications':APPH,'Extract seen':E}});
  const hkF=dec(files(r).find(i=>i.json.path.includes('/hk/'))), ukF=dec(files(r).find(i=>i.json.path.includes('/uk/'))), sn=dec(files(r).find(i=>i.json.path.includes('seen')));
  ok(hkF.includes('Deputy Director')&&hkF.includes('Low Latency')&&!hkF.includes('Fresh Grad'),'hk title gate keeps leadership and low latency, drops graduate');
  ok(ukF.includes('Senior Network Engineer')&&!ukF.includes('Technician'),'uk title gate keeps network, drops technician');
  ok(sn.includes(',skip:hk,')&&sn.includes(',skip:uk,'),'skipped jobs recorded in seen');
  r=await run('WF1','Parse and route',{nodes:{'Gmail job alerts':[{json:{id:'c1',subject:'JobServe',from:{text:'JobServe <x@jobserve.com>'},html:
    a('https://www.jobserve.com/gb/en/C1.jsap','AI Engineer - LLM & Agentic Systems','London £675 per day Outside IR35')+a('https://www.jobserve.com/gb/en/C2.jsap','M365 Messaging & Collaboration Architect','London £600 per day Inside IR35')+
    a('https://www.jobserve.com/gb/en/C3.jsap','AI and Automation Engineer','Belfast contract £450 per day Inside IR35')+a('https://www.jobserve.com/gb/en/C4.jsap','M365 Support Analyst','Leeds contract £350 per day Inside IR35')+
    a('https://www.jobserve.com/gb/en/C5.jsap','Test Automation Engineer','London contract £400 per day Inside IR35')}}],'Extract applications':APPH,'Extract seen':E}});
  const cF=dec(files(r).find(i=>i.json.path.includes('/contract/'))||{json:{data:''}});
  ok(cF.includes('AI Engineer')&&cF.includes('M365 Messaging')&&cF.includes('AI and Automation'),'contract title gate keeps AI and M365 roles');
  ok(!cF.includes('Support Analyst')&&!cF.includes('Test Automation'),'contract title gate still drops support and test automation'); }
// WF2
o=await run('WF2','Summarise',{input:[{json:{text:JSON.stringify({track:'hk',jobs:[{score:3,title:'A',company:'X',url:'u'},{score:5,title:'B',company:'Y',url:'v'}]})}},{json:{text:JSON.stringify({track:'contract',jobs:[{score:4,title:'C',company:'Z',pay:'£500/day',ir35:'Outside',url:'w'}]})}},{json:{}}]});
const sent=kind(o,'send')[0].json, msg=sent.body.text; ok(msg.indexOf('B @ Y')<msg.indexOf('A @ X'),'sorted'); ok(msg.includes('🔥 5分'),'fire'); ok(!msg.includes('🔥 3分'),'no fire on 3'); ok(msg.includes('【uk】⚠️'),'missing track flagged'); ok(msg.includes('IR35 Outside'),'ir35');
ok(dec(files(o).find(i=>i.json.path.includes('daily-counts'))).split('\n').filter(Boolean).length===2,'counts appended');
ok(sent.method==='sendMessage'&&sent.body.chat_id===CH0,'digest goes to your chat only');
ok(JSON.stringify(sent.body.reply_markup.inline_keyboard[0][0])==='{"text":"✍️ hk1","callback_data":"a:2026-11-02:hk1"}','apply button per job');
const dig=JSON.parse(dec(files(o).find(i=>i.json.path==='/shared/digest/2026-11-02.json'))); ok(dig.jobs.hk1.title==='B'&&dig.jobs.hk2.title==='A'&&dig.jobs.contract1.ir35==='Outside','digest index matches numbering');
ok(msg.includes('hk1. 🔥 5分 B'),'numbered in message');
const DIGEST=JSON.stringify(dig);
// WF3
const mm=(i,s)=>({json:{id:'i'+i,threadId:'t'+i,from:'jo@agency.com',fromText:'Jo <jo@agency.com>',subject:s}});
const res=(r)=>({json:{stop_reason:'end_turn',content:[{type:'thinking',thinking:''},{type:'text',text:JSON.stringify(r)}]}});
const apps=APPH+'2026-10-01,uk,Alpha Capital,Network Engineer,Agency One,,,,,,applied,2026-10-01,,,\n2026-10-02,uk,Alpha Capital,Network Engineer,Agency Two,,,,,,applied,2026-10-02,,,\n2026-10-03,uk,Beta Trading,SRE,Agency Three,,,,,,applied,2026-10-03,,,\n';
const reqs=[mm(1,'Interview at Beta Trading'),mm(2,'RTR Alpha Capital'),mm(3,'Great role'),mm(4,'Rejected'),mm(5,'Broken'),mm(6,'Newsletter')];
const r3=[res({category:'interview_invite',needs_reply:true,client:'Beta Trading',role:'SRE',agency:'Agency Three'}),
 res({category:'right_to_represent_request',needs_reply:true,client:'Alpha Capital',role:'Network Engineer',agency:'Other Agency'}),
 res({category:'recruiter_outreach',needs_reply:false,client:'',role:'',agency:'=HYPERLINK("x")'}),
 res({category:'rejection',needs_reply:false,client:'Nobody',role:'',agency:''}),
 {json:{error:{message:'401'}}},
 res({category:'other',needs_reply:false,client:'',role:'',agency:''})];
o=await run('WF3','Apply results',{nodes:{'Extract applications':apps,'Extract agencies':AGH,'Build requests':reqs},input:r3});
const nts=kind(o,'notify').map(i=>i.json.message).join('\n---\n');
ok(dec(files(o).find(i=>i.json.path.endsWith('applications.csv'))).includes('Beta Trading,SRE,Agency Three,,,,,,interview,2026-11-02'),'interview updates row');
ok(nts.includes('🔴')&&nts.includes('Agency One'),'RTR conflict red'); ok(nts.includes('分類失敗')&&nts.includes('Broken'),'API failure surfaces');
ok(dec(files(o).find(i=>i.json.path.endsWith('agencies.csv'))).includes("'=HYPERLINK"),'formula neutralised');
const dg=dec(files(o).find(i=>i.json.path.includes('digest'))); ok(dg.includes('對唔到'),'unmatched rejection noted'); ok(!nts.includes('Newsletter')&&!dg.includes('Newsletter'),'other ignored');
ok(kind(o,'draft').length===2&&kind(o,'draft')[0].json.threadId==='t1','drafts in thread, nothing sent');
o=await run('WF3','Build digest',{nodes:{'Extract digest':'date,line\n'+dg}}); ok(o[0].json.message.includes('對唔到')&&dec(o[0])==='date,line\n','digest reads and clears');
o=await run('WF3','Build digest',{nodes:{'Extract digest':'date,line\n'}}); ok(o.length===0,'empty digest silent');
const body=JSON.parse((await run('WF3','Build requests',{nodes:{'Gmail replies':[{json:{id:1,text:'hi',subject:'s',from:{text:'a'}}}]}}))[0].json.requestBody);
ok(body.model==='claude-opus-5-5'&&body.output_config.format.type==='json_schema'&&!('temperature' in body),'request shape');
// WF4
const a4=APPH+'2026-10-20,uk,Alpha Capital,NE,Agency One,,,,,,applied,2026-10-22,,,\n2026-10-01,uk,Beta Trading,SRE,,,,,,,applied,2026-10-05,,,\n2026-10-28,uk,Gamma Markets,NE,,,,,,,applied,2026-10-30,,,\n';
const g4=AGH+'Agency One,,,,Sam,sam@agency-one.example,,,,,21,,not contacted,\n';
o=await run('WF4','Find follow-ups',{nodes:{'Extract applications':a4,'Extract agencies':g4}});
ok(kind(o,'draft').length===1&&kind(o,'draft')[0].json.to==='sam@agency-one.example','7d draft'); const a4b=dec(files(o)[0]); ok(a4b.includes('no response'),'21d flips'); ok(!/Gamma Markets.*2026-11-02/.test(a4b),'young left alone');
o=await run('WF4','Find follow-ups',{date:'2026-11-03',nodes:{'Extract applications':a4b,'Extract agencies':g4}}); ok(kind(o,'draft').length===0,'no duplicate draft next day');
// WF5 (2026-11-02 is a Monday)
const g5=AGH+'A1,,,,Sam,sam@a.com,,,,,14,,not contacted,\nA2,,,,,,,,,,21,,not contacted,\nA3,,,,,,,,,,21,,not contacted,\nA4,,,,Lee,lee@d.com,,,,2027-01-01,30,,active,\n';
o=await run('WF5','Plan check-ins',{nodes:{'Extract agencies':g5},input:[{json:{}}]});
ok(kind(o,'draft').length===1,'only due with email'); ok(kind(o,'notify').filter(i=>i.json.message.includes('A2')&&i.json.message.includes('A3')).length===1,'one combined no-email notice');
const g5b=dec(files(o)[0]); ok(!/300|£200/.test(kind(o,'draft')[0].json.message),'rate floor not disclosed'); ok(kind(o,'draft')[0].json.message.includes('part-time or full-time')&&!/£800/.test(kind(o,'draft')[0].json.message),'one rate for part-time and full-time in draft');
o=await run('WF5','Plan check-ins',{date:'2026-11-03',nodes:{'Extract agencies':g5b},input:[{json:{}}]}); ok(kind(o,'draft').length===0,'no duplicate draft before send'); ok(kind(o,'notify').length===0,'no-email notice Mondays only');
o=await run('WF5','Plan check-ins',{date:'2026-11-03',nodes:{'Extract agencies':g5b},input:[{json:{id:'1',To:'Sam <sam@a.com>',internalDate:String(Date.parse('2026-11-03T08:00:00Z'))}}]});
const g5c=dec(files(o)[0]); ok(/A1,.*2026-11-03,2026-11-17,14,,/.test(g5c),'sent detected, next = +cadence');
o=await run('WF5','Plan check-ins',{date:'2026-12-01',nodes:{'Extract agencies':AGH+'Old,,,,X,x@y.com,,,2026-07-01,2027-01-01,30,,active,\n'},input:[{json:{}}]}); ok(kind(o,'notify')[0].json.message.includes('Old'),'monthly 90d');
// WF6 weekly review (Saturday 2026-11-07)
{
const rep=(t,d,jobs)=>({json:{text:JSON.stringify({track:t,date:d,jobs})}});
const o6=await run('WF6','Weekly review',{date:'2026-11-07',nodes:{
 'Extract report':[rep('contract','2026-11-06',[{score:4,title:'Senior Network Engineer',company:'Delta',url:'https://www.reed.co.uk/jobs/1'},{score:3,title:'Network Engineer',company:'Epsilon IT',url:'u2'}]),
   rep('contract','2026-11-07',[{score:4.5,title:'Senior Network Engineer',company:'Delta',url:'https://www.reed.co.uk/jobs/1'},{score:4,title:'Head of Infrastructure',company:'Zeta',url:'u3'}]),
   {json:{error:'ENOENT'}},rep('hk','2026-10-20',[]),rep('contract','2026-11-05',[{score:4,title:'Head of Infrastructure',company:'Zeta Group',url:'u3-dup'}])],
 'Extract apply log':'id,date,track,company,role,url,folder\nx1,2026-11-06,contract,Delta Recruitment (client unnamed),Senior Network Engineer,,f\nx0,2026-10-01,hk,Old Co,Old Role,,f\nx2,2026-11-03,hk,Kappa,Network Engineer,,f\nx3,2026-11-07,contract,Delta Recruitment (client unnamed),Senior Network Engineer,,f\n',
 'Extract applications':APPH+'2026-11-05,contract,Northwind IT Solutions,Senior Network Implementation Engineer,,online,,,,,applied,2026-11-05,,,\n',
 'Extract trackers':[{json:{text:'date,company,sector,role,role_type,channel,status\n2026-11-04,Kappa,x,Network Engineer,perm,online,drafted\n'}}],
 'Extract seen':'date,key,track,title,company,source_email\n2026-11-06,k1,skip:uk,IT Support Analyst,Acme,x\n2026-11-06,k2,uk,Network Engineer,B,x\n',
 'Unread job emails':[{json:{id:'g1',from:{text:'Indeed <donotreply@jobalert.indeed.com>'},subject:'30 new network jobs',text:'Network Engineer\nAcme - Sheffield\n£400 a day contract\nhttps://uk.indeed.com/rc/clk/dl?jk=1'}},{json:{id:'g2',from:{text:'Indeed <donotreply@jobalert.indeed.com>'},subject:'More jobs',text:'IT Manager - London £70,000 a year'}},{json:{id:'g3',from:{text:'Clara <contact@jobijoba.com>'},subject:'3 new job ads',html:'<p>Head of IT</p><p>Hong Kong HK$100,000</p><script>x</script>'}},{json:{id:'g4',from:{text:'Northwind <no-reply@northwind-it.example>'},subject:'Thank you for applying',text:'thanks'}}],
 'Application receipts':[{json:{From:'CV-Library <Admin@notify.cv-library.co.uk>',Subject:'Application confirmation',snippet:'Your application for Electronic Trading Network Engineer has been sent'}}]}});
const r6=dec(files(o6)[0]);
ok(files(o6)[0].json.path==='/shared/weekly/2026-11-07.md','weekly file path');
ok(r6.includes('2026-11-01 至 2026-11-07'),'weekly range');
ok(r6.includes('評分過嘅職位：3'),'weekly dedupes scored jobs by url: '+r6);
ok(r6.includes('4.5分 [contract] Senior Network Engineer @ Delta')&&r6.includes('📝 有 CV'),'weekly keeps best score and marks CV');
ok(r6.includes('Head of Infrastructure @ Zeta')&&r6.includes('❗ 未做 CV'),'weekly flags high score without CV');
ok(r6.includes('做咗 CV：2')&&!r6.includes('Old Co'),'weekly CVs only this week');
ok(r6.includes('Northwind IT Solutions')&&r6.includes('CV-Library'),'weekly applied from csv and receipts');
{const o=await run('WF6','Weekly review',{date:'2026-11-08',nodes:{'Extract report':[],'Extract apply log':'id,date,track,company,role,url,folder\n','Extract applications':APPH,'Extract trackers':[],'Extract seen':'date,key,track,title,company,source_email\n','Unread job emails':[],
 'Application receipts':[{json:{From:'no-reply@northwind-it.example',Subject:'Thank you for applying to Northwind',snippet:'Thanks for applying to Northwind IT Solutions. Your application for Senior Network Implementation Engineer, has been received and our team will review it'}},
  {json:{From:'"Careers" <careers@acmebank.com>',Subject:'Your application',snippet:'We have received your application for the Network Architect position.'}}]}});
 const t=dec(files(o)[0]);
 ok(t.includes('Northwind IT Solutions')&&t.includes('Senior Network Implementation Engineer')&&!t.includes('no-reply'),'receipt without display name names company and role: '+t.slice(t.indexOf('申請'),t.indexOf('申請')+300));
 ok(/acmebank/i.test(t)&&t.includes('Network Architect')&&!/Careers ｜|Careers\b.*Network Architect/.test(t),'generic sender name falls back to domain');}
ok(r6.includes('donotreply@jobalert.indeed.com：2 封')&&r6.includes('contact@jobijoba.com：1 封')&&!r6.includes('northwind-it'),'weekly missed senders');
ok(r6.includes('IT Support Analyst'),'weekly lists title-gate drops');
ok(r6.includes('Kappa｜Network Engineer：CV 4 日前做好，未申請'),'weekly follow-up for unapplied CV');
ok(!/^-  /m.test(r6),'weekly no blank date prefix');
ok(r6.includes('4 分或以上：2（HK 0、UK 0、Contract 2）'),'weekly 4+ split by track');
ok(/\[contract\] 4\.5分 Delta Recruitment \(client unnamed\)｜Senior Network Engineer/.test(r6),'weekly CV line carries the job score: '+r6);
ok(/其中 1 份係 4 分或以上/.test(r6),'weekly counts CVs for 4+ jobs');
const htm=dec(files(o6).find(f=>f.json.path==='/shared/weekly/2026-11-07.html'));
ok(htm.startsWith('<!doctype html>')&&(htm.match(/<table class=/g)||[]).length>=4&&htm.includes('prefers-color-scheme:dark'),'weekly html report with tables');
ok(htm.includes('<td data-label="">Contract</td><td data-label="評分">3</td><td data-label="4 分+">2</td>')&&htm.includes('table class="grid"')&&htm.includes('max-width:640px'),'weekly html overview row per track, cards on phones');
ok(!htm.includes('<script'),'weekly html has no script');
const n6=kind(o6,'notify'); ok(n6.length===1&&n6[0].json.html.length<=4096,'weekly telegram is one card');
const card=n6[0].json.html;
ok(card.includes('<b>4 分+</b> 2（HK 0、UK 0、Contract 2）')&&card.includes('有 CV 未申請')&&card.includes('4分 Contract｜Head of Infrastructure · Zeta'),'weekly card summary and links: '+card);
ok(!/<(?!\/?(b|a)[ >])/.test(card.replace(/<a href="[^"]*">/g,'<a >')),'weekly card uses only tags Telegram accepts');
const d6=kind(o6,'doc'); ok(d6.length===1&&d6[0].binary.data.mimeType==='text/html'&&d6[0].binary.data.fileName==='weekly-2026-11-07.html','weekly html sent as a file');
const big=await run('WF6','Weekly review',{date:'2026-11-07',nodes:{'Extract report':[rep('uk','2026-11-06',Array.from({length:80},(_,i)=>({score:4,title:'Very long network engineering title number '+i+' '+'x'.repeat(60),company:'Company '+i+' '+'y'.repeat(40),url:'https://www.linkedin.com/jobs/view/'+i+'/'})))],'Extract apply log':'id,date,track,company,role,url,folder\n','Extract applications':APPH,'Extract trackers':[],'Extract seen':'date,key,track,title,company,source_email\n','Unread job emails':[],'Application receipts':[]}});
ok(kind(big,'notify')[0].json.html.length<=4096&&kind(big,'notify')[0].json.html.includes('仲有 70 份')&&kind(big,'notify')[0].json.html.includes('<a href="https://www.linkedin.com/jobs/view/0/">'),'weekly card stays under the Telegram limit');
{const o=await run('WF6','Weekly review',{date:'2026-11-14',nodes:{
 'Extract report':[rep('uk','2026-11-05',[{score:4,title:'Senior Infrastructure Resilience Manager',company:'Contoso',url:'cs1'}]),rep('uk','2026-11-12',[{score:3,title:'Network Engineer',company:'Acme',url:'a1'}])],
 'Extract apply log':'id,date,track,company,role,url,folder\nw1,2026-11-08,uk,Contoso,Senior Infrastructure Resilience Manager,,f\nq1,2026-11-10,contract,"Omega Partnership (public sector client)",Platform Engineer,,f\nq2,2026-11-11,contract,Sigma Technologies,Security Technical Lead,,f\n',
 'Extract queue':'{"type":"job","id":"q1","company":"Omega Partnership","title":"Platform Engineer","score":3.5}\n{"type":"job","id":"q2","company":"Sigma Technologies","title":"Security Technical Lead"}\nnot json\n',
 'Extract applications':APPH,'Extract trackers':[],'Extract seen':'date,key,track,title,company,source_email\n','Unread job emails':[],'Application receipts':[]}});
 const t=dec(files(o)[0]);
 ok(/\[uk\] 4分 Contoso/.test(t),'CV scored in an earlier week keeps its score: '+t);
 ok(/\[contract\] 3\.5分 Omega/.test(t),'CV queued by hand takes the queue score');
 ok(/\[contract\] 未評分 Sigma/.test(t),'CV with no score anywhere stays unscored');
 ok(t.includes('評分過嘅職位：1（'),'earlier reports do not count in the week totals: '+t.slice(0,400));}
const ib=Object.fromEntries(files(o6).filter(f=>f.json.path.includes('/inbox/')).map(f=>[f.json.path,dec(f)]));
ok(Object.keys(ib).sort().join()==='/repos/contract/inbox/2026-11-07-weekly-emails.md,/repos/hk/inbox/2026-11-07-weekly-emails.md,/repos/uk/inbox/2026-11-07-weekly-emails.md','weekly email inbox files: '+Object.keys(ib));
ok(ib['/repos/hk/inbox/2026-11-07-weekly-emails.md'].includes('Head of IT')&&!ib['/repos/hk/inbox/2026-11-07-weekly-emails.md'].includes('<script')&&!ib['/repos/hk/inbox/2026-11-07-weekly-emails.md'].includes('Sheffield'),'weekly hk inbox gets HK email only, html stripped');
ok(ib['/repos/contract/inbox/2026-11-07-weekly-emails.md'].includes('£400 a day')&&!ib['/repos/contract/inbox/2026-11-07-weekly-emails.md'].includes('IT Manager'),'weekly contract inbox gets contract email only');
ok(ib['/repos/uk/inbox/2026-11-07-weekly-emails.md'].includes('不可信'),'weekly inbox carries the untrusted-content note');
ok(ib['/repos/contract/inbox/2026-11-07-weekly-emails.md'].includes('https://uk.indeed.com/viewjob?jk=1'),'weekly shortens Indeed tracking links');
ok(kind(o6,'label').map(i=>i.json.id).join()==='g1,g2,g3','weekly labels handed-over emails, not receipts');
}

// WF1 SEEK recommendations (format copied from a real email, token replaced)
const seekText=`Hi Alex, we've got new job recommendations for you\n\nlogo\n[https://bx-branding-gateway.cloud.seek.com.au/a/serpLogo]\n\nIT Manager (Business Application and Retail Technology)\nExample Retail Co Ltd\n\nWong Chuk Hang, Southern District, HK\n * Minimum 7+ years of relevant experience\n\n[https://au.seek.com/job/95526313?token=1%7ESECRETTOKEN&tracking=PAC-JobRecs-anz-1]\n\nlogo\n[https://bx-branding-gateway.cloud.seek.com.au/b/serpLogo]\n\nSenior AI Project Manager, Digital Transformation, Banking\nExample Job Consulting\n\nTsim Sha Tsui, Yau Tsim Mong District, HK\n$55,000 – $70,000 per month (HKD)\n\nRecently posted\n\n[https://au.seek.com/job/95513001?token=1%7ESECRETTOKEN&tracking=PAC-JobRecs-anz-1]\n\nView more jobs [https://au.seek.com/?tracking=x]\nUnsubscribe\n[https://au.seek.com/settings/notifications/unsubscribe?token=abc]`;
o=await run('WF1','Parse and route',{nodes:{'Gmail job alerts':[{json:{id:'s1',subject:'IT Manager (Business Application and Retail Technology) + 11 new jobs',from:{text:'SEEK Recommendations <noreply@s.seek.com.au>'},text:seekText}},
  {json:{id:'s2',subject:'Your application was successfully submitted',from:{text:'SEEK Applications <noreply@s.seek.com.au>'},text:'[https://au.seek.com/job/1]'}}],'Extract applications':APPH,'Extract seen':'date,key,track,title,company,source_email\n'}});
const hkSeek=dec(files(o).find(i=>i.json.path.includes('/hk/')));
ok(hkSeek.includes('[IT Manager (Business Application and Retail Technology)](https://hk.jobsdb.com/job/95526313)'),'seek job → jobsdb app link: '+hkSeek);
ok(hkSeek.includes('Example Retail Co Ltd')&&hkSeek.includes('$55,000'),'company and pay kept'); ok(hkSeek.split('\n').filter(Boolean).length===2,'two seek jobs');
ok(!JSON.stringify(o).includes('SECRETTOKEN'),'seek token dropped'); ok(kind(o,'notify').length===0,'seek receipt ignored by WF1, no false alarm');
ok(dec(files(o).find(i=>i.json.path.includes('seen'))).includes('Example Retail'),'company saved in seen');
o=await run('WF1','Parse and route',{nodes:{'Gmail job alerts':[{json:mail}],'Extract applications':APPH,'Extract seen':'date,key,track,title,company,source_email\n'}});
ok(dec(files(o).find(i=>i.json.path.includes('/uk/'))).includes('https://uk.indeed.com/viewjob?jk=111'),'indeed link opens job page');
// WF4 job-board rows
o=await run('WF4','Find follow-ups',{nodes:{'Extract applications':APPH+'2026-10-20,hk,A,IT Manager,,JobsDB,,,,,applied,2026-10-25,,,\n2026-10-01,uk,B,NE,,Indeed,,,,,applied,2026-10-01,,,\n2026-10-02,uk,C,SRE,,Indeed,,,,,applied,2026-10-02,,,\n','Extract agencies':AGH}});
ok(kind(o,'draft').length===0&&kind(o,'notify').length===1&&kind(o,'notify')[0].json.message.startsWith('2 個網上申請'),'board rows: no 7d nag, one 21d summary');
// WF8
const upd=(...r)=>({json:{ok:true,result:r.map((x,i)=>({update_id:100+i,...x}))}});
const chat={id:Number(CH0)};
const W8=(updates,queue='',d=DIGEST)=>run('WF8','Handle updates',{nodes:{'Get updates':[updates],'Extract queue':queue},input:[{json:{text:d}}]});
o=await W8(upd({callback_query:{id:'cb1',data:'a:2026-11-02:hk1',message:{chat}}},{message:{chat:{id:999},text:'https://evil.example/job'}}));
let q=dec(files(o).find(i=>i.json.path.endsWith('apply-queue.jsonl'))).trim().split('\n').map(l=>JSON.parse(l));
ok(q.length===1&&q[0].title==='B'&&q[0].track==='hk'&&q[0].url==='v'&&q[0].needs_jd===false,'button queues job');
ok(dec(files(o).find(i=>i.json.path.endsWith('tg-offset.txt')))==='102','offset advances past all updates');
ok(kind(o,'send').some(i=>i.json.method==='answerCallbackQuery'),'button answered'); ok(!JSON.stringify(o).includes('evil.example'),'other chats ignored');
const qline=JSON.stringify(q[0])+'\n';
{const qq=l=>dec(files(l).find(i=>i.json.path.endsWith('apply-queue.jsonl'))||{json:{data:''}}).trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));
 let o2=await W8(upd({message:{chat,text:'急'}}),qline);
 let u=qq(o2); ok(u.length===1&&u[0].type==='urgent'&&u[0].id===q[0].id&&kind(o2,'send').some(i=>/⚡/.test(i.json.body.text||'')),'急 alone marks newest job urgent');
 o2=await W8(upd({message:{chat,text:'急 https://example.com/job/9'}}));
 u=qq(o2); ok(u.length===1&&u[0].urgent===true&&u[0].url==='https://example.com/job/9'&&kind(o2,'send').some(i=>/即刻整/.test(i.json.body.text||'')),'急 + link queues urgent job');
 o2=await W8(upd({message:{chat,text:'https://example.com/job/10'}}));
 ok(!qq(o2)[0].urgent&&kind(o2,'send').some(i=>/今晚會整/.test(i.json.body.text||'')),'normal link waits for the night');
 o2=await W8(upd({message:{chat,text:'急 hk1'}}),'',JSON.stringify({date:'2026-11-02',jobs:{hk1:{track:'hk',score:5,title:'Head of IT',company:'X',url:'https://x.example/1'}}}));
 u=qq(o2); ok(u.length===1&&u[0].urgent===true&&u[0].score===5,'急 + digest key queues it urgent with score');
 o2=await W8(upd({message:{chat,text:'急 https://example.com/job/11'}}),JSON.stringify({type:'job',id:'z1',at:'2026-11-08T00:00:00Z',track:'uk',url:'https://example.com/job/11'})+'\n');
 u=qq(o2); ok(u.length===1&&u[0].type==='urgent'&&u[0].id==='z1','急 on a queued link marks it urgent');
 o2=await W8(upd({message:{chat,text:'急聘網絡工程師 '+'x'.repeat(250)}}));
 ok(!qq(o2)[0].urgent,'急聘 in a JD is not the urgent command');
 ok(qq(await W8(upd({callback_query:{id:'cb9',data:'a:2026-11-02:hk1',message:{chat}}})))[0].score!==undefined,'button carries the score');}
o=await W8(upd({callback_query:{id:'cb2',data:'a:2026-11-02:hk1',message:{chat}}}),qline);
ok(!files(o).some(i=>i.json.path.endsWith('apply-queue.jsonl'))&&kind(o,'send').some(i=>/已經喺隊列/.test(i.json.body.text||'')),'same job not queued twice');
o=await W8(upd({message:{chat,text:'https://www.linkedin.com/jobs/view/123/'}}));
q=dec(files(o).find(i=>i.json.path.endsWith('apply-queue.jsonl'))).trim().split('\n').map(l=>JSON.parse(l));
ok(q[0].needs_jd===true&&q[0].track==='uk','linkedin link waits for pasted JD'); ok(kind(o,'send').some(i=>/搵唔到會再叫你貼 JD/.test(i.json.body.text||'')),'says it searches other sites, then asks for JD');
const fresh=JSON.stringify({...q[0],at:new Date().toISOString()})+'\n';
o=await W8(upd({message:{chat,text:'We are hiring a network engineer with Arista experience...'}}),fresh);
q=dec(files(o).find(i=>i.json.path.endsWith('apply-queue.jsonl'))).trim().split('\n').map(l=>JSON.parse(l));
ok(q.length===1&&q[0].type==='jd'&&q[0].id===JSON.parse(fresh).id,'pasted text joins the waiting request');
o=await W8(upd({message:{chat,text:'contract https://www.jobserve.com/gb/en/J123.jsjob'}}));
ok(dec(files(o).find(i=>i.json.path.endsWith('apply-queue.jsonl'))).includes('"track":"contract"'),'track prefix');
o=await W8(upd({message:{chat,text:'https://hk.jobsdb.com/job/95526313'}}));
ok(dec(files(o).find(i=>i.json.path.endsWith('apply-queue.jsonl'))).includes('"track":"hk"'),'jobsdb guessed hk');
ok(dec(files(o).find(i=>i.json.path.endsWith('apply-queue.jsonl'))).includes('"needs_jd":false'),'jobsdb link queued without waiting (runner reads freehire)');
o=await W8(upd({message:{chat,text:'Head of IT at Example Bank https://hk.jobsdb.com/job/95526399'}}));
ok(dec(files(o).find(i=>i.json.path.endsWith('apply-queue.jsonl'))).includes('"hint":"Head of IT at Example Bank"'),'link text kept as title hint');
{const qd=JSON.stringify({type:'job',id:'x1',at:new Date().toISOString(),url:'https://hk.jobsdb.com/job/77',title:'T'})+'\n';
o=await W8(upd({message:{chat,text:'https://hk.jobsdb.com/job/77'}}),qd); ok(kind(o,'send').some(i=>/已經喺隊列/.test(i.json.body.text||'')),'same link without JD is a duplicate');
o=await W8(upd({message:{chat,text:'https://hk.jobsdb.com/job/77 '+'Responsibilities include leading the network team. '.repeat(6)}}),qd); ok(files(o).some(i=>i.json.path.endsWith('apply-queue.jsonl')&&/"jd":"Resp/.test(dec(i))),'same link with pasted JD queues a new request');}
o=await W8(upd({message:{chat,text:'hi'}})); ok(kind(o,'send')[0].json.body.text.includes('傳職位連結'),'help');
o=await W8({json:{ok:true,result:[]}}); ok(o.length===0,'no updates, no writes');
// WF10 receipts (formats from real emails)
const rc=(from,subject,text,date)=>({json:{from:{text:from},subject,text,date}});
const LOGH='id,date,track,company,role,url,folder\nx1,2026-10-23,uk,Acme Ltd,IT Infrastructure Engineer,https://uk.indeed.com/viewjob?jk=9,f\n';
o=await run('WF10','Record applications',{nodes:{'Backfill search':[
  rc('SEEK Applications <noreply@s.seek.com.au>','Your application was successfully submitted','Hi Alex, your application for IT Manager (2-year renewable contract) was successfully submitted to Example Arts Centre seek Hi Alex, Your application','2026-10-18T10:52:31Z'),
  rc('SEEK Applications <noreply@s.seek.com.au>','Example Arts Centre has viewed your application for IT Manager (2-year renewable contract)','You are getting noticed','2026-10-22T02:49:39Z'),
  rc('SEEK Applications <noreply@s.seek.com.au>','Application update for IT Manager (2-year renewable contract) at Example Arts Centre','it appears your application is unlikely to progress further','2026-10-24T04:26:04Z'),
  rc('Indeed Apply <indeedapply@indeed.com>','Indeed Application: IT Infrastructure Engineer','Your application has been submitted. Good luck!','2026-10-23T07:03:10Z'),
  rc('Indeed Apply <indeedapply@indeed.com>','Indeed Application: Senior Network Engineer','Your application has been submitted.','2026-10-20T08:33:37Z'),
  rc('Lambda Motor Group <noreply@indeed.com>','An update on your application from Lambda Motor Group','Thank you very much for recently applying for the position of IT Infrastructure Engineer with Lambda Motor Group Portsmouth. After careful consideration, the hiring management team decided not to proceed','2026-11-01T13:15:53Z'),
  rc('SEEK Applications <noreply@s.seek.com.au>','Alex, new activity in jobs you applied for','activity','2026-11-03T02:21:00Z'),
],'Extract applications':APPH,'Extract apply log':LOGH}});
let ap=dec(files(o)[0]);
ok(/2026-10-18,hk,Example Arts Centre,IT Manager \(2-year renewable contract\),,JobsDB,,,,,rejected,2026-10-24,,,viewed 2026-10-22/.test(ap),'seek applied → viewed → rejected: '+ap);
ok(ap.includes('uk,Acme Ltd,IT Infrastructure Engineer,,Indeed,https://uk.indeed.com/viewjob?jk=9'),'indeed company filled from apply log');
ok(ap.includes(',Senior Network Engineer,,Indeed,')&&ap.includes('Lambda Motor Group,IT Infrastructure Engineer,,Indeed,,,,,rejected'),'indeed without log kept; rejection recorded');
const n10=kind(o,'notify')[0].json.message; ok(n10.includes('📥 已記錄 3 個申請')&&n10.includes('❌'),'summary: '+n10);
o=await run('WF10','Record applications',{nodes:{'Gmail receipts':[rc('SEEK Applications <noreply@s.seek.com.au>','Your application was successfully submitted','Hi Alex, your application for IT Manager (2-year renewable contract) was successfully submitted to Example Arts Centre seek','2026-10-18T10:52:31Z')],'Extract applications':ap,'Extract apply log':LOGH}});
ok(o.length===0,'same receipt twice changes nothing');
o=await run('WF10','Record applications',{nodes:{'Gmail receipts':[rc('x <noreply@s.seek.com.au>','Your application was successfully submitted','Hi Alex, your application for =cmd|calc was successfully submitted to Evil','2026-11-01T00:00:00Z')],'Extract applications':APPH,'Extract apply log':''}});
ok(dec(files(o)[0]).includes("'=cmd"),'formula neutralised');
// HK title gate and the HK monthly pay floors (test floors: 50k, leadership 70k)
{
const F=(await import('fs')).readFileSync(new URL('./js/fit.js',import.meta.url),'utf8');
const fits=new Function(F+';return fits;')();
for(const t of ['Assistant Manager / Senior Infrastructure Architect (Information Technology)','Senior / Network Engineer, Infrastructure','Cybersecurity Engineer – Global Hedge Fund - Hong Kong role','Systems Analyst (Cybersecurity)','Senior Analyst - Cyber Security Ops','System Engineer','Technical Consultant','Head of IT']) ok(fits('hk',t),'hk keeps '+t);
for(const t of ['IT Support Officer','Network Operation Centre Engineer - Officer - Network & System Operations - IT (Shift Rotations)','Junior Network Engineer','Product Manager (IT)','Java Developer','Desktop Support Technician']) ok(!fits('hk',t),'hk drops '+t);
for(const t of ['IT 部經理','資訊科技經理','資訊科技助理經理','網絡工程師','高級系統工程師','資訊保安經理','資訊科技總監','IT部经理']) ok(fits('hk',t),'hk keeps Chinese '+t);
for(const t of ['SOC Analyst','Linux Systems Administrator','Vulnerability Management Engineer','Network Support Engineer','Wintel Engineer','Identity and Access Management Engineer','NOC Engineer','Network Engineer - Patching and Vulnerability']) ok(fits('contract',t),'contract keeps systems/cyber '+t);
for(const t of ['IT Support Engineer','Service Desk Analyst','Junior Network Engineer','Desktop Support Engineer','Software Developer']) ok(!fits('contract',t),'contract still drops '+t);
ok(!fits('uk','SOC Analyst'),'uk filter unchanged');
for(const t of ['IT 支援主任','會計經理','安全主任','程式開發經理','IT 助理','銷售經理','行政經理','見習網絡工程師']) ok(!fits('hk',t),'hk drops Chinese '+t);
const E='date,key,track,title,company,source_email\n';
const mk=(u,t,c)=>`<a href="${u}">${t}</a> <span>${c}</span><br>`+'x'.repeat(300);
const html=mk('https://hk.jobsdb.com/job/1','Senior Network Engineer','Hong Kong HK$35,000 - HK$45,000 per month')+mk('https://hk.jobsdb.com/job/2','Network Architect','Hong Kong HK$60,000 - HK$80,000 per month')+mk('https://hk.jobsdb.com/job/3','Infrastructure Manager','Hong Kong HK$480000 - HK$720000 per year')+mk('https://hk.jobsdb.com/job/4','Cloud Engineer','Hong Kong HK$18000 - HK$28000 per month(HK$216000 - HK$336000 per year)')+mk('https://hk.jobsdb.com/job/5','Security Architect','Hong Kong')+mk('https://hk.jobsdb.com/job/6','Head of IT','Hong Kong HK$55,000 - HK$65,000 per month')+mk('https://hk.jobsdb.com/job/7','IT Director','Hong Kong HK$90,000 - HK$120,000 per month');
const r=await run('WF1','Parse and route',{nodes:{'Gmail job alerts':[{json:{id:'p1',subject:'jobs',from:{text:'JobsDB <alerts@jobsdb.com>'},html}}],'Extract applications':APPH,'Extract seen':E}});
const hkIn=dec(files(r).find(i=>i.json.path.includes('/hk/inbox/')));
ok(hkIn.includes('Network Architect')&&hkIn.includes('Infrastructure Manager')&&hkIn.includes('Security Architect'),'hk pay floor keeps >= floor and unstated: '+hkIn);
ok(!hkIn.includes('Senior Network Engineer')&&!hkIn.includes('Cloud Engineer'),'hk pay floor drops < floor incl. annual/12');
ok(!hkIn.includes('Head of IT')&&hkIn.includes('IT Director'),'hk leadership floor applies to leadership titles');
}
// WF1: unknown board formats go to scrape as text, daily
{
const E='date,key,track,title,company,source_email\n';
const body='Senior Network Engineer\nAcme Ltd - London\n£600 per day Outside IR35 contract\nhttps://jobs.example.com/apply?id=1&tracking='+'z'.repeat(200)+'\n'+'More text about the role. '.repeat(10);
const r=await run('WF1','Parse and route',{nodes:{'Gmail job alerts':[{json:{id:'n1',subject:'5 new jobs for you',from:{text:'NewBoard <alerts@newboard.example>'},text:body}},{json:{id:'n2',subject:'Thank you for applying',from:{text:'X <no-reply@x.com>'},text:body}}],'Extract applications':APPH,'Extract seen':E}});
const fsOut=Object.fromEntries(files(r).map(f=>[f.json.path,dec(f)]));
ok(fsOut['/repos/uk/inbox/2026-11-02-emails.md']&&fsOut['/repos/contract/inbox/2026-11-02-emails.md'].includes('£600 per day')&&!fsOut['/repos/hk/inbox/2026-11-02-emails.md'],'unknown board email handed to uk+contract inbox');
ok(fsOut['/repos/uk/inbox/2026-11-02-emails.md'].includes('不可信')&&!fsOut['/repos/uk/inbox/2026-11-02-emails.md'].includes('zzzz'),'handed email has untrusted note and short links');
ok(fsOut['/shared/seen-alerts.csv'].includes('email:n1,email:uk+contract'),'handed email recorded in seen');
ok(kind(r,'notify').some(i=>i.json.message.includes('alerts@newboard.example')),'notify new sender handed over');
ok(!JSON.stringify(fsOut).includes('Thank you for applying'),'receipts never handed over');
const r2=await run('WF1','Parse and route',{nodes:{'Gmail job alerts':[{json:{id:'n1',subject:'5 new jobs for you',from:{text:'NewBoard <alerts@newboard.example>'},text:body}}],'Extract applications':APPH,'Extract seen':fsOut['/shared/seen-alerts.csv']}});
ok(!files(r2).some(f=>f.json.path.includes('inbox')),'same email not handed twice');
// Indeed sponsored links: each job kept, repeats dropped
const ad=(t,c,n)=>`<a href="https://uk.indeed.com/pagead/clk/dl?mo=r&ad=${n}">${t}</a> <span>${c}</span><br>`+'x'.repeat(300);
const r3=await run('WF1','Parse and route',{nodes:{'Gmail job alerts':[{json:{id:'i1',subject:'Indeed',from:{text:'Indeed <donotreply@jobalert.indeed.com>'},html:ad('Network Engineer','Acme - Leeds £60,000 a year','a1')+ad('Infrastructure Engineer','Beta - York £65,000 a year','a2')+ad('Network Engineer','Acme - Leeds £60,000 a year','a3')}}],'Extract applications':APPH,'Extract seen':E}});
const ukIn=dec(files(r3).find(i=>i.json.path==='/repos/uk/inbox/2026-11-02.md'));
ok(ukIn.includes('Infrastructure Engineer')&&ukIn.split('Network Engineer').length===2,'indeed sponsored links: distinct jobs kept, repeat dropped');
}
// WF8: "已申請" from Telegram is recorded in applications.csv
{
const CH=CH0;
const up=(id,text)=>({update_id:id,message:{chat:{id:Number(CH)},text}});
const r=await run('WF8','Handle updates',{date:'2026-11-07',nodes:{'Get updates':{result:[up(1,'已申請 Kappa'),up(2,'已申請 uk1'),up(3,'applied Unknown Co')]},'Extract queue':JSON.stringify({type:'job',id:'q1',at:'2026-11-04T00:00:00Z',track:'uk',title:'Network Engineer',company:'Kappa',url:'https://kappa.example/1'})+'\n'},input:[{json:{text:JSON.stringify({date:'2026-11-06',jobs:{uk1:{track:'uk',title:'Low Latency Network Engineer',company:'Fabrikam Quant',url:'https://g.example/1'}}})}}]});
const app=files(r).find(f=>f.json.path==='/shared/applications.csv');
const rows=dec(app);
ok(app.json.append&&!rows.startsWith('date_applied'),'applications appended without header');
ok(rows.includes('2026-11-07,uk,Kappa,Network Engineer,,telegram,https://kappa.example/1')&&rows.includes('Fabrikam Quant,Low Latency Network Engineer')&&rows.includes('Unknown Co,,,telegram'),'applied rows: '+rows);
ok(rows.trim().split('\n').length===3,'one row per message');
ok(kind(r,'send').filter(i=>String(i.json.body.text||'').startsWith('📥 已記錄申請')).length===3,'applied confirmations sent');
ok(!files(r).some(f=>f.json.path==='/shared/apply-queue.jsonl'),'applied messages never queue a CV');
}
// WF2: 4+ jobs get a CV queued automatically
{
const rep=(t,jobs)=>({json:{text:JSON.stringify({track:t,jobs})}});
const r=await run('WF2','Summarise',{date:'2026-11-09',nodes:{'Extract queue':JSON.stringify({type:'job',id:'old',url:'https://q.example/done',title:'X',company:'Q'})+'\n','Extract apply log':'id,date,track,company,role,url,folder\nz,2026-11-05,uk,Kappa,Network Engineer,,f\n'},input:[
 rep('uk',[{score:5,title:'A',company:'Co1',url:'https://a.example/1'},{score:4.5,title:'Network Engineer',company:'Kappa',url:'https://kappa.example/2'},{score:4,title:'B',company:'Co2',url:'https://www.linkedin.com/jobs/view/1/'},{score:4,title:'C',company:'Co3',url:'https://q.example/done'},{score:3,title:'D',company:'Co4',url:'https://d.example/4'}]),
 rep('hk',[{score:4,title:'E',company:'Co5',url:'https://hk.jobsdb.com/job/5'},{score:4,title:'F',company:'Co6',url:'https://f.example/6'},{score:4,title:'G',company:'Co7',url:'https://g.example/7'}])]});
const q=files(r).find(f=>f.json.path==='/shared/apply-queue.jsonl');
const qs=dec(q).trim().split('\n').map(l=>JSON.parse(l));
ok(q.json.append&&qs.length===3,'auto queue capped at 3: '+qs.map(x=>x.company));
ok(qs.map(x=>x.company).join()==='Co5,Co6,Co7'||qs.map(x=>x.company).join()==='Co1,Co2,Co5','auto queue order follows tracks: '+qs.map(x=>x.company));
ok(!qs.some(x=>['Kappa','Co3','Co4'].includes(x.company)),'auto queue skips CV done, already queued, under 4');
ok(qs.every(x=>x.type==='job'&&x.id.startsWith('20261109-auto')&&x.url&&x.needs_jd===/linkedin/.test(x.url)),'auto queue entries: LinkedIn ones wait for a JD copy or paste');
ok(qs.every(x=>x.score>=4),'auto queue entries carry the score for the runner model choice');
const msg=kind(r,'send')[0].json.body.text;
ok(msg.includes('🤖 已自動排隊整 CV')&&(msg.includes('🔎 已自動排隊')||msg.includes('📋 要貼 JD')),'digest marks auto and LinkedIn jobs');
}
// Telegram nodes send escaped HTML, never the node's default Markdown
{
let tgs=0;
for(const [k,wf] of Object.entries(WF)) for(const n of wf.nodes.filter(n=>n.type==='n8n-nodes-base.telegram'&&n.parameters.operation==='sendMessage')){ tgs++; ok(n.parameters.additionalFields.parse_mode==='HTML'&&n.parameters.text.includes("replaceAll('<', '&lt;')"),k+' '+n.name+' sends escaped HTML'); }
ok(tgs>=5,'telegram nodes checked: '+tgs);
}
console.log('PASS',pass,'assertions');
