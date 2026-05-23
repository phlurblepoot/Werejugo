// Built-in icons are rendered as emoji glyphs so the app needs no image assets.
// Custom icons (uploaded by a family) are image URLs and handled separately.
export const ICON_GLYPHS: Record<string, string> = {
  pin: "📍",
  plane: "✈️",
  ship: "🚢",
  car: "🚗",
  utensils: "🍴",
  home: "🏠",
  star: "⭐",
  camera: "📷",
  heart: "❤️",
  flag: "🚩",
  mountain: "⛰️",
  tree: "🌳",
  beach: "🏖️",
  hotel: "🏨",
  coffee: "☕",
  wine: "🍷",
};

export function isBuiltinIcon(icon: string | null | undefined): boolean {
  return !!icon && icon in ICON_GLYPHS;
}

export function glyphFor(icon: string | null | undefined): string {
  if (!icon) return ICON_GLYPHS.pin;
  return ICON_GLYPHS[icon] ?? ICON_GLYPHS.pin;
}

export function isImageIcon(icon: string | null | undefined): boolean {
  return !!icon && (icon.startsWith("/uploads/") || icon.startsWith("http"));
}
