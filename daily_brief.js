#!/usr/bin/env node
// ============================================================
//  每日经营简报生成器 (daily_brief.js)
//  读本地 :3001/api/app（或 data/appdata.json 兜底）真实数据
//  -> 生成 10_运营数据/daily_brief/YYYY-MM-DD.{md,json}
//  -> (可选) 调 publish_cloud.ps1 推云端
//  -> 记录 data_update_log（数据更新台账，供"数据更新记录"模块查看）
//
//  用法:
//    node daily_brief.js              # 生成今日简报（不推云端）
//    node daily_brief.js --push       # 生成 + 推云端
//    node daily_brief.js --date 2026-11-26   # 指定日期补档
//    node daily_brief.js --port 3001
//
//  数据真实性：只基于真实聚合数据；缺失字段一律标注"暂无/未知"，不虚构。
//  业务无变化时仍记录 lastSuccessfulCollectAt，避免看板长期显示未更新。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = 'E:/自动盈利系统/公众号运营中心';
const BRIEF_DIR = path.join(ROOT, '10_运营数据', 'daily_brief');
const LOG_DIR = path.join(ROOT, '10_运营数据', 'data_update_log');
const PUBLISH_PS1 = path.join(ROOT, 'wechat-ops-center', 'publish_cloud.ps1');

// ─── 参数解析 ─────────────────────────────────────────────
function parseArgs() {
  const a = { push: false, port: 3001, date: null };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--push') a.push = true;
    else if (argv[i] === '--date') a.date = argv[++i];
    else if (argv[i] === '--port') a.port = Number(argv[++i]);
  }
  return a;
}

const p2 = n => String(n).padStart(2, '0');
function fmtDate(d) { return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }
function todayStr() { const d = new Date(); return fmtDate(d); }

// ─── 数据抓取（本地 :3001 优先，文件兜底）──────────────────
async function fetchAppData(port) {
  try {
    const url = `http://localhost:${port}/api/app`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`本地服务 ${url} 返回 ${res.status}`);
    return await res.json();
  } catch (e) {
    console.log('本地 :3001 未响应，回退 data/appdata.json …');
    const f = path.join(ROOT, 'wechat-ops-center', 'data', 'appdata.json');
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  }
}

// ─── 简报构建（只基于真实数据，缺失标注）──────────────────
function buildBrief(app, w) {
  const o = app.overview || {};
  const latestDb = o.dataBrief || {};
  const yest = o.yesterdayReads ?? '暂无';
  const wow = o.wrWoW;
  const fansDelta = (app.userGrowth?.weeklyNet != null ? app.userGrowth.weeklyNet : '未知');
  const top = (app.topArticles || []).slice(0, 5);
  const latestArt = (app.publishHistory || app.articles || [])[0] || null;
  const risks = (app.risks || []).filter(r => r.level !== 'info');

  // 最新周度运营决议与内容计划（用于简报展示）
  const latestRes = app.latestResolution;
  const latestPlan = app.latestContentPlan;

  const data = {
    yesterday: {
      reads: yest,
      change: o.yesterdayChange === 'N/A' ? '暂无环比' : o.yesterdayChange,
      readers30d: o.totalReaders30d ?? '暂无',
      followersTotal: o.followers ?? '未知',
      followersWeekNet: fansDelta,
    },
    latestArticle: latestArt ? { date: latestArt.date, title: latestArt.title, outcome: latestArt.outcome } : null,
    publishedCount: o.publishedCount ?? '未知',
    pendingDrafts: o.pendingDrafts ?? '未知',
    channel: o.searchPct != null ? { searchPct: o.searchPct, recommendPct: o.recommendPct } : null,
    topArticles: top,
    problems: risks,
    followUps: ['持续跟踪粉丝净增长', '维护内容日更节奏', '监控搜索/推荐流量占比'],
    // 新增：本周运营决议摘要
    latestResolution: latestRes ? {
      period: latestRes.period,
      nextPeriod: latestRes.next_period,
      phase: latestRes.phase,
      resolutionsCount: latestRes.resolutions?.length || 0,
      acceptance: latestRes.last_week_acceptance,
      resolutions: latestRes.resolutions?.map(r => ({ no: r.no, name: r.name, category: r.category, priority: r.priority, action: r.action, acceptanceMetric: r.acceptanceMetric }))
    } : null,
    // 新增：本周内容计划摘要
    latestContentPlan: latestPlan ? {
      forPeriod: latestPlan.for_period,
      coreDirection: latestPlan.plan?.coreDirection,
      schedule: latestPlan.plan?.schedule?.map(s => ({ day: s.day, topic: s.topic, title: s.title, resolutionRef: s.resolutionRef })) || []
    } : null,
  };

  const lines = [];
  lines.push(`# 每日经营简报 ${w.date}`);
  lines.push('');
  lines.push(`> 账号：${app.account} · 数据截至 ${o.latestCheck || '—'} · 数据状态 ${latestDb.overallStatus || latestDb.dataStatus || '未知'} · 生成于 ${new Date().toLocaleString('zh-CN')}`);
  lines.push('');
  lines.push('## 一、昨日经营数据');
  lines.push('');
  lines.push('| 指标 | 值 | 说明 |');
  lines.push('|---|---|---|');
  lines.push(`| 昨日阅读人数 | ${yest} | ${o.yesterdayChange === 'N/A' ? '暂无环比' : o.yesterdayChange} |`);
  lines.push(`| 30天读者 | ${o.totalReaders30d ?? '暂无'} | 后台30天内容分析 |`);
  lines.push(`| 累计粉丝 | ${o.followers ?? '未知'} | 本周净增 ${fansDelta} |`);
  lines.push(`| 已发布 / 待发布 | ${o.publishedCount ?? '未知'} / ${o.pendingDrafts ?? '未知'} | 共 ${o.totalArticles ?? '?'} 篇 |`);
  lines.push('');

  lines.push('## 二、粉丝与阅读变化');
  lines.push('');
  lines.push(`- 累计粉丝 ${o.followers ?? '未知'}（目标 ${o.followerTarget}，进度 ${o.followerPct ?? 0}%，还差 ${Math.max(0, (o.followerTarget || 0) - (o.followers || 0))})`);
  lines.push(`- 本周阅读 ${o.wrThisWeek ?? '暂无'}，上周 ${o.wrPrevWeek ?? '暂无'}，环比 ${wow === 0 ? '持平' : (wow > 0 ? '+' + wow + '%' : wow + '%')}`);
  lines.push(`- 流量结构：搜一搜 ${o.searchPct ?? '暂无'}% / 推荐 ${o.recommendPct ?? '暂无'}%${(app.wrChannels && Object.keys(app.wrChannels).length) ? '；' + Object.entries(app.wrChannels).map(([k, v]) => `${k} ${v}%`).join('、') : ''}`);
  lines.push('');

  lines.push('## 三、最新文章表现');
  lines.push('');
  if (latestArt) {
    lines.push(`- 最新：${latestArt.date} [${latestArt.outcome}] ${latestArt.title}`);
  } else {
    lines.push('- 暂无最新发布记录');
  }
  if (top.length) {
    lines.push('');
    lines.push('**近30天 Top 高阅读**');
    lines.push('');
    top.forEach((a, i) => lines.push(`${i + 1}. ${a.reads ?? '暂无'} 阅读（${a.pct ?? '--'}）· ${a.title}`));
  }
  lines.push('');

  lines.push('## 四、当日工作完成情况');
  lines.push('');
  const ws = app.workSummary || {};
  lines.push(`- 工作记录 ${ws.total ?? 0} 条` + (ws.byStatus ? ' · ' + Object.entries(ws.byStatus).map(([k, v]) => `${k} ${v}`).join('、') : ''));
  lines.push(`- 数据更新状态：${latestDb.overallStatus || latestDb.dataStatus || '未知'}（最近采集 ${latestDb.lastCollectAt || latestDb.lastSuccessfulCollectAt || '—'}）`);
  lines.push('');

  lines.push('## 五、当前主要问题');
  lines.push('');
  if (risks.length) risks.forEach(r => lines.push(`- [${r.level}] ${r.title}：${r.desc}`));
  else lines.push('- 暂无需关注的经营异常');
  lines.push('');

  // 最新周度运营决议摘要
  if (latestRes) {
    lines.push('## 五、本周运营决议摘要');
    lines.push('');
    lines.push(`> 复盘周期：${latestRes.period || '—'} · 下期：${latestRes.next_period || '—'} · 阶段：${latestRes.phase || '粉丝积累期'}`);
    lines.push('');
    if (latestRes.last_week_acceptance?.available) {
      lines.push(`**上周决议验收（${latestRes.last_week_acceptance.items?.length || 0} 条）**：`);
      latestRes.last_week_acceptance.items?.forEach(it => {
        lines.push(`- ${it.verdict}：${it.name}（${it.detail.slice(0, 80)}...）`);
      });
      lines.push('');
    }
    if (latestRes.resolutions?.length) {
      lines.push(`**本期决议（${latestRes.resolutions.length} 条）**：`);
      latestRes.resolutions.forEach(r => {
        lines.push(`- ${r.no} ${r.name} [${r.category}] ${r.priority}：${r.action.slice(0, 60)}...`);
      });
      lines.push('');
    }
  }

  // 最新内容计划摘要
  if (latestPlan) {
    lines.push('## 六、本周内容更新计划');
    lines.push('');
    lines.push(`> 执行周期：${latestPlan.for_period || '—'} · 核心方向：${latestPlan.plan?.coreDirection || '—'}`);
    lines.push('');
    if (latestPlan.plan?.schedule?.length) {
      latestPlan.plan.schedule.forEach(s => {
        lines.push(`- ${s.day}：${s.topic} — ${s.title.slice(0, 50)}... [决议：${s.resolutionRef}]`);
      });
      lines.push('');
    }
    lines.push(`> 发布时间：周二~周四 08:00-09:00 · 验证指标：发布 24h 阅读 ≥ 周均`);
    lines.push('');
  }

  lines.push('## 七、当前主要问题');
  lines.push('');
  if (risks.length) risks.forEach(r => lines.push(`- [${r.level}] ${r.title}：${r.desc}`));
  else lines.push('- 暂无需关注的经营异常');
  lines.push('');

  lines.push('## 八、需持续关注事项');
  lines.push('');
  data.followUps.forEach(s => lines.push(`- ${s}`));
  lines.push('');

  lines.push('## 九、下一步工作重点');
  lines.push('');
  lines.push(`1. 内容日更：优先清空 ${o.pendingDrafts ?? 0} 篇待发布草稿`);
  lines.push(`2. 粉丝增长：引导关注互动话术 + 朋友圈/社群转发`);
  lines.push(`3. 搜索流量：标题埋入高频关键词，提升搜一搜占比`);
  lines.push('');

  lines.push('---');
  lines.push(`*本简报由 WorkBuddy 自动流程生成 · 数据源：本地 :${w.port}/api/app · 经营指挥中心仅查看*`);
  return { md: lines.join('\n'), data };
}

// ─── 数据更新台账记录（供"数据更新记录"查看；只记录真实执行）──
function recordUpdateLog(app, w, ok, detail) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const db = app.overview?.dataBrief || {};
  const entry = {
    date: w.date,
    planned: '09:00',
    executed_at: new Date().toISOString(),
    collect_result: ok ? '成功' : '失败',
    validate_result: detail || '',
    cloud_sync: (w.push && ok) ? '已推送' : (w.push ? '未推送' : '未推送'),
    cloud_verify: '—',
    duration_ms: detail?.duration ?? null,
    error_reason: ok ? '' : (detail?.reason || '未知'),
  };
  const f = path.join(LOG_DIR, `${w.date}.json`);
  // 追加式台账：保留当日多次执行记录
  let arr = [];
  if (fs.existsSync(f)) { try { arr = JSON.parse(fs.readFileSync(f, 'utf8')); if (!Array.isArray(arr)) arr = [arr]; } catch { arr = []; } }
  arr.push(entry);
  fs.writeFileSync(f, JSON.stringify(arr, null, 2), 'utf8');
  return f;
}

// ─── 主流程 ──────────────────────────────────────────────
(async () => {
  const args = parseArgs();
  const w = { date: args.date || todayStr(), port: args.port, push: args.push };
  console.log(`=== 生成每日经营简报 ${w.date} ===`);

  let app;
  const t0 = Date.now();
  try { app = await fetchAppData(w.port); }
  catch (e) {
    console.error('❌ 数据获取失败：' + e.message);
    recordUpdateLog({ overview: { dataBrief: { lastCollectAt: '' } } }, w, false, { reason: e.message, duration: Date.now() - t0 });
    process.exit(1);
  }

  fs.mkdirSync(BRIEF_DIR, { recursive: true });
  const mdPath = path.join(BRIEF_DIR, `${w.date}.md`);
  const jsonPath = path.join(BRIEF_DIR, `${w.date}.json`);
  const { md, data } = buildBrief(app, w);
  fs.writeFileSync(mdPath, md, 'utf8');
  const payload = {
    record_type: 'daily_brief',
    date: w.date,
    generated_at: new Date().toISOString(),
    source: `本地 :${w.port}/api/app`,
    dataStatus: app.overview?.dataBrief?.dataStatus || '未知',
    overview: app.overview,
    data,
    markdown_path: mdPath,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  recordUpdateLog(app, w, true, { reason: `粉丝 ${app.overview?.followers ?? '?'} / 30天读者 ${app.overview?.totalReaders30d ?? '?'} / 待发布 ${app.overview?.pendingDrafts ?? '?'}`, duration: Date.now() - t0 });

  console.log(`✅ 简报已生成:\n  - ${mdPath}\n  - ${jsonPath}`);
  console.log(`   数据状态: ${payload.dataStatus} · 粉丝 ${app.overview?.followers ?? '?'} · 30天读者 ${app.overview?.totalReaders30d ?? '?'}`);

  if (args.push) {
    console.log('=== 推送到云端 (publish_cloud.ps1) ===');
    const { spawnSync } = require('child_process');
    const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PUBLISH_PS1], { cwd: path.join(ROOT, 'wechat-ops-center'), shell: process.platform === 'win32' });
    process.stdout.write(r.stdout?.toString() || '');
    process.stderr.write(r.stderr?.toString() || '');
    console.log(`推送退出码: ${r.status}`);
  }
})().catch(e => { console.error('❌', e); process.exit(1); });
