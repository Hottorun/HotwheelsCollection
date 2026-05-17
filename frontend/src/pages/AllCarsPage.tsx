import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Plus,
  Library,
  SlidersHorizontal,
  X,
  LayoutGrid,
  Layers,
  Upload,
  Trash2,
  CopyCheck,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { CarCard } from '../components/CarCard'
import { AddCarModal } from '../components/AddCarModal'
import { AddToCollectionModal } from '../components/AddToCollectionModal'
import { CarDetailModal } from '../components/CarDetailModal'
import { PageSpinner } from '../components/Spinner'
import { useSearch } from '../contexts/SearchContext'
import { useToastContext } from '../contexts/ToastContext'
import {
  getCars,
  getCollection,
  getAllSeries,
  addToWishlist,
  removeFromWishlist,
  getWishlist,
  deleteCar,
} from '../lib/api'
import { useDebounce } from '../hooks/useDebounce'
import type { Car, CollectionEntry, WishlistEntry, Series } from '../types'

const CAR_TYPES = ['', 'mainline', 'premium', 'special mainline', 'collector']

export function AllCarsPage() {
  const { searchQuery, clearSearch } = useSearch()
  const { toast } = useToastContext()
  const navigate = useNavigate()
  const debouncedSearch = useDebounce(searchQuery, 300)

  const [cars, setCars] = useState<Car[]>([])
  const [collection, setCollection] = useState<CollectionEntry[]>([])
  const [wishlist, setWishlist] = useState<WishlistEntry[]>([])
  const [series, setSeries] = useState<Series[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [totalItems, setTotalItems] = useState(0)

  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState({
    series_id: '',
    year: '',
    type: '',
    treasure_hunt: '',
  })

  const [viewMode, setViewMode] = useState<'grid' | 'series'>('grid')
  const [duplicateMode, setDuplicateMode] = useState(false)
  const [resolvingDuplicates, setResolvingDuplicates] = useState(false)
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const [wishlistPending, setWishlistPending] = useState<Set<string>>(new Set())
  const [addCarOpen, setAddCarOpen] = useState(false)
  const [collectionModal, setCollectionModal] = useState<{
    open: boolean
    car: Car | null
    entry?: CollectionEntry
  }>({ open: false, car: null })
  const [editCarModal, setCarDetailModal] = useState<{ open: boolean; car: Car | null; collectionEntry?: CollectionEntry }>({ open: false, car: null })

  const collectionMap = useMemo(() => {
    const map = new Map<string, CollectionEntry>()
    collection.forEach((e) => map.set(e.allcars_id, e))
    return map
  }, [collection])

  const wishlistMap = useMemo(() => {
    const map = new Map<string, WishlistEntry>()
    wishlist.forEach((e) => map.set(e.allcars_id, e))
    return map
  }, [wishlist])

  const groupedBySeries = useMemo(() => {
    const groups: Record<string, { name: string; cars: Car[] }> = {}
    cars.forEach(car => {
      const key = car.series_id || '__none__'
      const name = car.series?.name || 'No Series'
      if (!groups[key]) groups[key] = { name, cars: [] }
      groups[key].cars.push(car)
    })
    return Object.entries(groups)
      .map(([key, { name, cars }]) => ({ key, name, cars }))
      .sort((a, b) => {
        if (a.key === '__none__') return 1
        if (b.key === '__none__') return -1
        return a.name.localeCompare(b.name)
      })
  }, [cars])

  const duplicateGroups = useMemo(() => {
    const normalize = (value?: string | number) =>
      String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

    const keyFor = (car: Car) => {
      const toy = normalize(car.toy_number)
      if (toy) return `toy:${toy}`
      return [
        'sig',
        normalize(car.name),
        normalize(car.year),
        normalize(car.primary_color),
        normalize(car.series_id),
      ].join('|')
    }

    const groups = new Map<string, Car[]>()
    cars.forEach((car) => {
      const key = keyFor(car)
      const list = groups.get(key) ?? []
      list.push(car)
      groups.set(key, list)
    })

    return [...groups.values()]
      .filter((group) => group.length > 1)
      .sort((a, b) => a[0].name.localeCompare(b[0].name))
  }, [cars])

  const duplicateCars = useMemo(
    () => duplicateGroups.flatMap((group) => group),
    [duplicateGroups]
  )

  const handleDeleteDuplicate = useCallback(async (car: Car) => {
    if (deletingIds.has(car.id)) return
    const ok = window.confirm(`Delete "${car.name}" from All Cars? This also removes matching collection and wishlist rows.`)
    if (!ok) return
    setDeletingIds((prev) => new Set(prev).add(car.id))
    try {
      await deleteCar(car.id)
      setCars((prev) => prev.filter((c) => c.id !== car.id))
      setCollection((prev) => prev.filter((e) => e.allcars_id !== car.id))
      setWishlist((prev) => prev.filter((e) => e.allcars_id !== car.id))
      toast.success('Duplicate deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete duplicate')
    } finally {
      setDeletingIds((prev) => { const next = new Set(prev); next.delete(car.id); return next })
    }
  }, [deletingIds, toast])

  const fetchCars = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = {
        page: 1,
        page_size: 9999,
        ...(debouncedSearch && { search: debouncedSearch }),
        ...(filters.series_id && { series_id: filters.series_id }),
        ...(filters.year && { year: filters.year }),
        ...(filters.type && { type: filters.type }),
        ...(filters.treasure_hunt && { treasure_hunt: filters.treasure_hunt }),
      }
      const data = await getCars(params)
      const items = Array.isArray(data) ? data : (data.items ?? [])
      const total = Array.isArray(data) ? items.length : (data.total ?? 0)
      setCars(items)
      setTotalItems(total)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cars')
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, filters])

  const fetchSideData = useCallback(async () => {
    try {
      const [col, wish, ser] = await Promise.all([
        getCollection(),
        getWishlist(),
        getAllSeries(),
      ])
      setCollection(col)
      setWishlist(wish)
      setSeries(ser)
    } catch {
      // non-critical
    }
  }, [])

  useEffect(() => {
    fetchSideData()
  }, [fetchSideData])

  useEffect(() => {
    fetchCars()
  }, [fetchCars])

  const handleAddToWishlist = useCallback(
    async (car: Car) => {
      if (wishlistPending.has(car.id)) return
      setWishlistPending((prev) => new Set(prev).add(car.id))
      try {
        const entry = await addToWishlist({ allcars_id: car.id, priority: 2 })
        setWishlist((prev) => [...prev, entry])
        toast.success(`"${car.name}" added to wishlist`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to add to wishlist')
      } finally {
        setWishlistPending((prev) => { const s = new Set(prev); s.delete(car.id); return s })
      }
    },
    [toast, wishlistPending]
  )

  const handleRemoveFromWishlist = useCallback(
    async (entry: WishlistEntry) => {
      if (wishlistPending.has(entry.allcars_id)) return
      setWishlistPending((prev) => new Set(prev).add(entry.allcars_id))
      try {
        await removeFromWishlist(entry.id)
        setWishlist((prev) => prev.filter((e) => e.id !== entry.id))
        toast.success('Removed from wishlist')
      } catch {
        toast.error('Failed to remove from wishlist')
      } finally {
        setWishlistPending((prev) => { const s = new Set(prev); s.delete(entry.allcars_id); return s })
      }
    },
    [toast, wishlistPending]
  )

  const activeFilterCount = [
    filters.series_id,
    filters.year,
    filters.type,
    filters.treasure_hunt,
  ].filter(Boolean).length

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-hw-text">All Cars</h1>
          <p className="text-hw-text-secondary text-sm mt-0.5">
            {totalItems.toLocaleString()} cars in the catalog
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/bulk-add')}
            className="btn-secondary"
            title="Bulk Import"
          >
            <Upload className="w-4 h-4" />
            <span className="hidden sm:inline">Import</span>
          </button>
          <button
            onClick={() => {
              setDuplicateMode((v) => {
                const next = !v
                if (!next) setResolvingDuplicates(false)
                return next
              })
              setFilters({ series_id: '', year: '', type: '', treasure_hunt: '' })
              clearSearch()
            }}
            className={`btn-secondary ${duplicateMode ? 'border-hw-accent text-hw-accent' : ''}`}
            title="Show duplicate cars"
          >
            <CopyCheck className="w-4 h-4" />
            <span className="hidden sm:inline">Duplicates</span>
            {duplicateGroups.length > 0 && (
              <span className="text-xs font-semibold">{duplicateGroups.length}</span>
            )}
          </button>
          <button onClick={() => setAddCarOpen(true)} className="btn-primary">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Car</span>
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          onClick={() => setShowFilters(!showFilters)}
          disabled={duplicateMode}
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

        {/* View mode toggle */}
        <div className="flex rounded-lg border border-hw-border overflow-hidden">
          <button
            onClick={() => setViewMode('grid')}
            className={`px-2.5 py-1.5 flex items-center gap-1.5 text-xs transition-colors ${viewMode === 'grid' ? 'bg-hw-accent text-white' : 'text-hw-muted hover:text-hw-text'}`}
            title="Grid view"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setViewMode('series')}
            className={`px-2.5 py-1.5 flex items-center gap-1.5 text-xs transition-colors ${viewMode === 'series' ? 'bg-hw-accent text-white' : 'text-hw-muted hover:text-hw-text'}`}
            title="By series"
          >
            <Layers className="w-3.5 h-3.5" />
          </button>
        </div>

        {duplicateMode && (
          <span className="text-xs text-hw-muted">
            {duplicateCars.length} duplicate entries in {duplicateGroups.length} group{duplicateGroups.length !== 1 ? 's' : ''}
          </span>
        )}

        {duplicateMode && duplicateGroups.length > 0 && (
          <button
            onClick={() => setResolvingDuplicates((v) => !v)}
            className={`btn-secondary text-sm py-1.5 px-3 ${resolvingDuplicates ? 'border-red-700 text-red-400' : ''}`}
          >
            <Trash2 className="w-4 h-4" />
            {resolvingDuplicates ? 'Done resolving' : 'Resolve duplicates'}
          </button>
        )}
      </div>

      {/* Expanded filters */}
      {showFilters && !duplicateMode && (
        <div className="p-4 bg-hw-surface border border-hw-border rounded-xl mb-4 grid grid-cols-1 sm:grid-cols-4 gap-3 animate-fade-in">
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
              placeholder="2024"
              min="1968"
              max={new Date().getFullYear() + 2}
            />
          </div>
          <div>
            <label className="label">Type</label>
            <select
              value={filters.type}
              onChange={(e) => setFilters((p) => ({ ...p, type: e.target.value }))}
              className="input-field"
            >
              {CAR_TYPES.map((t) => (
                <option key={t} value={t}>{t || 'All Types'}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Treasure Hunt</label>
            <select
              value={filters.treasure_hunt}
              onChange={(e) => setFilters((p) => ({ ...p, treasure_hunt: e.target.value }))}
              className="input-field"
            >
              <option value="">All</option>
              <option value="true">Treasure Hunts Only</option>
              <option value="false">Regular Cars</option>
            </select>
          </div>
          {activeFilterCount > 0 && (
            <div className="sm:col-span-4 flex justify-end">
              <button
                onClick={() => setFilters({ series_id: '', year: '', type: '', treasure_hunt: '' })}
                className="btn-ghost text-xs text-hw-accent hover:text-hw-orange"
              >
                <X className="w-3.5 h-3.5" />
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && <PageSpinner />}

      {/* Error */}
      {error && !loading && (
        <div className="flex flex-col items-center justify-center gap-4 h-64">
          <p className="text-hw-text-secondary">{error}</p>
          <button onClick={fetchCars} className="btn-primary">Retry</button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && (duplicateMode ? duplicateGroups.length === 0 : cars.length === 0) && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-16 h-16 rounded-2xl bg-hw-surface-hover flex items-center justify-center">
            {duplicateMode ? <CopyCheck className="w-8 h-8 text-hw-muted" /> : <Library className="w-8 h-8 text-hw-muted" />}
          </div>
          <div className="text-center">
            <h3 className="font-semibold text-hw-text mb-1">{duplicateMode ? 'No duplicates found' : 'No cars found'}</h3>
            <p className="text-hw-text-secondary text-sm">
              {duplicateMode
                ? 'All visible catalog entries look unique'
                : debouncedSearch || activeFilterCount > 0
                ? 'Try adjusting your search or filters'
                : 'The catalog is empty — add the first car!'}
            </p>
          </div>
          {!duplicateMode && !debouncedSearch && activeFilterCount === 0 && (
            <button onClick={() => setAddCarOpen(true)} className="btn-primary">
              <Plus className="w-4 h-4" />
              Add first car
            </button>
          )}
        </div>
      )}

      {/* Duplicates */}
      {!loading && !error && duplicateMode && duplicateGroups.length > 0 && (
        <div className="space-y-8">
          {resolvingDuplicates && (
            <div className="rounded-xl border border-red-800/50 bg-red-950/20 px-4 py-3 text-sm text-red-200">
              Delete removes the car from All Cars and also clears matching collection and wishlist rows.
            </div>
          )}
          {duplicateGroups.map((group, groupIndex) => (
            <div key={`${group[0].name}-${groupIndex}`}>
              <div className="flex items-center gap-3 mb-3">
                <h3 className="text-sm font-semibold text-hw-text-secondary uppercase tracking-wider truncate">
                  {group[0].toy_number ? `Toy # ${group[0].toy_number}` : group[0].name}
                </h3>
                <span className="text-xs text-hw-muted">{group.length} entries</span>
                <div className="flex-1 h-px bg-hw-border" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {group.map((car) => (
                  <div key={car.id} className="relative">
                    <CarCard
                      car={car}
                      collectionEntry={collectionMap.get(car.id)}
                      wishlistEntry={wishlistMap.get(car.id)}
                      wishlistPending={wishlistPending.has(car.id)}
                      onAddToCollection={(c) => setCollectionModal({ open: true, car: c, entry: collectionMap.get(c.id) })}
                      onAddToWishlist={handleAddToWishlist}
                      onRemoveFromWishlist={handleRemoveFromWishlist}
                      onEditCarDetails={(c) => setCarDetailModal({ open: true, car: c, collectionEntry: collectionMap.get(c.id) })}
                    />
                    {resolvingDuplicates && (
                      <button
                        onClick={() => handleDeleteDuplicate(car)}
                        disabled={deletingIds.has(car.id)}
                        className="absolute top-2 right-2 z-10 w-8 h-8 rounded-full bg-red-950/80 border border-red-700/50 text-red-300 flex items-center justify-center hover:bg-red-900 disabled:opacity-50 transition-colors"
                        title="Delete from All Cars"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Cars (grid or by-series) */}
      {!loading && !error && !duplicateMode && cars.length > 0 && (
        viewMode === 'series' ? (
          <div className="space-y-8">
            {groupedBySeries.map(({ key, name, cars: groupCars }) => (
              <div key={key}>
                <div className="flex items-center gap-3 mb-3">
                  <h3 className="text-sm font-semibold text-hw-text-secondary uppercase tracking-wider">{name}</h3>
                  <span className="text-xs text-hw-muted">{groupCars.length}</span>
                  <div className="flex-1 h-px bg-hw-border" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {groupCars.map(car => (
                    <CarCard
                      key={car.id}
                      car={car}
                      collectionEntry={collectionMap.get(car.id)}
                      wishlistEntry={wishlistMap.get(car.id)}
                      wishlistPending={wishlistPending.has(car.id)}
                      onAddToCollection={(c) => setCollectionModal({ open: true, car: c, entry: collectionMap.get(c.id) })}
                      onAddToWishlist={handleAddToWishlist}
                      onRemoveFromWishlist={handleRemoveFromWishlist}
                      onEditCarDetails={(c) => setCarDetailModal({ open: true, car: c, collectionEntry: collectionMap.get(c.id) })}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {cars.map((car) => (
              <CarCard
                key={car.id}
                car={car}
                collectionEntry={collectionMap.get(car.id)}
                wishlistEntry={wishlistMap.get(car.id)}
                wishlistPending={wishlistPending.has(car.id)}
                onAddToCollection={(c) =>
                  setCollectionModal({
                    open: true,
                    car: c,
                    entry: collectionMap.get(c.id),
                  })
                }
                onAddToWishlist={handleAddToWishlist}
                onRemoveFromWishlist={handleRemoveFromWishlist}
                onEditCarDetails={(c) => setCarDetailModal({ open: true, car: c, collectionEntry: collectionMap.get(c.id) })}
              />
            ))}
          </div>
        )
      )}

      {/* FAB */}
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
        onSuccess={() => { fetchCars(); fetchSideData() }}
      />

      <AddToCollectionModal
        isOpen={collectionModal.open}
        onClose={() => setCollectionModal({ open: false, car: null })}
        car={collectionModal.car}
        existingEntry={collectionModal.entry}
        onSuccess={(entry) => {
          setCollection((prev) => {
            const exists = prev.find((e) => e.id === entry.id)
            if (exists) return prev.map((e) => (e.id === entry.id ? { ...e, ...entry } : e))
            return [...prev, entry]
          })
        }}
        onDeleted={(entryId) => {
          setCollection((prev) => prev.filter((e) => e.id !== entryId))
        }}
        onImageUploaded={(carId, imageUrl) => {
          setCars((prev) => prev.map((c) => c.id === carId ? { ...c, image_url: imageUrl } : c))
        }}
        onEditCarDetails={() => { setCarDetailModal({ open: true, car: collectionModal.car }); setCollectionModal({ open: false, car: null }) }}
      />

      <CarDetailModal
        isOpen={editCarModal.open}
        onClose={() => setCarDetailModal({ open: false, car: null })}
        car={editCarModal.car}
        collectionEntry={editCarModal.collectionEntry}
        onSuccess={(updated) => {
          setCars(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c))
          setCarDetailModal({ open: false, car: null })
        }}
        onCollectionUpdate={(entry) => {
          setCollection(prev => prev.map(e => e.id === entry.id ? { ...e, ...entry } : e))
        }}
        onDelete={(carId) => {
          setCars(prev => prev.filter(c => c.id !== carId))
          setCollection(prev => prev.filter(e => e.allcars_id !== carId))
          setCarDetailModal({ open: false, car: null })
        }}
      />
    </div>
  )
}
