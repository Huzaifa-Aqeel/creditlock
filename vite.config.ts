import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/frontend',
  base: './',
  build: {
    outDir: '../../static/frontend/dist',
    emptyOutDir: true,
  },
});
