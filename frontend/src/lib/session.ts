/**
 * Token storage for the self-hosted auth backend.
 *
 * Replaces what supabase-js used to manage. Kept in its own module so that
 * api.ts and AuthContext.tsx can both reach it without importing each other.
 */

const TOKEN_KEY = 'hw_access_token'

let expiredHandler: (() => void) | null = null

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null // private-mode Safari and similar
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    /* ignore — the session just won't survive a reload */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Registered by AuthContext so that a 401 from any request drops the user back
 * to the login screen, instead of leaving the UI stuck on a dead token.
 */
export function setExpiredHandler(handler: (() => void) | null): void {
  expiredHandler = handler
}

export function handleExpired(): void {
  clearToken()
  expiredHandler?.()
}
