"""Builds the n8n workflow JSON files from the Code-node sources in js/.

Usage:  python3 build.py            (writes to ./out, or to $N8N_OUT)
Placeholders are filled from the environment when set, otherwise left for you to replace before import:
  TELEGRAM_CHAT_ID  -> REPLACE_TELEGRAM_CHAT_ID   your own chat id; the bot answers nobody else
  GMAIL_LABEL_ID    -> REPLACE_GMAIL_LABEL_ID     the Gmail label WF1/WF6 add to processed alerts
  CANDIDATE_NAME    -> REPLACE_YOUR_NAME          signature on Gmail drafts (no single quotes)
  N8N_TIMEZONE      -> workflow timezone (default UTC)
Credential ids are left empty: attach your Gmail, Telegram and Anthropic credentials after import.
"""
import json, sys, os
HERE=os.path.dirname(os.path.abspath(__file__))
OUT=os.environ.get('N8N_OUT') or os.path.join(HERE,'out'); os.makedirs(OUT,exist_ok=True)
FILL={'REPLACE_TELEGRAM_CHAT_ID':os.environ.get('TELEGRAM_CHAT_ID',''),'REPLACE_GMAIL_LABEL_ID':os.environ.get('GMAIL_LABEL_ID',''),'REPLACE_YOUR_NAME':os.environ.get('CANDIDATE_NAME','')}
TZ=os.environ.get('N8N_TIMEZONE','UTC')
js=lambda n: open(f'{HERE}/js/{n}.js').read()
LIB=js('lib')
ALERTS='{from:(indeed.com OR efinancialcareers.com OR reed.co.uk OR cwjobs.co.uk OR jobserve.com OR jobalerts-noreply@linkedin.com OR jobs-noreply@linkedin.com OR jobsdb.com OR ctgoodjobs.hk OR noreply@s.seek.com.au OR adzuna.co.uk OR jobijoba.com OR talent.com OR michaelpage.com.hk OR michaelpage.co.uk OR totaljobs.com OR cv-library.co.uk OR glassdoor.com OR technojobs.co.uk OR hays.co.uk OR hays.com.hk OR robertwalters.com OR randstad.co.uk) subject:("job alert" OR "new jobs" OR "jobs for you" OR "job matches" OR "recommended jobs" OR "jobs matching" OR vacancies)} -subject:(application OR applied OR applying) -in:sent'
GMAIL={'gmailOAuth2':{'id':'','name':'Gmail'}}; TG={'telegramApi':{'id':'','name':'Telegram'}}
class W:
    def __init__(s,name): s.name=name; s.nodes=[]; s.conn={}; s.x=0
    def add(s,name,type,ver,params,creds=None,**extra):
        n={'id':f'{s.name[:3]}-{len(s.nodes)}','name':name,'type':f'n8n-nodes-base.{type}','typeVersion':ver,'position':[s.x,(len(s.nodes)%3)*160],'parameters':params}
        s.x+=220
        if creds: n['credentials']=creds
        n.update(extra); s.nodes.append(n); return name
    def link(s,a,*bs):
        s.conn.setdefault(a,{'main':[[]]})
        for b in bs: s.conn[a]['main'][0].append({'node':b,'type':'main','index':0})
    def chain(s,*ns):
        for a,b in zip(ns,ns[1:]): s.link(a,b)
    def code(s,name,*parts,**e): return s.add(name,'code',2,{'mode':'runOnceForAllItems','jsCode':LIB+'\n'+'\n'.join(js(p) for p in parts)},**e)
    def read(s,path,label):
        a=s.add(f'Read {label}','readWriteFile',1,{'operation':'read','fileSelector':path,'options':{}},executeOnce=True)
        b=s.add(f'Extract {label}','extractFromFile',1,{'operation':'text','binaryPropertyName':'data','destinationKey':'text','options':{}})
        s.link(a,b); return a,b
    def write(s,name='Write file'): return s.add(name,'readWriteFile',1,{'operation':'write','fileName':'={{ $json.path }}','dataPropertyName':'data','options':{'append':'={{ $json.append }}'}})
    # Plain text sent as HTML with &, < and > escaped: the node's default Markdown rejects an unpaired _ or * (URLs).
    # An item with an html field sends that instead (already escaped by the code that built it).
    def tg(s,name='Telegram'): return s.add(name,'telegram',1.2,{'resource':'message','operation':'sendMessage','chatId':'REPLACE_TELEGRAM_CHAT_ID','text':"={{ $json.html || String($json.message).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') }}",'additionalFields':{'appendAttribution':False,'disable_web_page_preview':True,'parse_mode':'HTML'}},TG)
    def tgdoc(s,name='Telegram file'): return s.add(name,'telegram',1.2,{'resource':'message','operation':'sendDocument','chatId':'REPLACE_TELEGRAM_CHAT_ID','binaryData':True,'binaryPropertyName':'data','additionalFields':{'caption':'={{ $json.caption }}'}},TG)
    # Telegram Bot API with buttons; the n8n Telegram node can't build inline keyboards from data or read updates.
    # The token comes from TELEGRAM_BOT_TOKEN in the n8n container (needs N8N_BLOCK_ENV_ACCESS_IN_NODE=false).
    def tgapi(s,name='Telegram API',**e): return s.add(name,'httpRequest',4.2,{'method':'POST','url':"={{ 'https://api.telegram.org/bot' + $env.TELEGRAM_BOT_TOKEN + '/' + $json.method }}",'sendBody':True,'specifyBody':'json','jsonBody':'={{ JSON.stringify($json.body) }}','options':{}},**{'onError':'continueRegularOutput',**e})
    def tolerant_read(s,path,label):
        a=s.add(f'Read {label}','readWriteFile',1,{'operation':'read','fileSelector':path,'options':{}},executeOnce=True,onError='continueRegularOutput',alwaysOutputData=True)
        b=s.add(f'Extract {label}','extractFromFile',1,{'operation':'text','binaryPropertyName':'data','destinationKey':'text','options':{}},onError='continueRegularOutput',alwaysOutputData=True)
        s.link(a,b); return a,b
    def draft(s): return s.add('Gmail draft','gmail',2.1,{'resource':'draft','operation':'create','subject':'={{ $json.subject }}','message':'={{ $json.message }}','options':{'sendTo':'={{ $json.to }}','threadId':'={{ $json.threadId }}'}},GMAIL)
    def filt(s,kind): return s.add(f'Only {kind}','filter',2,{'conditions':{'options':{'caseSensitive':True,'leftValue':'','typeValidation':'strict','version':2},'conditions':[{'id':kind,'leftValue':'={{ $json.kind }}','rightValue':kind,'operator':{'type':'string','operation':'equals'}}],'combinator':'and'},'options':{}})
    def fan(s,src,file=True,notify=True,draft=True):
        if file: f=s.filt('file'); s.link(src,f); s.chain(f,s.write())
        if notify: f=s.filt('notify'); s.link(src,f); s.chain(f,s.tg())
        if draft: f=s.filt('draft'); s.link(src,f); s.chain(f,s.draft())
    def cron(s,name,expr): return s.add(name,'scheduleTrigger',1.2,{'rule':{'interval':[{'field':'cronExpression','expression':expr}]}})
    def save(s,fn):
        d={'name':s.name,'nodes':s.nodes,'connections':s.conn,'active':False,'settings':{'executionOrder':'v1','timezone':TZ},'pinData':{}}
        text=json.dumps(d,ensure_ascii=False,indent=2)
        for k,v in FILL.items():
            if v: text=text.replace(k,json.dumps(v)[1:-1])
        open(f'{OUT}/{fn}','w').write(text)

w=W('WF1 Job alerts')
t=w.add('Gmail job alerts','gmailTrigger',1.2,{'pollTimes':{'item':[{'mode':'everyX','value':30,'unit':'minutes'}]},'simple':False,'filters':{'q':ALERTS+' -label:job-alert-processed'},'options':{}},GMAIL)
ra,ea=w.read('/shared/applications.csv','applications'); rs,es=w.read('/shared/seen-alerts.csv','seen')
m=w.add('Backfill (run by hand once)','manualTrigger',1,{})
bf=w.add('Backfill search','gmail',2.1,{'resource':'message','operation':'getAll','limit':300,'simple':False,'filters':{'q':ALERTS+' newer_than:14d -label:job-alert-processed'},'options':{}},GMAIL,executeOnce=True,alwaysOutputData=True)
c=w.code('Parse and route','fit','wf1'); w.chain(t,ra); w.chain(m,bf,ra); w.chain(ea,rs); w.chain(es,c)
ff=w.filt('file'); wr=w.write(); w.link(c,ff); w.link(ff,wr)
nf=w.filt('notify'); tg=w.tg(); w.link(c,nf); w.link(nf,tg)
ids=w.add('Message ids','code',2,{'mode':'runOnceForAllItems','jsCode':"const pick = n => { try { return $(n).all(); } catch (e) { return []; } };\nreturn [...pick('Gmail job alerts'), ...pick('Backfill search')].filter(i => i.json.id).map(i => ({ json: { id: i.json.id } }));"})
lb=w.add('Label processed','gmail',2.1,{'resource':'message','operation':'addLabels','messageId':'={{ $json.id }}','labelIds':['REPLACE_GMAIL_LABEL_ID']},GMAIL)
w.link(wr,ids); w.link(ids,lb); w.save('WF1-job-alerts.json')
# Message ids runs once per write batch; dedupe not needed because addLabels is idempotent.

w=W('WF2 Morning digest')
t=w.cron('07:45','45 7 * * 1-6'); rq,eq=w.tolerant_read('/shared/apply-queue.jsonl','queue'); rl,el=w.tolerant_read('/shared/apply-log.csv','apply log'); a=w.code('Report paths','wf2a')
r=w.add('Read report','readWriteFile',1,{'operation':'read','fileSelector':'={{ $json.path }}','options':{}},onError='continueRegularOutput',alwaysOutputData=True)
e=w.add('Extract report','extractFromFile',1,{'operation':'text','binaryPropertyName':'data','destinationKey':'text','options':{}},onError='continueRegularOutput',alwaysOutputData=True)
c=w.code('Summarise','wf2b')
w.chain(t,rq); w.chain(eq,rl); w.chain(el,a,r,e,c)
f=w.filt('file'); w.link(c,f); w.chain(f,w.write())
f=w.filt('send'); w.link(c,f); w.chain(f,w.tgapi())
w.save('WF2-morning-digest.json')

w=W('WF3 Reply triage')
t=w.add('Gmail replies','gmailTrigger',1.2,{'pollTimes':{'item':[{'mode':'everyX','value':5,'unit':'minutes'}]},'simple':False,'filters':{'q':'in:inbox -category:promotions -category:social -'+ALERTS+' {role job position interview application opportunity recruiter recruitment contract CV vacancy "right to represent"}'},'options':{}},GMAIL)
ra,ea=w.read('/shared/applications.csv','applications'); rg,eg=w.read('/shared/agencies.csv','agencies')
b=w.code('Build requests','wf3a')
h=w.add('Claude classify','httpRequest',4.2,{'method':'POST','url':'https://api.anthropic.com/v1/messages','authentication':'genericCredentialType','genericAuthType':'httpHeaderAuth','sendHeaders':True,'headerParameters':{'parameters':[{'name':'anthropic-version','value':'2023-06-01'},{'name':'anthropic-beta','value':'server-side-fallback-2026-07-01'},{'name':'content-type','value':'application/json'}]},'sendBody':True,'specifyBody':'json','jsonBody':'={{ $json.requestBody }}','options':{}},{'httpHeaderAuth':{'id':'','name':'Anthropic API'}},onError='continueRegularOutput')
c=w.code('Apply results','wf3b')
w.chain(t,ra); w.chain(ea,rg); w.chain(eg,b,h,c); w.fan(c)
t2=w.cron('20:00 digest','0 20 * * *'); r2,e2=w.read('/shared/wf3-digest.csv','digest'); c2=w.code('Build digest','wf3c'); wr2=w.write('Clear digest'); tg2=w.tg('Telegram digest')
w.chain(t2,r2); w.chain(e2,c2); w.link(c2,wr2,tg2); w.save('WF3-reply-triage.json')

w=W('WF4 Follow-ups')
t=w.cron('09:00','0 9 * * *'); ra,ea=w.read('/shared/applications.csv','applications'); rg,eg=w.read('/shared/agencies.csv','agencies'); c=w.code('Find follow-ups','wf4')
w.chain(t,ra); w.chain(ea,rg); w.chain(eg,c); w.fan(c); w.save('WF4-follow-ups.json')

w=W('WF5 Agency check-ins')
t=w.cron('09:15','15 9 * * *'); rg,eg=w.read('/shared/agencies.csv','agencies')
s=w.add('Recent sent mail','gmail',2.1,{'resource':'message','operation':'getAll','limit':100,'simple':True,'filters':{'q':'in:sent newer_than:45d'},'options':{}},GMAIL,executeOnce=True,alwaysOutputData=True)
c=w.code('Plan check-ins','wf5'); w.chain(t,rg); w.chain(eg,s,c); w.fan(c); w.save('WF5-agency-check-ins.json')

w=W('WF6 Weekly report')
# Saturday 21:00: the week's scores, CVs, applications and job emails WF1 never read.
WEEK_MISSED='newer_than:7d -label:job-alert-processed -in:sent -in:chats (from:(indeed.com OR adzuna.co.uk OR jobijoba.com OR talent.com OR michaelpage OR efinancialcareers.com OR totaljobs.com OR cv-library.co.uk OR reed.co.uk OR cwjobs.co.uk OR jobserve.com OR jobsdb.com OR ctgoodjobs.hk OR seek.com.au OR glassdoor OR hays OR robertwalters OR randstad OR harveynash OR technojobs) OR subject:(job OR jobs OR vacancy OR vacancies OR role OR roles OR opportunity OR position))'
WEEK_RECEIPTS='newer_than:7d -in:sent subject:(application OR applying OR applied)'
t=w.cron('Saturday 21:00','0 21 * * 6'); p=w.code('Week paths','wf6a')
rr=w.add('Read report','readWriteFile',1,{'operation':'read','fileSelector':'={{ $json.path }}','options':{}},onError='continueRegularOutput',alwaysOutputData=True)
er=w.add('Extract report','extractFromFile',1,{'operation':'text','binaryPropertyName':'data','destinationKey':'text','options':{}},onError='continueRegularOutput',alwaysOutputData=True)
rl,el=w.tolerant_read('/shared/apply-log.csv','apply log'); ra,ea=w.tolerant_read('/shared/applications.csv','applications')
rt,et=w.tolerant_read('/repos/*/job_search_tracker.csv','trackers'); rs,es=w.tolerant_read('/shared/seen-alerts.csv','seen')
gm=w.add('Unread job emails','gmail',2.1,{'resource':'message','operation':'getAll','limit':150,'simple':False,'filters':{'q':WEEK_MISSED},'options':{}},GMAIL,executeOnce=True,alwaysOutputData=True,onError='continueRegularOutput')
gr=w.add('Application receipts','gmail',2.1,{'resource':'message','operation':'getAll','limit':100,'simple':True,'filters':{'q':WEEK_RECEIPTS},'options':{}},GMAIL,executeOnce=True,alwaysOutputData=True,onError='continueRegularOutput')
c=w.code('Weekly review','wf6')
rq,eq=w.tolerant_read('/shared/apply-queue.jsonl','queue')
w.chain(t,p,rr,er,rl); w.chain(el,ra); w.chain(ea,rt); w.chain(et,rs); w.chain(es,rq); w.chain(eq,gm,gr,c)
w.fan(c,draft=False)
df=w.filt('doc'); w.link(c,df); w.link(df,w.tgdoc())
lf=w.filt('label'); lb=w.add('Label processed','gmail',2.1,{'resource':'message','operation':'addLabels','messageId':'={{ $json.id }}','labelIds':['REPLACE_GMAIL_LABEL_ID']},GMAIL); w.link(c,lf); w.link(lf,lb)
w.save('WF6-weekly-report.json')

w=W('WF8 Apply requests')
t=w.add('Every minute','scheduleTrigger',1.2,{'rule':{'interval':[{'field':'minutes','minutesInterval':1}]}})
ro,eo=w.tolerant_read('/shared/tg-offset.txt','offset')
g=w.add('Get updates','httpRequest',4.2,{'method':'GET','url':"={{ 'https://api.telegram.org/bot' + $env.TELEGRAM_BOT_TOKEN + '/getUpdates?timeout=0&offset=' + (Number($json.text) || 0) }}",'options':{}},onError='continueRegularOutput',alwaysOutputData=True)
rq,eq=w.tolerant_read('/shared/apply-queue.jsonl','queue')
rd=w.add('Read digests','readWriteFile',1,{'operation':'read','fileSelector':'/shared/digest/*.json','options':{}},executeOnce=True,onError='continueRegularOutput',alwaysOutputData=True)
ed=w.add('Extract digests','extractFromFile',1,{'operation':'text','binaryPropertyName':'data','destinationKey':'text','options':{}},onError='continueRegularOutput',alwaysOutputData=True)
c=w.code('Handle updates','wf8')
w.chain(t,ro); w.chain(eo,g,rq); w.chain(eq,rd,ed,c)
f=w.filt('file'); w.link(c,f); w.chain(f,w.write())
f=w.filt('send'); w.link(c,f); w.chain(f,w.tgapi())
w.save('WF8-apply-requests.json')

w=W('WF10 Application receipts')
RECEIPTS='from:(indeedapply@indeed.com OR noreply@indeed.com OR noreply@s.seek.com.au OR jobs-noreply@linkedin.com) -subject:"new jobs"'
t=w.add('Gmail receipts','gmailTrigger',1.2,{'pollTimes':{'item':[{'mode':'everyX','value':15,'unit':'minutes'}]},'simple':False,'filters':{'q':RECEIPTS},'options':{}},GMAIL)
m=w.add('Backfill (run by hand once)','manualTrigger',1,{})
b=w.add('Backfill search','gmail',2.1,{'resource':'message','operation':'getAll','limit':200,'simple':False,'filters':{'q':RECEIPTS+' newer_than:60d'},'options':{}},GMAIL,executeOnce=True,alwaysOutputData=True)
ra,ea=w.read('/shared/applications.csv','applications'); rl,el=w.tolerant_read('/shared/apply-log.csv','apply log')
c=w.code('Record applications','wf10')
w.chain(t,ra); w.chain(m,b,ra); w.chain(ea,rl); w.chain(el,c); w.fan(c,draft=False)
w.save('WF10-application-receipts.json')
