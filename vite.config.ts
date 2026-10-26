import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset paths so the build works from any URL, e.g. GitLab Pages at /group/project/.
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 4000 },
  test: { environment: 'node' },
});
