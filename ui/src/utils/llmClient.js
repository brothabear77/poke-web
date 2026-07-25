// Team-coach LLM client.
//
// The coach talks to a shared AWS Lambda proxy that holds the LLM provider key
// server-side (the poke-llm-proxy Lambda repo — the chat branch forwards to
// Google Gemini's OpenAI-compatible endpoint). The browser authenticates with a
// shared password the user enters ONCE via the coach login — it's kept in
// localStorage and never shipped in the bundle. With no valid password the coach
// falls back to the keyless rule-based report (teamCoach.js).

import { PROXY_URL, COACH_LOCAL, LOCAL_LLM_URL, LOCAL_LLM_MODEL } from "../config.js";
import { logger } from "./logger.js";

const LS_PASSWORD = "champions-coach-password";

// Model the proxy forwards to (Gemini via its OpenAI-compatible endpoint). Fixed —
// there is no user-facing model choice. Use a *-flash-lite variant: the heavier
// "thinking" models (e.g. gemini-3.5-flash) do enough internal reasoning on the
// coach's ~6K-token grounding prompt to exceed the Lambda timeout and 502. Flash-lite
// still reasons well above the old Llama 3.3 70B. (gemini-2.5-flash is unavailable to
// newer API keys, hence the 3.x line.)
export const COACH_MODEL = "gemini-3.1-flash-lite";

export function loadPassword() {
  try { return localStorage.getItem(LS_PASSWORD) || ""; } catch { return ""; }
}
export function savePassword(pw) {
  try { localStorage.setItem(LS_PASSWORD, pw); } catch { /* ignore quota/availability */ }
}
export function clearPassword() {
  try { localStorage.removeItem(LS_PASSWORD); } catch { /* ignore */ }
}

// Call the coach through the proxy. Returns the assistant text, or throws. The
// thrown Error carries a `.status` so callers can tell a bad password (401) —
// which should bounce the user back to the login — from other failures, which
// fall back to the rule-based report.
export async function callCoach({ system, messages, password }) {
  // In local dev mode the request goes straight to Ollama (via the Vite proxy) with no auth;
  // otherwise to the Gemini proxy with the shared password. Both speak OpenAI chat-completions,
  // so only the endpoint/model/headers differ — the response parsing below is identical.
  const url = COACH_LOCAL ? LOCAL_LLM_URL : PROXY_URL;
  if (!url) throw new Error("No LLM endpoint configured.");

  const body = {
    model: COACH_LOCAL ? LOCAL_LLM_MODEL : COACH_MODEL,
    messages: [{ role: "system", content: system }, ...messages],
    // Low temperature ONLY in local mode: the coach's turn-by-turn output has a rigid structure
    // (per-lead-pair, per-turn, per-active, favorable/unfavorable) that a small local model drifts
    // off under default sampling. The proxy strips any field but model/messages before forwarding
    // to Gemini, so this has no effect on production — scoped here deliberately, not a limitation.
    ...(COACH_LOCAL ? { temperature: 0.2 } : {}),
  };
  const headers = { "content-type": "application/json" };
  if (!COACH_LOCAL) headers["x-app-password"] = password || "";

  logger.group("callCoach → " + (COACH_LOCAL ? "local LLM" : "proxy"));
  logger.info("URL:", url);
  logger.info("Model:", body.model);
  logger.info("Messages:", body.messages.length, "(system + history)");
  logger.info("Password set:", COACH_LOCAL ? "(local, n/a)" : !!password);
  logger.groupEnd();

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (fetchErr) {
    logger.error("Fetch failed (likely CORS or network):", fetchErr.message);
    throw fetchErr;
  }

  logger.info("Response status:", res.status, res.statusText);
  if (!res.ok) {
    const msg = await readError(res);
    logger.error("Error response:", msg); // full provider text stays in the console
    const err = new Error(friendlyError(res.status, msg));
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  logger.info("Reply length:", data.choices?.[0]?.message?.content?.length ?? 0);
  return data.choices?.[0]?.message?.content || "";
}

// Embed a query string through the proxy's embed branch (Voyage, server-side key).
// Mirrors callCoach's auth/error contract: returns the vector, or throws with a
// `.status` (so a 401 bounces to the login like callCoach). Used by the knowledge
// retrieval layer; callers treat any failure as "no retrieval" and fall back.
export async function embedQuery({ input, password }) {
  if (!PROXY_URL) throw new Error("No proxy URL configured.");

  let res;
  try {
    res = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-app-password": password || "" },
      body: JSON.stringify({ type: "embed", input }),
    });
  } catch (fetchErr) {
    logger.error("Embed fetch failed (likely CORS or network):", fetchErr.message);
    throw fetchErr;
  }

  if (!res.ok) {
    const msg = await readError(res);
    logger.error("Embed error response:", msg);
    const err = new Error(friendlyError(res.status, msg));
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  // Voyage response: { data: [{ embedding: [...], index: 0 }], ... }
  const vector = data.data?.[0]?.embedding || null;
  logger.info("Embed vector dims:", vector?.length ?? 0);
  return vector;
}

// Turn a provider's (often verbose) error into a short, user-facing message.
function friendlyError(status, msg) {
  if (status === 429) {
    const m = /try again in ([\d.]+)\s*s/i.exec(msg || "");
    return m
      ? `Rate limit reached — retry in ~${Math.ceil(parseFloat(m[1]))}s.`
      : "Rate limit reached — try again shortly.";
  }
  if (status === 401) return "Unauthorized";
  if (status >= 500) return "Coach service error — try again.";
  return msg || `Request failed (${status}).`;
}

async function readError(res) {
  try {
    const data = await res.json();
    return data.error?.message || `${res.status} ${res.statusText}`;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}
