'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  getLedgers,
  getMe,
  getSelectedLedgerId,
  logout,
  setSelectedLedgerId,
  type Ledger,
  type Me,
} from '../../lib/api'
import { ThemeToggle } from './ThemeToggle'

function ledgerOptionLabel(ledger: Ledger, me: Me | null) {
  const isOwnPersonal = ledger.kind === 'personal' && ledger.owner_telegram_user_id === me?.telegram_user_id
  if (ledger.kind === 'household') return ledger.name === 'Household' ? 'Household' : `Household · ${ledger.name}`
  if (isOwnPersonal) return ledger.name === 'Personal' ? 'My Ledger' : `My Ledger · ${ledger.name}`
  return ledger.name === 'Personal' ? `Personal · ${ledger.owner_telegram_user_id}` : ledger.name
}

function ledgerContextLabel(me: Me) {
  const kind = me.selected_ledger_kind === 'household' ? 'Household' : 'Personal'
  const role = me.can_manage ? 'Owner' : 'Member'
  const access = me.can_add ? 'Can add' : 'View only'
  return `${kind} · ${role} · ${access}`
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [me, setMe] = useState<Me | null>(null)
  const [ledgers, setLedgers] = useState<Ledger[]>([])
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    async function loadSession(retried = false) {
      try {
        const [meRes, ledgerRes] = await Promise.all([getMe(), getLedgers()])
        setMe(meRes)
        setLedgers(ledgerRes.ledgers)
        setChecking(false)
      } catch (e) {
        const status = (e as { status?: number }).status
        if (!retried && status === 403 && getSelectedLedgerId() !== null) {
          setSelectedLedgerId(null)
          await loadSession(true)
          return
        }
        router.replace('/login')
      }
    }
    void loadSession()
  }, [router])

  async function handleLogout() {
    try {
      await logout()
    } finally {
      router.replace('/login')
    }
  }

  function handleLedgerChange(value: string) {
    const ledgerId = Number(value)
    setSelectedLedgerId(Number.isSafeInteger(ledgerId) ? ledgerId : null)
    window.location.reload()
  }

  if (checking) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="skeleton" style={{ width: 200, height: 24 }} />
      </div>
    )
  }

  return (
    <>
      <nav className="nav">
        <span className="brand">Khata</span>
        <Link href="/dashboard" className={pathname === '/dashboard' ? 'active' : ''}>Dashboard</Link>
        <Link href="/review" className={pathname === '/review' ? 'active' : ''}>Review</Link>
        <Link href="/transactions" className={pathname === '/transactions' ? 'active' : ''}>Transactions</Link>
        <Link href="/subscriptions" className={pathname === '/subscriptions' ? 'active' : ''}>Subscriptions</Link>
        <Link href="/receipts" className={pathname === '/receipts' ? 'active' : ''}>Receipts</Link>
        <Link href="/manage" className={pathname === '/manage' ? 'active' : ''}>Manage</Link>
        <select
          className="ledger-switcher"
          aria-label="Ledger"
          value={me?.selected_ledger_id ?? ''}
          onChange={(e) => handleLedgerChange(e.target.value)}
        >
          {ledgers.map((ledger) => (
            <option key={ledger.id} value={ledger.id}>
              {ledgerOptionLabel(ledger, me)}
            </option>
          ))}
        </select>
        {me ? <span className={`ledger-context-chip ${me.selected_ledger_kind}`}>{ledgerContextLabel(me)}</span> : null}
        <span className="nav-greeting">Hi, {me?.first_name}</span>
        <ThemeToggle />
        <button
          type="button"
          onClick={handleLogout}
          className="nav-button-danger"
        >
          Logout
        </button>
      </nav>
      {children}
    </>
  )
}
