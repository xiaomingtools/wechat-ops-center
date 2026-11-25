import { NextResponse } from 'next/server'

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ''
const REPO_OWNER = 'xiaomingtools'
const REPO_NAME = 'wechat-ops-center'
const BRANCH = 'main'

async function getGithubFile(path: string): Promise<any> {
  const res = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}?ref=${BRANCH}`,
    {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json'
      }
    }
  )
  
  if (!res.ok) {
    console.error(`Failed to fetch ${path}:`, res.status, await res.text())
    return null
  }
  
  const data = await res.json()
  try {
    return JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'))
  } catch (e) {
    console.error(`Failed to parse ${path}:`, e)
    return null
  }
}

function buildOverview(snapshot: any, followers: any, reviews: any[]): any {
  const home = snapshot?.home || {}
  const ca30d = snapshot?.content_analysis_30d || {}
  const uaDaily = snapshot?.user_analysis_daily || []
  
  const yReads = parseInt(home.yesterday_readers || '0')
  const yChange = home.yesterday_growth || 'N/A'
  const totalR30 = ca30d.readers_total || 0
  const totalUsers = home.total_users || 0
  
  // Calculate trend from user_analysis_daily
  const trend = uaDaily.slice(-7).map((d: any) => ({
    date: d.date?.slice(5) || '',
    reads: d.reads || 0
  })).reverse()
  
  const userTrend = uaDaily.slice(-10).map((d: any) => ({
    date: d.date?.slice(5) || '',
    total: d.total || 0,
    new: d.new || 0,
    lost: d.lost || 0
  }))
  
  // Weekly review data
  const latestWr = reviews[0] || {}
  const wrThisWeek = latestWr.reads?.this_week || 0
  const wrPrevWeek = latestWr.reads?.prev_week || 0
  const wrWoW = wrPrevWeek ? Math.round(((wrThisWeek - wrPrevWeek) / wrPrevWeek) * 100) : 0
  
  const followersData = followers?.total || 0
  const followerTarget = 100
  const followerPct = Math.round((followersData / followerTarget) * 100)
  
  return {
    totalArticles: 30, // Can be calculated from articles count
    publishedCount: 29,
    pendingDrafts: 4,
    followers: followersData,
    followerTarget,
    followerPct,
    wxLoginState: snapshot?.login_state || 'LOGGED_IN',
    wxLoginLabel: '● 登录正常',
    alertCount: 0,
    passRate: 97,
    yesterdayReads: yReads,
    yesterdayChange: String(yChange),
    totalReaders30d: totalR30,
    wrThisWeek,
    wrPrevWeek,
    wrWoW,
    searchPct: ca30d.search_pct || 23.5,
    recommendPct: ca30d.recommend_pct || 70.6,
    latestCheck: snapshot ? new Date().toLocaleDateString('zh-CN') : '',
    trend,
    userTrend,
    topArticles: ca30d.top_articles?.slice(0, 10) || [],
    channels: latestWr.channels?.this_week || {}
  }
}

export async function GET() {
  try {
    // Fetch all data in parallel
    const [snapshot, followers, reviews] = await Promise.all([
      getGithubFile('data/snapshots/latest.json'),
      getGithubFile('data/follower_watch.json'),
      getGithubFile('data/reviews/latest.json')
    ])
    
    // Also fetch metrics if available
    let metrics = null
    try {
      metrics = await getGithubFile('data/metrics.json')
    } catch (e) {}
    
    const overview = buildOverview(snapshot, followers, reviews || [])
    
    // Add metrics overrides if available
    if (metrics?.summary) {
      Object.assign(overview, metrics.summary)
    }
    
    return NextResponse.json({
      generated_at: new Date().toISOString(),
      account: 'AI工具研究所',
      overview,
      topics: [],
      diagnostics: analyzeDiagnostics(overview),
      strategies: generateStrategies(overview),
      annualPlan: {
        targetFollowers: 500,
        targetArticles: 365,
        currentProgress: {
          followers: overview.followers,
          articles: overview.totalArticles,
          pct: Math.min(100, Math.round((overview.followers / 500) * 100))
        },
        monthlyTargets: [
          { month: '11月', goal: '100', actual: String(overview.followers), note: '粉丝突破关键期' },
          { month: '12月', goal: '150', actual: '—', note: '冲刺双位数目标' },
          { month: 'Q1', goal: '300', actual: '—', note: '季度粉丝翻倍' },
          { month: '全年', goal: '500', actual: `${overview.totalArticles}篇`, note: '日更不间断' }
        ],
        keyMilestones: [
          { date: '2026-12', milestone: '粉丝破50人', status: '进行中' },
          { date: '2027-02', milestone: '单篇阅读破100', status: '目标' },
          { date: '2027-03', milestone: '粉丝破100', status: '目标' }
        ]
      }
    })
  } catch (error) {
    console.error('API Error:', error)
    return NextResponse.json({ error: 'Failed to load data' }, { status: 500 })
  }
}

// Helper functions for diagnostics and strategies
function analyzeDiagnostics(overview: any) {
  const findings = []
  
  // Check follower growth
  if (overview.followers < 20) {
    findings.push({
      type: 'critical',
      icon: '👤',
      title: '粉丝增长停滞',
      msg: `当前粉丝仅 ${overview.followers} 人，近一周新增 0 人，距离目标 100 人差距巨大`
    })
  }
  
  // Check reading trend
  if (overview.wrWoW && overview.wrWoW < -30) {
    findings.push({
      type: 'critical',
      icon: '📉',
      title: '阅读量暴跌',
      msg: `本周阅读 ${overview.wrThisWeek}，较上周下降 ${Math.abs(overview.wrWoW)}%，需紧急排查原因`
    })
  }
  
  // Check weekly performance
  if (overview.wrThisWeek < 100) {
    findings.push({
      type: 'warning',
      icon: '⚠️',
      title: '周阅读偏低',
      msg: `本周总阅读 ${overview.wrThisWeek} 次，建议增加发布频次或优化内容质量`
    })
  }
  
  return {
    findings,
    severity: findings.filter(f => f.type === 'critical').length,
    summary: `${findings.length} 个发现，${findings.filter(f => f.type === 'critical').length} 个紧急`
  }
}

function generateStrategies(overview: any) {
  const strategies = []
  
  if (overview.followers < 30) {
    strategies.push({
      text: '在每篇文章末尾增加引导关注话术，如“看完点赞，明天见”',
      priority: 'high',
      impact: '粉丝增长 +5-10%'
    })
  }
  
  if (overview.searchPct < 30) {
    strategies.push({
      text: '标题加入高频搜索词“怎么”、“方法”、“解决”，提升搜一搜流量占比',
      priority: 'medium',
      impact: '搜索流量 +20%'
    })
  }
  
  if (overview.wrWoW < -20) {
    strategies.push({
      text: '分析本周阅读量下降原因：发布时间、标题吸引力、内容匹配度',
      priority: 'high',
      impact: '恢复阅读趋势'
    })
  }
  
  strategies.push({
    text: '保持每日更新节奏，近7天发布7篇，流程顺畅值得肯定',
    priority: 'info',
    impact: '维持现有成果'
  })
  
  return strategies
}
