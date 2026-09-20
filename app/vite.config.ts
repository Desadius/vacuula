import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
    plugins: [react()],
    base: "/web/",
    server: {
        host: true,
        proxy: {
            '/api': { target: 'http://localhost', changeOrigin: true },
        },
    },
})
