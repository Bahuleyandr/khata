// Flat ESLint config for the Next.js frontend. `next lint` was removed in
// Next 16, so ESLint runs directly (see the "lint" script) using
// eslint-config-next's flat-native exports — no more FlatCompat shim
// (audit follow-up: eslint 10 + next 16 migration).
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

const eslintConfig = [
  { ignores: ['.next/**', 'out/**', 'output/**', 'node_modules/**'] },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // Next 16's config promotes react-hooks/set-state-in-effect to an error.
    // Our URL/query-string -> state sync effects (transactions/receipts pages)
    // are intentional and predate next 16, so keep this a warning rather than a
    // build blocker. Revisit if those effects are refactored to derived state.
    rules: { 'react-hooks/set-state-in-effect': 'warn' },
  },
]

export default eslintConfig
