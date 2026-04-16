import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, PackageOpen, SlidersHorizontal, X, LayoutGrid, Layers } from 'lucide-react'
import { CarCard } from '../components/CarCard'
import { AddCarModal } from '../components/AddCarModal'
import { AddToCollectionModal } from '../components/AddToCollectionModal'
import { CarDetailModal } from '../components/CarDetailModal'
import { PageSpinner } from '../components/Spinner'
import { useSearch } from '../contexts/SearchContext'
import { useToastContext } from '../contexts/ToastContext'
import { getCollection, getAllSeries, addToWishlist } from '../lib/api'
import { useDebounce } from '../hooks/useDebounce'
import type { CollectionEntry, Car, Series } from '../types'

const CONDITIONS = ['', 'mint', 'good', 'fair', 'poor']
const SORT_OPTIONS = [
  { value: 'date_desc', label: 'Newest First' },
  { value: 'date_asc', label: 'Oldest First' },
  { value: 'name_asc', label: 'Name A–Z' },
  { value: 'name_desc', label: 'Name Z–A' },
  { value: 'year_desc', label: 'Year (Newest)' },
  { value: 'year_asc', label: 'Year (Oldest)' },
]

export function CollectionPage() {
  const { searchQuery } = useSearch()
  const { toast } = useToastContext()
  const debouncedSearch = useDebounce(searchQuery, 300)

  const [collection, setCollection] = useState<CollectionEntry[]>([])
  const [series, setSeries] = useState<Series[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [viewMode, setViewMode] = useState<'grid' | 'series'>('grid')
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState({
    series_id: '',
    year: '',
    condition: '',
    sort: 'date_desc',
  })

  const [addCarOpen, setAddCarOpen] = useState(false)
  const [collectionModal, setCollectionModal] = useState<{
    open: boolean
    car: Car | null
    entry?: CollectionEntry
  }>({ open: false, car: null })
  const [editCarModal, setCarDetailModal] = useState<{ open: boolean; car: Car | null; collectionEntry?: CollectionEntry }>({ open: false, car: null })

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [col, ser] = await Promise.all([getCollection(), getAllSeries()])
      setCollection(col)
      setSeries(ser)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load collection')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleAddToWishlist = useCallback(
    async (car: Car) => {
      try {
        await addToWishlist({ allcars_id: car.id, priority: 2 })
        toast.success(`"${car.name}" added to wishlist`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to add to wishlist')
      }
    },
    [toast]
  )

  const filteredCollection = useMemo(() => {
    let items = [...collection]

    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase()
      items = items.filter((e) => {
        const car = e.car
        if (!car) return false
        return (
          car.name.toLowerCase().includes(q) ||
          car.series?.name.toLowerCase().includes(q) ||
          car.primary_color?.toLowerCase().includes(q)
        )
      })
    }

    if (filters.series_id) {
      items = items.filter((e) => e.car?.series_id === filters.series_id)
    }

    if (filters.year) {
      items = items.filter((e) => String(e.car?.year) === filters.year)
    }

    if (filters.condition) {
      items = items.filter((e) => e.condition === filters.condition)
    }

    items.sort((a, b) => {
      switch (filters.sort) {
        case 'date_asc':
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        case 'date_desc':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        case 'name_asc':
          return (a.car?.name ?? '').localeCompare(b.car?.name ?? '')
        case 'name_desc':
          return (b.car?.name ?? '').localeCompare(a.car?.name ?? '')
        case 'year_desc':
          return (b.car?.year ?? 0) - (a.car?.year ?? 0)
        case 'year_asc':
          return (a.car?.year ?? 0) - (b.car?.year ?? 0)
        default:
          return 0
      }
    })

    return items
  }, [collection, debouncedSearch, filters])

  const activeFilterCount = [
    filters.series_id,
    filters.year,
    filters.condition,
  ].filter(Boolean).length

  const groupedBySeries = useMemo(() => {
    const groups: Record<string, { name: string; entries: typeof filteredCollection }> = {}
    filteredCollection.forEach(entry => {
      const key = entry.car?.series_id || '__none__'
      const name = entry.car?.series?.name || 'No Series'
      if (!groups[key]) groups[key] = { name, entries: [] }
      groups[key].entries.push(entry)
    })
    return Object.entries(groups)
      .map(([key, { name, entries }]) => ({ key, name, entries }))
      .sort((a, b) => {
        if (a.key === '__none__') return 1
        if (b.key === '__none__') return -1
        return a.name.localeCompare(b.name)
      })
  }, [filteredCollection])

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
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-hw-text">My Collection</h1>
          <p className="text-hw-text-secondary text-sm mt-0.5">
            {debouncedSearch || activeFilterCount > 0
              ? `${filteredCollection.length} of ${collection.length} cars`
              : `${collection.length} ${collection.length === 1 ? 'car' : 'cars'} owned`}
          </p>
        </div>
        <button onClick={() => setAddCarOpen(true)} className="btn-primary">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Add Car</span>
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`btn-secondary text-sm py-1.5 px-3 ${activeFilterCount > 0 ? 'border-hw-accent text-hw-accent' : ''}`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          Filters
          {activeFilterCount > 0 && (
            <span className="w-5 h-5 rounded-full bg-hw-accent text-white text-xs flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>

        {viewMode === 'grid' && (
          <select
            value={filters.sort}
            onChange={(e) => setFilters((p) => ({ ...p, sort: e.target.value }))}
            className="input-field w-auto text-sm py-1.5"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        )}

        {/* View toggle */}
        <div className="flex items-center gap-1 ml-auto p-0.5 bg-hw-surface border border-hw-border rounded-lg">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-hw-accent text-white' : 'text-hw-muted hover:text-hw-text'}`}
            title="Grid view"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('series')}
            className={`p-1.5 rounded-md transition-colors ${viewMode === 'series' ? 'bg-hw-accent text-white' : 'text-hw-muted hover:text-hw-text'}`}
            title="By series"
          >
            <Layers className="w-4 h-4" />
          </button>
        </div>

        {viewMode === 'grid' && (
          <span className="text-xs text-hw-muted">
            {filteredCollection.length} result{filteredCollection.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Expanded filters */}
      {showFilters && (
        <div className="p-4 bg-hw-surface border border-hw-border rounded-xl mb-4 grid grid-cols-1 sm:grid-cols-3 gap-3 animate-fade-in">
          <div>
            <label className="label">Series</label>
            <select
              value={filters.series_id}
              onChange={(e) => setFilters((p) => ({ ...p, series_id: e.target.value }))}
              className="input-field"
            >
              <option value="">All Series</option>
              {series.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Year</label>
            <input
              type="number"
              value={filters.year}
              onChange={(e) => setFilters((p) => ({ ...p, year: e.target.value }))}
              className="input-field"
              placeholder="e.g. 2024"
              min="1968"
              max={new Date().getFullYear() + 2}
            />
          </div>
          <div>
            <label className="label">Condition</label>
            <select
              value={filters.condition}
              onChange={(e) => setFilters((p) => ({ ...p, condition: e.target.value }))}
              className="input-field"
            >
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>{c || 'All Conditions'}</option>
              ))}
            </select>
          </div>
          {activeFilterCount > 0 && (
            <div className="sm:col-span-3 flex justify-end">
              <button
                onClick={() => setFilters((p) => ({ ...p, series_id: '', year: '', condition: '' }))}
                className="btn-ghost text-xs text-hw-accent hover:text-hw-orange"
              >
                <X className="w-3.5 h-3.5" />
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {filteredCollection.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-16 h-16 rounded-2xl bg-hw-surface-hover flex items-center justify-center">
            <PackageOpen className="w-8 h-8 text-hw-muted" />
          </div>
          <div className="text-center">
            <h3 className="font-semibold text-hw-text mb-1">
              {debouncedSearch || activeFilterCount > 0 ? 'No results found' : 'Your collection is empty'}
            </h3>
            <p className="text-hw-text-secondary text-sm">
              {debouncedSearch || activeFilterCount > 0
                ? 'Try adjusting your search or filters'
                : 'Add cars from the All Cars catalog or create a new entry'}
            </p>
          </div>
          {!debouncedSearch && activeFilterCount === 0 && (
            <button onClick={() => setAddCarOpen(true)} className="btn-primary">
              <Plus className="w-4 h-4" />
              Add your first car
            </button>
          )}
        </div>
      )}

      {/* Grid view */}
      {filteredCollection.length > 0 && viewMode === 'grid' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {filteredCollection.map((entry) => (
            entry.car && (
              <CarCard
                key={entry.id}
                car={entry.car}
                collectionEntry={entry}
                onAddToWishlist={handleAddToWishlist}
                onEditCarDetails={(car) => setCarDetailModal({ open: true, car, collectionEntry: entry })}
              />
            )
          ))}
        </div>
      )}

      {/* By series view */}
      {filteredCollection.length > 0 && viewMode === 'series' && (
        <div className="space-y-8">
          {groupedBySeries.map(({ key, name, entries }) => (
            <div key={key}>
              <div className="flex items-center gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-hw-accent" />
                  <h2 className="text-sm font-semibold text-hw-text">{name}</h2>
                </div>
                <span className="text-xs text-hw-muted">
                  {entries.length} {entries.length === 1 ? 'car' : 'cars'}
                </span>
                <div className="flex-1 h-px bg-hw-border" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {entries.map((entry) => (
                  entry.car && (
                    <CarCard
                      key={entry.id}
                      car={entry.car}
                      collectionEntry={entry}
                      onAddToWishlist={handleAddToWishlist}
                      onEditCarDetails={(car) => setCarDetailModal({ open: true, car, collectionEntry: entry })}
                    />
                  )
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* FAB on mobile */}
      <button
        onClick={() => setAddCarOpen(true)}
        className="
          md:hidden fixed bottom-20 right-4 w-14 h-14 rounded-full
          bg-hw-accent shadow-lg glow-accent
          flex items-center justify-center z-30
          active:scale-95 transition-transform
        "
      >
        <Plus className="w-6 h-6 text-white" />
      </button>

      {/* Modals */}
      <AddCarModal
        isOpen={addCarOpen}
        onClose={() => setAddCarOpen(false)}
        onSuccess={fetchData}
      />

      <AddToCollectionModal
        isOpen={collectionModal.open}
        onClose={() => setCollectionModal({ open: false, car: null })}
        car={collectionModal.car}
        existingEntry={collectionModal.entry}
        onSuccess={(updated) => {
          setCollection((prev) =>
            prev.map((e) => (e.id === updated.id ? { ...e, ...updated } : e))
          )
        }}
        onDeleted={(entryId) => {
          setCollection((prev) => prev.filter((e) => e.id !== entryId))
        }}
        onImageUploaded={(carId, imageUrl) => {
          setCollection((prev) =>
            prev.map((e) => e.car?.id === carId && e.car
              ? { ...e, car: { ...e.car, image_url: imageUrl } }
              : e
            )
          )
        }}
        onEditCarDetails={() => { setCarDetailModal({ open: true, car: collectionModal.car, collectionEntry: collectionModal.entry }); setCollectionModal({ open: false, car: null }) }}
      />

      <CarDetailModal
        isOpen={editCarModal.open}
        onClose={() => setCarDetailModal({ open: false, car: null })}
        car={editCarModal.car}
        collectionEntry={editCarModal.collectionEntry}
        onSuccess={(updated) => {
          setCollection(prev =>
            prev.map(e => e.car?.id === updated.id && e.car
              ? { ...e, car: { ...e.car, ...updated } }
              : e
            )
          )
          setCarDetailModal({ open: false, car: null })
        }}
        onCollectionUpdate={(updated) => {
          setCollection(prev =>
            prev.map(e => e.id === updated.id ? { ...e, ...updated } : e)
          )
        }}
        onDelete={(carId) => {
          setCollection(prev => prev.filter(e => e.car?.id !== carId))
          setCarDetailModal({ open: false, car: null })
        }}
      />
    </div>
  )
}
