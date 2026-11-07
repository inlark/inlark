import { fileURLToPath } from 'node:url'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
export default defineConfig({
  main: {
    build: {
      externalizeDeps: false,
      // dbus-next optionally uses native sockets and X11 discovery. Flatpak supplies
      // a Unix session-bus path; use its pure Node socket fallback in our bundle.
      commonjsOptions: { ignore: ['usocket', 'x11'] },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } },
    },
  },
  renderer: {
    resolve: { alias: { '@': fileURLToPath(new URL('./src/renderer/src', import.meta.url)) } },
    plugins: [react(), tailwindcss()],
    build: { minify: 'esbuild' },
  },
})
