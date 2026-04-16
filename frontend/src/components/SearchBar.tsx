import React, { useCallback } from 'react'
import { Search, X } from 'lucide-react'
import { useSearch } from '../contexts/SearchContext'

interface SearchBarProps {
  placeholder?: string
  className?: string
}

export function SearchBar({ placeholder = 'Search cars, series…', className = '' }: SearchBarProps) {
  const { searchQuery, setSearchQuery, clearSearch } = useSearch()

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value)
    },
    [setSearchQuery]
  )

  return (
    <div className={`relative flex items-center ${className}`}>
      <Search className="absolute left-3 w-4 h-4 text-hw-muted pointer-events-none" />
      <input
        type="text"
        value={searchQuery}
        onChange={handleChange}
        placeholder={placeholder}
        className="
          input-field pl-9 pr-9 py-2
          focus:border-hw-accent
          transition-all duration-200
        "
      />
      {searchQuery && (
        <button
          onClick={clearSearch}
          className="absolute right-3 text-hw-muted hover:text-hw-text transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
