import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { UploadTray, formatBytes } from "./UploadTray";
import { fakeUploads, withUploads } from "../test/uploads";

const jpg = (name: string, bytes = 3) => new File(["x".repeat(bytes)], name, { type: "image/jpeg" });

test("nothing shows until something is uploading", () => {
  const { container } = render(withUploads(<UploadTray />));
  expect(container).toBeEmptyDOMElement();
});

test("each file shows its progress and outcome; a batch ends as 'N uploaded'", async () => {
  const { manager, transport } = fakeUploads((name, i) => ({ id: `m${i}`, kind: "image", url: "/p", thumbUrl: "/t", caption: "", duplicate: name === "dup.jpg" }));
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const put = transport.putChunk as ReturnType<typeof vi.fn>;
  const real = put.getMockImplementation()!;
  put.mockImplementation(async (...args: unknown[]) => {
    (args[3] as (n: number) => void)(1); // one byte on its way
    await gate;
    return real(...args);
  });
  render(withUploads(<UploadTray />, manager));
  act(() => { manager.add([jpg("beach.jpg"), jpg("dup.jpg")]); });

  const tray = await screen.findByRole("region", { name: "Uploads" });
  expect(await within(tray).findAllByText(/Sending 1 B of 3 B/)).toHaveLength(2);
  expect(within(tray).getByText(/0 of 2 uploaded/)).toBeInTheDocument();
  expect(within(tray).getByRole("progressbar", { name: "All uploads" })).toHaveAttribute("aria-valuenow", "33");

  await act(async () => { release(); });
  await waitFor(() => expect(within(tray).getByText("2 uploaded", { selector: "strong" })).toBeInTheDocument());
  expect(within(tray).getByText("Added")).toBeInTheDocument();
  expect(within(tray).getByText("Already in your library")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("2 uploaded");

  fireEvent.click(within(tray).getByRole("button", { name: "Clear finished" }));
  expect(screen.queryByRole("region", { name: "Uploads" })).toBeNull();
});

test("a failed file shows why, with Retry when it can be tried again", async () => {
  const { manager, transport } = fakeUploads();
  (transport.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    id: "up1", filename: "far.jpg", size: 3, offset: 3, state: "failed", duplicate: false,
    error: "Couldn't reach Immich. Try again in a few minutes.", canRetry: true, media: null,
  });
  (transport.retry as ReturnType<typeof vi.fn>).mockResolvedValue({});
  render(withUploads(<UploadTray />, manager));
  act(() => { manager.add([jpg("far.jpg")]); });
  expect(await screen.findByText("Couldn't reach Immich. Try again in a few minutes.")).toBeInTheDocument();
  expect(screen.getByText(/0 uploaded · 1 needs attention/)).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("1 upload failed");

  fireEvent.click(screen.getByRole("button", { name: "Retry far.jpg" }));
  await waitFor(() => expect(screen.getByText("Added")).toBeInTheDocument());
  expect(transport.retry).toHaveBeenCalledWith("up1");
});

test("an upload interrupted by a reload asks for its file again, and refuses a different one", async () => {
  const { manager, transport } = fakeUploads();
  (transport.list as ReturnType<typeof vi.fn>).mockResolvedValue({
    items: [{ id: "up7", filename: "long-video.mp4", size: 10, offset: 4, state: "receiving", duplicate: false, error: null, canRetry: false, media: null }],
  });
  render(withUploads(<UploadTray />, manager));
  await act(async () => { await manager.restore(); });
  expect(screen.getByText(/Paused at 40%\. Choose the file again to finish\./)).toBeInTheDocument();

  const input = screen.getByTestId("upload-resume-input");
  fireEvent.click(screen.getByRole("button", { name: "Choose long-video.mp4 again" }));
  fireEvent.change(input, { target: { files: [new File(["x"], "other.mp4")] } });
  expect(screen.getByRole("alert")).toHaveTextContent(/different file/);

  (transport.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: "up7", filename: "long-video.mp4", size: 10, offset: 4, state: "receiving", duplicate: false, error: null, canRetry: false, media: null });
  fireEvent.click(screen.getByRole("button", { name: "Choose long-video.mp4 again" }));
  fireEvent.change(input, { target: { files: [new File(["0123456789"], "long-video.mp4")] } });
  await waitFor(() => expect(transport.putChunk).toHaveBeenCalledWith("up7", 4, expect.anything(), expect.any(Function), expect.anything()));
});

test("the list can be tucked away", async () => {
  const { manager } = fakeUploads();
  render(withUploads(<UploadTray />, manager));
  await act(async () => { await manager.add([jpg("a.jpg")]).done; });
  fireEvent.click(screen.getByRole("button", { name: "Hide uploads" }));
  expect(screen.queryByText("a.jpg")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show uploads" }));
  expect(screen.getByText("a.jpg")).toBeInTheDocument();
});

test("sizes read naturally", () => {
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(2048)).toBe("2 KB");
  expect(formatBytes(3.4 * 1024 * 1024)).toBe("3.4 MB");
  expect(formatBytes(250 * 1024 * 1024)).toBe("250 MB");
  expect(formatBytes(2.5 * 1024 ** 3)).toBe("2.5 GB");
});
