import React, { useState, useEffect, useRef } from 'react'
import { X, Camera, Save, Loader2, Flame, ImageIcon, Search, Plus, Check, Edit, Minus, Trash2 } from 'lucide-react'
import {
  updateCar, getAllSeries, uploadCarImage,
  updateCollectionEntry, createSeries, removeFromCollection,
} from '../lib/api'
import { InfoTooltip } from './InfoTooltip'
import { SeriesEditModal } from './SeriesEditModal'
import { useToastContext } from '../contexts/ToastContext'
import type { Car, Series, CollectionEntry } from '../types'

interface CarDetailModalProps {
  isOpen: boolean
  onClose: () => void
  car: Car | null
  collectionEntry?: CollectionEntry
  onSuccess?: (car: Car) => void
  onCollectionUpdate?: (entry: CollectionEntry) => void
  onDelete?: (carId: string) => void
}

// ── Inline Series Picker ───────────────────────────────────────────────────────

function SeriesPickerOverlay({
  series,
  selectedId,
  onSelect,
  onClose,
  onEditSeries,
  onCreateNew,
}: {
  series: Series[]
  selectedId: string
  onSelect: (s: Series) => void
  onClose: () => void
  onEditSeries: (s: Series) => void
  onCreateNew: (name: string, type: string, totalCount?: number, year?: number) => void
}) {
  const [search, setSearch] = useState('')
  const [pendingCreate, setPendingCreate] = useState<{ name: string; type: string } | null>(null)
  const [totalCount, setTotalCount] = useState('')
  const [seriesYear, setSeriesYear] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50) }, [])

  const filtered = search.trim()
    ? series.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
    : series

  const premiumSeries = filtered.filter(s => s.type === 'premium')
  const collectorSeries = filtered.filter(s => s.type === 'collector')
  const mainlineSeries = filtered.filter(s => s.type !== 'premium' && s.type !== 'collector')
  const hasExactMatch = filtered.some(s => s.name.toLowerCase() === search.trim().toLowerCase())

  const TypedSeriesGroup = ({ label, items, color }: { label: string; items: Series[]; color: string }) => (
    items.length > 0 ? (
      <div className="mb-3">
        <p className={`text-[10px] font-bold uppercase tracking-wider mb-1.5 px-1 ${color}`}>{label}</p>
        {items.map(s => (
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
              <span className="text-sm text-hw-text truncate">{s.name}{s.year ? ` (${s.year})` : ''}</span>
              {selectedId === s.id && <Check className="w-4 h-4 text-hw-accent flex-shrink-0" />}
            </button>
            <button
              type="button"
              onClick={() => onEditSeries(s)}
              className="p-1.5 rounded hover:bg-hw-surface-hover text-hw-muted/50 hover:text-hw-text transition-colors flex-shrink-0"
              title="Edit series"
            >
              <Edit className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    ) : null
  )

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-hw-surface border border-hw-border rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-hw-border flex-shrink-0">
          <h3 className="text-sm font-semibold text-hw-text">Select Series</h3>
          <button type="button" onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-hw-surface-hover flex items-center justify-center text-hw-muted">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-3 py-2.5 border-b border-hw-border flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-hw-muted pointer-events-none" />
            <input
              ref={inputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input-field pl-8 py-1.5 text-sm"
              placeholder="Search or create series…"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {/* No series option */}
          <button
            type="button"
            onClick={() => { onSelect({ id: '', name: '', type: 'mainline', created_at: '' }); onClose() }}
            className={`w-full flex items-center px-3 py-2 rounded-lg transition-colors text-left mb-2 ${
              !selectedId ? 'bg-hw-accent/10 border border-hw-accent/30' : 'hover:bg-hw-surface-hover border border-transparent'
            }`}
          >
            <span className="text-sm text-hw-muted italic">— No series —</span>
          </button>

          {/* Create new — step 1: pick type */}
          {search.trim() && !hasExactMatch && !pendingCreate && (
            <div className="mb-3 space-y-1.5">
              {[
                { type: 'mainline', label: 'Mainline series', cls: 'border-hw-border/50 hover:border-hw-accent/50', textCls: 'text-hw-text', subCls: 'text-hw-muted' },
                { type: 'premium', label: 'Premium series', cls: 'border-amber-600/30 bg-amber-950/20 hover:border-amber-500/50', textCls: 'text-amber-200', subCls: 'text-amber-400/70' },
                { type: 'collector', label: 'Collector series (RLC)', cls: 'border-purple-600/30 bg-purple-950/20 hover:border-purple-500/50', textCls: 'text-purple-200', subCls: 'text-purple-400/70' },
              ].map(({ type, label, cls, textCls, subCls }) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => { setPendingCreate({ name: search.trim(), type }); setTotalCount(''); setSeriesYear('') }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-dashed transition-colors text-left ${cls}`}
                >
                  <Plus className="w-4 h-4 text-hw-muted flex-shrink-0" />
                  <div>
                    <p className={`text-sm font-medium ${textCls}`}>Create "{search.trim()}"</p>
                    <p className={`text-xs ${subCls}`}>{label}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Create new — step 2: details */}
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
                <button
                  type="button"
                  onClick={() => setPendingCreate(null)}
                  className="btn-secondary flex-1 justify-center text-sm py-1.5"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onCreateNew(pendingCreate.name, pendingCreate.type, totalCount ? parseInt(totalCount) : undefined, seriesYear ? parseInt(seriesYear) : undefined)
                    setPendingCreate(null)
                  }}
                  className="btn-primary flex-1 justify-center text-sm py-1.5"
                >
                  Create Series
                </button>
              </div>
            </div>
          )}

          <TypedSeriesGroup label="Premium" items={premiumSeries} color="text-amber-400" />
          <TypedSeriesGroup label="Collector" items={collectorSeries} color="text-purple-400" />
          <TypedSeriesGroup label="Mainline" items={mainlineSeries} color="text-hw-muted" />

          {filtered.length === 0 && !search.trim() && (
            <p className="text-sm text-hw-muted text-center py-8">No series yet</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function CarDetailModal({ isOpen, onClose, car, collectionEntry, onSuccess, onCollectionUpdate, onDelete }: CarDetailModalProps) {
  const { toast } = useToastContext()
  const [allSeries, setAllSeries] = useState<Series[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [imgError, setImgError] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    name: '',
    year: '',
    series_id: '',
    primary_color: '',
    series_number: '',
    set_number: '',
    toy_number: '',
    barcode: '',
    th_type: 'none' as 'none' | 'th' | 'sth',
  })

  const [colForm, setColForm] = useState({
    carded_qty: 1,
    loose_qty: 0,
    condition: 'mint',
    notes: '',
    date_acquired: '',
  })

  const [imageUrl, setImageUrl] = useState<string | undefined>()

  // Series picker state
  const [showSeriesPicker, setShowSeriesPicker] = useState(false)
  const [editingSeries, setEditingSeries] = useState<Series | null>(null)
  const [showSeriesEditModal, setShowSeriesEditModal] = useState(false)

  useEffect(() => {
    if (!isOpen || !car) return
    setForm({
      name: car.name,
      year: car.year ? String(car.year) : '',
      series_id: car.series_id || '',
      primary_color: car.primary_color || '',
      series_number: car.series_number ? String(car.series_number) : '',
      set_number: car.set_number ? String(car.set_number) : '',
      toy_number: car.toy_number || '',
      barcode: car.barcode || '',
      th_type: car.car_type === 'super treasure hunt' ? 'sth' : car.treasure_hunt ? 'th' : 'none',
    })
    setColForm({
      carded_qty: collectionEntry?.carded ? (collectionEntry.amount_owned ?? 1) : 0,
      loose_qty: collectionEntry?.carded ? 0 : (collectionEntry?.amount_owned ?? 0),
      condition: collectionEntry?.condition ?? 'mint',
      notes: collectionEntry?.notes ?? '',
      date_acquired: collectionEntry?.date_acquired ?? '',
    })
    setImageUrl(car.image_url)
    setImgError(false)
    getAllSeries().then(setAllSeries).catch(() => {})
  }, [isOpen, car, collectionEntry])

  useEffect(() => {
    if (!isOpen) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [isOpen, onClose])

  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  const selectedSeries = allSeries.find(s => s.id === form.series_id)
  const seriesType = selectedSeries?.type || 'mainline'
  const isMainline = seriesType !== 'premium' && seriesType !== 'collector'
  const isTH = form.th_type !== 'none'

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target
    setForm(prev => {
      const update: Partial<typeof prev> = { [name]: value }
      if (name === 'series_id') {
        const picked = allSeries.find(s => s.id === value)
        if (picked?.type === 'premium' || picked?.type === 'collector') update.th_type = 'none'
      }
      return { ...prev, ...update }
    })
  }

  const handleSeriesSelect = (s: Series) => {
    setForm(prev => {
      const update: Partial<typeof prev> = { series_id: s.id }
      if (s.type === 'premium' || s.type === 'collector') update.th_type = 'none'
      return { ...prev, ...update }
    })
  }

  const handleSeriesCreate = async (name: string, type: string, totalCount?: number, year?: number) => {
    try {
      const ns = await createSeries({ name, type, total_count: totalCount, year })
      setAllSeries(prev => [...prev, ns])
      handleSeriesSelect(ns)
      setShowSeriesPicker(false)
      toast.success(`Series "${name}" created`)
    } catch {
      toast.error('Failed to create series')
    }
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !car) return
    setUploading(true)
    try {
      const { image_url } = await uploadCarImage(car.id, file)
      setImageUrl(image_url)
      setImgError(false)
      toast.success('Photo updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const handleDelete = async () => {
    if (!car || !collectionEntry) return
    if (!confirmDelete) { setConfirmDelete(true); return }
    setDeleting(true)
    try {
      await removeFromCollection(collectionEntry.id)
      toast.success(`"${car.name}" removed from collection`)
      onDelete?.(car.id)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove')
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!car) return
    if (!form.name.trim()) { toast.error('Name is required'); return }

    const car_type =
      form.th_type === 'sth' ? 'super treasure hunt' :
      form.th_type === 'th' ? 'treasure hunt' :
      seriesType

    setSubmitting(true)
    try {
      const updated = await updateCar(car.id, {
        name: form.name.trim(),
        year: form.year ? parseInt(form.year) : undefined,
        series_id: form.series_id || undefined,
        primary_color: form.primary_color || undefined,
        series_number: form.series_number ? parseInt(form.series_number) : undefined,
        set_number: form.set_number ? parseInt(form.set_number) : undefined,
        toy_number: form.toy_number.trim() || undefined,
        barcode: form.barcode || undefined,
        car_type,
        treasure_hunt: form.th_type !== 'none',
      })

      if (collectionEntry) {
        try {
          const total = colForm.carded_qty + colForm.loose_qty
          const updatedCol = await updateCollectionEntry(collectionEntry.id, {
            amount_owned: total || 1,
            carded: colForm.carded_qty > 0,
            condition: colForm.condition,
            notes: colForm.notes || undefined,
            date_acquired: colForm.date_acquired || undefined,
          })
          onCollectionUpdate?.(updatedCol)
        } catch {
          toast.error('Car saved but collection details failed to update')
        }
      }

      toast.success('Saved!')
      onSuccess?.(updated)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen || !car) return null

  const seriesBadgeColor =
    seriesType === 'premium' ? 'text-amber-300 border-amber-700/30 bg-amber-900/50' :
    seriesType === 'collector' ? 'text-purple-300 border-purple-700/30 bg-purple-900/50' :
    'text-zinc-400 border-zinc-600/30 bg-zinc-800'

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

        {/* Panel */}
        <div className="
          relative z-10 w-full md:max-w-2xl
          h-[90dvh] md:h-auto md:max-h-[88vh]
          rounded-t-3xl md:rounded-2xl
          overflow-hidden
          flex flex-col md:flex-row
          bg-hw-surface border border-hw-border
          shadow-[0_-8px_60px_rgba(0,0,0,0.7)]
          md:mx-4
        ">
          {/* ── Left: Photo panel ─────────────────────────────────────────── */}
          <div className="relative flex-shrink-0 w-full md:w-[40%] h-44 md:h-auto bg-zinc-950 group/photo overflow-hidden">
            <div
              className="absolute inset-0 opacity-[0.06]"
              style={{
                backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)',
                backgroundSize: '20px 20px',
              }}
            />

            {imageUrl && !imgError ? (
              <img
                src={imageUrl}
                alt={car.name}
                className="relative z-10 w-full h-full object-contain"
                onError={() => setImgError(true)}
              />
            ) : (
              <div className="relative z-10 w-full h-full flex items-center justify-center">
                <ImageIcon className="w-14 h-14 text-zinc-700" />
              </div>
            )}

            <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/20 to-transparent pointer-events-none z-20" />

            <div className="absolute bottom-0 left-0 right-0 p-4 z-30 pointer-events-none select-none">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className={`text-[9px] uppercase tracking-[0.18em] font-bold px-1.5 py-0.5 rounded border ${seriesBadgeColor}`}>
                  {seriesType}
                </span>
                {isTH && (
                  <span className={`
                    text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border
                    ${form.th_type === 'sth'
                      ? 'bg-yellow-400/15 text-yellow-300 border-yellow-500/40'
                      : 'bg-orange-400/15 text-orange-300 border-orange-500/40'}
                  `}>
                    {form.th_type === 'sth' ? 'Super TH' : 'TH'}
                  </span>
                )}
                {car.toy_number && (
                  <span className="text-[9px] font-mono text-white/30 ml-auto">{car.toy_number}</span>
                )}
              </div>
              <h2 className="text-lg font-black text-white leading-tight tracking-tight">
                {car.name}
              </h2>
              {form.year && (
                <p className="text-xs text-white/40 mt-0.5 font-mono tracking-wider">{form.year}</p>
              )}
              {collectionEntry && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-300 border border-emerald-700/40 uppercase tracking-wide">
                    In Collection
                  </span>
                  {(colForm.carded_qty + colForm.loose_qty) > 1 && (
                    <span className="text-[9px] text-white/50 font-mono">×{colForm.carded_qty + colForm.loose_qty}</span>
                  )}
                </div>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleImageUpload}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="
                absolute inset-0 z-40 flex flex-col items-center justify-center gap-2
                bg-black/0 hover:bg-black/55 transition-all duration-200
                opacity-0 hover:opacity-100
              "
            >
              {uploading ? (
                <Loader2 className="w-7 h-7 text-white animate-spin" />
              ) : (
                <>
                  <div className="w-10 h-10 rounded-full bg-white/10 border border-white/20 flex items-center justify-center backdrop-blur-sm">
                    <Camera className="w-5 h-5 text-white" />
                  </div>
                  <span className="text-[11px] font-semibold text-white/80 uppercase tracking-wider">
                    {imageUrl ? 'Change photo' : 'Upload photo'}
                  </span>
                </>
              )}
            </button>

            <button
              onClick={onClose}
              className="
                absolute top-3 right-3 z-50
                w-8 h-8 rounded-full
                bg-black/40 border border-white/10 backdrop-blur-sm
                flex items-center justify-center
                text-white/60 hover:text-white hover:bg-black/60
                transition-all
              "
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* ── Right: Form panel ─────────────────────────────────────────── */}
          <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="flex-1 overflow-y-auto px-4 md:px-5 py-4 space-y-4">

              {/* ── Identity ── */}
              <section className="space-y-3">
                <p className="text-[10px] uppercase tracking-[0.15em] font-semibold text-hw-muted/50 flex items-center gap-2">
                  <span className="flex-1 border-b border-hw-border" />
                  Identity
                  <span className="flex-1 border-b border-hw-border" />
                </p>

                <div>
                  <label className="label text-[11px]">Model Name</label>
                  <input
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    className="input-field"
                    placeholder="e.g. '69 Dodge Charger Daytona"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label text-[11px]">Year</label>
                    <input
                      name="year"
                      value={form.year}
                      onChange={handleChange}
                      className="input-field"
                      type="number"
                      placeholder="2024"
                      min="1968"
                      max={new Date().getFullYear() + 2}
                    />
                  </div>
                  <div>
                    <label className="label text-[11px]">Primary Color</label>
                    <input
                      name="primary_color"
                      value={form.primary_color}
                      onChange={handleChange}
                      className="input-field"
                      placeholder="Red, Blue…"
                    />
                  </div>
                </div>
              </section>

              {/* ── Catalog ── */}
              <section className="space-y-3">
                <p className="text-[10px] uppercase tracking-[0.15em] font-semibold text-hw-muted/50 flex items-center gap-2">
                  <span className="flex-1 border-b border-hw-border" />
                  Catalog
                  <span className="flex-1 border-b border-hw-border" />
                </p>

                {/* Series - searchable picker button */}
                <div>
                  <label className="label text-[11px]">Series</label>
                  <button
                    type="button"
                    onClick={() => setShowSeriesPicker(true)}
                    className="input-field w-full text-left flex items-center justify-between gap-2 cursor-pointer hover:border-hw-accent/50 transition-colors"
                  >
                    <span className={selectedSeries ? 'text-hw-text' : 'text-hw-muted/50'}>
                      {selectedSeries ? selectedSeries.name + (selectedSeries.year ? ` (${selectedSeries.year})` : '') : '— No series —'}
                    </span>
                    {selectedSeries && (
                      <span className={`flex-shrink-0 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${seriesBadgeColor}`}>
                        {seriesType}
                      </span>
                    )}
                  </button>
                  {selectedSeries?.total_count && (
                    <p className="text-[10px] text-hw-muted mt-1">{selectedSeries.total_count} cars in series</p>
                  )}
                </div>

                {/* Positions */}
                <div className={`grid gap-3 ${isMainline ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  <div>
                    <label className="label text-[11px] flex items-center gap-1">
                      Series position
                      <InfoTooltip text="Position within the series, e.g. 3 for '3/10'" />
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        name="series_number"
                        value={form.series_number}
                        onChange={handleChange}
                        className="input-field"
                        type="number"
                        placeholder="e.g. 3"
                        min="1"
                      />
                      {selectedSeries?.total_count && (
                        <span className="text-sm text-hw-muted flex-shrink-0 font-mono">/ {selectedSeries.total_count}</span>
                      )}
                    </div>
                  </div>
                  {isMainline && (
                    <div>
                      <label className="label text-[11px] flex items-center gap-1">
                        Mainline #
                        <InfoTooltip text="Position in the year's mainline lineup, e.g. 127 for #127/250" />
                      </label>
                      <input
                        name="set_number"
                        value={form.set_number}
                        onChange={handleChange}
                        className="input-field"
                        type="number"
                        placeholder="e.g. 127"
                        min="1"
                      />
                    </div>
                  )}
                </div>

                {/* Toy number + Barcode */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label text-[11px] flex items-center gap-1">
                      Toy Number
                      <InfoTooltip text="5-char code on card packaging, e.g. DHP27" />
                    </label>
                    <input
                      name="toy_number"
                      value={form.toy_number}
                      onChange={e => setForm(p => ({ ...p, toy_number: e.target.value.toUpperCase() }))}
                      className="input-field font-mono uppercase"
                      placeholder="DHP27"
                      maxLength={10}
                    />
                  </div>
                  <div>
                    <label className="label text-[11px]">Barcode (UPC)</label>
                    <input
                      name="barcode"
                      value={form.barcode}
                      onChange={handleChange}
                      className="input-field"
                      placeholder="0123456789"
                    />
                  </div>
                </div>
              </section>

              {/* ── Treasure Hunt ── */}
              {seriesType !== 'premium' && seriesType !== 'collector' && (
                <div className={`rounded-xl border p-3.5 transition-all ${isTH ? 'border-yellow-600/40 bg-yellow-950/20' : 'border-hw-border bg-hw-bg'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Flame className={`w-4 h-4 transition-colors ${isTH ? 'text-yellow-400' : 'text-hw-muted/60'}`} />
                      <span className="text-sm font-medium text-hw-text">Treasure Hunt</span>
                      {isTH && (
                        <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-yellow-900/50 text-yellow-300 border border-yellow-600/40 uppercase tracking-wide">
                          {form.th_type === 'sth' ? 'Super TH' : 'TH'}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setForm(p => ({ ...p, th_type: p.th_type === 'none' ? 'th' : 'none' }))}
                      className={`relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${isTH ? 'bg-yellow-600' : 'bg-hw-border'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${isTH ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                  {isTH && (
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

              {/* ── Collection Entry ── */}
              {collectionEntry && (
                <section className="space-y-3">
                  <p className="text-[10px] uppercase tracking-[0.15em] font-semibold text-hw-muted/50 flex items-center gap-2">
                    <span className="flex-1 border-b border-hw-border" />
                    My Copy
                    <span className="flex-1 border-b border-hw-border" />
                  </p>

                  {/* Carded + Loose counters */}
                  <div className="grid grid-cols-2 gap-2">
                    {(['carded_qty', 'loose_qty'] as const).map(field => {
                      const label = field === 'carded_qty' ? 'Carded' : 'Loose'
                      const qty = colForm[field]
                      return (
                        <div
                          key={field}
                          className={`rounded-xl border p-3 transition-all ${qty > 0 ? 'border-hw-accent/40 bg-hw-accent/5' : 'border-hw-border bg-hw-bg'}`}
                        >
                          <p className="text-xs text-hw-muted mb-2">{label}</p>
                          <div className="flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => setColForm(p => ({ ...p, [field]: Math.max(0, p[field] - 1) }))}
                              className="w-7 h-7 rounded-lg border border-hw-border text-hw-muted hover:text-hw-text hover:border-hw-muted flex items-center justify-center transition-colors"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className={`font-mono text-base font-bold w-8 text-center ${qty > 0 ? 'text-hw-text' : 'text-hw-muted/40'}`}>{qty}</span>
                            <button
                              type="button"
                              onClick={() => setColForm(p => ({ ...p, [field]: p[field] + 1 }))}
                              className="w-7 h-7 rounded-lg border border-hw-border text-hw-muted hover:text-hw-text hover:border-hw-muted flex items-center justify-center transition-colors"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Condition pills */}
                  <div>
                    <label className="label text-[11px]">Condition</label>
                    <div className="flex gap-1.5">
                      {(['mint', 'good', 'fair', 'poor'] as const).map(c => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setColForm(p => ({ ...p, condition: c }))}
                          className={`flex-1 py-1.5 rounded-lg border text-xs font-medium capitalize transition-all ${
                            colForm.condition === c
                              ? c === 'mint' ? 'bg-emerald-900/50 text-emerald-200 border-emerald-600/50'
                              : c === 'good' ? 'bg-blue-900/50 text-blue-200 border-blue-600/50'
                              : c === 'fair' ? 'bg-amber-900/50 text-amber-200 border-amber-600/50'
                              : 'bg-red-900/50 text-red-200 border-red-600/50'
                              : 'border-hw-border text-hw-muted hover:border-hw-muted/50'
                          }`}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Notes + Date in a grid */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label text-[11px]">Date Acquired</label>
                      <input
                        type="date"
                        value={colForm.date_acquired}
                        onChange={e => setColForm(p => ({ ...p, date_acquired: e.target.value }))}
                        className="input-field py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="label text-[11px]">Notes</label>
                      <input
                        type="text"
                        value={colForm.notes}
                        onChange={e => setColForm(p => ({ ...p, notes: e.target.value }))}
                        className="input-field py-1.5 text-sm"
                        placeholder="Any notes…"
                      />
                    </div>
                  </div>
                </section>
              )}
            </div>

            {/* ── Sticky save bar ── */}
            <div className="flex-shrink-0 border-t border-hw-border px-4 md:px-5 py-3 bg-hw-surface flex gap-2">
              {collectionEntry && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  title="Remove from collection"
                  className={`flex-shrink-0 px-3 py-2 rounded-lg border text-sm font-medium flex items-center gap-1.5 transition-all ${
                    confirmDelete
                      ? 'border-red-500/60 bg-red-900/30 text-red-300 hover:bg-red-900/50'
                      : 'border-hw-border text-hw-muted hover:border-red-500/40 hover:text-red-400'
                  }`}
                >
                  {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  {confirmDelete ? 'Confirm?' : ''}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="btn-secondary px-4 flex-shrink-0"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="btn-primary flex-1 justify-center"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {submitting ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Series Picker Overlay */}
      {showSeriesPicker && (
        <SeriesPickerOverlay
          series={allSeries}
          selectedId={form.series_id}
          onSelect={handleSeriesSelect}
          onClose={() => setShowSeriesPicker(false)}
          onEditSeries={(s) => { setEditingSeries(s); setShowSeriesPicker(false); setShowSeriesEditModal(true) }}
          onCreateNew={handleSeriesCreate}
        />
      )}

      {/* Series Edit Modal */}
      <SeriesEditModal
        isOpen={showSeriesEditModal}
        onClose={() => { setShowSeriesEditModal(false); setShowSeriesPicker(true) }}
        series={editingSeries}
        onSuccess={(updated) => {
          setAllSeries(prev => prev.map(s => s.id === updated.id ? updated : s))
          if (form.series_id === updated.id && (updated.type === 'premium' || updated.type === 'collector')) {
            setForm(p => ({ ...p, th_type: 'none' }))
          }
          setShowSeriesEditModal(false)
          setShowSeriesPicker(true)
        }}
        onDelete={(id) => {
          setAllSeries(prev => prev.filter(s => s.id !== id))
          if (form.series_id === id) setForm(p => ({ ...p, series_id: '' }))
          setShowSeriesEditModal(false)
          setShowSeriesPicker(true)
        }}
      />
    </>
  )
}
