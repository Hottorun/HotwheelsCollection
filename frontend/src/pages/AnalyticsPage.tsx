import React, { useState, useEffect, useCallback } from 'react'
import {
  BarChart3,
  Flame,
  Car,
  Layers,
  TrendingUp,
  Clock,
  Trophy,
  CheckCircle2,
  Package,
} from 'lucide-react'
import { useToastContext } from '../contexts/ToastContext'
import { getAnalytics } from '../lib/api'
import type { Analytics } from '../types'

interface StatCardProps {
  icon: React.ReactNode
  label: string
  value: string | number
  sub?: string
  accent?: boolean
}

function StatCard({ icon, label, value, sub, accent }: StatCardProps) {
  return (
    <div className={`card p-4 ${accent ? 'border-hw-accent/30 bg-gradient-to-br from-hw-surface to-orange-950/20' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-hw-text-secondary font-medium uppercase tracking-wider">{label}</p>
          <p className={`text-3xl font-bold mt-1 ${accent ? 'text-gradient-accent' : 'text-hw-text'}`}>
            {value}
          </p>
          {sub && <p className="text-xs text-hw-muted mt-1">{sub}</p>}
        </div>
        <div className={`p-2.5 rounded-xl ${accent ? 'bg-hw-accent/20' : 'bg-hw-surface-hover'}`}>
          <span className={accent ? 'text-hw-accent' : 'text-hw-muted'}>{icon}</span>
        </div>
      </div>
    </div>
  )
}

function SkeletonCard() {
  return <div className="card p-4 h-28 skeleton" />
}

const CONDITION_COLORS: Record<string, string> = {
  mint: 'bg-emerald-500',
  good: 'bg-blue-500',
  fair: 'bg-yellow-500',
  poor: 'bg-red-500',
}

const CONDITION_TEXT_COLORS: Record<string, string> = {
  mint: 'text-emerald-400',
  good: 'text-blue-400',
  fair: 'text-yellow-400',
  poor: 'text-red-400',
}

const CONDITION_ORDER = ['mint', 'good', 'fair', 'poor']

export function AnalyticsPage() {
  const { toast } = useToastContext()
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAnalytics = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getAnalytics()
      setAnalytics(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics')
      toast.error('Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    fetchAnalytics()
  }, [fetchAnalytics])

  if (loading) {
    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        <div className="mb-6">
          <div className="h-7 w-48 skeleton rounded mb-2" />
          <div className="h-4 w-64 skeleton rounded" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
        <div className="h-64 skeleton rounded-xl mb-6" />
        <div className="h-48 skeleton rounded-xl" />
      </div>
    )
  }

  if (error || !analytics) {
    return (
      <div className="p-6 flex flex-col items-center justify-center gap-4 h-64">
        <BarChart3 className="w-10 h-10 text-hw-muted" />
        <p className="text-hw-text-secondary">{error ?? 'No data available'}</p>
        <button onClick={fetchAnalytics} className="btn-primary">Retry</button>
      </div>
    )
  }

  const totalCarsInCatalog = analytics.total_cars_in_catalog || analytics.series_completion.reduce((sum, s) => sum + s.total, 0) || 1
  const ownershipPercent = Math.round((analytics.total_cars / totalCarsInCatalog) * 100)

  // Top 10 series by completion %
  const topSeries = [...analytics.series_completion]
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 10)

  // Cars by type sorted
  const typeEntries = Object.entries(analytics.cars_by_type)
    .sort(([, a], [, b]) => b - a)
  const maxTypeCount = Math.max(...typeEntries.map(([, v]) => v), 1)

  // Cars by year (recent 8)
  const yearEntries = Object.entries(analytics.cars_by_year)
    .sort(([a], [b]) => parseInt(b) - parseInt(a))
    .slice(0, 8)
    .reverse()
  const maxYearCount = Math.max(...yearEntries.map(([, v]) => v), 1)

  // Condition breakdown (guard: field may be missing if backend not restarted)
  const conditionMap = analytics.cars_by_condition ?? {}
  const conditionEntries = CONDITION_ORDER
    .filter(c => conditionMap[c] !== undefined)
    .map(c => [c, conditionMap[c]] as [string, number])
  const maxConditionCount = Math.max(...conditionEntries.map(([, v]) => v), 1)

  // Carded vs loose
  const cardedCount = analytics.carded_count ?? 0
  const looseCount = analytics.loose_count ?? 0
  const totalCardedLoose = (cardedCount + looseCount) || 1
  const cardedPct = Math.round((cardedCount / totalCardedLoose) * 100)
  const loosePct = 100 - cardedPct

  // Top colors
  const topColors = analytics.top_colors ?? []
  const maxColorCount = Math.max(...(topColors.map(c => c.count)), 1)

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-hw-text">Analytics</h1>
        <p className="text-hw-text-secondary text-sm mt-0.5">
          Your collection stats at a glance
        </p>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard
          icon={<Car className="w-5 h-5" />}
          label="Cars Owned"
          value={analytics.total_cars.toLocaleString()}
          sub="in your collection"
          accent
        />
        <StatCard
          icon={<Layers className="w-5 h-5" />}
          label="Series Touched"
          value={analytics.total_series.toLocaleString()}
          sub="unique series"
        />
        <StatCard
          icon={<Flame className="w-5 h-5" />}
          label="Treasure Hunts"
          value={analytics.treasure_hunts_count.toLocaleString()}
          sub="special finds"
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="Catalog Coverage"
          value={`${ownershipPercent}%`}
          sub={`of ${totalCarsInCatalog.toLocaleString()} known cars`}
        />
      </div>

      {/* Series completion */}
      <div className="card p-5 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <Trophy className="w-4 h-4 text-hw-orange" />
          <h2 className="font-semibold text-hw-text">Series Completion</h2>
          <span className="text-xs text-hw-muted ml-auto">{analytics.series_completion.length} series</span>
        </div>

        {analytics.series_completion.length === 0 ? (
          <p className="text-hw-muted text-sm text-center py-6">
            Add cars to see series completion
          </p>
        ) : (
          <div className="space-y-3">
            {topSeries.map(({ series, owned, total, percent }) => (
              <div key={series.id}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-hw-text truncate">{series.name}</span>
                    {series.year && (
                      <span className="text-xs text-hw-muted flex-shrink-0">{series.year}</span>
                    )}
                    {percent === 100 && (
                      <span className="badge bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] flex-shrink-0">
                        Complete!
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                    <span className="text-xs text-hw-muted">{owned}/{total}</span>
                    <span className={`text-xs font-bold w-10 text-right ${
                      percent === 100 ? 'text-emerald-400'
                      : percent >= 75 ? 'text-hw-orange'
                      : percent >= 50 ? 'text-yellow-500'
                      : 'text-hw-muted'
                    }`}>
                      {percent}%
                    </span>
                  </div>
                </div>
                <div className="h-1.5 bg-hw-border rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      percent === 100 ? 'bg-emerald-500' : 'bg-gradient-to-r from-hw-accent to-hw-orange'
                    }`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            ))}
            {analytics.series_completion.length > 10 && (
              <p className="text-xs text-hw-muted text-center pt-1">
                + {analytics.series_completion.length - 10} more series
              </p>
            )}
          </div>
        )}
      </div>

      {/* Condition + Carded/Loose row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* Condition breakdown */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="w-4 h-4 text-hw-orange" />
            <h2 className="font-semibold text-hw-text">By Condition</h2>
          </div>
          {conditionEntries.length === 0 ? (
            <p className="text-hw-muted text-sm text-center py-6">No data yet</p>
          ) : (
            <div className="space-y-2.5">
              {conditionEntries.map(([condition, count]) => (
                <div key={condition}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-sm capitalize font-medium ${CONDITION_TEXT_COLORS[condition] ?? 'text-hw-text'}`}>
                      {condition}
                    </span>
                    <span className="text-xs text-hw-muted font-medium">{count}</span>
                  </div>
                  <div className="h-1.5 bg-hw-border rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${CONDITION_COLORS[condition] ?? 'bg-hw-accent'}`}
                      style={{ width: `${(count / maxConditionCount) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Carded vs Loose */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Package className="w-4 h-4 text-hw-orange" />
            <h2 className="font-semibold text-hw-text">Carded vs Loose</h2>
          </div>
          {totalCardedLoose === 0 ? (
            <p className="text-hw-muted text-sm text-center py-6">No data yet</p>
          ) : (
            <div>
              <div className="flex rounded-full overflow-hidden h-5 mb-3">
                {cardedPct > 0 && (
                  <div
                    className="bg-hw-accent flex items-center justify-center text-[10px] text-white font-bold transition-all duration-700"
                    style={{ width: `${cardedPct}%` }}
                  >
                    {cardedPct >= 15 ? `${cardedPct}%` : ''}
                  </div>
                )}
                {loosePct > 0 && (
                  <div
                    className="bg-zinc-500 flex items-center justify-center text-[10px] text-white font-bold transition-all duration-700"
                    style={{ width: `${loosePct}%` }}
                  >
                    {loosePct >= 15 ? `${loosePct}%` : ''}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm bg-hw-accent flex-shrink-0" />
                  <span className="text-hw-text">Carded</span>
                  <span className="text-hw-muted font-medium">{cardedCount}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-hw-muted font-medium">{looseCount}</span>
                  <span className="text-hw-text">Loose</span>
                  <span className="w-3 h-3 rounded-sm bg-zinc-500 flex-shrink-0" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Top colors */}
      {topColors.length > 0 && (
        <div className="card p-5 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-hw-orange" />
            <h2 className="font-semibold text-hw-text">Top Colors</h2>
          </div>
          <div className="space-y-2.5">
            {topColors.map(({ color, count }) => (
              <div key={color}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0 border border-white/10"
                      style={{ backgroundColor: color.toLowerCase() }}
                    />
                    <span className="text-sm text-hw-text capitalize">{color}</span>
                  </div>
                  <span className="text-xs text-hw-muted font-medium">{count}</span>
                </div>
                <div className="h-1.5 bg-hw-border rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${(count / maxColorCount) * 100}%`,
                      backgroundColor: color.toLowerCase(),
                      opacity: 0.8,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* Cars by type */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-hw-orange" />
            <h2 className="font-semibold text-hw-text">By Type</h2>
          </div>
          {typeEntries.length === 0 ? (
            <p className="text-hw-muted text-sm text-center py-6">No data yet</p>
          ) : (
            <div className="space-y-2.5">
              {typeEntries.map(([type, count]) => (
                <div key={type}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-hw-text capitalize">{type || 'Unknown'}</span>
                    <span className="text-xs text-hw-muted font-medium">{count}</span>
                  </div>
                  <div className="h-1.5 bg-hw-border rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-hw-accent to-hw-orange transition-all duration-700"
                      style={{ width: `${(count / maxTypeCount) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cars by year */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-hw-orange" />
            <h2 className="font-semibold text-hw-text">By Year</h2>
          </div>
          {yearEntries.length === 0 ? (
            <p className="text-hw-muted text-sm text-center py-6">No data yet</p>
          ) : (
            <div className="flex items-end gap-2 h-40">
              {yearEntries.map(([year, count]) => {
                const heightPct = (count / maxYearCount) * 100
                return (
                  <div key={year} className="flex flex-col items-center gap-1 flex-1 min-w-0">
                    <span className="text-[10px] text-hw-muted">{count}</span>
                    <div className="w-full bg-hw-border rounded-t overflow-hidden" style={{ height: '80px' }}>
                      <div
                        className="w-full bg-gradient-to-t from-hw-accent to-hw-orange rounded-t transition-all duration-700"
                        style={{ height: `${heightPct}%`, marginTop: `${100 - heightPct}%` }}
                      />
                    </div>
                    <span className="text-[9px] text-hw-muted" style={{ writingMode: 'vertical-lr', transform: 'rotate(180deg)', lineHeight: 1 }}>{year}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Recently added */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-hw-orange" />
          <h2 className="font-semibold text-hw-text">Recently Added</h2>
        </div>
        {analytics.recently_added.length === 0 ? (
          <p className="text-hw-muted text-sm text-center py-6">No cars added yet</p>
        ) : (
          <div className="space-y-2">
            {analytics.recently_added.slice(0, 5).map((entry) => {
              const car = entry.car
              if (!car) return null
              return (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-hw-surface-hover transition-colors"
                >
                  <div className="w-10 h-10 rounded-lg bg-hw-surface-hover border border-hw-border flex-shrink-0 overflow-hidden">
                    {car.image_url ? (
                      <img src={car.image_url} alt={car.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Car className="w-4 h-4 text-hw-muted" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-hw-text truncate">{car.name}</p>
                    <p className="text-xs text-hw-muted">
                      {car.series?.name ?? 'No series'} {car.year ? `· ${car.year}` : ''}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-hw-muted">
                      {new Date(entry.created_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </p>
                    <p className="text-xs text-hw-text-secondary capitalize">{entry.condition}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
