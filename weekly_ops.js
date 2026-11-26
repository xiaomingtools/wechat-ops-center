#!/usr/bin/env node
// ============================================================
//  周度运营闭环生成器 (weekly_ops.js)
//  复用 weekly_review.js 数据源（本地 :3001/api/app，兜底 data/appdata.json）
//  生成三类独立归档（不覆盖历史）：
//    ① 下周运营改动决议  10_运营数据/weekly_resolution/YYYY-MM-DD.json + .md
//    ② 下周内容更新计划  10_运营数据/content_plan/YYYY-MM-DD.json
//    ③ 上周决议执行验收  （写入本期决议的 last_week_acceptance 字段）
//
//  用法:
//    node weekly_ops.js              # 生成最近一个自然周(周一~周日)的决议+内容计划
//    node weekly_ops.js --push       # 生成 + 推云端
//    node weekly_ops.js --week 2026-11-30   # 指定窗口结束日(周日)
//    node weekly_ops.js --port 3001
//
//  原则:
//   - 决议按"继续保持/重点调整/停止执行/新增尝试"四类，每条含完整字段(§5)
//   - 内容计划周一~周日候选选题，关联决议编号(§6)
//   - 上周决议逐条验收，证据不足标记"证据不足/待验证"，不虚构(§4.4/§8)
//   - 决议状态: 待执行/执行中/已执行/待验证/验证有效/验证无效/证据不足/已调整/已停止
//   - 粉丝积累期: 不以盈利金额为主考核，重点阅读/粉丝净增/搜索/推荐/长期价值内容
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = 'E:/自动盈利系统/公众号运营中心';
const RES_DIR = path.join(ROOT, '10_运营数据', 'weekly_resolution');
const PLAN_DIR = path.join(ROOT, '10_运营数据', 'content_plan');
const PUBLISH_PS1 = path.join(ROOT, 'wechat-ops-center', 'publish_cloud.ps1');

const p2 = n => String(n).padStart(2, '0');
const fmtDate = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
function isoWeekStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return x; }

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

function resolveWindow(weekArg) {
  let end;
  if (weekArg) end = new Date(weekArg + 'T00:00:00');
  else {
    const now = new Date();
    const ws = isoWeekStart(now);
    const thisSun = new Date(ws); thisSun.setDate(ws.getDate() + 6);
    if (now < thisSun) { const e = new Date(thisSun); e.setDate(e.getDate() - 7); end = e; }
    else end = thisSun;
  }
  const start = new Date(end); start.setDate(end.getDate() - 6);
  return { start, end, startStr: fmtDate(start), endStr: fmtDate(end) };
}

async function fetchAppData(port) {
  try {
    const res = await fetch(`http://localhost:${port}/api/app`);
    if (!res.ok) throw new Error(`本地服务返回 ${res.status}`);
    return await res.json();
  } catch (e) {
    console.log('本地 :3001 未响应，回退 data/appdata.json ...');
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'wechat-ops-center', 'data', 'appdata.json'), 'utf8'));
  }
}

// 读上一期决议(用于执行验收)
function loadLastResolution(endStr) {
  const files = fs.existsSync(RES_DIR) ? fs.readdirSync(RES_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() : [];
  const prior = files.filter(f => f.replace('.json', '') < endStr).reverse();
  if (!prior.length) return null;
  try { return JSON.parse(fs.readFileSync(path.join(RES_DIR, prior[0]), 'utf8')); } catch { return null; }
}

const STATUS = { PENDING: '待执行', RUNNING: '执行中', DONE: '已执行', VERIFYING: '待验证', VALID: '验证有效', INVALID: '验证无效', INSUFFICIENT: '证据不足', ADJUSTED: '已调整', STOPPED: '已停止' };

// 验收: 逐条核验上期决议
function acceptLastResolutions(lastRes, app) {
  if (!lastRes || !Array.isArray(lastRes.resolutions) || !lastRes.resolutions.length) {
    return { available: false, note: '无上一期决议可验收(首期或历史缺失)', items: [] };
  }
  const o = app.overview || {};
  const topTitles = (app.topArticles || []).map(a => a.title).join(' ');
  const items = lastRes.resolutions.map(r => {
    let verdict = '证据不足', detail = '缺少可追溯效果数据，需继续观察', expectedMet = false;
    const kw = (r.keywords || []).join(' ');
    if (r.category === '继续保持' && kw && topTitles.includes(kw.slice(0, 4))) {
      verdict = '验证有效'; detail = `相关选题「${kw.slice(0, 8)}」仍出现在近30天高阅读榜，方向有效`; expectedMet = true;
    } else if (r.acceptanceMetric && /粉丝|进度/.test(r.acceptanceMetric)) {
      verdict = o.followerPct > (lastRes.overview?.followerPct || 0) ? '验证有效' : '证据不足';
      detail = `粉丝进度 ${lastRes.overview?.followerPct ?? '?'}% → ${o.followerPct ?? '?'}%(变化有限，暂不下定论)`;
      expectedMet = verdict === '验证有效';
    } else if (r.acceptanceMetric && /搜一搜/.test(r.acceptanceMetric)) {
      verdict = (o.searchPct || 0) > (lastRes.overview?.searchPct || 0) ? '验证有效' : '证据不足';
      detail = `搜一搜 ${lastRes.overview?.searchPct ?? '?'}% → ${o.searchPct ?? '?'}%`;
    } else if (r.acceptanceMetric && /草稿/.test(r.acceptanceMetric)) {
      verdict = (o.pendingDrafts ?? 99) <= 2 ? '验证有效' : '待验证';
      detail = `待发布草稿 ${o.pendingDrafts ?? '?'} 篇`;
    } else {
      verdict = '证据不足'; detail = '该决议验收指标当前无直接对应数据，标记为待验证假设';
    }
    return { resolutionNo: r.no, name: r.name, category: r.category, priorStatus: r.status, verdict, detail, expectedMet, continued: verdict === '验证有效', adjustOrStop: verdict === '验证无效' ? '建议调整或停止' : '保持' };
  });
  return { available: true, period: lastRes.period, note: `验收上期 ${lastRes.period} 共 ${items.length} 条决议`, items };
}

// 本期决议(四类，数据驱动)
function buildResolutions(app, w) {
  const o = app.overview || {};
  const cats = app.categories || [];
  const topTitles = (app.topArticles || []).map(a => a.title).join(' ');
  const recs = [];
  let no = 0;
  const push = ob => { ob.no = 'R' + String(++no).padStart(2, '0'); ob.status = STATUS.PENDING; recs.push(ob); };

  const topCats = cats.filter(c => c.published > 0 && c.rate >= 80).slice(0, 3);
  const hit = ['周报', 'PPT', 'Word', 'Excel', '截图', 'ChatGPT'].filter(k => topTitles.includes(k));
  if (topCats.length || hit.length) {
    push({
      name: '保持已验证高表现内容方向', category: '继续保持',
      problem: '需持续放大已验证有效的内容方向，避免流量下滑',
      evidence: `近30天 Top 高阅读集中于 ${hit.slice(0, 3).join('、') || topCats.map(c => c.name).join('、') || '—'}；高通关分类 ${topCats.map(c => `${c.name}(${c.rate}%)`).join('、') || '—'}`,
      before: '选题方向分散', after: `锁定 ${hit.slice(0, 3).join('、') || '高通关分类'} 系列专题，稳定产出`,
      action: `每周保留 ${Math.max(2, Math.round(cats.length * 0.4))} 篇命中上述方向的选题`,
      expectedEffect: '提升搜索流量与持续阅读价值', timing: `下周 ${w.startStr}~${w.endStr}`, priority: 'high',
      acceptanceMetric: '该方向文章进入近30天 Top5 或搜索占比提升', keywords: [...hit, ...topCats.map(c => c.name)],
    });
  }
  if ((o.searchPct || 0) < 30) {
    push({
      name: '标题 SEO 强化，拉高搜一搜占比', category: '重点调整',
      problem: `搜一搜占 ${o.searchPct ?? 0}%，搜索流量不足`,
      evidence: `当前搜一搜 ${o.searchPct ?? 0}% / 推荐 ${o.recommendPct ?? 0}%(近一周渠道统计)`,
      before: '标题偏描述型，缺少高频搜索词', after: '标题统一嵌入"怎么/方法/教程/解决/下载"等高频词',
      action: '每篇发布前过一遍关键词 checklist，至少 1 个高频搜索词',
      expectedEffect: '搜一搜占比提升，搜索流量增长', timing: `下周 ${w.startStr}~${w.endStr}`, priority: 'high',
      acceptanceMetric: '搜一搜占比由 ' + (o.searchPct ?? 0) + '% 提升至 30%+', keywords: ['搜一搜', '关键词'],
    });
  }
  if (o.followerPct < 30) {
    push({
      name: '粉丝增长引导优化', category: '重点调整',
      problem: `粉丝 ${o.followers}，进度 ${o.followerPct}%，距目标 ${o.followerTarget || 100} 还差 ${Math.max(0, (o.followerTarget || 100) - (o.followers || 0))}`,
      evidence: `累计 ${o.followers}，本周净增 ${app.userGrowth?.weeklyNet ?? '未知'}`,
      before: '缺少固定引导关注话术', after: '每篇末尾加"关注看明天更新"+ 朋友圈/社群 1 次转发',
      action: '固定引导话术模板化，配合 1 次社群扩散',
      expectedEffect: '粉丝净增长转正，加速逼近 100(流量主返佣门槛)', timing: `下周 ${w.startStr}~${w.endStr}`, priority: 'high',
      acceptanceMetric: '粉丝进度由 ' + o.followerPct + '% 提升', keywords: ['粉丝', '引导关注'],
    });
  }
  if ((o.pendingDrafts ?? 0) > 0) {
    push({
      name: '清理积压待发布草稿', category: '重点调整',
      problem: `${o.pendingDrafts} 篇草稿积压，影响日更节奏`,
      evidence: `待发布 ${o.pendingDrafts} 篇 / 通关率 ${o.passRate}%`,
      before: '积压草稿未优先处理', after: '优先清空积压，恢复日更',
      action: '本周内清空待发布草稿', expectedEffect: '维持日更，减少发布延迟', timing: `下周前 3 天`, priority: 'medium',
      acceptanceMetric: '待发布草稿 ≤ 2 篇', keywords: ['草稿', '积压'],
    });
  }
  push({
    name: '测试"常青工具教程"长尾选题', category: '新增尝试',
    problem: '当前内容偏热点，缺乏长期流量价值积累',
    evidence: `近30天累计 ${o.totalReaders30d ?? '未知'} 读者；Top 含工具类(${hit.slice(0, 2).join('、') || '待验证'})`,
    before: '以日更热点为主', after: '每周 1~2 篇常青工具教程(搜索长尾)',
    action: '选 1 个高频搜索工具主题做深度教程', expectedEffect: '积累可持续搜索流量，降低推荐流依赖',
    timing: `下周 ${w.endStr} 前上线 1 篇`, priority: 'medium',
    acceptanceMetric: '该篇发布 7 天搜索来源阅读 > 推荐来源', keywords: ['长尾', '工具教程'],
  });
  if (!recs.length) {
    push({
      name: '维持当前内容节奏', category: '继续保持',
      problem: '本周无明显经营异常',
      evidence: `粉丝 ${o.followers} / 30天读者 ${o.totalReaders30d} / 通关率 ${o.passRate}%`,
      before: '—', after: '维持日更与现有选题方向', action: '保持现状并跟踪指标',
      expectedEffect: '稳定经营，观察趋势', timing: `下周 ${w.startStr}~${w.endStr}`, priority: 'info',
      acceptanceMetric: '各项指标无显著下滑', keywords: [],
    });
  }
  return recs;
}

// 下周内容计划(周一~周日，关联决议编号)
function buildContentPlan(app, w, resolutions) {
  const o = app.overview || {};
  const keep = resolutions.find(r => r.category === '继续保持');
  const seo = resolutions.find(r => r.category === '重点调整' && r.name.includes('SEO'));
  const evergreen = resolutions.find(r => r.category === '新增尝试');
  const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const base = keep ? keep.keywords.slice(0, 2) : ['实用工具', '办公提效'];
  const schedule = days.map((d, i) => {
    let topic, title, basis, req, diff, resRef;
    if (i === 6 && evergreen) { topic = '常青工具教程'; title = `${base[0] || '工具'} 完整教程：从入门到高效使用(长尾搜索)`; basis = '长尾搜索流量，发布后 7 天仍有效'; req = '高频搜索工具用户'; diff = '深度 + 步骤截图，非热点'; resRef = evergreen.no; }
    else if (seo) { topic = base[i % base.length] || 'SEO 选题'; title = `怎么 / 如何用 ${base[i % base.length] || '工具'} 解决常见问题的方法`; basis = '标题含高频搜索词，目标提升搜一搜占比'; req = '搜索该功能的用户'; diff = '标题 SEO 化 + 解决导向'; resRef = seo.no; }
    else { topic = base[i % base.length] || '日常选题'; title = `${base[i % base.length] || '工具'} 实用技巧(${i + 1})`; basis = '已验证高表现方向'; req = '工具使用用户'; diff = '结合实测截图'; resRef = keep?.no || '—'; }
    return { day: d, topic, title, basis, userNeed: req, differentiation: diff, planPublishTime: '周二~周四 08:00-09:00', verifyMetric: '发布 24h 阅读 ≥ 周均', resolutionRef: resRef };
  });
  return {
    coreDirection: base.join('、'),
    focusCategories: [keep?.name || '已验证高表现内容'],
    reduceCategories: o.searchPct < 30 ? ['低搜索命中的泛热点'] : [],
    pauseCategories: [],
    newTestCategories: evergreen ? [evergreen.name] : [],
    ratios: { 重点: '50%', 日常: '30%', 新增测试: '20%' },
    schedule,
  };
}

(async () => {
  const args = parseArgs();
  const w = { ...resolveWindow(args.week), port: args.port, push: args.push };
  console.log(`=== 生成周度运营决议 + 内容计划 ${w.startStr} ~ ${w.endStr} ===`);

  let app;
  try { app = await fetchAppData(w.port); }
  catch (e) { console.error('❌ 数据获取失败：' + e.message); process.exit(1); }

  const lastRes = loadLastResolution(w.endStr);
  const acceptance = acceptLastResolutions(lastRes, app);
  const resolutions = buildResolutions(app, w);
  const plan = buildContentPlan(app, w, resolutions);

  fs.mkdirSync(RES_DIR, { recursive: true });
  fs.mkdirSync(PLAN_DIR, { recursive: true });

  const nextPeriod = fmtDate((() => { const d = new Date(w.end); d.setDate(d.getDate() + 7); return d; })());
  const resPayload = {
    record_type: 'weekly_resolution',
    period: `${w.startStr} ~ ${w.endStr}`,
    next_period: nextPeriod,
    generated_at: new Date().toISOString(),
    data_cutoff: app.overview?.latestCheck || '',
    status_note: '决议状态由 WorkBuddy 实际执行记录提供；证据不足项标记为待验证',
    phase: app.revenue?.phase || '粉丝积累期',
    last_week_acceptance: acceptance,
    resolutions,
    markdown_path: path.join(RES_DIR, `${w.endStr}.md`),
  };
  const resJsonPath = path.join(RES_DIR, `${w.endStr}.json`);
  fs.writeFileSync(resJsonPath, JSON.stringify(resPayload, null, 2), 'utf8');

  const catName = { 继续保持: '✅ 继续保持', 重点调整: '🔧 重点调整', 停止执行: '⛔ 停止执行', 新增尝试: '🧪 新增尝试' };
  let md = `# 下周运营改动决议 ${nextPeriod}\n\n> 本期数据截至 ${resPayload.data_cutoff} · 经营阶段 ${resPayload.phase} · 生成于 ${new Date().toLocaleString('zh-CN')}\n\n`;
  md += `## 上周决议执行验收\n\n`;
  if (acceptance.available) {
    md += `${acceptance.note}（${acceptance.period}）\n\n| 编号 | 决议 | 验收结果 | 说明 | 结论 |\n|---|---|---|---|---|\n`;
    acceptance.items.forEach(it => { md += `| ${it.resolutionNo} | ${it.name} | ${it.verdict} | ${it.detail} | ${it.continued ? '继续' : it.adjustOrStop} |\n`; });
  } else md += `${acceptance.note}\n`;
  md += '\n';
  ['继续保持', '重点调整', '停止执行', '新增尝试'].forEach(cat => {
    const items = resolutions.filter(r => r.category === cat);
    if (!items.length) return;
    md += `## ${catName[cat]}\n\n`;
    items.forEach(r => {
      md += `### ${r.no} ${r.name}（优先级 ${r.priority}）\n\n`;
      md += `- 当前问题：${r.problem}\n- 数据依据：${r.evidence}\n- 调整前：${r.before}\n- 调整后：${r.after}\n- 执行要求：${r.action}\n- 预期效果：${r.expectedEffect}\n- 执行时间：${r.timing}\n- 验收指标：${r.acceptanceMetric}\n- 状态：${r.status}\n\n`;
    });
  });
  md += `---\n*由 WorkBuddy 制定，经营指挥中心仅展示；未执行/证据不足项标记为待验证，不虚构效果*\n`;
  fs.writeFileSync(resPayload.markdown_path, md, 'utf8');

  const planPayload = {
    record_type: 'content_plan',
    for_period: nextPeriod,
    based_on_resolution: w.endStr,
    generated_at: new Date().toISOString(),
    data_cutoff: app.overview?.latestCheck || '',
    plan,
  };
  const planJsonPath = path.join(PLAN_DIR, `${w.endStr}.json`);
  fs.writeFileSync(planJsonPath, JSON.stringify(planPayload, null, 2), 'utf8');

  console.log(`✅ 运营决议: ${resJsonPath}\n   (${resolutions.length} 条 · 验收${acceptance.available ? acceptance.items.length + '条上期' : '无'})`);
  console.log(`✅ 内容计划: ${planJsonPath}\n   (周一~周日 ${plan.schedule.length} 天 · 核心 ${plan.coreDirection})`);

  if (args.push) {
    console.log('=== 推送到云端 (publish_cloud.ps1) ===');
    const { spawnSync } = require('child_process');
    const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PUBLISH_PS1], { cwd: path.join(ROOT, 'wechat-ops-center'), shell: process.platform === 'win32' });
    process.stdout.write(r.stdout?.toString() || '');
    process.stderr.write(r.stderr?.toString() || '');
    console.log(`推送退出码: ${r.status}`);
  }
})().catch(e => { console.error('❌', e); process.exit(1); });
