#!/usr/bin/env node
// Business fingerprint compare for cloud sync.
// Compares data/.appdata.old.json (git HEAD) vs data/.appdata.new.json (fresh fetch),
// ignoring the generated_at timestamp. Prints: SAME | CHANGED | ADD
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'data');
function biz(name) {
  let s;
  try { s = fs.readFileSync(path.join(dir, name), 'utf8'); } catch (e) { return null; }
  const o = JSON.parse(s);
  if (o.generated_at !== undefined) delete o.generated_at;
  return JSON.stringify(o);
}
const oldB = biz('.appdata.old.json');
const newB = biz('.appdata.new.json');
if (newB === null) { console.log('ERROR'); process.exit(1); }
if (oldB === null) { console.log('ADD'); process.exit(0); }
if (oldB === newB) { console.log('SAME'); process.exit(0); }
console.log('CHANGED'); process.exit(0);
