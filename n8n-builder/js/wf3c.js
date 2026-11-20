const d = parseCsv(textOf('Extract digest'));
if (!d.rows.length) return [];
const item = fileItem(d.header.join(',') + '\n', '/shared/wf3-digest.csv');
item.json.message = `今日其他回覆 ${d.rows.length} 封\n\n` + d.rows.map(r => r.line).join('\n').slice(0, 3900);
return [item];
