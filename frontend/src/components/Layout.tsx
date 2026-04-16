import { useState } from 'react'
import { NavLink, useNavigate, Outlet } from 'react-router-dom'
import {
  LayoutGrid,
  Library,
  Heart,
  BarChart3,
  LogOut,
  Flame,
  Menu,
  X,
  Sun,
  Moon,
  Compass,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { SearchBar } from './SearchBar'
import { useSearch } from '../contexts/SearchContext'

const navItems = [
  { to: '/collection', label: 'Collection', icon: LayoutGrid },
  { to: '/all-cars', label: 'All Cars', icon: Library },
  { to: '/discover', label: 'Discover', icon: Compass },
  { to: '/wishlist', label: 'Wishlist', icon: Heart },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
]

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{
          background: 'linear-gradient(135deg, #f97316, #dc2626)',
          boxShadow: '0 2px 8px rgba(249,115,22,0.45)',
        }}
      >
        <Flame className="w-4 h-4 text-white" />
      </div>
      <div>
        <span className="font-bold text-sm tracking-tight block leading-none">
          <span className="text-hw-accent">HOT</span>
          <span className="text-hw-text"> WHEELS</span>
        </span>
        <span className="text-[10px] text-hw-muted font-medium tracking-widest uppercase">Tracker</span>
      </div>
    </div>
  )
}

export function Layout() {
  const { user, signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const { clearSearch } = useSearch()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const handleNavClick = () => {
    clearSearch()
    setMobileMenuOpen(false)
  }

  const userInitial = user?.email?.charAt(0).toUpperCase() ?? 'U'
  const userEmail = user?.email ?? ''

  const ThemeToggle = () => (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-lg hover:bg-hw-surface-hover text-hw-muted hover:text-hw-text transition-all"
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  )

  return (
    <div className="flex h-screen bg-hw-bg overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-60 bg-hw-surface border-r border-hw-border flex-shrink-0">
        <div className="px-4 py-5 border-b border-hw-border">
          <Logo />
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={handleNavClick}
              className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-hw-border space-y-1">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-7 h-7 rounded-full bg-hw-accent flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-white">{userInitial}</span>
            </div>
            <span className="text-xs text-hw-text-secondary truncate flex-1">{userEmail}</span>
          </div>
          <div className="flex items-center gap-1 px-1">
            <ThemeToggle />
            <button
              onClick={handleSignOut}
              className="nav-link flex-1 hover:text-red-400"
            >
              <LogOut className="w-4 h-4 flex-shrink-0" />
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center gap-3 px-4 py-3 border-b border-hw-border bg-hw-surface flex-shrink-0 z-10">
          <button
            className="md:hidden text-hw-muted hover:text-hw-text transition-colors p-1"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <div className="md:hidden">
            <Logo />
          </div>

          <SearchBar className="flex-1 max-w-lg" />

          {/* Mobile-only: theme toggle in header */}
          <div className="flex items-center gap-1 ml-auto md:hidden">
            <ThemeToggle />
          </div>
        </header>

        {/* Mobile menu overlay */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setMobileMenuOpen(false)}>
            <div
              className="absolute left-0 top-0 h-full w-64 bg-hw-surface border-r border-hw-border flex flex-col animate-fade-in"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 py-5 border-b border-hw-border flex items-center justify-between">
                <Logo />
                <button onClick={() => setMobileMenuOpen(false)} className="text-hw-muted hover:text-hw-text transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav className="flex-1 px-3 py-4 space-y-0.5">
                {navItems.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    onClick={handleNavClick}
                    className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    {label}
                  </NavLink>
                ))}
              </nav>
              <div className="px-3 py-4 border-t border-hw-border space-y-1">
                <div className="flex items-center gap-3 px-3 py-2">
                  <div className="w-7 h-7 rounded-full bg-hw-accent flex items-center justify-center">
                    <span className="text-xs font-bold text-white">{userInitial}</span>
                  </div>
                  <span className="text-xs text-hw-text-secondary truncate">{userEmail}</span>
                </div>
                <div className="flex items-center gap-1 px-1">
                  <ThemeToggle />
                  <button onClick={handleSignOut} className="nav-link flex-1 hover:text-red-400">
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>

        {/* Bottom nav (mobile) — main items only */}
        <nav className="md:hidden flex items-center justify-around border-t border-hw-border bg-hw-surface px-2 py-2 flex-shrink-0">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={clearSearch}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 px-3 py-1 rounded-lg transition-colors
                 ${isActive ? 'text-hw-accent' : 'text-hw-muted hover:text-hw-text'}`
              }
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  )
}
