import { useState, useEffect, useRef } from "react";
import Markdown from "./Markdown";

/**
 * Renders markdown text with a typewriter reveal — the content appears as if it
 * is being typed out, then formats normally once each token is complete. There
 * is intentionally no blinking cursor.
 *
 * The animation runs once per mount, revealing from empty up to the full text.
 * In this app each AI analysis / assistant chat message mounts fresh when it
 * arrives, so only the new message animates; earlier messages stay put.
 *
 * @param {string}  text     Full markdown string to reveal.
 * @param {boolean} [animate=true]  When false, renders the full text immediately.
 * @param {number}  [cps=120]       Reveal speed (characters/second).
 */
export default function TypedMarkdown({ text, className, animate = true, cps = 90 }) {
  const full = text || "";
  const [count, setCount] = useState(animate ? 0 : full.length);
  // Respect users who prefer reduced motion — show everything at once.
  const reduceMotion = typeof window !== "undefined"
    && window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const rafRef = useRef(0);

  useEffect(() => {
    if (!animate || reduceMotion || full.length === 0) {
      setCount(full.length);
      return;
    }
    setCount(0);
    const total = full.length;
    const begin = performance.now();
    const tick = (now) => {
      const revealed = Math.min(total, Math.floor(((now - begin) / 1000) * cps));
      setCount(revealed);
      if (revealed < total) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [full, animate, reduceMotion, cps]);

  return <Markdown className={className} text={full.slice(0, count)} />;
}
