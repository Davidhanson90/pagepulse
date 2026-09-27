import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runOutsideZone,
  wrapOutsideZone,
  zoneSafeCancelAnimationFrame,
  zoneSafeClearInterval,
  zoneSafeClearTimeout,
  zoneSafeRequestAnimationFrame,
  zoneSafeSetInterval,
  zoneSafeSetTimeout,
} from "./zone-safe.js";

describe("zone-safe", () => {
  const g = globalThis as Record<string, unknown>;

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete g.Zone;
    delete g.__zone_symbol__setInterval;
    delete g.__zone_symbol__clearInterval;
    delete g.__zone_symbol__setTimeout;
    delete g.__zone_symbol__clearTimeout;
    delete g.__zone_symbol__requestAnimationFrame;
    delete g.__zone_symbol__cancelAnimationFrame;
  });

  describe("without Zone", () => {
    it("runOutsideZone invokes fn directly", () => {
      const fn = vi.fn(() => 42);
      expect(runOutsideZone(fn)).toBe(42);
      expect(fn).toHaveBeenCalledOnce();
    });

    it("wrapOutsideZone invokes handler with args", () => {
      const handler = vi.fn((a: number, b: string) => `${a}-${b}`);
      const wrapped = wrapOutsideZone(handler);
      expect(wrapped(1, "x")).toBe("1-x");
      expect(handler).toHaveBeenCalledWith(1, "x");
    });

    it("timer helpers call through to globals", () => {
      vi.useFakeTimers();
      const spy = vi.fn();
      const id = zoneSafeSetInterval(spy, 100);
      vi.advanceTimersByTime(100);
      expect(spy).toHaveBeenCalledOnce();
      zoneSafeClearInterval(id);

      const tSpy = vi.fn();
      const tid = zoneSafeSetTimeout(tSpy, 50);
      vi.advanceTimersByTime(50);
      expect(tSpy).toHaveBeenCalledOnce();
      zoneSafeClearTimeout(tid);
      vi.useRealTimers();
    });
  });

  describe("with mock Zone.root.run", () => {
    it("runOutsideZone delegates to Zone.root.run", () => {
      const run = vi.fn((fn: () => unknown) => fn());
      g.Zone = { root: { run } };
      const inner = vi.fn(() => "ok");
      expect(runOutsideZone(inner)).toBe("ok");
      expect(run).toHaveBeenCalledOnce();
      expect(inner).toHaveBeenCalledOnce();
    });

    it("wrapOutsideZone runs handler via Zone.root.run", () => {
      const run = vi.fn((fn: () => unknown) => fn());
      g.Zone = { root: { run } };
      const handler = vi.fn(() => 7);
      const wrapped = wrapOutsideZone(handler);
      expect(wrapped()).toBe(7);
      expect(run).toHaveBeenCalledOnce();
    });
  });

  describe("unpatched timer symbols", () => {
    it("prefers __zone_symbol__setInterval when set", () => {
      const nativeSet = vi.fn(() => 99 as unknown as ReturnType<typeof setInterval>);
      g.__zone_symbol__setInterval = nativeSet;
      const handler = vi.fn();
      const id = zoneSafeSetInterval(handler, 10);
      expect(nativeSet).toHaveBeenCalledOnce();
      expect(id).toBe(99);
    });

    it("prefers Zone.__symbol__('setInterval') lookup", () => {
      const nativeSet = vi.fn(() => 42 as unknown as ReturnType<typeof setInterval>);
      const symbolKey = "__zone_symbol__setInterval";
      g[symbolKey] = nativeSet;
      // Prefer via Zone.__symbol__ path: clear direct? actually readUnpatched checks direct first.
      // Set only via a custom key returned by __symbol__.
      delete g.__zone_symbol__setInterval;
      const customKey = "__custom_zone_setInterval";
      g[customKey] = nativeSet;
      g.Zone = {
        root: { run: <T>(fn: () => T) => fn() },
        __symbol__: (name: string) => (name === "setInterval" ? customKey : `__zone_symbol__${name}`),
      };
      zoneSafeSetInterval(() => {}, 5);
      expect(nativeSet).toHaveBeenCalledOnce();
    });

    it("prefers __zone_symbol__setTimeout", () => {
      const nativeSet = vi.fn(() => 11 as unknown as ReturnType<typeof setTimeout>);
      g.__zone_symbol__setTimeout = nativeSet;
      zoneSafeSetTimeout(() => {}, 0);
      expect(nativeSet).toHaveBeenCalledOnce();
    });

    it("prefers __zone_symbol__requestAnimationFrame when present", () => {
      const nativeRaf = vi.fn(() => 3);
      g.__zone_symbol__requestAnimationFrame = nativeRaf;
      const id = zoneSafeRequestAnimationFrame(() => {});
      expect(nativeRaf).toHaveBeenCalledOnce();
      expect(id).toBe(3);
    });

    it("clear helpers prefer unpatched symbols", () => {
      const nativeClear = vi.fn();
      g.__zone_symbol__clearInterval = nativeClear;
      zoneSafeClearInterval(1 as unknown as ReturnType<typeof setInterval>);
      expect(nativeClear).toHaveBeenCalledWith(1);

      const nativeClearT = vi.fn();
      g.__zone_symbol__clearTimeout = nativeClearT;
      zoneSafeClearTimeout(2 as unknown as ReturnType<typeof setTimeout>);
      expect(nativeClearT).toHaveBeenCalledWith(2);

      const nativeCancel = vi.fn();
      g.__zone_symbol__cancelAnimationFrame = nativeCancel;
      zoneSafeCancelAnimationFrame(3);
      expect(nativeCancel).toHaveBeenCalledWith(3);
    });
  });

  describe("guard branches", () => {
    it("clear helpers ignore null and undefined ids", () => {
      expect(() => {
        zoneSafeClearInterval(null);
        zoneSafeClearInterval(undefined);
        zoneSafeClearTimeout(null);
        zoneSafeClearTimeout(undefined);
        zoneSafeCancelAnimationFrame(null);
        zoneSafeCancelAnimationFrame(undefined);
      }).not.toThrow();
    });

    it("timer helpers default the timeout to 0", () => {
      // Mock the unpatched natives so no real 0ms interval is scheduled
      // (a zero-delay interval would spin fake timers indefinitely).
      const nativeSetInterval = vi.fn(() => 1 as unknown as ReturnType<typeof setInterval>);
      const nativeSetTimeout = vi.fn(() => 2 as unknown as ReturnType<typeof setTimeout>);
      g.__zone_symbol__setInterval = nativeSetInterval;
      g.__zone_symbol__setTimeout = nativeSetTimeout;
      const handler = vi.fn();
      zoneSafeSetInterval(handler);
      expect(nativeSetInterval).toHaveBeenCalledWith(handler, 0);
      zoneSafeSetTimeout(handler);
      expect(nativeSetTimeout).toHaveBeenCalledWith(handler, 0);
    });
  });

  describe("unpatched symbol fallback branches", () => {
    it("falls back to global timers when the zone symbol is not a function", () => {
      g.__zone_symbol__setInterval = "not-a-function";
      g.Zone = {};
      vi.useFakeTimers();
      const spy = vi.fn();
      zoneSafeSetInterval(spy, 10);
      vi.advanceTimersByTime(10);
      expect(spy).toHaveBeenCalledOnce();
    });

    it("falls back to global timers when Zone.__symbol__ resolves to a non-function", () => {
      const customKey = "__empty_symbol_setInterval";
      g.Zone = { __symbol__: () => customKey };
      g[customKey] = {};
      vi.useFakeTimers();
      const spy = vi.fn();
      zoneSafeSetInterval(spy, 10);
      vi.advanceTimersByTime(10);
      expect(spy).toHaveBeenCalledOnce();
      delete g[customKey];
    });

    it("falls back to global timers when Zone has no __symbol__", () => {
      g.Zone = { root: { run: <T>(fn: () => T) => fn() } };
      vi.useFakeTimers();
      const spy = vi.fn();
      zoneSafeSetTimeout(spy, 5);
      vi.advanceTimersByTime(5);
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  describe("Zone.root fallbacks", () => {
    it("runOutsideZone invokes fn directly when Zone has no root", () => {
      g.Zone = {};
      const fn = vi.fn(() => 1);
      expect(runOutsideZone(fn)).toBe(1);
      expect(fn).toHaveBeenCalledOnce();
    });

    it("runOutsideZone invokes fn directly when root.run is not a function", () => {
      g.Zone = { root: {} };
      const fn = vi.fn(() => 2);
      expect(runOutsideZone(fn)).toBe(2);
      expect(fn).toHaveBeenCalledOnce();
    });
  });

  describe("non-browser rAF fallbacks", () => {
    // Restrict toFake so fake timers do not reinstall requestAnimationFrame /
    // cancelAnimationFrame over the undefined stubs below.
    it("zoneSafeRequestAnimationFrame schedules via setTimeout without rAF", () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      vi.stubGlobal("requestAnimationFrame", undefined);
      const cb = vi.fn();
      zoneSafeRequestAnimationFrame(cb);
      vi.advanceTimersByTime(16);
      expect(cb).toHaveBeenCalledOnce();
      expect(cb).toHaveBeenCalledWith(Date.now());
    });

    it("zoneSafeCancelAnimationFrame clears via clearTimeout without rAF", () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      vi.stubGlobal("cancelAnimationFrame", undefined);
      const clearSpy = vi.spyOn(globalThis, "clearTimeout");
      zoneSafeCancelAnimationFrame(123);
      expect(clearSpy).toHaveBeenCalledWith(123);
      clearSpy.mockRestore();
    });
  });
});
