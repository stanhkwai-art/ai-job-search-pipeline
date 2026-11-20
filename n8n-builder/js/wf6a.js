// The last 30 days of daily /scrape reports for every track: the week's for the totals, the older ones
// so CVs made this week for jobs scored earlier still show their score.
const out = [];
for (let i = 0; i < 30; i++) for (const t of ['hk', 'uk', 'contract']) out.push({ json: { path: `/repos/${t}/reports/${addDays(today, -i)}.json` } });
return out;
