// Card colors and shapes, shared by the card renderer (server) and the pickers in the editor and settings.

export const PALETTES = {
  cream: { label: "Cream", bg: "#FFF6E5", panel: "#FFFFFF", ink: "#1F2430", muted: "#5B6170", accent: "#FF6B4A", accentInk: "#FFFFFF" },
  mint: { label: "Mint", bg: "#E6F6EF", panel: "#FFFFFF", ink: "#123B2C", muted: "#4A6B5E", accent: "#12A37F", accentInk: "#FFFFFF" },
  sky: { label: "Sky", bg: "#EAF1FF", panel: "#FFFFFF", ink: "#172554", muted: "#4B5A82", accent: "#3B6CF6", accentInk: "#FFFFFF" },
  night: { label: "Night", bg: "#141824", panel: "#FFFFFF", ink: "#F5F6FA", muted: "#A9B0C3", accent: "#FFCC33", accentInk: "#141824" },
} as const;
export type Palette = keyof typeof PALETTES;

export const LAYOUTS = {
  portrait: { label: "Portrait", width: 1080, height: 1350 },
  square: { label: "Square", width: 1080, height: 1080 },
} as const;
export type Layout = keyof typeof LAYOUTS;

// The cartoon's shape for each card layout, so it fills the picture area: wide on portrait cards, tall on square ones.
export const CARTOON_SIZE = { portrait: "landscape", square: "portrait" } as const;
