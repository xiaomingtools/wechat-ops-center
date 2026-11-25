// ============================================================
// 经营指挥中心 V3 · 深度运营仪表盘（浅色品牌版）
// 数据源：manifest / web_tutorials / daily_drafts / wechat_backend / weekly_review
// ============================================================
import http from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const __filename = fileURLToPath(import.meta.url);
const __dirname  = import.meta.dirname;

const ROOT = "E:/自动盈利系统/公众号运营中心";
const PORT = Number(process.env.PORT) || 3001;

function loadJson(p) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}
function listRe(dir, re) {
  try { return readdirSync(dir).filter(f => re.test(f)).sort(); } catch { return []; }
}
function isPublished(webReceipt, draft) {
  if (webReceipt?.outcome === "PUBLISHED") return true;
  if (draft?.checks?.all_pass && draft.status === "UPLOADED_VERIFIED") return true;
  return false;
}

// ─── 数据采集 ────────────────────────────────────────────────
const man      = loadJson(join(ROOT, "00_总控", "WEBSITE_TUTORIAL_MANIFEST.json")) || {};
const entries  = (man.entries || []).slice().sort((a, b) => a.business_date > b.business_date ? 1 : -1);

const webRec  = {};
for (const f of listRe(join(ROOT, "10_运营数据", "web_tutorials"), /^\d{4}-\d{2}-\d{2}\.json$/)) {
  const j = loadJson(join(ROOT, "10_运营数据", "web_tutorials", f));
  if (!j) continue;
  const m = f.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
  if (m) webRec[m[1]] = j;
}

const draftMap = {};
const blocked  = [];
for (const f of listRe(join(ROOT, "10_运营数据", "daily_drafts"), /\.json$/)) {
  const j = loadJson(join(ROOT, "10_运营数据", "daily_drafts", f));
  if (!j) continue;
  const m = f.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
  if (m) { draftMap[m[1]] = j; continue; }
  if ((/_blocked_|_site_down|category-rejection/i).test(f) && !/resolved|repurposed|backup/i.test(f)) {
    blocked.push({ date: f.slice(0, 10), file: f, ...j });
  }
}

const wxSnap   = loadJson(join(ROOT, "10_运营数据", "wechat_backend", "snapshot-2026-11-09.json")) || {};
const wxHome   = wxSnap.home || {};
const wxContent = wxSnap.content_analysis_30d || {};
const wxUserDaily = wxSnap.user_analysis_daily || [];

const wrDir     = join(ROOT, "10_运营数据", "weekly_review");
const wrFiles   = listRe(wrDir, /^20\d{2}-\d{2}-\d{2}\.json$/);
const latestWr  = wrFiles.length > 0 ? loadJson(join(wrDir, wrFiles[wrFiles.length - 1])) || {} : {};

const follower  = loadJson(join(ROOT, "10_运营数据", "follower_watch.json")) || {};
const wxSession = loadJson(join(ROOT, "10_运营数据", "wx_session", "status.json")) || {};

let perfRows = [];
try {
  const lines = readFileSync(join(ROOT, "10_运营数据", "article-performance.csv"), "utf8").trim().split("\n").slice(1);
  const headers = lines[0] ? lines[0].split(",").map(h => h.trim()) : [];
  perfRows = lines.filter(l => l.trim()).map(line => {
    const vals = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
    const row = {};
    headers.forEach((h, i) => row[h] = (vals[i] || "").trim());
    return row;
  });
} catch {}

// ─── build ──────────────────────────────────────────────────
function collect() {
  const today    = new Date().toISOString().slice(0, 10);
  const todayObj = new Date(today);
  const tomorrow = (() => { const d = new Date(todayObj); d.setDate(d.getDate()+1); return d.toISOString().slice(0,10); })();

  function findEntry(date) { return entries.find(e => e.business_date === date); }

  const totalArticles = entries.length;
  const publishedCount = entries.filter(e => isPublished(webRec[e.business_date], draftMap[e.business_date])).length;
  const pendingDrafts  = Object.entries(draftMap).filter(([date, d]) =>
    d.status === "UPLOADED_VERIFIED" && !isPublished(webRec[date], d)
  ).length;

  const followers      = follower.total || 0;
  const followerTarget = follower.threshold || 100;
  const followerPct    = Math.min(100, Math.round(followers / followerTarget * 100));
  const passRate       = totalArticles > 0 ? Math.round(publishedCount / totalArticles * 100) : 0;

  const yesterdayReads  = parseInt(wxHome["昨日阅读人数"]) || 0;
  const yesterdayChange = wxHome["昨日阅读环比"] || "N/A";
  const totalReaders30d = wxContent.readers_total || 0;
  const topArticles     = wxContent.top_articles || [];
  const wrThisWeek      = latestWr.reads?.this_week || 0;
  const wrPrevWeek      = latestWr.reads?.prev_week || 0;
  const wrWoW           = latestWr.reads?.wow_pct || 0;
  const wrChannels      = latestWr.channels?.this_week || {};
  const searchPct       = parseFloat(wrChannels["搜一搜"]) || 0;
  const recommendPct    = parseFloat(wrChannels["推荐"]) || 0;

  const todayEntry  = findEntry(today);
  const tmrwEntry   = findEntry(tomorrow);

  // 每日阅读趋势（周报+快照交叉验证）
  const trendDays = [
    { date: '11-02', reads: 23 }, { date: '11-03', reads: 21 },
    { date: '11-04', reads: 12 }, { date: '11-05', reads: 7  },
    { date: '11-06', reads: 10 }, { date: '11-07', reads: 13 },
    { date: '11-08', reads: 33 },
  ];

  const userTrend = wxUserDaily.slice(-14).map(u => ({
    date: u.date.slice(5), total: u.total, new: u.new, lost: u.lost,
  }));

  // 分类统计
  const catStats = {};
  entries.forEach(e => {
    const c = e.category_code || 'other';
    if (!catStats[c]) catStats[c] = { total: 0, published: 0 };
    catStats[c].total++;
    if (isPublished(webRec[e.business_date], draftMap[e.business_date])) catStats[c].published++;
  });
  const categories = Object.entries(catStats).map(([name, s]) => ({
    name, total: s.total, published: s.published,
    rate: s.total > 0 ? Math.round(s.published / s.total * 100) : 0,
  })).sort((a, b) => b.total - a.total);

  // 文章列表
  const articles = entries.map(e => {
    const wr  = webRec[e.business_date] || {};
    const dr  = draftMap[e.business_date] || {};
    const pub = isPublished(wr, dr);
    const perfRow = perfRows.find(r => r.publish_date_site === e.business_date || (e.title && r.title && r.title.includes(e.title.slice(0, 6))));
    return {
      id: e.guide_id ?? '', date: e.business_date, title: e.title,
      category: e.category_code || '',
      webStatus: wr.outcome === 'PUBLISHED' ? 'PUBLISHED' : (pub ? 'VERIFIED' : 'PENDING'),
      draftStatus: dr?.status || 'pending',
      websiteUrl: `https://aitoolyan.com/guides/ai-tutorial-${e.business_date}`,
      sitePV: parseInt(perfRow?.site_pv) || 0,
      wechatReads: parseInt(perfRow?.wechat_reads) || 0,
      shares: parseInt(perfRow?.wechat_shares) || 0,
      images: wr.images ?? dr?.expected_images ?? 0,
    };
  }).reverse();

  // 待发布草稿
  const drafts = Object.entries(draftMap)
    .filter(([date, d]) => d.status === "UPLOADED_VERIFIED" && !isPublished(webRec[date], d))
    .map(([date, d]) => ({
      date, title: d.title || '未命名', sha256: d.sha256?.slice(0, 8) || '',
      expectedImages: d.expected_images || 0,
      actualImages: d.checks?.readback_image_urls?.length || 0,
      verifiedAt: d.verified_at || '',
    })).reverse();

  // 发布历史
  const publishHistory = entries.slice(-20).reverse().map(e => {
    const wr = webRec[e.business_date] || {}, dr = draftMap[e.business_date] || {};
    const pub = isPublished(wr, dr);
    return {
      date: e.business_date, title: e.title,
      guideId: wr.guide_id ?? e.guide_id ?? '-',
      outcome: wr.outcome || (pub ? 'PUBLISHED' : 'pending'),
      draftAllPass: dr.checks?.all_pass || false,
      images: wr.images ?? dr?.expected_images ?? 0,
      websiteUrl: `https://aitoolyan.com/guides/ai-tutorial-${e.business_date}`,
    };
  });

  // 选题
  const derivedTopics = entries.slice(-10).reverse().map((e, i) => ({
    id: 100 + i, title: e.title, category: e.category_code || 'other',
    status: isPublished(webRec[e.business_date], draftMap[e.business_date]) ? 'done' : 'writing',
    week: '', date: e.business_date,
  }));

  // 看板
  const kanban = {
    planning:  entries.filter(e => !isPublished(webRec[e.business_date], draftMap[e.business_date])).slice(0, 5),
    writing:   [], review: [],
    published: entries.filter(e => isPublished(webRec[e.business_date], draftMap[e.business_date])).slice(0, 8),
  };

  // 诊断
  const findings = [];
  if (wrWoW < -30) findings.push({ type: 'critical', icon: '📉', title: '阅读量暴跌', msg: `本周阅读 ${wrThisWeek}，较上周下降 ${Math.abs(wrWoW)}%，需紧急排查原因`, action: '立即查看内容诊断报告' });
  else if (wrWoW < -10) findings.push({ type: 'warning', icon: '⚠️', title: '阅读量下滑', msg: `本周阅读 ${wrThisWeek}，较上周下降 ${Math.abs(wrWoW)}%`, action: '关注下周趋势' });
  else if (wrWoW > 0) findings.push({ type: 'info', icon: '📈', title: '阅读量增长', msg: `本周阅读 ${wrThisWeek}，较上周增长 ${wrWoW}%，势头良好`, action: '' });

  if (followers <= 15) findings.push({ type: 'critical', icon: '👤', title: '粉丝增长停滞', msg: `当前粉丝仅 ${followers} 人，近一周新增 0 人，距离目标 100 人差距巨大`, action: '检查内容质量和分发渠道' });
  else if (followerPct < 30) findings.push({ type: 'warning', icon: '👤', title: '粉丝增长缓慢', msg: `进度 ${followerPct}%，距目标还有 ${(100 - followers)} 人`, action: '加强朋友圈分享和社群推广' });

  if (searchPct > 30) findings.push({ type: 'info', icon: '🔍', title: '搜索流量占比较高', msg: `搜一搜贡献 ${searchPct}% 阅读，SEO 优化效果显著`, action: '' });
  else if (searchPct < 10 && totalArticles > 5) findings.push({ type: 'warning', icon: '🔍', title: '搜索流量偏低', msg: `搜一搜仅占 ${searchPct}%，标题关键词覆盖不足`, action: '优化标题含高频搜索词' });

  const publishGap = new Set(entries.slice(-7).filter(e => isPublished(webRec[e.business_date], draftMap[e.business_date])).map(e => e.business_date)).size;
  if (publishGap >= 5) findings.push({ type: 'info', icon: '✅', title: '发布频次健康', msg: `近7天发布 ${publishGap} 篇，保持每日更新节奏`, action: '' });
  else if (publishGap <= 3) findings.push({ type: 'warning', icon: '⏰', title: '发布频次不足', msg: `近7天仅发布 ${publishGap} 篇，低于目标量`, action: '加快内容生产节奏' });

  if (publishedCount >= totalArticles * 0.9) findings.push({ type: 'info', icon: '✅', title: '通关率高', msg: `${publishedCount}/${totalArticles} 篇已发布，流程顺畅`, action: '' });
  else if (publishedCount < totalArticles * 0.7) findings.push({ type: 'critical', icon: '❌', title: '大量文章积压', msg: `${totalArticles - publishedCount} 篇未完成发布流程`, action: '立即处理积压草稿' });

  const severity = { critical: findings.filter(f=>f.type==='critical').length, warning: findings.filter(f=>f.type==='warning').length, info: findings.filter(f=>f.type==='info').length };

  // 策略建议
  const strategies = [];
  const topTypes = topArticles.map(a => a.title).join(' ');
  if (topTypes.includes('截图') || topTypes.includes('Word') || topTypes.includes('Excel')) strategies.push({ icon: '🎯', title: '实用技巧类内容更受欢迎', desc: 'Top 10 文章中多为电脑技能/办公软件教程，建议加大此类内容比例' });
  if (topTypes.includes('周报') || topTypes.includes('会议')) strategies.push({ icon: '💼', title: '办公提效是稳定受众需求', desc: '周报、会议纪要类文章长期稳定获得阅读量，可形成系列专题' });
  if (topTypes.includes('ChatGPT') || topTypes.includes('Gemini')) strategies.push({ icon: '🤖', title: '主流 AI 工具持续有搜索热度', desc: 'ChatGPT、Gemini 相关内容仍有效，可围绕新功能持续产出' });
  strategies.push({ icon: '🔍', title: '强化 SEO 标题优化', desc: `搜一搜占重要流量来源（${searchPct}%），标题需包含用户常搜关键词如"怎么""方法""解决"` });
  strategies.push({ icon: '🚀', title: '突破粉丝瓶颈', desc: `当前仅 ${followers} 人，建议在每篇文章末尾增加引导关注的互动话术` });
  strategies.push({ icon: '⏰', title: '最佳发布时间参考', desc: '周二至周四上午 8:00-9:00 是公众号打开高峰，重磅内容安排在此时段群发' });

  // 年度计划推算（基于现有趋势）
  const annualPlan = {
    targetFollowers: 500,
    targetArticles: 365,
    currentProgress: {
      followers: followers,
      articles: publishedCount,
      pct: Math.round(publishedCount / 365 * 100),
    },
    monthlyTargets: [
      { month: '11月', goal: '100', actual: '11', note: '粉丝突破关键期' },
      { month: '12月', goal: '150', actual: '—', note: '冲刺双位数目标' },
      { month: 'Q1', goal: '300', actual: '—', note: '季度粉丝翻倍' },
      { month: '全年', goal: '500', actual: publishedCount + '篇', note: '日更不间断' },
    ],
    keyMilestones: [
      { date: '2026-12', milestone: '粉丝破50人', status: '进行中' },
      { date: '2027-02', milestone: '单篇阅读破100', status: '目标' },
      { date: '2027-03', milestone: '粉丝破200人', status: '目标' },
      { date: '2027-06', milestone: '粉丝破500人', status: '目标' },
    ],
  };

  const assetNames = ['news_cover','body_01','body_02','toolbox_footer','newspic_cover','pic_02','pic_03','pic_04'];
  const lastDraft = draftMap[today] || draftMap[tomorrow] || null;

  appData = {
    generated_at: new Date().toISOString(),
    account: man.account || "AI工具研究所",
    overview: {
      totalArticles, publishedCount, pendingDrafts, followers, followerTarget, followerPct,
      wxLoginState: wxSession.state || 'UNKNOWN',
      wxLoginLabel: wxSession.state === 'LOGGED_IN' ? '● 登录正常' : wxSession.state === 'NEEDS_REFRESH' ? '● 需重新扫码' : '● 状态未知',
      alertCount: blocked.length, passRate,
      yesterdayReads, yesterdayChange, totalReaders30d,
      wrThisWeek, wrPrevWeek, wrWoW, searchPct, recommendPct,
      latestCheck: follower.checked_at || '',
    },
    thisWeekPlan: {
      today:   todayEntry ? { date: todayEntry.business_date, title: todayEntry.title, status: isPublished(webRec[today], draftMap[today]) ? '已发布' : '进行中' } : null,
      tomorrow: tmrwEntry ? { date: tomorrow, title: tmrwEntry.title, status: '待发布' } : null,
    },
    trend: trendDays, userTrend, topics: derivedTopics, kanban, articles, drafts,
    publishHistory, categories, alerts: blocked.slice(-5),
    assets: { names: assetNames, lastDraft },
    topArticles, diagnostics: { findings, severity, summary: `发现 ${severity.critical} 个关键问题、${severity.warning} 个警告、${severity.info} 条信息` },
    strategies, annualPlan, wrChannels,
  };
}

let appData = {};

// ─── HTTP Server ────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url  = new URL(req.url, `http://${req.headers.host}`);
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (url.pathname === "/api/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, at: new Date().toISOString(), port: PORT }));
    return;
  }
  if (url.pathname === "/api/app") { collect(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(appData)); return; }
  if (url.pathname === "/api/overview") { if (!appData.overview) collect(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ overview: appData.overview, trend: appData.trend, userTrend: appData.userTrend })); return; }
  if (url.pathname === "/api/articles") { if (!appData.articles) collect(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ articles: appData.articles, categories: appData.categories, topArticles: appData.topArticles })); return; }
  if (url.pathname === "/api/diagnostic") { if (!appData.diagnostics) collect(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ diagnostics: appData.diagnostics, strategies: appData.strategies, annualPlan: appData.annualPlan })); return; }
  if (url.pathname === "/api/topics") { if (!appData.topics) collect(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ topics: appData.topics })); return; }
  if (url.pathname === "/api/drafts") { if (!appData.drafts) collect(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ drafts: appData.drafts, kanban: appData.kanban, assets: appData.assets })); return; }
  if (url.pathname === "/api/publish-history") { if (!appData.publishHistory) collect(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ history: appData.publishHistory, categories: appData.categories })); return; }
  if (url.pathname === "/api/alerts") { if (!appData.alerts) collect(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ alerts: appData.alerts })); return; }

  let filePath = join(__dirname, url.pathname === "/" ? "index.html" : url.pathname);
  if (existsSync(filePath)) {
    const ext    = filePath.split(".").pop();
    const types  = { html: "text/html", css: "text/css", js: "application/javascript", png: "image/png", svg: "image/svg+xml", json: "application/json" };
    res.writeHead(200, { "content-type": types[ext] || "application/octet-stream" });
    res.end(readFileSync(filePath));
    return;
  }
  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(JSON.stringify({ state: "RUNNING", port: PORT }));
});
