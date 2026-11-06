/**
 * Primitives (parts). Contract for the rest of the app:
 *   part.params           — { name: {label, min, max, step, default, integer?, animated?} }
 *   part.primary          — param controlled by pinch by default
 *   inst.setNorm(name,v01) / inst.getNorm(name) / inst.set(name,value) / inst.get(name)
 *   inst.tick(dtMs)       — advance animated params
 *   inst.render(ctx,w,h,theme)
 *   inst.spec()           — {template, params} for verification / sharing
 */
import { clamp, lerp } from "./filters.js";
import * as Cube3D from "./cube3d.js";

export const THEMES = [
  { name: "mint", bg: "#fbfbf7", ink: "#1a202c", dim: "#718096", grid: "#e2e8f0", a: "#2b9d8f", b: "#f0a04b", line: "#2d3748" },
  { name: "berry", bg: "#fbf7fb", ink: "#1a202c", dim: "#718096", grid: "#e9e0ec", a: "#b83280", b: "#3182ce", line: "#2d3748" },
  { name: "sun", bg: "#fffcf2", ink: "#1a202c", dim: "#718096", grid: "#efe6cf", a: "#dd6b20", b: "#38a169", line: "#2d3748" },
  { name: "ink", bg: "#101418", ink: "#f7fafc", dim: "#a0aec0", grid: "#2d3748", a: "#63b3ed", b: "#f6e05e", line: "#e2e8f0" },
];

const fmt = (v, d = 1) => {
  const s = Number(v).toFixed(d);
  return s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
};

function makeInstance(def, overrides = {}) {
  const values = {};
  const targets = {};
  for (const [k, p] of Object.entries(def.params)) {
    values[k] = overrides[k] ?? p.default;
    targets[k] = values[k];
  }
  const inst = {
    def,
    id: def.id,
    values,
    targets,
    get(name) {
      return values[name];
    },
    set(name, v) {
      const p = def.params[name];
      if (!p) return;
      let x = clamp(v, p.min, p.max);
      if (p.integer) x = Math.round(x / (p.step || 1)) * (p.step || 1);
      if (p.animated) targets[name] = x;
      else values[name] = x;
    },
    setNorm(name, v01) {
      const p = def.params[name];
      if (!p) return;
      inst.set(name, p.min + clamp(v01, 0, 1) * (p.max - p.min));
    },
    getNorm(name) {
      const p = def.params[name];
      return (values[name] - p.min) / (p.max - p.min);
    },
    tick(dt) {
      for (const [k, p] of Object.entries(def.params)) {
        if (!p.animated) continue;
        const k1 = 1 - Math.exp(-dt / (p.tau || 350));
        values[k] = lerp(values[k], targets[k], k1);
        if (Math.abs(values[k] - targets[k]) < 1e-3) values[k] = targets[k];
      }
    },
    render(ctx, w, h, theme) {
      def.render(inst, ctx, w, h, theme);
    },
    is3d: !!def.is3d,
    render3d(w, h, theme, canvas) {
      if (def.render3d) def.render3d(inst, w, h, theme, canvas);
    },
    equation() {
      return def.equation(inst);
    },
    readout() {
      return def.readout(inst);
    },
    narration() {
      return def.narration(inst);
    },
    spec() {
      const out = {};
      for (const k of Object.keys(def.params)) out[k] = values[k];
      return { template: def.id, params: out };
    },
  };
  return inst;
}

/* ------------------------------------------------------------------ */
/* Shared drawing helpers                                             */
/* ------------------------------------------------------------------ */
function text(ctx, s, x, y, { size = 16, color = "#1a202c", align = "left", mono = false, weight = 500 } = {}) {
  ctx.font = `${weight} ${size}px ${mono ? '"JetBrains Mono", monospace' : '"Noto Sans JP", sans-serif'}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(s, x, y);
}

/** Slightly darker version of a hex colour (for strokes/labels on light bg). */
function darker(hex, k = 0.72) {
  const c = hex.replace("#", "");
  const v = [0, 2, 4].map((i) => Math.max(0, Math.round(parseInt(c.slice(i, i + 2), 16) * k)));
  return `rgb(${v.join(",")})`;
}
function alpha(hex, a) {
  const c = hex.replace("#", "");
  const v = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
  return `rgba(${v.join(",")},${a})`;
}

/** Base font size that scales with the stage. */
const bigFont = (w, h) => Math.max(14, Math.round(Math.min(w, h) / 34));

/** Text with a rounded background pill so it stays legible over the drawing. */
function pill(ctx, s, x, y, { size = 14, color = "#1a202c", bg = "rgba(255,255,255,0.9)", align = "center", mono = false, weight = 700, padX = 8, padY = 5 } = {}) {
  ctx.font = `${weight} ${size}px ${mono ? '"JetBrains Mono", monospace' : '"Noto Sans JP", sans-serif'}`;
  const tw = ctx.measureText(s).width;
  const bw = tw + padX * 2;
  const bh = size + padY * 2;
  const bx = align === "center" ? x - bw / 2 : align === "right" ? x - bw : x;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(bx, y - bh / 2, bw, bh, bh / 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(s, bx + bw / 2, y + 1);
  return { x: bx, y: y - bh / 2, w: bw, h: bh };
}

/** Arrow from (x0,y0) to (x1,y1). */
function arrow(ctx, x0, y0, x1, y1, color, width = 3, head = 10) {
  const ang = Math.atan2(y1 - y0, x1 - x0);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1 - Math.cos(ang) * head * 0.6, y1 - Math.sin(ang) * head * 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - Math.cos(ang - 0.5) * head, y1 - Math.sin(ang - 0.5) * head);
  ctx.lineTo(x1 - Math.cos(ang + 0.5) * head, y1 - Math.sin(ang + 0.5) * head);
  ctx.closePath();
  ctx.fill();
}

/**
 * Formula card at the bottom of the stage.
 * lines: array of lines; each line is an array of [text, color] tokens.
 * The first line is drawn large (mono); following lines smaller (sans).
 */
function formulaCard(ctx, w, h, theme, lines) {
  const big = bigFont(w, h);
  const lineH = [big * 1.9, ...lines.slice(1).map(() => big * 1.35)];
  const cardH = lineH.reduce((s, v) => s + v, 0) + big * 1.3;
  const cardY = h - cardH - big * 3.6; // leave room for the HUD readout below
  const cardW = Math.min(w * 0.86, big * 40);
  const cardX = (w - cardW) / 2;
  // opaque-ish card so the drawing underneath doesn't fight the formula
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, 14);
  ctx.fillStyle = theme.name === "ink" ? "rgba(16,20,24,0.92)" : "rgba(255,255,255,0.94)";
  ctx.fill();
  ctx.strokeStyle = theme.name === "ink" ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.08)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  let y = cardY + big * 0.65;
  lines.forEach((tokens, li) => {
    const base = li === 0 ? big * 1.35 : big * 0.9;
    const font = (fs) => (li === 0
      ? `700 ${fs}px "JetBrains Mono", "Noto Sans JP", monospace`
      : `600 ${fs}px "Noto Sans JP", sans-serif`);
    let fs = base;
    let total = 0;
    for (let tries = 0; tries < 6; tries++) {
      ctx.font = font(fs);
      total = 0;
      for (const [s] of tokens) total += ctx.measureText(s).width;
      if (total <= cardW - big * 1.5) break;
      fs *= 0.86;
    }
    const cy = y + lineH[li] / 2;
    let x = w / 2 - total / 2;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    for (const [s, color] of tokens) {
      ctx.fillStyle = color;
      ctx.fillText(s, x, cy);
      x += ctx.measureText(s).width;
    }
    y += lineH[li];
  });
  return { x: cardX, y: cardY, w: cardW, h: cardH };
}

function drawAxes(ctx, w, h, unit, theme, { origin } = {}) {
  const ox = origin?.x ?? w / 2;
  const oy = origin?.y ?? h / 2;
  ctx.lineWidth = 1;
  ctx.strokeStyle = theme.grid;
  ctx.beginPath();
  for (let x = ox % unit; x < w; x += unit) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let y = oy % unit; y < h; y += unit) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = theme.line;
  ctx.beginPath();
  ctx.moveTo(0, oy); ctx.lineTo(w, oy);
  ctx.moveTo(ox, 0); ctx.lineTo(ox, h);
  ctx.stroke();
  // axis arrows + names
  arrow(ctx, w - 26, oy, w - 6, oy, theme.line, 2, 9);
  arrow(ctx, ox, 26, ox, 6, theme.line, 2, 9);
  text(ctx, "x", w - 14, oy + 18, { size: 15, color: theme.ink, align: "center", mono: true, weight: 700 });
  text(ctx, "y", ox + 16, 14, { size: 15, color: theme.ink, align: "center", mono: true, weight: 700 });
  text(ctx, "O", ox - 9, oy + 13, { size: 12, color: theme.dim, align: "center", mono: true });
  // ticks (label every k-th when the grid is dense)
  const every = Math.max(1, Math.ceil(30 / unit));
  for (let i = -40; i <= 40; i++) {
    if (i === 0 || i % every !== 0) continue;
    const x = ox + i * unit;
    const y = oy - i * unit;
    if (x > 0 && x < w) text(ctx, String(i), x, oy + 14, { size: 12, color: theme.dim, align: "center", mono: true });
    if (y > 0 && y < h) text(ctx, String(i), ox - 10, y, { size: 12, color: theme.dim, align: "right", mono: true });
  }
  return { ox, oy };
}

/* ------------------------------------------------------------------ */
/* 円の面積 — sectors rearranged into a near-rectangle                */
/* ------------------------------------------------------------------ */
const circleArea = {
  id: "circleArea",
  title: "円の面積",
  unit: "円の面積（扇形→長方形）",
  params: {
    n: { label: "分割数", min: 4, max: 64, step: 2, default: 8, integer: true },
    t: { label: "並べ替え", min: 0, max: 1, step: 0.01, default: 1, animated: true, tau: 450 },
    r: { label: "半径", min: 0.6, max: 1.4, step: 0.05, default: 1 },
  },
  primary: "n",
  equation(inst) {
    const n = inst.get("n");
    return `円の面積 = πr²   （n = ${n} 分割）`;
  },
  readout(inst) {
    const n = inst.get("n");
    const t = inst.get("t");
    const r = inst.get("r");
    const area = Math.PI * r * r;
    return `n = ${n}   r = ${fmt(r, 2)}   面積 ≈ ${fmt(area, 3)}${t > 0.95 ? `   （横 ${fmt(Math.PI * r, 3)} × 縦 ${fmt(r, 2)}）` : ""}`;
  },
  narration(inst) {
    const n = inst.get("n");
    return `左の円を${n}個の扇形に分けて、右のように互い違いに並べ替えます。並べ替えても面積は変わりません。分割を増やすほど長方形に近づき、横の長さは円周の半分、つまりパイアール、縦は半径アールになります。だから円の面積は、長方形の面積、パイアール掛けるアールで、パイアールの二乗です。`;
  },
  render(inst, ctx, w, h, theme) {
    const n = inst.get("n");
    const t = inst.get("t");
    const rr = inst.get("r");
    const theta = (Math.PI * 2) / n;

    // Size so that circle (left) + near-rectangle (right, width ≈ πR + chord) both fit
    const gutter = w * 0.05;
    const fit = (w - gutter * 4) / (2 + Math.PI + 1.0);
    const R = Math.min(h * 0.27, fit) * rr;
    const chord = 2 * R * Math.sin(theta / 2);
    const rectW = Math.PI * R;

    const bandMidY = h * 0.46;
    const cx = gutter + R + 10;
    const cy = bandMidY;

    const rowWidth = (n / 2) * chord + chord / 2;
    const rowLeft = Math.min(w - gutter - rowWidth, cx + R + gutter * 2.2);
    const rowMidY = bandMidY;
    const topY = rowMidY - R / 2;
    const bottomY = rowMidY + R / 2;
    const rectLeft = rowLeft + chord / 2;

    const big = Math.max(14, Math.round(Math.min(w, h) / 34));
    const mid = Math.max(12, Math.round(big * 0.82));

    const sector = (ax, ay, dir, even) => {
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.arc(ax, ay, R, dir - theta / 2, dir + theta / 2);
      ctx.closePath();
      ctx.fillStyle = even ? theme.a : theme.b;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };
    const edgeArc = (ax, ay, dir, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(5, R * 0.05);
      ctx.lineCap = "butt";
      ctx.beginPath();
      ctx.arc(ax, ay, R, dir - theta / 2, dir + theta / 2);
      ctx.stroke();
    };
    const aDark = darker(theme.a);
    const bDark = darker(theme.b);

    /* ---------------- Left: the circle ---------------- */
    for (let i = 0; i < n; i++) sector(cx, cy, i * theta + theta / 2, i % 2 === 0);
    // circumference split into two halves by color: teal arcs → top edge, orange arcs → bottom edge
    for (let i = 0; i < n; i++) edgeArc(cx, cy, i * theta + theta / 2, i % 2 === 0 ? aDark : bDark);

    // radius
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + R * Math.cos(-theta / 2 - theta), cy + R * Math.sin(-theta / 2 - theta));
    ctx.stroke();
    ctx.fillStyle = theme.ink;
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, "r", cx + R * 0.55 * Math.cos(-theta * 1.5) + 14, cy + R * 0.55 * Math.sin(-theta * 1.5) - 10, { size: big, color: theme.ink, align: "center", mono: true, weight: 700 });

    text(ctx, `円を ${n} 等分`, cx, cy + R + big * 1.4, { size: big, color: theme.ink, align: "center", weight: 700 });
    text(ctx, "円周 = 2πr", cx, cy + R + big * 2.7, { size: mid, color: theme.dim, align: "center", mono: true });

    /* ---------------- Arrow ---------------- */
    const ax0 = cx + R + 14;
    const ax1 = rowLeft - 12;
    if (ax1 > ax0 + 36) {
      ctx.strokeStyle = theme.dim;
      ctx.fillStyle = theme.dim;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ax0, rowMidY);
      ctx.lineTo(ax1 - 10, rowMidY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ax1, rowMidY);
      ctx.lineTo(ax1 - 12, rowMidY - 7);
      ctx.lineTo(ax1 - 12, rowMidY + 7);
      ctx.closePath();
      ctx.fill();
      text(ctx, "並べ替え", (ax0 + ax1) / 2, rowMidY - 16, { size: mid, color: theme.dim, align: "center" });
      text(ctx, "面積は同じ", (ax0 + ax1) / 2, rowMidY + 16, { size: mid, color: theme.dim, align: "center" });
    }

    /* ---------------- Right: sectors travelling into the near-rectangle ---------------- */
    const placed = [];
    for (let i = 0; i < n; i++) {
      const circleDir = i * theta + theta / 2;
      const even = i % 2 === 0;
      const k = Math.floor(i / 2);
      const rowX = even ? rowLeft + chord / 2 + k * chord : rowLeft + chord + k * chord;
      const rowY = even ? bottomY : topY;
      const rowDir = even ? -Math.PI / 2 : Math.PI / 2;
      let dAng = rowDir - circleDir;
      dAng = Math.atan2(Math.sin(dAng), Math.cos(dAng));
      const dir = circleDir + dAng * t;
      const ax = lerp(cx, rowX, t);
      const ay = lerp(cy, rowY, t);
      placed.push({ ax, ay, dir, even });
    }
    if (t > 0.02) {
      // (at t≈0 the copies sit exactly on the left circle; skip so its radius stays visible)
      for (const s of placed) sector(s.ax, s.ay, s.dir, s.even);
      for (const s of placed) edgeArc(s.ax, s.ay, s.dir, s.even ? aDark : bDark);
    }

    if (t > 0.6) {
      const alpha = (t - 0.6) / 0.4;
      ctx.globalAlpha = alpha;

      // limiting rectangle
      ctx.setLineDash([10, 7]);
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(rectLeft, topY, rectW, R);
      ctx.setLineDash([]);

      // one radius inside the row → height is r
      const s0 = placed[0];
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(s0.ax, s0.ay);
      ctx.lineTo(s0.ax + R * Math.cos(s0.dir), s0.ay + R * Math.sin(s0.dir));
      ctx.stroke();

      // top dimension (teal) = half circumference
      const dimY = topY - big * 1.1;
      ctx.strokeStyle = aDark;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(rectLeft, dimY); ctx.lineTo(rectLeft + rectW, dimY);
      ctx.moveTo(rectLeft, dimY - 7); ctx.lineTo(rectLeft, dimY + 7);
      ctx.moveTo(rectLeft + rectW, dimY - 7); ctx.lineTo(rectLeft + rectW, dimY + 7);
      ctx.stroke();
      text(ctx, "横 = 円周の半分 = πr", rectLeft + rectW / 2, dimY - big * 0.9, { size: big, color: aDark, align: "center", mono: true, weight: 700 });

      // right dimension = r
      const dimX = rectLeft + rectW + big * 0.9;
      ctx.strokeStyle = theme.ink;
      ctx.beginPath();
      ctx.moveTo(dimX, topY); ctx.lineTo(dimX, bottomY);
      ctx.moveTo(dimX - 7, topY); ctx.lineTo(dimX + 7, topY);
      ctx.moveTo(dimX - 7, bottomY); ctx.lineTo(dimX + 7, bottomY);
      ctx.stroke();
      text(ctx, "縦 = r", dimX + 12, rowMidY, { size: big, color: theme.ink, align: "left", mono: true, weight: 700 });

      text(ctx, n >= 32 ? "ほぼ長方形" : "長方形に近い形", rectLeft + rectW / 2, bottomY + big * 1.4, { size: big, color: theme.ink, align: "center", weight: 700 });
      text(ctx, "n を増やすほど長方形に近づく", rectLeft + rectW / 2, bottomY + big * 2.7, { size: mid, color: theme.dim, align: "center" });
      ctx.globalAlpha = 1;
    } else if (t < 0.05) {
      ctx.setLineDash([10, 7]);
      ctx.strokeStyle = theme.dim;
      ctx.lineWidth = 2;
      ctx.strokeRect(rectLeft, topY, rectW, R);
      ctx.setLineDash([]);
      text(ctx, "「並べて」と言うと、ここに並びます", rectLeft + rectW / 2, rowMidY, { size: big, color: theme.dim, align: "center" });
    }

    formulaCard(ctx, w, h, theme, [
      [
        ["円の面積", theme.ink],
        [" = ", theme.dim],
        ["長方形の面積", theme.ink],
        [" = ", theme.dim],
        ["横", aDark], [" × ", theme.dim], ["縦", theme.ink],
        [" = ", theme.dim],
        ["πr", aDark], [" × ", theme.dim], ["r", theme.ink],
        [" = ", theme.dim],
        ["πr²", theme.ink],
      ],
    ]);
  },
};

/* ------------------------------------------------------------------ */
/* 一次関数 y = ax + b                                                 */
/* ------------------------------------------------------------------ */
const linear = {
  id: "linear",
  title: "一次関数",
  unit: "一次関数 y = ax + b",
  params: {
    a: { label: "傾き a", min: -3, max: 3, step: 0.1, default: 1 },
    b: { label: "切片 b", min: -5, max: 5, step: 0.5, default: 0 },
  },
  primary: "a",
  equation(inst) {
    const a = inst.get("a");
    const b = inst.get("b");
    const bs = b === 0 ? "" : b > 0 ? ` + ${fmt(b)}` : ` − ${fmt(-b)}`;
    return `y = ${fmt(a)}x${bs}`;
  },
  readout(inst) {
    const a = inst.get("a");
    const b = inst.get("b");
    const xi = Math.abs(a) < 1e-9 ? "—" : fmt(-b / a, 2);
    return `a = ${fmt(a)}   b = ${fmt(b)}   y切片 (0, ${fmt(b)})   x切片 (${xi}, 0)`;
  },
  narration(inst) {
    const a = inst.get("a");
    const b = inst.get("b");
    return `傾きが${fmt(a)}、切片が${fmt(b)}の一次関数です。xが1増えるとyは${fmt(a)}増えます。式とグラフが同時に動くのを見てください。`;
  },
  render(inst, ctx, w, h, theme) {
    const a = inst.get("a");
    const b = inst.get("b");
    const big = bigFont(w, h);
    const unit = Math.min(w, h) / 12;
    const { ox, oy } = drawAxes(ctx, w, h, unit, theme, { origin: { x: w / 2, y: h * 0.46 } });
    const X = (x) => ox + x * unit;
    const Y = (y) => oy - y * unit;
    const aDark = darker(theme.a);
    const bDark = darker(theme.b);

    // the line
    const xMin = -ox / unit;
    const xMax = (w - ox) / unit;
    ctx.strokeStyle = theme.a;
    ctx.lineWidth = 4.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(X(xMin), Y(a * xMin + b));
    ctx.lineTo(X(xMax), Y(a * xMax + b));
    ctx.stroke();

    // slope triangle from (1, a+b): "right 1, up a"
    const x0 = 1;
    const y0 = a * x0 + b;
    ctx.fillStyle = alpha(theme.b, 0.22);
    ctx.beginPath();
    ctx.moveTo(X(x0), Y(y0));
    ctx.lineTo(X(x0 + 1), Y(y0));
    ctx.lineTo(X(x0 + 1), Y(y0 + a));
    ctx.closePath();
    ctx.fill();
    // horizontal leg (right 1)
    arrow(ctx, X(x0), Y(y0), X(x0 + 1), Y(y0), bDark, 3, 9);
    pill(ctx, "右へ 1", X(x0 + 0.5), Y(y0) + (a >= 0 ? big * 1.1 : -big * 1.1), { size: big * 0.85, color: bDark, mono: false });
    // vertical leg (up a)
    if (Math.abs(a) > 0.05) {
      arrow(ctx, X(x0 + 1), Y(y0), X(x0 + 1), Y(y0 + a), bDark, 3, 9);
      pill(ctx, `${a >= 0 ? "上へ" : "下へ"} ${fmt(Math.abs(a))}`, X(x0 + 1) + big * 0.6, Y(y0 + a / 2), { size: big * 0.85, color: bDark, align: "left" });
    } else {
      pill(ctx, "上がらない（a = 0）", X(x0 + 1) + big * 0.6, Y(y0) - big * 1.1, { size: big * 0.85, color: bDark, align: "left" });
    }

    // intercept point (0, b)
    ctx.fillStyle = theme.bg;
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(X(0), Y(b), 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    pill(ctx, `切片 (0, ${fmt(b)})`, X(0) - big * 0.7, Y(b) - (a >= 0 ? big * 1.2 : -big * 1.2), { size: big * 0.85, color: theme.ink, align: "right", mono: false });

    // point (1, a+b) for reference
    ctx.fillStyle = theme.a;
    ctx.beginPath();
    ctx.arc(X(x0), Y(y0), 5, 0, Math.PI * 2);
    ctx.fill();

    formulaCard(ctx, w, h, theme, [
      [["y = ", theme.ink], [fmt(a), bDark], ["x", theme.ink], [b === 0 ? "" : b > 0 ? " + " : " − ", theme.ink], [b === 0 ? "" : fmt(Math.abs(b)), theme.ink]],
      [["傾き a = ", theme.dim], [fmt(a), bDark], ["（右へ 1 で 上へ a）", theme.dim], ["   ", theme.dim], ["切片 b = ", theme.dim], [fmt(b), theme.ink], ["（y 軸と交わる高さ）", theme.dim]],
    ]);
  },
};

/* ------------------------------------------------------------------ */
/* 二次関数 y = ax²                                                     */
/* ------------------------------------------------------------------ */
const quadratic = {
  id: "quadratic",
  title: "二次関数 y=ax²",
  unit: "二次関数 y = ax²",
  params: {
    a: { label: "a", min: -3, max: 3, step: 0.1, default: 1 },
  },
  primary: "a",
  equation(inst) {
    const a = inst.get("a");
    return `y = ${fmt(a)}x²`;
  },
  readout(inst) {
    const a = inst.get("a");
    return `a = ${fmt(a)}   ${a > 0 ? "上に開く" : a < 0 ? "下に開く" : "直線 y = 0"}   x = 1 → y = ${fmt(a)}   x = 2 → y = ${fmt(4 * a)}`;
  },
  narration(inst) {
    const a = inst.get("a");
    return `aが${fmt(a)}のとき、放物線は${a > 0 ? "上に" : "下に"}開きます。aの絶対値を大きくすると、放物線は細くなります。`;
  },
  render(inst, ctx, w, h, theme) {
    const a = inst.get("a");
    const big = bigFont(w, h);
    // keep the x = ±2 points (|y| = 4|a|) inside the visible band above the formula card
    const band = h * 0.42;
    const unit = Math.max(Math.min(w, h) / 20, Math.min(Math.min(w, h) / 12, band / Math.max(1.5, 4 * Math.abs(a) + 0.6)));
    const { ox, oy } = drawAxes(ctx, w, h, unit, theme, { origin: { x: w / 2, y: a >= 0 ? h * 0.6 : h * 0.18 } });
    const X = (x) => ox + x * unit;
    const Y = (y) => oy - y * unit;
    const aDark = darker(theme.a);
    const bDark = darker(theme.b);

    // axis of symmetry
    ctx.strokeStyle = alpha(theme.a, 0.5);
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 7]);
    ctx.beginPath();
    ctx.moveTo(ox, 0); ctx.lineTo(ox, h);
    ctx.stroke();
    ctx.setLineDash([]);

    // reference y = x² ghost
    ctx.strokeStyle = theme.dim;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 6]);
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    for (let px = 0; px <= w; px += 3) {
      const x = (px - ox) / unit;
      const y = x * x;
      if (px === 0) ctx.moveTo(px, Y(y)); else ctx.lineTo(px, Y(y));
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    if (Math.abs(a - 1) > 0.05) {
      const gx = 2.6;
      const gy = Y(gx * gx);
      if (gy > big * 2) pill(ctx, "y = x²（くらべる用）", X(gx) + big * 0.4, gy, { size: big * 0.8, color: theme.dim, align: "left", weight: 500 });
    }

    // the parabola
    ctx.strokeStyle = theme.a;
    ctx.lineWidth = 4.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let px = 0; px <= w; px += 2) {
      const x = (px - ox) / unit;
      const y = a * x * x;
      if (px === 0) ctx.moveTo(px, Y(y)); else ctx.lineTo(px, Y(y));
    }
    ctx.stroke();

    // value bars at x = ±1, ±2 : height = a·x²
    for (const x of [-2, -1, 1, 2]) {
      const y = a * x * x;
      ctx.fillStyle = alpha(theme.b, 0.22);
      ctx.fillRect(X(x) - unit * 0.14, Math.min(Y(0), Y(y)), unit * 0.28, Math.abs(Y(y) - Y(0)));
      ctx.strokeStyle = bDark;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(X(x), Y(0)); ctx.lineTo(X(x), Y(y));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = theme.b;
      ctx.strokeStyle = theme.bg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(X(x), Y(y), 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const label = x > 0 ? `${fmt(a)} × ${x}² = ${fmt(y)}` : `${fmt(y)}`;
      const visible = Y(y) > big * 1.5 && Y(y) < h - big * 1.5;
      if (Math.abs(y) > 0.001 && visible) {
        if (Math.abs(x) === 1) {
          // beside the point, so it never collides with the vertex label
          pill(ctx, label, X(x) + Math.sign(x) * big * 0.8, Y(y), { size: big * 0.8, color: bDark, mono: true, align: x > 0 ? "left" : "right" });
        } else {
          pill(ctx, label, X(x), Y(y) + (a >= 0 ? big * 1.2 : -big * 1.2), { size: big * 0.8, color: bDark, mono: true });
        }
      }
    }

    // vertex
    ctx.fillStyle = theme.bg;
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(X(0), Y(0), 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    pill(ctx, "頂点 (0, 0)", X(0), Y(0) + (a >= 0 ? -big * 1.3 : big * 1.3), { size: big * 0.85, color: theme.ink });

    // opening direction
    const dirY = a >= 0 ? -1 : 1;
    const sx = X(2.9);
    const sy = Y(a * 2.9 * 2.9);
    if (sy > big * 2 && sy < h - big * 2) {
      arrow(ctx, sx, sy - dirY * big * 0.2, sx, sy + dirY * big * 2.2, aDark, 3, 10);
    }
    pill(ctx, Math.abs(a) < 0.05 ? "a = 0 → 直線 y = 0" : a > 0 ? "a > 0 → 上に開く" : "a < 0 → 下に開く", w - big * 1.2, big * 1.5, { size: big * 0.9, color: aDark, align: "right" });
    pill(ctx, Math.abs(a) > 1.05 ? "|a| が大きい → 細い" : Math.abs(a) < 0.95 ? "|a| が小さい → 広がる" : "|a| = 1（y = x² と同じ太さ）", w - big * 1.2, big * 3.3, { size: big * 0.9, color: theme.dim, align: "right", weight: 500 });

    formulaCard(ctx, w, h, theme, [
      [["y = ", theme.ink], [fmt(a), aDark], ["x²", theme.ink]],
      [["x = 2 のとき  y = ", theme.dim], [fmt(a), aDark], [" × 2² = ", theme.dim], [fmt(4 * a), bDark], ["    軸は x = 0、頂点は原点 ", theme.dim]],
    ]);
  },
};

/* ------------------------------------------------------------------ */
/* 円周角の定理 — P moves, ∠APB stays constant                         */
/* ------------------------------------------------------------------ */
const inscribedAngle = {
  id: "inscribedAngle",
  title: "円周角の定理",
  unit: "円周角の定理（∠APB = ½∠AOB）",
  params: {
    p: { label: "点Pの位置", min: 0, max: 1, step: 0.01, default: 0.5 },
    arc: { label: "弧ABの大きさ", min: 40, max: 160, step: 5, default: 100, integer: true },
  },
  primary: "p",
  anglesOf(inst) {
    const arcDeg = inst.get("arc");
    const half = (arcDeg / 2) * (Math.PI / 180);
    const A = Math.PI / 2 + half;
    const B = Math.PI / 2 - half;
    // P travels the major arc from B to A (counter-clockwise through the top)
    const span = 2 * Math.PI - 2 * half;
    const P = B - 0.08 - inst.get("p") * (span - 0.16);
    return { A, B, P, central: arcDeg };
  },
  equation(inst) {
    const { central } = inscribedAngle.anglesOf(inst);
    return `∠APB = ∠AOB ÷ 2 = ${fmt(central / 2)}°`;
  },
  readout(inst) {
    const ang = inscribedAngle.measure(inst);
    return `∠AOB = ${fmt(ang.central)}°   ∠APB = ${fmt(ang.inscribed, 2)}°（Pを動かしても一定）`;
  },
  measure(inst) {
    const { A, B, P, central } = inscribedAngle.anglesOf(inst);
    const pt = (ang) => ({ x: Math.cos(ang), y: Math.sin(ang) });
    const a = pt(A), b = pt(B), p = pt(P);
    const v1 = { x: a.x - p.x, y: a.y - p.y };
    const v2 = { x: b.x - p.x, y: b.y - p.y };
    const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y));
    const inscribed = (Math.acos(clamp(cos, -1, 1)) * 180) / Math.PI;
    return { central, inscribed };
  },
  narration(inst) {
    const { central } = inscribedAngle.anglesOf(inst);
    return `円周上の点Pをどこに動かしても、角APBは${fmt(central / 2)}度のまま変わりません。中心角AOBの半分です。これが円周角の定理です。`;
  },
  render(inst, ctx, w, h, theme) {
    const big = bigFont(w, h);
    const R = Math.min(w * 0.3, h * 0.3);
    const cx = w / 2;
    const cy = h * 0.4;
    const { A, B, P, central } = inscribedAngle.anglesOf(inst);
    const pt = (ang) => ({ x: cx + R * Math.cos(ang), y: cy - R * Math.sin(ang) });
    const a = pt(A), b = pt(B), p = pt(P), o = { x: cx, y: cy };
    const aDark = darker(theme.a);
    const bDark = darker(theme.b);

    // angle wedge / arc helpers (screen coords)
    const angleSpan = (c, p1, p2) => {
      const a1 = Math.atan2(p1.y - c.y, p1.x - c.x);
      const a2 = Math.atan2(p2.y - c.y, p2.x - c.x);
      let d = a2 - a1;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      return { a1, d };
    };
    const wedge = (c, p1, p2, rad, fill) => {
      const { a1, d } = angleSpan(c, p1, p2);
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.arc(c.x, c.y, rad, a1, a1 + d, d < 0);
      ctx.closePath();
      ctx.fill();
    };
    const arcAt = (c, p1, p2, rad, color, width = 3) => {
      const { a1, d } = angleSpan(c, p1, p2);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(c.x, c.y, rad, a1, a1 + d, d < 0);
      ctx.stroke();
    };
    const bisectorPoint = (c, p1, p2, dist) => {
      const { a1, d } = angleSpan(c, p1, p2);
      const m = a1 + d / 2;
      return { x: c.x + Math.cos(m) * dist, y: c.y + Math.sin(m) * dist };
    };

    // circle
    ctx.fillStyle = theme.name === "ink" ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.025)";
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // ghost positions of P: the angle is the same anywhere on the major arc
    const ghostP = [0.12, 0.88].map((pp) => {
      const half = (central / 2) * (Math.PI / 180);
      const span = 2 * Math.PI - 2 * half;
      return pt(B - 0.08 - pp * (span - 0.16));
    });
    for (const g of ghostP) {
      if (Math.hypot(g.x - p.x, g.y - p.y) < R * 0.35) continue;
      ctx.strokeStyle = alpha(theme.a, 0.35);
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      ctx.moveTo(g.x, g.y); ctx.lineTo(a.x, a.y);
      ctx.moveTo(g.x, g.y); ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      arcAt(g, a, b, big * 1.5, alpha(theme.a, 0.5), 2.5);
      ctx.fillStyle = alpha(theme.a, 0.4);
      ctx.beginPath();
      ctx.arc(g.x, g.y, 5, 0, Math.PI * 2);
      ctx.fill();
      const lp = bisectorPoint(g, a, b, big * 2.4);
      text(ctx, `${fmt(central / 2)}°`, lp.x, lp.y, { size: big * 0.8, color: alpha(theme.a, 0.7), align: "center", mono: true, weight: 700 });
    }

    // arc AB highlight (the arc both angles "look at")
    ctx.strokeStyle = theme.b;
    ctx.lineWidth = 9;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, R, -A, -B, false);
    ctx.stroke();
    ctx.lineCap = "butt";
    {
      const mid = pt((A + B) / 2);
      const dx = mid.x - cx, dy = mid.y - cy;
      const len = Math.hypot(dx, dy) || 1;
      pill(ctx, "弧 AB", mid.x + (dx / len) * big * 1.6, mid.y + (dy / len) * big * 1.6, { size: big * 0.85, color: bDark });
    }

    // central angle (wedge + rays)
    wedge(o, a, b, big * 2.4, alpha(theme.b, 0.28));
    arcAt(o, a, b, big * 2.4, bDark, 3);
    ctx.strokeStyle = bDark;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(o.x, o.y); ctx.lineTo(a.x, a.y);
    ctx.moveTo(o.x, o.y); ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // inscribed angle (wedge + rays)
    wedge(p, a, b, big * 2.6, alpha(theme.a, 0.28));
    arcAt(p, a, b, big * 2.6, aDark, 3);
    ctx.strokeStyle = theme.a;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y); ctx.lineTo(a.x, a.y);
    ctx.moveTo(p.x, p.y); ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.lineCap = "butt";

    // points
    for (const [q, label, color] of [[a, "A", theme.ink], [b, "B", theme.ink], [o, "O", theme.ink], [p, "P", aDark]]) {
      ctx.fillStyle = q === p ? theme.a : theme.bg;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q === p ? 9 : 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const dx = q.x - cx, dy = q.y - cy;
      const len = Math.hypot(dx, dy) || 1;
      const lx = q === o ? q.x - big * 1.0 : q.x + (dx / len) * big * 1.4;
      const ly = q === o ? q.y + big * 0.9 : q.y + (dy / len) * big * 1.4;
      text(ctx, label, lx, ly, { size: big * 1.1, color, align: "center", weight: 700 });
    }

    // angle values
    const ang = inscribedAngle.measure(inst);
    const lpP = bisectorPoint(p, a, b, big * 3.9);
    pill(ctx, `∠APB = ${fmt(ang.inscribed, 1)}°`, lpP.x, lpP.y, { size: big * 0.95, color: aDark, mono: true });
    const lpO = bisectorPoint(o, a, b, big * 3.7);
    pill(ctx, `∠AOB = ${fmt(ang.central)}°`, lpO.x, lpO.y, { size: big * 0.95, color: bDark, mono: true });

    // hint
    pill(ctx, "P をどこへ動かしても ∠APB は同じ", w - big * 1.2, big * 1.5, { size: big * 0.9, color: aDark, align: "right" });

    formulaCard(ctx, w, h, theme, [
      [["円周角 ∠APB", aDark], [" = ", theme.dim], ["中心角 ∠AOB", bDark], [" ÷ 2", theme.ink]],
      [[`${fmt(ang.inscribed, 1)}°`, aDark], [" = ", theme.dim], [`${fmt(ang.central)}°`, bDark], [" ÷ 2", theme.dim], ["    同じ弧 AB に対する円周角はすべて等しい", theme.dim]],
    ]);
  },
};

/* ------------------------------------------------------------------ */
/* 立方体の切断 — 6 辺の中点を通る平面 → 切り口は正六角形（three.js）   */
/* ------------------------------------------------------------------ */
const cubeSection = {
  id: "cubeSection",
  title: "立方体の切断",
  unit: "立方体の切断（切り口は正六角形）",
  is3d: true,
  params: {
    cut: { label: "切る（開く）", min: 0, max: 1, step: 0.01, default: 0 },
    spin: { label: "回転", min: 0, max: 360, step: 1, default: 30 },
  },
  primary: "cut",
  equation(inst) {
    const cut = inst.get("cut");
    return cut < 0.05 ? "6 辺の中点を通る平面で切る" : "切り口 = 正六角形（1 辺 = a√2 ⁄ 2）";
  },
  readout(inst) {
    const cut = inst.get("cut");
    return `開き ${Math.round(cut * 100)}%   回転 ${Math.round(inst.get("spin"))}°   切り口の 1 辺 = a√2 ⁄ 2 ≈ ${fmt(Math.SQRT2 / 2, 3)}a（a = 立方体の 1 辺）`;
  },
  narration(inst) {
    return `立方体の、となり合わない6本の辺の中点を通る平面で切ります。つまむと切り口が開きます。切り口の6つの頂点はすべて辺の中点で、どの辺も中点から中点までの長さは同じ、1辺のルート2分の1です。角もすべて120度なので、切り口は正六角形になります。`;
  },
  render3d(inst, w, h, theme, canvas) {
    Cube3D.ensure(canvas);
    Cube3D.render({ cut: inst.get("cut"), spin: inst.get("spin"), theme, w, h });
  },
  render(inst, ctx, w, h, theme) {
    const big = bigFont(w, h);
    const cut = inst.get("cut");
    const spin = inst.get("spin");
    const aDark = darker(theme.a);
    const bDark = darker(theme.b);
    const st = Cube3D.status();

    if (st.state !== "ready") {
      pill(ctx, st.state === "error" ? st.message : "3D（three.js）を読み込み中…", w / 2, h / 2, { size: big, color: theme.dim });
      return;
    }

    // labels anchored to the projected geometry
    const pj = Cube3D.projectHexagon(cut, spin);
    if (pj) {
      // mark one edge midpoint
      const m = pj.verts.reduce((best, v) => (v.x > best.x ? v : best), pj.verts[0]);
      arrow(ctx, m.x + big * 3.6, m.y - big * 1.6, m.x + big * 0.6, m.y - big * 0.25, bDark, 2.5, 9);
      pill(ctx, "辺の中点（6 つ）", m.x + big * 3.6, m.y - big * 2.1, { size: big * 0.85, color: bDark, align: "left" });

      if (cut > 0.25) {
        const alphaK = Math.min(1, (cut - 0.25) / 0.3);
        ctx.globalAlpha = alphaK;
        pill(ctx, "切り口 = 正六角形", pj.center.x, pj.center.y, { size: big * 0.95, color: "#fff", bg: aDark });
        // side-length note on the front-most edge
        let fi = 0;
        for (let i = 0; i < 6; i++) {
          const a = pj.verts[i], b = pj.verts[(i + 1) % 6];
          const za = a.z + b.z;
          const zb = pj.verts[fi].z + pj.verts[(fi + 1) % 6].z;
          if (za > zb) fi = i;
        }
        const a = pj.verts[fi], b = pj.verts[(fi + 1) % 6];
        pill(ctx, "1 辺 = a√2 ⁄ 2（どの辺も同じ）", (a.x + b.x) / 2, (a.y + b.y) / 2 + big * 1.1, { size: big * 0.8, color: theme.ink });
        ctx.globalAlpha = 1;
      }
    }

    if (cut < 0.05) {
      pill(ctx, "つまんで（または スライダーで）切り口を開く →", w - big * 1.2, big * 1.5, { size: big * 0.9, color: aDark, align: "right" });
    } else {
      pill(ctx, "「回転」を選ぶと向きを変えられる", w - big * 1.2, big * 1.5, { size: big * 0.85, color: theme.dim, align: "right", weight: 500 });
    }

    formulaCard(ctx, w, h, theme, [
      [["切り口", aDark], [" = ", theme.dim], ["正六角形", aDark], ["   頂点はすべて ", theme.dim], ["辺の中点", bDark]],
      [["6 辺とも 中点→中点 の長さ = a√2 ⁄ 2 で等しく、角はすべて 120°", theme.dim]],
    ]);
  },
};

export const PARTS = { circleArea, linear, quadratic, inscribedAngle, cubeSection };

export function createPart(templateId, params = {}) {
  const def = PARTS[templateId];
  if (!def) throw new Error(`unknown template: ${templateId}`);
  return makeInstance(def, params);
}
