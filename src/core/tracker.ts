import type { Collector, CollectorOptions, SnapshotListener, TrackerOptions } from './types.js';
import { snapshotToTable, seriesToTable, resourcesToTable, type DataTable } from './data-table.js';
import { MetricStore } from './store.js';
import { ResourceStore, type ResourceListener, type ResourceTimingRow } from './resources.js';
import { createHttpCollector } from '../collectors/http.js';
import { createLongTasksCollector } from '../collectors/long-tasks.js';
import { createDomCollector } from '../collectors/dom.js';
import { createWebVitalsCollector } from '../collectors/web-vitals.js';
import { createMemoryCollector } from '../collectors/memory.js';
import { createFpsCollector } from '../collectors/fps.js';
import { createLoafCollector } from '../collectors/loaf.js';
import { createConnectionCollector } from '../collectors/connection.js';
import { createNavigationCollector } from '../collectors/navigation.js';
import { createErrorsCollector } from '../collectors/errors.js';
import { createResourcesWaterfallCollector } from '../collectors/resources-waterfall.js';
import { runOutsideZone, zoneSafeClearInterval, zoneSafeSetInterval } from './zone-safe.js';

const DEFAULT_COLLECTORS: Required<CollectorOptions> = {
  http: true,
  longTasks: true,
  dom: true,
  webVitals: true,
  memory: true,
  fps: true,
  loaf: true,
  connection: true,
  navigation: true,
  errors: true,
  resources: true,
};

export class PagepulseTracker {
  private store: MetricStore;
  private resourceStore: ResourceStore;
  private collectors: Collector[] = [];
  private sampleIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private options: TrackerOptions;

  constructor(options: TrackerOptions = {}) {
    this.options = options;
    this.sampleIntervalMs = options.sampleIntervalMs ?? 1000;
    const retentionMs = options.retentionMs ?? 5 * 60 * 1000;
    this.store = new MetricStore(retentionMs);
    this.resourceStore = new ResourceStore({
      retentionMs,
      maxEntries: options.maxResourceEntries ?? 150,
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.collectors = this.buildCollectors();
    // Schedule collectors + sample loop outside Angular's zone when Zone.js is present.
    runOutsideZone(() => {
      const ctx = this.createContext();
      for (const c of this.collectors) {
        try {
          c.start(ctx);
        } catch {
          // fail soft
        }
      }
      this.timer = zoneSafeSetInterval(() => this.tick(), this.sampleIntervalMs);
      this.tick();
    });
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      zoneSafeClearInterval(this.timer);
      this.timer = null;
    }
    for (const c of this.collectors) {
      try {
        c.stop();
      } catch {
        // fail soft
      }
    }
    this.collectors = [];
  }

  isRunning(): boolean {
    return this.running;
  }

  subscribe(listener: SnapshotListener): () => void {
    return this.store.subscribe(listener);
  }

  getSnapshot() {
    return this.store.snapshot();
  }

  getStore(): MetricStore {
    return this.store;
  }

  /** Current resource timing rows for the waterfall panel. */
  getResources(): ResourceTimingRow[] {
    return this.resourceStore.getResources();
  }

  /** Latest gauges as a tabular payload (metric, latest, description, series). */
  getDataTable(): DataTable {
    return snapshotToTable(this.store.snapshot());
  }

  /** Full time-series as a long-form table (metric, t, v). */
  getSeriesTable(): DataTable {
    return seriesToTable(this.store.snapshot());
  }

  /** Resource waterfall rows as a flat table. */
  getResourcesTable(): DataTable {
    return resourcesToTable(this.resourceStore.getResources());
  }

  /** Subscribe to resource waterfall updates. */
  subscribeResources(listener: ResourceListener): () => void {
    return this.resourceStore.subscribe(listener);
  }

  /** Clear the resource waterfall buffer (e.g. after a soft navigation). */
  clearResources(): void {
    this.resourceStore.clear();
  }

  getFirstPartyDomains(): string[] {
    return this.options.firstPartyDomains ?? [];
  }

  private tick(): void {
    const ctx = this.createContext();
    for (const c of this.collectors) {
      if (c.sample) {
        try {
          c.sample(ctx);
        } catch {
          // fail soft
        }
      }
    }
    this.store.notify();
  }

  private createContext() {
    return {
      push: (name: Parameters<MetricStore['push']>[0], value: number, time?: number) =>
        this.store.push(name, value, time),
      setGauge: (name: Parameters<MetricStore['setGauge']>[0], value: number) =>
        this.store.setGauge(name, value),
      now: () => Date.now(),
    };
  }

  private buildCollectors(): Collector[] {
    const flags = { ...DEFAULT_COLLECTORS, ...this.options.collectors };
    const list: Collector[] = [];
    if (flags.http) list.push(createHttpCollector());
    if (flags.longTasks) list.push(createLongTasksCollector());
    if (flags.dom) list.push(createDomCollector());
    if (flags.webVitals) list.push(createWebVitalsCollector());
    if (flags.memory) list.push(createMemoryCollector());
    if (flags.fps) list.push(createFpsCollector());
    if (flags.loaf) list.push(createLoafCollector());
    if (flags.connection) list.push(createConnectionCollector());
    if (flags.navigation) list.push(createNavigationCollector());
    if (flags.errors) list.push(createErrorsCollector());
    if (flags.resources) {
      list.push(
        createResourcesWaterfallCollector({
          store: this.resourceStore,
          firstPartyDomains: this.options.firstPartyDomains ?? [],
          clearOnSoftNav: true,
        })
      );
    }
    return list;
  }
}

let defaultTracker: PagepulseTracker | null = null;

export function createTracker(options?: TrackerOptions): PagepulseTracker {
  const tracker = new PagepulseTracker(options);
  defaultTracker = tracker;
  return tracker;
}

export function getDefaultTracker(): PagepulseTracker | null {
  return defaultTracker;
}

export function setDefaultTracker(tracker: PagepulseTracker | null): void {
  defaultTracker = tracker;
}
