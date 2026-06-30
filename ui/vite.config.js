import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: "/poke-web/",
  // Expose GROQ_* (in addition to the default VITE_*) so the team-builder coach
  // can autofill the Groq key from ui/.env. NOTE: anything exposed here is baked
  // into the built bundle — fine for local use, but don't deploy a build that
  // embeds a real key publicly. .env is gitignored.
  envPrefix: ["VITE_", "GROQ_"],
  server: {
    port: 8000,
  },
})
