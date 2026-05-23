import { API_URL } from "../lib/config";

// ---- Shared types (mirror the backend DTOs) ----

export interface User {
  id: string;
  familyId: string;
  email: string;
  displayName: string;
  role: "owner" | "member";
  color: string;
}

export interface Family {
  id: string;
  name: string;
  inviteCode: string;
}

export type ItemKind = "place" | "food" | "flight" | "cruise" | "drive" | "custom";

export interface Waypoint {
  id?: string;
  label: string;
  kind: "origin" | "stop" | "destination" | "port";
  seq?: number;
  lng: number;
  lat: number;
  arriveAt?: string | null;
  departAt?: string | null;
}

export interface Geometry {
  type: "Point" | "LineString";
  coordinates: number[] | number[][];
}

export type MediaType = "image" | "video" | "audio";

export interface Photo {
  id: string;
  url: string;
  thumbUrl: string | null;
  mediaType: MediaType;
  caption: string;
  seq: number;
}

export interface Item {
  id: string;
  mapSetId: string;
  kind: ItemKind;
  title: string;
  notes: string;
  themeId: string | null;
  tripId: string | null;
  color: string | null;
  icon: string | null;
  occurredOn: string | null;
  geometry: Geometry | null;
  waypoints: Waypoint[];
  photos: Photo[];
  properties?: Record<string, unknown> | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface Trip {
  id: string;
  mapSetId: string;
  name: string;
  description: string;
  startDate: string | null;
  endDate: string | null;
  coverPhotoUrl: string | null;
  color: string;
  createdAt: string;
}

export interface Comment {
  id: string;
  body: string;
  createdAt: string;
  userId: string | null;
  author?: string | null;
}

export interface ShareLink {
  id: string;
  token: string;
  createdAt: string;
}

export interface SharePayload {
  mapSet: Omit<MapSet, "id" | "createdAt">;
  trips: Array<Pick<Trip, "id" | "name" | "color" | "startDate" | "endDate">>;
  items: Array<
    Pick<Item, "id" | "kind" | "title" | "notes" | "color" | "icon" | "occurredOn" | "tripId" | "geometry" | "waypoints" | "photos">
  >;
}

export interface Stats {
  items: number;
  photos: number;
  trips: number;
  firstDate: string | null;
  lastDate: string | null;
  countByKind: Record<string, number>;
  distanceMetersByKind: Record<string, number>;
  totalDistanceMeters: number;
}

export interface MapSet {
  id: string;
  name: string;
  description: string;
  baseKind: "vector" | "custom";
  styleUrl: string | null;
  overlayUrl: string | null;
  overlayBounds: number[] | null;
  defaultLng: number;
  defaultLat: number;
  defaultZoom: number;
  createdAt: string;
}

export interface Theme {
  id: string;
  name: string;
  kind: string;
  icon: string;
  color: string;
  lineColor: string;
  lineWidth: number;
  isBuiltin: boolean;
}

export interface CustomIcon {
  id: string;
  name: string;
  url: string;
}

export interface LookupResult {
  title: string;
  waypoints: Array<{ label: string; lng: number; lat: number; kind: string }>;
  path: number[][];
  warnings: string[];
  image?: string | null;
}

export interface PlaceSuggestion {
  label: string;
  lat: number;
  lng: number;
  source: string;
}

// ---- Client ----

const TOKEN_KEY = "werejugo.token";

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = tokenStore.get();
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (res.status === 401) {
    tokenStore.clear();
  }
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      message = typeof data.error === "string" ? data.error : JSON.stringify(data.error);
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const body = (data: unknown) => JSON.stringify(data);

export const api = {
  // auth
  register: (data: Record<string, unknown>) =>
    request<{ token: string; user: User }>("/api/auth/register", { method: "POST", body: body(data) }),
  login: (data: { email: string; password: string }) =>
    request<{ token: string; user: User }>("/api/auth/login", { method: "POST", body: body(data) }),
  me: () => request<{ user: User; family: Family }>("/api/auth/me"),

  // map sets
  listMapSets: () => request<MapSet[]>("/api/map-sets"),
  createMapSet: (data: Partial<MapSet>) =>
    request<MapSet>("/api/map-sets", { method: "POST", body: body(data) }),
  updateMapSet: (id: string, data: Partial<MapSet>) =>
    request<MapSet>(`/api/map-sets/${id}`, { method: "PATCH", body: body(data) }),
  deleteMapSet: (id: string) => request<void>(`/api/map-sets/${id}`, { method: "DELETE" }),

  // items
  listItems: (mapSetId: string) => request<Item[]>(`/api/map-sets/${mapSetId}/items`),
  createItem: (mapSetId: string, data: Partial<Item>) =>
    request<Item>(`/api/map-sets/${mapSetId}/items`, { method: "POST", body: body(data) }),
  updateItem: (id: string, data: Partial<Item>) =>
    request<Item>(`/api/items/${id}`, { method: "PATCH", body: body(data) }),
  deleteItem: (id: string) => request<void>(`/api/items/${id}`, { method: "DELETE" }),

  // photos
  uploadItemPhoto: (itemId: string, file: File, caption = "") => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("caption", caption);
    return request<Photo>(`/api/items/${itemId}/photos`, { method: "POST", body: fd });
  },
  updatePhoto: (id: string, caption: string) =>
    request<Photo>(`/api/photos/${id}`, { method: "PATCH", body: body({ caption }) }),
  deletePhoto: (id: string) => request<void>(`/api/photos/${id}`, { method: "DELETE" }),

  // trips
  listTrips: (mapSetId: string) => request<Trip[]>(`/api/map-sets/${mapSetId}/trips`),
  createTrip: (mapSetId: string, data: Partial<Trip>) =>
    request<Trip>(`/api/map-sets/${mapSetId}/trips`, { method: "POST", body: body(data) }),
  updateTrip: (id: string, data: Partial<Trip>) =>
    request<Trip>(`/api/trips/${id}`, { method: "PATCH", body: body(data) }),
  deleteTrip: (id: string) => request<void>(`/api/trips/${id}`, { method: "DELETE" }),

  // comments
  listComments: (itemId: string) => request<Comment[]>(`/api/items/${itemId}/comments`),
  addComment: (itemId: string, body_: string) =>
    request<Comment>(`/api/items/${itemId}/comments`, { method: "POST", body: body({ body: body_ }) }),
  deleteComment: (id: string) => request<void>(`/api/comments/${id}`, { method: "DELETE" }),

  // stats
  getStats: (mapSetId: string) => request<Stats>(`/api/map-sets/${mapSetId}/stats`),

  // exif / import / export
  readExif: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<{ lat: number | null; lng: number | null; date: string | null }>("/api/exif", {
      method: "POST",
      body: fd,
    });
  },
  importFile: (mapSetId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<{ imported: number; skipped: number }>(`/api/map-sets/${mapSetId}/import`, {
      method: "POST",
      body: fd,
    });
  },
  exportData: () => request<unknown>("/api/export"),

  // share links
  listShares: (mapSetId: string) => request<ShareLink[]>(`/api/map-sets/${mapSetId}/shares`),
  createShare: (mapSetId: string) =>
    request<ShareLink>(`/api/map-sets/${mapSetId}/shares`, { method: "POST", body: body({}) }),
  deleteShare: (id: string) => request<void>(`/api/shares/${id}`, { method: "DELETE" }),
  getShare: (token: string) => request<SharePayload>(`/api/share/${token}`),

  // themes
  listThemes: () => request<Theme[]>("/api/themes"),
  createTheme: (data: Partial<Theme>) =>
    request<Theme>("/api/themes", { method: "POST", body: body(data) }),
  deleteTheme: (id: string) => request<void>(`/api/themes/${id}`, { method: "DELETE" }),

  // icons / uploads
  listIcons: () => request<{ builtin: string[]; custom: CustomIcon[] }>("/api/icons"),
  uploadIcon: (file: File, name: string) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("name", name);
    return request<CustomIcon>("/api/icons", { method: "POST", body: fd });
  },
  uploadImage: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<{ url: string }>("/api/uploads", { method: "POST", body: fd });
  },
  deleteIcon: (id: string) => request<void>(`/api/icons/${id}`, { method: "DELETE" }),

  // lookups
  lookupFlight: (data: Record<string, unknown>) =>
    request<LookupResult>("/api/lookup/flight", { method: "POST", body: body(data) }),
  lookupCruise: (data: Record<string, unknown>) =>
    request<LookupResult>("/api/lookup/cruise", { method: "POST", body: body(data) }),
  searchAirports: (q: string) =>
    request<PlaceSuggestion[]>(`/api/geo/airports?q=${encodeURIComponent(q)}`),
  searchPorts: (q: string) =>
    request<PlaceSuggestion[]>(`/api/geo/ports?q=${encodeURIComponent(q)}`),
  searchPlaces: (q: string) =>
    request<PlaceSuggestion[]>(`/api/geo/search?q=${encodeURIComponent(q)}`),
};

export { ApiError, API_URL };
