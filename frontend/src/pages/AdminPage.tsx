import { useState, useEffect, useCallback, FormEvent } from 'react'
import {
  Shield, ShieldCheck, UserPlus, KeyRound, Mail, Check, X, Users as UsersIcon,
} from 'lucide-react'
import { PageSpinner } from '../components/Spinner'
import { useToastContext } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'
import {
  getUsers, createUser, setUserPassword, setUserAdmin, type ManagedUser,
} from '../lib/api'

const MIN_PASSWORD_LENGTH = 8

export function AdminPage() {
  const { user: currentUser } = useAuth()
  const { toast } = useToastContext()

  const [users, setUsers] = useState<ManagedUser[]>([])
  const [loading, setLoading] = useState(true)

  // New-user form
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [makeAdmin, setMakeAdmin] = useState(false)
  const [creating, setCreating] = useState(false)

  // Which user's password is being reset, and to what
  const [resettingId, setResettingId] = useState<string | null>(null)
  const [resetValue, setResetValue] = useState('')
  const [savingReset, setSavingReset] = useState(false)

  const load = useCallback(async () => {
    try {
      setUsers(await getUsers())
    } catch (err) {
      toast.error((err as Error).message || 'Could not load users')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < MIN_PASSWORD_LENGTH) {
      toast.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      return
    }
    setCreating(true)
    try {
      const created = await createUser(email.trim(), password, makeAdmin)
      setUsers((prev) => [...prev, created])
      setEmail('')
      setPassword('')
      setMakeAdmin(false)
      toast.success(`Created ${created.email}`)
    } catch (err) {
      toast.error((err as Error).message || 'Could not create the account')
    } finally {
      setCreating(false)
    }
  }

  const handleReset = async (userId: string) => {
    if (resetValue.length < MIN_PASSWORD_LENGTH) {
      toast.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      return
    }
    setSavingReset(true)
    try {
      await setUserPassword(userId, resetValue)
      setResettingId(null)
      setResetValue('')
      toast.success('Password updated')
    } catch (err) {
      toast.error((err as Error).message || 'Could not update the password')
    } finally {
      setSavingReset(false)
    }
  }

  const handleToggleAdmin = async (target: ManagedUser) => {
    try {
      const updated = await setUserAdmin(target.id, !target.is_admin)
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)))
      toast.success(
        updated.is_admin
          ? `${updated.email} is now an admin`
          : `Removed admin from ${updated.email}`
      )
    } catch (err) {
      toast.error((err as Error).message || 'Could not change admin access')
    }
  }

  if (loading) return <PageSpinner />

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-hw-text flex items-center gap-2">
          <Shield className="w-5 h-5 text-hw-accent" />
          User management
        </h1>
        <p className="text-sm text-hw-muted mt-1">
          Accounts that can sign in to the tracker. Each has its own collection
          and wishlist.
        </p>
      </div>

      {/* ── Create account ── */}
      <form onSubmit={handleCreate} className="card p-4 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-hw-text">
          <UserPlus className="w-4 h-4 text-hw-accent" />
          Add an account
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="new-email">Email</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-hw-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="new-email"
                type="email"
                required
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="someone@example.com"
                className="input-field pl-9"
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="new-password">Password</label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-hw-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="new-password"
                type="text"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                className="input-field pl-9"
              />
            </div>
            {/* Shown rather than masked: you have to relay it to the person, and
                there is no email delivery set up to send a reset link. */}
            <p className="text-[11px] text-hw-muted mt-1">
              Visible so you can pass it on — they can change it later.
            </p>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-hw-text-secondary cursor-pointer w-fit">
          <input
            type="checkbox"
            checked={makeAdmin}
            onChange={(e) => setMakeAdmin(e.target.checked)}
            className="accent-hw-accent w-4 h-4"
          />
          Give this account admin access
        </label>

        <button type="submit" disabled={creating} className="btn-primary">
          {creating ? 'Creating…' : 'Create account'}
        </button>
      </form>

      {/* ── Existing accounts ── */}
      <div className="card divide-y divide-hw-border">
        <div className="flex items-center gap-2 text-sm font-semibold text-hw-text p-4">
          <UsersIcon className="w-4 h-4 text-hw-accent" />
          {users.length} {users.length === 1 ? 'account' : 'accounts'}
        </div>

        {users.map((u) => {
          const isSelf = u.id === currentUser?.id
          return (
            <div key={u.id} className="p-4 space-y-3">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="w-9 h-9 rounded-full bg-hw-accent flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-white">
                    {u.email.charAt(0).toUpperCase()}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-hw-text truncate">
                      {u.email}
                    </span>
                    {u.is_admin && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border border-hw-accent/30 bg-hw-accent/15 text-hw-accent">
                        <ShieldCheck className="w-3 h-3" />
                        Admin
                      </span>
                    )}
                    {isSelf && (
                      <span className="text-[10px] text-hw-muted uppercase tracking-wide">
                        you
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-hw-muted mt-0.5">
                    {u.collection_count} in collection · {u.wishlist_count} on wishlist
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setResettingId(resettingId === u.id ? null : u.id)
                      setResetValue('')
                    }}
                    className="btn-secondary text-sm py-1.5 px-3"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    Password
                  </button>
                  <button
                    onClick={() => handleToggleAdmin(u)}
                    disabled={isSelf && u.is_admin}
                    title={
                      isSelf && u.is_admin
                        ? "You can't remove your own admin access"
                        : undefined
                    }
                    className="btn-secondary text-sm py-1.5 px-3"
                  >
                    {u.is_admin ? 'Remove admin' : 'Make admin'}
                  </button>
                </div>
              </div>

              {resettingId === u.id && (
                <div className="flex items-center gap-2 flex-wrap pl-12 animate-fade-in">
                  <input
                    type="text"
                    autoFocus
                    value={resetValue}
                    onChange={(e) => setResetValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleReset(u.id)
                      if (e.key === 'Escape') setResettingId(null)
                    }}
                    placeholder={`New password (min ${MIN_PASSWORD_LENGTH})`}
                    className="input-field flex-1 min-w-[200px]"
                  />
                  <button
                    onClick={() => handleReset(u.id)}
                    disabled={savingReset}
                    className="btn-primary text-sm py-1.5 px-3"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {savingReset ? 'Saving…' : 'Set'}
                  </button>
                  <button
                    onClick={() => setResettingId(null)}
                    className="btn-secondary text-sm py-1.5 px-3"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-xs text-hw-muted">
        Deleting accounts isn't available here on purpose — removing a user also
        removes their whole collection. Do that deliberately from the database if
        you ever need to.
      </p>
    </div>
  )
}
