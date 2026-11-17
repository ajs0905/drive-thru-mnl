import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Drive mode is loaded on demand, so the dev server would only find these when you
    // start driving, re-bundle its dependencies mid-session and break the page (two
    // copies of React). Listing them bundles them up front.
    include: ['@react-three/rapier'],
  },
  build: {
    // Vite warns past 500 kB, a rule of thumb for websites; a 3D game's main and Drive
    // chunks are past it by design. Their real limits are the gzipped budgets in
    // tools/bundleBudget.ts (npm run size); this only flags a chunk far past those.
    chunkSizeWarningLimit: 2600,
    // No source maps in the published build (Vite's default, stated so it stays that way).
    sourcemap: false,
  },
  test: {
    // Some tests drive minutes of traffic or physics on the real map: a few seconds each on
    // the development laptop, more on a slower or busier machine. The default 5 s is too tight.
    testTimeout: 30_000,
  },
})
