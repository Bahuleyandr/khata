import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Khata',
  description: 'Khata — personal expense tracker',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
