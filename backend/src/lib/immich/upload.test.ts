import { createServer, type Server } from "node:http";
import { afterEach, expect, test } from "vitest";
import { ImmichError, immich } from "./client.js";

/** Hand-made Immich stand-ins for what the stand-in can't easily do. */
let server: Server | null = null;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

async function serve(handler: Parameters<typeof createServer>[1]): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

const meta = { filename: 'odd "name".jpg', fileCreatedAt: "2024-01-01T00:00:00.000Z", fileModifiedAt: "2024-01-01T00:00:00.000Z" };

test("the upload is one multipart request with the file's own name, its dates and the key", async () => {
  let seen = { headers: {} as Record<string, unknown>, body: "" };
  const url = await serve((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => {
      seen = { headers: req.headers, body: Buffer.concat(chunks).toString("latin1") };
      res.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify({ id: "a1", status: "created" }));
    });
  });
  const r = await immich.uploadAsset({ url, key: "family-key" }, new Blob([Buffer.from("JPEGBYTES")], { type: "image/jpeg" }), meta);
  expect(r).toEqual({ id: "a1", status: "created" });
  expect(seen.headers["x-api-key"]).toBe("family-key");
  expect(Number(seen.headers["content-length"])).toBe(Buffer.byteLength(seen.body, "latin1"));
  expect(seen.body).toContain('name="assetData"; filename="odd _name_.jpg"\r\nContent-Type: image/jpeg\r\n\r\nJPEGBYTES\r\n');
  expect(seen.body).toContain('name="fileCreatedAt"\r\n\r\n2024-01-01T00:00:00.000Z\r\n');
});

test("Immich refusing the file before reading it all is reported with its reason", async () => {
  const url = await serve((_req, res) => {
    res.writeHead(400, { "content-type": "application/json", connection: "close" }).end(JSON.stringify({ message: "Unsupported file type odd.jpg" }));
  });
  const err = await immich.uploadAsset({ url, key: "k" }, new Blob([Buffer.alloc(8 * 1024 * 1024)]), meta).catch((e) => e);
  expect(err).toBeInstanceOf(ImmichError);
  expect(err).toMatchObject({ kind: "rejected", status: 400, message: "Unsupported file type odd.jpg" });
});

test("an upload that takes too long is reported as Immich not answering", async () => {
  const url = await serve(() => { /* never answers */ });
  const err = await immich.uploadAsset({ url, key: "k" }, new Blob(["x"]), meta, { timeoutMs: 200 }).catch((e) => e);
  expect(err).toMatchObject({ kind: "unreachable" });
  expect(err.message).toMatch(/didn't answer within/);
});
