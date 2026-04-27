'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { postTelegramWebApp } from '../../lib/api'

// Minimal subset of the Telegram WebApp SDK we touch. The real SDK exposes
// far more (BackButton, MainButton, themeParams, etc.); we add as we use.
declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string
        ready: () => void
        expand?: () => void
      }
    }
  }
}

const TELEGRAM_SCRIPT_SRC = 'https://telegram.org/js/telegram-web-app.js'

/**
 * Auto-signs the user in when the dashboard loads inside a Telegram Mini App
 * webview. Detection is the presence of `window.Telegram.WebApp.initData` —
 * regular browsers won't have it, so this component silently no-ops there
 * and the standard Telegram-Login widget below handles the flow.
 *
 * The SDK script is loaded from telegram.org regardless (it's tiny and
 * harmless on regular browsers — sets WebApp to a no-op stub).
 */
export function MiniAppAutoAuth() {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'authing' | 'failed'>('idle')

  useEffect(() => {
    let cancelled = false

    async function tryAuth() {
      const tg = window.Telegram?.WebApp
      if (!tg || !tg.initData) return // Not in a Mini App — let the widget take over.
      try {
        tg.ready()
        tg.expand?.()
      } catch {
        // ready/expand throw on the stub; harmless
      }
      if (cancelled) return
      setStatus('authing')
      try {
        await postTelegramWebApp(tg.initData)
        if (!cancelled) router.replace('/dashboard')
      } catch (err) {
        console.error('Mini App auth failed:', err)
        if (!cancelled) setStatus('failed')
      }
    }

    if (document.querySelector(`script[src="${TELEGRAM_SCRIPT_SRC}"]`)) {
      void tryAuth()
      return () => {
        cancelled = true
      }
    }
    const script = document.createElement('script')
    script.src = TELEGRAM_SCRIPT_SRC
    script.async = true
    script.onload = () => void tryAuth()
    document.head.appendChild(script)

    return () => {
      cancelled = true
    }
  }, [router])

  if (status === 'authing') {
    return <p style={{ color: '#6b7280', fontSize: '0.95rem' }}>Signing you in via Telegram…</p>
  }
  if (status === 'failed') {
    return (
      <p style={{ color: '#dc2626', fontSize: '0.95rem' }}>
        ⚠️ Mini App sign-in failed. Try the Telegram Login button below, or reopen the app
        from the bot.
      </p>
    )
  }
  return null
}
