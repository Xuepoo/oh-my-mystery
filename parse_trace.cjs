const fs = require('fs');
const zlib = require('zlib');

const raw = fs.readFileSync('/home/fuyu/Downloads/Trace-20260815T150619.json.gz');
const json = JSON.parse(zlib.gunzipSync(raw).toString('utf8'));

let events = Array.isArray(json) ? json : json.traceEvents || [];

let functions = {};

events.forEach((e) => {
  if (e.ph === 'X') {
    // Complete events
    const name = e.name;
    const dur = e.dur / 1000; // in ms

    // Check if there are args with functionName
    let fName = name;
    if (e.args && e.args.data && e.args.data.functionName) {
      fName = `${name}: ${e.args.data.functionName}`;
    }

    if (!functions[fName]) functions[fName] = { count: 0, totalMs: 0, maxMs: 0 };
    functions[fName].count++;
    functions[fName].totalMs += dur;
    if (dur > functions[fName].maxMs) functions[fName].maxMs = dur;
  }
});

const sorted = Object.keys(functions)
  .map((k) => ({ name: k, ...functions[k] }))
  .sort((a, b) => b.totalMs - a.totalMs)
  .slice(0, 30);

console.table(sorted);
