import { API_URL } from "../lib/config";

// ---- Shared types (mirror the backend DTOs) ----

export interface User {
  id: string;
  familyId: string;
  email: string;
  displayName: string;
  role: "owner" | "member";
  color: string;
  /** Server admin: manages every family, backups and the audit log. */
  isAdmin: boolean;
}

export interface AuthConfig {
  /** No account exists yet: the sign-in page shows the setup form. */
  firstRun: boolean;
}

export interface Family {
  id: string;
  name: string;
}

/** Present while a server admin is looking at another family. */
export interface AdminView {
  homeFamilyId: string;
  homeFamilyName: string;
}

export interface Session {
  user: User;
  family: Family;
  adminView: AdminView | null;
}

/** A one-time link (invite or password reset). The token is only ever shown once. */
export interface IssuedLink {
  id: string;
  token: string;
  path: string;
  expiresAt: string;
}

export interface InvitePreview {
  kind: "family" | "member";
  familyName: string | null;
  role: "owner" | "member";
  invitedBy: string | null;
  expiresAt: string;
  adminName: string | null;
}

export interface FamilyMemberInfo {
  id: string;
  displayName: string;
  email: string;
  role: "owner" | "member";
  color: string;
  isAdmin: boolean;
  lastLoginAt: string | null;
  joinedAt: string;
  isYou: boolean;
}

export interface PendingInvite {
  id: string;
  role: "owner" | "member";
  note: string;
  createdAt: string;
  expiresAt: string;
  createdByName: string | null;
}

export interface FamilyDetails {
  family: { id: string; name: string; createdAt: string };
  members: FamilyMemberInfo[];
  invites: PendingInvite[];
}

export interface AdminFamily {
  id: string;
  name: string;
  createdAt: string;
  disabled: boolean;
  memberCount: number;
  owners: string[];
}

export interface AdminOverview {
  families: AdminFamily[];
  userCount: number;
  adminCount: number;
  pendingFamilyInvites: number;
}

export interface AdminUser {
  id: string;
  displayName: string;
  email: string;
  familyId: string;
  familyName: string;
  role: "owner" | "member";
  isAdmin: boolean;
  disabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  isYou: boolean;
}

export type ImmichFamilyState = "none" | "created" | "linked" | "error";

/** Admin → Immich: the connection to the Immich server and each family's account. Keys never come back. */
export interface ImmichAdmin {
  encryptionReady: boolean;
  encryptionProblem: string | null;
  configured: boolean;
  url: string | null;
  adminKeySet: boolean;
  updatedAt: string | null;
  check: { ok: boolean; version: string | null; supported: boolean | null; error: string | null; at: string } | null;
  supportedRange: string;
  families: Array<{
    id: string;
    name: string;
    state: ImmichFamilyState;
    mode: "created" | "linked" | null;
    immichEmail: string | null;
    lastError: string | null;
    lastOkAt: string | null;
  } & Partial<ImmichFamilySync>>;
  results?: Array<{ id: string; name: string; ok: boolean; error?: string }>;
}
// Per-family library sync state, on the admin page.
export interface ImmichFamilySync { lastSyncAt: string | null; syncError: string | null; photoCount: number | null }

/** Is Immich on for my family? Owners also get the login for using Immich directly. */
export interface ImmichStatus {
  enabled: boolean;
  state: ImmichFamilyState;
  url?: string;
  email?: string;
  mode?: "created" | "linked";
  canSetPassword?: boolean;
  lastSyncAt?: string | null;
  photoCount?: number | null;
}

export interface AuditEntry {
  id: string;
  at: string;
  actorName: string;
  action: string;
  familyId: string | null;
  familyName: string | null;
  target: string;
  details: Record<string, unknown>;
}

export type DownloadPurpose = "backup" | "family-export";

export type ItemKind = "place" | "food" | "flight" | "cruise" | "drive" | "stay" | "custom";

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
  /** The map's base style (a MapLibre style URL); empty for the default. */
  map?: { styleUrl?: string | null };
}

export type MediaType = "image" | "video" | "audio";

export interface Photo {
  id: string;
  /** A large preview (a still frame for videos). */
  url: string;
  thumbUrl: string | null;
  /** Videos: the playable file (seekable). */
  videoUrl?: string | null;
  /** The original file, as a download. */
  originalUrl?: string;
  mediaType: MediaType;
  caption: string;
  seq: number;
}

export interface Item {
  id: string;
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
  /** The family that added it (another family's when it's on a shared trip). */
  familyId?: string;
  familyName?: string;
  /** Whether my family may change it (trip roles on shared trips). */
  canEdit?: boolean;
  /** People tagged on it (for the map's person filter). */
  personIds?: string[];
  createdAt: string;
}

export interface Trip {
  id: string;
  name: string;
  description: string;
  status: "idea" | "planning" | "booked" | "done";
  startDate: string | null;
  endDate: string | null;
  coverPhotoUrl: string | null;
  color: string;
  createdAt: string;
  /** My family's role: the host, or a guest family invited as co-owner or contributor. */
  role?: TripRole;
  hostFamilyId?: string;
  hostFamilyName?: string;
  /** How many other families are on the trip. */
  guestFamilies?: number;
  shared?: boolean;
}

export type TripRole = "host" | "coowner" | "contributor";

export interface TripMembers {
  myRole: TripRole | null;
  host: { familyId: string; familyName: string };
  members: Array<{ familyId: string; familyName: string; role: "coowner" | "contributor"; joinedAt: string; isYou: boolean }>;
  invites: Array<{ id: string; role: "coowner" | "contributor"; note: string; createdAt: string; expiresAt: string }>;
}

export interface TripInvitePreview {
  tripId: string; tripName: string; startDate: string | null; endDate: string | null;
  hostFamilyName: string; invitedBy: string | null; role: "coowner" | "contributor";
  expiresAt: string; alreadyOnTrip: boolean; canAccept: boolean;
}

export interface ActivityEntry {
  id: string; kind: string; targetType: string; targetId: string | null; summary: string; at: string;
  familyId: string | null; familyName: string | null; userName: string | null;
}

/** A suggestion from photos (lib/suggest.ts on the server); the sentence is written here. */
export type SuggestionKind = "trip-photos" | "trip-place" | "trip-person" | "visit-photos" | "new-trip";
export interface Suggestion {
  key: string;
  kind: SuggestionKind;
  count: number;
  thumbUrls: string[];
  tripId?: string;
  visitId?: string;
  person?: { id: string; displayName: string; familyName: string | null };
  /** Where (Immich's place names), for a place or a new trip. */
  label?: string | null;
  lat?: number;
  lng?: number;
  startDate?: string;
  endDate?: string;
  /** A new trip's suggested name. */
  name?: string;
}
export interface TripAlbum { name: string; assetCount: number; syncedAt: string | null; error: string | null }
export interface TripPerson { id: string; displayName: string; familyId: string; familyName: string; mine: boolean; avatarUrl: string | null; }

export interface PersonLinkEntry {
  id: string; status: "pending" | "accepted"; createdAt: string; incoming: boolean;
  person: { id: string; displayName: string };
  other: { id: string; displayName: string; familyName: string };
}
export interface PersonLinks { incoming: PersonLinkEntry[]; outgoing: PersonLinkEntry[]; linked: PersonLinkEntry[] }

export interface ItineraryItem {
  id: string; tripId: string; title: string; notes: string;
  scheduledOn: string | null; seq: number;
  lat: number | null; lng: number | null; placeLabel: string;
  convertedVisitId: string | null; createdAt: string;
  /** Who added it, and whether my family may change it (trip roles). */
  familyId?: string; familyName?: string; createdByName?: string | null; canEdit?: boolean;
}
export interface ItineraryInput {
  title?: string; notes?: string; scheduledOn?: string | null; seq?: number;
  lat?: number | null; lng?: number | null; placeLabel?: string;
}
export interface Blackout { id: string; label: string; startDate: string; endDate: string; color: string; createdAt: string; }
export interface BlackoutInput { label?: string; startDate?: string; endDate?: string; color?: string; }

export interface Comment {
  id: string;
  body: string;
  createdAt: string;
  userId: string | null;
  author?: string | null;
  familyName?: string | null;
}

export interface SearchHit { type: string; id: string; label: string; thumbUrl: string | null; to: string; }
export interface SearchResults {
  people: SearchHit[]; trips: SearchHit[]; visits: SearchHit[]; photos: SearchHit[]; documents: SearchHit[];
}

export type ShareTargetType = "trip" | "album" | "smart_album";
export interface ShareLink {
  id: string; token: string; targetType: ShareTargetType; targetId: string; createdAt: string;
}

export interface SharedTrip {
  id: string; name: string; description: string; color: string; startDate: string | null; endDate: string | null;
}
export interface SharedPhoto { id: string; url: string; thumbUrl: string | null; mediaType: MediaType; caption: string; seq: number; }
export interface SharedVisit {
  id: string; kind: ItemKind; title: string; notes: string; color: string | null; icon: string | null;
  occurredOn: string | null; geometry: Geometry | null; photos: SharedPhoto[];
}
export interface SharedItineraryItem { id: string; title: string; notes: string; scheduledOn: string | null; seq: number; }
export interface TripSharePayload { targetType: "trip"; trip: SharedTrip; visits: SharedVisit[]; itinerary: SharedItineraryItem[]; photos: SharedPhoto[]; }
export interface AlbumSharePayload { targetType: "album"; trip: SharedTrip; photos: SharedPhoto[]; }
/** A smart album, evaluated when the link is opened. */
export interface SmartAlbumSharePayload { targetType: "smart_album"; album: { name: string }; photos: SharedPhoto[]; }
export type SharePayload = TripSharePayload | AlbumSharePayload | SmartAlbumSharePayload;

/** A smart album: the library's filters and a smart-search text, kept under a name. */
export interface SmartAlbumFilters extends Pick<MediaFilters, "person" | "trip" | "visit" | "from" | "to" | "kind" | "noTrip"> { q?: string }
export interface SmartAlbum { id: string; name: string; filters: SmartAlbumFilters; createdAt: string; updatedAt: string }

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
  /** Set on a single person: another family's person is read-only (name + picture). */
  familyId?: string;
  familyName?: string;
  readOnly?: boolean;
  links?: Array<{ linkId: string; status: "pending" | "accepted"; personId: string; displayName: string; familyName: string; incoming: boolean }>;
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
  /** Another family's (seen through a shared trip). */
  familyName?: string | null;
}

/** A face Immich found in the family's photos (lib/immich/faces on the server). */
export interface Face {
  id: string;
  /** Its name in Immich ("" if none). */
  name: string;
  thumbUrl: string;
  photoCount: number | null;
  ignored: boolean;
  hiddenInImmich: boolean;
  firstSeenAt: string;
  /** The Werejugo person it is; familyName is set when that's another family's. */
  person: { id: string; displayName: string; familyName: string | null } | null;
}
export type FaceView = "review" | "mapped" | "ignored" | "all";

export interface Relation { linkId: string; role: string; entity: EntitySummary; canRemove?: boolean; }

export interface MediaDto {
  id: string; kind: MediaType; url: string; thumbUrl: string | null; caption: string;
  videoUrl?: string | null; originalUrl?: string;
  /** Upload result: the same file was already in the family's library. */
  duplicate?: boolean;
}

/** A photo or video on its way to Immich (uploaded in pieces). */
export interface MediaUpload {
  id: string; filename: string; size: number; offset: number;
  state: "receiving" | "processing" | "done" | "failed";
  duplicate: boolean; error: string | null; canRetry: boolean; media: MediaDto | null;
}

export interface MediaItem {
  id: string;
  kind: MediaType;
  tripId: string | null;
  /** A large preview (a still frame for videos). */
  url: string;
  thumbUrl: string | null;
  /** Videos: the playable file (seekable). */
  videoUrl?: string | null;
  /** The original file, as a download. */
  originalUrl?: string;
  originalName?: string;
  durationMs?: number | null;
  caption: string;
  takenAt: string | null;
  createdAt: string;
  width: number | null;
  height: number | null;
  lng: number | null;
  lat: number | null;
  cursor: string;
  /** Another family's photo on a shared trip is shown with who added it, view-only. */
  familyId?: string;
  familyName?: string | null;
  /** Hidden from the library by the family (still in Immich). */
  hidden?: boolean;
}

export interface MediaFilters {
  person?: string; trip?: string; visit?: string;
  from?: string; to?: string; bbox?: string;
  kind?: "image" | "video";
  /** "only": just the hidden photos. */
  hidden?: "only";
  /** "1": photos in no trip. */
  noTrip?: "1";
  /** "2025-07": one month. */
  month?: string;
  limit?: number; before?: string;
}

export interface MediaTimeline { months: Array<{ month: string; count: number }>; total: number }

/** The photo picker's opening view for an item. */
export interface PickerSuggestions {
  label: string;
  window: { from: string; to: string } | null;
  near: boolean;
  /** The month the library should open at ("2025-07"). */
  month: string | null;
  items: Array<MediaItem & { attached: boolean; match: "both" | "date" | "place" }>;
}

export interface MediaPage { items: MediaItem[]; nextCursor: string | null; }

export interface MediaSuggestions {
  trips: { tripId: string; name: string; mediaIds: string[] }[];
  visits: { visitId: string; title: string; mediaIds: string[] }[];
}

export type DocStatus = "overdue" | "upcoming" | "ok" | "none";
export type DocType = "passport" | "visa" | "booking" | "insurance" | "other";

export interface DocumentItem {
  id: string;
  title: string;
  docType: DocType;
  ownerPersonId: string | null;
  ownerPersonName: string | null;
  ownerTripId: string | null;
  ownerTripName: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  reminderLeadDays: number;
  notes: string;
  fileUrl: string | null;
  originalName: string;
  createdAt: string;
  status: DocStatus;
  daysUntilExpiry: number | null;
}

export interface DocumentInput {
  title?: string;
  docType?: DocType;
  ownerPersonId?: string | null;
  ownerTripId?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
  reminderLeadDays?: number;
  notes?: string;
}

export interface DocumentFilters { docType?: string; owner?: string; q?: string; due?: string; }

export interface PackingItem { id: string; label: string; category: string; qty: number | null; checked: boolean; seq: number; }
export interface PackingList { id: string; name: string; tripId: string | null; isBuiltin: boolean; itemCount: number; checkedCount: number; }
export interface PackingListDetail extends PackingList { items: PackingItem[]; }
export interface PackingItemInput { label?: string; category?: string; qty?: number | null; checked?: boolean; seq?: number; }

// ---- Client ----

const TOKEN_KEY = "werejugo.token";
/** Fired on window when an authenticated request comes back 401. */
export const UNAUTHORIZED_EVENT = "werejugo:unauthorized";

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
  if (res.status === 401 && token) {
    // The session ended (revoked, password changed, account removed): let the
    // app sign out instead of leaving every request failing.
    tokenStore.clear();
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
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

/** Filters as a query string (empty values left out). */
function queryString(f: object): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  return qs.toString();
}

export const api = {
  // auth
  login: (data: { email: string; password: string }) =>
    request<{ token: string; user: User }>("/api/auth/login", { method: "POST", body: body(data) }),
  setup: (data: { displayName: string; email: string; password: string; familyName: string }) =>
    request<{ token: string; user: User }>("/api/auth/setup", { method: "POST", body: body(data) }),
  me: () => request<Session>("/api/auth/me"),
  authConfig: () => request<AuthConfig>("/api/auth/config"),

  // one-time links (public)
  invitePreview: (token: string) => request<InvitePreview>(`/api/invites/${encodeURIComponent(token)}`),
  acceptInvite: (token: string, data: { displayName: string; email: string; password: string; familyName?: string }) =>
    request<{ token: string; user: User }>(`/api/invites/${encodeURIComponent(token)}/accept`, { method: "POST", body: body(data) }),
  resetPreview: (token: string) => request<{ displayName: string; email: string }>(`/api/password-resets/${encodeURIComponent(token)}`),
  resetPassword: (token: string, password: string) =>
    request<{ ok: true }>(`/api/password-resets/${encodeURIComponent(token)}`, { method: "POST", body: body({ password }) }),

  // own account
  updateAccount: (data: { displayName?: string; color?: string }) =>
    request<{ user: User }>("/api/account", { method: "PATCH", body: body(data) }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ token: string }>("/api/account/password", { method: "POST", body: body({ currentPassword, newPassword }) }),
  signOutEverywhere: () => request<{ ok: true }>("/api/account/sign-out-everywhere", { method: "POST" }),

  // family
  getFamily: () => request<FamilyDetails>("/api/family"),
  renameFamily: (name: string) => request<{ ok: true }>("/api/family", { method: "PATCH", body: body({ name }) }),
  createMemberInvite: (data: { role: "owner" | "member"; note?: string; expiresInDays?: number }) =>
    request<IssuedLink>("/api/family/invites", { method: "POST", body: body(data) }),
  revokeMemberInvite: (id: string) => request<void>(`/api/family/invites/${id}`, { method: "DELETE" }),
  setMemberRole: (id: string, role: "owner" | "member") =>
    request<{ ok: true }>(`/api/family/members/${id}`, { method: "PATCH", body: body({ role }) }),
  removeMember: (id: string) => request<void>(`/api/family/members/${id}`, { method: "DELETE" }),
  memberResetLink: (id: string) => request<IssuedLink>(`/api/family/members/${id}/reset-link`, { method: "POST" }),

  // trips shared between families
  tripMembers: (tripId: string) => request<TripMembers>(`/api/trips/${tripId}/members`),
  createTripInvite: (tripId: string, data: { role: "coowner" | "contributor"; note?: string; expiresInDays?: number }) =>
    request<IssuedLink>(`/api/trips/${tripId}/invites`, { method: "POST", body: body(data) }),
  revokeTripInvite: (tripId: string, inviteId: string) => request<void>(`/api/trips/${tripId}/invites/${inviteId}`, { method: "DELETE" }),
  tripInvitePreview: (token: string) => request<TripInvitePreview>(`/api/trip-invites/${encodeURIComponent(token)}`),
  acceptTripInvite: (token: string) =>
    request<{ tripId: string; role: string }>(`/api/trip-invites/${encodeURIComponent(token)}/accept`, { method: "POST" }),
  setTripMemberRole: (tripId: string, familyId: string, role: "coowner" | "contributor") =>
    request<{ ok: true }>(`/api/trips/${tripId}/members/${familyId}`, { method: "PATCH", body: body({ role }) }),
  removeTripMember: (tripId: string, familyId: string) => request<void>(`/api/trips/${tripId}/members/${familyId}`, { method: "DELETE" }),
  tripActivity: (tripId: string) => request<ActivityEntry[]>(`/api/trips/${tripId}/activity`),
  tripPeople: (tripId: string) => request<TripPerson[]>(`/api/trips/${tripId}/people`),
  /** My family's album for the trip in its Immich account; null without Immich. */
  tripAlbum: (tripId: string) => request<TripAlbum | null>(`/api/trips/${tripId}/album`),

  // the same person in two families
  personLinks: () => request<PersonLinks>("/api/person-links"),
  proposePersonLink: (personId: string, otherPersonId: string) =>
    request<{ id: string; status: string }>("/api/person-links", { method: "POST", body: body({ personId, otherPersonId }) }),
  acceptPersonLink: (id: string) => request<{ ok: true }>(`/api/person-links/${id}/accept`, { method: "POST" }),
  removePersonLink: (id: string) => request<void>(`/api/person-links/${id}`, { method: "DELETE" }),

  // server admin
  adminOverview: () => request<AdminOverview>("/api/admin/overview"),
  adminFamilyInvites: () => request<Array<{ id: string; note: string; createdAt: string; expiresAt: string }>>("/api/admin/family-invites"),
  createFamilyInvite: (data: { note?: string; expiresInDays?: number }) =>
    request<IssuedLink>("/api/admin/family-invites", { method: "POST", body: body(data) }),
  revokeFamilyInvite: (id: string) => request<void>(`/api/admin/family-invites/${id}`, { method: "DELETE" }),
  adminUpdateFamily: (id: string, data: { name?: string; disabled?: boolean }) =>
    request<{ ok: true }>(`/api/admin/families/${id}`, { method: "PATCH", body: body(data) }),
  adminDeleteFamily: (id: string, confirmName: string) =>
    request<void>(`/api/admin/families/${id}`, { method: "DELETE", body: body({ confirmName }) }),
  adminUsers: (q = "") => request<AdminUser[]>(`/api/admin/users?q=${encodeURIComponent(q)}`),
  adminUpdateUser: (id: string, data: { isAdmin?: boolean; disabled?: boolean; role?: "owner" | "member" }) =>
    request<{ ok: true }>(`/api/admin/users/${id}`, { method: "PATCH", body: body(data) }),
  adminResetLink: (id: string) => request<IssuedLink>(`/api/admin/users/${id}/reset-link`, { method: "POST" }),
  adminViewFamily: (familyId: string) =>
    request<{ token: string }>("/api/admin/view-family", { method: "POST", body: body({ familyId }) }),
  adminReturn: () => request<{ token: string }>("/api/admin/return", { method: "POST" }),
  immichAdmin: () => request<ImmichAdmin>("/api/admin/immich"),
  saveImmichServer: (url: string, adminKey?: string) =>
    request<ImmichAdmin>("/api/admin/immich", { method: "PUT", body: body(adminKey ? { url, adminKey } : { url }) }),
  checkImmich: () => request<ImmichAdmin>("/api/admin/immich/check", { method: "POST" }),
  connectImmichFamily: (familyId: string) => request<ImmichAdmin>(`/api/admin/immich/families/${familyId}/connect`, { method: "POST" }),
  linkImmichFamily: (familyId: string, apiKey: string) =>
    request<ImmichAdmin>(`/api/admin/immich/families/${familyId}/link`, { method: "POST", body: body({ apiKey }) }),
  disconnectImmichFamily: (familyId: string) => request<ImmichAdmin>(`/api/admin/immich/families/${familyId}`, { method: "DELETE" }),
  connectAllImmich: () => request<ImmichAdmin>("/api/admin/immich/connect-all", { method: "POST" }),
  syncImmichFamily: (familyId: string) => request<{ queued: true }>(`/api/admin/immich/families/${familyId}/sync`, { method: "POST" }),
  refreshImmich: () => request<{ queued: true }>("/api/immich/refresh", { method: "POST" }),
  immichStatus: () => request<ImmichStatus>("/api/immich"),
  setImmichPassword: (password: string) => request<{ ok: true }>("/api/immich/password", { method: "POST", body: body({ password }) }),
  auditLog: (before?: string) =>
    request<AuditEntry[]>(`/api/admin/audit${before ? `?before=${encodeURIComponent(before)}` : ""}`),

  // visits ("places"; the client calls them items)
  // The one map: every place my family may see (its own and on trips shared with it).
  listVisits: () => request<Item[]>("/api/visits"),
  createItem: (data: Partial<Item>) => request<Item>("/api/visits", { method: "POST", body: body(data) }),
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

  // media library
  listMedia: (f: MediaFilters = {}) => request<MediaPage>(`/api/media?${queryString(f)}`),
  mediaTimeline: (f: MediaFilters = {}) => request<MediaTimeline>(`/api/media/timeline?${queryString(f)}`),
  mediaGeo: (f: MediaFilters = {}) => request<{ points: Array<[string, number, number, MediaType]> }>(`/api/media/geo?${queryString(f)}`),
  mediaLinks: (ids: string[]) => request<Record<string, { thumbUrl: string | null; url: string }>>("/api/media/links", { method: "POST", body: body({ ids }) }),
  bulkMedia: (data: { mediaIds: string[]; hidden?: boolean; tripId?: string | null }) =>
    request<{ updated: number }>("/api/media/bulk", { method: "POST", body: body(data) }),
  setMediaHidden: (id: string, hidden: boolean) =>
    request<MediaItem>(`/api/media/${id}`, { method: "PATCH", body: body({ hidden }) }),
  mediaFor: (entity: string) => request<PickerSuggestions>(`/api/media/for?entity=${encodeURIComponent(entity)}`),
  attachMedia: (mediaIds: string[], to: string) =>
    request<{ attached: number; skipped: Array<{ id: string; reason: string }> }>("/api/media/attach", { method: "POST", body: body({ mediaIds, to }) }),
  setMediaTrip: (id: string, tripId: string | null) =>
    request<unknown>(`/api/media/${id}`, { method: "PATCH", body: body({ tripId }) }),
  getMediaSuggestions: (mediaIds: string[]) =>
    request<MediaSuggestions>("/api/media/suggestions", { method: "POST", body: body({ mediaIds }) }),
  applyMediaSuggestion: (data: { mediaIds: string[]; tripId?: string | null; visitId?: string }) =>
    request<{ applied: number }>("/api/media/apply-suggestion", { method: "POST", body: body(data) }),

  // trips: my family's and those shared with it
  listTrips: () => request<Trip[]>("/api/trips"),
  createTrip: (data: Partial<Trip>) =>
    request<Trip>("/api/trips", { method: "POST", body: body(data) }),
  updateTrip: (id: string, data: Partial<Trip>) =>
    request<Trip>(`/api/trips/${id}`, { method: "PATCH", body: body(data) }),
  deleteTrip: (id: string) => request<void>(`/api/trips/${id}`, { method: "DELETE" }),

  // itinerary
  listItinerary: (tripId: string) => request<ItineraryItem[]>(`/api/trips/${tripId}/itinerary`),
  createItineraryItem: (tripId: string, data: ItineraryInput) =>
    request<ItineraryItem>(`/api/trips/${tripId}/itinerary`, { method: "POST", body: body(data) }),
  updateItineraryItem: (id: string, data: ItineraryInput) =>
    request<ItineraryItem>(`/api/itinerary/${id}`, { method: "PATCH", body: body(data) }),
  deleteItineraryItem: (id: string) => request<void>(`/api/itinerary/${id}`, { method: "DELETE" }),
  convertItineraryItem: (id: string) =>
    request<{ visitId: string; item: ItineraryItem }>(`/api/itinerary/${id}/convert`, { method: "POST", body: body({}) }),

  // blackouts
  listBlackouts: () => request<Blackout[]>("/api/blackouts"),
  createBlackout: (data: BlackoutInput) => request<Blackout>("/api/blackouts", { method: "POST", body: body(data) }),
  updateBlackout: (id: string, data: BlackoutInput) => request<Blackout>(`/api/blackouts/${id}`, { method: "PATCH", body: body(data) }),
  deleteBlackout: (id: string) => request<void>(`/api/blackouts/${id}`, { method: "DELETE" }),

  // comments (now on visits)
  listComments: (itemId: string) => request<Comment[]>(`/api/visits/${itemId}/comments`),
  addComment: (itemId: string, body_: string) =>
    request<Comment>(`/api/visits/${itemId}/comments`, { method: "POST", body: body({ body: body_ }) }),
  deleteComment: (id: string) => request<void>(`/api/comments/${id}`, { method: "DELETE" }),

  // stats (family-scoped)
  getStats: () => request<Stats>("/api/stats"),

  // people
  listPeople: () => request<Person[]>("/api/people"),
  getPerson: (id: string) => request<Person>(`/api/people/${id}`),
  getDocument: (id: string) => request<DocumentItem>(`/api/documents/${id}`),
  getMedia: (id: string) => request<MediaItem>(`/api/media/${id}`),
  createPerson: (data: PersonInput) => request<Person>("/api/people", { method: "POST", body: body(data) }),
  updatePerson: (id: string, data: PersonInput) =>
    request<Person>(`/api/people/${id}`, { method: "PATCH", body: body(data) }),
  deletePerson: (id: string) => request<void>(`/api/people/${id}`, { method: "DELETE" }),
  listFamilyMembers: () => request<FamilyMember[]>("/api/family-members"),

  // smart search (Immich's machine learning) within the library, and smart albums
  searchMedia: (q: string, f: MediaFilters = {}, page = 1) =>
    request<{ items: MediaItem[]; nextPage: number | null }>(`/api/media/search?${queryString({ ...f, q, page } as MediaFilters)}`),
  listSmartAlbums: () => request<SmartAlbum[]>("/api/smart-albums"),
  createSmartAlbum: (name: string, filters: SmartAlbumFilters) =>
    request<SmartAlbum>("/api/smart-albums", { method: "POST", body: body({ name, filters }) }),
  updateSmartAlbum: (id: string, b: { name?: string; filters?: SmartAlbumFilters }) =>
    request<SmartAlbum>(`/api/smart-albums/${id}`, { method: "PATCH", body: body(b) }),
  deleteSmartAlbum: (id: string) => request<void>(`/api/smart-albums/${id}`, { method: "DELETE" }),

  // suggestions from photos: for=trip:<id> | visit:<id> | library
  listSuggestions: (target: string) => request<{ items: Suggestion[] }>(`/api/suggestions?for=${encodeURIComponent(target)}`),
  applySuggestion: (key: string, name?: string) =>
    request<{ tripId?: string; visitId?: string; attached?: number; linked?: boolean }>("/api/suggestions/apply", { method: "POST", body: body({ key, name }) }),
  dismissSuggestion: (key: string) => request<void>("/api/suggestions/dismiss", { method: "POST", body: body({ key }) }),

  // faces Immich found, and who they are
  listFaces: (view: FaceView = "review") => request<Face[]>(`/api/faces?view=${view}`),
  facesCount: () => request<{ review: number }>("/api/faces/count"),
  updateFace: (id: string, b: { personId?: string | null; ignored?: boolean }) =>
    request<{ face: Face; tagged: number; untagged: number }>(`/api/faces/${id}`, { method: "PATCH", body: body(b) }),
  personFromFace: (id: string, displayName: string) =>
    request<{ face: Face; personId: string; tagged: number }>(`/api/faces/${id}/person`, { method: "POST", body: body({ displayName }) }),
  personFaces: (personId: string) => request<Face[]>(`/api/people/${personId}/faces`),

  // entity graph
  getRelations: (entity: string) =>
    request<Relation[]>(`/api/relations?entity=${encodeURIComponent(entity)}`),
  searchEntities: (type: CoreType, q: string) =>
    request<EntitySummary[]>(`/api/entities/search?type=${type}&q=${encodeURIComponent(q)}`),

  // Photo and video uploads go in pieces (lib/uploads); the pieces themselves go by XHR, for progress.
  createUpload: (b: { filename: string; size: number; mime: string; lastModified?: number; caption?: string; linkTo?: string; linkRole?: string }) =>
    request<MediaUpload & { chunkSize: number }>("/api/media/uploads", { method: "POST", body: body(b) }),
  getUpload: (id: string) => request<MediaUpload>(`/api/media/uploads/${id}`),
  listUploads: () => request<{ items: MediaUpload[] }>("/api/media/uploads"),
  retryUpload: (id: string) => request<MediaUpload>(`/api/media/uploads/${id}/retry`, { method: "POST" }),
  cancelUpload: (id: string) => request<void>(`/api/media/uploads/${id}`, { method: "DELETE" }),
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
  /** GPX / KML / GeoJSON onto the map, optionally onto a trip. */
  importFile: (file: File, tripId?: string | null) => {
    const fd = new FormData();
    if (tripId) fd.append("tripId", tripId);
    fd.append("file", file);
    return request<{ imported: number; skipped: number; truncated: number }>("/api/import", { method: "POST", body: fd });
  },

  // family settings
  getSettings: () => request<FamilySettings>("/api/settings"),
  saveSettings: (settings: FamilySettings) =>
    request<FamilySettings>("/api/settings", { method: "PUT", body: body(settings) }),

  // global search
  search: (q: string) => request<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`),

  // share links (trips + albums)
  listShares: (targetType: ShareTargetType, targetId: string) =>
    request<ShareLink[]>(`/api/shares?targetType=${targetType}&targetId=${targetId}`),
  createShare: (targetType: ShareTargetType, targetId: string) =>
    request<ShareLink>("/api/shares", { method: "POST", body: body({ targetType, targetId }) }),
  deleteShare: (id: string) => request<void>(`/api/shares/${id}`, { method: "DELETE" }),
  getShare: (token: string) => request<SharePayload>(`/api/share/${token}`),

  // big downloads (server backup, a family's data): followed as a plain link
  // carrying a short-lived ticket, so the browser streams them to disk
  downloadLink: async (purpose: DownloadPurpose): Promise<string> => {
    const { url } = await request<{ url: string }>("/api/downloads/ticket", { method: "POST", body: body({ purpose }) });
    return `${API_URL}${url}`;
  },
  restoreBackup: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<{ ok: boolean; counts: Record<string, number> }>("/api/restore", { method: "POST", body: fd });
  },

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

  // documents
  listDocuments: (f: DocumentFilters = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    return request<DocumentItem[]>(`/api/documents?${qs.toString()}`);
  },
  documentsDueCount: () => request<{ count: number }>("/api/documents/due-count"),
  createDocument: (data: DocumentInput, file?: File | null) => {
    if (file) {
      const fd = new FormData();
      for (const [k, v] of Object.entries(data)) if (v !== undefined && v !== null) fd.append(k, String(v));
      fd.append("file", file);
      return request<DocumentItem>("/api/documents", { method: "POST", body: fd });
    }
    return request<DocumentItem>("/api/documents", { method: "POST", body: body(data) });
  },
  updateDocument: (id: string, data: DocumentInput) =>
    request<DocumentItem>(`/api/documents/${id}`, { method: "PATCH", body: body(data) }),
  attachDocumentFile: (id: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<DocumentItem>(`/api/documents/${id}/file`, { method: "POST", body: fd });
  },
  deleteDocument: (id: string) => request<void>(`/api/documents/${id}`, { method: "DELETE" }),

  // packing
  listPackingTemplates: () => request<PackingList[]>("/api/packing/templates"),
  getPackingList: (id: string) => request<PackingListDetail>(`/api/packing/lists/${id}`),
  getTripPacking: (tripId: string) => request<{ list: PackingListDetail | null }>(`/api/trips/${tripId}/packing`),
  createTripPacking: (tripId: string, opts: { name?: string; fromTemplateId?: string; fromTripId?: string } = {}) =>
    request<PackingListDetail>(`/api/trips/${tripId}/packing`, { method: "POST", body: body(opts) }),
  addPackingItem: (listId: string, data: { label: string; category?: string; qty?: number | null }) =>
    request<PackingItem>(`/api/packing/lists/${listId}/items`, { method: "POST", body: body(data) }),
  updatePackingItem: (id: string, data: PackingItemInput) =>
    request<PackingItem>(`/api/packing/items/${id}`, { method: "PATCH", body: body(data) }),
  deletePackingItem: (id: string) => request<void>(`/api/packing/items/${id}`, { method: "DELETE" }),
  renamePackingList: (id: string, name: string) => request<PackingList>(`/api/packing/lists/${id}`, { method: "PATCH", body: body({ name }) }),
  deletePackingList: (id: string) => request<void>(`/api/packing/lists/${id}`, { method: "DELETE" }),
  savePackingTemplate: (data: { name: string; fromListId?: string }) =>
    request<PackingListDetail>("/api/packing/templates", { method: "POST", body: body(data) }),
};

export { ApiError, API_URL };
