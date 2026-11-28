#!/usr/bin/env node
// 云端数据核验：比较本地 data/appdata.json 与云端回读 data/.appdata.cloud.json
// 去掉 generated_at 时间戳后做业务指纹比对，输出 SAME / DIFF / ERROR
const fs = require('fs');
const path = require('path');
function biz(p) {
  let s;
  try { s = fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
  const o = JSON.parse(s);
  if (o.generated_at !== undefined) delete o.generated_at;
  return JSON.stringify(o);
}
const local = biz(path.join(__dirname, 'data', 'appdata.json'));
const cloud = biz(path.join(__dirname, 'data', '.appdata.cloud.json'));
if (local === null || cloud === null) { console.log('ERROR'); process.exit(1); }
else if (local === cloud) { console.log('SAME'); process.exit(0); }
else { console.log('DIFF'); process.exit(1); }
