import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/generate': 'http://localhost:8080',
      '/messages': 'http://localhost:8080',
      '/message': 'http://localhost:8080',
      '/health': 'http://localhost:8080',
    },
  },
});

