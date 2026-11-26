#!/usr/bin/env node
// ============================================================
//  每周总结生成器 (weekly_review.js)
//  读本地 :3001/api/app 聚合数据 -> 生成周度复盘 md + json
//  -> (可选) 调 publish_cloud.ps1 推云端
//
//  用法:
//    node weekly_review.js            # 生成最近一个完整周的周报
//    node weekly_review.js --push     # 生成 + 推云端
//    node weekly_review.js --week 2026-11-30   # 指定窗口结束日(周日)补档
//    node weekly_review.js --port 3001          # 指定本地端口
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = 'E:/自动盈利系统/公众号运营中心';
const REVIEW_DIR = path.join(ROOT, '10_运营数据', 'weekly_review');
const PUBLISH_PS1 = path.join(ROOT, 'wechat-ops-center', 'publish_cloud.ps1');

// ─── 参数解析 ─────────────────────────────────────────────
function parseArgs() {
  const a = { push: false, port: 3001, week: null };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--push') a.push = true;
    else if (argv[i] === '--week') a.week = argv[++i];
    else if (argv[i] === '--port') a.port = Number(argv[++i]);
  }
  return a;
}

// ─── 日期工具 (ISO 周: 周一..周日) ───────────────────────
function isoWeekStart(d) { // 周一
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7; // 0=Mon
  x.setDate(x.getDate() - day);
  return x;
}
function fmtDate(d) { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function fmtShort(d) { const p = n => String(n).padStart(2, '0'); return `${d.getMonth() + 1}/${d.getDate()}`; }

function resolveWindow(weekArg) {
  // 默认: 取"上一个完整周日"作为窗口结束(生成周报一般回顾已结束的那周)
  let end;
  if (weekArg) {
    end = new Date(weekArg + 'T00:00:00');
  } else {
    const now = new Date();
    const ws = isoWeekStart(now);
    const thisSunday = new Date(ws);
    thisSunday.setDate(ws.getDate() + 6);
    // 若今天还没到本周日, 回顾上一周; 否则本周日刚结束用本周
    if (now < thisSunday) {
      end = new Date(thisSunday);
      end.setDate(end.getDate() - 7);
    } else {
      end = thisSunday;
    }
  }
  const start = new Date(end); start.setDate(end.getDate() - 6);
  const prevEnd = new Date(start); prevEnd.setDate(start.getDate() - 1);
  const prevStart = new Date(prevEnd); prevStart.setDate(prevEnd.getDate() - 6);
  return { start, end, prevStart, prevEnd };
}

// ─── 数据抓取 ────────────────────────────────────────────
async function fetchAppData(port) {
  const url = `http://localhost:${port}/api/app`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`本地服务 ${url} 返回 ${res.status}`);
  return res.json();
}

// ─── 建议引擎 ────────────────────────────────────────────
function buildRecommendations(o, topArticles, window) {
  const rec = [];
  // 1 粉丝增长
  const gap = o.followerTarget - o.followers;
  if (gap > 0) {
    rec.push({
      icon: '🚀', title: '突破粉丝瓶颈', priority: 'high',
      text: `当前 ${o.followers} 粉丝，距目标 ${o.followerTarget} 还差 ${gap}。每篇末尾加固定引导话术（如"关注看明天更新"），并在朋友圈/社群做 1 次转发扩散。`,
    });
  }
  // 2 阅读量趋势
  if (o.wrWoW !== undefined && o.wrWoW < -30) {
    rec.push({
      icon: '📉', title: '阅读量下滑需排查', priority: 'high',
      text: `本周阅读 ${o.wrThisWeek}，环比 ${o.wrWoW}%。建议排查：发布时间是否偏移、标题点击率、以及是否有断更。优先恢复稳定日更节奏。`,
    });
  } else if (o.wrWoW > 0) {
    rec.push({ icon: '📈', title: '阅读量正增长', priority: 'info', text: `本周 ${o.wrThisWeek}，环比 +${o.wrWoW}%，势头良好，保持当前选题方向。` });
  }
  // 3 SEO / 搜一搜
  if (o.searchPct < 30) {
    rec.push({
      icon: '🔍', title: '强化搜索流量', priority: 'medium',
      text: `搜一搜占比 ${o.searchPct}%（推荐占 ${o.recommendPct}%）。标题埋入"怎么 / 方法 / 教程 / 解决"等高频词，把搜索占比拉高，降低对推荐流依赖。`,
    });
  }
  // 4 发布积压
  if (o.pendingDrafts > 0) {
    rec.push({ icon: '⏳', title: '清理待发布草稿', priority: 'medium', text: `有 ${o.pendingDrafts} 篇待发布草稿积压，优先清空以维持日更节奏。` });
  }
  // 5 内容方向 (基于 Top 标题类别)
  if (topArticles && topArticles.length) {
    const titles = topArticles.map(a => a.title).join(' ');
    const hit = ['Word', 'Excel', '周报', 'PPT', 'PDF', '截图'].filter(k => titles.includes(k));
    if (hit.length) {
      rec.push({ icon: '🎯', title: '加码高表现内容', priority: 'medium', text: `高阅读标题集中在 ${hit.slice(0, 3).join('、')} 类实用工具教程，建议做成系列专题，放大已验证的选题方向。` });
    }
  }
  // 6 数据健康
  if (o.wxLoginState !== 'LOGGED_IN') {
    rec.push({ icon: '⚠️', title: '数据源需刷新', priority: 'high', text: `微信登录态 ${o.wxLoginState}，后台数据可能过期，需重新扫码采集后再出报。` });
  }
  // 7 固定节奏建议
  rec.push({ icon: '⏰', title: '最佳发布时间', priority: 'info', text: '周二~周四上午 8:00-9:00 为公众号打开高峰，重磅内容排在此时段群发。' });
  return rec;
}

// ─── 本周发布统计 (从 articles 过滤窗口) ─────────────────
function weekPublishes(articles, start, end) {
  const s = fmtDate(start), e = fmtDate(end);
  const items = (articles || []).filter(a => a.date >= s && a.date <= e);
  const news = items.filter(a => /图文|news/i.test(a.type || '')).length;
  return items;
}

// ─── 生成 markdown ───────────────────────────────────────
function buildMarkdown(app, w) {
  const o = app.overview;
  const lines = [];
  lines.push(`# 周度复盘 ${fmtDate(w.start)} ~ ${fmtDate(w.end)}`);
  lines.push('');
  lines.push(`> 账号：${app.account} · 数据截至 ${o.latestCheck || '—'} · 生成于 ${new Date().toLocaleString('zh-CN')}`);
  lines.push('');

  // 一、核心指标
  lines.push('## 一、核心指标');
  lines.push('');
  lines.push('| 指标 | 本周 | 说明 |');
  lines.push('|---|---|---|');
  lines.push(`| 累计粉丝 | ${o.followers} | 目标 ${o.followerTarget}，进度 ${o.followerPct}% |`);
  lines.push(`| 30天总读者 | ${o.totalReaders30d} | 近30天阅读人数估算 |`);
  lines.push(`| 昨日阅读 | ${o.yesterdayReads} | ${o.yesterdayChange === 'N/A' ? '—' : o.yesterdayChange} |`);
  lines.push(`| 已发布文章 | ${o.publishedCount}/${o.totalArticles} | 待发布草稿 ${o.pendingDrafts} 篇 |`);
  lines.push(`| 通关率 | ${o.passRate}% | 草稿校验通过率 |`);
  lines.push('');
  lines.push(`> 粉丝进度：${o.followers}/${o.followerTarget}（还差 ${Math.max(0, o.followerTarget - o.followers)}）。`);
  lines.push('');

  // 二、发布产出
  const pubs = weekPublishes(app.articles, w.start, w.end);
  lines.push('## 二、本周发布产出');
  lines.push('');
  if (pubs.length) {
    lines.push(`本周发布 ${pubs.length} 篇：`);
    lines.push('');
    pubs.forEach(a => lines.push(`- ${a.date} [${a.webStatus}] ${a.title}`));
  } else {
    lines.push('本周无发布记录（窗口内无条目）。');
  }
  lines.push('');

  // 三、内容表现
  lines.push('## 三、内容表现');
  lines.push('');
  lines.push('**近30天 Top 高阅读标题**');
  lines.push('');
  if (app.topArticles && app.topArticles.length) {
    app.topArticles.forEach((a, i) => lines.push(`${i + 1}. ${a.reads} 阅读（${a.pct}）· ${a.title}`));
  } else {
    lines.push('- 暂无 Top 数据');
  }
  lines.push('');
  lines.push('**渠道结构（本周）**');
  lines.push('');
  const ch = app.wrChannels || {};
  lines.push('| 渠道 | 占比 |');
  lines.push('|---|---|');
  Object.entries(ch).forEach(([k, v]) => lines.push(`| ${k} | ${v}% |`));
  lines.push('');

  // 四、诊断
  lines.push('## 四、诊断');
  lines.push('');
  lines.push(`整体：${app.diagnostics?.summary || '—'}`);
  lines.push('');
  (app.diagnostics?.findings || []).forEach(f => {
    const tag = { critical: '🔴', warning: '🟡', info: 'ℹ️' }[f.type] || '·';
    lines.push(`- ${tag} [${f.type}] ${f.title} — ${f.msg}`);
  });
  lines.push('');

  // 五、后续更新建议
  lines.push('## 五、后续更新建议');
  lines.push('');
  const recs = buildRecommendations(o, app.topArticles, w);
  recs.forEach(r => {
    lines.push(`### ${r.icon} ${r.title} \`${r.priority}\``);
    lines.push('');
    lines.push(r.text);
    lines.push('');
  });

  // 六、下周行动清单
  lines.push('## 六、下周行动清单');
  lines.push('');
  const actions = recs.filter(r => r.priority === 'high').slice(0, 3);
  if (actions.length) {
    actions.forEach((r, i) => lines.push(`${i + 1}. ${r.title}`));
  } else {
    lines.push('1. 保持日更节奏');
    lines.push('2. 持续跟踪粉丝与阅读趋势');
  }
  lines.push('');
  lines.push(`---\n*本周报由自动化流程生成 · 数据源: 本地 :${w.port || 3001}/api/app*`);
  return lines.join('\n');
}

// ─── 主流程 ──────────────────────────────────────────────
(async () => {
  const args = parseArgs();
  const w = resolveWindow(args.week);
  w.port = args.port;

  console.log(`=== 生成周度复盘 ${fmtDate(w.start)} ~ ${fmtDate(w.end)} ===`);

  let app;
  try {
    app = await fetchAppData(args.port);
  } catch (e) {
    // 本地服务没起则尝试拉起
    console.log('本地服务未响应，尝试拉起 node src/server.mjs ...');
    const { spawn } = require('child_process');
    const proc = spawn('node', ['src/server.mjs'], { cwd: path.join(ROOT, 'wechat-ops-center'), detached: true, stdio: 'ignore' });
    proc.unref();
    await new Promise(r => setTimeout(r, 4000));
    app = await fetchAppData(args.port);
  }

  fs.mkdirSync(REVIEW_DIR, { recursive: true });
  const endStr = fmtDate(w.end);
  const mdPath = path.join(REVIEW_DIR, `${endStr}.md`);
  const jsonPath = path.join(REVIEW_DIR, `${endStr}.json`);

  const md = buildMarkdown(app, w);
  fs.writeFileSync(mdPath, md, 'utf8');

  const recs = buildRecommendations(app.overview, app.topArticles, w);
  const structured = {
    record_type: 'weekly_review',
    generated_at: new Date().toISOString(),
    window: { begin: fmtDate(w.start), end: endStr },
    prev_window: { begin: fmtDate(w.prevStart), end: fmtDate(w.prevEnd) },
    overview: app.overview,
    recommendations: recs,
    markdown_path: mdPath,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(structured, null, 2), 'utf8');

  console.log(`✅ 周报已生成:\n  - ${mdPath}\n  - ${jsonPath}`);
  console.log(`   核心: 粉丝 ${app.overview.followers} / 30天读者 ${app.overview.totalReaders30d} / 待发布 ${app.overview.pendingDrafts}`);
  console.log(`   建议 ${recs.length} 条, 高优先 ${recs.filter(r => r.priority === 'high').length} 条`);

  if (args.push) {
    console.log('=== 推送到云端 (publish_cloud.ps1) ===');
    const { spawnSync } = require('child_process');
    const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PUBLISH_PS1], { cwd: path.join(ROOT, 'wechat-ops-center'), shell: process.platform === 'win32' });
    process.stdout.write(r.stdout?.toString() || '');
    process.stderr.write(r.stderr?.toString() || '');
    console.log(`推送退出码: ${r.status}`);
  }
})().catch(e => { console.error('❌', e); process.exit(1); });
