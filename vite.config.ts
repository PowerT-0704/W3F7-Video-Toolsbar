import { defineConfig } from 'vite'
import tailwind from '@tailwindcss/vite'

export default defineConfig({
  base: './',
  define: { 'import.meta.env.VITE_BUILT_AT': JSON.stringify(new Date().toISOString()) },
  plugins: [tailwind()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'motion', test: /[\\/]node_modules[\\/](?:motion|framer-motion|motion-dom|motion-utils)[\\/]/ }],
        },
      },
      onLog(level, log, original) {
        // The desktop renderer runs entirely on the client.
        if (log.code === 'MODULE_LEVEL_DIRECTIVE' && log.message.includes('"use client"')) return
        original(level, log)
      },
    },
  },
})
