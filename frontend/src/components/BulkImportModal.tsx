import { useState, useRef, useCallback } from 'react'
import {
  X, Upload, ChevronRight, Check, Loader2, AlertCircle,
  ImageIcon, Search, CheckSquare, Square, Plus,
} from 'lucide-react'
import { Modal } from './Modal'
import { scrapeSearch, createCar, getAllSeries, createSeries, addToCollection, type ScrapedCar } from '../lib/api'
import { useToastContext } from '../contexts/ToastContext'

// ── Types ─────────────────────────────────────────────────────────────────────

type ImportStatus = 'pending' | 'searching' | 'found' | 'not_found' | 'error' | 'added' | 'skipped'

interface ImportRow {
  id: number
  query: string
  status: ImportStatus
  result?: ScrapedCar
  error?: string
  selected: boolean
  // user overrides
  name: string
  year: string
  color: string
  series_type: string
  series_name: string
}

// ── Step 1: Upload ────────────────────────────────────────────────────────────

function UploadStep({ onParsed }: { onParsed: (names: string[]) => void }) {
  const [text, setText] = useState('')
  const [delimiter, setDelimiter] = useState<',' | ';' | '\t' | '\n'>(',')
  const [hasHeader, setHasHeader] = useState(false)
  const [nameCol, setNameCol] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  const preview = (() => {
    if (!text.trim()) return []
    const lines = text.trim().split('\n').slice(0, 6)
    if (delimiter === '\n') return lines.map(l => [l.trim()])
    return lines.map(l => l.split(delimiter).map(c => c.trim().replace(/^"|"$/g, '')))
  })()

  const columnCount = preview[0]?.length ?? 1
  const dataRows = hasHeader ? preview.slice(1) : preview

  const handleFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = e => setText(e.target?.result as string)
    reader.readAsText(file)
  }

  const handleProceed = () => {
    if (!text.trim()) return
    const allLines = text.trim().split('\n')
    const rows = (hasHeader ? allLines.slice(1) : allLines)
    const names = rows
      .map(l => {
        if (delimiter === '\n') return l.trim()
        const cols = l.split(delimiter).map(c => c.trim().replace(/^"|"$/g, ''))
        return cols[nameCol] ?? ''
      })
      .filter(n => n.length > 0)
    onParsed(names)
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="label">Upload file or paste car names</label>
        <div
          className="w-full h-28 border-2 border-dashed border-hw-border rounded-xl flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-hw-accent hover:bg-hw-accent/5 transition-colors mb-2"
          onClick={() => fileRef.current?.click()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
          onDragOver={e => e.preventDefault()}
        >
          <Upload className="w-5 h-5 text-hw-muted" />
          <p className="text-xs text-hw-text-secondary">Drop CSV/TXT or <span className="text-hw-accent">browse</span></p>
        </div>
        <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          className="input-field font-mono text-xs resize-none h-32"
          placeholder={"Paste car names here — one per line, or CSV format:\nBone Shaker\nTwin Mill\nDeora III\n\nOr CSV:\nBone Shaker,2021,Red\nTwin Mill,2020,Blue"}
        />
      </div>

      {/* Format settings */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="label">Delimiter</label>
          <select value={delimiter} onChange={e => setDelimiter(e.target.value as typeof delimiter)} className="input-field text-sm">
            <option value="\n">One per line</option>
            <option value=",">Comma (,)</option>
            <option value=";">Semicolon (;)</option>
            <option value="\t">Tab</option>
          </select>
        </div>
        <div>
          <label className="label">Name column</label>
          <select value={nameCol} onChange={e => setNameCol(Number(e.target.value))} className="input-field text-sm" disabled={delimiter === '\n'}>
            {Array.from({ length: columnCount }, (_, i) => (
              <option key={i} value={i}>Column {i + 1}{hasHeader && preview[0]?.[i] ? ` (${preview[0][i]})` : ''}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end pb-0.5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={hasHeader} onChange={e => setHasHeader(e.target.checked)} className="accent-orange-500" />
            <span className="text-sm text-hw-text">First row is header</span>
          </label>
        </div>
      </div>

      {/* Preview */}
      {dataRows.length > 0 && (
        <div>
          <p className="text-xs text-hw-muted mb-1.5">Preview ({dataRows.length} rows detected)</p>
          <div className="bg-hw-bg rounded-lg border border-hw-border overflow-hidden">
            <table className="w-full text-xs">
              <tbody>
                {dataRows.slice(0, 4).map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? '' : 'bg-hw-surface'}>
                    {row.map((cell, j) => (
                      <td key={j} className={`px-3 py-1.5 truncate max-w-[120px] ${j === nameCol && delimiter !== '\n' ? 'text-hw-accent font-medium' : 'text-hw-text-secondary'}`}>
                        {cell || <span className="text-hw-border italic">empty</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-hw-muted mt-1">Highlighted column will be used as car name</p>
        </div>
      )}

      <button
        onClick={handleProceed}
        disabled={!text.trim() || dataRows.length === 0}
        className="btn-primary w-full justify-center disabled:opacity-40"
      >
        <Search className="w-4 h-4" />
        Search {dataRows.length > 0 ? `${dataRows.length} cars` : 'cars'} on collecthw.com
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  )
}

// ── Import row card ───────────────────────────────────────────────────────────

function ImportCard({
  row,
  onToggle,
  onEdit,
}: {
  row: ImportRow
  onToggle: () => void
  onEdit: (field: keyof ImportRow, value: string) => void
}) {
  const [imgErr, setImgErr] = useState(false)
  const imageUrl = row.result?.image_url

  const statusColor = {
    pending: 'text-hw-muted',
    searching: 'text-blue-400',
    found: 'text-emerald-400',
    not_found: 'text-red-400',
    error: 'text-red-400',
    added: 'text-emerald-500',
    skipped: 'text-hw-muted',
  }[row.status]

  const statusLabel = {
    pending: 'Pending',
    searching: 'Searching…',
    found: 'Found',
    not_found: 'Not found',
    error: 'Error',
    added: 'Added ✓',
    skipped: 'Skipped',
  }[row.status]

  const canSelect = row.status === 'found' || row.status === 'not_found' || row.status === 'error'

  return (
    <div className={`card p-3 flex flex-col gap-2 transition-all ${row.selected && canSelect ? 'border-hw-accent/50 bg-hw-accent/3' : ''} ${row.status === 'added' ? 'opacity-60' : ''}`}>
      {/* Header */}
      <div className="flex items-start gap-2">
        {canSelect ? (
          <button onClick={onToggle} className="mt-0.5 flex-shrink-0 text-hw-muted hover:text-hw-accent transition-colors">
            {row.selected ? <CheckSquare className="w-4 h-4 text-hw-accent" /> : <Square className="w-4 h-4" />}
          </button>
        ) : (
          <div className="w-4 h-4 mt-0.5 flex-shrink-0 flex items-center justify-center">
            {row.status === 'searching' && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />}
            {row.status === 'added' && <Check className="w-3.5 h-3.5 text-emerald-500" />}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-hw-text truncate">{row.query}</p>
          <p className={`text-[10px] ${statusColor}`}>{statusLabel}</p>
        </div>
      </div>

      {/* Image */}
      {imageUrl && !imgErr ? (
        <div className="w-full h-24 rounded-lg overflow-hidden bg-zinc-900">
          <img src={imageUrl} alt="" className="w-full h-full object-contain" onError={() => setImgErr(true)} loading="lazy" />
        </div>
      ) : row.status === 'found' ? (
        <div className="w-full h-24 rounded-lg bg-hw-bg flex items-center justify-center">
          <ImageIcon className="w-6 h-6 text-hw-muted/30" />
        </div>
      ) : null}

      {/* Editable fields — only when found */}
      {(row.status === 'found' || row.status === 'not_found') && row.selected && (
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
            placeholder="Series name"
          />
          <select
            value={row.series_type}
            onChange={e => onEdit('series_type', e.target.value)}
            className="input-field py-1 text-xs"
          >
            <option value="">Type…</option>
            <option value="mainline">Mainline</option>
            <option value="premium">Premium</option>
          </select>
        </div>
      )}

      {/* Not found note */}
      {row.status === 'not_found' && !row.selected && (
        <p className="text-[10px] text-hw-muted">Select to add manually</p>
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

// ── Main Modal ────────────────────────────────────────────────────────────────

interface BulkImportModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

export function BulkImportModal({ isOpen, onClose, onSuccess }: BulkImportModalProps) {
  const { toast } = useToastContext()
  const [step, setStep] = useState<'upload' | 'preview' | 'importing'>('upload')
  const [rows, setRows] = useState<ImportRow[]>([])
  const [addToCol, setAddToCol] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const searchingRef = useRef(false)

  const handleClose = () => {
    if (importing) return
    setStep('upload')
    setRows([])
    setImportProgress(0)
    onClose()
  }

  const handleParsed = useCallback(async (names: string[]) => {
    if (searchingRef.current) return
    searchingRef.current = true

    const initial: ImportRow[] = names.map((q, i) => ({
      id: i,
      query: q,
      status: 'pending',
      selected: false,
      name: q,
      year: '',
      color: '',
      series_type: 'mainline',
      series_name: '',
    }))
    setRows(initial)
    setStep('preview')

    // Search 5 at a time
    const BATCH = 5
    for (let i = 0; i < names.length; i += BATCH) {
      const batch = names.slice(i, i + BATCH)
      // Mark as searching
      setRows(prev => prev.map(r => batch.includes(r.query) && r.status === 'pending' ? { ...r, status: 'searching' } : r))

      await Promise.all(
        batch.map(async (q, bi) => {
          const idx = i + bi
          try {
            const results = await scrapeSearch(q)
            const best = results[0]
            setRows(prev => prev.map(r => r.id === idx ? {
              ...r,
              status: best ? 'found' : 'not_found',
              result: best || undefined,
              selected: !!best,
              name: best?.name || q,
              year: best?.year ? String(best.year) : '',
              color: best?.primary_color || '',
              series_type: (r.series_type !== 'mainline' ? r.series_type : null) || (best?.car_type === 'premium' ? 'premium' : 'mainline'),
              series_name: best?.series_name || '',
            } : r))
          } catch {
            setRows(prev => prev.map(r => r.id === idx ? { ...r, status: 'error', error: 'Search failed' } : r))
          }
        })
      )
    }
    searchingRef.current = false
  }, [])

  const toggleAll = (select: boolean) => {
    setRows(prev => prev.map(r => (r.status === 'found' || r.status === 'not_found') ? { ...r, selected: select } : r))
  }

  const selectedRows = rows.filter(r => r.selected && r.status !== 'added' && r.status !== 'skipped')
  const searching = rows.some(r => r.status === 'searching' || r.status === 'pending')
  const doneCount = rows.filter(r => r.status === 'added').length

  const handleImport = async () => {
    if (selectedRows.length === 0) return
    setImporting(true)

    // Pre-load series to match names
    let allSeries: Awaited<ReturnType<typeof getAllSeries>> = []
    try { allSeries = await getAllSeries() } catch {}

    const normalize = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\b\d{4}\b/g, '').trim()

    let added = 0
    for (const row of selectedRows) {
      setImportProgress(Math.round(((added) / selectedRows.length) * 100))
      try {
        // Resolve series
        let series_id: string | undefined
        const sName = row.series_name.trim()
        if (sName) {
          const match = allSeries.find(s => normalize(s.name) === normalize(sName))
          if (match) {
            series_id = match.id
          } else {
            // Create new series
            const newS = await createSeries({ name: sName, type: row.series_type || 'mainline' })
            series_id = newS.id
            allSeries = [...allSeries, newS]
          }
        }

        const newCar = await createCar({
          name: row.name.trim() || row.query,
          year: row.year ? parseInt(row.year) : undefined,
          series_id,
          primary_color: row.color || undefined,
          treasure_hunt: false,
          image_url: row.result?.image_url || undefined,
          barcode: undefined,
        })

        if (addToCol) {
          await addToCollection({ allcars_id: newCar.id, carded: true, condition: 'mint' }).catch(() => {})
        }

        setRows(prev => prev.map(r => r.id === row.id ? { ...r, status: 'added', selected: false } : r))
        added++
      } catch (err) {
        setRows(prev => prev.map(r => r.id === row.id ? {
          ...r, status: 'error', error: err instanceof Error ? err.message : 'Failed',
        } : r))
      }
    }

    setImportProgress(100)
    setImporting(false)
    toast.success(`Added ${added} car${added !== 1 ? 's' : ''}!`)
    onSuccess?.()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Bulk Import Cars" size="xl">
      {step === 'upload' && <UploadStep onParsed={handleParsed} />}

      {step === 'preview' && (
        <div className="flex flex-col gap-4">
          {/* Toolbar */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Search className="w-4 h-4 text-hw-muted" />
              <span className="text-sm text-hw-text-secondary">
                {searching ? 'Searching…' : `${rows.filter(r => r.status === 'found').length} found, ${rows.filter(r => r.status === 'not_found').length} not found`}
              </span>
              {searching && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />}
            </div>

            {!searching && (
              <div className="flex items-center gap-2 ml-auto">
                <button onClick={() => toggleAll(true)} className="text-xs text-hw-accent hover:underline">Select all found</button>
                <span className="text-hw-border">·</span>
                <button onClick={() => toggleAll(false)} className="text-xs text-hw-muted hover:text-hw-text">Deselect all</button>
              </div>
            )}
          </div>

          {/* Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[50vh] overflow-y-auto pr-1">
            {rows.map(row => (
              <ImportCard
                key={row.id}
                row={row}
                onToggle={() => setRows(prev => prev.map(r => r.id === row.id ? { ...r, selected: !r.selected } : r))}
                onEdit={(field, value) => setRows(prev => prev.map(r => r.id === row.id ? { ...r, [field]: value } : r))}
              />
            ))}
          </div>

          {/* Footer */}
          {!searching && (
            <div className="border-t border-hw-border pt-3 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={addToCol} onChange={e => setAddToCol(e.target.checked)} className="accent-orange-500" />
                <span className="text-sm text-hw-text">Also add to my collection</span>
              </label>

              {importing && (
                <div>
                  <div className="flex items-center justify-between text-xs text-hw-muted mb-1">
                    <span>Importing…</span>
                    <span>{importProgress}%</span>
                  </div>
                  <div className="h-1.5 bg-hw-border rounded-full overflow-hidden">
                    <div className="h-full bg-hw-accent rounded-full transition-all duration-300" style={{ width: `${importProgress}%` }} />
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => { setStep('upload'); setRows([]) }}
                  disabled={importing}
                  className="btn-secondary flex-shrink-0 disabled:opacity-40"
                >
                  <X className="w-4 h-4" />
                  Start over
                </button>
                <button
                  onClick={handleImport}
                  disabled={selectedRows.length === 0 || importing}
                  className="btn-primary flex-1 justify-center disabled:opacity-40"
                >
                  {importing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  {importing ? `Adding… (${doneCount}/${selectedRows.length + doneCount})` : `Add ${selectedRows.length} selected car${selectedRows.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
