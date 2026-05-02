import type { Metadata, Viewport } from 'next'
import './globals.css'
import { ServiceWorkerRegister } from './ServiceWorkerRegister'

const themeInitScript = `
(function () {
  try {
    var key = 'khata-theme';
    var preference = localStorage.getItem(key) || 'system';
    if (preference !== 'system' && preference !== 'light' && preference !== 'dark') {
      preference = 'system';
    }
    var darkQuery = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    var resolved = preference === 'system' ? (darkQuery && darkQuery.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePreference = preference;
    document.documentElement.style.colorScheme = resolved;
    var themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute('content', resolved === 'dark' ? '#0b1120' : '#f5f6fa');
    }
  } catch (error) {
    document.documentElement.dataset.theme = 'light';
    document.documentElement.dataset.themePreference = 'system';
  }
})();
`

export const metadata: Metadata = {
  title: 'Khata',
  description: 'Khata — personal expense tracker',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Khata',
  },
  icons: {
    icon: '/icons/icon.svg',
    apple: '/icons/icon.svg',
  },
}

export const viewport: Viewport = {
  themeColor: '#f5f6fa',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  )
}
