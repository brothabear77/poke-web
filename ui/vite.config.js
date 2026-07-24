import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: "/poke-web/",
  server: {
    port: 8000,
    // Dev-only: proxy the coach's local-LLM calls to Ollama so the browser request is
    // same-origin (no CORS). The app posts to /local-llm/v1/... (see config.js LOCAL_LLM_URL).
    // This block is part of the dev server config and never ships in the production build.
    proxy: {
      "/local-llm": {
        target: "http://localhost:11434",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/local-llm/, ""),
      },
    },
  },
})
