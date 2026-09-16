import type { Collector, CollectorContext } from '../core/types.js';
import { runOutsideZone, wrapOutsideZone } from '../core/zone-safe.js';

type LayoutShiftEntry = PerformanceEntry & { value: number; hadRecentInput: boolean };
type EventTimingEntry = PerformanceEntry & { duration: number; processingStart: number; startTime: number };

export function createWebVitalsCollector(): Collector {
  const observers: PerformanceObserver[] = [];
  let ctxRef: CollectorContext | null = null;
  let clsValue = 0;
  let inpValue = 0;

  const observe = (type: string, buffered: boolean, handler: (entry: PerformanceEntry) => void) => {
    if (typeof PerformanceObserver === "undefined") return;
    try {
      const po = new PerformanceObserver(
        wrapOutsideZone((list: PerformanceObserverEntryList) => {
          for (const entry of list.getEntries()) handler(entry);
        })
      );
      po.observe({ type, buffered });
      observers.push(po);
    } catch {
      // unsupported entry type — fail soft
    }
  };

  return {
    name: "webVitals",
    start(ctx: CollectorContext) {
      runOutsideZone(() => {
        ctxRef = ctx;

        try {
          const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
          if (nav && nav.responseStart > 0) {
            ctx.setGauge("ttfb", nav.responseStart);
          }
        } catch {
          // fail soft
        }

        observe("largest-contentful-paint", true, (entry) => {
          ctxRef?.setGauge("lcp", entry.startTime);
        });

        observe("layout-shift", true, (entry) => {
          const ls = entry as LayoutShiftEntry;
          if (!ls.hadRecentInput) {
            clsValue += ls.value;
            ctxRef?.setGauge("cls", Number(clsValue.toFixed(4)));
          }
        });

        observe("event", true, (entry) => {
          const ev = entry as EventTimingEntry;
          const duration = ev.duration;
          if (duration > inpValue) {
            inpValue = duration;
            ctxRef?.setGauge("inp", duration);
          }
        });

        observe("first-input", true, (entry) => {
          const fi = entry as EventTimingEntry;
          if (inpValue === 0 && fi.processingStart) {
            const fid = fi.processingStart - fi.startTime;
            ctxRef?.setGauge("inp", fid);
          }
        });
      });
    },
    stop() {
      for (const po of observers) {
        try { po.disconnect(); } catch { /* ignore */ }
      }
      observers.length = 0;
      ctxRef = null;
    },
  };
}
