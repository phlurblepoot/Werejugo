// Empty by default: the frontend talks to the backend at a relative `/api` path,
// which nginx (prod) or the Vite dev proxy reverse-proxies to the backend. Set
// VITE_API_URL only if you intentionally host the API on a different origin.
export const API_URL = import.meta.env.VITE_API_URL ?? "";
export const MAP_STYLE_URL =
  import.meta.env.VITE_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/liberty";
