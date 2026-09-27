import type { Collector } from '../core/types.js';
import { runOutsideZone, wrapOutsideZone } from '../core/zone-safe.js';

export function createLongTasksCollector(): Collector {
  let observer: PerformanceObserver | null = null;

  return {
    name: "longTasks",
    start(ctx) {
      runOutsideZone(() => {
        if (typeof PerformanceObserver === "undefined") return;
        try {
          observer = new PerformanceObserver(
            wrapOutsideZone((list: PerformanceObserverEntryList) => {
              for (const entry of list.getEntries()) {
                ctx.push("longTaskDuration", entry.duration, Date.now());
              }
            })
          );
          observer.observe({ type: "longtask", buffered: true });
        } catch {
          observer = null;
        }
      });
    },
    stop() {
      observer?.disconnect();
      observer = null;
    },
  };
}
