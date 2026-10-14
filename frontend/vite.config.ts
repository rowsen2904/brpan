import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [react()],
    resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
    server: {
        port: 5173,
        proxy: {
            '/api': 'http://127.0.0.1:3111',
            '/sub': {
                target: 'http://127.0.0.1:3111',
                bypass: (req) => (req.headers.accept?.includes('text/html') ? '/index.html' : undefined),
            },
        },
    },
    build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
});
