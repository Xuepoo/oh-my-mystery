const fs = require('fs');
const zlib = require('zlib');

const raw = fs.readFileSync('/home/fuyu/Downloads/Trace-20260815T150619.json.gz');
const json = JSON.parse(zlib.gunzipSync(raw).toString('utf8'));
let events = Array.isArray(json) ? json : json.traceEvents || [];

// Let's find events that took more than 50ms
const longEvents = events.filter(
  (e) =>
    e.dur &&
    e.dur / 1000 > 50 &&
    e.name !== 'RunTask' &&
    e.name !== 'V8.StackGuard' &&
    e.name !== 'V8.HandleInterrupts',
);
console.log(longEvents.map((e) => ({ name: e.name, dur: e.dur / 1000, start: e.ts / 1000 })));
