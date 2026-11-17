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
  test: {
    // Some tests drive minutes of traffic or physics on the real map: a few seconds each on
    // the development laptop, more on a slower or busier machine. The default 5 s is too tight.
    testTimeout: 30_000,
  },
})
