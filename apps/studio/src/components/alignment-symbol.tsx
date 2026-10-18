"use client";

/** Direction is legible at 17px; visible labels carry the command's meaning. */
export function AlignmentSymbol({ mode, vertical = false }: { mode: string; vertical?: boolean }) {
  const center = mode === "center" || mode === "middle",
    end = mode === "right" || mode === "bottom";
  const anchor = center ? 12 : end ? 20 : 4;
  return (
    <svg
      className="alignment-symbol"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
      style={vertical ? { transform: "rotate(90deg)" } : undefined}
    >
      <path d={`M${anchor} 3v18`} />
      <path
        d={
          center
            ? "M5 7h14M8 12h8M6 17h12"
            : end
              ? "M5 7h12M9 12h8M7 17h10"
              : "M7 7h12M7 12h8M7 17h10"
        }
      />
    </svg>
  );
}
