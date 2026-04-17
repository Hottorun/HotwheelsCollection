import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ChevronLeft, ChevronRight, Loader2, ImageIcon, RefreshCw,
  CheckCircle2, Check, X, ExternalLink, Layers, BookmarkPlus,
  BookmarkCheck, ChevronsRight, Search, ChevronDown, EyeOff,
} from 'lucide-react'
import {
  getFeed, scrapeCar, createCar, getCars,
  addToCollection as apiAddToCollection,
  getAllSeries, createSeries,
  type ScrapedCar, type ScrapedVersion, type FeedFilters,
} from '../lib/api'
import { useToastContext } from '../contexts/ToastContext'
import type { Series } from '../types'

type ItemState = 'idle' | 'adding' | 'added' | 'skipped'

type VersionEdit = {
  year?: string
  color?: string
  series_name?: string
  set_number?: string
  series_number?: string
  toy_number?: string
  car_type?: string
}

const SERIES_TYPES = [
  { value: 'mainline', label: 'Mainline' },
  { value: 'premium', label: 'Premium' },
  { value: 'collector', label: 'Collector' },
  { value: 'treasure hunt', label: 'TH' },
  { value: 'super treasure hunt', label: 'Super TH' },
] as const

// Auto-infer series type from series name keywords
function inferSeriesType(name: string): string | null {
  const n = name.toLowerCase()
  if (/car culture|boulevard|pop culture|fast.{0,3}furious|hw exotics|hw premium|retro entertainment|detroit muscle|speed machines|pantone|hw id\b/i.test(n)) return 'premium'
  if (/\bcollector\b|rlc|red line club|hw collector/i.test(n)) return 'collector'
  if (/\bsuper treasure hunt\b|super th\b/i.test(n)) return 'super treasure hunt'
  if (/\btreasure hunt\b|\bth\b/i.test(n)) return 'treasure hunt'
  return null
}

// ── Version approve row ───────────────────────────────────────────────────────

function VersionApproveRow({
  castingImageUrl,
  version,
  state,
  addToCollection,
  onToggleCollection,
  isEditing,
  onEditToggle,
  edit,
  onEditChange,
  onApprove,
  onSkip,
  allSeries,
}: {
  castingImageUrl?: string
  version: ScrapedVersion | null
  state: ItemState
  addToCollection: boolean
  onToggleCollection: () => void
  isEditing: boolean
  onEditToggle: () => void
  edit: VersionEdit
  onEditChange: (patch: Partial<VersionEdit>) => void
  onApprove: () => void
  onSkip: () => void
  allSeries: Series[]
}) {
  const [imgErr, setImgErr] = useState(false)
  const [showSeriesPicker, setShowSeriesPicker] = useState(false)
  const seriesPickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => setImgErr(false), [version?.photo_url, castingImageUrl])

  // Close picker on outside click
  useEffect(() => {
    if (!showSeriesPicker) return
    const handler = (e: MouseEvent) => {
      if (seriesPickerRef.current && !seriesPickerRef.current.contains(e.target as Node)) {
        setShowSeriesPicker(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSeriesPicker])

  const year = edit.year !== undefined ? edit.year : version?.year
  const color = edit.color !== undefined ? edit.color : version?.color
  const series = edit.series_name !== undefined ? edit.series_name : version?.series_name
  const carType = edit.car_type ?? version?.car_type ?? 'mainline'
  const photo = version?.photo_url || castingImageUrl

  const seriesQuery = (series || '').toLowerCase()
  const filteredSeries = allSeries.filter(s =>
    !seriesQuery || s.name.toLowerCase().includes(seriesQuery)
  ).slice(0, 30)

  if (state === 'skipped') return null

  // Compact row — always shown
  return (
    <div className={`
      rounded-xl border transition-all overflow-hidden
      ${state === 'added'
        ? 'border-emerald-700/40 bg-emerald-950/40'
        : isEditing
        ? 'border-hw-accent/40 bg-hw-accent/5'
        : 'border-hw-border bg-hw-surface'}
    `}>

      {/* ── Compact row ── */}
      <div className="flex items-center gap-3 p-3">

        {/* Thumbnail — click to expand */}
        <button
          onClick={state === 'idle' ? onEditToggle : undefined}
          className={`w-12 h-12 rounded-lg bg-zinc-900 flex-shrink-0 overflow-hidden border transition-colors ${
            state === 'idle' ? 'cursor-pointer hover:border-hw-accent/50' : 'cursor-default'
          } border-hw-border`}
          tabIndex={state === 'idle' ? 0 : -1}
          title="Click to expand"
        >
          {photo && !imgErr ? (
            <img src={photo} alt="" className="w-full h-full object-contain" onError={() => setImgErr(true)} loading="lazy" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <ImageIcon className="w-4 h-4 text-hw-muted/30" />
            </div>
          )}
        </button>

        {/* Info — click to expand */}
        <button
          onClick={state === 'idle' ? onEditToggle : undefined}
          className={`min-w-0 flex-1 text-left ${state === 'idle' ? 'cursor-pointer' : 'cursor-default'}`}
          tabIndex={-1}
        >
          <div className="flex items-center gap-1.5 flex-wrap">
            {year ? (
              <span className="text-sm font-bold text-hw-text">{year}</span>
            ) : (
              <span className="text-sm text-hw-muted italic">No year</span>
            )}
            {carType !== 'mainline' && (
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border leading-none ${
                carType === 'super treasure hunt'
                  ? 'bg-yellow-900/40 text-yellow-300 border-yellow-600/30'
                  : carType === 'premium'
                  ? 'bg-amber-900/40 text-amber-300 border-amber-700/30'
                  : 'bg-zinc-800 text-zinc-400 border-zinc-600/30'
              }`}>{carType.toUpperCase()}</span>
            )}
          </div>
          {color && <p className="text-xs text-hw-text-secondary mt-0.5 truncate">{color}</p>}
          {series && <p className="text-[11px] text-hw-muted truncate mt-0.5">{series}</p>}
          {(edit.toy_number ?? version?.toy_number) && (
            <p className="text-[10px] text-hw-muted/60 font-mono mt-0.5">{edit.toy_number ?? version?.toy_number}</p>
          )}
        </button>

        {/* Actions */}
        {state === 'added' ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
        ) : state === 'adding' ? (
          <Loader2 className="w-4 h-4 text-hw-muted animate-spin flex-shrink-0" />
        ) : (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={onToggleCollection}
              title={addToCollection ? 'Will add to collection' : 'Add to catalog only'}
              className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-colors ${
                addToCollection
                  ? 'border-hw-accent/50 bg-hw-accent/10 text-hw-accent'
                  : 'border-hw-border text-hw-muted hover:border-hw-muted'
              }`}
            >
              {addToCollection ? <BookmarkCheck className="w-3.5 h-3.5" /> : <BookmarkPlus className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={onApprove}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-hw-accent text-white text-xs font-semibold hover:bg-hw-accent-hover transition-colors"
            >
              <Check className="w-3 h-3" />
              Add
            </button>

            <button
              onClick={onSkip}
              className="w-7 h-7 rounded-lg border border-hw-border text-hw-muted hover:border-red-800/60 hover:text-red-400 hover:bg-red-900/20 transition-colors flex items-center justify-center"
              title="Skip"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* ── Expanded panel ── */}
      {isEditing && state === 'idle' && (
        <div className="border-t border-hw-border/50">

          {/* Large image */}
          <div className="relative bg-zinc-950" style={{ height: '200px' }}>
            {photo && !imgErr ? (
              <img
                src={photo}
                alt=""
                className="w-full h-full object-contain"
                onError={() => setImgErr(true)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <ImageIcon className="w-12 h-12 text-zinc-800" />
              </div>
            )}
            {/* Close button */}
            <button
              onClick={onEditToggle}
              className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 backdrop-blur-sm border border-white/10 flex items-center justify-center text-white/70 hover:text-white hover:bg-black/80 transition-colors"
              title="Collapse"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Edit fields */}
          <div className="px-3 pb-3 pt-3 space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-hw-muted mb-1 block">Year</label>
                <input
                  type="number"
                  placeholder={String(version?.year ?? '2024')}
                  value={edit.year ?? (version?.year ? String(version.year) : '')}
                  onChange={e => onEditChange({ year: e.target.value })}
                  className="input-field py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="text-[10px] text-hw-muted mb-1 block">Color</label>
                <input
                  type="text"
                  placeholder={version?.color ?? 'Color'}
                  value={edit.color ?? (version?.color ?? '')}
                  onChange={e => onEditChange({ color: e.target.value })}
                  className="input-field py-1.5 text-sm"
                />
              </div>
              <div className="col-span-2" ref={seriesPickerRef}>
                <label className="text-[10px] text-hw-muted mb-1 block">Series</label>
                <div className="relative flex gap-1">
                  <input
                    type="text"
                    placeholder={version?.series_name ?? 'Series name'}
                    value={edit.series_name ?? (version?.series_name ?? '')}
                    onChange={e => {
                      const val = e.target.value
                      const inferred = inferSeriesType(val)
                      onEditChange({ series_name: val, ...(inferred ? { car_type: inferred } : {}) })
                    }}
                    onFocus={() => setShowSeriesPicker(true)}
                    className="input-field py-1.5 text-sm flex-1 min-w-0"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSeriesPicker(v => !v)}
                    className={`w-8 flex-shrink-0 rounded-lg border flex items-center justify-center transition-colors ${
                      showSeriesPicker
                        ? 'border-hw-accent/50 bg-hw-accent/10 text-hw-accent'
                        : 'border-hw-border text-hw-muted hover:border-hw-accent/40 hover:text-hw-accent'
                    }`}
                  >
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showSeriesPicker ? 'rotate-180' : ''}`} />
                  </button>
                  {showSeriesPicker && filteredSeries.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-hw-bg border border-hw-border rounded-xl shadow-2xl z-50 max-h-44 overflow-y-auto">
                      {filteredSeries.map(s => (
                        <button
                          key={s.id}
                          type="button"
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => {
                            const inferred = inferSeriesType(s.name)
                            onEditChange({ series_name: s.name, car_type: inferred ?? s.type ?? 'mainline' })
                            setShowSeriesPicker(false)
                          }}
                          className="w-full text-left px-3 py-2 text-xs text-hw-text hover:bg-hw-accent/10 transition-colors flex items-center justify-between gap-2"
                        >
                          <span className="truncate">{s.name}</span>
                          {s.type && s.type !== 'mainline' && (
                            <span className="text-[9px] text-hw-muted flex-shrink-0">{s.type}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {['mainline', 'treasure hunt', 'super treasure hunt'].includes(carType) && (
                <div>
                  <label className="text-[10px] text-hw-muted mb-1 block">Mainline # (of 250)</label>
                  <input
                    type="number"
                    placeholder={version?.set_number ? String(version.set_number) : 'e.g. 127'}
                    value={edit.set_number ?? (version?.set_number ? String(version.set_number) : '')}
                    onChange={e => onEditChange({ set_number: e.target.value })}
                    className="input-field py-1.5 text-sm"
                  />
                </div>
              )}
              <div>
                <label className="text-[10px] text-hw-muted mb-1 block">Series pos (e.g. 1/10)</label>
                <input
                  type="number"
                  placeholder={version?.series_number ? String(version.series_number) : 'e.g. 1'}
                  value={edit.series_number ?? (version?.series_number ? String(version.series_number) : '')}
                  onChange={e => onEditChange({ series_number: e.target.value })}
                  className="input-field py-1.5 text-sm"
                />
              </div>
            </div>

            {/* Series type selector */}
            <div>
              <label className="text-[10px] text-hw-muted mb-1.5 block">Series type</label>
              <div className="flex flex-wrap gap-1.5">
                {SERIES_TYPES.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => onEditChange({ car_type: value })}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                      carType === value
                        ? value === 'super treasure hunt'
                          ? 'bg-yellow-900/60 text-yellow-200 border-yellow-600/50'
                          : value === 'treasure hunt'
                          ? 'bg-yellow-900/40 text-yellow-300 border-yellow-700/40'
                          : value === 'premium'
                          ? 'bg-amber-900/40 text-amber-300 border-amber-700/40'
                          : value === 'collector'
                          ? 'bg-violet-900/40 text-violet-300 border-violet-700/40'
                          : 'bg-hw-accent/15 text-hw-accent border-hw-accent/30'
                        : 'border-hw-border text-hw-muted hover:border-hw-muted hover:text-hw-text'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] text-hw-muted mb-1 block">Toy Number</label>
              <input
                type="text"
                placeholder="e.g. DHP27"
                value={edit.toy_number ?? (version?.toy_number ?? '')}
                onChange={e => onEditChange({ toy_number: e.target.value.toUpperCase() })}
                className="input-field py-1.5 text-sm uppercase"
                maxLength={10}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const VERSIONS_PREVIEW = 25
const PACK_RE = /\bpacks?\b/i

export function DiscoverPage() {
  const { toast } = useToastContext()

  // Feed
  const [cards, setCards] = useState<ScrapedCar[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [loadingFeed, setLoadingFeed] = useState(false)
  const [feedError, setFeedError] = useState<string | null>(null)
  // Ref-based guard: prevents stale-closure double-calls
  const loadingRef = useRef(false)

  // Wiki detail for current casting
  const [castingDetail, setCastingDetail] = useState<ScrapedCar | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [showAllVersions, setShowAllVersions] = useState(false)

  // Series cache
  const [allSeries, setAllSeries] = useState<Series[]>([])

  // Permanently hidden castings (persisted in localStorage)
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('hw_hidden_castings')
      return raw ? new Set(JSON.parse(raw)) : new Set()
    } catch { return new Set() }
  })

  const hideForever = (id: string) => {
    setHiddenIds(prev => {
      const next = new Set(prev)
      next.add(id)
      try { localStorage.setItem('hw_hidden_castings', JSON.stringify([...next])) } catch {}
      return next
    })
    setCards(prev => {
      const filtered = prev.filter(c => c.collecthw_id !== id)
      // Keep currentIdx in bounds
      setCurrentIdx(i => Math.min(i, Math.max(0, filtered.length - 1)))
      return filtered
    })
  }

  // Per-item approve state
  const [itemStates, setItemStates] = useState<Record<string, ItemState>>({})
  const [versionEdits, setVersionEdits] = useState<Record<string, VersionEdit>>({})
  const [versionCollect, setVersionCollect] = useState<Record<string, boolean>>({})
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [shouldAddToCollection, setShouldAddToCollection] = useState(false)

  // Filters — draft state (what's in the inputs)
  const [filterQ, setFilterQ] = useState('')
  const [filterYear, setFilterYear] = useState('')
  const [filterColor, setFilterColor] = useState('')
  const [filterType, setFilterType] = useState('')
  // Active filters (committed on Search)
  const [activeFilters, setActiveFilters] = useState<FeedFilters>({})
  const activeFiltersRef = useRef<FeedFilters>({})

  const touchStartX = useRef(0)

  useEffect(() => {
    getAllSeries().then(setAllSeries).catch(() => {})
  }, [])

  // ── Feed loading (ref-guarded, no stale closure issues) ───────────────────

  const loadBatch = useCallback(async (filters: FeedFilters, replace: boolean) => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoadingFeed(true)
    setFeedError(null)
    try {
      const batch = await getFeed(10, filters)
      setCards(prev => {
        const base = replace ? [] : prev
        const existingIds = new Set(base.map(c => c.collecthw_id).filter(Boolean))
        const hidden = hiddenIds
        return [
          ...base,
          ...batch.filter(c =>
            !existingIds.has(c.collecthw_id) &&
            !hidden.has(c.collecthw_id ?? '') &&
            !PACK_RE.test(c.name ?? '')
          ),
        ]
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('No cars found') || msg.includes('404')) {
        setFeedError('No cars found for those filters.')
      } else {
        toast.error('Failed to load feed')
      }
    } finally {
      loadingRef.current = false
      setLoadingFeed(false)
    }
  }, [toast])

  // Initial load
  useEffect(() => { loadBatch({}, false) }, [])

  // Auto-load more as user pages through
  useEffect(() => {
    if (cards.length > 0 && currentIdx >= cards.length - 3) {
      loadBatch(activeFiltersRef.current, false)
    }
  }, [currentIdx, cards.length])

  // ── Apply / clear filters ─────────────────────────────────────────────────

  const handleSearch = () => {
    const filters: FeedFilters = {}
    if (filterQ.trim()) filters.q = filterQ.trim()
    if (filterYear) filters.year = Number(filterYear)
    if (filterColor.trim()) filters.color = filterColor.trim()
    if (filterType) filters.car_type = filterType
    activeFiltersRef.current = filters
    setActiveFilters(filters)
    setCards([])
    setCurrentIdx(0)
    setItemStates({})
    setVersionEdits({})
    setVersionCollect({})
    loadBatch(filters, true)
  }

  const handleClearFilters = () => {
    setFilterQ('')
    setFilterYear('')
    setFilterColor('')
    setFilterType('')
    activeFiltersRef.current = {}
    setActiveFilters({})
    setCards([])
    setCurrentIdx(0)
    setItemStates({})
    setVersionEdits({})
    setVersionCollect({})
    loadBatch({}, true)
  }

  const hasActiveFilters = Object.values(activeFilters).some(v => v !== undefined && v !== '')

  // ── Wiki detail ──────────────────────────────────────────────────────────

  const current = cards[currentIdx]

  useEffect(() => {
    setCastingDetail(null)
    setShowAllVersions(false)
    setVersionEdits({})
    setVersionCollect({})
    setEditingKey(null)

    if (!current) return

    // CHW filtered result: no wiki URL, but card already carries year/color/type.
    if (!current.url) {
      const preEdit: VersionEdit = {}
      if (current.year) preEdit.year = String(current.year)
      if (current.primary_color) preEdit.color = current.primary_color
      if (current.car_type) preEdit.car_type = current.car_type
      setVersionEdits({ [`${currentIdx}:casting`]: preEdit })
      setCastingDetail({ ...current, versions: [] })
      return
    }

    // Wiki result: scrape for all versions and fetch DB cars with same name in parallel
    setDetailLoading(true)
    const snapIdx = currentIdx
    Promise.all([
      scrapeCar(current.url),
      getCars({ search: current.name, page_size: 200 }).catch(() => ({ items: [], total: 0, page: 1, page_size: 200, pages: 0 })),
    ])
      .then(([d, dbPage]) => {
        // Build set of toy numbers already in DB for this casting
        const dbToys = new Set<string>(
          (dbPage.items ?? [])
            .filter(c => c.toy_number)
            .map(c => c.toy_number!.toUpperCase())
        )

        // If a year filter is active, pin year-matching versions to the top
        const yr = activeFiltersRef.current.year
        if (yr && d.versions?.length) {
          d = {
            ...d,
            versions: [
              ...d.versions.filter(v => v.year === yr),
              ...d.versions.filter(v => v.year !== yr),
            ],
          }
        }

        // Filter out versions already in DB by toy number
        const newVersions = dbToys.size > 0 && d.versions?.length
          ? d.versions.filter(v => !v.toy_number || !dbToys.has(v.toy_number.toUpperCase()))
          : d.versions

        const detail = { ...d, versions: newVersions ?? [] }
        setCastingDetail(detail)

        // Use the year-matching version's photo when available, otherwise the casting image
        const yearMatchPhoto = yr ? detail.versions?.find(v => v.year === yr)?.photo_url : null
        const imageToCache = yearMatchPhoto || d.image_url
        if (imageToCache) {
          setCards(prev => prev.map((c, i) => i === snapIdx ? { ...c, image_url: imageToCache } : c))
        }

        // All versions already in DB → hide casting forever and advance
        if (dbToys.size > 0 && d.versions?.length && newVersions?.length === 0) {
          const id = current.collecthw_id
          if (id) {
            setHiddenIds(prev => {
              const next = new Set(prev)
              next.add(id)
              try { localStorage.setItem('hw_hidden_castings', JSON.stringify([...next])) } catch {}
              return next
            })
          }
          setCards(prev => prev.filter((_, i) => i !== snapIdx))
          setCurrentIdx(i => Math.min(i, Math.max(0, cards.length - 2)))
        }
      })
      .catch(() => {})
      .finally(() => setDetailLoading(false))
  }, [currentIdx, current?.collecthw_id])

  // ── Navigation ───────────────────────────────────────────────────────────

  const goNext = useCallback(() => setCurrentIdx(i => Math.min(cards.length - 1, i + 1)), [cards.length])
  const goPrev = useCallback(() => setCurrentIdx(i => Math.max(0, i - 1)), [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return
      if (e.key === 'ArrowRight') goNext()
      if (e.key === 'ArrowLeft') goPrev()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [goNext, goPrev])

  // ── Approve / skip ───────────────────────────────────────────────────────

  const itemKey = (sub: number | 'casting') => `${currentIdx}:${sub}`

  const getVersionData = (key: string, version: ScrapedVersion | null) => {
    const e = versionEdits[key] || {}
    const seriesName = e.series_name !== undefined ? e.series_name : version?.series_name
    let car_type: string
    if (e.car_type) car_type = e.car_type
    else {
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
      const seriesMatch = seriesName ? allSeries.find(s => norm(s.name) === norm(seriesName)) : undefined
      car_type = seriesMatch?.type || version?.car_type || 'mainline'
    }

    return {
      year: e.year !== undefined ? (e.year ? Number(e.year) : undefined) : version?.year,
      color: e.color !== undefined ? e.color : version?.color,
      series_name: seriesName,
      car_type,
      set_number: e.set_number !== undefined ? (e.set_number ? Number(e.set_number) : undefined) : version?.set_number,
      series_number: e.series_number !== undefined ? (e.series_number ? Number(e.series_number) : undefined) : version?.series_number,
      toy_number: e.toy_number !== undefined ? (e.toy_number || undefined) : (version?.toy_number || undefined),
      photo_url: version?.photo_url,
      series_total: version?.series_total,
    }
  }

  const handleApprove = async (key: string, version: ScrapedVersion | null) => {
    if (!current) return
    const vd = getVersionData(key, version)
    const name = castingDetail?.name || current.name || ''
    const imageUrl = vd.photo_url ?? castingDetail?.image_url ?? current.image_url ?? undefined
    const collect = versionCollect[key] ?? shouldAddToCollection

    setItemStates(prev => ({ ...prev, [key]: 'adding' }))
    try {
      let series_id: string | undefined
      if (vd.series_name) {
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
        const match = allSeries.find(s => norm(s.name) === norm(vd.series_name!))
        if (match) {
          series_id = match.id
        } else {
          try {
            const lower = (vd.series_name || '').toLowerCase()
            const isCollectorSeries = /\bcollector\b|rlc|red line club|hw collector/i.test(lower)
            const isPremiumSeries = /car culture|boulevard|pop culture|fast[ &]furious|hw exotics|hw premium/i.test(lower)
            const seriesType = isCollectorSeries ? 'collector' : isPremiumSeries ? 'premium' : 'mainline'
            const ns = await createSeries({ name: vd.series_name, type: seriesType, total_count: (vd as any).series_total })
            series_id = ns.id
            setAllSeries(prev => [...prev, ns])
          } catch { /* non-critical */ }
        }
      }

      const car = await createCar({
        name,
        year: typeof vd.year === 'number' ? vd.year : undefined,
        primary_color: vd.color,
        car_type: vd.car_type,
        treasure_hunt: vd.car_type === 'treasure hunt' || vd.car_type === 'super treasure hunt',
        series_id,
        image_url: imageUrl,
        set_number: vd.set_number,
        series_number: vd.series_number,
        toy_number: vd.toy_number,
      })

      if (collect) {
        await apiAddToCollection({ allcars_id: car.id, carded: true, condition: 'mint' })
      }

      setItemStates(prev => ({ ...prev, [key]: 'added' }))
      toast.success(`${name}${vd.year ? ` · ${vd.year}` : ''} added!`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add')
      setItemStates(prev => ({ ...prev, [key]: 'idle' }))
    }
  }

  const handleSkip = (key: string) => setItemStates(prev => ({ ...prev, [key]: 'skipped' }))

  const handleAddAll = async () => {
    const rows = versions.length > 0
      ? displayVersions.map((v, i) => ({ key: itemKey(i), v }))
      : [{ key: itemKey('casting'), v: null as ScrapedVersion | null }]
    const toAdd = rows.filter(({ key }) => (itemStates[key] ?? 'idle') === 'idle')
    for (const { key, v } of toAdd) await handleApprove(key, v)
  }

  const setVersionEdit = (key: string, patch: Partial<VersionEdit>) => {
    setVersionEdits(prev => ({ ...prev, [key]: { ...(prev[key] || {}), ...patch } }))
  }

  const toggleCollect = (key: string) => {
    setVersionCollect(prev => ({ ...prev, [key]: !(prev[key] ?? shouldAddToCollection) }))
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  const versions: ScrapedVersion[] = castingDetail?.versions ?? []
  const displayVersions = showAllVersions ? versions : versions.slice(0, VERSIONS_PREVIEW)
  const hiddenCount = versions.length - VERSIONS_PREVIEW

  const itemsToCheck = versions.length > 0 ? versions.slice(0, VERSIONS_PREVIEW) : [null]
  const allResolved = !detailLoading && castingDetail !== null && itemsToCheck.every((_, i) => {
    const s = itemStates[itemKey(versions.length > 0 ? i : 'casting')]
    return s === 'added' || s === 'skipped'
  })

  const idleCount = (versions.length > 0 ? displayVersions : [null])
    .filter((_, i) => (itemStates[itemKey(versions.length > 0 ? i : 'casting')] ?? 'idle') === 'idle').length

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 max-w-xl mx-auto pb-12">

      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-hw-text">Discover</h1>
          <p className="text-hw-muted text-xs mt-0.5">
            {hasActiveFilters ? 'Filtered · CollectHW' : 'Random · Hot Wheels wiki'}
          </p>
        </div>
        <button
          onClick={() => { setCards([]); setCurrentIdx(0); setCastingDetail(null); setItemStates({}); loadBatch(activeFiltersRef.current, true) }}
          disabled={loadingFeed}
          className="btn-secondary py-1.5 px-3 text-sm disabled:opacity-50 mt-0.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingFeed ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* ── Filter bar ── */}
      <div className="mb-5 space-y-2">
        {/* Row 1: keyword */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-hw-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Search by name… Camaro, Porsche, BMW"
            value={filterQ}
            onChange={e => setFilterQ(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            className="input-field pl-8 py-2 text-sm"
          />
        </div>

        {/* Row 2: year · color · type · button */}
        <div className="flex gap-2">
          <input
            type="number"
            placeholder="Year"
            value={filterYear}
            onChange={e => setFilterYear(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            className="input-field py-2 text-sm w-24 shrink-0"
            min={1968}
            max={new Date().getFullYear() + 1}
          />
          <input
            type="text"
            placeholder="Color"
            value={filterColor}
            onChange={e => setFilterColor(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            className="input-field py-2 text-sm min-w-0"
          />
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="input-field py-2 text-sm w-36 shrink-0"
          >
            <option value="">Any type</option>
            <option value="mainline">Mainline</option>
            <option value="premium">Premium</option>
            <option value="treasure hunt">Treasure Hunt</option>
            <option value="super treasure hunt">Super TH</option>
            <option value="collector">Collector</option>
          </select>
          <button
            onClick={handleSearch}
            disabled={loadingFeed}
            className="btn-primary py-2 px-3 shrink-0 disabled:opacity-50"
          >
            {loadingFeed
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Search className="w-3.5 h-3.5" />
            }
          </button>
        </div>

        {/* Active filter chips */}
        {hasActiveFilters && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {activeFilters.q && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-hw-accent/10 border border-hw-accent/20 text-hw-accent text-xs font-medium">
                "{activeFilters.q}"
              </span>
            )}
            {activeFilters.year && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-hw-accent/10 border border-hw-accent/20 text-hw-accent text-xs font-medium">
                {activeFilters.year}
              </span>
            )}
            {activeFilters.color && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-hw-accent/10 border border-hw-accent/20 text-hw-accent text-xs font-medium">
                {activeFilters.color}
              </span>
            )}
            {activeFilters.car_type && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-hw-accent/10 border border-hw-accent/20 text-hw-accent text-xs font-medium">
                {activeFilters.car_type}
              </span>
            )}
            <button onClick={handleClearFilters} className="text-[11px] text-hw-muted hover:text-hw-text transition-colors ml-1">
              Clear
            </button>
          </div>
        )}
      </div>

      {/* ── Loading skeleton ── */}
      {!cards.length && loadingFeed && (
        <div className="space-y-3">
          <div className="rounded-2xl bg-hw-surface border border-hw-border animate-pulse h-52" />
          {[1, 2, 3].map(i => (
            <div key={i} className="rounded-xl bg-hw-surface border border-hw-border animate-pulse h-14" />
          ))}
        </div>
      )}

      {/* ── Empty / error ── */}
      {!cards.length && !loadingFeed && (
        <div className="text-center py-16">
          {feedError ? (
            <>
              <p className="text-hw-muted text-sm">{feedError}</p>
              <button onClick={handleClearFilters} className="mt-3 btn-secondary text-sm">
                Clear filters
              </button>
            </>
          ) : (
            <>
              <p className="text-hw-muted text-sm">No more cars in this batch.</p>
              <button onClick={() => loadBatch(activeFiltersRef.current, true)} className="mt-3 btn-primary">
                <RefreshCw className="w-4 h-4" />
                Load batch
              </button>
            </>
          )}
        </div>
      )}

      {current && (
        <>
          {/* ── Progress ── */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-hw-muted tabular-nums">
              {currentIdx + 1} <span className="text-hw-border">/ {cards.length}{loadingFeed ? '+' : ''}</span>
            </span>
            <div className="flex items-center gap-1">
              {cards.slice(0, 14).map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentIdx(i)}
                  className={`rounded-full transition-all duration-150 ${
                    i === currentIdx ? 'w-4 h-1.5 bg-hw-accent' : 'w-1.5 h-1.5 bg-hw-border hover:bg-hw-muted'
                  }`}
                />
              ))}
              {loadingFeed && <Loader2 className="w-3 h-3 text-hw-muted animate-spin ml-1" />}
            </div>
          </div>

          {/* ── Casting hero card ── */}
          <div
            className="relative mb-4"
            onTouchStart={e => { touchStartX.current = e.touches[0].clientX }}
            onTouchEnd={e => {
              const d = touchStartX.current - e.changedTouches[0].clientX
              if (d > 60) goNext()
              else if (d < -60) goPrev()
            }}
          >
            {/* Prev / Next buttons float over the card */}
            <button
              onClick={goPrev}
              disabled={currentIdx === 0}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm border border-white/10 flex items-center justify-center disabled:opacity-20 hover:bg-black/70 transition-colors"
            >
              <ChevronLeft className="w-4 h-4 text-white" />
            </button>
            <button
              onClick={goNext}
              disabled={currentIdx === cards.length - 1 && !loadingFeed}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm border border-white/10 flex items-center justify-center disabled:opacity-20 hover:bg-black/70 transition-colors"
            >
              <ChevronRight className="w-4 h-4 text-white" />
            </button>

            <div className="rounded-2xl overflow-hidden border border-hw-border shadow-xl" style={{ height: '220px' }}>
              {current.image_url ? (
                <img src={current.image_url} alt={current.name} className="w-full h-full object-contain bg-zinc-950" />
              ) : (
                <div className="w-full h-full bg-zinc-950 flex items-center justify-center">
                  <ImageIcon className="w-12 h-12 text-zinc-800" />
                </div>
              )}

              {/* Gradient overlay */}
              <div className="absolute inset-0 pointer-events-none rounded-2xl" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.1) 50%, transparent 100%)' }} />

              {/* Bottom info */}
              <div className="absolute bottom-0 left-0 right-0 p-4 flex items-end justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-bold text-white leading-tight">{current.name}</h2>
                    {current.in_db && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-300 border border-emerald-700/40 leading-none flex-shrink-0">
                        IN DB
                      </span>
                    )}
                  </div>
                  {(current.year || current.primary_color) && (
                    <p className="text-xs text-white/60 mt-0.5">
                      {[current.year, current.primary_color].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                {current.url && (
                  <a
                    href={current.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 ml-2 flex items-center gap-1 text-[10px] text-white/40 hover:text-white/70 transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    wiki
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* ── Controls row ── */}
          <div className="flex items-center justify-between px-1 mb-3">
            {/* Add to collection toggle */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShouldAddToCollection(p => !p)}
                className={`relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ${shouldAddToCollection ? 'bg-hw-accent' : 'bg-hw-border'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${shouldAddToCollection ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
              <span className="text-xs text-hw-muted">Add to collection</span>
            </div>

            {/* Versions count + Add all */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-hw-muted" />
                {detailLoading ? (
                  <Loader2 className="w-3 h-3 text-hw-muted animate-spin" />
                ) : versions.length > 0 ? (
                  <span className="text-xs text-hw-muted">{versions.length}</span>
                ) : castingDetail ? (
                  <span className="text-xs text-hw-muted">1</span>
                ) : null}
              </div>

              {!detailLoading && castingDetail && idleCount > 1 && (
                <button
                  onClick={handleAddAll}
                  className="flex items-center gap-1 text-xs text-hw-accent hover:text-hw-accent-hover transition-colors font-medium"
                >
                  <ChevronsRight className="w-3.5 h-3.5" />
                  Add all ({idleCount})
                </button>
              )}
            </div>
          </div>

          {/* ── Version rows ── */}
          <div className="space-y-2">
            {versions.length > 0 ? (
              <>
                {displayVersions.map((v, i) => {
                  const key = itemKey(i)
                  return (
                    <VersionApproveRow
                      key={`${currentIdx}-${i}`}
                      castingImageUrl={current.image_url}
                      version={v}
                      state={itemStates[key] ?? 'idle'}
                      addToCollection={versionCollect[key] ?? shouldAddToCollection}
                      onToggleCollection={() => toggleCollect(key)}
                      isEditing={editingKey === key}
                      onEditToggle={() => setEditingKey(editingKey === key ? null : key)}
                      edit={versionEdits[key] || {}}
                      onEditChange={patch => setVersionEdit(key, patch)}
                      onApprove={() => handleApprove(key, v)}
                      onSkip={() => handleSkip(key)}
                      allSeries={allSeries}
                    />
                  )
                })}

                {!showAllVersions && hiddenCount > 0 && (
                  <button
                    onClick={() => setShowAllVersions(true)}
                    className="w-full py-2 text-xs text-hw-accent hover:text-hw-accent-hover transition-colors"
                  >
                    Show {hiddenCount} more versions
                  </button>
                )}
              </>
            ) : detailLoading ? (
              <div className="space-y-2">
                {[1, 2].map(i => <div key={i} className="rounded-xl bg-hw-surface border border-hw-border animate-pulse h-14" />)}
              </div>
            ) : castingDetail ? (
              (() => {
                const key = itemKey('casting')
                return (
                  <VersionApproveRow
                    castingImageUrl={current.image_url}
                    version={null}
                    state={itemStates[key] ?? 'idle'}
                    addToCollection={versionCollect[key] ?? shouldAddToCollection}
                    onToggleCollection={() => toggleCollect(key)}
                    isEditing={editingKey === key}
                    onEditToggle={() => setEditingKey(editingKey === key ? null : key)}
                    edit={versionEdits[key] || {}}
                    onEditChange={patch => setVersionEdit(key, patch)}
                    onApprove={() => handleApprove(key, null)}
                    onSkip={() => handleSkip(key)}
                    allSeries={allSeries}
                  />
                )
              })()
            ) : null}
          </div>

          {/* ── Footer nav ── */}
          <div className="mt-5 flex items-center justify-between">
            {allResolved && (
              <span className="text-xs text-emerald-400 font-medium">All done!</span>
            )}
            <div className="ml-auto flex items-center gap-3">
              {current.collecthw_id && (
                <button
                  onClick={() => hideForever(current.collecthw_id!)}
                  className="text-sm text-hw-muted/50 hover:text-red-400 transition-colors flex items-center gap-1"
                  title="Never show this casting again"
                >
                  <EyeOff className="w-3.5 h-3.5" />
                  Never show
                </button>
              )}
              <button
                onClick={goNext}
                disabled={currentIdx === cards.length - 1 && !loadingFeed}
                className="text-sm text-hw-muted hover:text-hw-text transition-colors flex items-center gap-1 disabled:opacity-30"
              >
                {allResolved ? 'Next casting' : 'Skip casting'}
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <p className="text-center text-[11px] text-hw-muted/40 mt-4">← → keys · swipe on mobile</p>
        </>
      )}
    </div>
  )
}
