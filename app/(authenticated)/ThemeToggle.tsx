'use client'

import { useEffect, useState } from 'react'

type ThemePreference = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'khata-theme'
const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

function normalizeTheme(value: string | null): ThemePreference {
  if (value === 'light' || value === 'dark' || value === 'system') return value
  return 'system'
}

function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference !== 'system') return preference
  if (typeof window.matchMedia !== 'function') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(preference: ThemePreference) {
  const resolved = resolveTheme(preference)
  document.documentElement.dataset.theme = resolved
  document.documentElement.dataset.themePreference = preference
  document.documentElement.style.colorScheme = resolved
  const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (themeMeta) themeMeta.content = resolved === 'dark' ? '#0b1120' : '#f5f6fa'
}

export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>('system')

  useEffect(() => {
    const stored = normalizeTheme(window.localStorage.getItem(STORAGE_KEY))
    setPreference(stored)
    applyTheme(stored)

    const media = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null
    const handleSystemChange = () => {
      const latest = normalizeTheme(window.localStorage.getItem(STORAGE_KEY))
      if (latest === 'system') applyTheme(latest)
    }

    media?.addEventListener('change', handleSystemChange)
    return () => media?.removeEventListener('change', handleSystemChange)
  }, [])

  function chooseTheme(nextPreference: ThemePreference) {
    window.localStorage.setItem(STORAGE_KEY, nextPreference)
    setPreference(nextPreference)
    applyTheme(nextPreference)
  }

  return (
    <div className="theme-toggle" role="group" aria-label="Theme">
      {THEME_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={preference === option.value ? 'active' : ''}
          aria-pressed={preference === option.value}
          onClick={() => chooseTheme(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
