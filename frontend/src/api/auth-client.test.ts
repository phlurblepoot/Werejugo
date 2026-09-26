import { afterEach, expect, test, vi } from "vitest";
import { api, tokenStore, UNAUTHORIZED_EVENT } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const reply = (status: number, body: unknown = { error: "nope" }) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

test("a 401 on a signed-in request ends the session", async () => {
  tokenStore.set("stale");
  vi.stubGlobal("fetch", reply(401));
  const heard = vi.fn();
  window.addEventListener(UNAUTHORIZED_EVENT, heard);
  await expect(api.listTrips("")).rejects.toThrow("nope");
  window.removeEventListener(UNAUTHORIZED_EVENT, heard);
  expect(heard).toHaveBeenCalledTimes(1);
  expect(tokenStore.get()).toBeNull();
});

test("a wrong password on the sign-in form is just an error, not a sign-out", async () => {
  vi.stubGlobal("fetch", reply(401, { error: "Wrong email or password" }));
  const heard = vi.fn();
  window.addEventListener(UNAUTHORIZED_EVENT, heard);
  await expect(api.login({ email: "a@b.c", password: "x" })).rejects.toThrow("Wrong email or password");
  window.removeEventListener(UNAUTHORIZED_EVENT, heard);
  expect(heard).not.toHaveBeenCalled();
});
