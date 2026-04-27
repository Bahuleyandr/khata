'use client'

import { useEffect } from 'react'

/**
 * Registers /sw.js on first paint. Silently no-ops if the browser doesn't
 * support service workers (e.g., older WebViews or Telegram-Desktop's
 * embedded browser). Failure is logged to console but never surfaced to the
 * user — the app works fine without it; PWA install just won't be offered.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err)
    })
  }, [])
  return null
}
