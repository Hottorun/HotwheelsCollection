import React, { useState, useEffect, useRef } from 'react'
import { CheckCircle2, Minus, Plus, Camera, Trash2 } from 'lucide-react'
import { Modal } from './Modal'
import { addToCollection, updateCollectionEntry, removeFromCollection, uploadCarImage } from '../lib/api'
import { useToastContext } from '../contexts/ToastContext'
import type { Car, CollectionEntry } from '../types'

interface AddToCollectionModalProps {
  isOpen: boolean
  onClose: () => void
  car: Car | null
  existingEntry?: CollectionEntry
  onSuccess?: (entry: CollectionEntry) => void
  onDeleted?: (entryId: string) => void
  onImageUploaded?: (carId: string, imageUrl: string) => void
  onEditCarDetails?: () => void
}

const CONDITIONS = [
  { value: 'mint', label: 'Mint', description: 'Perfect condition, unopened' },
  { value: 'good', label: 'Good', description: 'Minor wear, complete' },
  { value: 'fair', label: 'Fair', description: 'Visible wear, functional' },
  { value: 'poor', label: 'Poor', description: 'Heavy wear or damage' },
]

const conditionColors = {
  mint: 'border-emerald-500 bg-emerald-500/10 text-emerald-400',
  good: 'border-blue-500 bg-blue-500/10 text-blue-400',
  fair: 'border-yellow-500 bg-yellow-500/10 text-yellow-400',
  poor: 'border-red-500 bg-red-500/10 text-red-400',
}

export function AddToCollectionModal({
  isOpen,
  onClose,
  car,
  existingEntry,
  onSuccess,
  onDeleted,
  onImageUploaded,
  onEditCarDetails,
}: AddToCollectionModalProps) {
  const { toast } = useToastContext()
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined)
  const [imgError, setImgError] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const defaultForm = {
    carded_qty: 1,
    loose_qty: 0,
    condition: 'mint',
    notes: '',
    date_acquired: new Date().toISOString().split('T')[0],
  }

  const [form, setForm] = useState(defaultForm)

  useEffect(() => {
    if (existingEntry) {
      setForm({
        carded_qty: existingEntry.carded ? existingEntry.amount_owned : 0,
        loose_qty: existingEntry.carded ? 0 : existingEntry.amount_owned,
        condition: existingEntry.condition,
        notes: existingEntry.notes ?? '',
        date_acquired: existingEntry.date_acquired
          ? existingEntry.date_acquired.split('T')[0]
          : new Date().toISOString().split('T')[0],
      })
    } else {
      setForm(defaultForm)
    }
    setImageUrl(car?.image_url)
    setImgError(false)
  }, [existingEntry, car?.image_url, isOpen])

  const isCarded = form.carded_qty > 0
  useEffect(() => {
    if (!isCarded && form.condition === 'mint') {
      setForm(prev => ({ ...prev, condition: 'good' }))
    }
  }, [isCarded])

  const handleClose = () => {
    setForm(defaultForm)
    onClose()
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !car) return
    setUploading(true)
    try {
      const { image_url } = await uploadCarImage(car.id, file)
      setImageUrl(image_url)
      setImgError(false)
      onImageUploaded?.(car.id, image_url)
      toast.success('Image updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to upload image')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const handleDelete = async () => {
    if (!existingEntry || !car) return
    setDeleting(true)
    try {
      await removeFromCollection(existingEntry.id)
      toast.success(`"${car.name}" removed from collection`)
      onDeleted?.(existingEntry.id)
      handleClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove')
    } finally {
      setDeleting(false)
    }
  }

  const adjustQty = (field: 'carded_qty' | 'loose_qty', delta: number) => {
    setForm(prev => ({
      ...prev,
      [field]: Math.max(0, prev[field] + delta),
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!car) return

    const totalOwned = form.carded_qty + form.loose_qty
    if (totalOwned === 0) {
      toast.error('Enter at least 1 carded or loose copy')
      return
    }

    setSubmitting(true)
    const payload = {
      amount_owned: totalOwned,
      carded: form.carded_qty > 0,
      condition: form.condition,
      notes: form.notes || undefined,
      date_acquired: form.date_acquired || undefined,
    }
    try {
      let entry: CollectionEntry
      if (existingEntry) {
        entry = await updateCollectionEntry(existingEntry.id, payload)
        toast.success(`Updated "${car.name}" in collection!`)
      } else {
        entry = await addToCollection({ allcars_id: car.id, ...payload })
        toast.success(`"${car.name}" added to collection!`)
      }
      onSuccess?.(entry)
      handleClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={existingEntry ? 'Edit Collection Entry' : 'Add to Collection'}
    >
      {car && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Car info header */}
          <div className="flex items-center gap-3 p-3 bg-hw-bg rounded-lg border border-hw-border">
            {/* Image / upload */}
            <div className="relative w-14 h-14 rounded-lg overflow-hidden bg-zinc-800 flex-shrink-0 group/img">
              {imageUrl && !imgError ? (
                <img
                  src={imageUrl}
                  alt={car.name}
                  className="w-full h-full object-cover"
                  onError={() => setImgError(true)}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-zinc-500" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99z"/>
                  </svg>
                </div>
              )}
              {existingEntry && (
                <>
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
                    className="absolute inset-0 flex items-center justify-center bg-black/60
                               opacity-0 group-hover/img:opacity-100 transition-opacity"
                    title="Upload photo"
                  >
                    {uploading
                      ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      : <Camera className="w-4 h-4 text-white" />
                    }
                  </button>
                </>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm text-hw-text truncate">{car.name}</p>
              {car.series && (
                <p className="text-xs text-hw-muted truncate">{car.series.name}</p>
              )}
              {existingEntry && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="text-[11px] text-hw-accent hover:text-hw-orange transition-colors mt-0.5 disabled:opacity-50"
                >
                  {uploading ? 'Uploading…' : imageUrl ? 'Change photo' : 'Upload photo'}
                </button>
              )}
              {onEditCarDetails && (
                <button
                  type="button"
                  onClick={onEditCarDetails}
                  className="block text-[11px] text-hw-muted hover:text-hw-accent transition-colors mt-0.5"
                >
                  Edit car details ›
                </button>
              )}
            </div>
          </div>

          {/* Carded + Loose quantities */}
          <div>
            <label className="label">Copies Owned</label>
            <div className="grid grid-cols-2 gap-3">
              {(['carded_qty', 'loose_qty'] as const).map(field => {
                const label = field === 'carded_qty' ? 'Carded' : 'Loose'
                const qty = form[field]
                const active = qty > 0
                return (
                  <div
                    key={field}
                    className={`rounded-lg border p-3 transition-all ${active ? 'border-hw-accent/50 bg-hw-accent/5' : 'border-hw-border'}`}
                  >
                    <p className={`text-xs font-medium mb-2 ${active ? 'text-hw-accent' : 'text-hw-muted'}`}>{label}</p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => adjustQty(field, -1)}
                        className="w-7 h-7 rounded border border-hw-border hover:bg-zinc-700 flex items-center justify-center transition-colors"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className={`text-xl font-bold w-8 text-center ${active ? 'text-hw-text' : 'text-hw-muted'}`}>{qty}</span>
                      <button
                        type="button"
                        onClick={() => adjustQty(field, 1)}
                        className="w-7 h-7 rounded border border-hw-border hover:bg-zinc-700 flex items-center justify-center transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Condition */}
          <div>
            <label className="label">Condition</label>
            <div className="grid grid-cols-2 gap-2">
              {CONDITIONS.map(({ value, label, description }) => {
                const colorClass = conditionColors[value as keyof typeof conditionColors]
                const isSelected = form.condition === value
                const isMintDisabled = value === 'mint' && !isCarded
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => !isMintDisabled && setForm((p) => ({ ...p, condition: value }))}
                    disabled={isMintDisabled}
                    title={isMintDisabled ? 'Not available for loose cars' : undefined}
                    className={`
                      p-2.5 rounded-lg border text-left transition-all
                      ${isSelected ? colorClass : 'border-hw-border hover:border-zinc-600'}
                      ${isMintDisabled ? 'opacity-40 cursor-not-allowed' : ''}
                    `}
                  >
                    <div className="flex items-center gap-1.5">
                      {isSelected && <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />}
                      <span className="text-sm font-medium">{label}</span>
                    </div>
                    <p className="text-xs text-hw-muted mt-0.5">{description}</p>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Date acquired */}
          <div>
            <label className="label">Date Acquired</label>
            <input
              type="date"
              value={form.date_acquired}
              onChange={(e) => setForm((p) => ({ ...p, date_acquired: e.target.value }))}
              className="input-field"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="label">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              className="input-field resize-none h-20"
              placeholder="Store bought, trade, gift…"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            {existingEntry ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="w-10 h-10 rounded-lg border border-red-800/60 text-red-400
                           hover:bg-red-900/30 hover:border-red-700 flex items-center justify-center
                           transition-colors flex-shrink-0 disabled:opacity-50"
                title="Remove from collection"
              >
                {deleting
                  ? <span className="w-4 h-4 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin" />
                  : <Trash2 className="w-4 h-4" />
                }
              </button>
            ) : (
              <button type="button" onClick={handleClose} className="btn-secondary flex-1 justify-center">
                Cancel
              </button>
            )}
            <button type="submit" disabled={submitting} className="btn-primary flex-1 justify-center">
              {submitting ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              {submitting ? 'Saving…' : existingEntry ? 'Update' : 'Add to Collection'}
            </button>
            {existingEntry && (
              <button type="button" onClick={handleClose} className="btn-secondary flex-shrink-0 px-3 justify-center">
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </Modal>
  )
}
