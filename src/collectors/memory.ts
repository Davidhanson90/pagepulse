import type { Collector } from '../core/types.js';

interface PerformanceMemory {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export function createMemoryCollector(): Collector {
  return {
    name: "memory",
    start() {
      // sampled on interval (tracker tick runs outside Zone when present)
    },
    sample(ctx) {
      try {
        const mem = (performance as Performance & { memory?: PerformanceMemory }).memory;
        if (!mem) return;
        ctx.setGauge("jsHeapUsed", mem.usedJSHeapSize);
        ctx.setGauge("jsHeapLimit", mem.jsHeapSizeLimit);
      } catch {
        // fail soft
      }
    },
    stop() {},
  };
}
