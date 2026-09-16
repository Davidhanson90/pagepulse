import type { Collector, CollectorContext } from '../core/types.js';
import { runOutsideZone, wrapOutsideZone } from '../core/zone-safe.js';

type EffectiveType = 'slow-2g' | '2g' | '3g' | '4g' | string;

interface NetworkInformation extends EventTarget {
  rtt?: number;
  downlink?: number;
  effectiveType?: EffectiveType;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}

function effectiveTypeOrdinal(value: string | undefined): number {
  switch (value) {
    case 'slow-2g':
      return 1;
    case '2g':
      return 2;
    case '3g':
      return 3;
    case '4g':
      return 4;
    default:
      return 0;
  }
}

function readConnection(ctx: CollectorContext, conn: NetworkInformation): void {
  try {
    if (typeof conn.rtt === 'number') ctx.setGauge('connectionRtt', conn.rtt);
    if (typeof conn.downlink === 'number') ctx.setGauge('connectionDownlink', conn.downlink);
    ctx.setGauge('connectionEffectiveType', effectiveTypeOrdinal(conn.effectiveType));
  } catch {
    // fail soft
  }
}

export function createConnectionCollector(): Collector {
  let conn: NetworkInformation | null = null;
  let onChange: (() => void) | null = null;
  let ctxRef: CollectorContext | null = null;

  return {
    name: 'connection',
    start(ctx) {
      runOutsideZone(() => {
        ctxRef = ctx;
        try {
          const nav = navigator as Navigator & {
            connection?: NetworkInformation;
            mozConnection?: NetworkInformation;
            webkitConnection?: NetworkInformation;
          };
          conn = nav.connection ?? nav.mozConnection ?? nav.webkitConnection ?? null;
          if (!conn) return;
          readConnection(ctx, conn);
          onChange = wrapOutsideZone(() => {
            if (ctxRef && conn) readConnection(ctxRef, conn);
          });
          conn.addEventListener('change', onChange);
        } catch {
          conn = null;
          onChange = null;
        }
      });
    },
    sample(ctx) {
      if (conn) readConnection(ctx, conn);
    },
    stop() {
      if (conn && onChange) {
        try {
          conn.removeEventListener('change', onChange);
        } catch {
          // fail soft
        }
      }
      conn = null;
      onChange = null;
      ctxRef = null;
    },
  };
}
