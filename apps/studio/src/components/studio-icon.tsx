const paths = {
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  copy: "M9 9h11v11H9zM5 15H3V3h12v2",
  paste: "M9 4H5v17h14V4h-4M9 2h6v5H9z",
  lock: "M5 10h14v11H5zM8 10V7a4 4 0 0 1 8 0v3",
  unlock: "M5 10h14v11H5zM8 10V7a4 4 0 0 1 8 0",
  undo: "M8 4 3 9l5 5M3 9h11a6 6 0 0 1 0 12",
  redo: "m16 4 5 5-5 5M21 9H10a6 6 0 0 0 0 12",
  duplicate: "M9 9h12v12H9zM5 15H3V3h12v2M15 12v6M12 15h6",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  text: "M4 4h16M12 4v16M8 20h8",
  eye: "M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Zm13 0a3 3 0 1 0-6 0 3 3 0 0 0 6 0",
  sequence: "M3 3h5v7H3zM3 14h5v7H3zM12 5h9M12 8h6M12 16h9M12 19h6",
  more: "M4 12h.01M12 12h.01M20 12h.01",
  check: "m5 12 4 4L19 6",
  chevron: "m7 10 5 5 5-5",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  close: "m6 6 12 12M6 18 18 6",
  export: "M12 15V3m-5 5 5-5 5 5M4 13v8h16v-8",
  chat: "M4 4h16v12H9l-5 4V4Z",
  stop: "M6 6h12v12H6z",
} as const;

/** Shared, optically balanced symbols for Studio controls. */
export function StudioIcon({ name, rotate = 0 }: { name: keyof typeof paths; rotate?: number }) {
  return (
    <svg
      className="studio-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" ? 4 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={rotate ? { transform: `rotate(${rotate}deg)` } : undefined}
    >
      <path d={paths[name]} />
    </svg>
  );
}
