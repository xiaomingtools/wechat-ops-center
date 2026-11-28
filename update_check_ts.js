#!/usr/bin/env node
// When business data is unchanged: only refresh dataBrief.lastSystemCheckAt in data/appdata.json.
// Uses __dirname so no (possibly non-ASCII) path argument is needed.
const fs = require('fs');
const path = require('path');
const f = path.join(__dirname, 'data', 'appdata.json');
const d = JSON.parse(fs.readFileSync(f, 'utf8'));
if (d.overview && d.overview.dataBrief) {
  d.overview.dataBrief.lastSystemCheckAt = new Date().toISOString();
  d.overview.dataBrief.collectFailureReason = 'no business data change, only check time updated';
  fs.writeFileSync(f, JSON.stringify(d, null, 2), 'utf8');
  console.log('updated');
} else {
  console.log('no dataBrief');
}
