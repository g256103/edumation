/**
 * edumation — integration.
 *   hand.js   → pinch 0..1
 *   parts.js  → setNorm(name, v01) / render
 *   ai.js     → text → actions (rules first, Gemini optional)
 *   verify.js → {ok, checks} local + Gemini Code Execution
 */
import { HandInput } from "./hand.js";
import { PARTS, THEMES, createPart } from "./parts.js";
import { verifyLocal, verifyWithGemini } from "./verify.js";
import { Voice } from "./voice.js";
import { parseCommand, interpretWithGemini } from "./ai.js";
import { clamp, lerp } from "./filters.js";

const $ = (id) => document.getElementById(id);
const el = {
  stage: $("stage"),
  stage3d: $("stage3d"),
  equation: $("equation"),
  verifyBadge: $("verifyBadge"),
  paramReadout: $("paramReadout"),
  caption: $("caption"),
  handState: $("handState"),
  webcam: $("webcam"),
  overlay: $("overlay"),
  camError: $("camError"),
  pinchFill: $("pinchFill"),
  pinchValue: $("pinchValue"),
  paramChips: $("paramChips"),
  paramSlider: $("paramSlider"),
  cmdForm: $("cmdForm"),
  cmdInput: $("cmdInput"),
  transcript: $("transcript"),
  cmdLog: $("cmdLog"),
  checkList: $("checkList"),
  geminiVerifyState: $("geminiVerifyState"),
  micBtn: $("micBtn"),
  camBtn: $("camBtn"),
  settingsBtn: $("settingsBtn"),
  settingsPanel: $("settingsPanel"),
  geminiKey: $("geminiKey"),
  geminiModel: $("geminiModel"),
  ttsToggle: $("ttsToggle"),
  geminiInterpretToggle: $("geminiInterpretToggle"),
  settingsSave: $("settingsSave"),
  settingsClose: $("settingsClose"),
};

const settings = {
  get key() { return localStorage.getItem("edumation.geminiKey") || ""; },
  set key(v) { localStorage.setItem("edumation.geminiKey", v || ""); },
  get model() { return localStorage.getItem("edumation.geminiModel") || "gemini-2.5-flash"; },
  set model(v) { localStorage.setItem("edumation.geminiModel", v || "gemini-2.5-flash"); },
  get tts() { return localStorage.getItem("edumation.tts") !== "0"; },
  set tts(v) { localStorage.setItem("edumation.tts", v ? "1" : "0"); },
  get geminiInterpret() { return localStorage.getItem("edumation.geminiInterpret") !== "0"; },
  set geminiInterpret(v) { localStorage.setItem("edumation.geminiInterpret", v ? "1" : "0"); },
};

const state = {
  part: null,
  activeParam: null,
  themeIdx: 0,
  locked: false,           // 「止めて」
  handPresent: false,
  pinch01: null,
  // blend-in after hand (re)appears so the value never jumps
  blendStart: 0,
  blendFromNorm: 0,
  lastSpecKey: "",
  verifyTimer: 0,
  geminiTimer: 0,
  geminiAbort: null,
  cameraOn: false,
  lastFrame: 0,
};

/* ------------------------------------------------------------------ */
/* Stage                                                               */
/* ------------------------------------------------------------------ */
const ctx = el.stage.getContext("2d");

function resizeStage() {
  const rect = el.stage.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  el.stage.width = Math.round(rect.width * dpr);
  el.stage.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = state.lastFrame ? Math.min(100, now - state.lastFrame) : 16;
  state.lastFrame = now;
  if (!state.part) return;

  applyPinch(now);
  state.part.tick(dt);

  const theme = THEMES[state.themeIdx];
  const w = el.stage.clientWidth;
  const h = el.stage.clientHeight;
  if (state.part.is3d) {
    // WebGL layer underneath, 2D canvas becomes a transparent overlay
    el.stage3d.hidden = false;
    state.part.render3d(w, h, theme, el.stage3d);
    ctx.clearRect(0, 0, w, h);
  } else {
    el.stage3d.hidden = true;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);
  }
  state.part.render(ctx, w, h, theme);
  el.stage.parentElement.style.background = theme.bg;

  el.equation.textContent = state.part.equation();
  el.paramReadout.textContent = state.part.readout();
  scheduleVerify();
}

/* ------------------------------------------------------------------ */
/* Pinch → active parameter                                            */
/* ------------------------------------------------------------------ */
function applyPinch(now) {
  if (!state.handPresent || state.locked || state.pinch01 == null) return;
  const p = state.part.def.params[state.activeParam];
  if (!p || p.animated) return;

  const k = clamp((now - state.blendStart) / 350, 0, 1);
  const targetNorm = lerp(state.blendFromNorm, state.pinch01, k);

  if (p.integer) {
    // hysteresis: only step when clearly past 65% of a step boundary
    const raw = p.min + targetNorm * (p.max - p.min);
    const cur = state.part.get(state.activeParam);
    const step = p.step || 1;
    if (raw >= cur + step * 0.65) state.part.set(state.activeParam, cur + step);
    else if (raw <= cur - step * 0.65) state.part.set(state.activeParam, cur - step);
  } else {
    state.part.setNorm(state.activeParam, targetNorm);
  }
  syncSlider();
}

function onHandFrame({ present, pinch01 }) {
  const was = state.handPresent;
  state.handPresent = present;
  state.pinch01 = pinch01;

  if (present && !was) {
    state.blendStart = performance.now();
    state.blendFromNorm = state.part ? state.part.getNorm(state.activeParam) : 0;
  }

  if (present) {
    el.pinchFill.style.width = `${Math.round(pinch01 * 100)}%`;
    el.pinchValue.textContent = pinch01.toFixed(2);
  } else {
    el.pinchValue.textContent = "—";
  }
  updateHandState();
}

function updateHandState() {
  const e = el.handState;
  e.className = "hand-state";
  if (!state.cameraOn) {
    e.textContent = "カメラ OFF（スライダーで操作）";
    e.classList.add("hand-none");
  } else if (state.locked) {
    e.textContent = "固定中（「動かして」で再開）";
    e.classList.add("hand-locked");
  } else if (state.handPresent) {
    const p = state.part?.def.params[state.activeParam];
    e.textContent = `手: 検出 → つまみで「${p?.label ?? ""}」`;
    e.classList.add("hand-active");
  } else {
    e.textContent = "手: 未検出 → 固定";
    e.classList.add("hand-none");
  }
}

/* ------------------------------------------------------------------ */
/* Templates / params UI                                               */
/* ------------------------------------------------------------------ */
function loadTemplate(id, params) {
  if (!PARTS[id]) return;
  state.part = createPart(id, params || {});
  state.activeParam = state.part.def.primary;
  document.querySelectorAll(".unit-chip").forEach((b) => b.classList.toggle("is-active", b.dataset.template === id));
  renderParamChips();
  syncSlider();
  setCaption("");
  updateHandState();
  state.lastSpecKey = "";
  runGeminiVerifySoon(200);
}

function renderParamChips() {
  el.paramChips.innerHTML = "";
  for (const [name, p] of Object.entries(state.part.def.params)) {
    if (p.animated) continue;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (name === state.activeParam ? " is-active" : "");
    b.textContent = p.label;
    b.addEventListener("click", () => setActiveParam(name));
    el.paramChips.appendChild(b);
  }
}

function setActiveParam(name) {
  if (!state.part.def.params[name] || state.part.def.params[name].animated) return;
  state.activeParam = name;
  state.blendStart = performance.now();
  state.blendFromNorm = state.part.getNorm(name);
  renderParamChips();
  syncSlider();
  updateHandState();
}

function syncSlider() {
  if (!state.part) return;
  el.paramSlider.value = String(Math.round(state.part.getNorm(state.activeParam) * 1000));
}

el.paramSlider.addEventListener("input", () => {
  if (!state.part) return;
  state.part.setNorm(state.activeParam, Number(el.paramSlider.value) / 1000);
  state.blendFromNorm = state.part.getNorm(state.activeParam);
  state.blendStart = performance.now();
});

document.querySelectorAll(".unit-chip").forEach((b) => {
  b.addEventListener("click", () => {
    loadTemplate(b.dataset.template);
    log(`単元: ${PARTS[b.dataset.template].title}`, "ui");
  });
});

/* ------------------------------------------------------------------ */
/* Verification                                                        */
/* ------------------------------------------------------------------ */
function scheduleVerify() {
  const spec = state.part.spec();
  const key = JSON.stringify(spec);
  if (key === state.lastSpecKey) return;
  state.lastSpecKey = key;
  clearTimeout(state.verifyTimer);
  state.verifyTimer = setTimeout(() => {
    const res = verifyLocal(spec);
    renderVerify(res, null);
    runGeminiVerifySoon(2500);
  }, 120);
}

let lastGemini = null;

function renderVerify(local, gemini) {
  if (gemini !== undefined) lastGemini = gemini;
  const g = lastGemini;
  const okAll = local.ok && (g == null || g.ok !== false);
  el.verifyBadge.className = "verify-badge " + (local.ok ? (okAll ? "verify-ok" : "verify-bad") : "verify-bad");
  const heads = { circleArea: "面積 = πr²", inscribedAngle: "∠APB 一定", cubeSection: "切り口は正六角形" };
  const head = heads[state.part.def.id] || "式とグラフ一致";
  el.verifyBadge.textContent = local.ok
    ? `✓ ${head} を検証済み${g?.ok === true ? "（Gemini も一致）" : ""}`
    : `⚠ 検証 NG: ${local.checks.find((c) => !c.ok)?.name ?? ""}`;

  el.checkList.innerHTML = "";
  const rows = [...local.checks.map((c) => ({ ...c, src: "local" })), ...((g?.checks || []).map((c) => ({ ...c, src: "gemini" })))];
  for (const c of rows) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="${c.ok ? "check-ok" : "check-bad"}">${c.ok ? "✓" : "✗"}</span><div><div>${escapeHtml(c.name)} <span class="check-detail">[${c.src}]</span></div><div class="check-detail">${escapeHtml(c.detail || "")}</div></div>`;
    el.checkList.appendChild(li);
  }
}

function runGeminiVerifySoon(delay) {
  clearTimeout(state.geminiTimer);
  if (!settings.key) {
    el.geminiVerifyState.textContent = "Gemini Code Execution: 未接続（設定でAPIキーを入れると実行）";
    return;
  }
  state.geminiTimer = setTimeout(runGeminiVerify, delay);
}

async function runGeminiVerify() {
  if (!state.part || !settings.key) return;
  state.geminiAbort?.abort();
  const ac = new AbortController();
  state.geminiAbort = ac;
  el.geminiVerifyState.textContent = "Gemini Code Execution: 検証中…";
  const spec = state.part.spec();
  try {
    const res = await verifyWithGemini(spec, { apiKey: settings.key, model: settings.model, signal: ac.signal });
    if (ac.signal.aborted) return;
    if (res.error) {
      el.geminiVerifyState.textContent = `Gemini Code Execution: エラー（${res.error}）`;
      renderVerify(verifyLocal(spec), null);
      return;
    }
    el.geminiVerifyState.textContent = `Gemini Code Execution: ${res.ok ? "✓ 一致" : "✗ 不一致"}${res.executed ? "（Python 実行済み）" : "（コード実行なし）"}`;
    renderVerify(verifyLocal(spec), res);
  } catch (err) {
    if (ac.signal.aborted) return;
    el.geminiVerifyState.textContent = `Gemini Code Execution: 失敗（${err.message}）`;
  }
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */
const voice = new Voice({
  onInterim: (t) => { el.transcript.textContent = t; },
  onFinal: (t) => { el.transcript.textContent = ""; handleUtterance(t, "voice"); },
  onState: (s) => {
    if (s.startsWith("error")) log(`音声認識: ${s}`, "sys");
  },
});
voice.ttsEnabled = settings.tts;

async function handleUtterance(text, source) {
  const ctxInfo = { template: state.part.def.id, params: state.part.spec().params, activeParam: state.activeParam };
  const local = parseCommand(text, ctxInfo);
  if (local.matched) {
    log(text, source, applyActions(local.actions));
    return;
  }
  if (settings.key && settings.geminiInterpret) {
    log(text, source, "Gemini に問い合わせ中…");
    try {
      const g = await interpretWithGemini(text, ctxInfo, { apiKey: settings.key, model: settings.model });
      if (g?.matched) {
        log(text, "gemini", applyActions(g.actions) + (g.reply ? ` / ${g.reply}` : ""));
        return;
      }
      log(text, "gemini", g?.reply || "該当する部品がありません");
    } catch (err) {
      log(text, "gemini", `失敗: ${err.message}`);
    }
    return;
  }
  log(text, source, "解釈できませんでした（例: 倍にして / 並べて / 一次関数を出して）");
}

function applyActions(actions) {
  const done = [];
  for (const a of actions) {
    switch (a.type) {
      case "loadTemplate":
        loadTemplate(a.template, a.params);
        done.push(`→ ${PARTS[a.template].title}`);
        break;
      case "setActiveParam":
        if (state.part.def.params[a.param] && !state.part.def.params[a.param].animated) {
          setActiveParam(a.param);
          done.push(`操作対象: ${state.part.def.params[a.param].label}`);
        }
        break;
      case "scaleParam": {
        const name = a.param || state.activeParam;
        const p = state.part.def.params[name];
        if (p && !p.animated) {
          state.part.set(name, state.part.get(name) * a.factor);
          done.push(`${p.label} ×${a.factor} → ${fmtVal(state.part.get(name))}`);
        }
        break;
      }
      case "nudgeParam": {
        const name = a.param || state.activeParam;
        const p = state.part.def.params[name];
        if (p && !p.animated) {
          const step = p.integer ? (p.step || 1) : (p.max - p.min) / 10;
          state.part.set(name, state.part.get(name) + step * a.steps);
          done.push(`${p.label} → ${fmtVal(state.part.get(name))}`);
        }
        break;
      }
      case "setParamValue": {
        const name = a.param || state.activeParam;
        const p = state.part.def.params[name];
        if (p) {
          state.part.set(name, a.value);
          done.push(`${p.label} = ${fmtVal(state.part.get(name))}`);
        }
        break;
      }
      case "animate": {
        const p = state.part.def.params[a.param];
        if (p) {
          state.part.set(a.param, a.value);
          done.push(a.value >= 0.5 ? "並べ替え" : "円に戻す");
        }
        break;
      }
      case "lock":
        state.locked = true;
        done.push("固定");
        break;
      case "unlock":
        state.locked = false;
        state.blendStart = performance.now();
        state.blendFromNorm = state.part.getNorm(state.activeParam);
        done.push("再開");
        break;
      case "cycleTheme":
        state.themeIdx = (state.themeIdx + 1) % THEMES.length;
        done.push(`配色: ${THEMES[state.themeIdx].name}`);
        break;
      case "narrate": {
        const text = state.part.narration();
        setCaption(text);
        voice.speak(text);
        done.push("説明");
        if (state.part.def.id === "circleArea") {
          // replay: gather into the circle, then spread into the rectangle
          state.part.set("t", 0);
          setTimeout(() => state.part.set("t", 1), 2600);
        }
        break;
      }
      case "reset":
        loadTemplate(state.part.def.id);
        done.push("リセット");
        break;
      default:
        break;
    }
  }
  state.blendFromNorm = state.part.getNorm(state.activeParam);
  state.blendStart = performance.now();
  syncSlider();
  updateHandState();
  return done.join("、") || "変更なし";
}

const fmtVal = (v) => (Number.isInteger(v) ? String(v) : Number(v).toFixed(2).replace(/\.?0+$/, ""));

function setCaption(text) {
  el.caption.textContent = text || "";
}

function log(text, source, result) {
  const li = document.createElement("li");
  const tag = { voice: "🎤", text: "⌨", ui: "🖱", gemini: "✦", sys: "·" }[source] || "·";
  li.innerHTML = `${tag} <b>${escapeHtml(text)}</b>${result ? ` — ${escapeHtml(result)}` : ""}`;
  el.cmdLog.prepend(li);
  while (el.cmdLog.children.length > 8) el.cmdLog.lastChild.remove();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

el.cmdForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const t = el.cmdInput.value.trim();
  if (!t) return;
  el.cmdInput.value = "";
  handleUtterance(t, "text");
});

el.micBtn.addEventListener("click", () => {
  const on = el.micBtn.getAttribute("aria-pressed") === "true";
  if (on) {
    voice.stop();
    el.micBtn.setAttribute("aria-pressed", "false");
    el.micBtn.innerHTML = '<span class="mic-dot"></span>音声 OFF';
  } else {
    if (!voice.supported) {
      log("このブラウザは音声認識に対応していません（Chrome 推奨）。テキスト入力を使ってください。", "sys");
      return;
    }
    voice.start();
    el.micBtn.setAttribute("aria-pressed", "true");
    el.micBtn.innerHTML = '<span class="mic-dot"></span>音声 ON';
  }
});

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */
const hand = new HandInput({ video: el.webcam, overlay: el.overlay, onFrame: onHandFrame });
let handReady = false;

el.camBtn.addEventListener("click", async () => {
  if (state.cameraOn) {
    hand.stop();
    state.cameraOn = false;
    el.camBtn.textContent = "カメラ ON";
    updateHandState();
    return;
  }
  el.camError.hidden = true;
  el.camBtn.disabled = true;
  try {
    if (!handReady) {
      el.camBtn.textContent = "モデル読込中…";
      await hand.init();
      handReady = true;
    }
    await hand.start();
    state.cameraOn = true;
    el.camBtn.textContent = "カメラ OFF";
  } catch (err) {
    console.error(err);
    el.camError.hidden = false;
    el.camError.textContent = err.message || String(err);
    el.camBtn.textContent = "カメラ ON";
  } finally {
    el.camBtn.disabled = false;
    updateHandState();
  }
});

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */
el.settingsBtn.addEventListener("click", () => {
  el.geminiKey.value = settings.key;
  el.geminiModel.value = settings.model;
  el.ttsToggle.checked = settings.tts;
  el.geminiInterpretToggle.checked = settings.geminiInterpret;
  el.settingsPanel.hidden = false;
});
el.settingsClose.addEventListener("click", () => { el.settingsPanel.hidden = true; });
el.settingsSave.addEventListener("click", () => {
  settings.key = el.geminiKey.value.trim();
  settings.model = el.geminiModel.value.trim() || "gemini-2.5-flash";
  settings.tts = el.ttsToggle.checked;
  settings.geminiInterpret = el.geminiInterpretToggle.checked;
  voice.ttsEnabled = settings.tts;
  el.settingsPanel.hidden = true;
  log("設定を保存しました", "sys");
  runGeminiVerifySoon(100);
});

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */
window.addEventListener("resize", () => { resizeStage(); hand.syncOverlay(); });
resizeStage();
loadTemplate("circleArea");
log("「円の面積の公式を説明して」「並べて」「倍にして」「色を変えて」「一次関数を出して」", "sys");
requestAnimationFrame(frame);
