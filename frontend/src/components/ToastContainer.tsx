import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react'
import type { Toast } from '../hooks/useToast'

interface ToastItemProps {
  toast: Toast
  onRemove: (id: string) => void
}

const iconMap = {
  success: <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />,
  error: <XCircle className="w-4 h-4 text-hw-accent flex-shrink-0" />,
  warning: <AlertCircle className="w-4 h-4 text-hw-orange flex-shrink-0" />,
  info: <Info className="w-4 h-4 text-blue-400 flex-shrink-0" />,
}

const borderMap = {
  success: 'border-emerald-500/30',
  error: 'border-hw-accent/30',
  warning: 'border-hw-orange/30',
  info: 'border-blue-500/30',
}

function ToastItem({ toast, onRemove }: ToastItemProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const showTimer = setTimeout(() => setVisible(true), 10)
    return () => clearTimeout(showTimer)
  }, [])

  const handleClose = () => {
    setVisible(false)
    setTimeout(() => onRemove(toast.id), 300)
  }

  return (
    <div
      className={`
        flex items-start gap-3 p-3.5 bg-hw-surface border ${borderMap[toast.type]} rounded-xl
        shadow-2xl shadow-black/50 max-w-sm w-full backdrop-blur-sm
        transition-all duration-300 ease-out
        ${visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}
      `}
    >
      {iconMap[toast.type]}
      <p className="text-sm text-hw-text flex-1 leading-relaxed">{toast.message}</p>
      <button
        onClick={handleClose}
        className="text-hw-muted hover:text-hw-text transition-colors ml-1 flex-shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

interface ToastContainerProps {
  toasts: Toast[]
  onRemove: (id: string) => void
}

export function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-20 md:bottom-6 right-4 z-[9999] flex flex-col gap-2 items-end">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onRemove={onRemove} />
      ))}
    </div>
  )
}
