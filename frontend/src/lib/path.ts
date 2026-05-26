import type { PathStyleName } from "../api/client";

export const PATH_STYLES: Array<{ value: PathStyleName; label: string }> = [
  { value: "solid", label: "Solid line" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
  { value: "arrows", label: "Arrows (directional)" },
  { value: "chevrons", label: "Chevrons (directional)" },
  { value: "waves", label: "Waves" },
  { value: "tire", label: "Tire tracks" },
];

const PATTERN_STYLES = new Set<PathStyleName>(["arrows", "chevrons", "waves", "tire"]);
export const isPatternStyle = (s: PathStyleName): boolean => PATTERN_STYLES.has(s);

/** A stable image id for a given pattern style + color. */
export const patternId = (style: PathStyleName, color: string): string =>
  `path-${style}-${color.replace("#", "")}`;

/** Draw a path pattern onto a canvas context spanning [0..W] x [0..H], centered. */
function drawPattern(ctx: CanvasRenderingContext2D, style: PathStyleName, color: string, W: number, H: number): void {
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const mid = H / 2;
  ctx.lineWidth = Math.max(2, H * 0.12);

  if (style === "arrows") {
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(W, mid);
    ctx.stroke();
    const a = H * 0.28;
    const tip = W * 0.62;
    ctx.beginPath();
    ctx.moveTo(tip - a, mid - a);
    ctx.lineTo(tip, mid);
    ctx.lineTo(tip - a, mid + a);
    ctx.stroke();
  } else if (style === "chevrons") {
    const a = H * 0.34;
    const tip = W * 0.55;
    ctx.lineWidth = Math.max(2.5, H * 0.16);
    ctx.beginPath();
    ctx.moveTo(tip - a, mid - a);
    ctx.lineTo(tip, mid);
    ctx.lineTo(tip - a, mid + a);
    ctx.stroke();
  } else if (style === "waves") {
    ctx.beginPath();
    for (let x = 0; x <= W; x++) {
      const y = mid + Math.sin((x / W) * Math.PI * 2) * (H * 0.3);
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else if (style === "tire") {
    const off = H * 0.22;
    ctx.setLineDash([W * 0.42, W * 0.22]);
    for (const dy of [-off, off]) {
      ctx.beginPath();
      ctx.moveTo(0, mid + dy);
      ctx.lineTo(W, mid + dy);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
}

/** Build a colored, directional pattern image for use as a MapLibre line-pattern. */
export function makePatternImage(style: PathStyleName, color: string): ImageData {
  const H = 32;
  const W = style === "waves" ? 64 : style === "tire" ? 48 : 40;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  drawPattern(ctx, style, color, W, H);
  return ctx.getImageData(0, 0, W, H);
}

/** Render a small preview of a path style into a canvas element. */
export function drawPathPreview(canvas: HTMLCanvasElement, style: PathStyleName, color: string): void {
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);
  const mid = H / 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  if (style === "solid") {
    ctx.beginPath(); ctx.moveTo(4, mid); ctx.lineTo(W - 4, mid); ctx.stroke();
  } else if (style === "dashed") {
    ctx.setLineDash([10, 7]); ctx.beginPath(); ctx.moveTo(4, mid); ctx.lineTo(W - 4, mid); ctx.stroke(); ctx.setLineDash([]);
  } else if (style === "dotted") {
    ctx.setLineDash([1, 8]); ctx.beginPath(); ctx.moveTo(4, mid); ctx.lineTo(W - 4, mid); ctx.stroke(); ctx.setLineDash([]);
  } else {
    // Tile the colored pattern across the preview.
    const tileW = style === "waves" ? 32 : style === "tire" ? 24 : 20;
    const tile = document.createElement("canvas");
    tile.width = tileW;
    tile.height = H;
    drawPattern(tile.getContext("2d")!, style, color, tileW, H);
    for (let x = 0; x < W; x += tileW) ctx.drawImage(tile, x, 0);
  }
}
