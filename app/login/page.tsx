'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { postTelegramAuth } from '../../lib/api'
import { MiniAppAutoAuth } from './MiniAppAutoAuth'

declare global {
  interface Window {
    onTelegramAuth: (user: Record<string, string>) => void
  }
}

const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME ?? 'RaaReeRumBot'

export default function LoginPage() {
  const router = useRouter()
  const widgetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.onTelegramAuth = async (user) => {
      try {
        await postTelegramAuth(user)
        router.replace('/dashboard')
      } catch {
        alert('Login failed. You may not be an authorized user.')
      }
    }

    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.setAttribute('data-telegram-login', BOT_USERNAME)
    script.setAttribute('data-size', 'large')
    script.setAttribute('data-onauth', 'onTelegramAuth(user)')
    script.setAttribute('data-request-access', 'write')
    script.async = true

    if (widgetRef.current) {
      widgetRef.current.innerHTML = ''
      widgetRef.current.appendChild(script)
    }

    return () => {
      delete (window as Partial<Window>).onTelegramAuth
    }
  }, [router])

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Khata</h1>
        <p>Sign in with your Telegram account to view your expenses.</p>
        <MiniAppAutoAuth />
        <div ref={widgetRef} />
      </div>
    </div>
  )
}
