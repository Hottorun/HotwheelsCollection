import { supabase } from './supabase'
import type {
  Car,
  Series,
  CollectionEntry,
  WishlistEntry,
  Analytics,
  BarcodeResult,
  PaginatedResponse,
} from '../types'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`
  }
  return headers
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = await getAuthHeaders()
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers as Record<string, string>),
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Request failed' }))
    throw new Error(error.detail || `HTTP ${response.status}`)
  }

  if (response.status === 204) return undefined as T
  return response.json()
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
  const { data: { session } } = await (await import('./supabase')).supabase.auth.getSession()
  const formData = new FormData()
  formData.append('file', file)
  const response = await fetch(`${API_BASE}/api/cars/${carId}/image`, {
    method: 'POST',
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
    body: formData,
  })
  if (!response.ok) {
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
