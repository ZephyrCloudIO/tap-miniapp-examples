export type ElementRepresentation = "selector" | "html" | "png";

export interface ElementPickPoint {
  readonly xRatio: number;
  readonly yRatio: number;
}

interface Rectangle {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Maps a pointer to the actual pixels of an object-fit: contain frame.
 * Letterboxed clicks return null instead of selecting an unrelated page point.
 */
export function containedFramePoint(
  bounds: Rectangle,
  frame: ImageSize,
  clientX: number,
  clientY: number,
): ElementPickPoint | null {
  if (
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    frame.width <= 0 ||
    frame.height <= 0
  ) {
    return null;
  }

  const scale = Math.min(bounds.width / frame.width, bounds.height / frame.height);
  const renderedWidth = frame.width * scale;
  const renderedHeight = frame.height * scale;
  const renderedLeft = bounds.left + (bounds.width - renderedWidth) / 2;
  const renderedTop = bounds.top + (bounds.height - renderedHeight) / 2;
  const x = clientX - renderedLeft;
  const y = clientY - renderedTop;

  if (x < 0 || y < 0 || x > renderedWidth || y > renderedHeight) {
    return null;
  }

  return {
    xRatio: Math.max(0, Math.min(1, x / renderedWidth)),
    yRatio: Math.max(0, Math.min(1, y / renderedHeight)),
  };
}

export function representationLabel(value: ElementRepresentation): string {
  if (value === "selector") return "Selector";
  if (value === "html") return "HTML";
  return "PNG";
}
