import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Drive mode is loaded on demand, so the dev server would only find these when you
    // start driving, re-bundle its dependencies mid-session and break the page (two
    // copies of React). Listing them bundles them up front.
    include: [
      '@react-three/rapier',
      'three/examples/jsm/postprocessing/EffectComposer.js',
      'three/examples/jsm/postprocessing/OutputPass.js',
      'three/examples/jsm/postprocessing/RenderPass.js',
      'three/examples/jsm/postprocessing/ShaderPass.js',
    ],
  },
})
