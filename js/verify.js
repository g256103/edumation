/**
 * Numeric verification. Contract: verify(spec) → { ok, checks: [{name, ok, detail}] }
 *  - verifyLocal: instant, in-browser (always runs; what the classroom relies on)
 *  - verifyWithGemini: Gemini Code Execution re-derives the numbers independently
 */
const EPS = 1e-9;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const f = (v, d = 6) => Number(v).toFixed(d);

export function verifyLocal(spec) {
  const { template, params: p } = spec;
  const checks = [];

  if (template === "circleArea") {
    const { n, r } = p;
    const theta = (2 * Math.PI) / n;
    const sectorArea = 0.5 * r * r * theta;
    const sum = sectorArea * n;
    const target = Math.PI * r * r;
    checks.push({
      name: "扇形 n 個の面積の和 = πr²",
      ok: near(sum, target, 1e-9),
      detail: `Σ = ${f(sum)}  πr² = ${f(target)}`,
    });
    checks.push({
      name: "並べ替え後の近似長方形: 横 = πr（円周の半分）",
      ok: near((2 * Math.PI * r) / 2, Math.PI * r, EPS),
      detail: `2πr / 2 = ${f(Math.PI * r)}`,
    });
    checks.push({
      name: "近似長方形の面積 πr × r = πr²",
      ok: near(Math.PI * r * r, target, EPS),
      detail: `πr × r = ${f(Math.PI * r * r)}`,
    });
    checks.push({
      name: "分割数 n は偶数（互い違いに並べられる）",
      ok: Number.isInteger(n) && n % 2 === 0 && n >= 4,
      detail: `n = ${n}`,
    });
    // Convergence: parallelogram base (n/2 chords) → πr as n grows
    const chord = 2 * r * Math.sin(theta / 2);
    const base = (n / 2) * chord;
    checks.push({
      name: "底辺 (n/2)·弦 が πr に近づく（誤差は n↑で減少）",
      ok: Math.abs(base - Math.PI * r) < Math.abs((2 * r * Math.sin(Math.PI / 4)) * 2 - Math.PI * r) + 1e-9,
      detail: `(n/2)·弦 = ${f(base, 4)}  πr = ${f(Math.PI * r, 4)}  誤差 ${f(Math.abs(base - Math.PI * r), 4)}`,
    });
  } else if (template === "linear") {
    const { a, b } = p;
    const pts = [-2, 0, 1, 3].map((x) => ({ x, y: a * x + b }));
    checks.push({
      name: "描画に使う点がすべて y = ax + b を満たす",
      ok: pts.every((q) => near(q.y, a * q.x + b, 1e-9)),
      detail: pts.map((q) => `(${q.x}, ${f(q.y, 2)})`).join(" "),
    });
    checks.push({
      name: "y切片は (0, b)",
      ok: near(a * 0 + b, b, EPS),
      detail: `(0, ${f(b, 2)})`,
    });
    if (Math.abs(a) > 1e-9) {
      const xi = -b / a;
      checks.push({
        name: "x切片 (−b/a, 0) で y = 0",
        ok: near(a * xi + b, 0, 1e-9),
        detail: `x = ${f(xi, 3)}  →  y = ${f(a * xi + b, 9)}`,
      });
    }
    checks.push({
      name: "x が 1 増えると y は a 増える（傾きの定義）",
      ok: near((a * 2 + b) - (a * 1 + b), a, 1e-9),
      detail: `f(2) − f(1) = ${f(a, 3)}`,
    });
  } else if (template === "quadratic") {
    const { a } = p;
    const xs = [-2, -1, 1, 2];
    checks.push({
      name: "標本点が y = ax² を満たす",
      ok: xs.every((x) => near(a * x * x, a * x * x, EPS)),
      detail: xs.map((x) => `(${x}, ${f(a * x * x, 2)})`).join(" "),
    });
    checks.push({
      name: "y軸対称: f(x) = f(−x)",
      ok: xs.every((x) => near(a * x * x, a * x * -x * -1, 1e-9)),
      detail: `f(2) = ${f(a * 4, 3)}  f(−2) = ${f(a * 4, 3)}`,
    });
    checks.push({
      name: "頂点は原点 (0, 0)",
      ok: near(a * 0, 0, EPS),
      detail: `f(0) = 0`,
    });
    checks.push({
      name: "a の符号で開く向きが決まる",
      ok: a === 0 || Math.sign(a * 1) === Math.sign(a),
      detail: a > 0 ? "a > 0 → 上に開く" : a < 0 ? "a < 0 → 下に開く" : "a = 0（直線）",
    });
  } else if (template === "inscribedAngle") {
    const { arc } = p;
    const half = (arc / 2) * (Math.PI / 180);
    const A = Math.PI / 2 + half;
    const B = Math.PI / 2 - half;
    const span = 2 * Math.PI - 2 * half;
    const samples = [0.05, 0.25, 0.5, 0.75, 0.95].map((t) => B - 0.08 - t * (span - 0.16));
    const inscribedAt = (P) => {
      const pt = (ang) => ({ x: Math.cos(ang), y: Math.sin(ang) });
      const a = pt(A), b = pt(B), q = pt(P);
      const v1 = { x: a.x - q.x, y: a.y - q.y };
      const v2 = { x: b.x - q.x, y: b.y - q.y };
      const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y));
      return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    };
    const angles = samples.map(inscribedAt);
    const spread = Math.max(...angles) - Math.min(...angles);
    checks.push({
      name: "P を動かしても ∠APB が一定（5 地点）",
      ok: spread < 1e-6,
      detail: angles.map((x) => f(x, 4)).join("°, ") + "°",
    });
    checks.push({
      name: "∠APB = ½ ∠AOB",
      ok: near(angles[2], arc / 2, 1e-6),
      detail: `∠APB = ${f(angles[2], 4)}°  ½∠AOB = ${f(arc / 2, 4)}°`,
    });
  } else if (template === "cubeSection") {
    // cube [-1,1]^3, plane x+y+z=0, hexagon = the six edge midpoints
    const hex = [[1, -1, 0], [1, 0, -1], [0, 1, -1], [-1, 1, 0], [-1, 0, 1], [0, -1, 1]];
    const isEdgeMid = (v) => v.filter((c) => c === 0).length === 1 && v.every((c) => Math.abs(c) === 1 || c === 0);
    checks.push({
      name: "6 頂点はすべて辺の中点",
      ok: hex.every(isEdgeMid),
      detail: hex.map((v) => `(${v.join(",")})`).join(" "),
    });
    checks.push({
      name: "6 頂点が同一平面 x+y+z=0 上",
      ok: hex.every((v) => v[0] + v[1] + v[2] === 0),
      detail: "x+y+z = " + hex.map((v) => v[0] + v[1] + v[2]).join(", "),
    });
    const sides = hex.map((v, i) => {
      const u = hex[(i + 1) % 6];
      return Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]);
    });
    checks.push({
      name: "6 辺の長さが等しい（= √2 × 半辺）",
      ok: sides.every((s) => near(s, Math.SQRT2, 1e-9)),
      detail: sides.map((s) => f(s, 4)).join(", "),
    });
    const angles = hex.map((v, i) => {
      const p = hex[(i + 5) % 6], q = hex[(i + 1) % 6];
      const a = [p[0] - v[0], p[1] - v[1], p[2] - v[2]];
      const b = [q[0] - v[0], q[1] - v[1], q[2] - v[2]];
      const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      return (Math.acos(dot / (Math.hypot(...a) * Math.hypot(...b))) * 180) / Math.PI;
    });
    checks.push({
      name: "内角がすべて 120°",
      ok: angles.every((x) => near(x, 120, 1e-9)),
      detail: angles.map((x) => f(x, 2)).join("°, ") + "°",
    });
  } else {
    checks.push({ name: "未知のテンプレート", ok: false, detail: template });
  }

  return { ok: checks.every((c) => c.ok), checks, source: "local" };
}

/* ------------------------------------------------------------------ */
/* Gemini Code Execution — independent re-derivation                  */
/* ------------------------------------------------------------------ */
const VERIFY_PROMPT = (spec) => `あなたは中学数学の検算係です。次の「部品＋パラメータ」JSONが数学的に正しいか、
必ず code_execution ツールで Python を実行して数値で確かめてください（暗算で済ませない）。

JSON:
${JSON.stringify(spec)}

テンプレートごとの検証項目:
- circleArea: n個の扇形面積の和 = πr²、並べ替え後の近似長方形（横 πr, 縦 r）の面積 = πr²、nが偶数
- linear: 複数の x で y = a x + b を満たす、y切片 (0,b)、x切片 (-b/a,0)
- quadratic: y = a x² の標本点、f(x)=f(-x)、頂点 (0,0)
- inscribedAngle: 弧AB(中心角 arc 度)に対し、円周上の複数の点Pで ∠APB が一定かつ arc/2 に等しい
- cubeSection: 立方体 [-1,1]^3 を平面 x+y+z=0 で切ると、切り口の頂点は6本の辺の中点で、6辺の長さが等しく内角がすべて120°（正六角形）

最後に、次の JSON だけを出力してください（前後に文章を付けない）:
{"ok": true|false, "checks": [{"name": "...", "ok": true|false, "detail": "数値を含む短い説明"}]}`;

export async function verifyWithGemini(spec, { apiKey, model = "gemini-2.5-flash", signal } = {}) {
  if (!apiKey) return { ok: null, checks: [], source: "gemini", error: "APIキー未設定" };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: VERIFY_PROMPT(spec) }] }],
    tools: [{ codeExecution: {} }],
    generationConfig: { temperature: 0 },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return { ok: null, checks: [], source: "gemini", error: `HTTP ${res.status} ${txt.slice(0, 160)}` };
  }
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const executed = parts.some((p) => p.executableCode || p.codeExecutionResult);
  const textParts = parts.filter((p) => typeof p.text === "string").map((p) => p.text);
  const joined = textParts.join("\n");
  const m = joined.match(/\{[\s\S]*\}/);
  if (!m) return { ok: null, checks: [], source: "gemini", error: "JSONを抽出できませんでした", raw: joined, executed };
  try {
    const parsed = JSON.parse(m[0]);
    return {
      ok: !!parsed.ok,
      checks: Array.isArray(parsed.checks) ? parsed.checks : [],
      source: "gemini",
      executed,
      code: parts.find((p) => p.executableCode)?.executableCode?.code || null,
    };
  } catch (e) {
    return { ok: null, checks: [], source: "gemini", error: "JSON解析に失敗", raw: joined, executed };
  }
}
