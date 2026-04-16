import React, { useState, useEffect } from 'react'
import { Save, Loader2, Trash2 } from 'lucide-react'
import { Modal } from './Modal'
import { updateSeries, deleteSeries } from '../lib/api'
import { useToastContext } from '../contexts/ToastContext'
import type { Series } from '../types'

interface SeriesEditModalProps {
  isOpen: boolean
  onClose: () => void
  series: Series | null
  onSuccess?: (series: Series) => void
  onDelete?: (seriesId: string) => void
}

export function SeriesEditModal({ isOpen, onClose, series, onSuccess, onDelete }: SeriesEditModalProps) {
  const { toast } = useToastContext()
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [form, setForm] = useState({
    name: '',
    year: '',
    type: 'mainline' as 'mainline' | 'premium' | 'collector',
    total_count: '',
  })

  useEffect(() => {
    if (!isOpen || !series) return
    setForm({
      name: series.name,
      year: series.year ? String(series.year) : '',
      type: (series.type as 'mainline' | 'premium' | 'collector') || 'mainline',
      total_count: series.total_count ? String(series.total_count) : '',
    })
  }, [isOpen, series])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
  }

  const handleDelete = async () => {
    if (!series) return
    if (!confirmDelete) { setConfirmDelete(true); return }
    setDeleting(true)
    try {
      await deleteSeries(series.id)
      toast.success(`"${series.name}" deleted`)
      onDelete?.(series.id)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete series')
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!series) return
    if (!form.name.trim()) { toast.error('Series name is required'); return }

    setSubmitting(true)
    try {
      const updated = await updateSeries(series.id, {
        name: form.name.trim(),
        year: form.year ? parseInt(form.year) : undefined,
        type: form.type,
        total_count: form.total_count ? parseInt(form.total_count) : undefined,
      })
      toast.success('Series updated!')
      onSuccess?.(updated)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update series')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Series" size="md">
      {series && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Series Name <span className="text-hw-accent">*</span></label>
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              className="input-field"
              placeholder="e.g. Hot Wheels Boulevard"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Year</label>
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
              <label className="label">Type</label>
              <select
                name="type"
                value={form.type}
                onChange={handleChange}
                className="input-field"
              >
                <option value="mainline">Mainline</option>
                <option value="premium">Premium</option>
                <option value="collector">Collector (RLC)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label">Total Cars in Series</label>
            <input
              name="total_count"
              value={form.total_count}
              onChange={handleChange}
              className="input-field"
              type="number"
              placeholder="e.g. 250"
              min="1"
            />
            <p className="text-xs text-hw-muted mt-1">Used for completion tracking in analytics</p>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className={`flex-shrink-0 px-3 py-2 rounded-lg border text-sm font-medium flex items-center gap-1.5 transition-all ${
                confirmDelete
                  ? 'border-red-500/60 bg-red-900/30 text-red-300 hover:bg-red-900/50'
                  : 'border-hw-border text-hw-muted hover:border-red-500/40 hover:text-red-400'
              }`}
            >
              {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              {confirmDelete ? 'Confirm?' : ''}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="btn-primary flex-1 justify-center">
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}