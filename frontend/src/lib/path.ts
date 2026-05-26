import type { PathStyleName } from "../api/client";

export const PATH_STYLES: Array<{ value: PathStyleName; label: string }> = [
  { value: "solid", label: "Solid line" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
  { value: "arrows", label: "Arrows (directional)" },
  { value: "chevrons", label: "Chevrons (directional)" },
  { value: "waves", label: "Waves" },
  { value: "tire", label: "Tire tracks" },
  { value: "hearts", label: "❤️ Hearts" },
  { value: "stars", label: "🌟 Stars" },
  { value: "paws", label: "🐾 Paw prints" },
  { value: "footprints", label: "👣 Footprints" },
  { value: "palms", label: "🌴 Palm trees" },
  { value: "planes", label: "✈️ Planes" },
  { value: "anchors", label: "⚓ Anchors" },
  { value: "suns", label: "☀️ Suns" },
  { value: "flowers", label: "🌸 Flowers" },
  { value: "balloons", label: "🎈 Balloons" },
  { value: "image", label: "Custom image…" },
];

const EMOJI: Partial<Record<PathStyleName, string>> = {
  hearts: "❤️",
  stars: "🌟",
  paws: "🐾",
  footprints: "👣",
  palms: "🌴",
  planes: "✈️",
  anchors: "⚓",
  suns: "☀️",
  flowers: "🌸",
  balloons: "🎈",
};

const DRAWN = new Set<PathStyleName>(["arrows", "chevrons", "waves", "tire"]);

/** Styles rendered as a repeating image (drawn shapes or emoji). "image" is handled separately. */
export const isPatternStyle = (s: PathStyleName): boolean => DRAWN.has(s) || s in EMOJI;
export const isEmojiStyle = (s: PathStyleName): boolean => s in EMOJI;

/** A stable image id for a given pattern style + color. */
export const patternId = (style: PathStyleName, color: string): string =>
  `path-${style}-${color.replace("#", "")}`;

function drawShapes(ctx: CanvasRenderingContext2D, style: PathStyleName, color: string, W: number, H: number): void {
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

function drawEmoji(ctx: CanvasRenderingContext2D, emoji: string, W: number, H: number): void {
  ctx.font = `${Math.round(H * 0.8)}px serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, W / 2, H / 2 + 1);
}

/** Build a colored/emoji pattern image for use as a MapLibre line-pattern. */
export function makePatternImage(style: PathStyleName, color: string): ImageData {
  const H = 36;
  const emoji = EMOJI[style];
  const W = emoji ? Math.round(H * 1.5) : style === "waves" ? 64 : style === "tire" ? 48 : 40;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, W, H);
  if (emoji) drawEmoji(ctx, emoji, W, H);
  else drawShapes(ctx, style, color, W, H);
  return ctx.getImageData(0, 0, W, H);
}

/** Compose a repeating tile from a loaded image (logo), scaled to fit with spacing. */
export function composeImageTile(img: CanvasImageSource, imgW: number, imgH: number): ImageData {
  const H = 40;
  const scale = Math.min(1, (H * 0.85) / imgH);
  const w = Math.max(1, Math.round(imgW * scale));
  const h = Math.max(1, Math.round(imgH * scale));
  const W = w + Math.round(H * 0.5); // horizontal spacing between logos
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(img, Math.round((W - w) / 2), Math.round((H - h) / 2), w, h);
  return ctx.getImageData(0, 0, W, H);
}

export function imagePatternId(url: string): string {
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = (h * 33) ^ url.charCodeAt(i);
  return `pathimg-${(h >>> 0).toString(36)}`;
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
  } else if (style === "image") {
    ctx.fillStyle = "var(--muted)";
    ctx.font = "11px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    ctx.fillText("custom image", W / 2, mid);
  } else {
    const emoji = EMOJI[style];
    const tileW = emoji ? Math.round(H * 1.4) : style === "waves" ? 32 : style === "tire" ? 24 : 20;
    const tile = document.createElement("canvas");
    tile.width = tileW;
    tile.height = H;
    const tctx = tile.getContext("2d")!;
    if (emoji) drawEmoji(tctx, emoji, tileW, H);
    else drawShapes(tctx, style, color, tileW, H);
    for (let x = 0; x < W; x += tileW) ctx.drawImage(tile, x, 0);
  }
}
