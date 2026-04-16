export interface Series {
  id: string
  name: string
  year?: number
  type: string
  total_count?: number
  cars_list?: string[]
  image_url?: string
  created_at: string
}

export interface Car {
  id: string
  name: string
  series_id?: string
  series?: Series
  year?: number
  barcode?: string
  toy_number?: string
  primary_color?: string
  set_number?: number
  series_number?: number
  image_url?: string
  treasure_hunt: boolean
  car_type?: string
  created_at: string
}

export interface CollectionEntry {
  id: string
  user_id: string
  allcars_id: string
  car?: Car
  amount_owned: number
  carded: boolean
  condition: string
  notes?: string
  date_acquired?: string
  created_at: string
}

export interface WishlistEntry {
  id: string
  user_id: string
  allcars_id: string
  car?: Car
  priority: number
  notes?: string
  created_at: string
}

export interface Analytics {
  total_cars: number
  total_series: number
  total_cars_in_catalog: number
  series_completion: {
    series: Series
    owned: number
    total: number
    percent: number
  }[]
  cars_by_type: Record<string, number>
  cars_by_year: Record<string, number>
  recently_added: CollectionEntry[]
  treasure_hunts_count: number
  cars_by_condition: Record<string, number>
  carded_count: number
  loose_count: number
  top_colors: { color: string; count: number }[]
}

export interface BarcodeResult {
  car: Car | null
  found: boolean
}

export type CarType =
  | 'mainline'
  | 'premium'
  | 'super treasure hunt'
  | 'treasure hunt'
  | 'collector'

export type Condition = 'mint' | 'good' | 'fair' | 'poor'

export interface CarFilters {
  search: string
  series_id: string
  year: string
  treasure_hunt: string
  type: string
}

export interface CollectionFilters extends CarFilters {
  condition: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  total_pages: number
}
