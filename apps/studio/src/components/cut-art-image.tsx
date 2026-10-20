// A cut's artwork as the cut shows it. Most cuts show their whole image; a cut
// with an image view (CMP-01) shows part of it, drawn as an SVG whose viewBox is
// that part, so it crops and scales like the export raster without rewriting
// the source.

import type { CSSProperties } from "react";
import type { CutArt } from "@/lib/project";

export function CutArtImage({
  art,
  alt,
  className,
  style,
  loading,
  cover,
}: {
  art: CutArt;
  alt: string;
  className?: string;
  style?: CSSProperties;
  loading?: "lazy" | "eager";
  /** Fill the box and crop the overflow (a thumbnail): aligned to the top, middle or bottom. */
  cover?: "top" | "middle" | "bottom";
}) {
  if (!art.src) return null;
  const view = art.view;
  if (!view) {
    return (
      // biome-ignore lint/performance/noImgElement: local-first studio serves project files directly.
      <img className={className} style={style} src={art.src} alt={alt} loading={loading} />
    );
  }
  return (
    <svg
      className={className}
      style={style}
      viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
      preserveAspectRatio={
        cover === undefined
          ? "xMidYMid meet"
          : `xMid${cover === "top" ? "YMin" : cover === "bottom" ? "YMax" : "YMid"} slice`
      }
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      data-image-view=""
    >
      <image href={art.src} x={0} y={0} width={view.sourceWidth} height={view.sourceHeight} />
    </svg>
  );
}
