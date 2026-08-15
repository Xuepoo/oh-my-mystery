const fs = require('fs');
const zlib = require('zlib');

const raw = fs.readFileSync('/home/fuyu/Downloads/Trace-20260815T150619.json.gz');
const json = JSON.parse(zlib.gunzipSync(raw).toString('utf8'));

let events = Array.isArray(json) ? json : json.traceEvents || [];
let pointers = events.filter((e) => e.name.includes('Pointer') || e.name.includes('Mouse'));

console.log('Pointer Events Count:', pointers.length);

let longestPointer = pointers.sort((a, b) => (b.dur || 0) - (a.dur || 0)).slice(0, 5);
console.log(longestPointer.map((p) => ({ name: p.name, dur: p.dur / 1000 })));
