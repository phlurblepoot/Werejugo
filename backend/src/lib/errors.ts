import type { FastifyError, FastifyInstance } from "fastify";
import { ZodError } from "zod";

/** An error with an HTTP status that is safe to show to the user. */
export class HttpError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

export const badRequest = (message = "Invalid request") => new HttpError(400, message);
export const forbidden = (message = "You can't do that") => new HttpError(403, message);
export const notFound = (message = "Not found") => new HttpError(404, message);
export const conflict = (message = "That already exists") => new HttpError(409, message);
/** An outside service Werejugo needs isn't answering (say what to do instead). */
export const unavailable = (message = "Try again in a moment") => new HttpError(503, message);

// Postgres error codes that mean "the input was wrong", not "the server broke".
const PG_BAD_INPUT = new Set(["22P02", "22007", "22008", "22003", "22001", "23514", "23502"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/**
 * Turn every error into a clear 4xx where the request was at fault, and a
 * generic 500 (details only in the log) where it wasn't. Also: any route
 * parameter named `id` or `…Id` must be a UUID, or the route answers 404
 * before touching the database.
 */
export function installErrorHandling(app: FastifyInstance): void {
  app.addHook("preValidation", async (req) => {
    const params = req.params as Record<string, unknown> | undefined;
    if (!params) return;
    for (const [key, value] of Object.entries(params)) {
      if ((key === "id" || key.endsWith("Id")) && !isUuid(value)) throw notFound();
    }
  });

  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
    if (err instanceof ZodError) return reply.code(400).send({ error: err.flatten() });

    const pgCode = (err as { code?: unknown }).code;
    if (typeof pgCode === "string" && /^[0-9A-Z]{5}$/.test(pgCode) && "severity" in err) {
      if (PG_BAD_INPUT.has(pgCode)) return reply.code(400).send({ error: "Some of the values aren't valid" });
      if (pgCode === "23503") return reply.code(400).send({ error: "That refers to something that doesn't exist" });
      if (pgCode === "23505") return reply.code(409).send({ error: "That already exists" });
    }

    // Fastify's own client errors (bad JSON, empty body, payload too large, multipart limits…).
    const status = (err as FastifyError).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.code(status).send({ error: err.message });
    }

    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: "Something went wrong on the server" });
  });
}
