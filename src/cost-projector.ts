import { dbOps } from './db'

export interface CostProjection {
  trend: 'up' | 'down' | 'stable'
  slope: number
  rSquared: number
  weekly: PeriodProjection
  monthly: PeriodProjection
  dailyHistory: DayPoint[]
}

export interface PeriodProjection {
  projected: number
  lower80: number
  upper80: number
  daysWithData: number
  costSoFar: number
  avgPerDay: number
}

export interface DayPoint {
  date: string
  dayIndex: number
  cost: number
  fitted: number | null
}

function leastSquares(xs: number[], ys: number[]): { slope: number; intercept: number; rSquared: number } {
  const n = xs.length
  if (n < 2) return { slope: 0, intercept: 0, rSquared: 0 }

  const sumX = xs.reduce((a, b) => a + b, 0)
  const sumY = ys.reduce((a, b) => a + b, 0)
  const sumX2 = xs.reduce((a, b) => a + b * b, 0)
  const sumXY = xs.reduce((a, b, i) => a + b * ys[i], 0)

  const denom = n * sumX2 - sumX * sumX
  if (Math.abs(denom) < 1e-12) return { slope: 0, intercept: 0, rSquared: 0 }

  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n

  const yMean = sumY / n
  const ssRes = ys.reduce((a, y, i) => a + (y - (slope * xs[i] + intercept)) ** 2, 0)
  const ssTot = ys.reduce((a, y) => a + (y - yMean) ** 2, 0)
  const rSquared = ssTot > 1e-12 ? 1 - ssRes / ssTot : 0

  return { slope, intercept, rSquared }
}

function standardError(xs: number[], ys: number[], slope: number, intercept: number): number {
  const n = xs.length
  if (n < 3) return 0
  const residuals = xs.map((x, i) => (ys[i] - (slope * x + intercept)) ** 2)
  const sse = residuals.reduce((a, b) => a + b, 0)
  const mse = sse / (n - 2)
  const sumX = xs.reduce((a, b) => a + b, 0)
  const sumX2 = xs.reduce((a, b) => a + b * b, 0)
  const denom = n * sumX2 - sumX * sumX
  if (Math.abs(denom) < 1e-12) return 0
  const seSlope = Math.sqrt(mse * n / denom)
  return seSlope
}

function tCrit80(n: number): number {
  if (n <= 2) return 0
  const df = n - 2
  if (df >= 120) return 1.289
  if (df >= 60) return 1.296
  if (df >= 40) return 1.303
  if (df >= 30) return 1.310
  if (df >= 20) return 1.325
  if (df >= 15) return 1.341
  if (df >= 10) return 1.372
  if (df >= 8) return 1.397
  if (df >= 6) return 1.440
  if (df >= 5) return 1.476
  return 0
}

export function computeProjection(days = 90): CostProjection {
  const since = Date.now() - days * 86_400_000
  const daily = dbOps.getAnalyticsDaily(since) as {
    date: string; sessions: number; cost: number; input_tokens: number
    output_tokens: number; cache_read: number; loops: number; avg_efficiency: number
  }[]
  const dayPoints: DayPoint[] = daily.map((d, i) => ({
    date: d.date,
    dayIndex: i,
    cost: d.cost,
    fitted: null,
  }))

  const costs = dayPoints.map(d => d.cost)
  const indices = dayPoints.map(d => d.dayIndex)

  const { slope, intercept, rSquared } = leastSquares(indices, costs)
  const se = standardError(indices, costs, slope, intercept)
  const t80 = tCrit80(indices.length)

  dayPoints.forEach((d, i) => {
    d.fitted = slope * i + intercept
  })

  const daysWithData = dayPoints.length
  const costSoFar = costs.reduce((a, b) => a + b, 0)
  const avgPerDay = daysWithData > 0 ? costSoFar / daysWithData : 0

  const next7 = indices.length
  const next30 = indices.length + 23
  const weeklyProj = slope * next7 + intercept
  const monthlyProj = slope * next30 + intercept

  const weeklyProjected = Math.max(0, weeklyProj * 7)
  const monthlyProjected = Math.max(0, monthlyProj * 30)

  const weeklySE = se * Math.sqrt(7)
  const monthlySE = se * Math.sqrt(30)
  const weeklyCI = t80 > 0 ? t80 * weeklySE * 7 : weeklyProjected * 0.5
  const monthlyCI = t80 > 0 ? t80 * monthlySE * 30 : monthlyProjected * 0.5

  const trend: 'up' | 'down' | 'stable' =
    slope > 0.001 ? 'up' : slope < -0.001 ? 'down' : 'stable'

  return {
    trend,
    slope,
    rSquared: Math.round(rSquared * 10000) / 10000,
    weekly: {
      projected: Math.round(weeklyProjected * 100) / 100,
      lower80: Math.max(0, Math.round((weeklyProjected - weeklyCI) * 100) / 100),
      upper80: Math.round((weeklyProjected + weeklyCI) * 100) / 100,
      daysWithData,
      costSoFar: Math.round(costSoFar * 100) / 100,
      avgPerDay: Math.round(avgPerDay * 10000) / 10000,
    },
    monthly: {
      projected: Math.round(monthlyProjected * 100) / 100,
      lower80: Math.max(0, Math.round((monthlyProjected - monthlyCI) * 100) / 100),
      upper80: Math.round((monthlyProjected + monthlyCI) * 100) / 100,
      daysWithData,
      costSoFar: Math.round(costSoFar * 100) / 100,
      avgPerDay: Math.round(avgPerDay * 10000) / 10000,
    },
    dailyHistory: dayPoints,
  }
}

export function formatProjection(p: CostProjection): string {
  const trendChar = p.trend === 'up' ? '↑' : p.trend === 'down' ? '↓' : '→'
  const trendLabel = p.trend === 'up' ? 'increasing' : p.trend === 'down' ? 'decreasing' : 'stable'

  let out = `Cost Projection (R²=${p.rSquared.toFixed(3)}, trend=${trendChar} ${trendLabel})\n`
  out += `${'─'.repeat(42)}\n`
  out += `  Weekly  | projected: $${p.weekly.projected.toFixed(2)}  `
  out += `(80% CI: $${p.weekly.lower80.toFixed(2)}–$${p.weekly.upper80.toFixed(2)})\n`
  out += `          | avg $${p.weekly.avgPerDay.toFixed(4)}/day over ${p.weekly.daysWithData} days\n`
  out += `  Monthly | projected: $${p.monthly.projected.toFixed(2)}  `
  out += `(80% CI: $${p.monthly.lower80.toFixed(2)}–$${p.monthly.upper80.toFixed(2)})\n`
  out += `          | avg $${p.monthly.avgPerDay.toFixed(4)}/day over ${p.monthly.daysWithData} days\n`
  out += `${'─'.repeat(42)}`
  return out
}
