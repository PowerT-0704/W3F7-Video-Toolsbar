import { defineConfig } from 'vite'
import tailwind from '@tailwindcss/vite'

export default defineConfig({
  base: './',
  plugins: [tailwind()],
  build: {
    rolldownOptions: {
      onLog(level, log, original) {
        // The desktop renderer runs entirely on the client.
        if (log.code === 'MODULE_LEVEL_DIRECTIVE' && log.message.includes('"use client"')) return
        original(level, log)
      },
    },
  },
})
