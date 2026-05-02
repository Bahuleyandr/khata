'use client'

import { useEffect, useRef, useState } from 'react'
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
  const [loginError, setLoginError] = useState<{ message: string; telegramUserId?: number } | null>(null)

  useEffect(() => {
    window.onTelegramAuth = async (user) => {
      try {
        setLoginError(null)
        await postTelegramAuth(user)
        router.replace('/dashboard')
      } catch (e) {
        const error = e as Error & { data?: { telegram_user_id?: number } }
        setLoginError({
          message: error.message || 'Login failed.',
          telegramUserId: error.data?.telegram_user_id,
        })
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
        {loginError ? (
          <div className="login-error" role="alert">
            <strong>{loginError.message}</strong>
            {loginError.telegramUserId ? (
              <span>Share this Telegram ID with the Khata owner: {loginError.telegramUserId}</span>
            ) : (
              <span>Ask the Khata owner to add your Telegram account from Manage.</span>
            )}
          </div>
        ) : null}
        <div ref={widgetRef} />
      </div>
    </div>
  )
}
