import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Heart, Trash2, CheckCircle2, ImageIcon, Pencil, Check, X,
  ArrowUpDown, SlidersHorizontal,
} from 'lucide-react'
import { AddToCollectionModal } from '../components/AddToCollectionModal'
import { PageSpinner } from '../components/Spinner'
import { useSearch } from '../contexts/SearchContext'
import { useToastContext } from '../contexts/ToastContext'
import { getWishlist, removeFromWishlist, updateWishlistEntry } from '../lib/api'
import { useDebounce } from '../hooks/useDebounce'
import type { WishlistEntry, Car } from '../types'

// ── Priority config ───────────────────────────────────────────────────────────

const PRIORITY = {
  1: {
    label: 'High',
    short: 'H',
    border: 'border-l-hw-accent',
    dot: 'bg-hw-accent',
    badge: 'bg-hw-accent/15 text-hw-accent border-hw-accent/30',
    glow: 'shadow-[0_0_0_1px_rgba(var(--hw-accent-rgb)/0.25)]',
    ring: 'ring-hw-accent/40',
  },
  2: {
    label: 'Medium',
    short: 'M',
    border: 'border-l-amber-500',
    dot: 'bg-amber-500',
    badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    glow: 'shadow-[0_0_0_1px_rgba(245,158,11,0.2)]',
    ring: 'ring-amber-400/40',
  },
  3: {
    label: 'Low',
    short: 'L',
    border: 'border-l-zinc-600',
    dot: 'bg-zinc-500',
    badge: 'bg-zinc-800 text-zinc-400 border-zinc-600/50',
    glow: '',
    ring: 'ring-zinc-500/30',
  },
} as const

// ── WishlistCard ──────────────────────────────────────────────────────────────

function WishlistCard({
  entry,
  index,
  onRemove,
  onMoveToCollection,
  onPriorityChange,
  onNotesChange,
}: {
  entry: WishlistEntry
  index: number
  onRemove: (entry: WishlistEntry) => void
  onMoveToCollection: (car: Car) => void
  onPriorityChange: (entry: WishlistEntry, priority: number) => void
  onNotesChange: (entry: WishlistEntry, notes: string) => void
}) {
  const car = entry.car
  const [imgErr, setImgErr] = useState(false)
  const [gotIt, setGotIt] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  const [noteDraft, setNoteDraft] = useState(entry.notes ?? '')
  const noteRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { setNoteDraft(entry.notes ?? '') }, [entry.notes])
  useEffect(() => {
    if (editingNotes) noteRef.current?.focus()
  }, [editingNotes])

  if (!car) return null

  const p = (entry.priority in PRIORITY ? entry.priority : 2) as 1 | 2 | 3
  const cfg = PRIORITY[p]

  const handleGotIt = () => {
    setGotIt(true)
    setTimeout(() => onMoveToCollection(car), 420)
  }

  const saveNotes = () => {
    setEditingNotes(false)
    if (noteDraft !== (entry.notes ?? '')) onNotesChange(entry, noteDraft)
  }

  const typeLabel = car.car_type
    ? car.car_type === 'super treasure hunt' ? 'Super TH'
    : car.car_type === 'treasure hunt' ? 'TH'
    : car.car_type.charAt(0).toUpperCase() + car.car_type.slice(1)
    : null

  return (
    <div
      className={`
        animate-slide-up relative flex gap-3 p-3 rounded-xl
        bg-hw-surface border border-hw-border border-l-4 ${cfg.border}
        hover:bg-hw-surface-hover transition-all duration-200
        ${gotIt ? 'opacity-0 scale-95 pointer-events-none' : ''}
      `}
      style={{ animationDelay: `${index * 45}ms`, transition: 'opacity 0.35s ease, transform 0.35s ease, background-color 0.2s, border-color 0.2s' }}
    >
      {/* Thumbnail */}
      <div className="w-16 h-16 rounded-lg bg-zinc-900 flex-shrink-0 overflow-hidden border border-hw-border/50">
        {car.image_url && !imgErr ? (
          <img
            src={car.image_url}
            alt={car.name}
            className="w-full h-full object-contain"
            onError={() => setImgErr(true)}
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="w-5 h-5 text-zinc-700" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Name + badges */}
        <div className="flex items-start gap-1.5 flex-wrap pr-1">
          <span className="text-sm font-semibold text-hw-text leading-snug">{car.name}</span>
          {typeLabel && typeLabel !== 'Mainline' && (
            <span className={`inline-flex items-center px-1.5 py-px rounded text-[9px] font-bold border leading-none flex-shrink-0 ${
              p === 1 ? cfg.badge : 'bg-zinc-800 text-zinc-400 border-zinc-600/40'
            }`}>
              {typeLabel.toUpperCase()}
            </span>
          )}
        </div>

        {/* Meta */}
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {car.year && <span className="text-xs text-hw-muted">{car.year}</span>}
          {car.year && car.primary_color && <span className="text-[10px] text-hw-border">·</span>}
          {car.primary_color && <span className="text-xs text-hw-muted">{car.primary_color}</span>}
          {car.series && (
            <>
              <span className="text-[10px] text-hw-border">·</span>
              <span className="text-xs text-hw-muted truncate max-w-[140px]">{car.series.name}</span>
            </>
          )}
        </div>

        {/* Notes */}
        {editingNotes ? (
          <div className="mt-2 flex gap-1.5 items-start">
            <textarea
              ref={noteRef}
              value={noteDraft}
              onChange={e => setNoteDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveNotes() } if (e.key === 'Escape') setEditingNotes(false) }}
              rows={2}
              placeholder="Add a note…"
              className="input-field py-1 text-xs resize-none flex-1"
            />
            <div className="flex flex-col gap-1">
              <button onClick={saveNotes} className="w-6 h-6 rounded bg-hw-accent flex items-center justify-center">
                <Check className="w-3 h-3 text-white" />
              </button>
              <button onClick={() => setEditingNotes(false)} className="w-6 h-6 rounded border border-hw-border flex items-center justify-center text-hw-muted hover:text-hw-text">
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        ) : entry.notes ? (
          <button
            onClick={() => setEditingNotes(true)}
            className="mt-1.5 text-left group w-full"
          >
            <p className="text-[11px] text-hw-muted italic leading-relaxed border-l-2 border-hw-border pl-2 group-hover:border-hw-accent group-hover:text-hw-text-secondary transition-colors">
              {entry.notes}
            </p>
          </button>
        ) : null}

        {/* Priority pills */}
        <div className="flex items-center gap-1 mt-2">
          {([1, 2, 3] as const).map(n => {
            const nc = PRIORITY[n]
            const active = p === n
            return (
              <button
                key={n}
                onClick={() => !active && onPriorityChange(entry, n)}
                className={`h-5 px-2 rounded-full text-[10px] font-semibold border transition-all ${
                  active
                    ? `${nc.badge}`
                    : 'border-hw-border text-hw-muted/60 hover:border-hw-muted hover:text-hw-muted'
                }`}
              >
                {nc.label}
              </button>
            )
          })}
          <button
            onClick={() => setEditingNotes(true)}
            className="ml-1 w-5 h-5 rounded-full flex items-center justify-center text-hw-muted/40 hover:text-hw-muted hover:bg-hw-surface-hover transition-colors"
            title="Edit note"
          >
            <Pencil className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>

      {/* Right actions */}
      <div className="flex flex-col items-center gap-1.5 flex-shrink-0 justify-between">
        {/* Got it */}
        <button
          onClick={handleGotIt}
          className={`
            flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold
            border border-hw-accent/30 bg-hw-accent/10 text-hw-accent
            hover:bg-hw-accent hover:text-white hover:border-hw-accent
            transition-all duration-200
            ${gotIt ? 'animate-check-pop bg-hw-accent text-white' : ''}
          `}
          title="Got it — add to collection"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Got it</span>
        </button>

        {/* Remove */}
        <button
          onClick={() => onRemove(entry)}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-hw-muted/40 hover:text-red-400 hover:bg-red-900/20 transition-all"
          title="Remove from wishlist"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// ── WishlistPage ──────────────────────────────────────────────────────────────

export function WishlistPage() {
  const { searchQuery } = useSearch()
  const { toast } = useToastContext()
  const debouncedSearch = useDebounce(searchQuery, 300)

  const [wishlist, setWishlist] = useState<WishlistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'priority' | 'name' | 'date'>('priority')
  const [priorityFilter, setPriorityFilter] = useState<number | null>(null)

  const [collectionModal, setCollectionModal] = useState<{ open: boolean; car: Car | null }>({
    open: false, car: null,
  })

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

  useEffect(() => { fetchWishlist() }, [fetchWishlist])

  const handleRemove = useCallback(async (entry: WishlistEntry) => {
    try {
      await removeFromWishlist(entry.id)
      setWishlist(prev => prev.filter(e => e.id !== entry.id))
      toast.success('Removed from wishlist')
    } catch {
      toast.error('Failed to remove')
    }
  }, [toast])

  const handlePriorityChange = useCallback(async (entry: WishlistEntry, priority: number) => {
    try {
      const updated = await updateWishlistEntry(entry.id, { priority })
      setWishlist(prev => prev.map(e => e.id === updated.id ? { ...e, priority: updated.priority } : e))
    } catch {
      toast.error('Failed to update priority')
    }
  }, [toast])

  const handleNotesChange = useCallback(async (entry: WishlistEntry, notes: string) => {
    try {
      const updated = await updateWishlistEntry(entry.id, { notes })
      setWishlist(prev => prev.map(e => e.id === updated.id ? { ...e, notes: updated.notes } : e))
    } catch {
      toast.error('Failed to save note')
    }
  }, [toast])

  const filteredAndSorted = useMemo(() => {
    let items = [...wishlist]
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase()
      items = items.filter(e => {
        const car = e.car
        if (!car) return false
        return car.name.toLowerCase().includes(q) || car.series?.name.toLowerCase().includes(q)
      })
    }
    if (priorityFilter !== null) {
      items = items.filter(e => e.priority === priorityFilter)
    }
    items.sort((a, b) => {
      switch (sortBy) {
        case 'priority': return a.priority - b.priority
        case 'name':     return (a.car?.name ?? '').localeCompare(b.car?.name ?? '')
        case 'date':     return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        default: return 0
      }
    })
    return items
  }, [wishlist, debouncedSearch, sortBy, priorityFilter])

  const groupedByPriority = useMemo(() => {
    if (sortBy !== 'priority') return null
    const groups: Record<number, WishlistEntry[]> = { 1: [], 2: [], 3: [] }
    filteredAndSorted.forEach(e => {
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

  const counts = { 1: wishlist.filter(e => e.priority === 1).length, 2: wishlist.filter(e => e.priority === 2).length, 3: wishlist.filter(e => e.priority === 3).length }

  // Global index for stagger delay
  let cardIdx = 0

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto pb-12">

      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-hw-text">Wishlist</h1>
          <p className="text-xs text-hw-muted mt-0.5">
            {wishlist.length} {wishlist.length === 1 ? 'car' : 'cars'} · {counts[1]} high priority
          </p>
        </div>

        {/* Sort */}
        <div className="flex items-center gap-1 bg-hw-surface border border-hw-border rounded-xl p-1">
          {(['priority', 'name', 'date'] as const).map(s => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                sortBy === s
                  ? 'bg-hw-accent text-white'
                  : 'text-hw-muted hover:text-hw-text'
              }`}
            >
              {s === 'priority' ? <SlidersHorizontal className="w-3.5 h-3.5" /> : s === 'name' ? 'A–Z' : <ArrowUpDown className="w-3.5 h-3.5" />}
            </button>
          ))}
        </div>
      </div>

      {/* ── Priority filter ── */}
      {wishlist.length > 0 && (
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <button
            onClick={() => setPriorityFilter(null)}
            className={`h-7 px-3 rounded-full text-xs font-medium border transition-all ${
              priorityFilter === null
                ? 'bg-hw-accent/15 text-hw-accent border-hw-accent/30'
                : 'border-hw-border text-hw-muted hover:text-hw-text'
            }`}
          >
            All · {wishlist.length}
          </button>
          {([1, 2, 3] as const).map(p => {
            const cfg = PRIORITY[p]
            return (
              <button
                key={p}
                onClick={() => setPriorityFilter(priorityFilter === p ? null : p)}
                className={`h-7 px-3 rounded-full text-xs font-medium border flex items-center gap-1.5 transition-all ${
                  priorityFilter === p
                    ? cfg.badge
                    : 'border-hw-border text-hw-muted hover:text-hw-text'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                {cfg.label} · {counts[p]}
              </button>
            )
          })}
        </div>
      )}

      {/* ── Empty state ── */}
      {filteredAndSorted.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="w-16 h-16 rounded-2xl border border-hw-border flex items-center justify-center">
            <Heart className="w-7 h-7 text-hw-muted" />
          </div>
          <div className="text-center">
            <p className="font-semibold text-hw-text mb-1">
              {debouncedSearch ? 'No matches' : 'Nothing on your wishlist yet'}
            </p>
            <p className="text-xs text-hw-muted max-w-xs">
              {debouncedSearch
                ? 'Try a different search term'
                : 'Browse All Cars and tap the heart icon to save cars you want'}
            </p>
          </div>
        </div>
      )}

      {/* ── List ── */}
      {filteredAndSorted.length > 0 && (
        <div className="space-y-5">
          {groupedByPriority ? (
            ([1, 2, 3] as const).map(p => {
              const items = groupedByPriority[p]
              if (!items.length) return null
              const cfg = PRIORITY[p]
              return (
                <div key={p}>
                  {/* Section header */}
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                    <span className="text-[11px] font-bold text-hw-muted uppercase tracking-widest">
                      {cfg.label}
                    </span>
                    <span className="text-[11px] text-hw-border ml-0.5">({items.length})</span>
                  </div>

                  <div className="space-y-2">
                    {items.map(entry => {
                      const i = cardIdx++
                      return (
                        <WishlistCard
                          key={entry.id}
                          entry={entry}
                          index={i}
                          onRemove={handleRemove}
                          onMoveToCollection={car => setCollectionModal({ open: true, car })}
                          onPriorityChange={handlePriorityChange}
                          onNotesChange={handleNotesChange}
                        />
                      )
                    })}
                  </div>
                </div>
              )
            })
          ) : (
            <div className="space-y-2">
              {filteredAndSorted.map((entry, i) => (
                <WishlistCard
                  key={entry.id}
                  entry={entry}
                  index={i}
                  onRemove={handleRemove}
                  onMoveToCollection={car => setCollectionModal({ open: true, car })}
                  onPriorityChange={handlePriorityChange}
                  onNotesChange={handleNotesChange}
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
        onSuccess={entry => {
          const wishEntry = wishlist.find(e => e.allcars_id === entry.allcars_id)
          if (wishEntry) {
            removeFromWishlist(wishEntry.id)
              .then(() => setWishlist(prev => prev.filter(e => e.id !== wishEntry.id)))
              .catch(() => {})
          }
          toast.success('Moved to collection!')
        }}
      />
    </div>
  )
}
