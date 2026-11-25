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
    console.error(`Failed to fetch ${path}:`, res.status)
    return null
  }
  
  const data = await res.json()
  try {
    return JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'))
  } catch (e) {
    return null
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { articleId, type = 'article' } = body
    
    // Load data from GitHub
    const snapshot = await getGithubFile('data/snapshots/latest.json')
    const reviews = await getGithubFile('data/reviews/latest.json')
    
    if (!snapshot) {
      return NextResponse.json({ error: '数据未加载' }, { status: 500 })
    }
    
    const topArticles = snapshot?.content_analysis_30d?.top_articles || []
    const home = snapshot?.home || {}
    const ca30d = snapshot?.content_analysis_30d || {}
    
    // Calculate average reads
    const avgReads = Math.round(topArticles.reduce((sum: number, a: any) => sum + (a.reads || 0), 0) / topArticles.length)
    
    if (type === 'article' && articleId) {
      // Analyze specific article
      const article = topArticles.find((a: any) => a.title === articleId) || topArticles[topArticles.length - 1]
      
      if (!article) {
        return NextResponse.json({ error: '文章未找到' }, { status: 404 })
      }
      
      const analysis = analyzeArticle(article, avgReads, ca30d)
      
      // Save analysis result
      await saveAnalysisResult(articleId, analysis)
      
      return NextResponse.json({
        ...analysis,
        avgReads,
        allArticles: topArticles.map((a: any) => ({
          title: a.title,
          reads: a.reads,
          isLowTraffic: (a.reads || 0) < avgReads * 0.5
        }))
      })
    }
    
    // Analyze all low-performing articles this week
    const lowPerformers = topArticles
      .filter((a: any) => (a.reads || 0) < avgReads * 0.7)
      .sort((a: any, b: any) => (a.reads || 0) - (b.reads || 0))
      .slice(0, 5)
    
    const analyses = await Promise.all(
      lowPerformers.map(async (article: any) => {
        const result = analyzeArticle(article, avgReads, ca30d)
        await saveAnalysisResult(article.title, result)
        return result
      })
    )
    
    return NextResponse.json({
      period: '本周',
      analyzedCount: analyses.length,
      avgReads,
      analyses,
      status: '已完成分析'
    })
    
  } catch (error) {
    console.error('Analyze Error:', error)
    return NextResponse.json({ error: '分析失败' }, { status: 500 })
  }
}

function analyzeArticle(article: any, avgReads: number, ca30d: any) {
  const reasons = []
  const suggestions = []
  
  const reads = article.reads || 0
  const shareRate = parseFloat(article.share?.replace('%', '') || '0')
  
  // Reading volume analysis
  if (reads < avgReads * 0.5) {
    reasons.push({
      factor: '阅读量显著偏低',
      detail: `该文章阅读量仅 ${reads} 次，低于账号平均水平 (${avgReads} 次) 的 ${(reads / avgReads * 100).toFixed(0)}%`,
      severity: 'high'
    })
  } else if (reads < avgReads) {
    reasons.push({
      factor: '阅读量略低于平均',
      detail: `阅读量 ${reads} 次，低于平均线 ${avgReads} 次`,
      severity: 'medium'
    })
  }
  
  // Share rate analysis
  if (shareRate < 5) {
    reasons.push({
      factor: '分享率不足',
      detail: `分享率仅 ${shareRate}%，文章社交传播力较弱`,
      severity: 'medium'
    })
    suggestions.push('优化标题和开头，增强文章的社交货币属性')
  }
  
  // Channel distribution insight
  const searchPct = ca30d.search_pct || 0
  if (searchPct < 25 && article.title) {
    reasons.push({
      factor: '搜索流量占比低',
      detail: `目前搜一搜贡献 ${searchPct}% 流量，可通过优化关键词提升`,
      severity: 'low'
    })
    suggestions.push('在标题和正文中加入高频搜索词：“怎么”、“方法”、“解决”、“教程”')
  }
  
  // Generate actionable suggestions
  if (reasons.length > 0) {
    suggestions.unshift('改进方向：')
  }
  
  suggestions.push(
    '尝试周五晚 8 点或周六上午发布，这两个时段打开率较高',
    '文末添加"看完点赞+关注，明天见"引导语',
    '图片封面使用高对比度配色，提升点击率'
  )
  
  return {
    title: article.title,
    reads,
    shareRate,
    reasons,
    suggestions: suggestions.filter(s => s !== '改进方向：'),
    status: '已完成分析',
    recommendedAction: readRecommendation(reads, avgReads, shareRate)
  }
}

function readRecommendation(reads: number, avg: number, shareRate: number): string {
  if (reads < avg * 0.3) {
    return '需要重点优化：建议重写标题并调整发布时间'
  } else if (reads < avg * 0.7) {
    return '值得改进：可尝试优化标题关键词和封面图'
  } else if (shareRate < 5) {
    return '传播力不足：增加互动环节引导用户分享'
  }
  return '表现良好：保持当前内容策略'
}

async function saveAnalysisResult(articleTitle: string, result: any) {
  // In a real implementation, this would save to GitHub
  // For now, we just log it
  console.log(`Saved analysis for: ${articleTitle}`)
}
