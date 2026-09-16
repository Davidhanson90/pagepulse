import type { Collector } from '../core/types.js';
import { runOutsideZone, wrapOutsideZone } from '../core/zone-safe.js';

/** Chrome LoAF entry fields (partial). */
type LoAFEntry = PerformanceEntry & {
  duration: number;
  styleAndLayoutStart?: number;
  renderStart?: number;
  scripts?: Array<{ duration: number }>;
};

export function createLoafCollector(): Collector {
  let observer: PerformanceObserver | null = null;

  return {
    name: 'loaf',
    start(ctx) {
      runOutsideZone(() => {
        if (typeof PerformanceObserver === 'undefined') return;
        try {
          observer = new PerformanceObserver(
            wrapOutsideZone((list: PerformanceObserverEntryList) => {
              for (const entry of list.getEntries()) {
                const loaf = entry as LoAFEntry;
                ctx.push('loafDuration', loaf.duration, Date.now());

                if (Array.isArray(loaf.scripts) && loaf.scripts.length > 0) {
                  let scriptTotal = 0;
                  for (const s of loaf.scripts) {
                    scriptTotal += s.duration || 0;
                  }
                  ctx.push('loafScriptDuration', scriptTotal, Date.now());
                }

                // Approximate style/layout work when timing marks are present.
                if (
                  typeof loaf.styleAndLayoutStart === 'number' &&
                  typeof loaf.renderStart === 'number' &&
                  loaf.renderStart > loaf.styleAndLayoutStart
                ) {
                  ctx.push(
                    'loafStyleDuration',
                    loaf.renderStart - loaf.styleAndLayoutStart,
                    Date.now()
                  );
                }
              }
            })
          );
          observer.observe({ type: 'long-animation-frame', buffered: true });
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
