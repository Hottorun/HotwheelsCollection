import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ChevronLeft, ChevronRight, Loader2, ImageIcon, RefreshCw,
  CheckCircle2, Check, X, ExternalLink, Layers, Pencil, BookmarkPlus,
  BookmarkCheck, ChevronsRight, Flame,
} from 'lucide-react'
import {
  getFeed, scrapeCar, createCar,
  addToCollection as apiAddToCollection,
  getAllSeries, createSeries,
  type ScrapedCar, type ScrapedVersion,
} from '../lib/api'
import { useToastContext } from '../contexts/ToastContext'
import type { Series } from '../types'

type ItemState = 'idle' | 'adding' | 'added' | 'skipped'

type VersionEdit = {
  year?: string
  color?: string
  series_name?: string
  th?: 'none' | 'th' | 'sth'
  set_number?: string
  series_number?: string
  toy_number?: string
  car_type?: string
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
}) {
  const [imgErr, setImgErr] = useState(false)
  useEffect(() => setImgErr(false), [version?.photo_url, castingImageUrl])

  // Resolve display values: edits override scraped data
  const year = edit.year !== undefined ? edit.year : version?.year
  const color = edit.color !== undefined ? edit.color : version?.color
  const series = edit.series_name !== undefined ? edit.series_name : version?.series_name
  const th = edit.th ?? 'none'
  const carType = th === 'sth' ? 'super treasure hunt' : th === 'th' ? 'treasure hunt' : (version?.car_type || 'mainline')
  const photo = version?.photo_url || castingImageUrl

  if (state === 'skipped') return null

  return (
    <div className={`
      rounded-xl border transition-all overflow-hidden
      ${state === 'added'
        ? 'border-emerald-700/40 bg-emerald-950/40'
        : isEditing
        ? 'border-hw-accent/40 bg-hw-accent/5'
        : 'border-hw-border bg-hw-surface'}
    `}>
      {/* Main row */}
      <div className="flex items-center gap-3 p-3">
        {/* Thumbnail */}
        <div className="w-14 h-14 rounded-lg bg-zinc-900 flex-shrink-0 overflow-hidden border border-hw-border">
          {photo && !imgErr ? (
            <img src={photo} alt="" className="w-full h-full object-contain" onError={() => setImgErr(true)} loading="lazy" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <ImageIcon className="w-5 h-5 text-hw-muted/30" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            {year ? (
              <span className="text-sm font-bold text-hw-text">{year}</span>
            ) : (
              <span className="text-sm text-hw-muted italic">No year</span>
            )}
            {carType !== 'mainline' && (
              <span className={`text-[9px] font-bold px-1 py-0.5 rounded border leading-none ${
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
        </div>

        {/* Actions */}
        {state === 'added' ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
        ) : state === 'adding' ? (
          <Loader2 className="w-4 h-4 text-hw-muted animate-spin flex-shrink-0" />
        ) : (
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Collection toggle */}
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

            {/* TH toggle */}
            {carType !== 'premium' && (
              <button
                onClick={() => onEditChange({ th: th === 'none' ? 'th' : 'none' })}
                title="Treasure Hunt"
                className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-colors ${
                  th !== 'none'
                    ? 'border-yellow-600/50 bg-yellow-900/40 text-yellow-300'
                    : 'border-hw-border text-hw-muted hover:border-yellow-700/40 hover:text-yellow-400/60'
                }`}
              >
                <Flame className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Edit toggle */}
            <button
              onClick={onEditToggle}
              title="Edit fields"
              className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-colors ${
                isEditing
                  ? 'border-hw-accent/50 bg-hw-accent/10 text-hw-accent'
                  : 'border-hw-border text-hw-muted hover:border-hw-muted'
              }`}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>

            {/* Approve */}
            <button
              onClick={onApprove}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-hw-accent text-white text-xs font-semibold hover:bg-hw-orange transition-colors"
            >
              <Check className="w-3 h-3" />
              Add
            </button>

            {/* Skip */}
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

      {/* TH/STH picker */}
      {th !== 'none' && state === 'idle' && (
        <div className="px-3 pb-2 pt-1 border-t border-yellow-900/30 bg-yellow-950/20 flex items-center gap-2">
          <Flame className="w-3 h-3 text-yellow-500 flex-shrink-0" />
          <span className="text-[10px] text-yellow-400/70 font-medium mr-1">Type:</span>
          {(['th', 'sth'] as const).map(t => (
            <button
              key={t}
              onClick={() => onEditChange({ th: t })}
              className={`px-2.5 py-1 rounded text-[10px] font-bold border transition-colors ${
                th === t
                  ? 'bg-yellow-900/60 text-yellow-200 border-yellow-600/50'
                  : 'border-hw-border/60 text-hw-muted hover:border-yellow-700/40 hover:text-yellow-400/70'
              }`}
            >
              {t === 'sth' ? 'Super TH' : 'Regular TH'}
            </button>
          ))}
        </div>
      )}

      {/* Inline edit panel */}
      {isEditing && state === 'idle' && (
        <div className="px-3 pb-3 border-t border-hw-border/50 pt-3 space-y-2">
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
            <div className="col-span-2">
              <label className="text-[10px] text-hw-muted mb-1 block">Series</label>
              <input
                type="text"
                placeholder={version?.series_name ?? 'Series name'}
                value={edit.series_name ?? (version?.series_name ?? '')}
                onChange={e => onEditChange({ series_name: e.target.value })}
                className="input-field py-1.5 text-sm"
              />
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
          <div>
            <label className="text-[10px] text-hw-muted mb-1 block">Car Type</label>
            <select
              value={edit.car_type ?? (version?.car_type || 'mainline')}
              onChange={e => onEditChange({ car_type: e.target.value })}
              className="input-field py-1.5 text-sm"
            >
              <option value="mainline">Mainline</option>
              <option value="premium">Premium</option>
              <option value="collector">Collector</option>
              <option value="treasure hunt">Treasure Hunt</option>
              <option value="super treasure hunt">Super Treasure Hunt</option>
            </select>
            <p className="text-[10px] text-hw-muted/60 mt-0.5">TH/STH toggle above overrides this</p>
          </div>
          <div>
            <label className="text-[10px] text-hw-muted mb-1 block">Toy Number (e.g. DHP27)</label>
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

  // Wiki detail for current casting
  const [castingDetail, setCastingDetail] = useState<ScrapedCar | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [showAllVersions, setShowAllVersions] = useState(false)

  // Series cache
  const [allSeries, setAllSeries] = useState<Series[]>([])

  // Per-item approve state, keyed by `${castingIdx}:${versionIdx|"casting"}`
  const [itemStates, setItemStates] = useState<Record<string, ItemState>>({})

  // Per-version edits and collection flags
  const [versionEdits, setVersionEdits] = useState<Record<string, VersionEdit>>({})
  const [versionCollect, setVersionCollect] = useState<Record<string, boolean>>({})
  const [editingKey, setEditingKey] = useState<string | null>(null)

  // Global "add to collection" default
  const [shouldAddToCollection, setShouldAddToCollection] = useState(true)

  const touchStartX = useRef(0)

  useEffect(() => {
    getAllSeries().then(setAllSeries).catch(() => {})
  }, [])

  // ── Feed ──────────────────────────────────────────────────────────────────

  const loadMore = useCallback(async () => {
    if (loadingFeed) return
    setLoadingFeed(true)
    try {
      const batch = await getFeed(10)
      setCards(prev => {
        const existingIds = new Set(prev.map(c => c.collecthw_id).filter(Boolean))
        return [
          ...prev,
          ...batch.filter(c =>
            !existingIds.has(c.collecthw_id) &&
            !c.in_db &&
            !PACK_RE.test(c.name ?? '')
          ),
        ]
      })
    } catch {
      toast.error('Failed to load feed')
    } finally {
      setLoadingFeed(false)
    }
  }, [loadingFeed, toast])

  useEffect(() => { loadMore() }, [])

  useEffect(() => {
    if (cards.length > 0 && currentIdx >= cards.length - 3 && !loadingFeed) loadMore()
  }, [currentIdx, cards.length, loadingFeed])

  // ── Wiki detail ──────────────────────────────────────────────────────────

  const current = cards[currentIdx]

  useEffect(() => {
    setCastingDetail(null)
    setShowAllVersions(false)
    setVersionEdits({})
    setVersionCollect({})
    setEditingKey(null)
    if (!current?.url) return
    setDetailLoading(true)
    scrapeCar(current.url)
      .then(d => setCastingDetail(d))
      .catch(() => {})
      .finally(() => setDetailLoading(false))
  }, [current?.url])

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
    const th = e.th ?? 'none'

    // Derive car_type: explicit edit > TH/STH > series type > scraped
    let car_type: string
    if (th === 'sth') car_type = 'super treasure hunt'
    else if (th === 'th') car_type = 'treasure hunt'
    else if (e.car_type) car_type = e.car_type
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
      set_number: e.set_number !== undefined
        ? (e.set_number ? Number(e.set_number) : undefined)
        : version?.set_number,
      series_number: e.series_number !== undefined
        ? (e.series_number ? Number(e.series_number) : undefined)
        : version?.series_number,
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
            // Infer series type from series name keywords
            const lower = (vd.series_name || '').toLowerCase()
            const isCollectorSeries = /\bcollector\b|rlc|red line club|hw collector/i.test(lower)
            const isPremiumSeries = /car culture|boulevard|pop culture|fast[ &]furious|hw exotics|hw premium/i.test(lower)
            const seriesType = isCollectorSeries ? 'collector' : isPremiumSeries ? 'premium' : 'mainline'
            const ns = await createSeries({
              name: vd.series_name,
              type: seriesType,
              total_count: (vd as any).series_total,
            })
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
    for (const { key, v } of toAdd) {
      await handleApprove(key, v)
    }
  }

  const setVersionEdit = (key: string, patch: Partial<VersionEdit>) => {
    setVersionEdits(prev => ({ ...prev, [key]: { ...(prev[key] || {}), ...patch } }))
  }

  const toggleCollect = (key: string) => {
    setVersionCollect(prev => ({
      ...prev,
      [key]: !(prev[key] ?? shouldAddToCollection),
    }))
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
    .filter((_, i) => {
      const key = itemKey(versions.length > 0 ? i : 'casting')
      return (itemStates[key] ?? 'idle') === 'idle'
    }).length

  // ── Skeleton ──────────────────────────────────────────────────────────────

  if (!cards.length && loadingFeed) {
    return (
      <div className="p-4 md:p-6 max-w-xl mx-auto space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-hw-text">Discover</h1>
          <p className="text-hw-text-secondary text-sm mt-0.5">Loading random Hot Wheels…</p>
        </div>
        <div className="rounded-2xl bg-hw-surface border border-hw-border animate-pulse h-48" />
        {[1, 2, 3].map(i => (
          <div key={i} className="rounded-xl bg-hw-surface border border-hw-border animate-pulse h-16" />
        ))}
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 max-w-xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-hw-text">Discover</h1>
          <p className="text-hw-text-secondary text-sm mt-0.5">Random castings from the Hot Wheels wiki</p>
        </div>
        <button
          onClick={() => { setCards([]); setCurrentIdx(0); setCastingDetail(null); setItemStates({}); setVersionEdits({}); setVersionCollect({}); loadMore() }}
          disabled={loadingFeed}
          className="btn-secondary py-1.5 px-3 text-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingFeed ? 'animate-spin' : ''}`} />
          New batch
        </button>
      </div>

      {current && (
        <>
          {/* Progress dots */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-hw-muted tabular-nums">
              {currentIdx + 1}
              <span className="text-hw-border"> / {cards.length}{loadingFeed ? '+' : ''}</span>
            </span>
            <div className="flex items-center gap-1">
              {cards.slice(0, 12).map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentIdx(i)}
                  className={`rounded-full transition-all duration-200 ${
                    i === currentIdx ? 'w-5 h-1.5 bg-hw-accent' : 'w-1.5 h-1.5 bg-hw-border hover:bg-hw-muted'
                  }`}
                />
              ))}
              {loadingFeed && <Loader2 className="w-3 h-3 text-hw-muted animate-spin ml-1" />}
            </div>
          </div>

          {/* Casting card + arrows */}
          <div
            className="flex items-center gap-2 mb-4"
            onTouchStart={e => { touchStartX.current = e.touches[0].clientX }}
            onTouchEnd={e => {
              const d = touchStartX.current - e.changedTouches[0].clientX
              if (d > 60) goNext()
              else if (d < -60) goPrev()
            }}
          >
            <button
              onClick={goPrev} disabled={currentIdx === 0}
              className="flex-shrink-0 w-9 h-9 rounded-full bg-hw-surface border border-hw-border flex items-center justify-center disabled:opacity-20 hover:bg-hw-surface-hover transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex-1 min-w-0 rounded-2xl overflow-hidden border border-hw-border shadow-xl relative" style={{ height: '180px' }}>
              {current.image_url ? (
                <img src={current.image_url} alt={current.name} className="w-full h-full object-contain bg-zinc-950" />
              ) : (
                <div className="w-full h-full bg-zinc-950 flex items-center justify-center">
                  <ImageIcon className="w-10 h-10 text-zinc-700" />
                </div>
              )}
              <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 55%)' }} />
              <div className="absolute bottom-0 left-0 right-0 p-3 flex items-end justify-between">
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-white leading-tight truncate">{current.name}</h2>
                </div>
                {current.url && (
                  <a
                    href={current.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 ml-2 flex items-center gap-1 text-[10px] text-white/50 hover:text-white/80 transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    wiki
                  </a>
                )}
              </div>
            </div>

            <button
              onClick={goNext} disabled={currentIdx === cards.length - 1 && !loadingFeed}
              className="flex-shrink-0 w-9 h-9 rounded-full bg-hw-surface border border-hw-border flex items-center justify-center disabled:opacity-20 hover:bg-hw-surface-hover transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Global "add to collection" default toggle */}
          <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-hw-surface border border-hw-border mb-4">
            <div>
              <span className="text-sm text-hw-text font-medium">Default: add to collection</span>
              <p className="text-[11px] text-hw-muted mt-0.5">Toggle per-version using the bookmark icon</p>
            </div>
            <button
              onClick={() => setShouldAddToCollection(p => !p)}
              className={`relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${shouldAddToCollection ? 'bg-hw-accent' : 'bg-hw-border'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${shouldAddToCollection ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>

          {/* Versions / approve list */}
          <div className="space-y-2">
            {/* Header */}
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-hw-muted" />
                {detailLoading ? (
                  <span className="text-xs text-hw-muted flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Loading versions…
                  </span>
                ) : versions.length > 0 ? (
                  <span className="text-xs text-hw-muted">{versions.length} versions</span>
                ) : castingDetail ? (
                  <span className="text-xs text-hw-muted">No version table — adding as single entry</span>
                ) : null}
              </div>

              {/* Add All button */}
              {!detailLoading && castingDetail && idleCount > 1 && (
                <button
                  onClick={handleAddAll}
                  className="flex items-center gap-1 text-xs text-hw-accent hover:text-hw-orange transition-colors font-medium"
                >
                  <ChevronsRight className="w-3.5 h-3.5" />
                  Add all ({idleCount})
                </button>
              )}
            </div>

            {/* Rows */}
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
                    />
                  )
                })}

                {!showAllVersions && hiddenCount > 0 && (
                  <button
                    onClick={() => setShowAllVersions(true)}
                    className="w-full py-2 text-xs text-hw-accent hover:text-hw-orange transition-colors"
                  >
                    Show {hiddenCount} more versions
                  </button>
                )}
              </>
            ) : !detailLoading && castingDetail ? (
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
                  />
                )
              })()
            ) : null}
          </div>

          {/* Next casting prompt */}
          <div className="mt-5 flex items-center justify-between">
            {allResolved && (
              <span className="text-xs text-emerald-400 font-medium">All done for this casting!</span>
            )}
            <button
              onClick={goNext}
              disabled={currentIdx === cards.length - 1 && !loadingFeed}
              className="ml-auto text-sm text-hw-muted hover:text-hw-text transition-colors flex items-center gap-1 disabled:opacity-30"
            >
              {allResolved ? 'Next casting' : 'Skip casting'}
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <p className="text-center text-[11px] text-hw-muted/50 mt-3">← → keys · swipe on mobile</p>
        </>
      )}

      {!current && !loadingFeed && (
        <div className="text-center py-16 text-hw-muted">
          <p className="text-sm">No more cars in this batch.</p>
          <button onClick={() => { setCards([]); setCurrentIdx(0); loadMore() }} className="mt-3 btn-primary">
            <RefreshCw className="w-4 h-4" />
            Load new batch
          </button>
        </div>
      )}
    </div>
  )
}
