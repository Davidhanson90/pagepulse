import type { Collector } from '../core/types.js';
import {
  ResourceStore,
  rowFromPerformanceEntry,
  type ResourceTimingRow
} from '../core/resources.js';
import { runOutsideZone, wrapOutsideZone } from '../core/zone-safe.js';

export interface ResourcesWaterfallCollectorOptions {
  store: ResourceStore;
  firstPartyDomains?: string[];
  /** Clear the buffer when a soft navigation is observed (best-effort). */
  clearOnSoftNav?: boolean;
}

export function createResourcesWaterfallCollector(
  options: ResourcesWaterfallCollectorOptions
): Collector {
  const { store, firstPartyDomains = [], clearOnSoftNav = true } = options;
  let observer: PerformanceObserver | null = null;
  let softNavObserver: PerformanceObserver | null = null;
  let onPopState: (() => void) | null = null;
  let seen = new Set<string>();

  const keyFor = (entry: PerformanceResourceTiming): string =>
    `${entry.startTime}|${entry.responseEnd}|${entry.name}|${entry.initiatorType}`;

  const ingest = (entry: PerformanceResourceTiming) => {
    const key = keyFor(entry);
    if (seen.has(key)) return;
    seen.add(key);
    // Cap seen-set growth alongside the buffer
    if (seen.size > 2000) {
      seen = new Set([...seen].slice(-1000));
    }
    try {
      const row: ResourceTimingRow = rowFromPerformanceEntry(entry, firstPartyDomains);
      store.add(row);
    } catch {
      // fail soft
    }
  };

  const clearBuffer = () => {
    seen.clear();
    store.clear();
  };

  return {
    name: 'resources-waterfall',
    start(ctx) {
      void ctx;
      runOutsideZone(() => {
        seen.clear();

        if (typeof PerformanceObserver !== 'undefined') {
          try {
            observer = new PerformanceObserver(
              wrapOutsideZone((list: PerformanceObserverEntryList) => {
                for (const entry of list.getEntries()) {
                  ingest(entry as PerformanceResourceTiming);
                }
              })
            );
            observer.observe({ type: 'resource', buffered: true });
          } catch {
            observer = null;
          }

          if (clearOnSoftNav) {
            try {
              softNavObserver = new PerformanceObserver(
                wrapOutsideZone(() => {
                  clearBuffer();
                })
              );
              softNavObserver.observe({ type: 'soft-navigations', buffered: false });
            } catch {
              softNavObserver = null;
            }
          }
        }

        // Seed from the existing resource timeline when available
        try {
          const existing = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
          for (const entry of existing) ingest(entry);
        } catch {
          // fail soft
        }

        if (clearOnSoftNav && typeof window !== 'undefined') {
          onPopState = wrapOutsideZone(() => clearBuffer());
          window.addEventListener('popstate', onPopState);
        }
      });
    },
    stop() {
      observer?.disconnect();
      observer = null;
      softNavObserver?.disconnect();
      softNavObserver = null;
      if (onPopState) {
        window.removeEventListener('popstate', onPopState);
        onPopState = null;
      }
      seen.clear();
    }
  };
}
