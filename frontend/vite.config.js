import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // listen on all interfaces so the app is reachable on the local network
    allowedHosts: ['.local'], // accept the Mac's Bonjour name (e.g. MarcBook-Air-96.local) as well as the LAN IP
    port: 3000,
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
