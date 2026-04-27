import type { MetadataRoute } from 'next'

// Required by `output: 'export'` — without this, Next refuses to bake the
// manifest route into a static file at build time.
export const dynamic = 'force-static'

// Web App Manifest — makes the dashboard installable as a PWA on iOS Safari,
// Android Chrome, and desktop Chromium. With `output: 'export'`, Next emits
// this as a static `/manifest.webmanifest` file at build time.
//
// `start_url: '/'` lets the root page handle the auth-redirect dance; an
// unauthed launch lands on /login, an authed launch on /dashboard.
//
// SVG icon (`purpose: 'any maskable'`) renders correctly in both circular
// (Android) and rounded-rectangle (iOS) masks because the ₹ glyph sits well
// inside the 80% safe zone.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Khata — Personal Expense Tracker',
    short_name: 'Khata',
    description: 'Capture and review household spending. India-first, single-couple.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#1f2937',
    theme_color: '#1f2937',
    // Two entries — Next's typed manifest doesn't accept the space-separated
    // 'any maskable' purpose, so we list each role explicitly. Same SVG file,
    // different consumer roles. The ₹ glyph sits well inside the 80% safe
    // zone, so the maskable render works in both circular (Android) and
    // squircle (iOS) crops.
    icons: [
      {
        src: '/icons/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icons/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  }
}
