import { useRef, useLayoutEffect } from "react";

export default function FitScale({ children }) {
  const outerRef = useRef(null);
  const innerRef = useRef(null);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    inner.style.transform = "none";
    outer.style.overflow = "";
    outer.style.height = "";

    const outerW = outer.clientWidth;
    const innerW = inner.scrollWidth;

    if (outerW > 0 && innerW > outerW) {
      const s = outerW / innerW;
      inner.style.transform = `scale(${s})`;
      outer.style.height = `${Math.ceil(inner.offsetHeight * s)}px`;
      outer.style.overflow = "hidden";
    }
  });

  return (
    <div ref={outerRef} style={{ display: "flex", justifyContent: "center" }}>
      <div ref={innerRef} style={{ transformOrigin: "top center", width: "max-content" }}>
        {children}
      </div>
    </div>
  );
}
