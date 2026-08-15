const fs = require('fs');
const text = fs.readFileSync('../../vectojs/vectojs/packages/core/src/tree/Scene.ts', 'utf8');

const loopFn = text.slice(text.indexOf('private loop('), text.indexOf('private processEvents('));
console.log(loopFn);
