import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset paths so the build works from any URL, e.g. GitLab Pages at /group/project/.
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        // Vendor code changes rarely, so give it stable chunks: a new deploy then only re-downloads the app chunk.
        // The learnsets data keeps its own on-demand chunk, so it is left out of the Pokémon data chunk.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('learnsets')) return undefined;
          if (id.includes('@smogon/calc')) return 'vendor-calc';
          if (id.includes('@pkmn/')) return 'vendor-pkmn';
          if (id.includes('react')) return 'vendor-react';
          return undefined;
        },
      },
    },
  },
  // Unit tests only; the browser tests in e2e/ run with Playwright.
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
