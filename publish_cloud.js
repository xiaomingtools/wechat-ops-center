#!/usr/bin/env node
// ============================================================
//  发布到云端 - Node.js 版本（避免 PS5.1 字符串解析问题）
//  Usage: node publish_cloud.js [--skip-vercel]
// ============================================================
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = 'E:/自动盈利系统/公众号运营中心/wechat-ops-center';
const LocalAPI = 'http://localhost:3001/api/app';
const OutFile = path.join(ROOT, 'data', 'appdata.json');
const BRANCH = 'main';

const args = process.argv.slice(2);
const skipVercel = args.includes('--skip-vercel');

function log(msg, color = 'reset') {
  const colors = { cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', gray: '\x1b[90m', reset: '\x1b[0m' };
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: true, ...opts });
  return { code: r.status, stdout: r.stdout?.toString() || '', stderr: r.stderr?.toString() || '' };
}

function testPort3001() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:3001/api/health', { timeout: 4000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function startServer() {
  log('[1/6] local :3001 not running - starting server.mjs ...', 'yellow');
  const proc = spawnSync('node', ['src/server.mjs'], { cwd: ROOT, detached: true, stdio: 'ignore' });
  proc.unref();
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (await testPort3001()) { log('      local service ready', 'green'); return true; }
  }
  return false;
}

async function main() {
  log('=== wechat-ops-center : publish to cloud ===', 'cyan');
  log('');

  const syncStart = new Date();
  log(`[同步开始] ${syncStart.toISOString().replace('T', ' ').slice(0, 19)}`, 'cyan');

  // ---- 1. ensure local service is running ----
  if (await testPort3001()) {
    log('[1/6] local :3001 already running', 'green');
  } else if (!(await startServer())) {
    log('local service failed to start on :3001', 'red');
    process.exit(1);
  }

  // ---- 2. pull fresh /api/app ----
  log('[2/6] fetching /api/app ...', 'yellow');
  const { stdout: appData } = run('curl', ['-s', '-m', '10', 'http://localhost:3001/api/app']);
  if (!appData) { log('fetch failed', 'red'); process.exit(1); }
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  const newFile = path.join(ROOT, 'data', '.appdata.new.json');
  fs.writeFileSync(newFile, appData);

  // quick human check
  const j = JSON.parse(appData);
  log(`      fetched: followers=${j.overview.followers} readers30d=${j.overview.totalReaders30d} articles=${j.overview.totalArticles}`, 'green');

  // ---- 3. commit only if BUSINESS data changed ----
  log('[3/6] checking for data change ...', 'yellow');
  run('git', ['show', 'HEAD:data/appdata.json'], { cwd: ROOT }).stdout; // just to check if file exists
  const oldFile = path.join(ROOT, 'data', '.appdata.old.json');
  run('git', ['show', 'HEAD:data/appdata.json'], { cwd: ROOT }).stdout; // check exists
  // use git show to get old file
  const oldResult = run('git', ['show', 'HEAD:data/appdata.json'], { cwd: ROOT });
  if (oldResult.code === 0) fs.writeFileSync(path.join(ROOT, 'data', '.appdata.old.json'), oldResult.stdout);

  const changed = (() => {
    function biz(p) {
      try {
        const s = fs.readFileSync(p, 'utf8');
        const o = JSON.parse(s);
        if (o.generated_at !== undefined) delete o.generated_at;
        return JSON.stringify(o);
      } catch (e) { return null; }
    }
    const oldB = biz(path.join(ROOT, 'data', '.appdata.old.json'));
    const newB = biz(newFile);
    if (oldB === null) return 'ADD';
    else if (oldB === newB) return 'SAME';
    else return 'CHANGED';
  })();
  log(`      fingerprint: ${changed}`, 'gray');

  if (fs.existsSync(path.join(ROOT, 'data', '.appdata.old.json'))) fs.unlinkSync(path.join(ROOT, 'data', '.appdata.old.json'));
  fs.unlinkSync(newFile);

  if (changed === 'SAME') {
    log('      business data unchanged - cloud already up to date. Updating check timestamp...', 'gray');
    const outFile = path.join(ROOT, 'data', 'appdata.json');
    const d = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    if (d.overview && d.overview.dataBrief) {
      d.overview.dataBrief.lastSystemCheckAt = new Date().toISOString();
      d.overview.dataBrief.collectFailureReason = '业务数据无变化，仅更新检查时间';
      fs.writeFileSync(outFile, JSON.stringify(d, null, 2), 'utf8');
    }
    log('      check timestamp updated, done.', 'gray');
    log('');
    log('  local: http://localhost:3001/', 'cyan');
    log('  cloud: https://wechat-ops-center.vercel.app/', 'cyan');
    return;
  }

  // ---- 4. write fresh data and commit ----
  log('[4/6] writing fresh data & committing ...', 'yellow');
  // fetch again to ensure fresh data
  const { stdout: freshData } = run('curl', ['-s', '-m', '10', 'http://localhost:3001/api/app']);
  fs.writeFileSync(path.join(ROOT, 'data', 'appdata.json'), freshData);
  run('git', ['add', 'data/appdata.json'], { cwd: ROOT });
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 16);
  run('git', ['commit', '-m', `sync: refresh cloud data appdata.json @ ${ts}`], { cwd: ROOT });

  // ---- 5. git push with retry ----
  log('[5/6] pushing to GitHub ...', 'yellow');
  let pushOk = false;
  for (let i = 1; i <= 3; i++) {
    const push = run('git', ['push', 'origin', 'main'], { cwd: ROOT });
    if (push.code === 0) { log('      data updated & pushed to GitHub', 'green'); pushOk = true; break; }
    log(`  [重试] git push 失败，退出码 ${push.code}，5s 后重试...`, 'yellow');
    await new Promise(r => setTimeout(r, 5000));
  }
  if (!pushOk) {
    log('git push failed after 3 retries', 'red');
    process.exit(1);
  }

  // ---- 6. Vercel deploy (optional) ----
  const skipVercel = process.argv.includes('--skip-vercel');
  if (process.argv.includes('--skip-vercel')) {
    log('[6/6] vercel deploy skipped (--skip-vercel). Data is live via raw GitHub fallback.', 'gray');
  } else {
    log('[6/6] redeploying Vercel ...', 'yellow');
    let vercelOk = false;
    for (let i = 1; i <= 3; i++) {
      const vercel = run('vercel', ['--prod', '--yes'], { cwd: ROOT, timeout: 120000 });
      if (vercel.stdout.includes('Aliased') || vercel.stdout.includes('Ready in') || vercel.stdout.includes('Production')) {
        vercelOk = true; break;
      }
      log(`  [重试] vercel 部署异常，10s 后重试...`, 'yellow');
      await new Promise(r => setTimeout(r, 10000));
    }
    if (!vercelOk) {
      log('  Vercel 部署可能异常，但 GitHub raw 数据源已更新，云端看板仍可通过兜底数据源访问', 'yellow');
    } else {
      log('      Vercel deploy complete', 'green');
    }
  }

  // ---- 7. 云端回读核验 ----
  log('[7/7] 云端数据核验...', 'cyan');
  // 使用 GitHub API 而非 raw.githubusercontent.com，避免 CDN 缓存导致误判
  const { stdout: apiData } = run('curl', ['-s', '-H', 'Accept: application/vnd.github.v3+json', '-m', '15', 'https://api.github.com/repos/xiaomingtools/wechat-ops-center/contents/data/appdata.json?ref=main']);
  if (!apiData) { log('云端数据核验失败：无法获取 GitHub API 数据', 'red'); process.exit(1); }
  const apiResponse = JSON.parse(apiData);
  // GitHub API returns content as base64 encoded
  const cloudContent = Buffer.from(apiResponse.content, 'base64').toString('utf8');
  const cloudFile = path.join(ROOT, 'data', '.appdata.cloud.json');
  fs.writeFileSync(cloudFile, cloudContent);

  const verify = (() => {
    function normalize(obj) {
      // Delete all volatile timestamp and auto-generated fields
      if (obj.generated_at !== undefined) delete obj.generated_at;
      if (obj.overview) {
        if (obj.overview.dataAgeHours !== undefined) delete obj.overview.dataAgeHours;
        if (obj.overview.latestCheck !== undefined) delete obj.overview.latestCheck;
        if (obj.overview.dataBrief) {
          if (obj.overview.dataBrief.lastSystemCheckAt !== undefined) delete obj.overview.dataBrief.lastSystemCheckAt;
          if (obj.overview.dataBrief.categories) {
            for (const c of obj.overview.dataBrief.categories) {
              if (c.lastCollectAt !== undefined) delete c.lastCollectAt;
              if (c.lastSuccessfulCollectAt !== undefined) delete c.lastSuccessfulCollectAt;
              if (c.lastCheckAt !== undefined) delete c.lastCheckAt;
              if (c.lastSyncAt !== undefined) delete c.lastSyncAt;
            }
          }
        }
        if (obj.overview.dataFreshness !== undefined) delete obj.overview.dataFreshness;
        if (obj.overview.dataAgeHours !== undefined) delete obj.overview.dataAgeHours;
      }
      if (obj.systemStatus) {
        if (obj.systemStatus.lastHealthyCheck !== undefined) delete obj.systemStatus.lastHealthyCheck;
        if (obj.systemStatus.lastDataCapture !== undefined) delete obj.systemStatus.lastDataCapture;
        if (obj.systemStatus.dataAgeHours !== undefined) delete obj.systemStatus.dataAgeHours;
        if (obj.systemStatus.lastSync !== undefined) delete obj.systemStatus.lastSync;
        if (obj.systemStatus.lastReport !== undefined) delete obj.systemStatus.lastReport;
      }
      if (obj.meta && obj.meta.dataSources !== undefined) delete obj.meta.dataSources;
      if (obj.risks) {
        for (const r of obj.risks) {
          if (r.since !== undefined) delete r.since;
          if (r.integrity !== undefined) delete r.integrity;
        }
      }
      // Also remove any fields that contain timestamps
      function cleanTimestamps(o) {
        for (const k of Object.keys(o)) {
          if (typeof o[k] === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(o[k])) {
            delete o[k];
          } else if (typeof o[k] === 'object' && o[k] !== null) {
            cleanTimestamps(o[k]);
          }
        }
      }
      cleanTimestamps(obj);
      return JSON.stringify(obj);
    }
    const l = normalize(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'appdata.json'), 'utf8')));
    const c = normalize(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', '.appdata.cloud.json'), 'utf8')));
    // Debug output
    console.error('[DEBUG] verify l length:', l.length, 'c length:', c.length, 'equal:', l === c);
    if (l === null || c === null) return 'ERROR';
    else if (l === c) return 'SAME';
    else return 'DIFF';
  })();

  if (fs.existsSync(path.join(ROOT, 'data', '.appdata.cloud.json'))) {
    // Keep for debugging
    // fs.unlinkSync(path.join(ROOT, 'data', '.appdata.cloud.json'));
  }

  if (verify === 'SAME') {
    log('  业务指纹一致 (SAME) - 云端数据已同步', 'green');
  } else {
    log('云端数据核验失败，同步可能不完整', 'red');
    process.exit(1);
  }

  log('[完成] 同步完成', 'green');
  log('');
  log('  local: http://localhost:3001/', 'cyan');
  log('  cloud: https://wechat-ops-center.vercel.app/', 'cyan');
  log('');
  log('Note: cloud dashboard pulls data live from raw.githubusercontent (data/appdata.json)', 'gray');
  log('      Git push is enough to refresh cloud view; Vercel deploy is optional.', 'gray');
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });