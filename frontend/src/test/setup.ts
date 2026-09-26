import "@testing-library/jest-dom/vitest";

// jsdom does not implement object URL APIs; stub them for components that
// create previews from selected files (e.g. VisitPhotos).
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => "blob:mock";
}
if (typeof URL.revokeObjectURL !== "function") {
  URL.revokeObjectURL = () => {};
}

// Radix UI (dialogs, menus) uses browser APIs jsdom doesn't implement.
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
const proto = Element.prototype as unknown as Record<string, unknown>;
proto.hasPointerCapture ??= () => false;
proto.releasePointerCapture ??= () => {};
proto.setPointerCapture ??= () => {};
proto.scrollIntoView ??= () => {};
