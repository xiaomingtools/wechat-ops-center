import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const OPS_ROOT = 'E:/自动盈利系统/公众号运营中心'

function collect(): any {
  const manifestPath = path.join(OPS_ROOT, '00_总控/WEBSITE_TUTORIAL_MANIFEST.json')
  const followerPath = path.join(OPS_ROOT, '10_运营数据/follower_watch.json')
  const snapshotDir = path.join(OPS_ROOT, '10_运营数据/wechat_backend/')
  const dailyDraftsDir = path.join(OPS_ROOT, '10_运营数据/daily_drafts/')
  const weeklyReviewDir = path.join(OPS_ROOT, '10_运营数据/weekly_review/')
  const webTutorialsDir = path.join(OPS_ROOT, '10_运营数据/web_tutorials/')

  let manifest: any = { entries: [] }
  let followers: any = { total: 0 }
  let latestSnapshot: any = null
  let weeklyReviews: any[] = []
  let webRec: Record<string, any> = {}
  let draftMap: Record<string, any> = {}

  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) } catch (e) { console.error('Manifest error:', e) }
  try { followers = JSON.parse(fs.readFileSync(followerPath, 'utf8')) } catch (e) { console.error('Followers error:', e) }

  // Find latest snapshot
  try {
    const snapshots = fs.readdirSync(snapshotDir).filter((f: string) => f.startsWith('snapshot-')).sort().reverse()
    if (snapshots.length > 0) {
      latestSnapshot = JSON.parse(fs.readFileSync(path.join(snapshotDir, snapshots[0]), 'utf8'))
    }
  } catch (e) { console.error('Snapshot error:', e) }

  // Weekly reviews
  try {
    const reviews = fs.readdirSync(weeklyReviewDir).filter((f: string) => f.endsWith('.json')).sort().reverse()
    for (const r of reviews.slice(0, 4)) {
      try { weeklyReviews.push(JSON.parse(fs.readFileSync(path.join(weeklyReviewDir, r), 'utf8'))) } catch (e) {}
    }
  } catch (e) { console.error('Reviews error:', e) }

  // Web tutorials
  try {
    const tutorials = fs.readdirSync(webTutorialsDir).filter((f: string) => f.endsWith('.json')).sort().reverse()
    for (const t of tutorials.slice(0, 7)) {
      try { webRec[t.replace('.json', '')] = JSON.parse(fs.readFileSync(path.join(webTutorialsDir, t), 'utf8')) } catch (e) {}
    }
  } catch (e) { console.error('Tutorials error:', e) }

  // Daily drafts
  try {
    const drafts = fs.readdirSync(dailyDraftsDir).filter((f: string) => f.endsWith('.json') && !f.includes('check') && !f.includes('_newspic') && !f.includes('_heartbeat')).sort().reverse()
    for (const d of drafts.slice(0, 7)) {
      try { draftMap[d.replace('.json', '')] = JSON.parse(fs.readFileSync(path.join(dailyDraftsDir, d), 'utf8')) } catch (e) {}
    }
  } catch (e) { console.error('Drafts error:', e) }

  const entries = manifest.entries || []
  const publishedCount = entries.filter((e: any) => e.site_status === 'PUBLISHED' || e.wechat_status === 'PUBLISHED').length
  const pendingDrafts = entries.filter((e: any) => e.wechat_status === 'DRAFT_CREATED' || e.wechat_status === 'UNPUBLISHED').length

  const home = latestSnapshot?.home || {}
  const ca30d = latestSnapshot?.content_analysis_30d || {}
  const yReads = parseInt(home.yesterday_readers || '0')
  const yChange = home.yesterday_growth || 'N/A'
  const totalR30 = ca30d.readers_total || 0
  const totalUsers = home.total_users || 0

  const latestWr = weeklyReviews[0] || {}
  const wrThisWeek = latestWr.reads || 0
  const wrPrevWeek = latestWr.prev_week?.reads || 0
  const wrWoW = wrPrevWeek ? Math.round(((wrThisWeek - wrPrevWeek) / wrPrevWeek) * 100) : 0

  const followersData = followers.total || 0
  const followerTarget = 100
  const followerPct = Math.round((followersData / followerTarget) * 100)

  return {
    generated_at: new Date().toISOString(),
    account: 'AI工具研究所',
    overview: {
      totalArticles: entries.length,
      publishedCount,
      pendingDrafts,
      followers: followersData,
      followerTarget,
      followerPct,
      wxLoginState: latestSnapshot?.login_state || 'LOGGED_IN',
      wxLoginLabel: '● 登录正常',
      alertCount: 0,
      passRate: entries.length > 0 ? Math.round((publishedCount / entries.length) * 100) : 0,
      yesterdayReads: yReads,
      yesterdayChange: String(yChange).includes('%') ? String(yChange) : `${yChange}%`,
      totalReaders30d: totalR30,
      wrThisWeek,
      wrPrevWeek,
      wrWoW,
      searchPct: ca30d.search_pct || 0,
      recommendPct: ca30d.recommend_pct || 0,
      latestCheck: latestSnapshot ? new Date().toLocaleDateString('zh-CN') : '',
    },
    trend: [],
    userTrend: [],
    topics: [],
    diagnostics: { findings: [] },
    strategies: [],
    annualPlan: { targetFollowers: 500, targetArticles: 365 },
  }
}

export async function GET() {
  try {
    const data = collect()
    return NextResponse.json(data)
  } catch (error) {
    console.error('API Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
