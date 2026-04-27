'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { getMe, type Me } from '../../lib/api'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [me, setMe] = useState<Me | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    getMe()
      .then((data) => {
        setMe(data)
        setChecking(false)
      })
      .catch(() => {
        router.replace('/login')
      })
  }, [router])

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
        <Link href="/transactions" className={pathname === '/transactions' ? 'active' : ''}>Transactions</Link>
        <Link href="/receipts" className={pathname === '/receipts' ? 'active' : ''}>Receipts</Link>
        <span style={{ fontSize: '0.85rem', color: '#9ca3af' }}>Hi, {me?.first_name}</span>
        <Link href="/login" style={{ fontSize: '0.8rem', color: '#ef4444' }}>Logout</Link>
      </nav>
      {children}
    </>
  )
}
