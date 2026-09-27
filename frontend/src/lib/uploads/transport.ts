import { api, tokenStore, UNAUTHORIZED_EVENT } from "../../api/client";
import { API_URL } from "../config";
import { ChunkError, type ResumeStore, type Transport } from "./manager";

/** The upload API, with pieces sent by XHR (fetch can't report upload progress). */
export const httpTransport: Transport = {
  create: (b) => api.createUpload(b),
  get: (id) => api.getUpload(id),
  list: () => api.listUploads(),
  retry: (id) => api.retryUpload(id),
  cancel: (id) => api.cancelUpload(id),
  putChunk: (id, offset, piece, onProgress, signal) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `${API_URL}/api/media/uploads/${id}?offset=${offset}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    const token = tokenStore.get();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      const data = xhr.response as { offset?: number; state?: string; error?: unknown } | null;
      if (xhr.status >= 200 && xhr.status < 300 && data && typeof data.offset === "number") {
        resolve(data as { offset: number; state: "receiving" | "processing" });
        return;
      }
      if (xhr.status === 401 && token) {
        tokenStore.clear();
        window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
      }
      const message = typeof data?.error === "string" ? data.error : `Upload failed (${xhr.status})`;
      reject(new ChunkError(xhr.status, message, typeof data?.offset === "number" ? data.offset : undefined));
    };
    xhr.onerror = () => reject(new ChunkError(0, "The connection dropped"));
    xhr.ontimeout = () => reject(new ChunkError(0, "The connection timed out"));
    xhr.onabort = () => reject(new ChunkError(0, "Cancelled"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(piece);
  }),
};

/** Which server upload a file belongs to, per user, in this browser. */
export function localResumeStore(userId: string): ResumeStore {
  const key = `werejugo.uploads.${userId}`;
  const read = (): Record<string, string> => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, string>;
    } catch {
      return {};
    }
  };
  const write = (m: Record<string, string>) => {
    try {
      localStorage.setItem(key, JSON.stringify(m));
    } catch {
      /* private mode or full: resuming after a reload just won't happen */
    }
  };
  return {
    get: (fp) => read()[fp] ?? null,
    set: (fp, id) => write({ ...read(), [fp]: id }),
    remove: (fp) => {
      const m = read();
      delete m[fp];
      write(m);
    },
  };
}
