/**
 * Natural language → actions.
 * Layer 1 (instant): rule-based parser for classroom commands.
 * Layer 2 (optional): Gemini structured output → { template, params, actions }.
 *
 * Action shapes:
 *   {type:"loadTemplate", template, params?}
 *   {type:"setActiveParam", param}
 *   {type:"scaleParam", factor}             // 倍にして / 半分にして
 *   {type:"nudgeParam", steps}              // 増やして / 減らして
 *   {type:"setParamValue", param?, value}   // 12にして
 *   {type:"animate", param, value}          // 並べて(t=1) / 戻して(t=0)
 *   {type:"lock"} {type:"unlock"} {type:"cycleTheme"} {type:"narrate"} {type:"reset"}
 */
import { PARTS } from "./parts.js";

const KANJI = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function kanjiToNumber(s) {
  // supports up to 千の位 e.g. 十二, 二十, 百二十
  let total = 0;
  let cur = 0;
  let hasAny = false;
  for (const ch of s) {
    if (ch in KANJI) {
      cur = KANJI[ch];
      hasAny = true;
    } else if (ch === "十") {
      total += (cur || 1) * 10;
      cur = 0;
      hasAny = true;
    } else if (ch === "百") {
      total += (cur || 1) * 100;
      cur = 0;
      hasAny = true;
    } else if (ch === "千") {
      total += (cur || 1) * 1000;
      cur = 0;
      hasAny = true;
    } else {
      return null;
    }
  }
  return hasAny ? total + cur : null;
}

export function extractNumber(text) {
  const norm = text.replace(/[０-９．－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/マイナス/g, "-");
  const m = norm.match(/-?\d+(?:\.\d+)?/);
  if (m) return parseFloat(m[0]);
  const k = norm.match(/[〇零一二三四五六七八九十百千]+/);
  if (k) {
    const v = kanjiToNumber(k[0]);
    if (v != null) return v;
  }
  return null;
}

const TEMPLATE_WORDS = [
  [/円\s*の\s*面積|扇形|長方形に|円の公式|パイアール/, "circleArea"],
  [/一次関数|いちじかんすう|傾き|切片|直線のグラフ/, "linear"],
  [/二次関数|にじかんすう|放物線|エックスの二乗|x\s*の\s*2\s*乗|ax²|ax2/, "quadratic"],
  [/円周角|中心角|えんしゅうかく/, "inscribedAngle"],
  [/立方体|切断|切り口|正六角形|りっぽうたい/, "cubeSection"],
];

const PARAM_WORDS = {
  circleArea: [[/分割|ぶんかつ|個数|枚/, "n"], [/半径/, "r"], [/並べ|ならべ/, "t"]],
  linear: [[/傾き|かたむき/, "a"], [/切片|せっぺん/, "b"]],
  quadratic: [[/\ba\b|エー|開き/, "a"]],
  inscribedAngle: [[/点\s*P|ピー|動点|位置/, "p"], [/弧|中心角|こ(?!れ)/, "arc"]],
  cubeSection: [[/回転|回して|まわして|向き/, "spin"], [/切|開|ひらい|閉じ|とじ/, "cut"]],
};

export function parseCommand(text, ctx = {}) {
  const t = text.trim();
  const actions = [];
  if (!t) return { actions, matched: false };

  // Template switch
  for (const [re, template] of TEMPLATE_WORDS) {
    if (re.test(t) && (ctx.template !== template || /説明|出して|見せて|表示|やって|お願い/.test(t))) {
      actions.push({ type: "loadTemplate", template });
      break;
    }
  }
  const template = actions.find((a) => a.type === "loadTemplate")?.template || ctx.template;

  // Param focus
  let param = null;
  for (const [re, p] of PARAM_WORDS[template] || []) {
    if (re.test(t)) {
      param = p;
      break;
    }
  }
  if (param && param !== "t") actions.push({ type: "setActiveParam", param });

  // Control
  if (/止め|とめ|ストップ|固定|ロック/.test(t)) actions.push({ type: "lock" });
  if (/動かして|再開|解除|アンロック|つまんで/.test(t)) actions.push({ type: "unlock" });
  if (/色|いろ|カラー/.test(t)) actions.push({ type: "cycleTheme" });
  if (/説明|せつめい|解説|教えて|ナレーション/.test(t)) actions.push({ type: "narrate" });
  if (/リセット|最初から|初期/.test(t)) actions.push({ type: "reset" });

  if (template === "circleArea") {
    if (/並べ|ならべ|長方形に|変形/.test(t) && !/戻/.test(t)) actions.push({ type: "animate", param: "t", value: 1 });
    if (/戻して|もどして|円に/.test(t)) actions.push({ type: "animate", param: "t", value: 0 });
  }
  if (template === "cubeSection") {
    if (/切って|きって|開いて|ひらいて|切断して|切り口を見せて/.test(t)) actions.push({ type: "setParamValue", param: "cut", value: 1 });
    if (/閉じて|とじて|戻して|もどして|元に/.test(t)) actions.push({ type: "setParamValue", param: "cut", value: 0 });
  }

  // Quantity
  const num = extractNumber(t);
  if (/倍|ばい/.test(t) && !/半分/.test(t)) {
    actions.push({ type: "scaleParam", factor: num && num !== 2 ? num : 2, param });
  } else if (/半分|はんぶん/.test(t)) {
    actions.push({ type: "scaleParam", factor: 0.5, param });
  } else if (/増やして|ふやして|大きく|おおきく|もっと|上げて/.test(t)) {
    actions.push({ type: "nudgeParam", steps: num ?? 1, param });
  } else if (/減らして|へらして|小さく|ちいさく|下げて/.test(t)) {
    actions.push({ type: "nudgeParam", steps: -(num ?? 1), param });
  } else if (num != null && /に(して|する)|にせっと|で|へ$/.test(t)) {
    actions.push({ type: "setParamValue", param, value: num });
  } else if (num != null && /分割|個|枚/.test(t) && template === "circleArea") {
    actions.push({ type: "setParamValue", param: "n", value: num });
  }

  return { actions, matched: actions.length > 0 };
}

/* ------------------------------------------------------------------ */
/* Gemini structured output: free text → template + params + actions  */
/* ------------------------------------------------------------------ */
const SCHEMA = {
  type: "OBJECT",
  properties: {
    template: { type: "STRING", enum: Object.keys(PARTS), nullable: true },
    params: {
      type: "OBJECT",
      properties: {
        n: { type: "NUMBER", nullable: true },
        r: { type: "NUMBER", nullable: true },
        t: { type: "NUMBER", nullable: true },
        a: { type: "NUMBER", nullable: true },
        b: { type: "NUMBER", nullable: true },
        p: { type: "NUMBER", nullable: true },
        arc: { type: "NUMBER", nullable: true },
      },
      nullable: true,
    },
    activeParam: { type: "STRING", nullable: true },
    actions: {
      type: "ARRAY",
      items: { type: "STRING", enum: ["lock", "unlock", "cycleTheme", "narrate", "reset", "rearrange", "unrearrange"] },
    },
    reply: { type: "STRING" },
  },
  required: ["actions", "reply"],
};

const describeParts = () =>
  Object.values(PARTS)
    .map((p) => `- ${p.id}（${p.unit}）: params ${Object.entries(p.params).map(([k, v]) => `${k}=${v.label}[${v.min}..${v.max}]`).join(", ")}`)
    .join("\n");

export async function interpretWithGemini(text, ctx, { apiKey, model = "gemini-2.5-flash", signal } = {}) {
  if (!apiKey) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const prompt = `あなたは中学数学の授業アニメ「edumation」の操作係です。先生の発話を、既存の部品（テンプレート）とパラメータ、操作に変換します。
自由に図を発明せず、必ず以下の部品から選びます。

部品一覧:
${describeParts()}

現在の状態: template=${ctx.template}, params=${JSON.stringify(ctx.params)}, activeParam=${ctx.activeParam}

発話: 「${text}」

出力は JSON のみ。該当部品が無ければ template は null。reply は先生向けの短い日本語（20文字以内）。`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
    },
  };
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  const txt = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  const parsed = JSON.parse(txt);

  const actions = [];
  if (parsed.template && parsed.template !== ctx.template) actions.push({ type: "loadTemplate", template: parsed.template, params: parsed.params || undefined });
  if (parsed.params && (!parsed.template || parsed.template === ctx.template)) {
    for (const [k, v] of Object.entries(parsed.params)) {
      if (v == null) continue;
      if (k === "t") actions.push({ type: "animate", param: "t", value: v });
      else actions.push({ type: "setParamValue", param: k, value: v });
    }
  }
  if (parsed.activeParam) actions.push({ type: "setActiveParam", param: parsed.activeParam });
  for (const a of parsed.actions || []) {
    if (a === "rearrange") actions.push({ type: "animate", param: "t", value: 1 });
    else if (a === "unrearrange") actions.push({ type: "animate", param: "t", value: 0 });
    else actions.push({ type: a });
  }
  return { actions, reply: parsed.reply || "", matched: actions.length > 0 };
}
