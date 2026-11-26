// 原生 @vercel/node handler（不用 next/server）
// 数据源：随部署打包的 data/appdata.json（本地 server.mjs 生成的全量快照）
import * as fs from 'fs';
import * as path from 'path';

const RAW_BASE = 'https://raw.githubusercontent.com/xiaomingtools/wechat-ops-center/main/data/appdata.json';

function readLocalAppData(): any | null {
  const cands = [
    path.join(process.cwd(), 'data', 'appdata.json'),
    path.join(process.cwd(), '..', 'data', 'appdata.json'),
    path.join(__dirname, '..', '..', 'data', 'appdata.json'),
    path.join(__dirname, 'data', 'appdata.json'),
    'E:/自动盈利系统/公众号运营中心/wechat-ops-center/data/appdata.json',
  ];
  for (const p of cands) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) { /* try next */ }
  }
  return null;
}

async function fetchRemoteAppData(): Promise<any | null> {
  try {
    const res = await fetch(RAW_BASE);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

async function loadAppData(): Promise<any | null> {
  return readLocalAppData() || (await fetchRemoteAppData());
}

function analyzeArticle(article: any, avgReads: number, ca30d: any) {
  const reasons: any[] = [];
  const suggestions: string[] = [];

  const reads = article.reads || 0;
  const shareRate = parseFloat((article.share || '').toString().replace('%', '')) || 0;

  if (reads < avgReads * 0.5) {
    reasons.push({ factor: '阅读量显著偏低', detail: `该文章阅读量仅 ${reads} 次，低于账号平均水平 (${avgReads} 次)`, severity: 'high' });
  } else if (reads < avgReads) {
    reasons.push({ factor: '阅读量略低于平均', detail: `阅读量 ${reads} 次，低于平均线 ${avgReads} 次`, severity: 'medium' });
  }

  if (shareRate < 5) {
    reasons.push({ factor: '分享率不足', detail: `分享率仅 ${shareRate}%，文章社交传播力较弱`, severity: 'medium' });
    suggestions.push('优化标题和开头，增强文章的社交货币属性');
  }

  const searchPct = ca30d?.search_pct || 0;
  if (searchPct < 25 && article.title) {
    reasons.push({ factor: '搜索流量占比低', detail: `目前搜一搜贡献 ${searchPct}% 流量，可通过优化关键词提升`, severity: 'low' });
    suggestions.push('在标题和正文中加入高频搜索词："怎么"、"方法"、"解决"、"教程"');
  }

  suggestions.push(
    '尝试周五晚 8 点或周六上午发布，这两个时段打开率较高',
    '文末添加"看完点赞+关注，明天见"引导语',
    '图片封面使用高对比度配色，提升点击率',
  );

  return {
    title: article.title,
    reads,
    shareRate,
    reasons,
    suggestions,
    status: '已完成分析',
    recommendedAction: readRecommendation(reads, avgReads, shareRate),
  };
}

function readRecommendation(reads: number, avg: number, shareRate: number): string {
  if (reads < avg * 0.3) return '需要重点优化：建议重写标题并调整发布时间';
  if (reads < avg * 0.7) return '值得改进：可尝试优化标题关键词和封面图';
  if (shareRate < 5) return '传播力不足：增加互动环节引导用户分享';
  return '表现良好：保持当前内容策略';
}

export async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }

  try {
    const body: any = req.method === 'POST' && req.body ? (req.body && req.body.length ? JSON.parse(req.body) : {}) : {};
    const { articleId, type = 'article' } = body;

    const appData = await loadAppData();
    if (!appData || !appData.overview) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: '数据未加载', detail: 'data/appdata.json 缺失' }));
      return;
    }

    // appdata 里 topArticles 已聚合（中文键），ca30d 指标在 overview 中
    const topArticles = appData.topArticles || [];
    const ca30d = {
      search_pct: appData.overview.searchPct || 0,
      recommend_pct: appData.overview.recommendPct || 0,
    };
    const avgReads = topArticles.length
      ? Math.round(topArticles.reduce((s: number, a: any) => s + (a.reads || 0), 0) / topArticles.length)
      : 0;

    if (type === 'article' && articleId) {
      const article = topArticles.find((a: any) => a.title === articleId) || topArticles[topArticles.length - 1];
      if (!article) { res.statusCode = 404; res.end(JSON.stringify({ error: '文章未找到' })); return; }
      const analysis = analyzeArticle(article, avgReads, ca30d);
      res.statusCode = 200;
      res.end(JSON.stringify({
        ...analysis,
        avgReads,
        allArticles: topArticles.map((a: any) => ({
          title: a.title, reads: a.reads, isLowTraffic: (a.reads || 0) < avgReads * 0.5,
        })),
      }));
      return;
    }

    const lowPerformers = topArticles
      .filter((a: any) => (a.reads || 0) < avgReads * 0.7)
      .sort((a: any, b: any) => (a.reads || 0) - (b.reads || 0))
      .slice(0, 5);
    const analyses = lowPerformers.map((a: any) => analyzeArticle(a, avgReads, ca30d));
    res.statusCode = 200;
    res.end(JSON.stringify({
      period: '本周', analyzedCount: analyses.length, avgReads, analyses, status: '已完成分析',
    }));
  } catch (error) {
    console.error('Analyze Error:', error);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: '分析失败' }));
  }
}

export default handler;
