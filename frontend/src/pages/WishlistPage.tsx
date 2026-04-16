import { useState, useEffect, useCallback, useMemo } from 'react'
import { Heart, Trash2, CheckCircle2 } from 'lucide-react'
import { AddToCollectionModal } from '../components/AddToCollectionModal'
import { PageSpinner } from '../components/Spinner'
import { useSearch } from '../contexts/SearchContext'
import { useToastContext } from '../contexts/ToastContext'
import { getWishlist, removeFromWishlist, updateWishlistEntry } from '../lib/api'
import { useDebounce } from '../hooks/useDebounce'
import type { WishlistEntry, Car } from '../types'

const PRIORITY_CONFIG = {
  1: { label: 'High', color: 'bg-hw-accent/20 text-hw-accent border border-hw-accent/30', dot: 'bg-hw-accent' },
  2: { label: 'Medium', color: 'bg-orange-500/20 text-orange-400 border border-orange-500/30', dot: 'bg-orange-500' },
  3: { label: 'Low', color: 'bg-zinc-700 text-zinc-400 border border-zinc-600', dot: 'bg-zinc-500' },
}

interface WishlistCardProps {
  entry: WishlistEntry
  onRemove: (entry: WishlistEntry) => void
  onMoveToCollection: (car: Car) => void
  onPriorityChange: (entry: WishlistEntry, priority: number) => void
}

function WishlistCard({ entry, onRemove, onMoveToCollection, onPriorityChange }: WishlistCardProps) {
  const car = entry.car
  if (!car) return null

  const priority = entry.priority as 1 | 2 | 3
  const pConfig = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG[2]

  return (
    <div className="card card-hover p-4 flex items-start gap-4">
      {/* Priority indicator */}
      <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${pConfig.dot}`} />

      {/* Car info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2 flex-wrap">
          <h3 className="font-semibold text-sm text-hw-text leading-tight">{car.name}</h3>
          {car.treasure_hunt && (
            <span className="badge bg-yellow-500/20 text-yellow-400 border border-yellow-600/30 text-[10px]">
              🔥 TH
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {car.series && (
            <span className="text-xs text-hw-muted">{car.series.name}</span>
          )}
          {car.year && (
            <span className="text-xs text-hw-border">•</span>
          )}
          {car.year && <span className="text-xs text-hw-muted">{car.year}</span>}
          {car.car_type && (
            <>
              <span className="text-xs text-hw-border">•</span>
              <span className="text-xs text-hw-muted capitalize">{car.car_type}</span>
            </>
          )}
        </div>

        {entry.notes && (
          <p className="text-xs text-hw-muted mt-1.5 italic">{entry.notes}</p>
        )}

        {/* Priority selector */}
        <div className="flex items-center gap-1.5 mt-2">
          <span className="text-xs text-hw-muted">Priority:</span>
          {([1, 2, 3] as const).map((p) => {
            const cfg = PRIORITY_CONFIG[p]
            return (
              <button
                key={p}
                onClick={() => onPriorityChange(entry, p)}
                className={`
                  px-2 py-0.5 rounded-full text-xs font-medium border transition-all
                  ${entry.priority === p ? cfg.color : 'border-transparent text-hw-muted hover:text-hw-text'}
                `}
              >
                {cfg.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          onClick={() => onMoveToCollection(car)}
          className="
            flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
            bg-hw-accent/10 text-hw-accent border border-hw-accent/20
            hover:bg-hw-accent hover:text-white
            transition-all duration-200
          "
          title="Add to collection"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Got it!</span>
        </button>
        <button
          onClick={() => onRemove(entry)}
          className="
            w-8 h-8 rounded-lg flex items-center justify-center
            text-hw-muted hover:text-hw-accent hover:bg-hw-accent/10
            transition-all duration-200
          "
          title="Remove from wishlist"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

export function WishlistPage() {
  const { searchQuery } = useSearch()
  const { toast } = useToastContext()
  const debouncedSearch = useDebounce(searchQuery, 300)

  const [wishlist, setWishlist] = useState<WishlistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'priority' | 'name' | 'date'>('priority')
  const [priorityFilter, setPriorityFilter] = useState<number | null>(null)

  const [collectionModal, setCollectionModal] = useState<{
    open: boolean
    car: Car | null
  }>({ open: false, car: null })

  const fetchWishlist = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getWishlist()
      setWishlist(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load wishlist')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchWishlist()
  }, [fetchWishlist])

  const handleRemove = useCallback(
    async (entry: WishlistEntry) => {
      try {
        await removeFromWishlist(entry.id)
        setWishlist((prev) => prev.filter((e) => e.id !== entry.id))
        toast.success('Removed from wishlist')
      } catch {
        toast.error('Failed to remove from wishlist')
      }
    },
    [toast]
  )

  const handlePriorityChange = useCallback(
    async (entry: WishlistEntry, priority: number) => {
      try {
        const updated = await updateWishlistEntry(entry.id, { priority })
        setWishlist((prev) =>
          prev.map((e) => (e.id === updated.id ? { ...e, priority: updated.priority } : e))
        )
      } catch {
        toast.error('Failed to update priority')
      }
    },
    [toast]
  )

  const filteredAndSorted = useMemo(() => {
    let items = [...wishlist]

    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase()
      items = items.filter((e) => {
        const car = e.car
        if (!car) return false
        return (
          car.name.toLowerCase().includes(q) ||
          car.series?.name.toLowerCase().includes(q)
        )
      })
    }

    if (priorityFilter !== null) {
      items = items.filter((e) => e.priority === priorityFilter)
    }

    items.sort((a, b) => {
      switch (sortBy) {
        case 'priority':
          return a.priority - b.priority
        case 'name':
          return (a.car?.name ?? '').localeCompare(b.car?.name ?? '')
        case 'date':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        default:
          return 0
      }
    })

    return items
  }, [wishlist, debouncedSearch, sortBy])

  const groupedByPriority = useMemo(() => {
    if (sortBy !== 'priority') return null
    const groups: Record<number, WishlistEntry[]> = { 1: [], 2: [], 3: [] }
    filteredAndSorted.forEach((e) => {
      const p = e.priority in groups ? e.priority : 3
      groups[p].push(e)
    })
    return groups
  }, [filteredAndSorted, sortBy])

  if (loading) return <PageSpinner />

  if (error) {
    return (
      <div className="p-6 flex flex-col items-center justify-center gap-4 h-64">
        <p className="text-hw-text-secondary">{error}</p>
        <button onClick={fetchWishlist} className="btn-primary">Retry</button>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-hw-text">Wishlist</h1>
          <p className="text-hw-text-secondary text-sm mt-0.5">
            {wishlist.length} {wishlist.length === 1 ? 'car' : 'cars'} on your list
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-hw-muted hidden sm:block">Sort:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="input-field w-auto text-sm py-1.5"
          >
            <option value="priority">By Priority</option>
            <option value="name">By Name</option>
            <option value="date">By Date Added</option>
          </select>
        </div>
      </div>

      {/* Priority filter tabs */}
      {wishlist.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <button
            onClick={() => setPriorityFilter(null)}
            className={`badge text-xs transition-all ${priorityFilter === null ? 'bg-hw-accent/20 text-hw-accent border border-hw-accent/40' : 'border-hw-border text-hw-muted hover:text-hw-text'}`}
          >
            All ({wishlist.length})
          </button>
          {([1, 2, 3] as const).map((p) => {
            const cfg = PRIORITY_CONFIG[p]
            const count = wishlist.filter((e) => e.priority === p).length
            return (
              <button
                key={p}
                onClick={() => setPriorityFilter(priorityFilter === p ? null : p)}
                className={`badge text-xs transition-all ${priorityFilter === p ? cfg.color : 'border-hw-border text-hw-muted hover:text-hw-text'}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                {cfg.label} ({count})
              </button>
            )
          })}
        </div>
      )}

      {/* Empty state */}
      {filteredAndSorted.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-16 h-16 rounded-2xl bg-hw-surface-hover flex items-center justify-center">
            <Heart className="w-8 h-8 text-hw-muted" />
          </div>
          <div className="text-center">
            <h3 className="font-semibold text-hw-text mb-1">
              {debouncedSearch ? 'No matches' : 'Your wishlist is empty'}
            </h3>
            <p className="text-hw-text-secondary text-sm">
              {debouncedSearch
                ? 'Try a different search'
                : 'Browse All Cars and tap the heart to add cars you want'}
            </p>
          </div>
        </div>
      )}

      {/* Grouped or flat list */}
      {filteredAndSorted.length > 0 && (
        <div className="space-y-6">
          {groupedByPriority ? (
            ([1, 2, 3] as const).map((p) => {
              const items = groupedByPriority[p]
              if (!items.length) return null
              const cfg = PRIORITY_CONFIG[p]
              return (
                <div key={p}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                    <h2 className="text-sm font-semibold text-hw-text-secondary uppercase tracking-wider">
                      {cfg.label} Priority
                    </h2>
                    <span className="text-xs text-hw-muted">({items.length})</span>
                  </div>
                  <div className="space-y-2">
                    {items.map((entry) => (
                      <WishlistCard
                        key={entry.id}
                        entry={entry}
                        onRemove={handleRemove}
                        onMoveToCollection={(car) =>
                          setCollectionModal({ open: true, car })
                        }
                        onPriorityChange={handlePriorityChange}
                      />
                    ))}
                  </div>
                </div>
              )
            })
          ) : (
            <div className="space-y-2">
              {filteredAndSorted.map((entry) => (
                <WishlistCard
                  key={entry.id}
                  entry={entry}
                  onRemove={handleRemove}
                  onMoveToCollection={(car) =>
                    setCollectionModal({ open: true, car })
                  }
                  onPriorityChange={handlePriorityChange}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add to collection modal */}
      <AddToCollectionModal
        isOpen={collectionModal.open}
        onClose={() => setCollectionModal({ open: false, car: null })}
        car={collectionModal.car}
        onSuccess={(entry) => {
          // Remove from wishlist after adding to collection
          const wishEntry = wishlist.find((e) => e.allcars_id === entry.allcars_id)
          if (wishEntry) {
            removeFromWishlist(wishEntry.id)
              .then(() => setWishlist((prev) => prev.filter((e) => e.id !== wishEntry.id)))
              .catch(() => {})
          }
          toast.success('Moved to collection!')
        }}
      />
    </div>
  )
}
