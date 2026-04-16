import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Search, Loader2, X, ImageIcon, ChevronRight, Filter, ExternalLink, Check, Edit } from 'lucide-react'
import { Modal } from './Modal'
import { InfoTooltip } from './InfoTooltip'
import {
  createCar,
  getAllSeries,
  createSeries,
  addToCollection,
  uploadCarImage,
  scrapeSearch,
  scrapeCar,
  type ScrapedCar,
  type ScrapedVersion,
} from '../lib/api'
import { useToastContext } from '../contexts/ToastContext'
import type { Series } from '../types'
import { SeriesEditModal } from './SeriesEditModal'

interface AddCarModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
  preloadedScrape?: ScrapedCar | null
  initialAddToCollection?: boolean
}

const emptyForm = {
  name: '',
  series_id: '',
  year: '',
  barcode: '',
  toy_number: '',
  primary_color: '',
  set_number: '',
  series_number: '',
  th_type: 'none' as 'none' | 'th' | 'sth',
  new_series_name: '',
  new_series_type: 'mainline',
  new_series_total: '',
  add_to_collection: true,
  carded: true,
  condition: 'mint',
}

// Known Hot Wheels series prefixes / standalone names
const KNOWN_SERIES_PREFIXES = [
  'car culture', 'fast & furious', 'fast and furious', 'pop culture',
  'boulevard', 'hw ', 'hot wheels ', 'legends', 'retro', 'nightburnerz',
  'nightspeed', 'factory fresh', 'street', 'speed machines', 'racing',
  'showcase', 'collector', 'mainline', 'exotics', 'detroit muscle',
]

function hasKnownSeriesPrefix(name: string): boolean {
  const lower = name.toLowerCase().trim()
  return KNOWN_SERIES_PREFIXES.some(p => lower.startsWith(p))
}

// ── Series Picker Modal ───────────────────────────────────────────────────────

interface SeriesPickerProps {
  series: Series[]
  selectedId: string
  onSelect: (series: Series) => void
  onCreateNew: (name: string, type: string, totalCount?: number, year?: number) => void
  onEditSeries: (series: Series) => void
  onClose: () => void
}

function SeriesPicker({ series, selectedId, onSelect, onCreateNew, onEditSeries, onClose }: SeriesPickerProps) {
  const [search, setSearch] = useState('')
  const [pendingCreate, setPendingCreate] = useState<{ name: string; type: string } | null>(null)
  const [totalCount, setTotalCount] = useState('')
  const [seriesYear, setSeriesYear] = useState('')

  const filtered = search.trim()
    ? series.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
    : series

  const premiumSeries = filtered.filter(s => s.type === 'premium')
  const mainlineSeries = filtered.filter(s => s.type !== 'premium')
  const otherSeries = filtered.filter(s => s.type !== 'premium' && s.type !== 'mainline')

  const hasExactMatch = filtered.some(s => s.name.toLowerCase() === search.trim().toLowerCase())

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-hw-surface border border-hw-border rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-hw-border flex-shrink-0">
          <h3 className="text-sm font-semibold text-hw-text">Select Series</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg hover:bg-hw-surface-hover flex items-center justify-center text-hw-muted hover:text-hw-text transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2.5 border-b border-hw-border flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-hw-muted pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input-field pl-8 py-1.5 text-sm"
              placeholder="Search series…"
              autoFocus
            />
          </div>
        </div>

        {/* Series list - scrollable */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {search.trim() && !hasExactMatch && !pendingCreate && (
            <div className="mb-2 space-y-2">
              <button
                type="button"
                onClick={() => { setPendingCreate({ name: search.trim(), type: 'mainline' }); setTotalCount(''); setSeriesYear('') }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-dashed border-hw-border/50 bg-hw-surface-hover hover:border-hw-accent/50 transition-colors text-left"
              >
                <Plus className="w-4 h-4 text-hw-muted flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-hw-text">Create "{search.trim()}"</p>
                  <p className="text-xs text-hw-muted">Mainline series</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => { setPendingCreate({ name: search.trim(), type: 'premium' }); setTotalCount(''); setSeriesYear('') }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-dashed border-amber-600/30 bg-amber-950/20 hover:border-amber-500/50 transition-colors text-left"
              >
                <Plus className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-200">Create "{search.trim()}"</p>
                  <p className="text-xs text-amber-400/70">Premium series</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => { setPendingCreate({ name: search.trim(), type: 'collector' }); setTotalCount(''); setSeriesYear('') }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-dashed border-purple-600/30 bg-purple-950/20 hover:border-purple-500/50 transition-colors text-left"
              >
                <Plus className="w-4 h-4 text-purple-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-purple-200">Create "{search.trim()}"</p>
                  <p className="text-xs text-purple-400/70">Collector series (RLC)</p>
                </div>
              </button>
            </div>
          )}

          {pendingCreate && (
            <div className="mb-3 p-3 rounded-xl border border-hw-border bg-hw-bg space-y-3">
              <div>
                <p className="text-sm font-medium text-hw-text">Creating "{pendingCreate.name}"</p>
                <p className="text-xs text-hw-muted capitalize">{pendingCreate.type} series</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label text-xs">Year <span className="text-hw-muted font-normal">(optional)</span></label>
                  <input
                    type="number"
                    value={seriesYear}
                    onChange={e => setSeriesYear(e.target.value)}
                    className="input-field py-1.5 text-sm"
                    placeholder="2024"
                    min="1968"
                    max={new Date().getFullYear() + 2}
                    autoFocus
                  />
                </div>
                <div>
                  <label className="label text-xs">Total cars <span className="text-hw-muted font-normal">(optional)</span></label>
                  <input
                    type="number"
                    value={totalCount}
                    onChange={e => setTotalCount(e.target.value)}
                    className="input-field py-1.5 text-sm"
                    placeholder="e.g. 250"
                    min="1"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setPendingCreate(null)} className="btn-secondary flex-1 justify-center text-sm py-1.5">Back</button>
                <button
                  type="button"
                  onClick={() => {
                    onCreateNew(pendingCreate.name, pendingCreate.type, totalCount ? parseInt(totalCount) : undefined, seriesYear ? parseInt(seriesYear) : undefined)
                    onClose()
                  }}
                  className="btn-primary flex-1 justify-center text-sm py-1.5"
                >
                  Create Series
                </button>
              </div>
            </div>
          )}

          {filtered.length === 0 && !search.trim() && (
            <p className="text-sm text-hw-muted text-center py-8">No series yet</p>
          )}

          {premiumSeries.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-1.5 px-1">Premium</p>
              {premiumSeries.map(s => (
                <div key={s.id} className="flex items-center gap-1 group">
                  <button
                    type="button"
                    onClick={() => { onSelect(s); onClose() }}
                    className={`flex-1 flex items-center justify-between px-3 py-2 rounded-lg transition-colors text-left ${
                      selectedId === s.id
                        ? 'bg-hw-accent/10 border border-hw-accent/30'
                        : 'hover:bg-hw-surface-hover border border-transparent'
                    }`}
                  >
                    <span className="text-sm text-hw-text truncate">{s.name}</span>
                    {selectedId === s.id && <Check className="w-4 h-4 text-hw-accent flex-shrink-0" />}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onEditSeries(s) }}
                    className="p-1.5 rounded hover:bg-hw-surface-hover text-hw-muted/50 hover:text-hw-text transition-colors flex-shrink-0"
                    title="Edit series"
                  >
                    <Edit className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {mainlineSeries.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] font-bold text-hw-muted uppercase tracking-wider mb-1.5 px-1">Mainline</p>
              {mainlineSeries.map(s => (
                <div key={s.id} className="flex items-center gap-1 group">
                  <button
                    type="button"
                    onClick={() => { onSelect(s); onClose() }}
                    className={`flex-1 flex items-center justify-between px-3 py-2 rounded-lg transition-colors text-left ${
                      selectedId === s.id
                        ? 'bg-hw-accent/10 border border-hw-accent/30'
                        : 'hover:bg-hw-surface-hover border border-transparent'
                    }`}
                  >
                    <span className="text-sm text-hw-text truncate">{s.name}</span>
                    {selectedId === s.id && <Check className="w-4 h-4 text-hw-accent flex-shrink-0" />}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onEditSeries(s) }}
                    className="p-1.5 rounded hover:bg-hw-surface-hover text-hw-muted/50 hover:text-hw-text transition-colors flex-shrink-0"
                    title="Edit series"
                  >
                    <Edit className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {otherSeries.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-hw-muted uppercase tracking-wider mb-1.5 px-1">Other</p>
              {otherSeries.map(s => (
                <div key={s.id} className="flex items-center gap-1 group">
                  <button
                    type="button"
                    onClick={() => { onSelect(s); onClose() }}
                    className={`flex-1 flex items-center justify-between px-3 py-2 rounded-lg transition-colors text-left ${
                      selectedId === s.id
                        ? 'bg-hw-accent/10 border border-hw-accent/30'
                        : 'hover:bg-hw-surface-hover border border-transparent'
                    }`}
                  >
                    <span className="text-sm text-hw-text truncate">{s.name}</span>
                    {selectedId === s.id && <Check className="w-4 h-4 text-hw-accent flex-shrink-0" />}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onEditSeries(s) }}
                    className="p-1.5 rounded hover:bg-hw-surface-hover text-hw-muted/50 hover:text-hw-text transition-colors flex-shrink-0"
                    title="Edit series"
                  >
                    <Edit className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Version Picker Panel ─────────────────────────────────────────────────────

function VersionCard({
  version,
  onSelect,
}: {
  version: ScrapedVersion
  onSelect: (v: ScrapedVersion) => void
}) {
  const [imgErr, setImgErr] = useState(false)

  return (
    <button
      type="button"
      onClick={() => onSelect(version)}
      className="
        flex flex-col gap-1.5 p-2 rounded-lg border border-hw-border bg-hw-bg
        hover:border-hw-accent hover:bg-hw-accent/5 transition-all text-left
        group cursor-pointer
      "
    >
      <div className="w-full h-20 rounded-md overflow-hidden bg-hw-surface-hover flex-shrink-0">
        {version.photo_url && !imgErr ? (
          <img
            src={version.photo_url}
            alt={`${version.year} ${version.color}`}
            className="w-full h-full object-contain"
            onError={() => setImgErr(true)}
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="w-6 h-6 text-hw-muted/40" />
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <p className="text-xs font-semibold text-hw-text leading-tight">{version.year}</p>
          {version.car_type === 'premium' && (
            <span className="text-[9px] font-bold px-1 py-0 rounded bg-amber-900/50 text-amber-300 border border-amber-700/30 leading-4 flex-shrink-0">
              P
            </span>
          )}
        </div>
        {version.color && (
          <p className="text-[10px] text-hw-text-secondary truncate">{version.color}</p>
        )}
        {version.series_name && (
          <p className="text-[10px] text-hw-muted truncate">{version.series_name}</p>
        )}
        {(version.set_number || version.series_number) && (
          <p className="text-[10px] text-hw-muted/70 mt-0.5">
            {version.set_number ? `#${version.set_number}` : ''}
            {version.set_number && version.series_number ? ' · ' : ''}
            {version.series_number ? `s${version.series_number}` : ''}
          </p>
        )}
      </div>
    </button>
  )
}

interface VersionPickerProps {
  versions: ScrapedVersion[]
  castingName: string
  onSelect: (v: ScrapedVersion) => void
  onClose: () => void
}

function VersionPicker({ versions, castingName, onSelect, onClose }: VersionPickerProps) {
  const [search, setSearch] = useState('')

  const filtered = search.trim()
    ? versions.filter(v =>
        String(v.year).includes(search) ||
        v.color?.toLowerCase().includes(search.toLowerCase()) ||
        v.series_name?.toLowerCase().includes(search.toLowerCase())
      )
    : versions

  // Group by year
  const grouped: Record<number, ScrapedVersion[]> = {}
  filtered.forEach(v => {
    if (!grouped[v.year]) grouped[v.year] = []
    grouped[v.year].push(v)
  })
  const sortedYears = Object.keys(grouped)
    .map(Number)
    .sort((a, b) => b - a)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-hw-border flex-shrink-0">
        <div>
          <p className="text-xs text-hw-muted">Picking version for</p>
          <h3 className="text-sm font-semibold text-hw-text">{castingName}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-7 h-7 rounded-lg hover:bg-hw-surface-hover flex items-center justify-center text-hw-muted hover:text-hw-text transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Search/filter */}
      <div className="px-3 py-2.5 border-b border-hw-border flex-shrink-0">
        <div className="relative">
          <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-hw-muted pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input-field pl-7 py-1.5 text-xs"
            placeholder="Filter by year, color, series…"
            autoFocus
          />
        </div>
        <p className="text-[10px] text-hw-muted mt-1.5">
          {filtered.length} version{filtered.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Version grid — scrollable */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {sortedYears.length === 0 && (
          <p className="text-sm text-hw-muted text-center pt-8">No versions match</p>
        )}
        {sortedYears.map(year => (
          <div key={year}>
            <p className="text-xs font-semibold text-hw-muted mb-2 sticky top-0 bg-hw-surface py-0.5">
              {year}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {grouped[year].map((v, i) => (
                <VersionCard key={`${year}-${i}`} version={v} onSelect={onSelect} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function AddCarModal({ isOpen, onClose, onSuccess, preloadedScrape, initialAddToCollection }: AddCarModalProps) {
  const { toast } = useToastContext()
  const [series, setSeries] = useState<Series[]>([])
  const [_loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [showNewSeries, setShowNewSeries] = useState(false)
  const [showSeriesConfirm, setShowSeriesConfirm] = useState(false)

  // Image state
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [wikiImageUrl, setWikiImageUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Search state
  const [wikiQuery, setWikiQuery] = useState('')
  const [selectedCarUrl, setSelectedCarUrl] = useState<string | null>(null)
  const [searchResults, setSearchResults] = useState<ScrapedCar[]>([])
  const [wikiSearching, setWikiSearching] = useState(false)
  const [showWikiResults, setShowWikiResults] = useState(false)
  const wikiDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Version picker state
  const [versions, setVersions] = useState<ScrapedVersion[]>([])
  const [castingName, setCastingName] = useState('')
  const [showVersionPicker, setShowVersionPicker] = useState(false)

  // Series picker state
  const [showSeriesPicker, setShowSeriesPicker] = useState(false)
  const [editingSeries, setEditingSeries] = useState<Series | null>(null)

  // Track whether we've already applied a preloaded scrape for the current open session
  const appliedPreloadRef = useRef(false)
  // Track version count so we can enrich if versions arrive after initial preload
  const appliedVersionCountRef = useRef(0)

  const selectedSeries = series.find(s => s.id === form.series_id)

  useEffect(() => {
    if (isOpen) {
      appliedPreloadRef.current = false
      appliedVersionCountRef.current = 0
      setLoading(true)
      getAllSeries()
        .then(setSeries)
        .catch(() => toast.error('Failed to load series'))
        .finally(() => setLoading(false))
    }
  }, [isOpen])

  useEffect(() => {
    if (isOpen) setForm(prev => ({ ...prev, add_to_collection: initialAddToCollection ?? true }))
  }, [isOpen])

  const reset = useCallback(() => {
    setForm(emptyForm)
    setShowNewSeries(false)
    setImageFile(null)
    setImagePreview(null)
    setWikiImageUrl(null)
    setWikiQuery('')
    setSelectedCarUrl(null)
    setSearchResults([])
    setShowWikiResults(false)
    setVersions([])
    setCastingName('')
    setShowVersionPicker(false)
    setShowSeriesPicker(false)
  }, [])

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target
    setForm(prev => {
      const update: Partial<typeof prev> = {
        [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
      }
      // When series changes, sync new_series_type to match existing series type
      if (name === 'series_id') {
        const picked = series.find(s => s.id === value)
        if (picked?.type) update.new_series_type = picked.type
        // Clear TH if switching to premium series (premium can't be TH)
        if (picked?.type === 'premium') update.th_type = 'none'
      }
      return { ...prev, ...update }
    })
  }

  // ── Image handling ──────────────────────────────────────────────────────────

  const handleImageFile = (file: File) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('Only JPEG, PNG, or WebP images are allowed')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be under 5 MB')
      return
    }
    setImageFile(file)
    setWikiImageUrl(null)
    const url = URL.createObjectURL(file)
    setImagePreview(url)
  }

  const handleImageDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleImageFile(file)
  }

  const clearImage = () => {
    setImageFile(null)
    setImagePreview(null)
    setWikiImageUrl(null)
  }

  // ── Wiki search (triggered from name field) ─────────────────────────────────

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value
    handleChange(e)
    
    // Debounced wiki search
    if (wikiDebounceRef.current) clearTimeout(wikiDebounceRef.current)
    if (q.trim().length < 2) { setSearchResults([]); return }
    wikiDebounceRef.current = setTimeout(async () => {
      setWikiSearching(true)
      try {
        const results = await scrapeSearch(q.trim(), 'wiki')
        setSearchResults(results)
        setShowWikiResults(true)
      } catch {
        // Silent fail for search
      } finally {
        setWikiSearching(false)
      }
    }, 400)
  }

  // Apply scraped data to the form (used by both search select and preloaded scrape)
  const applyScrapedData = useCallback((data: ScrapedCar, showToast = true) => {
    if (data.name) setWikiQuery(data.name)

    const normalizeSeriesName = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\b\d{4}\b/g, '').trim()
    const seriesMatch = data.series_name
      ? series.find(s => normalizeSeriesName(s.name) === normalizeSeriesName(data.series_name!))
      : undefined
    const isNewSeries = !!data.series_name && !seriesMatch
    
    // If new series and series name suggests premium, auto-set type
    const seriesName = data.series_name || ''
    const isCollectorSeries = /rlc|red line club|collector|hw collectors|convention/i.test(seriesName)
    const isPremiumSeries = isCollectorSeries || /car culture|boulevard|pop culture|fast[ &]furious|hw exotics/i.test(seriesName)

    // Determine if this should be TH based on scraped data (not car_type since we removed that)
    const scrapedThType: 'none' | 'th' | 'sth' = data.treasure_hunt ? 'th' : 'none'

    setForm(prev => ({
      ...prev,
      name: data.name || prev.name,
      year: data.year ? String(data.year) : prev.year,
      series_id: seriesMatch ? seriesMatch.id : prev.series_id,
      new_series_name: isNewSeries ? data.series_name! : prev.new_series_name,
      new_series_type: isNewSeries ? (isCollectorSeries ? 'collector' : isPremiumSeries ? 'premium' : 'mainline') : prev.new_series_type,
      th_type: scrapedThType !== 'none' ? scrapedThType : prev.th_type,
      primary_color: data.primary_color || prev.primary_color,
      set_number: data.set_number ? String(data.set_number) : prev.set_number,
      series_number: data.series_number ? String(data.series_number) : prev.series_number,
    }))
    if (isNewSeries) setShowNewSeries(true)

    if (data.image_url) {
      setWikiImageUrl(data.image_url)
      setImagePreview(data.image_url)
      setImageFile(null)
    }

    if (data.versions && data.versions.length > 0) {
      setVersions(data.versions)
      setCastingName(data.name || '')
      setShowVersionPicker(true)
      if (showToast) toast.success(`Found ${data.versions.length} versions — pick yours!`)
    } else {
      if (showToast) toast.success('Auto-filled!')
    }
  }, [series, toast])

  // Apply preloaded scrape when modal opens (and series data is ready)
  useEffect(() => {
    if (!isOpen || !preloadedScrape || series.length === 0 || appliedPreloadRef.current) return
    appliedPreloadRef.current = true
    applyScrapedData(preloadedScrape, false)
  }, [isOpen, preloadedScrape, series, applyScrapedData])

  // Enrich with versions if they arrive after the initial preload (background wiki fetch)
  useEffect(() => {
    const vCount = preloadedScrape?.versions?.length ?? 0
    if (!isOpen || vCount === 0 || vCount === appliedVersionCountRef.current) return
    if (!appliedPreloadRef.current || series.length === 0) return
    appliedVersionCountRef.current = vCount
    setVersions(preloadedScrape!.versions!)
    setCastingName(preloadedScrape!.name || '')
    setShowVersionPicker(true)
    toast.success(`Found ${vCount} versions — pick yours!`)
  }, [isOpen, preloadedScrape, series.length, toast])

  const handleSearchSelect = async (car: ScrapedCar) => {
    setShowWikiResults(false)
    setSelectedCarUrl(car.url || null)
    // Apply wiki search result immediately (name + thumbnail image)
    applyScrapedData(car, false)
    if (!car.url) {
      toast.success('Auto-filled!')
      return
    }
    // Fetch full wiki page in background to get versions + full-size image
    setWikiSearching(true)
    try {
      const detail = await scrapeCar(car.url)
      if (detail) applyScrapedData(detail, true)
    } catch {
      toast.success('Auto-filled!')
    } finally {
      setWikiSearching(false)
    }
  }

  // ── Version selection ────────────────────────────────────────────────────────

  const handleVersionSelect = (v: ScrapedVersion) => {
    // Fuzzy series matching for selected version
    const normalizeSeriesName = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\b\d{4}\b/g, '').trim()
    const seriesMatch = v.series_name
      ? series.find(s => normalizeSeriesName(s.name) === normalizeSeriesName(v.series_name!))
      : undefined
    const isNewSeries = !!v.series_name && !seriesMatch
    
    // If new series and series name suggests premium (contains premium keywords), auto-set type
    const seriesName = v.series_name || ''
    const isCollectorSeries = /rlc|red line club|collector|hw collectors|convention/i.test(seriesName)
    const isPremiumSeries = isCollectorSeries || /car culture|boulevard|pop culture|fast[ &]furious|hw exotics/i.test(seriesName)
    
    setForm(prev => ({
      ...prev,
      year: String(v.year),
      primary_color: v.color || prev.primary_color,
      set_number: v.set_number ? String(v.set_number) : prev.set_number,
      series_number: v.series_number ? String(v.series_number) : prev.series_number,
      series_id: seriesMatch ? seriesMatch.id : prev.series_id,
      new_series_name: isNewSeries ? v.series_name! : prev.new_series_name,
      new_series_type: isNewSeries ? (isCollectorSeries ? 'collector' : isPremiumSeries ? 'premium' : prev.new_series_type) : prev.new_series_type,
      // For TH toggle: premium series can't be TH
      th_type: seriesMatch?.type === 'premium' || (isNewSeries && isPremiumSeries) ? 'none' : prev.th_type,
    }))
    if (isNewSeries) setShowNewSeries(true)

    // Use version photo if available, otherwise keep casting image
    if (v.photo_url) {
      setWikiImageUrl(v.photo_url)
      setImagePreview(v.photo_url)
      setImageFile(null)
    }

    setShowVersionPicker(false)
    toast.success(`Version selected: ${v.year} ${v.color || ''}`.trim())
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  const doSubmit = async () => {
    setSubmitting(true)
    try {
      let series_id = form.series_id

      if (showNewSeries && form.new_series_name.trim()) {
        const newSeries = await createSeries({
          name: form.new_series_name.trim(),
          type: form.new_series_type,
          total_count: form.new_series_total ? parseInt(form.new_series_total) : undefined,
        })
        series_id = newSeries.id
      }

      // Derive car_type: TH/STH overrides series type, otherwise use series type
      const resolvedSeries = series.find(s => s.id === series_id)
      const baseType = resolvedSeries?.type || form.new_series_type || 'mainline'
      const car_type =
        form.th_type === 'sth' ? 'super treasure hunt' :
        form.th_type === 'th' ? 'treasure hunt' :
        baseType

      // Note: car_type field kept for backward compatibility but now derived from series type
      const newCar = await createCar({
        name: form.name.trim(),
        series_id: series_id || undefined,
        year: form.year ? parseInt(form.year) : undefined,
        barcode: form.barcode || undefined,
        toy_number: form.toy_number || undefined,
        primary_color: form.primary_color || undefined,
        set_number: form.set_number ? parseInt(form.set_number) : undefined,
        series_number: form.series_number ? parseInt(form.series_number) : undefined,
        car_type,
        treasure_hunt: form.th_type !== 'none',
        image_url: wikiImageUrl || undefined,
      })

      if (imageFile) {
        try {
          await uploadCarImage(newCar.id, imageFile)
        } catch {
          toast.error('Car saved but image upload failed')
        }
      }

      if (form.add_to_collection) {
        await addToCollection({
          allcars_id: newCar.id,
          carded: form.carded,
          condition: form.condition,
        })
      }

      toast.success(`"${form.name}" added${form.add_to_collection ? ' to your collection' : ' to catalog'}!`)
      reset()
      onSuccess?.()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add car')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('Car name is required'); return }
    if (!form.series_id && !showNewSeries) { toast.error('Please select a series'); return }
    if (!form.primary_color.trim()) { toast.error('Please enter a color'); return }

    // If creating a new series with an unrecognized name, ask for confirmation
    if (showNewSeries && form.new_series_name.trim() && !hasKnownSeriesPrefix(form.new_series_name)) {
      setShowSeriesConfirm(true)
      return
    }

    await doSubmit()
  }

  const effectiveImagePreview = imagePreview

  return (
    <>
      <Modal isOpen={isOpen} onClose={handleClose} title="Add Car to Catalog" size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* ── Name ── */}
          <div>
            <label className="label">Car Name <span className="text-hw-accent">*</span></label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-hw-muted pointer-events-none z-10" />
              <input
                name="name"
                value={form.name}
                onChange={handleNameChange}
                className="input-field pl-8 pr-8"
                placeholder="Search or type car name (e.g. Bone Shaker, '69 Camaro…)"
                required
              />
              {wikiSearching ? (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-hw-muted animate-spin z-10" />
              ) : wikiQuery ? (
                <button type="button" onClick={() => { setWikiQuery(''); setSearchResults([]); setShowWikiResults(false); setVersions([]); setShowVersionPicker(false) }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-hw-muted hover:text-hw-text z-10">
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : null}
              {showWikiResults && searchResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-hw-surface border border-hw-border rounded-xl shadow-xl z-50 overflow-hidden max-h-72 overflow-y-auto">
                  {searchResults.map((car, i) => (
                    <button
                      key={car.collecthw_id || i}
                      type="button"
                      onClick={() => handleSearchSelect(car)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-hw-surface-hover transition-colors text-left border-b border-hw-border last:border-0"
                    >
                      {car.image_url ? (
                        <img src={car.image_url} alt="" className="w-10 h-10 rounded object-contain bg-zinc-900 flex-shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded bg-hw-surface-hover flex-shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-hw-text truncate">{car.name}</p>
                        <p className="text-xs text-hw-muted truncate">
                          {[car.year, car.series_name, car.primary_color].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      {car.treasure_hunt && <span className="text-xs text-yellow-500 font-bold flex-shrink-0">TH</span>}
                      <ChevronRight className="w-3.5 h-3.5 text-hw-muted flex-shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <p className="text-xs text-hw-muted">Search Hot Wheels wiki to auto-fill details</p>
              {versions.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowVersionPicker(true)}
                  className="flex items-center gap-1 text-xs text-hw-accent hover:text-hw-orange transition-colors font-medium"
                >
                  Browse {versions.length} versions
                  <ChevronRight className="w-3 h-3" />
                </button>
              )}
            </div>
            {selectedCarUrl && (
              <a
                href={selectedCarUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-hw-muted hover:text-hw-accent transition-colors mt-1"
                title="Open wiki page"
              >
                <ExternalLink className="w-3 h-3" />
                View on wiki
              </a>
            )}
          </div>

          {/* ── Image ── */}
          <div>
            <label className="label">Image</label>
            {effectiveImagePreview ? (
              <div className="relative w-full h-40 rounded-lg overflow-hidden border border-hw-border group">
                <img src={effectiveImagePreview} alt="Preview" className="w-full h-full object-contain bg-hw-bg" />
                <button
                  type="button"
                  onClick={clearImage}
                  className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                {wikiImageUrl && (
                  <span className="absolute bottom-2 left-2 text-[10px] bg-black/60 text-white px-2 py-0.5 rounded-full">
                    from wiki
                  </span>
                )}
              </div>
            ) : (
              <div
                onDrop={handleImageDrop}
                onDragOver={e => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-28 border-2 border-dashed border-hw-border rounded-lg flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-hw-accent hover:bg-hw-accent/5 transition-colors"
              >
                <ImageIcon className="w-6 h-6 text-hw-muted" />
                <div className="text-center">
                  <p className="text-xs text-hw-text-secondary">Drop image or <span className="text-hw-accent">browse</span></p>
                  <p className="text-[10px] text-hw-muted">JPEG, PNG, WebP · max 5 MB</p>
                </div>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f) }}
            />
          </div>

          {/* ── Series ── */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="label mb-0">Series <span className="text-hw-accent">*</span></label>
              <button
                type="button"
                onClick={() => setShowSeriesPicker(true)}
                className="text-xs text-hw-accent hover:text-hw-orange transition-colors"
              >
                Browse all ({series.length})
              </button>
            </div>

            {form.series_id ? (
              <button
                type="button"
                onClick={() => setShowSeriesPicker(true)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-hw-border bg-hw-bg hover:bg-hw-surface-hover transition-colors text-left"
              >
                <span className="text-sm text-hw-text truncate">
                  {selectedSeries?.name || 'Unknown series'}
                </span>
                <ChevronRight className="w-4 h-4 text-hw-muted" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowSeriesPicker(true)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-hw-border text-hw-muted hover:border-hw-accent hover:text-hw-accent transition-colors"
              >
                <Search className="w-4 h-4" />
                <span className="text-sm">Select a series</span>
              </button>
            )}
          </div>

          {/* ── Year ── */}
          <div>
            <label className="label">Year</label>
            <input
              name="year" value={form.year} onChange={handleChange}
              className="input-field" type="number" placeholder="2024"
              min="1968" max={new Date().getFullYear() + 2}
            />
          </div>

          {/* ── Numbering ── */}
          {(() => {
            const effectiveSeriesType = selectedSeries?.type || (showNewSeries ? form.new_series_type : 'mainline')
            const isMainlineVariant = effectiveSeriesType !== 'premium'
            return (
          <div className={`grid gap-3 ${isMainlineVariant ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <div>
              <label className="label flex items-center">
                Series position
                <InfoTooltip text="Position within the series — e.g. 3 if the car is '3/10' in HW Euro." />
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  name="series_number" value={form.series_number} onChange={handleChange}
                  className="input-field" type="number" placeholder="e.g. 3" min="1"
                />
                {selectedSeries?.total_count && (
                  <span className="text-sm text-hw-muted flex-shrink-0">/ {selectedSeries.total_count}</span>
                )}
              </div>
            </div>
            {isMainlineVariant && (
              <div>
                <label className="label flex items-center">
                  Mainline #
                  <InfoTooltip text="Car's position in the year's mainline lineup — e.g. 127 for #127/250." />
                </label>
                <input
                  name="set_number" value={form.set_number} onChange={handleChange}
                  className="input-field" type="number" placeholder="e.g. 127" min="1"
                />
              </div>
            )}
          </div>
            )
          })()}

          {/* ── Toy Number + Color ── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label flex items-center">
                Toy Number
                <InfoTooltip text="5-char code on the card packaging (e.g. DHP27). Identifies the specific release — use for both mainline and premium." />
              </label>
              <input
                name="toy_number" value={form.toy_number} onChange={handleChange}
                className="input-field uppercase" placeholder="e.g. DHP27" maxLength={10}
              />
            </div>
            <div>
              <label className="label">Primary Color <span className="text-hw-accent">*</span></label>
              <input
                name="primary_color" value={form.primary_color} onChange={handleChange}
                className="input-field" placeholder="Red, Blue, …"
              />
            </div>
          </div>

          {/* ── Barcode (UPC) ── */}
          <div>
            <label className="label flex items-center">
              Barcode (UPC)
              <InfoTooltip text="The retail UPC barcode on the back of the card. Optional — use Toy Number for collector identification instead." />
            </label>
            <input
              name="barcode" value={form.barcode} onChange={handleChange}
              className="input-field" placeholder="0123456789"
            />
          </div>

          {/* ── Add to collection ── */}
          <div className="flex items-center gap-3 p-3 bg-hw-bg rounded-lg border border-hw-border">
            <input
              type="checkbox" id="add_to_collection" name="add_to_collection"
              checked={form.add_to_collection} onChange={handleChange}
              className="w-4 h-4 rounded border-hw-border bg-hw-surface accent-orange-500"
            />
            <label htmlFor="add_to_collection" className="cursor-pointer text-sm font-medium text-hw-text">
              Add to my collection
            </label>
          </div>

          {form.add_to_collection && (
            <div className="space-y-3 p-3 bg-hw-bg rounded-lg border border-hw-border">
              <div>
                <label className="label">Display Style</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setForm(p => ({ ...p, carded: true }))}
                    className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-all ${
                      form.carded
                        ? 'border-hw-accent bg-hw-accent/10 text-hw-accent'
                        : 'border-hw-border text-hw-muted hover:border-zinc-600'
                    }`}
                  >
                    Carded
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm(p => ({ ...p, carded: false, condition: form.condition === 'mint' ? 'good' : form.condition }))}
                    className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-all ${
                      !form.carded
                        ? 'border-hw-accent bg-hw-accent/10 text-hw-accent'
                        : 'border-hw-border text-hw-muted hover:border-zinc-600'
                    }`}
                  >
                    Loose
                  </button>
                </div>
              </div>
              <div>
                <label className="label">Condition</label>
                <select
                  name="condition"
                  value={form.condition}
                  onChange={e => setForm(p => ({ ...p, condition: e.target.value }))}
                  className="input-field"
                >
                  <option value="mint">Mint - Perfect condition, unopened</option>
                  <option value="good">Good - Minor wear, complete</option>
                  <option value="fair">Fair - Visible wear, functional</option>
                  <option value="poor">Poor - Heavy wear or damage</option>
                </select>
              </div>
            </div>
          )}

          {/* ── Treasure Hunt ── */}
          {selectedSeries?.type !== 'premium' && (
            <div className={`p-3 rounded-lg border transition-colors ${form.th_type !== 'none' ? 'border-yellow-600/40 bg-yellow-950/20' : 'border-hw-border bg-hw-bg'}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-hw-text flex items-center gap-2">
                  Treasure Hunt
                  {form.th_type !== 'none' && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-yellow-900/50 text-yellow-300 border border-yellow-600/40">
                      {form.th_type === 'sth' ? 'SUPER TH' : 'TH'}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setForm(p => ({ ...p, th_type: p.th_type === 'none' ? 'th' : 'none' }))}
                  className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${form.th_type !== 'none' ? 'bg-yellow-600' : 'bg-hw-border'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${form.th_type !== 'none' ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
              {form.th_type !== 'none' && (
                <div className="flex gap-2 mt-3">
                  {(['th', 'sth'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm(p => ({ ...p, th_type: t }))}
                      className={`flex-1 py-1.5 rounded-lg border text-xs font-bold transition-all ${
                        form.th_type === t
                          ? 'bg-yellow-900/50 text-yellow-200 border-yellow-600/50'
                          : 'border-hw-border text-hw-muted hover:border-yellow-700/40 hover:text-yellow-400/70'
                      }`}
                    >
                      {t === 'sth' ? 'Super TH' : 'Regular TH'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Actions ── */}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={handleClose} className="btn-secondary flex-1 justify-center">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="btn-primary flex-1 justify-center">
              {submitting ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              {submitting ? 'Adding…' : 'Add Car'}
            </button>
          </div>
        </form>

        {/* ── Series confirmation dialog ── */}
        {showSeriesConfirm && (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-6 bg-hw-surface/80 backdrop-blur-sm rounded-2xl">
            <div className="bg-hw-surface border border-hw-border rounded-2xl shadow-2xl p-6 max-w-sm w-full">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-9 h-9 rounded-xl bg-yellow-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-yellow-400 text-lg">⚠</span>
                </div>
                <div>
                  <h3 className="font-semibold text-hw-text mb-1">New series name</h3>
                  <p className="text-sm text-hw-text-secondary">
                    You're creating a new series:
                  </p>
                  <p className="mt-2 px-3 py-2 bg-hw-bg rounded-lg border border-hw-border text-sm font-medium text-hw-text">
                    "{form.new_series_name}"
                  </p>
                  <p className="text-sm text-hw-text-secondary mt-3">
                    Series names usually include a recognized prefix like <span className="text-hw-text font-medium">Car Culture:</span>, <span className="text-hw-text font-medium">Pop Culture:</span>, <span className="text-hw-text font-medium">Boulevard</span>, or <span className="text-hw-text font-medium">Fast &amp; Furious:</span>. Double-check the spelling before saving.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowSeriesConfirm(false)}
                  className="btn-secondary flex-1 justify-center"
                >
                  Go Back
                </button>
                <button
                  type="button"
                  onClick={() => { setShowSeriesConfirm(false); doSubmit() }}
                  disabled={submitting}
                  className="btn-primary flex-1 justify-center"
                >
                  {submitting ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : null}
                  Save Anyway
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Version Picker Drawer ── */}
      {isOpen && showVersionPicker && (
        <div className="fixed inset-0 z-[60] flex">
          {/* Click-outside area */}
          <div className="flex-1" onClick={() => setShowVersionPicker(false)} />
          {/* Drawer panel */}
          <div className="h-full w-80 bg-hw-surface border-l border-hw-border shadow-2xl flex flex-col animate-slide-in-right">
            <VersionPicker
              versions={versions}
              castingName={castingName}
              onSelect={handleVersionSelect}
              onClose={() => setShowVersionPicker(false)}
            />
          </div>
        </div>
      )}

      {/* ── Series Picker Modal ── */}
      {isOpen && showSeriesPicker && (
        <SeriesPicker
          series={series}
          selectedId={form.series_id}
          onSelect={(s) => {
            setForm(prev => ({
              ...prev,
              series_id: s.id,
              new_series_type: s.type,
              th_type: s.type === 'premium' ? 'none' : prev.th_type,
            }))
          }}
          onCreateNew={async (name, type, totalCount, year) => {
            const newSeries = await createSeries({ name, type, total_count: totalCount, year })
            setSeries(prev => [...prev, newSeries])
            setForm(prev => ({
              ...prev,
              series_id: newSeries.id,
              new_series_type: type,
              th_type: type === 'premium' ? 'none' : prev.th_type,
            }))
          }}
          onEditSeries={(s) => { setEditingSeries(s); setShowSeriesPicker(false) }}
          onClose={() => setShowSeriesPicker(false)}
        />
      )}

      {/* ── Series Edit Modal ── */}
      <SeriesEditModal
        isOpen={!!editingSeries}
        onClose={() => { setEditingSeries(null); setShowSeriesPicker(true) }}
        series={editingSeries}
        onSuccess={(updated) => {
          setSeries(prev => prev.map(s => s.id === updated.id ? updated : s))
          if (form.series_id === updated.id) {
            setForm(prev => ({
              ...prev,
              new_series_type: updated.type,
              th_type: updated.type === 'premium' ? 'none' : prev.th_type,
            }))
          }
          setEditingSeries(null)
          setShowSeriesPicker(true)
        }}
        onDelete={(id) => {
          setSeries(prev => prev.filter(s => s.id !== id))
          if (form.series_id === id) setForm(prev => ({ ...prev, series_id: '' }))
          setEditingSeries(null)
          setShowSeriesPicker(true)
        }}
      />
    </>
  )
}
