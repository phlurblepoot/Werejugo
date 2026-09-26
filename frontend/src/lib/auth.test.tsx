import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
const h = vi.hoisted(() => ({
  me: vi.fn(async () => ({ user: { displayName: "Pat" }, family: { id: "f1", name: "Fam" }, adminView: null })),
  login: vi.fn(async () => ({ token: "t2" })),
}));
vi.mock("../api/client", async (orig) => {
  const real = await orig<typeof import("../api/client")>();
  return { ...real, api: h };
});
import { tokenStore, UNAUTHORIZED_EVENT } from "../api/client";
import { AuthProvider, useAuth } from "./auth";

function Probe() {
  const { user, loading, logout, login } = useAuth();
  if (loading) return <p>loading</p>;
  return (
    <>
      <p>{user ? `signed in as ${user.displayName}` : "signed out"}</p>
      <button onClick={logout}>out</button>
      <button onClick={() => void login("a@b.c", "pw")}>in</button>
    </>
  );
}

function setup() {
  const qc = new QueryClient();
  qc.setQueryData(["trips"], [{ id: "secret" }]);
  render(<QueryClientProvider client={qc}><AuthProvider><Probe /></AuthProvider></QueryClientProvider>);
  return qc;
}

beforeEach(() => localStorage.clear());

test("a 401 from any request signs the user out and drops cached data", async () => {
  tokenStore.set("t1");
  const qc = setup();
  expect(await screen.findByText("signed in as Pat")).toBeInTheDocument();
  qc.setQueryData(["trips"], [{ id: "secret" }]);
  act(() => { window.dispatchEvent(new Event(UNAUTHORIZED_EVENT)); });
  expect(await screen.findByText("signed out")).toBeInTheDocument();
  expect(qc.getQueryData(["trips"])).toBeUndefined();
  expect(tokenStore.get()).toBeNull();
});

test("signing out and in never carries the previous account's cache", async () => {
  tokenStore.set("t1");
  const qc = setup();
  await screen.findByText("signed in as Pat");
  act(() => screen.getByText("out").click());
  expect(qc.getQueryData(["trips"])).toBeUndefined();
  qc.setQueryData(["trips"], [{ id: "left-over" }]);
  act(() => screen.getByText("in").click());
  await waitFor(() => expect(tokenStore.get()).toBe("t2"));
  expect(qc.getQueryData(["trips"])).toBeUndefined();
});
