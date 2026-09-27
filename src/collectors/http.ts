import type { Collector, CollectorContext } from '../core/types.js';
import { runOutsideZone, wrapOutsideZone } from '../core/zone-safe.js';

type ResourceType = "script" | "css" | "img" | "fetch" | "other";

function classifyInitiator(type: string, name: string): ResourceType {
  const t = type.toLowerCase();
  if (t === "script") return "script";
  if (t === "css" || t === "link") return "css";
  if (t === "img" || t === "image") return "img";
  if (t === "fetch" || t === "xmlhttprequest") return "fetch";
  if (/\\.js(\\?|$)/i.test(name)) return "script";
  if (/\\.css(\\?|$)/i.test(name)) return "css";
  if (/\\.(png|jpe?g|gif|webp|svg|avif)(\\?|$)/i.test(name)) return "img";
  return "other";
}

export function createHttpCollector(): Collector {
  let inFlight = 0;
  let observer: PerformanceObserver | null = null;
  let ctxRef: CollectorContext | null = null;
  let originalFetch: typeof fetch | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let xhrOpen: ((this: XMLHttpRequest, ...args: any[]) => void) | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let xhrSend: ((this: XMLHttpRequest, ...args: any[]) => void) | null = null;
  const counts = { script: 0, css: 0, img: 0, fetch: 0 };

  const bumpInFlight = (delta: number) => {
    inFlight = Math.max(0, inFlight + delta);
    ctxRef?.setGauge("httpInFlight", inFlight);
  };

  const onResource = (entry: PerformanceResourceTiming) => {
    const size = entry.transferSize || entry.encodedBodySize || 0;
    if (size > 0) ctxRef?.push("requestSize", size);
    const kind = classifyInitiator(entry.initiatorType, entry.name);
    if (kind === "script") counts.script++;
    else if (kind === "css") counts.css++;
    else if (kind === "img") counts.img++;
    else if (kind === "fetch") counts.fetch++;
  };

  return {
    name: "http",
    start(ctx) {
      runOutsideZone(() => {
        ctxRef = ctx;
        ctx.setGauge("httpInFlight", 0);

        if (typeof PerformanceObserver !== "undefined") {
          try {
            observer = new PerformanceObserver(
              wrapOutsideZone((list: PerformanceObserverEntryList) => {
                for (const entry of list.getEntries()) {
                  onResource(entry as PerformanceResourceTiming);
                }
              })
            );
            observer.observe({ type: "resource", buffered: true });
          } catch {
            observer = null;
          }
        }

        if (typeof fetch === "function") {
          originalFetch = fetch;
          const bound = originalFetch.bind(globalThis);
          globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
            runOutsideZone(() => bumpInFlight(1));
            try {
              return await bound(...args);
            } finally {
              runOutsideZone(() => bumpInFlight(-1));
            }
          };
        }

        if (typeof XMLHttpRequest !== "undefined") {
          xhrOpen = XMLHttpRequest.prototype.open;
          xhrSend = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
            (this as XMLHttpRequest & { __veTracked?: boolean }).__veTracked = true;
            return xhrOpen!.apply(this, args as never);
          } as typeof XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: unknown[]) {
            const xhr = this as XMLHttpRequest & { __veTracked?: boolean };
            if (xhr.__veTracked) {
              runOutsideZone(() => bumpInFlight(1));
              const done = wrapOutsideZone(() => {
                xhr.removeEventListener("loadend", done);
                bumpInFlight(-1);
              });
              xhr.addEventListener("loadend", done);
            }
            return xhrSend!.apply(this, args as never);
          } as typeof XMLHttpRequest.prototype.send;
        }
      });
    },
    sample(ctx) {
      ctx.setGauge("httpInFlight", inFlight);
      ctx.setGauge("resourceScript", counts.script);
      ctx.setGauge("resourceCss", counts.css);
      ctx.setGauge("resourceImg", counts.img);
      ctx.setGauge("resourceFetch", counts.fetch);
    },
    stop() {
      observer?.disconnect();
      observer = null;
      if (originalFetch) {
        globalThis.fetch = originalFetch;
        originalFetch = null;
      }
      if (xhrOpen) {
        XMLHttpRequest.prototype.open = xhrOpen as typeof XMLHttpRequest.prototype.open;
        xhrOpen = null;
      }
      if (xhrSend) {
        XMLHttpRequest.prototype.send = xhrSend as typeof XMLHttpRequest.prototype.send;
        xhrSend = null;
      }
      ctxRef = null;
    },
  };
}
