import type { Collector, CollectorContext } from '../core/types.js';
import {
  runOutsideZone,
  zoneSafeCancelAnimationFrame,
  zoneSafeRequestAnimationFrame,
} from '../core/zone-safe.js';

export function createFpsCollector(): Collector {
  let rafId = 0;
  let lastTs = 0;
  let frames = 0;
  let windowStart = 0;
  let ctxRef: CollectorContext | null = null;
  let active = false;

  const loop = (ts: number) => {
    runOutsideZone(() => {
      if (!active) return;
      if (!windowStart) windowStart = ts;
      if (lastTs) {
        const delta = ts - lastTs;
        if (delta > 50) {
          // long frame indication (~under 20fps for this frame)
          ctxRef?.push("fps", Math.round(1000 / delta), Date.now());
        }
      }
      lastTs = ts;
      frames++;
      if (ts - windowStart >= 1000) {
        const elapsed = (ts - windowStart) / 1000;
        const fps = Math.round(frames / elapsed);
        ctxRef?.setGauge("fps", fps);
        frames = 0;
        windowStart = ts;
      }
      rafId = zoneSafeRequestAnimationFrame(loop);
    });
  };

  return {
    name: "fps",
    start(ctx) {
      runOutsideZone(() => {
        ctxRef = ctx;
        if (typeof requestAnimationFrame === "undefined") return;
        active = true;
        lastTs = 0;
        frames = 0;
        windowStart = 0;
        rafId = zoneSafeRequestAnimationFrame(loop);
      });
    },
    stop() {
      active = false;
      zoneSafeCancelAnimationFrame(rafId);
      rafId = 0;
      ctxRef = null;
    },
  };
}
