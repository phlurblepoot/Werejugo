import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Item, type Trip, type User } from "../api/client";
import { KIND_LABELS } from "../lib/style";
import { renderMarkdown } from "../lib/markdown";
import { MediaThumb } from "./MediaThumb";

interface Props {
  item: Item;
  trips: Trip[];
  user: User;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
  onOpenLightbox: (index: number) => void;
}

export function ItemDetail({ item, trips, user, onEdit, onDelete, onClose, onOpenLightbox }: Props) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const trip = trips.find((t) => t.id === item.tripId);
  const p = (item.properties ?? {}) as Record<string, string>;
  const cruiseMeta = [p.cruiseLine, p.ship].filter(Boolean).join(" · ") || null;

  const commentsQuery = useQuery({
    queryKey: ["comments", item.id],
    queryFn: () => api.listComments(item.id),
  });

  const addComment = useMutation({
    mutationFn: (body: string) => api.addComment(item.id, body),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["comments", item.id] });
    },
  });
  const delComment = useMutation({
    mutationFn: (id: string) => api.deleteComment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comments", item.id] }),
  });

  const comments = commentsQuery.data ?? [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <h2 style={{ flex: 1 }}>{item.title}</h2>
          <button className="ghost" onClick={onClose} aria-label="Close" title="Close">✕</button>
        </div>

        <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12 }}>
          {KIND_LABELS[item.kind]}
          {item.occurredOn ? ` · ${item.occurredOn}` : ""}
          {trip ? <span className="tag" style={{ background: trip.color, color: "#fff" }}>{trip.name}</span> : null}
          {item.createdByName ? ` · added by ${item.createdByName}` : ""}
          {cruiseMeta && <div style={{ marginTop: 2 }}>{cruiseMeta}</div>}
        </div>

        {item.photos.length > 0 && (
          <div className="photo-grid" style={{ marginBottom: 12 }}>
            {item.photos.map((p, i) => (
              <div key={p.id} className="photo-tile" onClick={() => onOpenLightbox(i)} style={{ cursor: "pointer" }}>
                <MediaThumb photo={p} />
              </div>
            ))}
          </div>
        )}

        {item.notes && (
          <div
            className="markdown"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(item.notes) }}
          />
        )}

        {item.waypoints.length > 0 && (
          <div className="field">
            <label>Stops</label>
            <div style={{ fontSize: 13 }}>{item.waypoints.map((w) => w.label).join("  →  ")}</div>
          </div>
        )}

        <div className="section-title"><span>Comments ({comments.length})</span></div>
        {comments.map((c) => (
          <div key={c.id} className="comment">
            <div className="comment-body">{c.body}</div>
            <div className="comment-meta">
              {c.author ?? "Someone"} · {new Date(c.createdAt).toLocaleDateString()}
              {c.userId === user.id && (
                <button className="ghost" onClick={() => delComment.mutate(c.id)}>delete</button>
              )}
            </div>
          </div>
        ))}
        <div className="row" style={{ marginTop: 8 }}>
          <input
            value={draft}
            placeholder="Add a comment…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && draft.trim() && addComment.mutate(draft.trim())}
          />
          <button
            style={{ flex: "0 0 auto" }}
            disabled={!draft.trim() || addComment.isPending}
            onClick={() => draft.trim() && addComment.mutate(draft.trim())}
          >
            Post
          </button>
        </div>

        <div className="modal-actions">
          {confirmingDelete ? (
            <>
              <span style={{ marginRight: "auto", alignSelf: "center", color: "#fca5a5", fontSize: 13 }}>
                Delete this item?
              </span>
              <button onClick={() => setConfirmingDelete(false)}>Cancel</button>
              <button className="danger" onClick={onDelete}>Yes, delete</button>
            </>
          ) : (
            <>
              <button className="danger" onClick={() => setConfirmingDelete(true)} style={{ marginRight: "auto" }}>
                Delete item
              </button>
              <button onClick={onClose}>Close</button>
              <button className="primary" onClick={onEdit}>Edit</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
