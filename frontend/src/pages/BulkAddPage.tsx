import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Upload, Loader2, CheckCircle2, AlertCircle, X,
  ImageIcon, CheckSquare, Square, ChevronRight, Search, Plus, ExternalLink,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { createCar, addToCollection, getAllSeries, createSeries, scrapeSearch, scrapeCar, type ScrapedCar, type ScrapedVersion } from '../lib/api'
import { useToastContext } from '../contexts/ToastContext'
import type { Series } from '../types'

// ── Types ─────────────────────────────────────────────────────────────────────

type RowStatus = 'pending' | 'searching' | 'found' | 'not_found' | 'error' | 'added'

interface ImportRow {
  id: number
  query: string
  status: RowStatus
  result?: ScrapedCar
  error?: string
  selected: boolean
  // editable fields
  name: string
  year: string
  color: string
  series_name: string
  series_type: string
  treasure_hunt: boolean
  carded: boolean       // true = carded, false = loose
  condition: string     // 'mint' | 'near mint' | 'good' | 'played'
  // version picker
  versions: ScrapedVersion[]
  image_url?: string
}

// ── Column field definitions ──────────────────────────────────────────────────

const COLUMN_FIELDS = [
  { value: '',              label: '— ignore —' },
  { value: 'name',         label: 'Name' },
  { value: 'year',         label: 'Year' },
  { value: 'color',        label: 'Color' },
  { value: 'series_name',  label: 'Series' },
  { value: 'series_type',  label: 'Series Type' },
  { value: 'treasure_hunt',label: 'Treasure Hunt' },
  { value: 'carded',       label: 'Carded / Loose' },
  { value: 'condition',    label: 'Condition' },
  { value: 'image_url',    label: 'Image URL' },
]

// ── Small components ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: RowStatus }) {
  const map: Record<RowStatus, { label: string; cls: string }> = {
    pending:   { label: 'Pending',    cls: 'text-hw-muted' },
    searching: { label: 'Searching…', cls: 'text-blue-400' },
    found:     { label: 'Found',      cls: 'text-emerald-400' },
    not_found: { label: 'Not found',  cls: 'text-amber-400' },
    error:     { label: 'Error',      cls: 'text-red-400' },
    added:     { label: '✓ Added',    cls: 'text-emerald-500 font-medium' },
  }
  const { label, cls } = map[status]
  return <span className={`text-[10px] ${cls}`}>{label}</span>
}

function RowCard({
  row,
  onToggle,
  onEdit,
  onPickVersion,
}: {
  row: ImportRow
  onToggle: () => void
  onEdit: (field: keyof ImportRow, value: string | boolean) => void
  onPickVersion: () => void
}) {
  const [imgErr, setImgErr] = useState(false)
  const canSelect = row.status === 'found' || row.status === 'not_found' || row.status === 'error'
  const isEditable = row.selected && canSelect
  const displayImage = row.image_url || row.result?.image_url

  return (
    <div className={`
      rounded-xl border p-3 flex flex-col gap-2 transition-all
      ${row.selected && canSelect ? 'border-hw-accent/50 bg-hw-accent/5' : 'border-hw-border bg-hw-surface'}
      ${row.status === 'added' ? 'opacity-50 pointer-events-none' : ''}
    `}>
      {/* Top row */}
      <div className="flex items-start gap-2">
        <button
          onClick={onToggle}
          disabled={!canSelect}
          className="mt-0.5 flex-shrink-0 text-hw-muted hover:text-hw-accent transition-colors disabled:opacity-30"
        >
          {row.status === 'searching' ? (
            <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
          ) : row.status === 'added' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          ) : row.selected ? (
            <CheckSquare className="w-4 h-4 text-hw-accent" />
          ) : (
            <Square className="w-4 h-4" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-hw-text truncate">{row.query}</p>
          <StatusBadge status={row.status} />
        </div>
        {row.result?.url && (
          <a
            href={row.result.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="flex-shrink-0 text-hw-muted hover:text-hw-accent transition-colors"
            title="View on wiki"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>

      {/* Image */}
      {displayImage && !imgErr && (
        <div className="h-28 rounded-lg overflow-hidden bg-zinc-900">
          <img
            src={displayImage}
            alt=""
            className="w-full h-full object-contain"
            onError={() => setImgErr(true)}
            loading="lazy"
          />
        </div>
      )}
      {canSelect && !displayImage && (
        <div className="h-16 rounded-lg bg-hw-bg flex items-center justify-center">
          <ImageIcon className="w-5 h-5 text-hw-muted/30" />
        </div>
      )}

      {/* Pick version button */}
      {row.versions.length > 0 && canSelect && (
        <button
          type="button"
          onClick={onPickVersion}
          className="w-full flex items-center justify-center gap-1 py-1 rounded-lg border border-hw-accent/40 text-[10px] font-medium text-hw-accent hover:bg-hw-accent/10 transition-colors"
        >
          <ChevronRight className="w-3 h-3" />
          Pick version ({row.versions.length})
        </button>
      )}

      {/* Editable fields when selected */}
      {isEditable && (
        <div className="space-y-1.5 pt-1 border-t border-hw-border">
          <input
            value={row.name}
            onChange={e => onEdit('name', e.target.value)}
            className="input-field py-1 text-xs"
            placeholder="Car name"
          />
          <div className="grid grid-cols-2 gap-1.5">
            <input
              value={row.year}
              onChange={e => onEdit('year', e.target.value)}
              className="input-field py-1 text-xs"
              placeholder="Year"
              type="number"
            />
            <input
              value={row.color}
              onChange={e => onEdit('color', e.target.value)}
              className="input-field py-1 text-xs"
              placeholder="Color"
            />
          </div>
          <input
            value={row.series_name}
            onChange={e => onEdit('series_name', e.target.value)}
            className="input-field py-1 text-xs"
            placeholder="Series"
          />
          <div className="grid grid-cols-2 gap-1.5">
            <select
              value={row.series_type || 'mainline'}
              onChange={e => onEdit('series_type', e.target.value)}
              className="input-field py-1 text-xs"
            >
              <option value="mainline">Mainline</option>
              <option value="premium">Premium</option>
              <option value="collector">Collector</option>
            </select>
            <select
              value={row.condition}
              onChange={e => onEdit('condition', e.target.value)}
              className="input-field py-1 text-xs"
            >
              <option value="mint">Mint</option>
              <option value="near mint">Near Mint</option>
              <option value="good">Good</option>
              <option value="played">Played</option>
            </select>
          </div>
          <div className="flex items-center gap-4 pt-0.5">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={row.carded}
                onChange={e => onEdit('carded', e.target.checked)}
                className="accent-orange-500"
              />
              <span className="text-[11px] text-hw-text">Carded</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={row.treasure_hunt}
                onChange={e => onEdit('treasure_hunt', e.target.checked)}
                className="accent-orange-500"
              />
              <span className="text-[11px] text-hw-text">Treasure Hunt</span>
            </label>
          </div>
        </div>
      )}

      {/* Not selected summary */}
      {!isEditable && row.status === 'found' && (
        <div className="text-xs text-hw-muted space-y-0.5">
          {row.result?.name && row.result.name !== row.name && (
            <p className="truncate text-[10px] text-hw-muted/60 italic">Wiki: {row.result.name}</p>
          )}
          {(row.year || row.color) && (
            <p>{[row.year, row.color].filter(Boolean).join(' · ')}</p>
          )}
          {row.series_name && <p className="truncate">{row.series_name}</p>}
          <div className="flex gap-2 flex-wrap">
            {row.treasure_hunt && <span className="text-[10px] text-amber-400 font-medium">★ TH</span>}
            {row.series_type && row.series_type !== 'mainline' && (
              <span className="text-[10px] text-blue-400 capitalize">{row.series_type}</span>
            )}
            {!row.carded && <span className="text-[10px] text-hw-muted">Loose</span>}
            {row.condition && row.condition !== 'mint' && (
              <span className="text-[10px] text-hw-muted capitalize">{row.condition}</span>
            )}
          </div>
        </div>
      )}

      {row.error && (
        <p className="text-[10px] text-red-400 flex items-center gap-1">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />
          {row.error}
        </p>
      )}
    </div>
  )
}

// ── Inline version picker ─────────────────────────────────────────────────────

function BulkVersionPicker({
  row,
  onSelect,
  onClose,
}: {
  row: ImportRow
  onSelect: (v: ScrapedVersion) => void
  onClose: () => void
}) {
  const [filter, setFilter] = useState('')
  const filtered = filter.trim()
    ? row.versions.filter(v =>
        String(v.year).includes(filter) ||
        v.color?.toLowerCase().includes(filter.toLowerCase()) ||
        v.series_name?.toLowerCase().includes(filter.toLowerCase())
      )
    : row.versions

  const grouped: Record<number, ScrapedVersion[]> = {}
  filtered.forEach(v => {
    if (!grouped[v.year]) grouped[v.year] = []
    grouped[v.year].push(v)
  })
  const sortedYears = Object.keys(grouped).map(Number).sort((a, b) => b - a)

  return (
    <div className="fixed inset-0 z-[70] flex">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="h-full w-80 bg-hw-surface border-l border-hw-border shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-hw-border flex-shrink-0">
          <div>
            <p className="text-xs text-hw-muted">Picking version for</p>
            <h3 className="text-sm font-semibold text-hw-text truncate">{row.name || row.query}</h3>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-hw-surface-hover flex items-center justify-center text-hw-muted">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-3 py-2 border-b border-hw-border flex-shrink-0">
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="input-field py-1.5 text-xs"
            placeholder="Filter by year, color, series…"
            autoFocus
          />
          <p className="text-[10px] text-hw-muted mt-1">{filtered.length} versions</p>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {sortedYears.map(year => (
            <div key={year}>
              <p className="text-xs font-semibold text-hw-muted mb-2 sticky top-0 bg-hw-surface py-0.5">{year}</p>
              <div className="grid grid-cols-2 gap-2">
                {grouped[year].map((v, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onSelect(v)}
                    className="flex flex-col gap-1 p-2 rounded-lg border border-hw-border bg-hw-bg hover:border-hw-accent hover:bg-hw-accent/5 transition-all text-left"
                  >
                    <div className="w-full h-16 rounded overflow-hidden bg-hw-surface flex items-center justify-center">
                      {v.photo_url ? (
                        <img src={v.photo_url} alt="" className="w-full h-full object-contain" loading="lazy" />
                      ) : (
                        <ImageIcon className="w-5 h-5 text-hw-muted/30" />
                      )}
                    </div>
                    <p className="text-[10px] font-semibold text-hw-text">{v.year}</p>
                    {v.color && <p className="text-[10px] text-hw-muted truncate">{v.color}</p>}
                    {v.series_name && <p className="text-[10px] text-hw-muted/70 truncate">{v.series_name}</p>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function BulkAddPage() {
  const navigate = useNavigate()
  const { toast } = useToastContext()
  const fileRef = useRef<HTMLInputElement>(null)
  const searchingRef = useRef(false)

  // Upload state
  const [text, setText] = useState('')
  const [delimiter, setDelimiter] = useState<string>('\n')
  const [hasHeader, setHasHeader] = useState(false)
  // columnMappings: col index → field name (e.g. { 0: 'name', 1: 'year', 2: 'color' })
  const [columnMappings, setColumnMappings] = useState<Record<number, string>>({ 0: 'name' })

  // Review state
  const [step, setStep] = useState<'upload' | 'review'>('upload')
  const [rows, setRows] = useState<ImportRow[]>([])
  const [addToCol, setAddToCol] = useState(true)
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const [activeVersionRowId, setActiveVersionRowId] = useState<number | null>(null)

  // ── Parse helpers ────────────────────────────────────────────────────────────

  const splitCell = (v: string) => v.trim().replace(/^"|"$/g, '')

  const parseBool = (v: string): boolean =>
    ['yes', 'true', '1', 'x', 'y', 'carded'].includes(v.toLowerCase().trim())

  // Map header names → field names, returns { field → colIndex }
  const detectHeaderFields = (headerLine: string, delim: string): Record<string, number> => {
    const headers = headerLine.split(delim).map(h => splitCell(h).toLowerCase())
    const map: Record<string, number> = {}
    const aliases: Record<string, string[]> = {
      name:          ['name', 'car', 'car_name', 'model', 'casting'],
      year:          ['year', 'yr'],
      color:         ['color', 'colour', 'primary_color', 'primary color'],
      series_name:   ['series', 'series_name', 'series name'],
      series_type:   ['type', 'series_type', 'car_type'],
      treasure_hunt: ['treasure_hunt', 'treasure hunt', 'th', 'super', 'super th'],
      carded:        ['carded', 'loose', 'packaging', 'status', 'carded_loose'],
      condition:     ['condition', 'grade', 'quality'],
      image_url:     ['image', 'image_url', 'photo', 'photo_url', 'img', 'picture'],
    }
    for (const [field, keys] of Object.entries(aliases)) {
      for (const key of keys) {
        const idx = headers.indexOf(key)
        if (idx !== -1) { map[field] = idx; break }
      }
    }
    return map
  }

  // Auto-detect year column from data values (no header)
  const autoDetectYearCol = (dataLines: string[], delim: string, skipCol: number): number | undefined => {
    if (!dataLines.length) return undefined
    const sample = dataLines.slice(0, Math.min(5, dataLines.length))
    const colCount = sample[0].split(delim).length
    for (let col = 0; col < colCount; col++) {
      if (col === skipCol) continue
      const matches = sample.filter(l => /^(19|20)\d{2}$/.test(splitCell(l.split(delim)[col] || ''))).length
      if (matches >= Math.ceil(sample.length / 2)) return col
    }
    return undefined
  }

  // Auto-init column mappings when text/delimiter/hasHeader changes
  useEffect(() => {
    if (!text.trim() || delimiter === '\n') {
      setColumnMappings({ 0: 'name' })
      return
    }
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n')
    const dataLines = (hasHeader ? lines.slice(1) : lines).filter(l => l.trim())
    const colCount = lines[0]?.split(delimiter).length ?? 1

    let newMappings: Record<number, string> = {}

    if (hasHeader && lines.length > 0) {
      const detected = detectHeaderFields(lines[0], delimiter)
      // Flip: field → colIndex to colIndex → field
      for (const [field, col] of Object.entries(detected)) {
        newMappings[col] = field
      }
    } else {
      // Auto-detect year from data patterns
      const nameCol = Object.entries(newMappings).find(([, f]) => f === 'name')?.[0]
      const yearCol = autoDetectYearCol(dataLines, delimiter, nameCol !== undefined ? Number(nameCol) : -1)
      if (yearCol !== undefined) newMappings[yearCol] = 'year'
    }

    // Ensure name is mapped to first unmapped col if not already assigned
    if (!Object.values(newMappings).includes('name')) {
      for (let i = 0; i < colCount; i++) {
        if (!newMappings[i]) {
          newMappings[i] = 'name'
          break
        }
      }
    }

    setColumnMappings(newMappings)
  }, [text, delimiter, hasHeader])

  // Build initial ImportRows from raw text
  const buildInitialRows = (): ImportRow[] => {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n')
    const dataLines = hasHeader ? lines.slice(1) : lines

    const result: ImportRow[] = []
    let id = 0

    for (const rawLine of dataLines) {
      if (!rawLine.trim()) continue

      if (delimiter === '\n') {
        const name = rawLine.trim()
        result.push({
          id: id++,
          query: name,
          status: 'pending',
          selected: false,
          name,
          year: '',
          color: '',
          series_name: '',
          series_type: '',
          treasure_hunt: false,
          carded: true,
          condition: 'mint',
          versions: [],
        })
      } else {
        const cells = rawLine.split(delimiter).map(c => splitCell(c))
        const get = (field: string): string => {
          const entry = Object.entries(columnMappings).find(([, f]) => f === field)
          if (!entry) return ''
          return cells[Number(entry[0])] ?? ''
        }

        const name = get('name')
        if (!name) continue

        const cardedVal = get('carded').toLowerCase()
        const carded = cardedVal === '' ? true : cardedVal !== 'loose'

        result.push({
          id: id++,
          query: name,
          status: 'pending',
          selected: false,
          name,
          year: get('year'),
          color: get('color'),
          series_name: get('series_name'),
          series_type: get('series_type') || '',
          treasure_hunt: parseBool(get('treasure_hunt')) && get('treasure_hunt') !== '',
          carded,
          condition: get('condition') || 'mint',
          versions: [],
          image_url: get('image_url') || undefined,
        })
      }
    }
    return result
  }

  // Normalised line count (actual total, not preview)
  const totalDataRows = (() => {
    if (!text.trim()) return 0
    const lines = text.trim().split('\n').filter(l => l.trim())
    const dataLines = hasHeader ? lines.slice(1) : lines
    if (delimiter === '\n') return dataLines.length
    return dataLines.filter(l => {
      const cells = l.split(delimiter)
      const entry = Object.entries(columnMappings).find(([, f]) => f === 'name')
      if (!entry) return cells[0]?.trim()
      return cells[Number(entry[0])]?.trim()
    }).length
  })()

  // Preview rows (first 6 data rows only — for the column-mapper table)
  const allPreviewRows = (() => {
    if (!text.trim()) return []
    const lines = text.trim().split('\n').slice(0, 8)
    if (delimiter === '\n') return lines.map(l => [l.trim()])
    return lines.map(l => l.split(delimiter).map(c => c.trim().replace(/^"|"$/g, '')))
  })()
  const columnCount = allPreviewRows[0]?.length ?? 1
  const headerRow = hasHeader ? allPreviewRows[0] : undefined
  const dataPreview = hasHeader ? allPreviewRows.slice(1) : allPreviewRows

  // ── Search ────────────────────────────────────────────────────────────────────

  const handleSearch = useCallback(async () => {
    if (searchingRef.current) return
    const initial = buildInitialRows()
    if (!initial.length) { toast.error('No car names found'); return }
    searchingRef.current = true
    setRows(initial)
    setStep('review')

    const BATCH = 5
    for (let i = 0; i < initial.length; i += BATCH) {
      const batchRows = initial.slice(i, i + BATCH)
      const batchIds = batchRows.map(r => r.id)
      setRows(prev => prev.map(r => batchIds.includes(r.id) ? { ...r, status: 'searching' } : r))
      await Promise.all(
        batchRows.map(async (row) => {
          try {
            const results = await scrapeSearch(row.query, 'wiki')
            const best = results[0]
            setRows(prev => prev.map(r => r.id === row.id ? {
              ...r,
              status: best ? 'found' : 'not_found',
              result: best || undefined,
              selected: !!best,
              // Keep user's original name — wiki results can be wrong
              name: r.name !== r.query ? r.name : row.query,
              // Fill any empty fields from wiki
              year: r.year || (best?.year ? String(best.year) : ''),
              color: r.color || best?.primary_color || '',
              series_name: r.series_name || best?.series_name || '',
              series_type: r.series_type || (best?.car_type && best.car_type !== 'treasure hunt' ? best.car_type : '') || 'mainline',
              treasure_hunt: r.treasure_hunt || best?.treasure_hunt || false,
            } : r))
            if (best?.url) {
              scrapeCar(best.url).then(detail => {
                if (!detail) return
                setRows(prev => prev.map(r => {
                  if (r.id !== row.id) return r
                  return {
                    ...r,
                    versions: detail.versions ?? [],
                    result: r.result
                      ? { ...r.result, image_url: r.result.image_url || detail.image_url }
                      : r.result,
                  }
                }))
              }).catch(() => {})
            }
          } catch {
            setRows(prev => prev.map(r => r.id === row.id ? { ...r, status: 'error', error: 'Search failed' } : r))
          }
        })
      )
    }
    searchingRef.current = false
  }, [text, delimiter, hasHeader, columnMappings, toast])

  // ── Import ─────────────────────────────────────────────────────────────────

  const handleImport = async () => {
    const toAdd = rows.filter(r => r.selected && r.status !== 'added')
    if (!toAdd.length) { toast.error('No cars selected'); return }
    setImporting(true)

    let allSeries: Series[] = []
    try { allSeries = await getAllSeries() } catch {}

    const normalize = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\b\d{4}\b/g, '').trim()

    let done = 0
    for (const row of toAdd) {
      setImportProgress(Math.round((done / toAdd.length) * 100))
      try {
        let series_id: string | undefined
        const sName = row.series_name.trim()
        if (sName) {
          const match = allSeries.find(s => normalize(s.name) === normalize(sName))
          if (match) {
            series_id = match.id
          } else {
            const ns = await createSeries({ name: sName, type: row.series_type || 'mainline' })
            series_id = ns.id
            allSeries = [...allSeries, ns]
          }
        }
        const isTH = row.treasure_hunt || row.result?.treasure_hunt || false
        const newCar = await createCar({
          name: row.name.trim() || row.query,
          year: row.year ? parseInt(row.year) : undefined,
          series_id,
          primary_color: row.color || undefined,
          car_type: row.result?.car_type || (isTH ? 'treasure hunt' : row.series_type || 'mainline'),
          treasure_hunt: isTH,
          barcode: row.result?.barcode || undefined,
          image_url: row.image_url || row.result?.image_url || undefined,
        })
        if (addToCol) {
          await addToCollection({
            allcars_id: newCar.id,
            carded: row.carded,
            condition: row.condition || 'mint',
          }).catch(() => {})
        }
        setRows(prev => prev.map(r => r.id === row.id ? { ...r, status: 'added', selected: false } : r))
        done++
      } catch (err) {
        setRows(prev => prev.map(r => r.id === row.id ? {
          ...r, status: 'error', error: err instanceof Error ? err.message : 'Failed',
        } : r))
      }
    }
    setImportProgress(100)
    setImporting(false)
    toast.success(`Added ${done} car${done !== 1 ? 's' : ''}!`)
  }

  const selectedRows = rows.filter(r => r.selected && r.status !== 'added')
  const searching = rows.some(r => r.status === 'searching' || r.status === 'pending')
  const addedCount = rows.filter(r => r.status === 'added').length
  const hasNameMapped = delimiter === '\n' || Object.values(columnMappings).includes('name')

  // ── Render: Upload step ──────────────────────────────────────────────────────

  if (step === 'upload') {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <button onClick={() => navigate('/all-cars')} className="text-hw-muted hover:text-hw-text transition-colors">
            <X className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-hw-text">Bulk Import</h1>
            <p className="text-hw-text-secondary text-sm mt-0.5">Import many cars at once from a file or paste</p>
          </div>
        </div>

        <div className="space-y-5">
          {/* Upload / paste */}
          <div>
            <label className="label">Upload file or paste car names</label>
            <div
              className="w-full h-20 border-2 border-dashed border-hw-border rounded-xl flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:border-hw-accent hover:bg-hw-accent/5 transition-colors mb-3"
              onClick={() => fileRef.current?.click()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { const r = new FileReader(); r.onload = ev => setText((ev.target?.result as string ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')); r.readAsText(f) } }}
              onDragOver={e => e.preventDefault()}
            >
              <Upload className="w-4 h-4 text-hw-muted" />
              <p className="text-sm text-hw-text-secondary">Drop CSV / TXT or <span className="text-hw-accent">browse</span></p>
            </div>
            <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = ev => setText((ev.target?.result as string ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')); r.readAsText(f) } }} />
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              className="input-field font-mono text-xs resize-none h-36"
              placeholder={"One name per line:\nFirebird\nTwin Mill\nDeora III\n\nOr CSV with headers:\nname,year,color,series,loose,condition,treasure_hunt\nFirebird,2021,Red,,loose,mint,no\nTwin Mill,2020,Blue,HW Legends,,mint,no"}
            />
          </div>

          {/* Format options */}
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <label className="label">Separator</label>
              <select value={delimiter} onChange={e => setDelimiter(e.target.value)} className="input-field text-sm">
                <option value="\n">One per line</option>
                <option value=",">Comma (,)</option>
                <option value=";">Semicolon (;)</option>
                <option value="\t">Tab</option>
              </select>
            </div>
            {delimiter !== '\n' && (
              <div className="flex items-end pb-0.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={hasHeader} onChange={e => setHasHeader(e.target.checked)} className="accent-orange-500" />
                  <span className="text-sm text-hw-text">First row is header</span>
                </label>
              </div>
            )}
          </div>

          {/* Column mapper (CSV mode only) */}
          {delimiter !== '\n' && allPreviewRows.length > 0 && (
            <div>
              <p className="text-xs text-hw-muted mb-2">
                {totalDataRows.toLocaleString()} {totalDataRows === 1 ? 'row' : 'rows'} detected — assign columns (showing first {dataPreview.length}):
              </p>
              <div className="bg-hw-bg rounded-xl border border-hw-border overflow-x-auto">
                <table className="text-xs w-full">
                  <thead>
                    <tr className="border-b border-hw-border">
                      {Array.from({ length: columnCount }, (_, i) => (
                        <th key={i} className="px-2 pt-2 pb-1.5 text-left min-w-[120px]">
                          {hasHeader && headerRow?.[i] && (
                            <p className="text-[10px] text-hw-muted mb-1 truncate font-normal">{headerRow[i]}</p>
                          )}
                          <select
                            value={columnMappings[i] ?? ''}
                            onChange={e => setColumnMappings(prev => ({ ...prev, [i]: e.target.value }))}
                            className="input-field py-0.5 text-[10px] w-full"
                          >
                            {COLUMN_FIELDS.map(f => (
                              <option key={f.value} value={f.value}>{f.label}</option>
                            ))}
                          </select>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dataPreview.slice(0, 4).map((row, i) => (
                      <tr key={i} className={i % 2 === 0 ? '' : 'bg-hw-surface/40'}>
                        {row.map((cell, j) => (
                          <td
                            key={j}
                            className={`px-2 py-1.5 truncate max-w-[160px] ${
                              columnMappings[j] === 'name'
                                ? 'text-hw-accent font-medium'
                                : columnMappings[j]
                                  ? 'text-hw-text'
                                  : 'text-hw-muted/40'
                            }`}
                          >
                            {cell || <span className="italic text-hw-border/60">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!hasNameMapped && (
                <p className="text-[11px] text-amber-400 mt-1.5 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Assign at least one column as "Name"
                </p>
              )}
            </div>
          )}

          {/* One-per-line: simple count */}
          {delimiter === '\n' && dataPreview.length > 0 && (
            <p className="text-xs text-hw-muted">{dataPreview.length} car{dataPreview.length !== 1 ? 's' : ''} detected</p>
          )}

          <button
            onClick={handleSearch}
            disabled={!text.trim() || dataPreview.length === 0 || !hasNameMapped}
            className="btn-primary w-full justify-center disabled:opacity-40"
          >
            <Search className="w-4 h-4" />
            Search {dataPreview.length > 0 ? `${dataPreview.length} cars` : ''} on Hot Wheels wiki
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

  // ── Render: Review step ──────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-5">
        <button onClick={() => { setStep('upload'); setRows([]) }} className="text-hw-muted hover:text-hw-text transition-colors">
          <X className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-hw-text">Review & Import</h1>
          <p className="text-hw-text-secondary text-sm">
            {searching
              ? 'Searching Hot Wheels wiki…'
              : `${rows.filter(r => r.status === 'found').length} found · ${rows.filter(r => r.status === 'not_found').length} not found · ${addedCount} added`
            }
          </p>
        </div>
        {searching && <Loader2 className="w-5 h-5 animate-spin text-blue-400 flex-shrink-0" />}
      </div>

      {/* Toolbar */}
      {!searching && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <button
            onClick={() => setRows(prev => prev.map(r => (r.status === 'found' || r.status === 'not_found') ? { ...r, selected: true } : r))}
            className="text-sm text-hw-accent hover:underline"
          >
            Select all found
          </button>
          <span className="text-hw-border">·</span>
          <button
            onClick={() => setRows(prev => prev.map(r => ({ ...r, selected: false })))}
            className="text-sm text-hw-muted hover:text-hw-text"
          >
            Deselect all
          </button>
          <span className="text-xs text-hw-muted ml-auto">
            {selectedRows.length} selected
          </span>
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 mb-6">
        {rows.map(row => (
          <RowCard
            key={row.id}
            row={row}
            onToggle={() => setRows(prev => prev.map(r => r.id === row.id ? { ...r, selected: !r.selected } : r))}
            onEdit={(field, value) => setRows(prev => prev.map(r => r.id === row.id ? { ...r, [field]: value } : r))}
            onPickVersion={() => setActiveVersionRowId(row.id)}
          />
        ))}
      </div>

      {/* Version picker drawer */}
      {activeVersionRowId !== null && (() => {
        const vRow = rows.find(r => r.id === activeVersionRowId)
        if (!vRow) return null
        return (
          <BulkVersionPicker
            row={vRow}
            onClose={() => setActiveVersionRowId(null)}
            onSelect={v => {
              setRows(prev => prev.map(r => r.id === activeVersionRowId ? {
                ...r,
                year: String(v.year),
                color: v.color || r.color,
                series_name: v.series_name || r.series_name,
                series_type: v.car_type === 'premium' ? 'premium' : r.series_type,
                image_url: v.photo_url || r.image_url,
                selected: true,
              } : r))
              setActiveVersionRowId(null)
            }}
          />
        )
      })()}

      {/* Footer */}
      {!searching && (
        <div className="sticky bottom-0 bg-hw-bg border-t border-hw-border -mx-4 md:-mx-6 px-4 md:px-6 py-4 flex items-center gap-4 flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer flex-shrink-0">
            <input type="checkbox" checked={addToCol} onChange={e => setAddToCol(e.target.checked)} className="accent-orange-500" />
            <span className="text-sm text-hw-text">Add to my collection</span>
          </label>

          {importing && (
            <div className="flex-1 min-w-32">
              <div className="h-1.5 bg-hw-border rounded-full overflow-hidden">
                <div className="h-full bg-hw-accent rounded-full transition-all duration-300" style={{ width: `${importProgress}%` }} />
              </div>
              <p className="text-xs text-hw-muted mt-1">{importProgress}% · {addedCount} added</p>
            </div>
          )}

          <div className="flex gap-2 ml-auto">
            <button
              onClick={() => navigate('/all-cars')}
              disabled={importing}
              className="btn-secondary disabled:opacity-40"
            >
              Done
            </button>
            <button
              onClick={handleImport}
              disabled={selectedRows.length === 0 || importing}
              className="btn-primary disabled:opacity-40"
            >
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {importing
                ? `Adding… (${addedCount}/${selectedRows.length + addedCount})`
                : `Add ${selectedRows.length} car${selectedRows.length !== 1 ? 's' : ''}`
              }
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
