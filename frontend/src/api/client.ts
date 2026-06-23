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

export type PinShape = "circle" | "square" | "rounded" | "none";

export interface PinStyle {
  color?: string;
  icon?: string;
  size?: number;
  shape?: PinShape;
  borderWidth?: number;
  borderColor?: string;
}

export interface PinSettings {
  default?: PinStyle;
  byKind?: Partial<Record<ItemKind, PinStyle>>;
  byLine?: Record<string, PinStyle>;
}

export type PathStyleName =
  | "solid"
  | "dashed"
  | "dotted"
  | "arrows"
  | "chevrons"
  | "waves"
  | "tire"
  | "hearts"
  | "stars"
  | "paws"
  | "palms"
  | "planes"
  | "anchors"
  | "suns"
  | "flowers"
  | "balloons"
  | "footprints"
  | "image";

export interface PathStyle {
  style?: PathStyleName;
  color?: string;
  width?: number;
  imageUrl?: string;
}

export interface PathSettings {
  default?: PathStyle;
  byKind?: Partial<Record<ItemKind, PathStyle>>;
  byLine?: Record<string, PathStyle>;
}

export interface FamilySettings {
  pin?: PinSettings;
  path?: PathSettings;
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
  mapSetId?: string;
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
  mapSetId?: string;
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

export interface CruiseSailing {
  id: string;
  dateISO: string | null;
  dateText: string;
  title: string;
  departurePort: string;
  price: string;
}

export interface SailingDetail {
  ports: Array<{
    label: string;
    lng: number;
    lat: number;
    kind: "origin" | "port" | "destination";
    dateISO: string | null;
    arriveAt: string | null;
    departAt: string | null;
  }>;
  path: number[][];
  warnings: string[];
}

export interface CruiseFindResult {
  shipName: string;
  shipUrl: string | null;
  image: string | null;
  lineName: string | null;
  lineLogo: string | null;
  sailings: CruiseSailing[];
  ports: Array<{ label: string; lng: number | null; lat: number | null }>;
  warnings: string[];
}

export type CoreType = "visit" | "trip" | "person" | "media" | "document";

export interface Person {
  id: string;
  displayName: string;
  relationship: string;
  notes: string;
  userId: string | null;
  avatarMediaId: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface PersonInput {
  displayName?: string;
  relationship?: string;
  notes?: string;
  userId?: string | null;
  avatarMediaId?: string | null;
}

export interface FamilyMember { id: string; displayName: string; email: string; color: string; }

export interface EntitySummary {
  type: CoreType; id: string; label: string; subtitle?: string | null; thumbUrl: string | null;
}

export interface Relation { linkId: string; role: string; entity: EntitySummary; }

export interface MediaDto { id: string; kind: MediaType; url: string; thumbUrl: string | null; caption: string; }

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
  // Only declare a JSON body when one is actually sent — a JSON content-type with
  // an empty body (e.g. DELETE) makes Fastify reject the request with 400.
  if (options.body !== undefined && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
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

  // visits (formerly items) — kept as `Item` shape; mapSetId is stamped client-side
  listItems: async (mapSetId: string) => {
    const visits = await request<Item[]>(`/api/map-sets/${mapSetId}/visits`);
    return visits.map((v) => ({ ...v, mapSetId }));
  },
  createItem: async (mapSetId: string, data: Partial<Item>) => {
    const visit = await request<Item>("/api/visits", { method: "POST", body: body(data) });
    await request(`/api/map-sets/${mapSetId}/visits`, { method: "POST", body: body({ visitId: visit.id }) });
    return { ...visit, mapSetId };
  },
  updateItem: (id: string, data: Partial<Item>) =>
    request<Item>(`/api/visits/${id}`, { method: "PATCH", body: body(data) }),
  deleteItem: (id: string) => request<void>(`/api/visits/${id}`, { method: "DELETE" }),

  // photos -> media + a media↔visit link
  uploadItemPhoto: async (itemId: string, file: File, caption = "") => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("caption", caption);
    const m = await request<{ id: string; url: string; thumbUrl: string | null; kind: MediaType; caption: string }>(
      "/api/media", { method: "POST", body: fd });
    await request("/api/links", {
      method: "POST",
      body: body({ from: `media:${m.id}`, to: `visit:${itemId}`, role: "appears_in" }),
    });
    return { id: m.id, url: m.url, thumbUrl: m.thumbUrl, mediaType: m.kind, caption: m.caption, seq: 0 } as Photo;
  },
  updatePhoto: async (id: string, caption: string) => {
    const m = await request<{ id: string; url: string; thumbUrl: string | null; kind: MediaType; caption: string }>(
      `/api/media/${id}`, { method: "PATCH", body: body({ caption }) });
    return { id: m.id, url: m.url, thumbUrl: m.thumbUrl, mediaType: m.kind, caption: m.caption, seq: 0 } as Photo;
  },
  deletePhoto: (id: string) => request<void>(`/api/media/${id}`, { method: "DELETE" }),

  // trips (family-scoped; mapSetId arg is ignored, kept for call-site compatibility)
  listTrips: (_mapSetId: string) => request<Trip[]>("/api/trips"),
  createTrip: (_mapSetId: string, data: Partial<Trip>) =>
    request<Trip>("/api/trips", { method: "POST", body: body(data) }),
  updateTrip: (id: string, data: Partial<Trip>) =>
    request<Trip>(`/api/trips/${id}`, { method: "PATCH", body: body(data) }),
  deleteTrip: (id: string) => request<void>(`/api/trips/${id}`, { method: "DELETE" }),

  // comments (now on visits)
  listComments: (itemId: string) => request<Comment[]>(`/api/visits/${itemId}/comments`),
  addComment: (itemId: string, body_: string) =>
    request<Comment>(`/api/visits/${itemId}/comments`, { method: "POST", body: body({ body: body_ }) }),
  deleteComment: (id: string) => request<void>(`/api/comments/${id}`, { method: "DELETE" }),

  // stats (family-scoped)
  getStats: (_mapSetId: string) => request<Stats>("/api/stats"),

  // people
  listPeople: () => request<Person[]>("/api/people"),
  getPerson: (id: string) => request<Person>(`/api/people/${id}`),
  createPerson: (data: PersonInput) => request<Person>("/api/people", { method: "POST", body: body(data) }),
  updatePerson: (id: string, data: PersonInput) =>
    request<Person>(`/api/people/${id}`, { method: "PATCH", body: body(data) }),
  deletePerson: (id: string) => request<void>(`/api/people/${id}`, { method: "DELETE" }),
  listFamilyMembers: () => request<FamilyMember[]>("/api/family-members"),

  // entity graph
  getRelations: (entity: string) =>
    request<Relation[]>(`/api/relations?entity=${encodeURIComponent(entity)}`),
  searchEntities: (type: CoreType, q: string) =>
    request<EntitySummary[]>(`/api/entities/search?type=${type}&q=${encodeURIComponent(q)}`),

  // generic media + links
  uploadMedia: (file: File, caption = "") => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("caption", caption);
    return request<MediaDto>("/api/media", { method: "POST", body: fd });
  },
  createLink: (from: string, to: string, role = "") =>
    request<{ id: string }>("/api/links", { method: "POST", body: body({ from, to, role }) }),
  deleteLink: (id: string) => request<void>(`/api/links/${id}`, { method: "DELETE" }),

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

  // family settings
  getSettings: () => request<FamilySettings>("/api/settings"),
  saveSettings: (settings: FamilySettings) =>
    request<FamilySettings>("/api/settings", { method: "PUT", body: body(settings) }),

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
  uploadFromUrl: (url: string) =>
    request<{ url: string; thumbUrl: string | null }>("/api/uploads/from-url", {
      method: "POST",
      body: body({ url }),
    }),
  deleteIcon: (id: string) => request<void>(`/api/icons/${id}`, { method: "DELETE" }),

  // lookups
  lookupFlight: (data: Record<string, unknown>) =>
    request<LookupResult>("/api/lookup/flight", { method: "POST", body: body(data) }),
  lookupCruise: (data: Record<string, unknown>) =>
    request<LookupResult>("/api/lookup/cruise", { method: "POST", body: body(data) }),
  findCruise: (data: { line?: string; ship?: string; shipUrl?: string }) =>
    request<CruiseFindResult>("/api/lookup/cruise/find", { method: "POST", body: body(data) }),
  searchCruiseLines: (q: string) =>
    request<Array<{ name: string; url: string }>>(`/api/lookup/cruise/lines?q=${encodeURIComponent(q)}`),
  searchCruiseShips: (q: string, line?: string) =>
    request<Array<{ name: string; url: string }>>(
      `/api/lookup/cruise/ships?q=${encodeURIComponent(q)}&line=${encodeURIComponent(line ?? "")}`,
    ),
  getSailingDetail: (id: string) =>
    request<SailingDetail>("/api/lookup/cruise/sailing", { method: "POST", body: body({ id }) }),
  resolvePort: (q: string) =>
    request<PlaceSuggestion>(`/api/geo/resolve?q=${encodeURIComponent(q)}`),
  searchAirports: (q: string) =>
    request<PlaceSuggestion[]>(`/api/geo/airports?q=${encodeURIComponent(q)}`),
  searchPorts: (q: string) =>
    request<PlaceSuggestion[]>(`/api/geo/ports?q=${encodeURIComponent(q)}`),
  searchPlaces: (q: string) =>
    request<PlaceSuggestion[]>(`/api/geo/search?q=${encodeURIComponent(q)}`),
};

export { ApiError, API_URL };
