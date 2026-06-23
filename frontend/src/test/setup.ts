import "@testing-library/jest-dom/vitest";

// jsdom does not implement object URL APIs; stub them for components that
// create previews from selected files (e.g. VisitPhotos).
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => "blob:mock";
}
if (typeof URL.revokeObjectURL !== "function") {
  URL.revokeObjectURL = () => {};
}
