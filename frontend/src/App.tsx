import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { SearchProvider } from './contexts/SearchContext'
import { ToastProvider } from './contexts/ToastContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/LoginPage'
import { CollectionPage } from './pages/CollectionPage'
import { AllCarsPage } from './pages/AllCarsPage'
import { WishlistPage } from './pages/WishlistPage'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { DiscoverPage } from './pages/DiscoverPage'
import { BulkAddPage } from './pages/BulkAddPage'
import { SeriesPage } from './pages/SeriesPage'
import { AdminPage } from './pages/AdminPage'
import { Spinner } from './components/Spinner'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-hw-bg flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

/**
 * Belt and braces alongside the hidden nav link — the backend rejects non-admins
 * on every /api/admin route regardless, but this keeps a typed-in /admin URL
 * from rendering a page of failed requests.
 */
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()

  if (!user?.is_admin) {
    return <Navigate to="/collection" replace />
  }

  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Navigate to="/collection" replace />} />
      <Route
        element={
          <ProtectedRoute>
            <SearchProvider>
              <Layout />
            </SearchProvider>
          </ProtectedRoute>
        }
      >
        <Route path="/collection" element={<CollectionPage />} />
        <Route path="/all-cars" element={<AllCarsPage />} />
        <Route path="/wishlist" element={<WishlistPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/series" element={<SeriesPage />} />
        <Route path="/discover" element={<DiscoverPage />} />
        <Route path="/bulk-add" element={<BulkAddPage />} />
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <AdminPage />
            </AdminRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
