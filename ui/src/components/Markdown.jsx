// Tiny, dependency-free Markdown renderer for the subset the AI coach emits:
// headings (#..######), bold/italic/inline-code, bullet + numbered lists, and
// paragraphs. Not a full CommonMark parser — deliberately small and safe (no
// dangerouslySetInnerHTML, no external deps). Anything it doesn't recognize
// renders as plain text, so unexpected output degrades gracefully.
import "./Markdown.css";

// Inline spans: **bold**, `code`, *italic* / _italic_. Bold is matched before
// italic in the alternation so "**x**" isn't mistaken for two italics.
const INLINE = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*\n]+)\*|_([^_\n]+)_)/g;

function renderInline(text) {
  const nodes = [];
  let last = 0;
  let key = 0;
  let m;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[2] != null) nodes.push(<strong key={key++}>{m[2]}</strong>);
    else if (m[3] != null) nodes.push(<code key={key++}>{m[3]}</code>);
    else nodes.push(<em key={key++}>{m[4] ?? m[5]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// Group raw lines into block descriptors (headings / lists / paragraphs).
function parseBlocks(src) {
  const lines = String(src || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let list = null;   // { type: "ul" | "ol", items: [] }
  let para = [];     // consecutive plain lines → one paragraph (line breaks kept)

  const flushPara = () => { if (para.length) { blocks.push({ type: "p", lines: para }); para = []; } };
  const flushList = () => { if (list) { blocks.push(list); list = null; } };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);

    if (heading) {
      flushPara(); flushList();
      blocks.push({ type: "h", level: Math.min(heading[1].length, 4), text: heading[2] });
    } else if (bullet) {
      flushPara();
      if (!list || list.type !== "ul") { flushList(); list = { type: "ul", items: [] }; }
      list.items.push(bullet[1]);
    } else if (numbered) {
      flushPara();
      if (!list || list.type !== "ol") { flushList(); list = { type: "ol", items: [] }; }
      list.items.push(numbered[1]);
    } else if (line.trim() === "") {
      flushPara(); flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara(); flushList();
  return blocks;
}

function withBreaks(lines) {
  return lines.flatMap((ln, i) => (i === 0 ? [renderInline(ln)] : [<br key={`br${i}`} />, renderInline(ln)]));
}

export default function Markdown({ text, className }) {
  const blocks = parseBlocks(text);
  return (
    <div className={`md${className ? ` ${className}` : ""}`}>
      {blocks.map((b, i) => {
        if (b.type === "h") return <div key={i} className={`md-h md-h${b.level}`}>{renderInline(b.text)}</div>;
        if (b.type === "ul") return <ul key={i} className="md-ul">{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ul>;
        if (b.type === "ol") return <ol key={i} className="md-ol">{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ol>;
        return <p key={i} className="md-p">{withBreaks(b.lines)}</p>;
      })}
    </div>
  );
}
