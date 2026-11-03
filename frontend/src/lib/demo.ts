/**
 * In-memory stand-in for the backend, used by the public demo build
 * (`vite build --mode demo`, see .env.demo).
 *
 * It answers the same paths and shapes as backend/main.py from a bundled
 * snapshot of the catalogue (src/demo/data.json, built by
 * scripts/build-demo-data.py). Edits work but live only in memory, so a reload
 * puts everything back. Anything that needs the real server — wiki scraping,
 * barcode and toy-number lookups, sheet import, user admin — says so instead.
 */
import data from '../demo/data.json'
import type { Car, Series, CollectionEntry, WishlistEntry } from '../types'
import type { AuthUser } from './api'

export const DEMO_USER: AuthUser = {
  id: 'demo',
  email: 'demo@hottorun.com',
  is_admin: false,
}

const NOT_IN_DEMO = 'Not available in the demo — this needs the live backend.'

type Row = Record<string, unknown>

const cars = data.cars as unknown as Car[]
const series = data.series as unknown as Series[]
const collection = (data.collection as unknown as Row[]).map(
  (entry) => ({ ...entry, user_id: DEMO_USER.id }) as unknown as CollectionEntry
)
const wishlist: WishlistEntry[] = []

const COLOR_BUCKETS: [string, string[]][] = [
  ['Black', ['black']],
  ['White', ['white', 'pearl']],
  ['Silver', ['silver', 'chrome']],
  ['Gray', ['gray', 'grey', 'gunmetal']],
  ['Red', ['red', 'maroon', 'burgundy']],
  ['Blue', ['blue', 'aqua', 'cyan']],
  ['Green', ['green', 'lime']],
  ['Yellow', ['yellow']],
  ['Orange', ['orange']],
  ['Purple', ['purple', 'violet']],
  ['Pink', ['pink', 'magenta']],
  ['Gold', ['gold']],
  ['Brown', ['brown', 'bronze', 'copper']],
  ['Tan', ['tan', 'beige', 'cream']],
]

function colorBucket(color: string): string {
  const words = color.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
  for (const [label, keywords] of COLOR_BUCKETS) {
    if (keywords.some((keyword) => words.includes(keyword))) return label
  }
  return color.trim().replace(/\b\w/g, (c) => c.toUpperCase())
}

function newId(): string {
  return crypto.randomUUID()
}

function now(): string {
  return new Date().toISOString()
}

function fail(message: string): never {
  throw new Error(message)
}

function byCreated<T extends { created_at?: string }>(a: T, b: T): number {
  return (a.created_at ?? '').localeCompare(b.created_at ?? '')
}

function withSeries(car: Car): Car {
  return { ...car, series: series.find((s) => s.id === car.series_id) }
}

function withCar<T extends { allcars_id: string }>(entry: T): T & { car?: Car } {
  const car = cars.find((c) => c.id === entry.allcars_id)
  return { ...entry, car: car ? withSeries(car) : undefined }
}

function findOrFail<T extends { id: string }>(rows: T[], id: string, what: string): T {
  return rows.find((row) => row.id === id) ?? fail(`${what} not found`)
}

function remove<T extends { id: string }>(rows: T[], id: string): void {
  const index = rows.findIndex((row) => row.id === id)
  if (index !== -1) rows.splice(index, 1)
}

/** Same rules as `_car_filters` in backend/main.py. */
function filterCars(params: URLSearchParams): Car[] {
  let result = [...cars].sort(byCreated)
  const search = params.get('search')?.trim()
  if (search) {
    const year = search.match(/\b(19|20)\d{2}\b/)
    if (year) {
      const parts = search
        .replace(/\b(19|20)\d{2}\b/g, ' ')
        .replace(/[()'‘’"`]/g, ' ')
        .split(/\s+/)
        .filter((part) => part.length > 1)
        .map((part) => part.toLowerCase())
      result = result.filter(
        (c) =>
          c.year === Number(year[0]) &&
          parts.every((part) => c.name.toLowerCase().includes(part))
      )
    } else {
      const term = search.toLowerCase()
      result = result.filter((c) =>
        [c.name, c.toy_number, c.primary_color].some((v) => v?.toLowerCase().includes(term))
      )
    }
  }
  const seriesId = params.get('series_id')
  if (seriesId) result = result.filter((c) => c.series_id === seriesId)
  const year = params.get('year')
  if (year) result = result.filter((c) => c.year === Number(year))
  const treasureHunt = params.get('treasure_hunt')
  if (treasureHunt) result = result.filter((c) => c.treasure_hunt === (treasureHunt === 'true'))
  const type = params.get('type')?.toLowerCase()
  if (type) result = result.filter((c) => c.car_type?.toLowerCase().includes(type))
  return result
}

function listCars(params: URLSearchParams) {
  const all = filterCars(params)
  const page = Math.max(1, Number(params.get('page') ?? 1))
  const pageSize = Math.max(1, Math.min(Number(params.get('page_size') ?? 20), 10000))
  return {
    items: all.slice(pageSize * (page - 1), pageSize * page).map(withSeries),
    total: all.length,
    total_pages: Math.max(1, Math.ceil(all.length / pageSize)),
    page,
    page_size: pageSize,
  }
}

function ownedCarIds(): Set<string> {
  return new Set(collection.map((e) => e.allcars_id))
}

function listSeries() {
  const owned = ownedCarIds()
  return [...series].sort(byCreated).map((s) => ({
    ...s,
    owned_count: cars.filter((c) => c.series_id === s.id && owned.has(c.id)).length,
  }))
}

function getSeries(id: string) {
  const row = findOrFail(series, id, 'Series')
  const owned = ownedCarIds()
  const seriesCars = cars
    .filter((c) => c.series_id === id)
    .sort(
      (a, b) =>
        (a.series_number ?? Infinity) - (b.series_number ?? Infinity) ||
        a.name.localeCompare(b.name)
    )
    .map((c) => ({ ...c, owned: owned.has(c.id) }))
  return { ...row, cars: seriesCars }
}

function listCollection() {
  return collection
    .map(withCar)
    .sort((a, b) => byCreated(b, a))
}

/** Same computation as `get_analytics` in backend/main.py. */
function analytics() {
  const entries = collection.map(withCar)
  const sum = (rows: typeof entries) => rows.reduce((n, e) => n + (e.amount_owned ?? 1), 0)
  const tally = (key: (e: (typeof entries)[number]) => string) => {
    const counts: Record<string, number> = {}
    for (const e of entries) counts[key(e)] = (counts[key(e)] ?? 0) + (e.amount_owned ?? 1)
    return counts
  }

  const carsPerSeries: Record<string, number> = {}
  for (const c of cars) {
    if (c.series_id) carsPerSeries[c.series_id] = (carsPerSeries[c.series_id] ?? 0) + 1
  }
  const ownedPerSeries: Record<string, number> = {}
  for (const e of entries) {
    const sid = e.car?.series_id
    if (sid) ownedPerSeries[sid] = (ownedPerSeries[sid] ?? 0) + 1
  }

  const colors: Record<string, number> = {}
  for (const e of entries) {
    const color = e.car?.primary_color
    if (color) colors[colorBucket(color)] = (colors[colorBucket(color)] ?? 0) + (e.amount_owned ?? 1)
  }

  const seriesCompletion = series
    .filter((s) => ownedPerSeries[s.id])
    .map((s) => {
      const owned = ownedPerSeries[s.id]
      const total = s.total_count || carsPerSeries[s.id] || 0
      return {
        series: s,
        owned,
        total,
        percent: total ? Math.round((owned / total) * 1000) / 10 : 0,
      }
    })
    .sort((a, b) => b.percent - a.percent)

  return {
    total_cars: sum(entries),
    total_series: Object.keys(ownedPerSeries).length,
    treasure_hunts_count: entries.filter((e) => e.car?.treasure_hunt).length,
    cars_by_type: tally((e) => e.car?.car_type || 'unknown'),
    cars_by_year: tally((e) => String(e.car?.year || 'unknown')),
    series_completion: seriesCompletion,
    recently_added: listCollection().slice(0, 5),
    cars_by_condition: tally((e) => e.condition || 'unknown'),
    carded_count: sum(entries.filter((e) => e.carded !== false)),
    loose_count: sum(entries.filter((e) => e.carded === false)),
    top_colors: Object.entries(colors)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([color, count]) => ({ color, count })),
    total_cars_in_catalog: Object.values(carsPerSeries).reduce((n, v) => n + v, 0),
  }
}

function route(method: string, path: string, params: URLSearchParams, body: Row): unknown {
  // Fixed paths first, so "auth/me" isn't read as an id under "auth".
  if (method === 'GET' && path === '/api/auth/me') return DEMO_USER
  // Lets the import page render its empty state rather than an error.
  if (method === 'GET' && path === '/api/import/batches') return []

  const [resource, id, sub] = path.split('/').filter(Boolean).slice(1) // drop "api"

  switch (`${method} ${resource}${id ? '/:id' : ''}${sub ? `/${sub}` : ''}`) {
    case 'GET cars':
      return listCars(params)
    case 'GET cars/:id':
      return withSeries(findOrFail(cars, id, 'Car'))
    case 'POST cars': {
      const car = { ...body, id: newId(), treasure_hunt: Boolean(body.treasure_hunt), created_at: now() }
      cars.push(car as unknown as Car)
      return car
    }
    case 'PUT cars/:id':
      return Object.assign(findOrFail(cars, id, 'Car'), body)
    case 'DELETE cars/:id':
      remove(cars, id)
      for (const e of collection.filter((e) => e.allcars_id === id)) remove(collection, e.id)
      for (const e of wishlist.filter((e) => e.allcars_id === id)) remove(wishlist, e.id)
      return undefined
    case 'DELETE cars/:id/image':
      findOrFail(cars, id, 'Car').image_url = undefined
      return undefined

    case 'GET series':
      return listSeries()
    case 'GET series/:id':
      return getSeries(id)
    case 'POST series': {
      const row = { ...body, id: newId(), created_at: now() }
      series.push(row as unknown as Series)
      return row
    }
    case 'PUT series/:id':
      return Object.assign(findOrFail(series, id, 'Series'), body)
    case 'DELETE series/:id':
      remove(series, id)
      for (const c of cars) if (c.series_id === id) c.series_id = undefined
      return undefined

    case 'GET collection':
      return listCollection()
    case 'POST collection': {
      findOrFail(cars, String(body.allcars_id), 'Car')
      const entry = {
        amount_owned: 1,
        carded: true,
        condition: 'mint',
        ...body,
        id: newId(),
        user_id: DEMO_USER.id,
        created_at: now(),
      } as unknown as CollectionEntry
      collection.push(entry)
      return withCar(entry)
    }
    case 'PUT collection/:id':
      return Object.assign(findOrFail(collection, id, 'Entry'), body)
    case 'DELETE collection/:id':
      remove(collection, id)
      return undefined

    case 'GET wishlist':
      return wishlist
        .map(withCar)
        .sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity))
    case 'POST wishlist': {
      findOrFail(cars, String(body.allcars_id), 'Car')
      const entry = {
        priority: 1,
        ...body,
        id: newId(),
        user_id: DEMO_USER.id,
        created_at: now(),
      } as unknown as WishlistEntry
      wishlist.push(entry)
      return entry
    }
    case 'PUT wishlist/:id':
      return Object.assign(findOrFail(wishlist, id, 'Entry'), body)
    case 'DELETE wishlist/:id':
      remove(wishlist, id)
      return undefined

    case 'GET analytics':
      return analytics()

    default:
      return fail(NOT_IN_DEMO)
  }
}

export async function demoRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = new URL(path, 'http://demo')
  const body = typeof options.body === 'string' ? (JSON.parse(options.body) as Row) : {}
  const result = route((options.method ?? 'GET').toUpperCase(), url.pathname, url.searchParams, body)
  // A copy, so pages can't mutate the store by editing what they were given.
  return (result === undefined ? undefined : structuredClone(result)) as T
}

export function notInDemo(): never {
  return fail(NOT_IN_DEMO)
}
