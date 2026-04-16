import React, { useState, useEffect } from 'react'
import { Save, Loader2 } from 'lucide-react'
import { Modal } from './Modal'
import { updateCar, getAllSeries } from '../lib/api'
import { InfoTooltip } from './InfoTooltip'
import { useToastContext } from '../contexts/ToastContext'
import type { Car, Series } from '../types'

interface EditCarModalProps {
  isOpen: boolean
  onClose: () => void
  car: Car | null
  onSuccess?: (car: Car) => void
}

export function EditCarModal({ isOpen, onClose, car, onSuccess }: EditCarModalProps) {
  const { toast } = useToastContext()
  const [series, setSeries] = useState<Series[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    name: '',
    year: '',
    series_id: '',
    primary_color: '',
    series_number: '',
    barcode: '',
    treasure_hunt: false,
  })

  useEffect(() => {
    if (!isOpen || !car) return
    setForm({
      name: car.name,
      year: car.year ? String(car.year) : '',
      series_id: car.series_id || '',
      primary_color: car.primary_color || '',
      series_number: car.series_number ? String(car.series_number) : '',
      barcode: car.barcode || '',
      treasure_hunt: car.treasure_hunt,
    })
    getAllSeries().then(setSeries).catch(() => toast.error('Failed to load series'))
  }, [isOpen, car])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target
    setForm(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }))
  }

  const selectedSeries = series.find(s => s.id === form.series_id)
  const canHaveTreasureHunt = selectedSeries?.type !== 'premium' && selectedSeries?.type !== 'collector'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!car) return
    if (!form.name.trim()) { toast.error('Car name is required'); return }
    if (!form.series_id) { toast.error('Please select a series'); return }
    if (!form.primary_color.trim()) { toast.error('Please enter a color'); return }

    setSubmitting(true)
    try {
      const updated = await updateCar(car.id, {
        name: form.name.trim(),
        year: form.year ? parseInt(form.year) : undefined,
        series_id: form.series_id || undefined,
        primary_color: form.primary_color || undefined,
        series_number: form.series_number ? parseInt(form.series_number) : undefined,
        barcode: form.barcode || undefined,
        treasure_hunt: canHaveTreasureHunt ? form.treasure_hunt : false,
      })
      toast.success('Car updated!')
      onSuccess?.(updated)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update car')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Car Details" size="lg">
      {car && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="label">Car Name <span className="text-hw-accent">*</span></label>
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              className="input-field"
              placeholder="e.g. '69 Dodge Charger Daytona"
              required
            />
          </div>

          {/* Series */}
          <div>
            <label className="label">Series <span className="text-hw-accent">*</span></label>
            <select name="series_id" value={form.series_id} onChange={handleChange} className="input-field">
              <option value="">Select series…</option>
              {series.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.type !== 'mainline' && `(${s.type})`}
                </option>
              ))}
            </select>
          </div>

          {/* Year */}
          <div>
            <label className="label">Year</label>
            <input
              name="year" value={form.year} onChange={handleChange}
              className="input-field" type="number" placeholder="2024"
              min="1968" max={new Date().getFullYear() + 2}
            />
          </div>

          {/* Color */}
          <div>
            <label className="label">Primary Color <span className="text-hw-accent">*</span></label>
            <input
              name="primary_color" value={form.primary_color} onChange={handleChange}
              className="input-field" placeholder="Red, Blue, Spectraflame Green…" required
            />
          </div>

          {/* Series Number */}
          <div>
            <label className="label flex items-center gap-1">
              Series Position
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

          {/* Barcode */}
          <div>
            <label className="label flex items-center gap-1">
              Barcode (UPC)
              <InfoTooltip text="The retail UPC barcode on the back of the card. Optional." />
            </label>
            <input
              name="barcode" value={form.barcode} onChange={handleChange}
              className="input-field" placeholder="0123456789"
            />
          </div>

          {/* Treasure Hunt - only for non-premium series */}
          {canHaveTreasureHunt && (
            <div className={`p-3 rounded-lg border transition-colors ${form.treasure_hunt ? 'border-yellow-600/40 bg-yellow-950/20' : 'border-hw-border bg-hw-bg'}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-hw-text flex items-center gap-2">
                  Treasure Hunt
                  {form.treasure_hunt && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-yellow-900/50 text-yellow-300 border border-yellow-600/40">
                      TH
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setForm(p => ({ ...p, treasure_hunt: !p.treasure_hunt }))}
                  className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${form.treasure_hunt ? 'bg-yellow-600' : 'bg-hw-border'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${form.treasure_hunt ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>
          )}

          {selectedSeries?.type === 'premium' && (
            <p className="text-xs text-hw-muted bg-hw-bg p-2 rounded">
              Premium series cannot have Treasure Hunt designations.
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="btn-primary flex-1 justify-center">
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Changes
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}