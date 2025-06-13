import { defineConfig } from 'vitest/config';
import { unctxPlugin } from 'unctx/plugin';

export default defineConfig({
  plugins: [
    unctxPlugin.vite({
      // Start with minimal/default config; add options if needed
      // e.g., you might need to explicitly tell it to transform your 'run', 'provide'
      // if they are not automatically detected by unctx's heuristics.
      asyncFunctions: ['run', 'provide', '_INTERNAL_runImpl', '_INTERNAL_provideImpl'] // Example
    }),
  ],
  test: {
    environment: 'node', 
    globals: true,   
    server: {
      deps: {
        external: ['node:async_hooks']
      }
    }
  }
})