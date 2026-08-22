import { getToken, handleExpired, setToken, clearToken } from './session'
import type {
  Car,
  Series,
  CollectionEntry,
  WishlistEntry,
  Analytics,
  BarcodeResult,
  PaginatedResponse,
} from '../types'

// `??` rather than `||` on purpose: when the app is served by the nginx
// container it is built with VITE_API_URL="" so that requests go to the same
// origin and get proxied to the backend. An empty string is a meaningful value
// here, and `||` would wrongly fall through to localhost.
export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

/**
 * Car images are stored on the NAS and come back as a root-relative path
 * ("/images/<id>.jpg") rather than an absolute URL, because the NAS answers on
 * more than one hostname — the LAN address at home, the tunnel hostname when
 * out. Anything already absolute (scraped wiki/CollectHW images) passes through.
 */
export function resolveImageUrl(url?: string | null): string | undefined {
  if (!url) return undefined
  if (url.startsWith('/images/')) return `${API_BASE}${url}`
  return url
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const token = getToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...(options.headers as Record<string, string>),
    },
  })

  if (!response.ok) {
    // An expired or revoked token should send us back to the login screen
    // rather than surfacing as a generic error on every page.
    if (response.status === 401) handleExpired()
    const error = await response.json().catch(() => ({ detail: 'Request failed' }))
    throw new Error(error.detail || `HTTP ${response.status}`)
  }

  if (response.status === 204) return undefined as T
  return response.json()
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string
  email: string
  is_admin: boolean
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const response = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Login failed' }))
    throw new Error(err.detail || 'Invalid email or password')
  }
  const data = await response.json()
  setToken(data.access_token)
  return data.user as AuthUser
}

export async function fetchMe(): Promise<AuthUser> {
  return request<AuthUser>('/api/auth/me')
}

export function logout(): void {
  clearToken()
}

export async function changeOwnPassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  return request<void>('/api/auth/password', {
    method: 'POST',
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  })
}

// ─── Admin ────────────────────────────────────────────────────────────────────

export interface ManagedUser {
  id: string
  email: string
  is_admin: boolean
  created_at: string
  collection_count: number
  wishlist_count: number
}

export async function getUsers(): Promise<ManagedUser[]> {
  return request<ManagedUser[]>('/api/admin/users')
}

export async function createUser(
  email: string,
  password: string,
  isAdmin: boolean
): Promise<ManagedUser> {
  return request<ManagedUser>('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password, is_admin: isAdmin }),
  })
}

export async function setUserPassword(userId: string, newPassword: string): Promise<void> {
  return request<void>(`/api/admin/users/${userId}/password`, {
    method: 'POST',
    body: JSON.stringify({ new_password: newPassword }),
  })
}

export async function setUserAdmin(userId: string, isAdmin: boolean): Promise<ManagedUser> {
  return request<ManagedUser>(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_admin: isAdmin }),
  })
}

// ─── Cars ────────────────────────────────────────────────────────────────────

export interface CarListParams {
  search?: string
  series_id?: string
  year?: number | string
  treasure_hunt?: boolean | string
  type?: string
  page?: number
  page_size?: number
}

export async function getCars(params: CarListParams = {}): Promise<PaginatedResponse<Car>> {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && value !== null) {
      query.set(key, String(value))
    }
  })
  const qs = query.toString()
  return request<PaginatedResponse<Car>>(`/api/cars${qs ? `?${qs}` : ''}`)
}

export async function getCar(id: string): Promise<Car> {
  return request<Car>(`/api/cars/${id}`)
}

export async function createCar(data: Partial<Car>): Promise<Car> {
  return request<Car>('/api/cars', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateCar(id: string, data: Partial<Car>): Promise<Car> {
  return request<Car>(`/api/cars/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

// ─── Series ──────────────────────────────────────────────────────────────────

export async function getAllSeries(): Promise<Series[]> {
  return request<Series[]>('/api/series')
}

export async function getSeriesById(id: string): Promise<Series & { cars: Car[] }> {
  return request<Series & { cars: Car[] }>(`/api/series/${id}`)
}

export async function createSeries(data: Partial<Series>): Promise<Series> {
  return request<Series>('/api/series', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateSeries(id: string, data: Partial<Series>): Promise<Series> {
  return request<Series>(`/api/series/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

// ─── Collection ───────────────────────────────────────────────────────────────

export async function getCollection(): Promise<CollectionEntry[]> {
  return request<CollectionEntry[]>('/api/collection')
}

export interface AddToCollectionPayload {
  allcars_id: string
  amount_owned?: number
  carded?: boolean
  condition?: string
  notes?: string
  date_acquired?: string
}

export async function addToCollection(data: AddToCollectionPayload): Promise<CollectionEntry> {
  return request<CollectionEntry>('/api/collection', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateCollectionEntry(
  id: string,
  data: Partial<AddToCollectionPayload>
): Promise<CollectionEntry> {
  return request<CollectionEntry>(`/api/collection/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export async function removeFromCollection(id: string): Promise<void> {
  return request<void>(`/api/collection/${id}`, { method: 'DELETE' })
}

// ─── Wishlist ─────────────────────────────────────────────────────────────────

export async function getWishlist(): Promise<WishlistEntry[]> {
  return request<WishlistEntry[]>('/api/wishlist')
}

export interface AddToWishlistPayload {
  allcars_id: string
  priority?: number
  notes?: string
}

export async function addToWishlist(data: AddToWishlistPayload): Promise<WishlistEntry> {
  return request<WishlistEntry>('/api/wishlist', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateWishlistEntry(
  id: string,
  data: Partial<AddToWishlistPayload>
): Promise<WishlistEntry> {
  return request<WishlistEntry>(`/api/wishlist/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export async function removeFromWishlist(id: string): Promise<void> {
  return request<void>(`/api/wishlist/${id}`, { method: 'DELETE' })
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export async function getAnalytics(): Promise<Analytics> {
  return request<Analytics>('/api/analytics')
}

// ─── Barcode ──────────────────────────────────────────────────────────────────

export async function lookupBarcode(barcode: string): Promise<BarcodeResult> {
  return request<BarcodeResult>('/api/barcode/lookup', {
    method: 'POST',
    body: JSON.stringify({ barcode }),
  })
}

// ─── Image Upload ─────────────────────────────────────────────────────────────

export async function uploadCarImage(carId: string, file: File): Promise<{ image_url: string }> {
  const formData = new FormData()
  formData.append('file', file)
  const token = getToken()
  // Content-Type is deliberately left unset so the browser adds the multipart
  // boundary itself.
  const response = await fetch(`${API_BASE}/api/cars/${carId}/image`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  })
  if (!response.ok) {
    if (response.status === 401) handleExpired()
    const err = await response.json().catch(() => ({ detail: 'Upload failed' }))
    throw new Error(err.detail || `HTTP ${response.status}`)
  }
  return response.json()
}

export async function deleteCarImage(carId: string): Promise<void> {
  return request<void>(`/api/cars/${carId}/image`, { method: 'DELETE' })
}

export async function deleteCar(carId: string): Promise<void> {
  return request<void>(`/api/cars/${carId}`, { method: 'DELETE' })
}

export async function deleteSeries(seriesId: string): Promise<void> {
  return request<void>(`/api/series/${seriesId}`, { method: 'DELETE' })
}

// ─── Scraping ─────────────────────────────────────────────────────────────────

export interface WikiSearchResult {
  title: string
  url: string
}

export interface ScrapedVersion {
  year: number
  color?: string
  series_name?: string
  series_number?: number
  series_total?: number
  set_number?: number
  toy_number?: string
  photo_url?: string
  car_type?: string
}

export interface ScrapedCar {
  collecthw_id?: string
  name?: string
  year?: number
  series_name?: string
  primary_color?: string
  image_url?: string
  treasure_hunt?: boolean
  car_type?: string
  series_number?: number
  set_number?: number
  barcode?: string
  versions?: ScrapedVersion[]
  in_db?: boolean
  url?: string
}

export interface FeedFilters {
  q?: string
  year?: number
  color?: string
  car_type?: string
}

export async function getFeed(limit = 10, filters: FeedFilters = {}): Promise<ScrapedCar[]> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (filters.q) params.set('q', filters.q)
  if (filters.year) params.set('year', String(filters.year))
  if (filters.color) params.set('color', filters.color)
  if (filters.car_type) params.set('car_type', filters.car_type)
  return request<ScrapedCar[]>(`/api/scrape/feed?${params}`)
}

export async function scrapeSearch(q: string, prefer: 'chw' | 'wiki' = 'chw'): Promise<ScrapedCar[]> {
  return request<ScrapedCar[]>(`/api/scrape/search?q=${encodeURIComponent(q)}&prefer=${prefer}`)
}

export async function scrapeCar(url: string): Promise<ScrapedCar> {
  return request<ScrapedCar>(`/api/scrape/car?url=${encodeURIComponent(url)}`)
}

export async function toyNumberLookup(code: string): Promise<ScrapedCar[]> {
  return request<ScrapedCar[]>(`/api/toy-number/lookup?code=${encodeURIComponent(code)}`)
}
