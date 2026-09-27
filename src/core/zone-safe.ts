/**
 * Zone.js-aware scheduling helpers without importing zone.js or @angular/core.
 *
 * When Zone is present (e.g. Angular), timers and callbacks are routed through
 * Zone.root / unpatched APIs so pagepulse does not thrash change detection.
 */

/** Minimal Zone root surface we rely on (no zone.js types). */
interface ZoneRoot {
  run<T>(fn: () => T): T;
}

interface ZoneGlobal {
  root?: ZoneRoot;
  __symbol__?(name: string): string;
}

function getZone(): ZoneGlobal | undefined {
  return (globalThis as { Zone?: ZoneGlobal }).Zone;
}

/**
 * Run `fn` in Zone.root when Zone.js is loaded; otherwise invoke directly.
 * Does not import zone.js.
 */
export function runOutsideZone<T>(fn: () => T): T {
  const root = getZone()?.root;
  if (root && typeof root.run === "function") {
    return root.run(fn);
  }
  return fn();
}

/**
 * Wrap an event/observer/async handler so it always runs outside Angular's zone.
 */
export function wrapOutsideZone<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => TResult
): (...args: TArgs) => TResult {
  return (...args: TArgs): TResult => runOutsideZone(() => handler(...args));
}

function readUnpatched(name: string): unknown {
  const g = globalThis as Record<string, unknown>;
  const directKey = `__zone_symbol__${name}`;
  if (typeof g[directKey] === "function") {
    return g[directKey];
  }
  const Zone = getZone();
  if (Zone && typeof Zone.__symbol__ === "function") {
    const key = Zone.__symbol__(name);
    if (typeof g[key] === "function") {
      return g[key];
    }
  }
  return undefined;
}

function pickFn<T>(name: string, fallback: T): T {
  const native = readUnpatched(name);
  return (typeof native === "function" ? native : fallback) as T;
}

export function zoneSafeSetInterval(
  handler: (...args: unknown[]) => void,
  timeout?: number,
  ...args: unknown[]
): ReturnType<typeof setInterval> {
  const impl = pickFn<typeof setInterval>("setInterval", setInterval);
  return impl(handler as Parameters<typeof setInterval>[0], timeout ?? 0, ...args);
}

export function zoneSafeClearInterval(id: ReturnType<typeof setInterval> | null | undefined): void {
  if (id == null) return;
  pickFn<typeof clearInterval>("clearInterval", clearInterval)(id);
}

export function zoneSafeSetTimeout(
  handler: (...args: unknown[]) => void,
  timeout?: number,
  ...args: unknown[]
): ReturnType<typeof setTimeout> {
  const impl = pickFn<typeof setTimeout>("setTimeout", setTimeout);
  return impl(handler as Parameters<typeof setTimeout>[0], timeout ?? 0, ...args);
}

export function zoneSafeClearTimeout(id: ReturnType<typeof setTimeout> | null | undefined): void {
  if (id == null) return;
  pickFn<typeof clearTimeout>("clearTimeout", clearTimeout)(id);
}

export function zoneSafeRequestAnimationFrame(callback: (time: number) => void): number {
  if (typeof requestAnimationFrame === "function") {
    const impl = pickFn<typeof requestAnimationFrame>("requestAnimationFrame", requestAnimationFrame);
    return impl(callback);
  }
  // Extremely defensive fallback (non-browser).
  return zoneSafeSetTimeout(() => callback(Date.now()), 16) as unknown as number;
}

export function zoneSafeCancelAnimationFrame(id: number | null | undefined): void {
  if (id == null) return;
  if (typeof cancelAnimationFrame === "function") {
    pickFn<typeof cancelAnimationFrame>("cancelAnimationFrame", cancelAnimationFrame)(id);
    return;
  }
  zoneSafeClearTimeout(id as unknown as ReturnType<typeof setTimeout>);
}
