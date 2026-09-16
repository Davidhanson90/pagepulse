import type { Collector, CollectorContext } from '../core/types.js';
import { runOutsideZone, wrapOutsideZone } from '../core/zone-safe.js';

export function createNavigationCollector(): Collector {
  const observers: PerformanceObserver[] = [];
  let ctxRef: CollectorContext | null = null;
  let softNavCount = 0;
  let softNavStart = 0;
  let originalPushState: History['pushState'] | null = null;
  let originalReplaceState: History['replaceState'] | null = null;
  let onPopState: ((ev: PopStateEvent) => void) | null = null;

  const observe = (type: string, buffered: boolean, handler: (entry: PerformanceEntry) => void) => {
    if (typeof PerformanceObserver === 'undefined') return;
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

  const markSoftNav = (source: 'history' | 'observer', duration?: number) => {
    softNavCount += 1;
    ctxRef?.setGauge('softNavCount', softNavCount);
    if (typeof duration === 'number' && duration >= 0) {
      ctxRef?.push('softNavDuration', duration, Date.now());
    } else if (source === 'history' && softNavStart > 0) {
      const elapsed = performance.now() - softNavStart;
      if (elapsed > 0 && elapsed < 60_000) {
        ctxRef?.push('softNavDuration', elapsed, Date.now());
      }
    }
    softNavStart = performance.now();
  };

  const hookHistory = () => {
    if (typeof history === 'undefined') return;
    originalPushState = history.pushState;
    originalReplaceState = history.replaceState;

    history.pushState = (...args: Parameters<History['pushState']>) => {
      const result = originalPushState!.apply(history, args);
      runOutsideZone(() => markSoftNav('history'));
      return result;
    };
    history.replaceState = (...args: Parameters<History['replaceState']>) => {
      const result = originalReplaceState!.apply(history, args);
      runOutsideZone(() => markSoftNav('history'));
      return result;
    };

    onPopState = wrapOutsideZone(() => markSoftNav('history')) as (ev: PopStateEvent) => void;
    window.addEventListener('popstate', onPopState);
  };

  return {
    name: 'navigation',
    start(ctx) {
      runOutsideZone(() => {
        ctxRef = ctx;
        softNavCount = 0;
        softNavStart = 0;
        ctx.setGauge('softNavCount', 0);

        try {
          const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
          if (nav) {
            if (nav.domContentLoadedEventEnd > 0) {
              ctx.setGauge('navDomContentLoaded', nav.domContentLoadedEventEnd);
            }
            if (nav.loadEventEnd > 0) {
              ctx.setGauge('navLoad', nav.loadEventEnd);
            }
          }
        } catch {
          // fail soft
        }

        observe('soft-navigations', true, (entry) => {
          const duration = entry.duration > 0 ? entry.duration : undefined;
          markSoftNav('observer', duration);
        });

        try {
          hookHistory();
        } catch {
          // fail soft
        }
      });
    },
    stop() {
      for (const po of observers) {
        try {
          po.disconnect();
        } catch {
          /* ignore */
        }
      }
      observers.length = 0;

      if (originalPushState) {
        history.pushState = originalPushState;
        originalPushState = null;
      }
      if (originalReplaceState) {
        history.replaceState = originalReplaceState;
        originalReplaceState = null;
      }
      if (onPopState) {
        window.removeEventListener('popstate', onPopState);
        onPopState = null;
      }
      ctxRef = null;
    },
  };
}
