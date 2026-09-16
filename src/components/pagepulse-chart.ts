import { LitElement, html } from "lit";
import type { MetricPoint } from "../core/types.js";
import { chartStyles, themeStyles } from "./styles.js";
import { THEME_VARS, readThemeColor, type PagepulseTheme } from "./theme.js";
import { wrapOutsideZone } from "../core/zone-safe.js";

export class PagepulseChart extends LitElement {
  static properties = {
    data: { attribute: false },
    color: { type: String },
    height: { type: Number },
    theme: { type: String, reflect: true }
  };

  declare data: MetricPoint[];
  declare color: string;
  declare height: number;
  declare theme: PagepulseTheme;

  static styles = [themeStyles, chartStyles];

  private schemeQuery: MediaQueryList | null = null;
  private readonly onSchemeChange = wrapOutsideZone((): void => {
    this.draw();
  });

  constructor() {
    super();
    this.data = [];
    this.color = "";
    this.height = 120;
    this.theme = "dark";
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (typeof window.matchMedia === "function") {
      this.schemeQuery = window.matchMedia("(prefers-color-scheme: light)");
      this.schemeQuery.addEventListener("change", this.onSchemeChange);
    }
  }

  disconnectedCallback(): void {
    this.schemeQuery?.removeEventListener("change", this.onSchemeChange);
    this.schemeQuery = null;
    super.disconnectedCallback();
  }

  protected updated(): void {
    this.draw();
  }

  private themeColor(name: string, fallback: string): string {
    return readThemeColor(this, name, fallback);
  }

  private draw(): void {
    const canvas = this.renderRoot.querySelector("canvas");
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 260;
    const height = this.height;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const bg = this.themeColor(THEME_VARS.chartBg, "#0d1524");
    const grid = this.themeColor(THEME_VARS.grid, "#1c2940");
    const empty = this.themeColor(THEME_VARS.empty, "#4a5a70");
    const series = this.color || this.themeColor(THEME_VARS.accent, "#5b9cff");

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const pts = this.data;
    if (!pts.length) {
      ctx.fillStyle = empty;
      ctx.font = "12px sans-serif";
      ctx.fillText("No data yet", 10, height / 2);
      return;
    }

    const pad = 6;
    const w = width - pad * 2;
    const h = height - pad * 2;
    const values = pts.map((p) => p.v);
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const t0 = pts[0]!.t;
    const t1 = pts[pts.length - 1]!.t;
    const span = Math.max(1, t1 - t0);

    // grid
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const y = pad + (h * i) / 2;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(pad + w, y);
      ctx.stroke();
    }

    // area fill
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = pad + ((p.t - t0) / span) * w;
      const y = pad + h - ((p.v - min) / (max - min)) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    const last = pts[pts.length - 1]!;
    const first = pts[0]!;
    ctx.lineTo(pad + ((last.t - t0) / span) * w, pad + h);
    ctx.lineTo(pad + ((first.t - t0) / span) * w, pad + h);
    ctx.closePath();
    ctx.fillStyle = series + "33";
    ctx.fill();

    // line
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = pad + ((p.t - t0) / span) * w;
      const y = pad + h - ((p.v - min) / (max - min)) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = series;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  render() {
    return html`<canvas style="height: ${this.height}px"></canvas>`;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("pagepulse-chart")) {
  customElements.define("pagepulse-chart", PagepulseChart);
}

declare global {
  interface HTMLElementTagNameMap {
    "pagepulse-chart": PagepulseChart;
  }
}
