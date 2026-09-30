/**
 * Sheet Import — moving a spreadsheet collection into the app one car at a time.
 *
 * The problem this solves is not parsing a file, it is that a 2,500-row sheet
 * needs a few thousand small judgements ("is this the blue 2015 one?") that
 * nothing can decide automatically. So the screen is built around making one
 * decision as cheap as possible: the row from the sheet on the left, the best
 * match found for it in the middle, the alternatives beside it, and Enter to
 * approve. Everything is keyboard-driven, because the difference between two
 * seconds and six seconds per car is the difference between an evening and a week.
 *
 * Every approval commits on the spot and the queue lives on the server, so this
 * can be closed at any point and picked up later with nothing lost.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, ChevronRight,
  Clock, ExternalLink, FileSpreadsheet, Flag, ImageIcon, Keyboard, Layers, Loader2,
  PackageOpen, Pencil, RotateCcw, Search, SkipForward, Sparkles, Star, Trash2, Upload, X,
} from 'lucide-react'
import {
  commitImportRow, deleteImportBatch, getImportBatch, getImportBatches, getImportCandidates,
  getImportQueue, prefetchImportRows, resolveImageUrl, setImportRowStatus, setImportSheetCarded,
  undoImportRow, uploadSheet,
  type ImportBatch, type ImportCandidate, type ImportCommitPayload, type ImportRow,
  type ImportSheetSummary, type SheetRowData,
} from '../lib/api'
import { useToastContext } from '../contexts/ToastContext'

// ─── Shared bits ──────────────────────────────────────────────────────────────

/** How a sheet fill colour reads on screen, using the meaning the sheet gave it. */
const MARKERS: Record<string, { label: string; dot: string; hint?: string }> = {
  green: { label: 'Imported by hand', dot: 'bg-emerald-500' },
  amber: { label: 'Not found before', dot: 'bg-orange-500', hint: 'You could not find this one last time — matching may do better now.' },
  other: { label: 'Highlighted', dot: 'bg-blue-500' },
  none:  { label: 'Untouched', dot: 'bg-hw-border' },
}

function confidence(score: number): { label: string; text: string; bar: string } {
  if (score >= 75) return { label: 'Strong match', text: 'text-emerald-500', bar: 'bg-emerald-500' }
  if (score >= 55) return { label: 'Likely match', text: 'text-amber-500', bar: 'bg-amber-500' }
  return { label: 'Weak match', text: 'text-hw-muted', bar: 'bg-hw-muted' }
}

function Progress({ value, className = '' }: { value: number; className?: string }) {
  return (
    <div className={`h-1.5 rounded-full bg-hw-border overflow-hidden ${className}`}>
      <div className="h-full bg-hw-accent rounded-full transition-all duration-300"
           style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  )
}

function Chip({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'accent' | 'warn' | 'good' }) {
  const tones = {
    muted:  'bg-hw-surface-hover text-hw-text-secondary',
    accent: 'bg-hw-accent/10 text-hw-accent',
    warn:   'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    good:   'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  }
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${tones[tone]}`}>{children}</span>
}

// ─── Upload ───────────────────────────────────────────────────────────────────

function UploadPanel({ onUploaded }: { onUploaded: (batch: ImportBatch) => void }) {
  const { toast } = useToastContext()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  const send = async (file?: File | null) => {
    if (!file) return
    setBusy(true)
    try {
      onUploaded(await uploadSheet(file))
      toast.success(`Read ${file.name}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read that file')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div
        onClick={() => !busy && fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); send(e.dataTransfer.files[0]) }}
        className={`border-2 border-dashed rounded-xl px-6 py-10 flex flex-col items-center gap-2 cursor-pointer transition-colors
          ${dragging ? 'border-hw-accent bg-hw-accent/5' : 'border-hw-border hover:border-hw-accent hover:bg-hw-accent/5'}`}
      >
        {busy ? <Loader2 className="w-6 h-6 text-hw-accent animate-spin" /> : <Upload className="w-6 h-6 text-hw-muted" />}
        <p className="text-sm text-hw-text font-medium">
          {busy ? 'Reading the sheet…' : <>Drop your Numbers sheet here, or <span className="text-hw-accent">browse</span></>}
        </p>
        <p className="text-xs text-hw-muted text-center max-w-md">
          .numbers or .csv. Every sheet in the file is read, and the row colours come with it:
          green rows count as already imported, orange and red as "couldn't find it last time".
        </p>
      </div>
      <input ref={fileRef} type="file" accept=".numbers,.csv,.tsv,.txt" className="hidden"
             onChange={e => send(e.target.files?.[0])} />
    </div>
  )
}

// ─── Batch list and overview ──────────────────────────────────────────────────

function BatchRow({ batch, onOpen, onDelete }: { batch: ImportBatch; onOpen: () => void; onDelete: () => void }) {
  const total = batch.total ?? 0
  const decided = (batch.imported ?? 0) + (batch.skipped ?? 0) + (batch.already_done ?? 0)
  return (
    <div className="card p-4 flex items-center gap-4">
      <FileSpreadsheet className="w-5 h-5 text-hw-accent flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-hw-text truncate">{batch.source_name}</p>
        <p className="text-xs text-hw-muted">
          {decided.toLocaleString()} of {total.toLocaleString()} done
          {batch.pending ? ` · ${batch.pending.toLocaleString()} to go` : ''}
          {' · '}started {new Date(batch.created_at).toLocaleDateString()}
        </p>
        <Progress value={total ? (decided / total) * 100 : 0} className="mt-2" />
      </div>
      <button onClick={onOpen} className="btn-primary flex-shrink-0">
        Continue <ChevronRight className="w-4 h-4" />
      </button>
      <button onClick={onDelete} title="Forget this import (imported cars are kept)"
              className="p-2 rounded-lg text-hw-muted hover:text-red-500 hover:bg-red-500/10 transition-colors flex-shrink-0">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  )
}

function SheetCard({
  sheet, onStart, onCardedChange,
}: {
  sheet: ImportSheetSummary
  onStart: () => void
  onCardedChange: (carded: boolean) => void
}) {
  const decided = sheet.imported + sheet.skipped + sheet.already_done
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-hw-text flex items-center gap-2">
            <Layers className="w-4 h-4 text-hw-muted" /> {sheet.sheet}
          </p>
          <p className="text-xs text-hw-muted mt-0.5">{sheet.total.toLocaleString()} cars</p>
        </div>
        <button onClick={onStart} disabled={!sheet.pending && !sheet.later}
                className="btn-primary flex-shrink-0 disabled:opacity-40">
          {sheet.pending || sheet.later ? 'Review' : 'Done'} <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <Progress value={sheet.total ? (decided / sheet.total) * 100 : 0} className="mt-3" />

      <div className="flex flex-wrap gap-1.5 mt-3">
        {!!sheet.already_done && <Chip tone="good">{sheet.already_done} already in (green)</Chip>}
        {!!sheet.imported && <Chip tone="accent">{sheet.imported} imported here</Chip>}
        {!!sheet.pending && <Chip>{sheet.pending} to review</Chip>}
        {!!sheet.later && <Chip tone="warn">{sheet.later} parked</Chip>}
        {!!sheet.skipped && <Chip>{sheet.skipped} skipped</Chip>}
        {!!sheet.amber && <Chip tone="warn">{sheet.amber} were not found before</Chip>}
      </div>

      {/* Carded/loose is read from the sheet's name, which is a guess worth a
          second pair of eyes — it applies to every car on the sheet. */}
      <label className="flex items-center gap-2 mt-3 pt-3 border-t border-hw-border text-xs text-hw-text-secondary">
        <PackageOpen className="w-3.5 h-3.5 text-hw-muted" />
        These cars are
        <select
          value={sheet.carded === false ? 'loose' : 'carded'}
          onChange={e => onCardedChange(e.target.value === 'carded')}
          className="input-field py-1 text-xs w-auto"
        >
          <option value="carded">still carded</option>
          <option value="loose">loose</option>
        </select>
      </label>
    </div>
  )
}

// ─── The row from the sheet ───────────────────────────────────────────────────

function SheetRowPanel({ row }: { row: ImportRow }) {
  const raw = row.raw
  const marker = MARKERS[row.marker] ?? MARKERS.none
  const fields: [string, React.ReactNode][] = [
    ['Colour', raw.color || '—'],
    ['Model', raw.body || '—'],
    ['Year', raw.year_raw || '—'],
  ]
  if (raw.set_name) fields.push(['Set', raw.set_name])
  if (raw.set_number) fields.push(['Number', `${raw.set_number}${raw.set_total ? ` of ${raw.set_total}` : ''}`])
  if (raw.real_rider !== null && raw.real_rider !== undefined) fields.push(['Real riders', raw.real_rider ? 'yes' : 'no'])

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-[11px] text-hw-muted">
        <span className={`w-2 h-2 rounded-full ${marker.dot}`} />
        <span className="font-medium">{raw.sheet}</span>
        <span>row {raw.row_index}</span>
        <span className="ml-auto">{marker.label}</span>
      </div>

      <h2 className="text-lg font-bold text-hw-text mt-2 leading-tight break-words">{raw.name}</h2>

      <dl className="mt-3 space-y-1.5">
        {fields.map(([label, value]) => (
          <div key={label} className="flex gap-2 text-xs">
            <dt className="text-hw-muted w-20 flex-shrink-0">{label}</dt>
            <dd className="text-hw-text break-words">{value}</dd>
          </div>
        ))}
      </dl>

      {raw.details && (
        <p className="mt-3 pt-3 border-t border-hw-border text-xs text-hw-text-secondary italic break-words">
          “{raw.details}”
        </p>
      )}

      <div className="flex flex-wrap gap-1.5 mt-3">
        {raw.treasure_hunt && <Chip tone="warn"><Star className="w-2.5 h-2.5 inline" /> {raw.super_treasure_hunt ? 'Super TH' : 'Treasure hunt'}</Chip>}
        {raw.carded === false && <Chip>Loose</Chip>}
        {raw.carded === true && <Chip>Carded</Chip>}
      </div>

      {/* Things about the row that change what to do with it. */}
      <div className="mt-3 space-y-2">
        {marker.hint && (
          <p className="text-[11px] text-orange-600 dark:text-orange-400 flex gap-1.5">
            <Flag className="w-3 h-3 flex-shrink-0 mt-0.5" />{marker.hint}
          </p>
        )}
        {raw.other_brand && (
          <p className="text-[11px] text-hw-text-secondary flex gap-1.5">
            <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
            The sheet says <b className="font-semibold">{raw.other_brand}</b> — the Hot Wheels wiki won't have it, so add it from the sheet instead.
          </p>
        )}
        {raw.unidentified && (
          <p className="text-[11px] text-hw-text-secondary flex gap-1.5">
            <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
            This one was never identified in the sheet. Try a search term below, or skip it.
          </p>
        )}
        {raw.duplicate_count > 1 && (
          <p className="text-[11px] text-hw-text-secondary flex gap-1.5">
            <Layers className="w-3 h-3 flex-shrink-0 mt-0.5" />
            Same car {raw.duplicate_count}× on this sheet (rows {raw.duplicate_rows.join(', ')}) — set “own” to {raw.duplicate_count} here and skip the others.
          </p>
        )}
        {raw.multi_car.length > 1 && (
          <p className="text-[11px] text-hw-text-secondary flex gap-1.5">
            <Layers className="w-3 h-3 flex-shrink-0 mt-0.5" />
            {raw.multi_car.length} cars in this row: {raw.multi_car.join(' · ')}. Import the first here, then use “search again” for the rest.
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Candidates ───────────────────────────────────────────────────────────────

function CandidateHero({ candidate }: { candidate: ImportCandidate }) {
  const [imgFailed, setImgFailed] = useState(false)
  const conf = confidence(candidate.score)
  const image = resolveImageUrl(candidate.image_url)

  useEffect(() => { setImgFailed(false) }, [candidate.key])

  return (
    <div className="card overflow-hidden">
      <div className="h-48 sm:h-60 bg-hw-bg flex items-center justify-center">
        {image && !imgFailed ? (
          <img src={image} alt="" className="w-full h-full object-contain" onError={() => setImgFailed(true)} />
        ) : (
          <ImageIcon className="w-10 h-10 text-hw-muted/30" />
        )}
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-hw-text break-words">{candidate.name}</h3>
            <p className="text-xs text-hw-text-secondary mt-0.5">
              {[candidate.year, candidate.color, candidate.series_name].filter(Boolean).join(' · ') || 'No release details'}
            </p>
          </div>
          {candidate.url && (
            <a href={candidate.url} target="_blank" rel="noopener noreferrer"
               className="text-hw-muted hover:text-hw-accent transition-colors flex-shrink-0" title="Open the wiki page">
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
        </div>

        <div className="flex items-center gap-2 mt-3">
          <span className={`text-[11px] font-semibold ${conf.text}`}>{conf.label}</span>
          <div className="flex-1 h-1 rounded-full bg-hw-border overflow-hidden">
            <div className={`h-full rounded-full ${conf.bar}`} style={{ width: `${candidate.score}%` }} />
          </div>
          <span className="text-[10px] text-hw-muted tabular-nums">{candidate.score}</span>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {candidate.source === 'collection' && <Chip tone="good"><CheckCircle2 className="w-2.5 h-2.5 inline" /> Already in your collection</Chip>}
          {candidate.source === 'catalogue' && <Chip tone="accent">Already in the catalogue</Chip>}
          {candidate.reasons.slice(0, 4).map(reason => <Chip key={reason}>{reason}</Chip>)}
          {candidate.toy_number && <Chip>{candidate.toy_number}</Chip>}
          {candidate.series_number && (
            <Chip>#{candidate.series_number}{candidate.series_total ? ` of ${candidate.series_total}` : ''}</Chip>
          )}
        </div>
      </div>
    </div>
  )
}

function CandidateThumb({
  candidate, index, selected, onSelect,
}: {
  candidate: ImportCandidate; index: number; selected: boolean; onSelect: () => void
}) {
  const [imgFailed, setImgFailed] = useState(false)
  const image = resolveImageUrl(candidate.image_url)
  return (
    <button
      onClick={onSelect}
      className={`p-1.5 rounded-lg border text-left transition-all flex-shrink-0 w-28
        ${selected ? 'border-hw-accent bg-hw-accent/5 ring-1 ring-hw-accent/40' : 'border-hw-border bg-hw-surface hover:border-hw-muted'}`}
    >
      <div className="h-16 rounded bg-hw-bg flex items-center justify-center overflow-hidden">
        {image && !imgFailed ? (
          <img src={image} alt="" className="w-full h-full object-contain" loading="lazy" onError={() => setImgFailed(true)} />
        ) : (
          <ImageIcon className="w-4 h-4 text-hw-muted/30" />
        )}
      </div>
      <div className="flex items-center gap-1 mt-1">
        {index < 9 && (
          <kbd className="text-[9px] font-mono px-1 rounded bg-hw-surface-hover text-hw-muted">{index + 1}</kbd>
        )}
        <span className="text-[10px] font-semibold text-hw-text truncate">{candidate.year ?? '—'}</span>
        <span className={`ml-auto text-[9px] tabular-nums ${confidence(candidate.score).text}`}>{candidate.score}</span>
      </div>
      <p className="text-[10px] text-hw-muted truncate">{candidate.color || candidate.name}</p>
      {candidate.series_name && <p className="text-[9px] text-hw-muted/70 truncate">{candidate.series_name}</p>}
    </button>
  )
}

// ─── Editable fields ──────────────────────────────────────────────────────────

interface Draft {
  name: string
  year: string
  color: string
  series_name: string
  series_type: string
  carded: boolean
  condition: string
  amount_owned: number
  treasure_hunt: boolean
  notes: string
  add_to_collection: boolean
}

/** What gets saved, given the row, the chosen candidate, and any hand edits. */
function draftFor(raw: SheetRowData, candidate?: ImportCandidate): Draft {
  return {
    name: candidate?.name || raw.name,
    year: String(candidate?.year ?? raw.year ?? ''),
    color: candidate?.color || raw.color || '',
    series_name: candidate?.series_name || raw.set_name || '',
    series_type: candidate?.car_type === 'premium' ? 'premium' : 'mainline',
    carded: raw.carded ?? true,
    condition: 'mint',
    amount_owned: 1,
    treasure_hunt: raw.treasure_hunt || !!candidate?.treasure_hunt,
    notes: raw.details || '',
    add_to_collection: true,
  }
}

function payloadFor(draft: Draft, raw: SheetRowData, candidate?: ImportCandidate): ImportCommitPayload {
  const carType = candidate?.car_type
    || (raw.super_treasure_hunt ? 'super treasure hunt' : raw.treasure_hunt ? 'treasure hunt' : draft.series_type)
  return {
    name: draft.name.trim() || raw.name,
    car_id: candidate?.car_id ?? null,
    candidate_key: candidate?.key ?? null,
    year: draft.year ? Number(draft.year) : null,
    primary_color: draft.color || null,
    series_name: draft.series_name || null,
    series_type: draft.series_type,
    series_number: candidate?.series_number ?? raw.set_number ?? null,
    set_number: candidate?.set_number ?? null,
    toy_number: candidate?.toy_number ?? null,
    car_type: carType,
    treasure_hunt: draft.treasure_hunt,
    image_url: candidate?.image_url ?? null,
    add_to_collection: draft.add_to_collection,
    carded: draft.carded,
    condition: draft.condition,
    amount_owned: Math.max(1, draft.amount_owned),
    notes: draft.notes.trim() || null,
  }
}

function FieldsPanel({
  draft, onChange, nameRef,
}: {
  draft: Draft
  onChange: (patch: Partial<Draft>) => void
  nameRef: React.RefObject<HTMLInputElement>
}) {
  return (
    <div className="card p-3 space-y-2">
      <p className="label mb-1">What gets saved</p>
      <input ref={nameRef} value={draft.name} onChange={e => onChange({ name: e.target.value })}
             className="input-field py-1.5 text-xs" placeholder="Car name" />
      <div className="grid grid-cols-2 gap-2">
        <input value={draft.year} onChange={e => onChange({ year: e.target.value })}
               className="input-field py-1.5 text-xs" placeholder="Year" inputMode="numeric" />
        <input value={draft.color} onChange={e => onChange({ color: e.target.value })}
               className="input-field py-1.5 text-xs" placeholder="Colour" />
      </div>
      <input value={draft.series_name} onChange={e => onChange({ series_name: e.target.value })}
             className="input-field py-1.5 text-xs" placeholder="Series / set" />
      <div className="grid grid-cols-2 gap-2">
        <select value={draft.series_type} onChange={e => onChange({ series_type: e.target.value })}
                className="input-field py-1.5 text-xs">
          <option value="mainline">Mainline</option>
          <option value="premium">Premium</option>
          <option value="collector">Collector</option>
        </select>
        <select value={draft.condition} onChange={e => onChange({ condition: e.target.value })}
                className="input-field py-1.5 text-xs">
          <option value="mint">Mint</option>
          <option value="near mint">Near mint</option>
          <option value="good">Good</option>
          <option value="played">Played with</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select value={draft.carded ? 'carded' : 'loose'} onChange={e => onChange({ carded: e.target.value === 'carded' })}
                className="input-field py-1.5 text-xs">
          <option value="carded">Carded</option>
          <option value="loose">Loose</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs text-hw-text px-1">
          own
          <input type="number" min={1} value={draft.amount_owned}
                 onChange={e => onChange({ amount_owned: Number(e.target.value) })}
                 className="input-field py-1.5 text-xs w-16" />
        </label>
      </div>
      <input value={draft.notes} onChange={e => onChange({ notes: e.target.value })}
             className="input-field py-1.5 text-xs" placeholder="Notes (kept from the sheet)" />
      <div className="flex items-center gap-4 pt-0.5 flex-wrap">
        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-hw-text">
          <input type="checkbox" checked={draft.treasure_hunt} className="accent-orange-500"
                 onChange={e => onChange({ treasure_hunt: e.target.checked })} />
          Treasure hunt
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-hw-text">
          <input type="checkbox" checked={draft.add_to_collection} className="accent-orange-500"
                 onChange={e => onChange({ add_to_collection: e.target.checked })} />
          Add to collection
        </label>
      </div>
    </div>
  )
}

// ─── Shortcuts ────────────────────────────────────────────────────────────────

const SHORTCUTS: [string, string][] = [
  ['Enter', 'Approve the selected match and move on'],
  ['1 – 9', 'Pick one of the alternatives'],
  ['← / →', 'Move through the alternatives'],
  ['S', 'Skip this row'],
  ['L', 'Park it for later'],
  ['M', 'Add it from the sheet only, no match'],
  ['R', 'Search again'],
  ['E', 'Edit the name'],
  ['[ / ]', 'Previous / next row'],
  ['U', 'Undo the last approval'],
  ['?', 'Show this list'],
]

function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card p-5 max-w-sm w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-hw-text flex items-center gap-2">
            <Keyboard className="w-4 h-4" /> Shortcuts
          </h3>
          <button onClick={onClose} className="text-hw-muted hover:text-hw-text"><X className="w-4 h-4" /></button>
        </div>
        <dl className="space-y-1.5">
          {SHORTCUTS.map(([key, description]) => (
            <div key={key} className="flex items-center gap-3 text-xs">
              <dt><kbd className="font-mono px-1.5 py-0.5 rounded bg-hw-surface-hover text-hw-text-secondary">{key}</kbd></dt>
              <dd className="text-hw-text-secondary">{description}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}

// ─── Review deck ──────────────────────────────────────────────────────────────

const WINDOW = 25          // rows fetched per request
const PREFETCH_AHEAD = 8   // rows looked up before they are reached

function ReviewDeck({
  batch, sheet, onExit, onChanged,
}: {
  batch: ImportBatch
  sheet: ImportSheetSummary
  onExit: () => void
  onChanged: () => void
}) {
  const { toast } = useToastContext()
  const nameRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const [rows, setRows] = useState<ImportRow[]>([])
  const [index, setIndex] = useState(0)
  const [exhausted, setExhausted] = useState(false)
  const [loadingRows, setLoadingRows] = useState(true)

  const [candidates, setCandidates] = useState<Record<string, ImportCandidate[]>>({})
  const [lookingUp, setLookingUp] = useState(false)
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [term, setTerm] = useState('')

  const [busy, setBusy] = useState(false)
  const [undoStack, setUndoStack] = useState<string[]>([])
  const [session, setSession] = useState({ imported: 0, skipped: 0 })
  const [showHelp, setShowHelp] = useState(false)
  const [showFields, setShowFields] = useState(false)

  const row = rows[index]
  const rowCandidates = row ? candidates[row.id] ?? [] : []
  const selectedKey = row ? selected[row.id] : undefined
  const candidate = rowCandidates.find(c => c.key === selectedKey) ?? rowCandidates[0]
  const draft = row ? drafts[row.id] ?? draftFor(row.raw, candidate) : undefined

  // ── Loading rows ───────────────────────────────────────────────────────────

  const loadRows = useCallback(async (afterPosition?: number) => {
    const fetched = await getImportQueue(batch.id, {
      sheet: sheet.sheet, status: 'open', afterPosition, limit: WINDOW,
    })
    setRows(prev => {
      if (afterPosition === undefined) return fetched
      const known = new Set(prev.map(r => r.id))
      return [...prev, ...fetched.filter(r => !known.has(r.id))]
    })
    setExhausted(fetched.length < WINDOW)
    return fetched
  }, [batch.id, sheet.sheet])

  useEffect(() => {
    let cancelled = false
    setLoadingRows(true)
    loadRows()
      .catch(err => !cancelled && toast.error(err instanceof Error ? err.message : 'Could not load the queue'))
      .finally(() => !cancelled && setLoadingRows(false))
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRows])

  // Keep the deck topped up well before running out.
  useEffect(() => {
    if (exhausted || loadingRows || !rows.length) return
    if (index < rows.length - 6) return
    loadRows(rows[rows.length - 1].position).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, rows, exhausted, loadingRows])

  // ── Candidates for the row on screen, and the ones coming up ───────────────

  const fetchCandidates = useCallback(async (target: ImportRow, options: { q?: string; refresh?: boolean } = {}) => {
    setLookingUp(true)
    try {
      const result = await getImportCandidates(target.id, options)
      const items = result.items ?? []
      setCandidates(prev => ({ ...prev, [target.id]: items }))
      setRows(prev => prev.map(r => r.id === target.id ? { ...r, candidate_state: 'ready' } : r))
      return items
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Lookup failed')
      setCandidates(prev => ({ ...prev, [target.id]: prev[target.id] ?? [] }))
      return []
    } finally {
      setLookingUp(false)
    }
  }, [toast])

  useEffect(() => {
    if (!row) return
    setTerm(row.raw.query || row.raw.name)
    setShowFields(false)
    if (candidates[row.id]) return
    if (row.candidates?.items) {
      setCandidates(prev => ({ ...prev, [row.id]: row.candidates?.items ?? [] }))
      return
    }
    fetchCandidates(row).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id])

  useEffect(() => {
    if (!rows.length) return
    const upcoming = rows
      .slice(index + 1, index + 1 + PREFETCH_AHEAD)
      .filter(r => r.candidate_state === 'empty' && !candidates[r.id])
      .map(r => r.id)
    if (upcoming.length) prefetchImportRows(batch.id, upcoming).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, rows])

  // ── Moving through the deck ────────────────────────────────────────────────

  const step = useCallback((delta: number) => {
    setIndex(current => Math.max(0, Math.min(rows.length - 1 + (exhausted ? 1 : 0), current + delta)))
  }, [rows.length, exhausted])

  const patchDraft = (patch: Partial<Draft>) => {
    if (!row || !draft) return
    setDrafts(prev => ({ ...prev, [row.id]: { ...draft, ...patch } }))
  }

  const pick = (key: string) => {
    if (!row) return
    setSelected(prev => ({ ...prev, [row.id]: key }))
    // The card carries the values, so hand edits made against the previous one
    // are dropped rather than silently mixed into a different release.
    setDrafts(prev => {
      const next = { ...prev }
      delete next[row.id]
      return next
    })
  }

  // ── Decisions ──────────────────────────────────────────────────────────────

  const markLocal = (rowId: string, status: ImportRow['status']) =>
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, status } : r))

  const approve = async (options: { manual?: boolean; skipCollection?: boolean } = {}) => {
    if (!row || !draft || busy) return
    const chosen = options.manual ? undefined : candidate
    if (!chosen && !options.manual && rowCandidates.length) return
    const payload = payloadFor(draft, row.raw, chosen)
    if (options.skipCollection) payload.add_to_collection = false
    setBusy(true)
    try {
      await commitImportRow(row.id, payload)
      markLocal(row.id, 'imported')
      setUndoStack(prev => [...prev, row.id])
      setSession(s => ({ ...s, imported: s.imported + 1 }))
      onChanged()
      step(1)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save that one')
    } finally {
      setBusy(false)
    }
  }

  const setStatus = async (status: 'skipped' | 'later') => {
    if (!row || busy) return
    setBusy(true)
    try {
      await setImportRowStatus(row.id, status)
      markLocal(row.id, status)
      if (status === 'skipped') setSession(s => ({ ...s, skipped: s.skipped + 1 }))
      onChanged()
      step(1)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update that row')
    } finally {
      setBusy(false)
    }
  }

  const undoLast = async () => {
    const rowId = undoStack[undoStack.length - 1]
    if (!rowId || busy) return
    setBusy(true)
    try {
      const restored = await undoImportRow(rowId)
      markLocal(rowId, 'pending')
      setUndoStack(prev => prev.slice(0, -1))
      setSession(s => ({ ...s, imported: Math.max(0, s.imported - 1) }))
      onChanged()
      const target = rows.findIndex(r => r.id === rowId)
      if (target >= 0) setIndex(target)
      toast.success(restored.deleted_car ? 'Undone — the car was removed again' : 'Undone')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not undo that')
    } finally {
      setBusy(false)
    }
  }

  const research = async () => {
    if (!row) return
    const items = await fetchCandidates(row, { q: term.trim(), refresh: true })
    if (!items.length) toast.error('Still nothing — try a shorter search term')
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = !!target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)

      if (event.key === 'Escape') {
        if (showHelp) { setShowHelp(false); return }
        if (typing) { (target as HTMLElement).blur(); return }
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault(); approve(); return
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return

      switch (event.key) {
        case 'Enter': event.preventDefault(); approve(); break
        case 's': case 'S': event.preventDefault(); setStatus('skipped'); break
        case 'l': case 'L': event.preventDefault(); setStatus('later'); break
        case 'm': case 'M': event.preventDefault(); approve({ manual: true }); break
        case 'u': case 'U': event.preventDefault(); undoLast(); break
        case 'e': case 'E': event.preventDefault(); setShowFields(true); setTimeout(() => nameRef.current?.focus(), 0); break
        case 'r': case 'R': event.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); break
        case '[': event.preventDefault(); step(-1); break
        case ']': event.preventDefault(); step(1); break
        case '?': setShowHelp(true); break
        case 'ArrowLeft': case 'ArrowRight': {
          if (!rowCandidates.length) return
          event.preventDefault()
          const current = Math.max(0, rowCandidates.findIndex(c => c.key === candidate?.key))
          const next = event.key === 'ArrowLeft'
            ? Math.max(0, current - 1)
            : Math.min(rowCandidates.length - 1, current + 1)
          pick(rowCandidates[next].key)
          break
        }
        default: {
          const digit = Number(event.key)
          if (digit >= 1 && digit <= 9 && rowCandidates[digit - 1]) {
            event.preventDefault()
            pick(rowCandidates[digit - 1].key)
          }
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  const remaining = Math.max(0, (sheet.pending + sheet.later) - session.imported - session.skipped)
  const doneInSheet = sheet.imported + sheet.skipped + sheet.already_done + session.imported + session.skipped

  if (loadingRows) {
    return (
      <div className="p-10 flex flex-col items-center gap-3">
        <Loader2 className="w-6 h-6 text-hw-accent animate-spin" />
        <p className="text-sm text-hw-muted">Opening {sheet.sheet}…</p>
      </div>
    )
  }

  if (!row) {
    return (
      <div className="p-10 flex flex-col items-center gap-3 text-center">
        <CheckCircle2 className="w-10 h-10 text-emerald-500" />
        <h2 className="text-lg font-bold text-hw-text">{sheet.sheet} is done</h2>
        <p className="text-sm text-hw-muted">
          {session.imported} imported and {session.skipped} skipped in this sitting.
        </p>
        <button onClick={onExit} className="btn-primary mt-2">Back to the sheets</button>
      </div>
    )
  }

  const alreadyOwned = candidate?.source === 'collection'

  return (
    <div className="pb-28">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onExit} className="text-hw-muted hover:text-hw-text transition-colors" title="Back to the sheets">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-bold text-hw-text truncate">{sheet.sheet}</h1>
          <p className="text-xs text-hw-muted">
            {remaining.toLocaleString()} to go · {session.imported} imported, {session.skipped} skipped here
          </p>
        </div>
        <button onClick={() => setShowHelp(true)}
                className="p-2 rounded-lg text-hw-muted hover:text-hw-text hover:bg-hw-surface-hover transition-colors"
                title="Keyboard shortcuts">
          <Keyboard className="w-4 h-4" />
        </button>
      </div>
      <Progress value={sheet.total ? (doneInSheet / sheet.total) * 100 : 0} className="mb-5" />

      <div className="grid lg:grid-cols-[320px_1fr] gap-4">
        {/* The row, and what will be saved */}
        <div className="space-y-3">
          <SheetRowPanel row={row} />
          {showFields && draft ? (
            <FieldsPanel draft={draft} onChange={patchDraft} nameRef={nameRef} />
          ) : (
            <button onClick={() => setShowFields(true)}
                    className="btn-secondary w-full justify-center text-xs">
              <Pencil className="w-3.5 h-3.5" /> Edit what gets saved
              <kbd className="font-mono text-[10px] text-hw-muted ml-1">E</kbd>
            </button>
          )}
        </div>

        {/* Matches */}
        <div className="space-y-3 min-w-0">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-hw-muted" />
              <input
                ref={searchRef}
                value={term}
                onChange={e => setTerm(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); research() } }}
                className="input-field py-1.5 pl-8 text-xs"
                placeholder="Search the wiki for something else…"
              />
            </div>
            <button onClick={research} disabled={lookingUp} className="btn-secondary text-xs flex-shrink-0">
              {lookingUp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              Search again
            </button>
          </div>

          {lookingUp && !rowCandidates.length ? (
            <div className="card p-10 flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 text-hw-accent animate-spin" />
              <p className="text-xs text-hw-muted">Looking up “{row.raw.query || row.raw.name}”…</p>
            </div>
          ) : candidate ? (
            <>
              <CandidateHero candidate={candidate} />
              {rowCandidates.length > 1 && (
                <div>
                  <p className="text-[11px] text-hw-muted mb-1.5">
                    {rowCandidates.length - 1} other {rowCandidates.length === 2 ? 'option' : 'options'} — press a number or use ← →
                  </p>
                  <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                    {rowCandidates.map((option, position) => (
                      <CandidateThumb
                        key={option.key}
                        candidate={option}
                        index={position}
                        selected={option.key === candidate.key}
                        onSelect={() => pick(option.key)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="card p-8 flex flex-col items-center gap-3 text-center">
              <Search className="w-8 h-8 text-hw-muted/40" />
              <div>
                <p className="text-sm font-semibold text-hw-text">No match found</p>
                <p className="text-xs text-hw-muted mt-1 max-w-sm">
                  {row.raw.other_brand
                    ? `The sheet says this is ${row.raw.other_brand}, so the wiki won't have it.`
                    : 'Try a shorter search term above, add it straight from the sheet, or skip it.'}
                </p>
              </div>
              <button onClick={() => approve({ manual: true })} disabled={busy} className="btn-primary text-xs">
                <Sparkles className="w-3.5 h-3.5" /> Add from the sheet
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="fixed bottom-0 left-0 right-0 md:left-60 bg-hw-surface border-t border-hw-border px-4 py-3 z-40">
        <div className="max-w-6xl mx-auto flex items-center gap-2 flex-wrap">
          <button onClick={() => step(-1)} disabled={index === 0}
                  className="btn-ghost text-xs disabled:opacity-30" title="Previous row ( [ )">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button onClick={() => step(1)} className="btn-ghost text-xs" title="Next row ( ] )">
            <ArrowRight className="w-4 h-4" />
          </button>

          <span className="text-[11px] text-hw-muted tabular-nums ml-1 mr-auto">
            row {row.raw.row_index}
          </span>

          {!!undoStack.length && (
            <button onClick={undoLast} disabled={busy} className="btn-ghost text-xs" title="Undo the last approval (U)">
              <RotateCcw className="w-3.5 h-3.5" /> Undo
            </button>
          )}
          <button onClick={() => setStatus('later')} disabled={busy} className="btn-ghost text-xs" title="Park for later (L)">
            <Clock className="w-3.5 h-3.5" /> Later
          </button>
          <button onClick={() => setStatus('skipped')} disabled={busy} className="btn-secondary text-xs" title="Skip (S)">
            <SkipForward className="w-3.5 h-3.5" /> Skip
          </button>
          {candidate && (
            <button onClick={() => approve({ manual: true })} disabled={busy} className="btn-secondary text-xs hidden sm:inline-flex"
                    title="Ignore the match and use the sheet's own values (M)">
              <Sparkles className="w-3.5 h-3.5" /> From sheet
            </button>
          )}
          {alreadyOwned ? (
            <>
              <button onClick={() => approve({ skipCollection: true })} disabled={busy} className="btn-secondary text-xs">
                <Check className="w-4 h-4" /> Already have it
              </button>
              <button onClick={() => approve()} disabled={busy} className="btn-primary text-xs">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Own another
              </button>
            </>
          ) : (
            <button onClick={() => approve()} disabled={busy || !candidate} className="btn-primary disabled:opacity-40">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Approve
              <kbd className="font-mono text-[10px] opacity-70">↵</kbd>
            </button>
          )}
        </div>
      </div>

      {showHelp && <ShortcutsOverlay onClose={() => setShowHelp(false)} />}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function SheetImportPage() {
  const navigate = useNavigate()
  const { toast } = useToastContext()
  const [batches, setBatches] = useState<ImportBatch[]>([])
  const [batch, setBatch] = useState<ImportBatch | null>(null)
  const [sheetName, setSheetName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshList = useCallback(async () => {
    try {
      setBatches(await getImportBatches())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load imports')
    }
  }, [toast])

  useEffect(() => {
    refreshList().finally(() => setLoading(false))
  }, [refreshList])

  const openBatch = async (id: string) => {
    try {
      setBatch(await getImportBatch(id))
      setSheetName(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open that import')
    }
  }

  const refreshBatch = useCallback(async () => {
    if (!batch) return
    try {
      setBatch(await getImportBatch(batch.id))
    } catch { /* a stale count is not worth an error toast */ }
  }, [batch])

  const removeBatch = async (id: string) => {
    if (!window.confirm('Forget this import? Cars already imported stay in your collection.')) return
    try {
      await deleteImportBatch(id)
      setBatch(null)
      await refreshList()
      toast.success('Import forgotten')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete that')
    }
  }

  const changeCarded = async (sheet: string, carded: boolean) => {
    if (!batch) return
    try {
      setBatch(await setImportSheetCarded(batch.id, sheet, carded))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the sheet')
    }
  }

  const sheets = useMemo(() => batch?.sheets ?? [], [batch])
  const activeSheet = sheets.find(s => s.sheet === sheetName) ?? null

  if (loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 text-hw-accent animate-spin" /></div>
  }

  // Reviewing one sheet.
  if (batch && activeSheet) {
    return (
      <div className="p-4 md:p-6 max-w-6xl mx-auto">
        <ReviewDeck
          batch={batch}
          sheet={activeSheet}
          onExit={() => { setSheetName(null); refreshBatch() }}
          onChanged={refreshBatch}
        />
      </div>
    )
  }

  // One import, its sheets and their progress.
  if (batch) {
    const totals = batch.totals
    const decided = (totals?.imported ?? 0) + (totals?.skipped ?? 0) + (totals?.already_done ?? 0)
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-5">
          <button onClick={() => { setBatch(null); refreshList() }}
                  className="text-hw-muted hover:text-hw-text transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-hw-text truncate">{batch.source_name}</h1>
            <p className="text-sm text-hw-text-secondary">
              {decided.toLocaleString()} of {(totals?.total ?? 0).toLocaleString()} rows dealt with
            </p>
          </div>
          <button onClick={() => removeBatch(batch.id)}
                  className="p-2 rounded-lg text-hw-muted hover:text-red-500 hover:bg-red-500/10 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          {sheets.map(sheet => (
            <SheetCard
              key={sheet.sheet}
              sheet={sheet}
              onStart={() => setSheetName(sheet.sheet)}
              onCardedChange={carded => changeCarded(sheet.sheet, carded)}
            />
          ))}
        </div>

        <p className="text-xs text-hw-muted mt-5">
          Every approval is saved as you go, so you can stop whenever and pick this up later.
        </p>
      </div>
    )
  }

  // Nothing open: upload a sheet, or continue one.
  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-5">
        <button onClick={() => navigate('/collection')} className="text-hw-muted hover:text-hw-text transition-colors">
          <X className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-hw-text">Import a sheet</h1>
          <p className="text-hw-text-secondary text-sm mt-0.5">
            Your spreadsheet, one car at a time — approve the match or pick another, and keep going.
          </p>
        </div>
      </div>

      <UploadPanel onUploaded={created => { setBatch(created); refreshList() }} />

      {!!batches.length && (
        <div className="mt-6">
          <p className="label mb-2">Carry on with</p>
          <div className="space-y-2">
            {batches.map(item => (
              <BatchRow
                key={item.id}
                batch={item}
                onOpen={() => openBatch(item.id)}
                onDelete={() => removeBatch(item.id)}
              />
            ))}
          </div>
        </div>
      )}

      <div className="card p-4 mt-6">
        <p className="text-xs font-semibold text-hw-text mb-2 flex items-center gap-1.5">
          <ChevronDown className="w-3.5 h-3.5" /> How it goes
        </p>
        <ol className="text-xs text-hw-text-secondary space-y-1.5 list-decimal list-inside">
          <li>Every sheet in the file becomes its own queue, in the sheet's own order.</li>
          <li>Green rows are counted as already imported and stay out of the queue.</li>
          <li>For each remaining row you get the best match found, with alternatives beside it.</li>
          <li>Approve with Enter, pick another with a number key, skip with S. The next rows are looked up while you decide.</li>
        </ol>
      </div>
    </div>
  )
}
