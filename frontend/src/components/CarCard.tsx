import { useState } from 'react'
import {
  Flame,
  Heart,
  Plus,
  CheckCircle2,
} from 'lucide-react'
import type { Car, CollectionEntry, WishlistEntry } from '../types'

interface CarCardProps {
  car: Car
  collectionEntry?: CollectionEntry
  wishlistEntry?: WishlistEntry
  wishlistPending?: boolean
  onAddToCollection?: (car: Car) => void
  onAddToWishlist?: (car: Car) => void
  onRemoveFromWishlist?: (entry: WishlistEntry) => void
  onEditCarDetails?: (car: Car) => void
  showActions?: boolean
}

function CarImagePlaceholder({ car }: { car: Car }) {
  // Generate a gradient based on car name for variety
  const hash = car.name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  const gradients = [
    'from-zinc-700 to-zinc-900',
    'from-red-900 to-zinc-900',
    'from-orange-900 to-zinc-900',
    'from-blue-900 to-zinc-900',
    'from-purple-900 to-zinc-900',
    'from-emerald-900 to-zinc-900',
  ]
  const gradient = gradients[hash % gradients.length]

  return (
    <div className={`w-full h-full bg-gradient-to-br ${gradient} flex items-center justify-center`}>
      <div className="text-center px-3">
        <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-white/10 flex items-center justify-center">
          <svg className="w-6 h-6 text-white/40" fill="currentColor" viewBox="0 0 24 24">
            <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>
          </svg>
        </div>
        <span className="text-[10px] text-white/30 font-medium">No Image</span>
      </div>
    </div>
  )
}

export function CarCard({
  car,
  collectionEntry,
  wishlistEntry,
  wishlistPending = false,
  onAddToCollection,
  onAddToWishlist,
  onRemoveFromWishlist,
  onEditCarDetails,
  showActions = true,
}: CarCardProps) {
  const [imgError, setImgError] = useState(false)
  const isOwned = !!collectionEntry
  const isWishlisted = !!wishlistEntry

  return (
    <div
      className="card card-hover group flex flex-col overflow-hidden cursor-pointer"
      onClick={() => onEditCarDetails?.(car)}
    >
      {/* Image area */}
      <div className="relative h-40 overflow-hidden bg-zinc-900">
        {car.image_url && !imgError ? (
          <img
            src={car.image_url}
            alt={car.name}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <CarImagePlaceholder car={car} />
        )}

        {/* Overlays */}
        <div className="absolute inset-0 bg-gradient-to-t from-hw-surface via-transparent to-transparent opacity-80" />

        {/* Badges top-left */}
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          {car.treasure_hunt && (
            <span className="badge bg-yellow-500/90 text-yellow-900 font-bold shadow-lg">
              <Flame className="w-3 h-3" />
              TH
            </span>
          )}
          {isOwned && (
            <span className="badge bg-emerald-500/90 text-emerald-900 font-bold">
              <CheckCircle2 className="w-3 h-3" />
              {collectionEntry!.amount_owned > 1 ? `×${collectionEntry!.amount_owned}` : 'Owned'}
            </span>
          )}
        </div>

        {/* Wishlist button bottom-right */}
        {showActions && onAddToWishlist && !isOwned && (
          <button
            disabled={wishlistPending}
            onClick={(e) => {
              e.stopPropagation()
              if (isWishlisted && onRemoveFromWishlist && wishlistEntry) {

                onRemoveFromWishlist(wishlistEntry)
              } else if (!isWishlisted) {
                onAddToWishlist(car)
              }
            }}
            className={`
              absolute bottom-2 right-2 w-6 h-6 rounded-full flex items-center justify-center
              transition-all duration-200
              disabled:opacity-50 disabled:cursor-not-allowed
              ${isWishlisted
                ? 'bg-hw-accent text-white'
                : 'bg-black/40 text-white/60 hover:bg-hw-accent hover:text-white opacity-0 group-hover:opacity-100'
              }
            `}
            title={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
          >
            {wishlistPending
              ? <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
              : <Heart className="w-3.5 h-3.5" />
            }
          </button>
        )}

        {/* Car type badge removed - now shown next to name */}
      </div>

        {/* Info */}
        <div className="flex flex-col flex-1 p-3 gap-2">
          <div className="flex-1">
            <h3 className="font-semibold text-sm text-hw-text leading-tight line-clamp-2 flex items-center gap-1.5">
              {car.name}
              {car.series?.type === 'premium' && (
                <span className="text-[10px] font-bold px-1 py-0.5 rounded bg-amber-900/50 text-amber-300 border border-amber-700/30">
                  P
                </span>
              )}
              {car.car_type === 'collector' && (
                <span className="text-[10px] font-bold px-1 py-0.5 rounded bg-purple-900/50 text-purple-300 border border-purple-700/30">
                  C
                </span>
              )}
            </h3>
            {car.series && (
              <p className="text-xs text-hw-text-secondary mt-0.5 truncate">{car.series.name}</p>
            )}
          </div>

        {/* Meta row */}
        <div className="flex items-center gap-2 text-xs text-hw-muted">
          {car.year && <span>{car.year}</span>}
          {car.primary_color && (
            <span className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-1 ring-white/20"
                style={{ backgroundColor: car.primary_color.toLowerCase() }}
              />
              {car.primary_color}
            </span>
          )}
          {car.series_number && (
            <span className="ml-auto px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-200 text-[10px] font-mono font-semibold">
              #{car.series_number}
            </span>
          )}
        </div>

        {/* Action button */}
        {showActions && !isOwned && onAddToCollection && (
          <div className="flex gap-2 mt-1">
            <button
              onClick={(e) => { e.stopPropagation(); onAddToCollection(car) }}
              className="btn-primary text-xs py-1.5 flex-1 justify-center"
            >
              <Plus className="w-3.5 h-3.5" />
              Add to Collection
            </button>
          </div>
        )}

        {isOwned && (
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-hw-text-secondary">
              {collectionEntry!.carded ? 'Carded' : 'Loose'} · {collectionEntry!.condition}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
