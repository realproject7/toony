// The one icon set for the human workspace: 24-unit outline glyphs drawn with
// the current text color. Inline controls use 16 px, the rail 20 px.

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
  grip: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  check: "m5 12 4 4L19 6",
  chevron: "m7 10 5 5 5-5",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  close: "m6 6 12 12M6 18 18 6",
  export: "M12 15V3m-5 5 5-5 5 5M4 13v8h16v-8",
  download: "M12 3v12m-5-5 5 5 5-5M4 13v8h16v-8",
  upload: "M12 16V4m-5 5 5-5 5 5M4 20h16",
  chat: "M4 4h16v12H9l-5 4V4Z",
  stop: "M6 6h12v12H6z",
  library: "M4 4h6v16H4zM14 4h6v16h-6z",
  story: "M5 3h14v18H5zM8 7h8M8 11h8M8 15h5",
  characters: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21v-2a8 6 0 0 1 16 0v2",
  episodes: "M3 4h18v6H3zM3 14h18v6H3z",
  settings: "M4 7h16M4 17h16M9 4v6M15 14v6",
  image: "M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 9.5h.01",
  pencil: "M4 20h4L19 9l-4-4L4 16v4ZM13 7l4 4",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14A8.5 8.5 0 0 1 10 4a8.5 8.5 0 1 0 10 10Z",
  monitor: "M3 4h18v12H3zM8 20h8M12 16v4",
  alert: "M12 3 2 20h20L12 3ZM12 10v4M12 17h.01",
  folder: "M3 6h6l2 2h10v11H3z",
  reload: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  star: "m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z",
} as const;

export type StudioIconName = keyof typeof paths;

const DOTS = new Set<StudioIconName>(["more", "grip"]);

/** Shared, optically balanced symbols for Studio controls. */
export function StudioIcon({
  name,
  rotate = 0,
  size = 16,
}: {
  name: StudioIconName;
  rotate?: number;
  size?: 16 | 20;
}) {
  return (
    <svg
      className="studio-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={DOTS.has(name) ? 4 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={rotate ? { transform: `rotate(${rotate}deg)` } : undefined}
    >
      <path d={paths[name]} />
    </svg>
  );
}
