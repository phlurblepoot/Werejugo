import { startFakeImmich } from "./fake-immich.js";

/**
 * Run the stand-in Immich on its own, for trying the Immich screens without a
 * real Immich server: `npm run fake-immich` (port FAKE_IMMICH_PORT, default 2283).
 * Enter the printed address and key in Admin → Immich. Everything is in memory.
 */
const port = Number(process.env.FAKE_IMMICH_PORT ?? 2283);
const fake = await startFakeImmich({ port, adminKey: process.env.FAKE_IMMICH_ADMIN_KEY ?? "fake-immich-admin-key" });
console.log(`Stand-in Immich 3.2.2 at ${fake.url}\nAdmin API key: ${fake.adminKey}`);
