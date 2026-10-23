import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

import fs from 'fs';
import path from 'path';

export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? (process.env.VITE_BASE_PATH || './') : '/',
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'github-pages-setup',
      closeBundle() {
        const distDir = path.resolve('dist');
        const indexPath = path.join(distDir, 'index.html');
        const fallbackPath = path.join(distDir, '404.html');
        const nojekyllPath = path.join(distDir, '.nojekyll');

        // Create .nojekyll to disable Jekyll on GitHub Pages
        fs.writeFileSync(nojekyllPath, '');

        // Generate 404.html fallback for GitHub Pages SPA routing
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
