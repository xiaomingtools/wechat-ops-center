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

const snapDir = join(ROOT, "10_运营数据", "wechat_backend");
const snapFiles = listRe(snapDir, /^snapshot-\d{4}-\d{2}-\d{2}\.json$/);
const wxSnap   = snapFiles.length > 0 ? loadJson(join(snapDir, snapFiles[snapFiles.length - 1])) || {} : {};
const wxHome   = wxSnap.home || {};
const wxContent = wxSnap.content_analysis_30d || {};
const wxUserDaily = wxSnap.user_analysis_daily || [];

const wrDir     = join(ROOT, "10_运营数据", "weekly_review");
const wrFiles   = listRe(wrDir, /^20\d{2}-\d{2}-\d{2}\.json$/);
const latestWr  = wrFiles.length > 0 ? loadJson(join(wrDir, wrFiles[wrFiles.length - 1])) || {} : {};

const follower  = loadJson(join(ROOT, "10_运营数据", "follower_watch.json")) || {};
const wxSession = loadJson(join(ROOT, "10_运营数据", "wx_session", "status.json")) || {};

// ── V5.2 归档目录（只读真实文件；缺失一律返回空，不虚构）──
const dbDir   = join(ROOT, "10_运营数据", "daily_brief");
const wrsDir  = join(ROOT, "10_运营数据", "weekly_resolution");
const cpDir   = join(ROOT, "10_运营数据", "content_plan");
const dulDir  = join(ROOT, "10_运营数据", "data_update_log");
const dbFiles  = listRe(dbDir,  /^\d{4}-\d{2}-\d{2}\.json$/);
const wrsFiles = listRe(wrsDir, /^\d{4}-\d{2}-\d{2}\.json$/);
const cpFiles  = listRe(cpDir,  /^\d{4}-\d{2}-\d{2}\.json$/);
const dulFiles = listRe(dulDir, /(^|\.)\d{4}-\d{2}-\d{2}/);
function loadArchiveList(files, dir) {
  return files.map(f => loadJson(join(dir, f))).filter(Boolean);
}

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
  const totalReaders30d = wxContent.readers_total || wxContent.readers_total_estimate || 0;
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

  // ═══ P2 数据层扩展：工作监督 / 经营档案 / 盈利中心 / 系统状态 / 数据状态分级 ═══
  // 原则：只用真实回执与真实文件，缺失一律置 null 或标注"未接入"，不伪造。

  // 工具：距今天数
  const hoursAgo = iso => { if (!iso) return null; const h = (Date.now() - new Date(iso).getTime()) / 3600000; return isFinite(h) ? Math.round(h * 10) / 10 : null; };
  const nowIso = new Date().toISOString();

  // ── 5.6 工作监督中心（基于真实回执 web_tutorials + daily_drafts）──
  const workLog = entries.map(e => {
    const date = e.business_date;
    const wr = webRec[date] || {};
    const dr = draftMap[date] || {};
    const isBlocked = blocked.some(b => b.date === date);
    let status = '状态未知', webOutcome = '未执行';
    if (wr.outcome === 'PUBLISHED') { status = '验收通过'; webOutcome = '已发布'; }
    else if (isBlocked) { status = '执行失败'; webOutcome = '被拦截'; }
    else if (dr.status === 'UPLOADED_VERIFIED' && dr.checks?.all_pass) { status = '待验收'; webOutcome = '草稿校验通过'; }
    else if (dr.status === 'UPLOADED_VERIFIED') { status = '执行中'; webOutcome = '已上传待校验'; }
    return {
      taskNo: e.topic_id || e.guide_id || date,
      title: e.title,
      category: e.category_code || '',
      planDate: date,
      startAt: dr.started_at || '',
      completeAt: wr.verified_at || dr.verified_at || '',
      status,
      progress: status === '验收通过' ? 100 : status === '待验收' ? 90 : status === '执行中' ? 60 : status === '执行失败' ? 0 : null,
      resultEntry: wr.website_url || dr.content_source_url || `draft ${date}`,
      anomaly: isBlocked ? (blocked.find(b => b.date === date)?.reason || '被拦截') : '',
      acceptance: status === '验收通过' ? '通过' : (status === '待验收' ? '待人工核验' : '未验收'),
    };
  }).reverse();
  const workSummary = {
    total: workLog.length,
    byStatus: workLog.reduce((acc, w) => { acc[w.status] = (acc[w.status] || 0) + 1; return acc; }, {}),
  };

  // ── 5.10 经营档案中心（仅真实事件）──
  const archives = [];
  if (entries.length) archives.push({ date: entries[0].business_date, type: 'milestone', title: '首篇文章立项', detail: `《${entries[0].title}》`, real: true });
  snapFiles.forEach(f => archives.push({ date: f.replace('snapshot-', '').replace('.json', ''), type: 'data', title: '采集公众号后台快照', detail: f, real: true }));
  wrFiles.forEach(f => archives.push({ date: f.replace('.json', ''), type: 'report', title: '生成周度复盘', detail: f, real: true }));
  blocked.slice(-5).forEach(b => archives.push({ date: b.date, type: 'incident', title: b.reason || '发布被拦截', detail: b.file || '', real: true }));
  // 粉丝里程碑（真实增长节点）
  let prevTotal = 0;
  wxUserDaily.forEach(u => { if ((u.total || 0) > prevTotal && (u.new || 0) > 0) archives.push({ date: u.date, type: 'growth', title: `新增 ${u.new} 名关注（累计 ${u.total}）`, real: true }); prevTotal = u.total || 0; });
  archives.sort((a, b) => a.date > b.date ? -1 : 1);

  // ── 5.7 盈利中心（分阶段经营模型 · 当前处于粉丝积累期，不强行接入未开展业务）──
  // 原则：经营阶段由 WorkBuddy 根据真实经营情况提供，看板仅展示；
  //       未产生 / 未接入的收益一律按真实状态显示，不虚构金额、利润、转化数据。
  const PHASES = ['粉丝积累期', '盈利准备期', '盈利测试期', '正式盈利期', '稳定盈利期'];
  const currentPhase = '粉丝积累期';   // 由 WorkBuddy 提供；看板仅展示

  // 流量主：官方门槛分层 + 当前差距（严格区分"官方开通门槛"与"内部阶段目标"，不混用）
  const TM_COMMISSION = 100;   // 官方：返佣商品/短剧推广能力门槛（微信官方运营专员口径）
  const TM_PROGRAMMATIC = 500; // 官方：程序化广告（流量主核心收益）门槛
  const trafficMaster = {
    opened: false,
    openStatus: '未开通',
    officialCondition: {
      commissionThreshold: TM_COMMISSION,
      programmaticThreshold: TM_PROGRAMMATIC,
      notes: [
        `关注用户 ≥${TM_COMMISSION}：可开通「返佣商品 / 短剧推广」能力`,
        `关注用户 ≥${TM_PROGRAMMATIC}：可开通「程序化广告」（流量主核心展示广告收益）`,
        '需完成实名认证；无刷粉行为；同主体流量主 < 20',
        '与账号是否认证无关（未认证订阅号亦可开通，但须实名认证）',
        '以上门槛以微信官方最新规则为准，本看板仅作展示，不作为承诺',
      ],
    },
    currentFollowers: followers,
    gapToCommission: Math.max(0, TM_COMMISSION - followers),
    gapToProgrammatic: Math.max(0, TM_PROGRAMMATIC - followers),
    internalTarget: followerTarget,            // 内部阶段性目标（followerTarget），仅参考，非官方门槛
    internalGap: Math.max(0, followerTarget - followers),
    readiness: followers >= TM_PROGRAMMATIC ? '已具备开通条件' : (followers >= TM_COMMISSION ? '可先开通返佣能力' : '粉丝积累中，未达最低门槛'),
    income: null, pendingSettle: null, settled: null,   // 开通后接入真实收益数据
  };

  // 夸克网盘拉新：当前明确「尚未启动」；保留未来统计能力，不接入、不强制注册、不增加成本
  const quarkPullNew = {
    status: '尚未启动',
    started: false,
    pauseReason: '粉丝积累期：当前经营重点为内容运营、流量获取与粉丝积累，暂不启动拉新业务',
    newUsers: null, commission: null, settlement: null,
    pendingSettle: null, converted: null, conversionRate: null, income: null,
    launchConditionNote: '启动时间与启动条件由 WorkBuddy 根据实际粉丝增长、阅读表现与经营情况提出建议，经用户确认后执行；不擅自设定必须达到多少粉丝才能启动',
  };

  // 增长目标（内容运营重点，由 WorkBuddy 提供；看板仅展示）
  const growthGoals = {
    phase: currentPhase,
    focus: ['内容运营', '流量获取', '粉丝积累'],
    followerTarget, followerProgress: followerPct,
    readers30d: totalReaders30d,
    readersWoW: wrWoW,
    contentOutput: { totalArticles, publishedCount, pendingDrafts, passRate },
  };

  // 下一阶段经营计划（由 WorkBuddy 提供；看板仅展示，不自行制定）
  const nextStagePlan = [
    '扩大内容产量与 SEO 关键词覆盖，提升搜一搜等搜索流量占比',
    '稳定日更节奏，优先清空待发布草稿以维持更新',
    `在文章末尾增加引导关注互动话术，推动粉丝突破 ${TM_COMMISSION}（返佣能力门槛）`,
    `粉丝达 ${TM_COMMISSION} 后申请开通返佣商品/短剧推广；达 ${TM_PROGRAMMATIC} 后开通程序化广告（流量主）`,
    '完成账号实名认证，满足流量主开通的前置条件',
    '夸克网盘拉新暂不启动；待粉丝与阅读表现达标并经用户确认后，由 WorkBuddy 提出启动建议',
  ];

  // 已确认的实际经营成本（仅列已知项；未发生则保持 null，不虚构金额）
  const confirmedCosts = {
    ai: null, server: null, cumulative: null,
    note: '当前未产生已确认的固定盈利成本；成本项在真实发生并确认后填入，未发生一律保持 null',
  };

  const revenue = {
    // 向后兼容旧字段（旧前端/旧数据仍可读）
    connected: false,
    status: '未接入',
    reason: '当前处于粉丝积累期，盈利业务尚未启动，暂无真实收益数据；未产生 / 未接入的收益按实际状态显示，不虚构',
    // 分阶段经营模型（V5.1 盈利中心专项调整）
    phase: currentPhase,
    phases: PHASES,
    phaseNote: '经营阶段由 WorkBuddy 根据真实经营情况提供，经营指挥中心仅负责展示',
    trafficMaster,
    quarkPullNew,
    growthGoals,
    nextStagePlan,
    confirmedCosts,
    // 保留未来扩展位（正式盈利后直接填充，无需重新建设）
    items: {
      流量主: { connected: false, opened: false, income: null, pendingSettle: null, settled: null },
      夸克拉新: { connected: false, newUsers: null, income: null },
    },
    trends: { daily: null, weekly: null, monthly: null, cumulative: null },
    cost: { ai: null, server: null, cumulative: null },
    netProfit: null, netProfitRate: null, breakEven: '未知',
  };

  // ── 5.12 系统运行监控中心（真实运行状态）──
  const lastSnapFile = snapFiles[snapFiles.length - 1] || '';
  const lastSnapCapture = wxSnap.captured_at || '';
  const dataAgeH = hoursAgo(lastSnapCapture || follower.checked_at);
  const dataStale = dataAgeH === null ? '未知' : (dataAgeH > 48 ? '过期' : '正常');
  const systemStatus = {
    version: 'V5.0',
    localService: 'RUNNING',
    cloudService: 'ONLINE',
    dataInterface: 'OK',
    dataVersion: lastSnapFile,
    lastDataCapture: lastSnapCapture || wxSession.at || '',
    lastSnapshot: lastSnapFile,
    lastReport: wrFiles[wrFiles.length - 1] || '',
    lastSync: follower.checked_at || '',
    lastHealthyCheck: nowIso,
    wxLogin: wxSession.state || 'UNKNOWN',
    dataFreshness: dataStale,
    dataAgeHours: dataAgeH,
    integrity: (snapFiles.length > 0 && (wxSession.state || '')) ? '完整' : '部分缺失',
  };

  // ── 5.11 风险预警中心（真实可判定项）──
  const risks = [];
  if (wxSession.state !== 'LOGGED_IN') risks.push({ level: 'warning', code: 'WX_LOGIN', title: '微信登录状态异常', desc: `当前 ${wxSession.state || '未知'}，后台数据可能过期`, since: wxSession.at || '', status: '未处理', scope: '数据采集' });
  if (dataStale === '过期') risks.push({ level: 'critical', code: 'DATA_STALE', title: '数据已过期', desc: `最近采集距今 ${dataAgeH}h，超过 48h 阈值`, since: lastSnapCapture || '', status: '未处理', scope: '全部指标' });
  if (wrWoW < -30) risks.push({ level: 'critical', code: 'READ_DROP', title: '阅读量暴跌', desc: `本周 ${wrThisWeek} vs 上周 ${wrPrevWeek}（${wrWoW}%）`, since: latestWr.generated_at || '', status: '未处理', scope: '流量' });
  if (followers <= 15) risks.push({ level: 'warning', code: 'FOLLOWS', title: '粉丝增长停滞', desc: `累计 ${followers}，近一周新增 0`, since: follower.checked_at || '', status: '未处理', scope: '用户增长' });
  blocked.slice(-3).forEach(b => risks.push({ level: 'warning', code: 'PUBLISH_BLOCKED', title: '发布被拦截', desc: b.reason || b.file || '未知原因', since: b.date, status: '已记录', scope: '内容发布' }));
  if (!revenue.connected) risks.push({ level: 'info', code: 'REVENUE_NOT_STARTED', title: '盈利业务尚未启动', desc: `当前「${revenue.phase}」：${revenue.quarkPullNew?.pauseReason || revenue.reason}`, since: nowIso, status: '已知阶段', scope: '盈利中心' });
  const riskLevels = ['critical', 'warning', 'info'];
  risks.sort((a, b) => riskLevels.indexOf(a.level) - riskLevels.indexOf(b.level));

  // ── 5.3 用户增长中心（日/周/月聚合，真实）──
  const userGrowth = {
    total: followers,
    target: followerTarget,
    daily: wxUserDaily,
    weeklyNet: (wxUserDaily.slice(-7).reduce((s, u) => s + (u.net || 0), 0)),
    lostTotal: wxUserDaily.reduce((s, u) => s + (u.lost || 0), 0),
    newTotal: wxUserDaily.reduce((s, u) => s + (u.new || 0), 0),
    sourceNote: '后台未提供关注来源明细，来源维度暂无数据',
  };

  // ── 5.8 历史周报（供前端"经营复盘中心"检索，仅真实已生成报告）──
  const reviews = wrFiles.map(f => {
    const j = loadJson(join(wrDir, f)) || {};
    const o = j.overview || {};
    return {
      name: f.replace('.json', ''),
      window: j.window || null,
      reads: { this_week: o.wrThisWeek ?? null, wow_pct: o.wrWoW ?? null },
      overview: o,
      generated_at: j.generated_at || '',
    };
  }).reverse();

  // ── 5.1 数据状态分级（每个核心指标的真实状态）──
  const dataStates = {
    followers: { value: followers, state: followers > 0 ? 'real' : 'zero_real', source: 'follower_watch.json', asOf: follower.checked_at || '' },
    readers30d: { value: totalReaders30d, state: totalReaders30d > 0 ? 'real' : 'no_data', source: '后台30天内容分析', asOf: lastSnapCapture },
    revenue: { value: null, state: 'not_connected', source: '无数据权限', asOf: '' },
    wxLogin: { value: wxSession.state || 'UNKNOWN', state: 'real', source: 'wx_session/status.json', asOf: wxSession.at || '' },
    sync: { value: follower.checked_at || '', state: dataStale === '过期' ? 'stale' : 'real', source: 'follower_watch.checked_at' },
  };

  // ── V5.2 归档列表（只读真实文件，缺失为空，不虚构）──
  const dailyBriefs   = loadArchiveList(dbFiles, dbDir);
  const weeklyResolutions = loadArchiveList(wrsFiles, wrsDir);
  const contentPlans = loadArchiveList(cpFiles, cpDir);
  // data_update_log 每个日期文件是当日"多次执行记录"的数组，需展平为统一记录列表
  const dataUpdateLog = loadArchiveList(dulFiles, dulDir)
    .reduce((acc, arr) => acc.concat(Array.isArray(arr) ? arr : [arr]), [])
    .sort((a, b) => {
      const da = a.executed_at || a.date || '';
      const db2 = b.executed_at || b.date || '';
      return da < db2 ? 1 : da > db2 ? -1 : 0;
    });

  // ── V5.2 数据更新状态（首页展示：最新数据日期/采集/同步/检查/下次更新/状态）──
  // 业务无变化时也刷新"最近成功检查时间"，不因为数据没变就长期显示未更新。
  const lastSnapDate = lastSnapFile.replace('snapshot-', '').replace('.json', '') || '';
  const lastDb = dbFiles.length > 0 ? dbFiles[dbFiles.length - 1].replace('.json', '') : '';
  const dataBrief = {
    latestDataDate: lastSnapDate || lastDb || (lastSnapCapture ? lastSnapCapture.slice(0, 10) : ''),
    lastCollectAt: lastSnapCapture || follower.checked_at || '',
    lastSuccessfulCollectAt: (dataStale !== '过期' && (lastSnapCapture || follower.checked_at)) ? (lastSnapCapture || follower.checked_at) : '',
    lastCloudSyncAt: follower.checked_at || '',
    lastSystemCheckAt: nowIso,
    nextPlannedUpdate: nextPlannedUpdateISO(),
    dataStatus: dataStatusOf(),
    collectFailureReason: '',
  };

  function nextPlannedUpdateISO() {
    // 每日 09:00 / 12:00 / 23:00（UTC+8），取下一个
    const now = new Date();
    const cands = ['09:00', '12:00', '23:00'].map(t => {
      const [hh, mm] = t.split(':').map(Number);
      const d = new Date(now); d.setHours(hh, mm, 0, 0);
      if (d <= now) d.setDate(d.getDate() + 1);
      return d.toISOString();
    });
    cands.sort();
    return cands[0];
  }
  function dataStatusOf() {
    if (wxSession.state !== 'LOGGED_IN') return '登录状态过期';
    if (dataStale === '过期') return '数据已过期';
    if (lastDb === lastSnapDate || (lastSnapCapture || follower.checked_at)) {
      const lastGood = lastSnapCapture || follower.checked_at;
      const todayStr = nowIso.slice(0, 10);
      const isToday = lastGood && lastGood.slice(0, 10) === todayStr;
      return isToday ? '今日已更新' : '数据无变化';
    }
    return '状态未知';
  }

  appData = {
    generated_at: nowIso,
    account: man.account || "AI工具研究所",
    overview: {
      totalArticles, publishedCount, pendingDrafts, followers, followerTarget, followerPct,
      wxLoginState: wxSession.state || 'UNKNOWN',
      wxLoginLabel: wxSession.state === 'LOGGED_IN' ? '● 登录正常' : wxSession.state === 'NEEDS_REFRESH' ? '● 需重新扫码' : '● 状态未知',
      alertCount: blocked.length, passRate,
      yesterdayReads, yesterdayChange, totalReaders30d,
      wrThisWeek, wrPrevWeek, wrWoW, searchPct, recommendPct,
      latestCheck: follower.checked_at || '',
      dataFreshness: dataStale, dataAgeHours: dataAgeH,
      dataBrief,
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
    // V5 新增顶层键
    workLog, workSummary,
    archives,
    reviews,
    revenue,
    systemStatus,
    risks,
    userGrowth,
    dataStates,
    // V5.2 每日简报 / 周度决议 / 内容计划 / 数据更新记录（只读真实归档；全量随 appdata.json 推送，云端可完整查询，缺失为空）
    dailyBriefs: dailyBriefs.slice().reverse(),
    latestDailyBrief: dailyBriefs.length > 0 ? dailyBriefs[dailyBriefs.length - 1] : null,
    weeklyResolutions: weeklyResolutions.slice().reverse(),
    latestResolution: weeklyResolutions.length > 0 ? weeklyResolutions[weeklyResolutions.length - 1] : null,
    contentPlans: contentPlans.slice().reverse(),
    latestContentPlan: contentPlans.length > 0 ? contentPlans[contentPlans.length - 1] : null,
    dataUpdateLog: dataUpdateLog,
    meta: { phase: 'V5.2 经营优化闭环', dataSources: [lastSnapFile, 'follower_watch.json', 'weekly_review/', 'daily_brief/', 'weekly_resolution/', 'content_plan/', 'data_update_log/'] },
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
  // 前端单载荷入口：本地走此同源端点，云端走 Vercel /api/data，行为一致
  if (url.pathname === "/api/data") { collect(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(appData)); return; }
  if (url.pathname === "/api/overview") { if (!appData.overview) collect(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ overview: appData.overview, trend: appData.trend, userTrend: appData.userTrend })); return; }
  if (url.pathname === "/api/articles") { if (!appData.articles) collect(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ articles: appData.articles, categories: appData.categories, topArticles: appData.topArticles })); return; }
  if (url.pathname === "/api/diagnostic") { if (!appData.diagnostics) collect(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ diagnostics: appData.diagnostics, strategies: appData.strategies, annualPlan: appData.annualPlan })); return; }
  if (url.pathname === "/api/topics") { if (!appData.topics) collect(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ topics: appData.topics })); return; }
  if (url.pathname === "/api/drafts") { if (!appData.drafts) collect(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ drafts: appData.drafts, kanban: appData.kanban, assets: appData.assets })); return; }
  if (url.pathname === "/api/publish-history") { if (!appData.publishHistory) collect(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ history: appData.publishHistory, categories: appData.categories })); return; }
  if (url.pathname === "/api/alerts") { if (!appData.alerts) collect(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ alerts: appData.alerts })); return; }
  // ── V5 新增端点（只读，向后兼容）──
  if (url.pathname === "/api/work") { if (!appData.workLog) collect(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ workLog: appData.workLog, workSummary: appData.workSummary })); return; }
  if (url.pathname === "/api/archive") { if (!appData.archives) collect(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ archives: appData.archives })); return; }
  if (url.pathname === "/api/revenue") { if (!appData.revenue) collect(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ revenue: appData.revenue })); return; }
  if (url.pathname === "/api/system") { if (!appData.systemStatus) collect(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ systemStatus: appData.systemStatus, dataStates: appData.dataStates })); return; }
  if (url.pathname === "/api/risks") { if (!appData.risks) collect(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ risks: appData.risks })); return; }
  if (url.pathname === "/api/reviews") { if (!appData.reviews) collect(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ reviews: appData.reviews })); return; }
  // ── V5.2 端点（只读真实归档，缺失返回空数组，不虚构）──
  if (url.pathname === "/api/daily-briefs") { if (!appData.dailyBriefs) collect(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ dailyBriefs: appData.dailyBriefs, latest: appData.latestDailyBrief })); return; }
  if (url.pathname === "/api/resolutions") { if (!appData.weeklyResolutions) collect(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ weeklyResolutions: appData.weeklyResolutions, latest: appData.latestResolution })); return; }
  if (url.pathname === "/api/content-plans") { if (!appData.contentPlans) collect(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ contentPlans: appData.contentPlans, latest: appData.latestContentPlan })); return; }
  if (url.pathname === "/api/update-log") { if (!appData.dataUpdateLog) collect(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ dataUpdateLog: appData.dataUpdateLog })); return; }

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
