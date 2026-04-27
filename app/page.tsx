'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getMe } from '../lib/api'

export default function RootPage() {
  const router = useRouter()
  useEffect(() => {
    getMe()
      .then(() => router.replace('/dashboard'))
      .catch(() => router.replace('/login'))
  }, [router])
  return null
}
