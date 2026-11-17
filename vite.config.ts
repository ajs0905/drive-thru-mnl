import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { fiberClock } from './tools/fiberClock.ts'
import { rapierInit } from './tools/rapierInit.ts'

/** The version in package.json, shown on the main menu (src/ui/version.ts). */
const version: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

// https://vite.dev/config/
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  // Two dependencies call APIs that are deprecated: React Three Fiber creates a THREE.Clock
  // (fiberClock swaps in a Timer-based clock) and Rapier 0.19 starts its WebAssembly the old
  // way (rapierInit makes the call the current way). See ADR 0031.
  plugins: [react(), fiberClock(), rapierInit()],
  optimizeDeps: {
    // Drive mode is loaded on demand, so the dev server would only find these when you
    // start driving, re-bundle its dependencies mid-session and break the page (two
    // copies of React). Listing them bundles them up front.
    include: ['@react-three/rapier'],
    // The same swap in the dependencies the dev server pre-bundles (plugins above don't run there).
    rolldownOptions: { plugins: [fiberClock(), rapierInit()] },
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
    // Tests load Rapier straight from node_modules, which Vitest normally hands to Node
    // untouched: inlined, it gets the rapierInit fix like the game does.
    server: { deps: { inline: ['@dimforge/rapier3d-compat'] } },
    // Any deprecation warning while a test file runs fails it (ADR 0031, ADR 0033).
    setupFiles: ['tests/setup/noDeprecations.ts'],
  },
})
