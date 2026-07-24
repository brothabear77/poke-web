export const PROXY_URL = "https://ytb76gixezqtmqzn44la67og3e0vonzu.lambda-url.us-east-1.on.aws/";

// Local-LLM dev mode: in `npm run dev` the coach calls a free local model (Ollama) instead of
// the Gemini proxy — no tokens, no password. Production builds (`import.meta.env.DEV` false) can
// never enable this, so they always use PROXY_URL. Escape hatch: set VITE_COACH_PROXY=1 in
// ui/.env.local to force the real proxy in dev (then the normal password login applies).
export const COACH_LOCAL = import.meta.env.DEV && import.meta.env.VITE_COACH_PROXY !== "1";
// Routed through the Vite dev proxy (see vite.config.js) so the browser call is same-origin — no
// CORS, no Ollama env tweaks. Maps to http://localhost:11434/v1/chat/completions.
export const LOCAL_LLM_URL = "/local-llm/v1/chat/completions";
export const LOCAL_LLM_MODEL = "qwen2.5:7b";

// Base URL for the poke-smogon-data feed (normalized Smogon Champions stats). Same-origin in
// production (both are brothabear77.github.io); in dev it fetches the live Pages site.
export const SMOGON_DATA_BASE = "https://brothabear77.github.io/poke-smogon-data/data";
