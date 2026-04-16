import React, { createContext, useContext } from 'react'
import { useToast, type Toast, type ToastType } from '../hooks/useToast'
import { ToastContainer } from '../components/ToastContainer'

interface ToastContextValue {
  toast: {
    success: (msg: string, duration?: number) => void
    error: (msg: string, duration?: number) => void
    info: (msg: string, duration?: number) => void
    warning: (msg: string, duration?: number) => void
  }
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { toasts, toast, removeToast } = useToast()

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  )
}

export function useToastContext(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToastContext must be used within ToastProvider')
  }
  return ctx
}

export type { Toast, ToastType }
