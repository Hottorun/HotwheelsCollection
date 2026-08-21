import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from 'react'
import { fetchMe, login as apiLogin, logout as apiLogout, type AuthUser } from '../lib/api'
import { getToken, setExpiredHandler } from '../lib/session'

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    // A token in storage is only a hint — it may be expired or its account
    // deleted, so confirm it against the backend before treating it as a session.
    if (!getToken()) {
      setLoading(false)
      return
    }

    fetchMe()
      .then((me) => {
        if (!cancelled) setUser(me)
      })
      .catch(() => {
        if (!cancelled) setUser(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  // Any 401 anywhere in the app clears the session here too, so protected
  // routes redirect instead of rendering against a dead token.
  useEffect(() => {
    setExpiredHandler(() => setUser(null))
    return () => setExpiredHandler(null)
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const me = await apiLogin(email, password)
      setUser(me)
      return { error: null }
    } catch (err) {
      return { error: err as Error }
    }
  }, [])

  const signOut = useCallback(async () => {
    apiLogout()
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
