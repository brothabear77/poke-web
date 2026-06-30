// Optional bring-your-own-key LLM client for the team coach.
//
// The site is a static GitHub Pages bundle with no backend and no place to hold
// a shared secret, so if a user wants free-form chat they supply their own API
// key. It's stored only in localStorage and used to call the provider directly
// from the browser. The rule-based coach (teamCoach.js) is the keyless default;
// this is a strictly optional upgrade.

const LS_KEY = "champions-coach-llm";

export const LLM_DEFAULTS = {
  proxy:     { model: "llama-3.3-70b-versatile", label: "Shared proxy (no key)" },
  groq:      { model: "llama-3.3-70b-versatile", label: "Groq (free)" },
  anthropic: { model: "claude-sonnet-4-6",       label: "Anthropic (Claude)" },
  openai:    { model: "gpt-4o",                   label: "OpenAI (GPT)" },
};

const DEFAULT_PROVIDER = "groq";

// Optional Groq key from ui/.env (exposed via vite envPrefix "GROQ_"). Used to
// autofill the key field when the user hasn't entered one of their own.
export const ENV_GROQ_KEY = import.meta.env.GROQ_KEY || "";

// Proxy URL (not a secret) baked in at build time so friends only enter the password.
export const ENV_PROXY_URL = import.meta.env.VITE_PROXY_URL || "";

export function loadLlmSettings() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      return {
        provider: DEFAULT_PROVIDER,
        apiKey: ENV_GROQ_KEY,
        model: LLM_DEFAULTS[DEFAULT_PROVIDER].model,
        proxyUrl: ENV_PROXY_URL,
        password: "",
        fromEnv: !!ENV_GROQ_KEY,
      };
    }
    const s = JSON.parse(raw);
    const provider = s.provider || DEFAULT_PROVIDER;
    const useEnv = !s.apiKey && provider === "groq" && !!ENV_GROQ_KEY;
    return {
      provider,
      apiKey: s.apiKey || (useEnv ? ENV_GROQ_KEY : ""),
      model: s.model || LLM_DEFAULTS[provider].model,
      proxyUrl: s.proxyUrl || ENV_PROXY_URL,
      password: s.password || "",
      fromEnv: useEnv,
    };
  } catch {
    return {
      provider: DEFAULT_PROVIDER,
      apiKey: ENV_GROQ_KEY,
      model: LLM_DEFAULTS[DEFAULT_PROVIDER].model,
      proxyUrl: ENV_PROXY_URL,
      password: "",
      fromEnv: !!ENV_GROQ_KEY,
    };
  }
}

export function saveLlmSettings(settings) {
  try {
    const { provider, apiKey, model, proxyUrl, password } = settings;
    localStorage.setItem(LS_KEY, JSON.stringify({ provider, apiKey, model, proxyUrl, password }));
  } catch { /* ignore quota/availability errors */ }
}

// Call the configured provider. `messages` is [{role:"user"|"assistant", content}].
// Returns the assistant text, or throws with a readable message.
export async function callLLM({ provider, apiKey, model, system, messages, proxyUrl, password }) {
  // Shared proxy: no API key in the browser; the server holds the real key.
  if (provider === "proxy") {
    if (!proxyUrl) throw new Error("No proxy URL configured.");
    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-app-password": password || "" },
      body: JSON.stringify({ model, messages: [{ role: "system", content: system }, ...messages] }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }

  if (!apiKey) throw new Error("No API key set.");

  if (provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model, max_tokens: 1024, system, messages }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    return data.content?.map((c) => c.text || "").join("") || "";
  }

  // Groq and OpenAI share the OpenAI chat-completions format; only the base URL differs.
  if (provider === "openai" || provider === "groq") {
    const url = provider === "groq"
      ? "https://api.groq.com/openai/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, ...messages],
      }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }

  throw new Error(`Unknown provider: ${provider}`);
}

async function readError(res) {
  try {
    const data = await res.json();
    return data.error?.message || `${res.status} ${res.statusText}`;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}
