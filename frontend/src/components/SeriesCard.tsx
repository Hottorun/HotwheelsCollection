import { Car, ChevronRight } from 'lucide-react'
import type { Series } from '../types'

interface SeriesCardProps {
  series: Series
  owned?: number
  total?: number
  onClick?: () => void
}

export function SeriesCard({ series, owned = 0, total, onClick }: SeriesCardProps) {
  const totalCount = total ?? series.total_count ?? 0
  const percent = totalCount > 0 ? Math.round((owned / totalCount) * 100) : 0
  const isComplete = totalCount > 0 && owned >= totalCount

  return (
    <div
      className={`card card-hover p-4 cursor-pointer ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        {/* Series icon / image */}
        <div className="w-10 h-10 rounded-lg bg-hw-surface-hover border border-hw-border flex items-center justify-center flex-shrink-0">
          {series.image_url ? (
            <img src={series.image_url} alt={series.name} className="w-full h-full object-cover rounded-lg" />
          ) : (
            <Car className="w-5 h-5 text-hw-muted" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm text-hw-text truncate">{series.name}</h3>
            {isComplete && (
              <span className="badge bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] flex-shrink-0">
                Complete
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 mt-0.5">
            {series.year && (
              <span className="text-xs text-hw-muted">{series.year}</span>
            )}
            <span className="text-xs text-hw-muted capitalize">{series.type}</span>
          </div>

          {/* Progress bar */}
          {totalCount > 0 && (
            <div className="mt-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-hw-muted">
                  {owned} / {totalCount} cars
                </span>
                <span
                  className={`text-xs font-semibold ${
                    percent === 100
                      ? 'text-emerald-400'
                      : percent >= 50
                      ? 'text-hw-orange'
                      : 'text-hw-muted'
                  }`}
                >
                  {percent}%
                </span>
              </div>
              <div className="h-1.5 bg-hw-border rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    percent === 100
                      ? 'bg-emerald-500'
                      : 'bg-gradient-to-r from-hw-accent to-hw-orange'
                  }`}
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {onClick && (
          <ChevronRight className="w-4 h-4 text-hw-border flex-shrink-0 mt-1" />
        )}
      </div>
    </div>
  )
}
