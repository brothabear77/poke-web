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
 * @param {number}  [cps=300]       Reveal speed (characters/second).
 * @param {boolean} [autoScroll=false]  Keep the scroll container pinned to the
 *   bottom as text is revealed. In this mode the `className` element becomes the
 *   scroll container (give it overflow/max-height). Following pauses if the user
 *   scrolls up, and resumes when they scroll back to the bottom.
 */
export default function TypedMarkdown({ text, className, animate = true, cps = 300, autoScroll = false }) {
  const full = text || "";
  const [count, setCount] = useState(animate ? 0 : full.length);
  // Respect users who prefer reduced motion — show everything at once.
  const reduceMotion = typeof window !== "undefined"
    && window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const rafRef = useRef(0);
  const scrollRef = useRef(null);
  const stickRef = useRef(true); // whether we're still following the bottom

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

  // Follow the growing text: pin the scroll container to its bottom on each
  // reveal, unless the user has scrolled up to read earlier content.
  useEffect(() => {
    if (!autoScroll || !animate || reduceMotion) return;
    const el = scrollRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [count, autoScroll, animate, reduceMotion]);

  // Detect manual scroll-up to pause following; resume once back near the bottom.
  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 24;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [autoScroll]);

  const shown = full.slice(0, count);
  if (!autoScroll) return <Markdown className={className} text={shown} />;
  return (
    <div className={className} ref={scrollRef}>
      <Markdown text={shown} />
    </div>
  );
}
