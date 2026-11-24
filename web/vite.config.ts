import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  base: './',
  build: {
    outDir: path.resolve(__dirname, '../docs'),
    emptyOutDir: true
  }
});
