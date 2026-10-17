import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

import fs from 'fs';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'github-pages-fallback',
      closeBundle() {
        const distDir = path.resolve('dist');
        const indexPath = path.join(distDir, 'index.html');
        const fallbackPath = path.join(distDir, '404.html');
        if (fs.existsSync(indexPath)) {
          fs.copyFileSync(indexPath, fallbackPath);
        }
      },
    },
  ],
  server: {
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
