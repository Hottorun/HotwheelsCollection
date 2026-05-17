import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Car,
  Layers,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import { PageSpinner } from '../components/Spinner'
import { SeriesEditModal } from '../components/SeriesEditModal'
import { useToastContext } from '../contexts/ToastContext'
import { createSeries, getAllSeries, getCars } from '../lib/api'
import type { Car as CarType, Series } from '../types'

const SERIES_TYPES = ['', 'mainline', 'premium', 'collector']

export function SeriesPage() {
  const { toast } = useToastContext()
  const [series, setSeries] = useState<Series[]>([])
  const [cars, setCars] = useState<CarType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editingSeries, setEditingSeries] = useState<Series | null>(null)
  const [newSeries, setNewSeries] = useState({
    name: '',
    year: '',
    type: 'mainline' as 'mainline' | 'premium' | 'collector',
    total_count: '',
  })
  const [creating, setCreating] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [seriesData, carsData] = await Promise.all([
        getAllSeries(),
        getCars({ page: 1, page_size: 9999 }),
      ])
      setSeries(seriesData)
      setCars(carsData.items ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load series')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const carCounts = useMemo(() => {
    const counts = new Map<string, number>()
    cars.forEach((car) => {
      if (!car.series_id) return
      counts.set(car.series_id, (counts.get(car.series_id) ?? 0) + 1)
    })
    return counts
  }, [cars])

  const filteredSeries = useMemo(() => {
    const q = query.trim().toLowerCase()
    return series
      .filter((item) => {
        if (typeFilter && item.type !== typeFilter) return false
        if (!q) return true
        return (
          item.name.toLowerCase().includes(q) ||
          String(item.year ?? '').includes(q) ||
          item.type.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => {
        const yearA = a.year ?? 0
        const yearB = b.year ?? 0
        if (yearA !== yearB) return yearB - yearA
        return a.name.localeCompare(b.name)
      })
  }, [query, series, typeFilter])

  const handleCreate = async () => {
    if (!newSeries.name.trim()) {
      toast.error('Series name is required')
      return
    }

    setCreating(true)
    try {
      const created = await createSeries({
        name: newSeries.name.trim(),
        year: newSeries.year ? Number(newSeries.year) : undefined,
        type: newSeries.type,
        total_count: newSeries.total_count ? Number(newSeries.total_count) : undefined,
      })
      setSeries((prev) => [...prev, created])
      setNewSeries({ name: '', year: '', type: 'mainline', total_count: '' })
      setShowCreate(false)
      toast.success('Series created')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create series')
    } finally {
      setCreating(false)
    }
  }

  const activeFilterCount = [query, typeFilter].filter(Boolean).length

  if (loading) return <PageSpinner />

  if (error) {
    return (
      <div className="p-6 flex flex-col items-center justify-center gap-4 h-64">
        <p className="text-hw-text-secondary">{error}</p>
        <button onClick={fetchData} className="btn-primary">Retry</button>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-hw-text">Series</h1>
          <p className="text-hw-text-secondary text-sm mt-0.5">
            {filteredSeries.length} of {series.length} series
          </p>
        </div>
        <button onClick={() => setShowCreate((v) => !v)} className="btn-primary">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">New Series</span>
        </button>
      </div>

      {showCreate && (
        <div className="card p-4 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_120px_150px_140px_auto] gap-3 items-end">
            <div>
              <label className="label">Name</label>
              <input
                value={newSeries.name}
                onChange={(e) => setNewSeries((prev) => ({ ...prev, name: e.target.value }))}
                className="input-field"
                placeholder="e.g. HW J-Imports"
              />
            </div>
            <div>
              <label className="label">Year</label>
              <input
                type="number"
                value={newSeries.year}
                onChange={(e) => setNewSeries((prev) => ({ ...prev, year: e.target.value }))}
                className="input-field"
                placeholder="2024"
                min="1968"
                max={new Date().getFullYear() + 2}
              />
            </div>
            <div>
              <label className="label">Type</label>
              <select
                value={newSeries.type}
                onChange={(e) => setNewSeries((prev) => ({ ...prev, type: e.target.value as typeof newSeries.type }))}
                className="input-field"
              >
                <option value="mainline">Mainline</option>
                <option value="premium">Premium</option>
                <option value="collector">Collector</option>
              </select>
            </div>
            <div>
              <label className="label">Total Cars</label>
              <input
                type="number"
                value={newSeries.total_count}
                onChange={(e) => setNewSeries((prev) => ({ ...prev, total_count: e.target.value }))}
                className="input-field"
                placeholder="10"
                min="1"
              />
            </div>
            <button onClick={handleCreate} disabled={creating} className="btn-primary justify-center">
              {creating ? 'Saving...' : 'Create'}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-hw-muted pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="input-field pl-9"
            placeholder="Search series, year, type..."
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="input-field w-auto"
        >
          {SERIES_TYPES.map((type) => (
            <option key={type} value={type}>{type || 'All Types'}</option>
          ))}
        </select>
        {activeFilterCount > 0 && (
          <button
            onClick={() => { setQuery(''); setTypeFilter('') }}
            className="btn-ghost text-xs text-hw-accent"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Clear
          </button>
        )}
      </div>

      {filteredSeries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-16 h-16 rounded-2xl bg-hw-surface-hover flex items-center justify-center">
            <Layers className="w-8 h-8 text-hw-muted" />
          </div>
          <div className="text-center">
            <h3 className="font-semibold text-hw-text mb-1">No series found</h3>
            <p className="text-hw-text-secondary text-sm">Try adjusting the search or type filter</p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden border border-hw-border rounded-xl bg-hw-surface">
          <div className="hidden md:grid grid-cols-[minmax(0,1fr)_100px_120px_120px_120px] gap-3 px-4 py-2 border-b border-hw-border text-[11px] font-semibold uppercase tracking-wider text-hw-muted">
            <span>Series</span>
            <span>Year</span>
            <span>Type</span>
            <span>Cars</span>
            <span className="text-right">Actions</span>
          </div>

          <div className="divide-y divide-hw-border">
            {filteredSeries.map((item) => {
              const carCount = carCounts.get(item.id) ?? 0
              const total = item.total_count
              const percent = total ? Math.min(100, Math.round((carCount / total) * 100)) : 0

              return (
                <div
                  key={item.id}
                  className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_100px_120px_120px_120px] gap-3 px-4 py-3 items-center hover:bg-hw-surface-hover transition-colors"
                >
                  <div className="min-w-0 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-hw-bg border border-hw-border flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                      ) : (
                        <Layers className="w-4 h-4 text-hw-muted" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-hw-text truncate">{item.name}</p>
                      <p className="md:hidden text-xs text-hw-muted mt-0.5">
                        {[item.year, item.type, total ? `${carCount}/${total}` : `${carCount} cars`].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </div>

                  <span className="hidden md:block text-sm text-hw-text-secondary">{item.year ?? '-'}</span>
                  <span className="hidden md:block text-sm text-hw-text-secondary capitalize">{item.type}</span>

                  <div className="hidden md:block">
                    <div className="flex items-center gap-2 text-sm text-hw-text-secondary">
                      <Car className="w-3.5 h-3.5 text-hw-muted" />
                      <span>{total ? `${carCount}/${total}` : carCount}</span>
                    </div>
                    {total && (
                      <div className="h-1 bg-hw-border rounded-full overflow-hidden mt-1">
                        <div className="h-full bg-hw-accent rounded-full" style={{ width: `${percent}%` }} />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => setEditingSeries(item)}
                      className="w-8 h-8 rounded-lg border border-hw-border text-hw-muted hover:text-hw-accent hover:border-hw-accent/50 transition-colors flex items-center justify-center"
                      title="Edit series"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setEditingSeries(item)}
                      className="w-8 h-8 rounded-lg border border-hw-border text-hw-muted hover:text-red-400 hover:border-red-700/50 transition-colors flex items-center justify-center"
                      title="Delete series"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <SeriesEditModal
        isOpen={!!editingSeries}
        onClose={() => setEditingSeries(null)}
        series={editingSeries}
        onSuccess={(updated) => {
          setSeries((prev) => prev.map((item) => item.id === updated.id ? updated : item))
        }}
        onDelete={(seriesId) => {
          setSeries((prev) => prev.filter((item) => item.id !== seriesId))
          setCars((prev) => prev.map((car) => car.series_id === seriesId ? { ...car, series_id: undefined, series: undefined } : car))
        }}
      />
    </div>
  )
}
