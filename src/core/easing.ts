/**
 * Easing curves for animations driven from TypeScript (a scroll cannot be a
 * CSS transition): the curve is read from a design token such as
 * `--ease-out: cubic-bezier(.2, .7, .2, 1)`, never written in the code.
 */

export type Easing = (t: number) => number;

const linear: Easing = (t) => t;

/** CSS `cubic-bezier(x1, y1, x2, y2)`: progress (0–1) for a time fraction (0–1). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Easing {
  const at = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  const slope = (a: number, b: number, s: number) => 3 * a * (1 - s) ** 2 + 6 * (b - a) * s * (1 - s) + 3 * (1 - b) * s * s;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // The curve's parameter for x = t: Newton steps, then bisection if they stall.
    let s = t;
    for (let i = 0; i < 8; i++) {
      const dx = at(x1, x2, s) - t;
      if (Math.abs(dx) < 1e-6) return at(y1, y2, s);
      const d = slope(x1, x2, s);
      if (Math.abs(d) < 1e-6) break;
      s -= dx / d;
    }
    let lo = 0;
    let hi = 1;
    s = t;
    for (let i = 0; i < 30; i++) {
      const x = at(x1, x2, s);
      if (Math.abs(x - t) < 1e-6) break;
      if (x < t) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return at(y1, y2, s);
  };
}

/** The easing of a CSS timing function value (`cubic-bezier(…)`, `linear`, `ease-out`…); linear when unknown. */
export function parseEasing(value: string): Easing {
  const v = value.trim();
  const m = /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/.exec(v);
  if (m) {
    const [x1, y1, x2, y2] = m.slice(1).map(Number) as [number, number, number, number];
    if ([x1, y1, x2, y2].every(Number.isFinite) && x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1) return cubicBezier(x1, y1, x2, y2);
  }
  const named: Record<string, [number, number, number, number]> = {
    ease: [0.25, 0.1, 0.25, 1],
    "ease-in": [0.42, 0, 1, 1],
    "ease-out": [0, 0, 0.58, 1],
    "ease-in-out": [0.42, 0, 0.58, 1],
  };
  const n = named[v];
  return n ? cubicBezier(...n) : linear;
}
