import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Khi chạy local (npm run dev), mọi request /api sẽ được proxy sang
// dev API server (scripts/dev-api.mjs) ở cổng 3001.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
