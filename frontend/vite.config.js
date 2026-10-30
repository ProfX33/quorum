import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // listen on all interfaces so the app is reachable on the local network
    port: 3000,
    // a leading dot allows the domain and all its subdomains
    // .local: the Mac's Bonjour name (e.g. MarcBook-Air-96.local); .trycloudflare.com: new quick-tunnel URLs
    allowedHosts: ['.local', '.trycloudflare.com'],
    proxy: {
      '/api': process.env.API_PROXY ?? 'http://localhost:4000',
    },
  },
});
