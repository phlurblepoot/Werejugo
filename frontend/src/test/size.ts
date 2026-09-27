import { afterEach, beforeEach } from "vitest";

/**
 * jsdom lays nothing out, so windowed lists (the photo timeline) see a 0×0
 * viewport. Give every element a size for the tests in the calling file.
 */
export function withElementSize(width = 800, height = 600) {
  const proto = HTMLElement.prototype;
  const saved = {
    rect: Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect"),
    cw: Object.getOwnPropertyDescriptor(proto, "clientWidth"),
    ch: Object.getOwnPropertyDescriptor(proto, "clientHeight"),
    ow: Object.getOwnPropertyDescriptor(proto, "offsetWidth"),
    oh: Object.getOwnPropertyDescriptor(proto, "offsetHeight"),
    sh: Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight"),
    st: Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop"),
    scrollTo: Element.prototype.scrollTo,
  };
  beforeEach(() => {
    Element.prototype.getBoundingClientRect = () => ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    for (const [k, v] of [["clientWidth", width], ["clientHeight", height], ["offsetWidth", width], ["offsetHeight", height]] as const) {
      Object.defineProperty(proto, k, { configurable: true, get: () => v });
    }
    // Content can be taller than the view (windowed lists size their own canvas).
    Object.defineProperty(Element.prototype, "scrollHeight", { configurable: true, get: () => 50_000_000 });
    // Scrolling: remember the position and tell listeners, as a browser would.
    const pos = new WeakMap<Element, number>();
    Object.defineProperty(Element.prototype, "scrollTop", {
      configurable: true, get(this: Element) { return pos.get(this) ?? 0; }, set(this: Element, v: number) { pos.set(this, v); },
    });
    Element.prototype.scrollTo = function (this: Element, a?: ScrollToOptions | number, b?: number) {
      this.scrollTop = typeof a === "number" ? (b ?? 0) : a?.top ?? this.scrollTop;
      this.dispatchEvent(new Event("scroll"));
    } as Element["scrollTo"];
  });
  afterEach(() => {
    if (saved.rect) Object.defineProperty(Element.prototype, "getBoundingClientRect", saved.rect);
    if (saved.st) Object.defineProperty(Element.prototype, "scrollTop", saved.st);
    if (saved.sh) Object.defineProperty(Element.prototype, "scrollHeight", saved.sh);
    Element.prototype.scrollTo = saved.scrollTo;
    for (const [k, d] of [["clientWidth", saved.cw], ["clientHeight", saved.ch], ["offsetWidth", saved.ow], ["offsetHeight", saved.oh]] as const) {
      if (d) Object.defineProperty(proto, k, d);
      else delete (proto as unknown as Record<string, unknown>)[k];
    }
  });
}
