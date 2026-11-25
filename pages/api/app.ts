import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

// 云环境或本地开发都可以工作
// 优先尝试从项目内的 data/ 目录读取（GitHub分支同步的数据）
const DATA_DIR = path.join(process.cwd(), 'data')
const LOCAL_OPS_ROOT = 'E:/自动盈利系统/公众号运营中心'

function collectFromDataDir(): any {
  const manifestPath = path.join(DATA_DIR, 'manifest.json')
  const followerPath = path.join(DATA_DIR, 'follower_watch.json')
  
  let manifest: any = { entries: [] }
  let followers: any = { total: 0 }

  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) } catch (e) {}
  try { followers = JSON.parse(fs.readFileSync(followerPath, 'utf8')) } catch (e) {}

  // 查找最新快照
  let latestSnapshot: any = null
  try {
    const snapshotDir = path.join(DATA_DIR, 'wechat_backend')
    if (fs.existsSync(snapshotDir)) {
      const snapshots = fs.readdirSync(snapshotDir).filter((f: string) => f.startsWith('snapshot-')).sort().reverse()
      if (snapshots.length > 0) {
        latestSnapshot = JSON.parse(fs.readFileSync(path.join(snapshotDir, snapshots[0]), 'utf8'))
      }
    }
  } catch (e) {}

  // 周报
  let weeklyReviews: any[] = []
  try {
    const reviewDir = path.join(DATA_DIR, 'weekly_review')
    if (fs.existsSync(reviewDir)) {
      const reviews = fs.readdirSync(reviewDir).filter((f: string) => f.endsWith('.json')).sort().reverse()
      for (const r of reviews.slice(0, 4)) {
        try { weeklyReviews.push(JSON.parse(fs.readFileSync(path.join(reviewDir, r), 'utf8'))) } catch (e) {}
      }
    }
  } catch (e) {}

  return buildResponse(manifest, followers, latestSnapshot, weeklyReviews)
}

function buildResponse(manifest: any, followers: any, snapshot: any, reviews: any[]): any {
  const entries = manifest.entries || []
  const publishedCount = entries.filter((e: any) => e.site_status === 'PUBLISHED' || e.wechat_status === 'PUBLISHED').length
  const pendingDrafts = entries.filter((e: any) => e.wechat_status === 'DRAFT_CREATED' || e.wechat_status === 'UNPUBLISHED').length

  const home = snapshot?.home || {}
  const ca30d = snapshot?.content_analysis_30d || {}
  const yReads = parseInt(home.yesterday_readers || '0')
  const yChange = home.yesterday_growth || 'N/A'
  const totalR30 = ca30d.readers_total || 0
  const totalUsers = home.total_users || 0

  const latestWr = reviews[0] || {}
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
      wxLoginState: snapshot?.login_state || 'LOGGED_IN',
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
      latestCheck: snapshot ? new Date().toLocaleDateString('zh-CN') : '',
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
    // 优先使用项目内 data/ 目录（Git 推送的远程数据）
    if (fs.existsSync(DATA_DIR) && fs.readdirSync(DATA_DIR).length > 0) {
      console.log('Using local data directory:', DATA_DIR)
      return NextResponse.json(collectFromDataDir())
    }
    
    // 降级到本地操作目录（开发环境）
    console.log('Falling back to local operations directory')
    return NextResponse.json({ error: '数据尚未同步到云端，请先运行 sync_to_cloud.ps1' })
  } catch (error) {
    console.error('API Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
