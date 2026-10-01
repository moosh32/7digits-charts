import { defineConfig } from 'vite';

export default defineConfig({
    root: 'public',
    build: { outDir: '../dist', emptyOutDir: true },
    server: { proxy: { '/api': 'http://localhost:3000' } },
});
