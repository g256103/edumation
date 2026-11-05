/**
 * Gesture Street — hand-gesture controlled 360° panorama explorer
 * MediaPipe Hand Landmarker + Pannellum
 */

import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm";

/* -------------------------------------------------------------------------- */
/* Tunable config — recognition and viewpoint are independent                 */
/* -------------------------------------------------------------------------- */
const CONFIG = {
  recognition: {
    /** Index tip–MCP length (hand-scale units) → extended (look) */
    indexExtendThreshold: 1.15,
    /** Index tip–MCP → curled (pointing: other fingers / non-look) */
    indexCurlThreshold: 0.95,
    /** Other finger tip–MCP → curled when pointing */
    otherCurlThreshold: 1.0,
    /** Min open fingers (index/middle/ring/pinky) for palm-advance */
    palmOpenFingerMin: 3,
    /** Default min curl-ratio to count a finger as open (overridden by palm demo) */
    palmOpenMinRatio: 0.95,
    /** Thumb tip–index MCP (hand-scale) must exceed this for open palm */
    thumbOpenMin: 0.4,
    /** Other fingers curled for look (index-point) */
    lookOthersClosedMin: 2,
    /** Confirm frames: look / idle */
    confirmFrames: 4,
    /** Extra confirm frames required to enter move (anti false-advance) */
    moveConfirmFrames: 11,
    /** Cooldown after mode switch (ms) */
    modeCooldownMs: 550,
    /** Brief loss: freeze view but keep mode this many frames */
    lostGraceFrames: 10,
    landmarkAlphaCalib: 0.22,
    landmarkAlpha: 0.5,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.55,
  },
  /**
   * Perf: split MediaPipe / overlay / Pannellum / DOM update rates.
   * Biggest wins: lower cam res, fewer detectForVideo, cheap overlay.
   */
  perf: {
    /** getUserMedia ideal size (MediaPipe cost scales with pixels) */
    camWidth: 480,
    camHeight: 360,
    camFps: 20,
    /** detectForVideo interval */
    detectIntervalMs: 55,
    /** during tutorials, detect even less often */
    detectIntervalTutorialMs: 85,
    /** skeleton overlay redraw interval */
    overlayIntervalMs: 120,
    /** debug / handMeta DOM refresh */
    debugIntervalMs: 300,
    /** skip setYaw/setPitch if change smaller than this (deg) */
    poseEpsilon: 0.08,
    /** draw simplified skeleton (faster canvas path) */
    lightOverlay: true,
    /** hide debug panel to cut DOM work (set true while tuning) */
    showDebug: false,
  },
  calibration: {
    requiredFrames: 55,
    reacquireFrames: 22,
    missDecay: 5,
    lostBeforeRecalib: 22,
    minScore: 0.35,
    edgeMargin: 0.02,
    maxTipJitter: 0.08,
    minHandSpan: 0.04,
  },
  viewpoint: {
    /** One-Euro: responsive but cheaper than oversampling */
    oneEuroMinCutoff: 1.8,
    oneEuroBeta: 0.85,
    oneEuroDCutoff: 1.0,
    yawSensitivity: 125,
    pitchSensitivity: 82,
    maxYawSpeed: 7.0,
    maxPitchSpeed: 4.6,
    /** Extra gain when aiming left (negative yaw after mirror) */
    leftYawBoost: 1.22,
    /** Deadzone on aim delta from neutral (front point = stop) */
    deadZone: 0.08,
    /** Response curve exponent (>1 = fine near center, faster at edges) */
    responsePower: 1.2,
    poseLerp: 0.55,
    directApply: 0.75,
    /** Post-detect: hold front-point this long to lock neutral (ms) */
    aimAlignMs: 10000,
    /** Soft front-point: aim magnitude under this counts as facing camera */
    aimAlignMaxMag: 0.95,
  },
  movement: {
    moveCooldownMs: 1700,
    confirmFrames: 10,
    /** Palm-open tutorial hold time (ms) */
    palmDemoMs: 6000,
  },
  tutorial: {
    /** Order after detect: open palm → front aim */
    steps: ["palm", "front"],
  },
};

const LANDMARK = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_TIP: 20,
};

const FINGER_PAIRS = [
  [LANDMARK.INDEX_TIP, LANDMARK.INDEX_MCP],
  [LANDMARK.MIDDLE_TIP, LANDMARK.MIDDLE_MCP],
  [LANDMARK.RING_TIP, LANDMARK.RING_MCP],
  [LANDMARK.PINKY_TIP, LANDMARK.PINKY_MCP],
];

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

/** Lighter skeleton for overlay (fewer strokes) */
const HAND_CONNECTIONS_LIGHT = [
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 12],
  [0, 13], [13, 16],
  [0, 17], [17, 20],
  [5, 9], [9, 13], [13, 17],
];

const TIP_INDICES = [4, 8, 12, 16, 20];

/* Scene graph: palm-advance → neighboring scene */
const SCENE_GRAPH = {
  sceneA: {
    title: "Scene A · Start",
    panorama: "assets/panorama/scene-a.jpg",
    links: { forward: "sceneB", back: null, left: null, right: null },
  },
  sceneB: {
    title: "Scene B · Midway",
    panorama: "assets/panorama/scene-b.jpg",
    links: { forward: "sceneC", back: "sceneA", left: null, right: null },
  },
  sceneC: {
    title: "Scene C · Far",
    panorama: "assets/panorama/scene-c.jpg",
    links: { forward: null, back: "sceneB", left: null, right: null },
  },
};

/* -------------------------------------------------------------------------- */
/* DOM                                                                        */
/* -------------------------------------------------------------------------- */
const el = {
  panorama: document.getElementById("panorama"),
  webcam: document.getElementById("webcam"),
  overlay: document.getElementById("overlay"),
  cameraToggle: document.getElementById("cameraToggle"),
  cameraError: document.getElementById("cameraError"),
  modeBadge: document.getElementById("modeBadge"),
  modeLabel: document.getElementById("modeLabel"),
  statusText: document.getElementById("statusText"),
  handMeta: document.getElementById("handMeta"),
  sceneToast: document.getElementById("sceneToast"),
  calibPanel: document.getElementById("calibPanel"),
  calibTitle: document.getElementById("calibTitle"),
  calibFill: document.getElementById("calibFill"),
  calibHint: document.getElementById("calibHint"),
  calibPercent: document.getElementById("calibPercent"),
  calibNow: document.getElementById("calibNow"),
  diagramPoint: document.getElementById("diagramPoint"),
  diagramPalm: document.getElementById("diagramPalm"),
  dirForward: document.getElementById("dirForward"),
  dirBack: document.getElementById("dirBack"),
  dirLeft: document.getElementById("dirLeft"),
  dirRight: document.getElementById("dirRight"),
  aimPip: document.getElementById("aimPip"),
  debugPanel: document.getElementById("debugPanel"),
};

const overlayCtx = el.overlay.getContext("2d");

/* -------------------------------------------------------------------------- */
/* State                                                                      */
/* -------------------------------------------------------------------------- */
const state = {
  viewer: null,
  handLandmarker: null,
  cameraOn: false,
  stream: null,
  lastDetectTime: 0,
  lastOverlayTime: 0,
  lastDebugTime: 0,
  lastAppliedYaw: null,
  lastAppliedPitch: null,
  perf: {
    fps: 0,
    detectMs: 0,
    frames: 0,
    fpsWindowStart: 0,
  },
  mode: "idle", // idle | look | move
  candidateMode: "idle",
  candidateCount: 0,
  lastModeChangeAt: 0,
  smoothedLandmarks: null,
  targetYaw: 0,
  targetPitch: 0,
  currentYaw: 0,
  currentPitch: 0,
  lastMoveAt: 0,
  moveCandidateCount: 0,
  lookDir: { x: 0, y: 0 },
  aimFilterX: null,
  aimFilterY: null,
  indexGuide: null,
  lastHandAnalysis: null,
  moveDir: null,
  handedness: null,
  animating: false,
  viewFrozen: true,
  handReady: false,
  lookArmed: false,
  aimNeutral: null,
  aimAlign: createAimAlignState(false),
  palmDemo: createPalmDemoState(false),
  /** Personal thresholds learned in palm demo (null = CONFIG defaults) */
  gestureProfile: null,
  calib: createCalibState(false, false),
};

function createAimAlignState(active) {
  return {
    active: !!active,
    heldMs: 0,
    lastTickAt: null,
    sumX: 0,
    sumY: 0,
    samples: 0,
  };
}

function createPalmDemoState(active) {
  return {
    active: !!active,
    heldMs: 0,
    lastTickAt: null,
    samples: 0,
    sumIndex: 0,
    sumMiddle: 0,
    sumRing: 0,
    sumPinky: 0,
    sumThumb: 0,
  };
}

function getGestureThresholds() {
  const cfg = CONFIG.recognition;
  const p = state.gestureProfile;
  return {
    indexExtendThreshold: p?.indexExtendThreshold ?? cfg.indexExtendThreshold,
    indexCurlThreshold: p?.indexCurlThreshold ?? cfg.indexCurlThreshold,
    otherCurlThreshold: p?.otherCurlThreshold ?? cfg.otherCurlThreshold,
    palmOpenMinRatio: p?.palmOpenMinRatio ?? cfg.palmOpenMinRatio,
    thumbOpenMin: p?.thumbOpenMin ?? cfg.thumbOpenMin,
    palmOpenFingerMin: p?.palmOpenFingerMin ?? cfg.palmOpenFingerMin,
    lookOthersClosedMin: p?.lookOthersClosedMin ?? cfg.lookOthersClosedMin,
  };
}

/* -------------------------------------------------------------------------- */
/* One-Euro filter (low lag + strong noise rejection)                         */
/* -------------------------------------------------------------------------- */
function smoothingFactor(te, cutoff) {
  const r = 2 * Math.PI * cutoff * te;
  return r / (r + 1);
}

function exponentialSmoothing(a, value, prev) {
  return a * value + (1 - a) * prev;
}

class OneEuroFilter {
  constructor(minCutoff, beta, dCutoff) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  filter(x, tMs) {
    if (this.tPrev == null || this.xPrev == null) {
      this.tPrev = tMs;
      this.xPrev = x;
      this.dxPrev = 0;
      return x;
    }
    const te = Math.max(0.001, (tMs - this.tPrev) / 1000);
    const dx = (x - this.xPrev) / te;
    const aD = smoothingFactor(te, this.dCutoff);
    const dxHat = exponentialSmoothing(aD, dx, this.dxPrev);
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const aX = smoothingFactor(te, cutoff);
    const xHat = exponentialSmoothing(aX, x, this.xPrev);
    this.tPrev = tMs;
    this.xPrev = xHat;
    this.dxPrev = dxHat;
    return xHat;
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }
}

function createCalibState(isReacquire, active = true) {
  return {
    active,
    isReacquire: !!isReacquire,
    progress: 0,
    missStreak: 0,
    lostStreak: 0,
    lastRawTip: null,
    targetFrames: isReacquire
      ? CONFIG.calibration.reacquireFrames
      : CONFIG.calibration.requiredFrames,
  };
}

function beginCalibration(isReacquire = false) {
  state.handReady = false;
  state.lookArmed = false;
  state.aimNeutral = null;
  state.gestureProfile = null;
  state.aimAlign = createAimAlignState(false);
  state.palmDemo = createPalmDemoState(false);
  state.calib = createCalibState(isReacquire);
  state.smoothedLandmarks = null;
  resetLookState();
  freezeViewpoint();
  if (state.mode !== "idle") setMode("idle", true);
  showCalibUI(true);
  updateCalibUI(0);
  if (el.calibTitle) el.calibTitle.textContent = "手の検出を調整中";
  setTutorialVisual(
    "palm",
    "今やること：手のひらをカメラに向けて静止"
  );
  el.modeLabel.textContent = "検出調整中";
  el.modeBadge.className = "mode-badge mode-calib";
  el.modeBadge.dataset.mode = "calib";
  setStatus(
    isReacquire
      ? "手を再検出中… あとで「手のひら→進む」「指す→視点」を使います"
      : "初期検出中… 覚える操作：手のひら→進む / 人差し指の向き→視点"
  );
  el.calibHint.textContent = isReacquire
    ? "手が外れました。もう一度フレーム内で手を安定させてください"
    : "開いた手のひらをカメラに向け、少しの間まっすぐ構えてください";
}

function showCalibUI(visible) {
  el.calibPanel.hidden = !visible;
}

function updateCalibUI(progress01) {
  const pct = Math.round(clamp(progress01, 0, 1) * 100);
  el.calibFill.style.width = `${pct}%`;
  el.calibPercent.textContent = `${pct}%`;
}

/** Switch tutorial diagram + "今やること" text. kind: palm | point */
function setTutorialVisual(kind, nowText) {
  if (el.diagramPalm) el.diagramPalm.hidden = kind !== "palm";
  if (el.diagramPoint) el.diagramPoint.hidden = kind !== "point";
  if (el.calibNow && nowText) el.calibNow.textContent = nowText;
}

function finishCalibration() {
  state.handReady = true;
  state.calib.active = false;
  state.calib.progress = state.calib.targetFrames;
  state.calib.lostStreak = 0;
  state.calib.lastRawTip = null;
  resetLookState();
  freezeViewpoint();
  showToast("手の検出完了");
  // Tutorial: ① open palm → ② front point
  beginPalmDemo();
}

/* -------------------- Tutorial ① open palm (advance) -------------------- */
function beginPalmDemo() {
  state.lookArmed = false;
  state.palmDemo = createPalmDemoState(true);
  state.aimAlign = createAimAlignState(false);
  resetLookState();
  freezeViewpoint();
  state.currentPitch = 0;
  state.targetPitch = 0;
  applyViewerPose(state.currentYaw, 0, true);

  syncOverlaySize();
  showCalibUI(true);
  updateCalibUI(0);
  if (el.calibTitle) el.calibTitle.textContent = "デモ① 手のひらを見せる";
  setTutorialVisual(
    "palm",
    "今やること：開いた手のひらをカメラに向ける（約6秒）"
  );
  el.calibHint.textContent =
    "図のように指を全部開いてください。覚えておく操作：手のひら→進む";
  el.modeLabel.textContent = "手のひら練習";
  el.modeBadge.className = "mode-badge mode-move";
  el.modeBadge.dataset.mode = "palmDemo";
  setStatus("デモ① 手のひら＝あとで「進む」。今は掌をカメラに向けて静止してください。");
}

function sampleFingerCurls(landmarks) {
  return {
    index: fingerCurlRatio(landmarks, LANDMARK.INDEX_TIP, LANDMARK.INDEX_MCP),
    middle: fingerCurlRatio(landmarks, LANDMARK.MIDDLE_TIP, LANDMARK.MIDDLE_MCP),
    ring: fingerCurlRatio(landmarks, LANDMARK.RING_TIP, LANDMARK.RING_MCP),
    pinky: fingerCurlRatio(landmarks, LANDMARK.PINKY_TIP, LANDMARK.PINKY_MCP),
  };
}

function thumbOpenRatio(landmarks) {
  return (
    dist(landmarks[LANDMARK.THUMB_TIP], landmarks[LANDMARK.INDEX_MCP]) /
    handScale(landmarks)
  );
}

/**
 * Soft open-palm check for tutorial.
 * Do NOT require strict tip-closer-z: an open palm facing the cam is often
 * nearly coplanar (tips ≈ MCP depth), which made progress stick at 0%.
 */
function evaluateTutorialPalm(landmarks) {
  const c = sampleFingerCurls(landmarks);
  const thumb = thumbOpenRatio(landmarks);
  const avg = (c.index + c.middle + c.ring + c.pinky) / 4;
  const openMin = 0.82;
  const openCount =
    (c.index >= openMin ? 1 : 0) +
    (c.middle >= openMin ? 1 : 0) +
    (c.ring >= openMin ? 1 : 0) +
    (c.pinky >= openMin ? 1 : 0);
  const spread =
    dist(landmarks[LANDMARK.INDEX_TIP], landmarks[LANDMARK.PINKY_TIP]) /
    handScale(landmarks);

  // Clear index-point only (others curled) → not palm
  if (
    c.index > 1.2 &&
    c.middle < 0.9 &&
    c.ring < 0.9 &&
    c.pinky < 0.9
  ) {
    return {
      ok: false,
      reason: "指差しではなく、全部の指を開いてください",
      curls: c,
      thumb,
    };
  }

  // Soft accept: mostly open fingers OR wide finger spread
  const openEnough = openCount >= 2 && avg >= 0.88;
  const spreadEnough = spread >= 0.7 && avg >= 0.8;
  if (!openEnough && !spreadEnough) {
    return {
      ok: false,
      reason: "指を開いて手のひらをカメラに向けてください",
      curls: c,
      thumb,
    };
  }

  // Thumb soft — don't block if fingers are clearly open
  if (thumb < 0.28 && avg < 1.05) {
    return {
      ok: false,
      reason: "親指も少し開いてください",
      curls: c,
      thumb,
    };
  }

  return { ok: true, reason: "良好", curls: c, thumb };
}

function handlePalmDemoFrame(landmarks, analysis, now) {
  state.viewFrozen = true;
  state.targetYaw = state.currentYaw;
  state.targetPitch = 0;
  state.currentPitch = 0;
  // Avoid per-frame setYaw — beginPalmDemo already locked pose
  state.moveCandidateCount = 0;
  if (el.aimPip) el.aimPip.hidden = true;

  const d = state.palmDemo;
  const evalResult = evaluateTutorialPalm(landmarks);

  if (evalResult.ok) {
    const step =
      d.lastTickAt != null
        ? clamp(now - d.lastTickAt, 16, 120)
        : CONFIG.perf.detectIntervalTutorialMs || 85;
    d.heldMs += step;
    d.lastTickAt = now;
    const curls = evalResult.curls || sampleFingerCurls(landmarks);
    d.sumIndex += curls.index;
    d.sumMiddle += curls.middle;
    d.sumRing += curls.ring;
    d.sumPinky += curls.pinky;
    d.sumThumb += evalResult.thumb ?? thumbOpenRatio(landmarks);
    d.samples += 1;
  } else {
    d.lastTickAt = null;
    // Soft decay — brief flicker must not wipe progress
    d.heldMs = Math.max(0, d.heldMs - 22);
  }

  const ratio = d.heldMs / CONFIG.movement.palmDemoMs;
  updateCalibUI(ratio);

  if (now - state.lastDebugTime >= 200) {
    state.lastDebugTime = now;
    if (evalResult.ok) {
      const left = Math.max(0, (CONFIG.movement.palmDemoMs - d.heldMs) / 1000);
      if (el.calibNow) {
        el.calibNow.textContent = `今やること：その手のひらのまま静止（あと約 ${left.toFixed(1)} 秒）`;
      }
      el.calibHint.textContent =
        "OK！ 覚えておく操作：手のひら→進む / 人差し指の向き→視点";
    } else {
      if (el.calibNow) {
        el.calibNow.textContent = "今やること：開いた手のひらをカメラに向ける";
      }
      el.calibHint.textContent = evalResult.reason;
    }
    el.handMeta.textContent = `手のひら練習 ${Math.round(clamp(ratio, 0, 1) * 100)}%`;
  }

  if (d.heldMs >= CONFIG.movement.palmDemoMs) {
    finishPalmDemo();
  }
}

function finishPalmDemo() {
  const d = state.palmDemo;
  const n = Math.max(1, d.samples);
  const avgIndex = d.sumIndex / n;
  const avgMiddle = d.sumMiddle / n;
  const avgRing = d.sumRing / n;
  const avgPinky = d.sumPinky / n;
  const avgOpen = (avgIndex + avgMiddle + avgRing + avgPinky) / 4;
  const avgThumb = d.sumThumb / n;

  // Must stay reasonably open vs personal average (closing fails palm)
  const palmOpenMinRatio = clamp(avgOpen * 0.72, 0.82, 1.35);
  const thumbOpenMin = clamp(avgThumb * 0.65, 0.28, 0.75);
  // Pointing: others clearly below open average
  const otherCurlThreshold = clamp(avgOpen * 0.72, 0.75, 1.15);
  const indexCurlThreshold = clamp(avgOpen * 0.7, 0.7, 1.1);
  const indexExtendThreshold = Math.max(
    CONFIG.recognition.indexExtendThreshold,
    Math.min(1.4, palmOpenMinRatio * 0.92)
  );

  state.gestureProfile = {
    palmOpenMinRatio,
    thumbOpenMin,
    palmOpenFingerMin: 3,
    lookOthersClosedMin: 2,
    otherCurlThreshold,
    indexCurlThreshold,
    indexExtendThreshold,
    avgPalmOpen: avgOpen,
    avgThumb,
  };

  state.palmDemo = createPalmDemoState(false);
  showToast("手のひら基準を設定しました");
  setStatus(
    `手のひらOK（open≥${palmOpenMinRatio.toFixed(2)}）。次は正面を指します。`
  );
  beginAimAlign();
}

/* -------------------- Tutorial ② front point -------------------- */
function beginAimAlign() {
  state.lookArmed = false;
  state.aimNeutral = null;
  state.palmDemo = createPalmDemoState(false);
  state.aimAlign = createAimAlignState(true);
  resetLookState();
  freezeViewpoint();
  state.currentPitch = 0;
  state.targetPitch = 0;
  applyViewerPose(state.currentYaw, 0, true);

  syncOverlaySize();
  showCalibUI(true);
  updateCalibUI(0);
  if (el.calibTitle) el.calibTitle.textContent = "デモ② 正面を指す";
  setTutorialVisual(
    "point",
    "今やること：人差し指でカメラ真正面を指す（約10秒）"
  );
  el.calibHint.textContent =
    "図のように真正面を指してください。覚えておく操作：人差し指の向き→視点移動";
  el.modeLabel.textContent = "正面合わせ";
  el.modeBadge.className = "mode-badge mode-calib";
  el.modeBadge.dataset.mode = "aimAlign";
  setStatus("デモ② 指す＝あとで「視点移動」。今は真正面を指して静止してください。");
}

function finishAimAlign() {
  const a = state.aimAlign;
  const n = Math.max(1, a.samples);
  state.aimNeutral = { x: a.sumX / n, y: a.sumY / n };
  state.aimAlign = createAimAlignState(false);
  state.lookArmed = true;
  resetLookState();
  freezeViewpoint();
  state.currentPitch = 0;
  state.targetPitch = 0;
  applyViewerPose(state.currentYaw, 0, true);

  showCalibUI(false);
  el.modeLabel.textContent = "視点固定";
  el.modeBadge.className = "mode-badge mode-idle";
  el.modeBadge.dataset.mode = "idle";
  setStatus("準備完了！ 手のひら→進む / 人差し指の向き→視点移動");
  showToast("準備完了");
}

/**
 * Front-point tutorial evaluator.
 * Pointing AT the camera foreshortens the finger (small tip–MCP in 2D),
 * so we must NOT require a large indexRatio / analyzeHand.indexExtended.
 * Prefer z-depth + “index leads others” over 2D stretch.
 */
function evaluateTutorialPoint(landmarks) {
  const c = sampleFingerCurls(landmarks);
  const tip = landmarks[LANDMARK.INDEX_TIP];
  const mcp = landmarks[LANDMARK.INDEX_MCP];
  const pip = landmarks[LANDMARK.INDEX_PIP];
  const wrist = landmarks[LANDMARK.WRIST];
  const tipCloserZ = (tip.z ?? 0) < (mcp.z ?? 0) - 0.004;
  const tipBeyondPip = dist(tip, wrist) > dist(pip, wrist) * 1.01;
  const avgOther = (c.middle + c.ring + c.pinky) / 3;

  // Only reject an obvious closed fist (all short, no depth cue of pointing)
  const clearFist =
    !tipCloserZ &&
    c.index < 1.0 &&
    avgOther < 1.05 &&
    Math.abs(c.index - avgOther) < 0.18;
  if (clearFist) {
    return { ok: false, reason: "握らず、人差し指だけ伸ばしてカメラを指してください" };
  }

  // Soft lead: index not clearly shorter than middle (foreshortening-tolerant)
  if (c.index + 0.15 < c.middle) {
    return { ok: false, reason: "人差し指をいちばん伸ばしてください" };
  }

  const rawAim = computeIndexAim(landmarks);
  const mag = Math.hypot(rawAim.x, rawAim.y);

  // Accept: tip toward camera OR aim near center OR tip ahead of PIP with moderate mag
  const facing =
    tipCloserZ ||
    mag <= CONFIG.viewpoint.aimAlignMaxMag ||
    (tipBeyondPip && mag <= CONFIG.viewpoint.aimAlignMaxMag * 1.35);

  if (!facing) {
    return {
      ok: false,
      reason: "カメラの真正面を指してください（左右・上下をやめて正面へ）",
      aim: rawAim,
      mag,
    };
  }

  return { ok: true, reason: "良好", aim: rawAim, mag };
}

/**
 * During aim-align: count time while index points roughly at camera.
 */
function handleAimAlignFrame(landmarks, analysis, now) {
  state.viewFrozen = true;
  state.targetYaw = state.currentYaw;
  state.targetPitch = 0;
  state.currentPitch = 0;
  // Do NOT force setYaw every tick — huge lag source
  state.moveCandidateCount = 0;
  if (el.aimPip) el.aimPip.hidden = true;

  const evalResult = evaluateTutorialPoint(landmarks);
  const a = state.aimAlign;

  if (evalResult.ok) {
    const step =
      a.lastTickAt != null
        ? clamp(now - a.lastTickAt, 16, 140)
        : CONFIG.perf.detectIntervalTutorialMs || 85;
    a.heldMs += step;
    a.lastTickAt = now;
    const aim = evalResult.aim || computeIndexAim(landmarks);
    a.sumX += aim.x;
    a.sumY += aim.y;
    a.samples += 1;
  } else {
    a.lastTickAt = null;
    // Soft decay so brief recognition flicker doesn't wipe progress
    a.heldMs = Math.max(0, a.heldMs - 35);
  }

  const ratio = a.heldMs / CONFIG.viewpoint.aimAlignMs;
  updateCalibUI(ratio);

  // Throttle tutorial DOM text (progress bar above is cheap)
  if (now - state.lastDebugTime >= 200) {
    state.lastDebugTime = now;
    if (evalResult.ok) {
      const left = Math.max(0, (CONFIG.viewpoint.aimAlignMs - a.heldMs) / 1000);
      if (el.calibNow) {
        el.calibNow.textContent = `今やること：真正面を指したまま静止（あと約 ${left.toFixed(1)} 秒）`;
      }
      el.calibHint.textContent = "OK！ 人差し指の向き→視点 / 手のひら→進む";
    } else {
      if (el.calibNow) {
        el.calibNow.textContent = "今やること：人差し指でカメラ真正面を指す";
      }
      el.calibHint.textContent = evalResult.reason;
    }
    el.handMeta.textContent = `正面合わせ ${Math.round(clamp(ratio, 0, 1) * 100)}%`;
  }

  if (a.heldMs >= CONFIG.viewpoint.aimAlignMs) {
    finishAimAlign();
  }
}

function resetLookState() {
  state.lookDir = { x: 0, y: 0 };
  state.indexGuide = null;
  state._lastLookAt = null;
  if (state.aimFilterX) state.aimFilterX.reset();
  if (state.aimFilterY) state.aimFilterY.reset();
  state.aimFilterX = null;
  state.aimFilterY = null;
  if (el.aimPip) el.aimPip.hidden = true;
}

function ensureAimFilters() {
  const { oneEuroMinCutoff, oneEuroBeta, oneEuroDCutoff } = CONFIG.viewpoint;
  if (!state.aimFilterX) {
    state.aimFilterX = new OneEuroFilter(oneEuroMinCutoff, oneEuroBeta, oneEuroDCutoff);
    state.aimFilterY = new OneEuroFilter(oneEuroMinCutoff, oneEuroBeta, oneEuroDCutoff);
  }
}

function updateDebugPanel(extra = {}) {
  if (!el.debugPanel) return;
  const a = state.lastHandAnalysis;
  const lines = [
    `fps: ${state.perf.fps}  detect: ${state.perf.detectMs.toFixed(1)}ms`,
    `mode: ${state.mode}  ready: ${state.handReady}  armed: ${state.lookArmed}`,
    `frozen: ${state.viewFrozen}  palmDemo: ${state.palmDemo.active}  aimAlign: ${state.aimAlign.active}`,
    `profile palm/thumb: ${
      state.gestureProfile
        ? (state.gestureProfile.palmOpenMinRatio?.toFixed(2) ?? "?") +
          "/" +
          (state.gestureProfile.thumbOpenMin?.toFixed(2) ?? "?")
        : "default"
    }`,
    `shape: ${extra.shape ?? "—"}  score: ${extra.score != null ? Math.round(extra.score * 100) + "%" : "—"}`,
    `idxExt: ${a ? a.indexExtended : "—"}  palm: ${a ? a.isPalmOpen : "—"}  cam: ${a ? a.tipTowardCamera : "—"}`,
    `aim: ${state.lookDir.x.toFixed(2)}, ${state.lookDir.y.toFixed(2)}  yaw/pitch: ${state.currentYaw.toFixed(1)}/${state.currentPitch.toFixed(1)}`,
  ];
  el.debugPanel.textContent = lines.join("\n");
}

function maybeUpdateDebug(extra, now) {
  if (now - state.lastDebugTime < CONFIG.perf.debugIntervalMs) return;
  state.lastDebugTime = now;
  if (CONFIG.perf.showDebug) updateDebugPanel(extra);
  else if (el.debugPanel) el.debugPanel.hidden = true;
  if (extra.handMeta != null) el.handMeta.textContent = extra.handMeta;
}

/** Pannellum defaults animated=1000ms — must pass false or continuous look freezes. */
function applyViewerPose(yaw, pitch, force = false) {
  if (!state.viewer) return;
  const eps = CONFIG.perf.poseEpsilon;
  if (
    !force &&
    state.lastAppliedYaw != null &&
    Math.abs(yaw - state.lastAppliedYaw) < eps &&
    Math.abs(pitch - state.lastAppliedPitch) < eps
  ) {
    return;
  }
  try {
    state.viewer.setYaw(yaw, false);
    state.viewer.setPitch(pitch, false);
    state.lastAppliedYaw = yaw;
    state.lastAppliedPitch = pitch;
  } catch {
    /* ignore */
  }
}

/** Lock panorama to the pose currently on screen (never snap to ahead target). */
function freezeViewpoint() {
  state.viewFrozen = true;
  // Discard any unapplied target lead so freeze cannot jump forward
  state.targetYaw = state.currentYaw;
  state.targetPitch = state.currentPitch;
  applyViewerPose(state.currentYaw, state.currentPitch, true);
  resetLookState();
  clearDirectionIndicators();
}

function syncPoseFromViewer() {
  if (!state.viewer) return;
  try {
    const yaw = state.viewer.getYaw();
    const pitch = state.viewer.getPitch();
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return;
    state.currentYaw = yaw;
    state.currentPitch = pitch;
    state.targetYaw = yaw;
    state.targetPitch = pitch;
  } catch {
    /* ignore */
  }
}

/* -------------------------------------------------------------------------- */
/* STEP 1 — Pannellum                                                         */
/* -------------------------------------------------------------------------- */
function buildPannellumScenes() {
  const scenes = {};
  for (const [id, scene] of Object.entries(SCENE_GRAPH)) {
    scenes[id] = {
      type: "equirectangular",
      panorama: scene.panorama,
      hfov: 100,
      pitch: 0,
      yaw: 0,
      autoLoad: true,
    };
  }
  return scenes;
}

function initViewer() {
  state.viewer = pannellum.viewer("panorama", {
    default: {
      firstScene: "sceneA",
      sceneFadeDuration: 900,
      autoLoad: true,
      showControls: false,
      mouseZoom: false,
      draggable: false,
      keyboardZoom: false,
      disableKeyboardCtrl: true,
      compass: false,
    },
    scenes: buildPannellumScenes(),
  });

  state.viewer.on("load", () => {
    syncPoseFromViewer();
    state.viewFrozen = true;
  });

  showToast(SCENE_GRAPH.sceneA.title);
  setStatus("パノラマを読み込みました。カメラを起動してください。");
}

function getCurrentSceneId() {
  return state.viewer?.getScene() ?? "sceneA";
}

/* -------------------------------------------------------------------------- */
/* STEP 2 — MediaPipe Hand Landmarker                                         */
/* -------------------------------------------------------------------------- */
async function initHandLandmarker() {
  setStatus("手認識モデルを読み込み中…");
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  state.handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: CONFIG.recognition.minHandDetectionConfidence,
    minHandPresenceConfidence: CONFIG.recognition.minHandPresenceConfidence,
    minTrackingConfidence: CONFIG.recognition.minTrackingConfidence,
  });

  setStatus("モデル準備完了。カメラを ON にしてください。");
}

/* -------------------------------------------------------------------------- */
/* Camera                                                                     */
/* -------------------------------------------------------------------------- */
function releaseCameraTracks() {
  if (state.stream) {
    state.stream.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch (_) {
        /* ignore */
      }
    });
    state.stream = null;
  }
  if (el.webcam.srcObject) {
    el.webcam.srcObject = null;
  }
}

/** Progressive fallback — strict constraints often cause NotReadableError. */
async function requestCameraStream() {
  const attempts = [
    {
      video: {
        facingMode: { ideal: "user" },
        width: { ideal: CONFIG.perf.camWidth },
        height: { ideal: CONFIG.perf.camHeight },
        frameRate: { ideal: CONFIG.perf.camFps },
      },
      audio: false,
    },
    {
      video: {
        facingMode: { ideal: "user" },
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
      audio: false,
    },
    {
      video: { facingMode: "user" },
      audio: false,
    },
    { video: true, audio: false },
  ];

  let lastErr = null;
  for (let i = 0; i < attempts.length; i++) {
    try {
      // Brief pause before retry helps when device was just released
      if (i > 0) await new Promise((r) => setTimeout(r, 250));
      return await navigator.mediaDevices.getUserMedia(attempts[i]);
    } catch (err) {
      lastErr = err;
      console.warn(`getUserMedia attempt ${i + 1} failed`, err.name, err.message);
    }
  }
  throw lastErr || new Error("カメラを開けませんでした");
}

async function startCamera() {
  el.cameraError.hidden = true;
  el.cameraError.textContent = "";

  if (!window.isSecureContext) {
    showCameraError(
      "カメラは HTTPS（または localhost）でのみ使えます。公開ページの URL を開いてください。"
    );
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    showCameraError("このブラウザはカメラAPIに対応していません。");
    return;
  }

  // Stop any prior session first (re-click / hot reload / other tab residue)
  releaseCameraTracks();

  try {
    const stream = await requestCameraStream();

    state.stream = stream;
    el.webcam.srcObject = stream;
    el.webcam.muted = true;
    el.webcam.setAttribute("playsinline", "");
    await el.webcam.play();

    // Prefer lower internal resolution for MediaPipe cost if browser gave higher
    const track = stream.getVideoTracks()[0];
    if (track?.getCapabilities) {
      try {
        const caps = track.getCapabilities();
        const settings = {};
        if (caps.width) {
          settings.width = Math.min(
            CONFIG.perf.camWidth,
            caps.width.max || CONFIG.perf.camWidth
          );
        }
        if (caps.height) {
          settings.height = Math.min(
            CONFIG.perf.camHeight,
            caps.height.max || CONFIG.perf.camHeight
          );
        }
        if (caps.frameRate) {
          settings.frameRate = Math.min(
            CONFIG.perf.camFps,
            caps.frameRate.max || CONFIG.perf.camFps
          );
        }
        if (Object.keys(settings).length) {
          await track.applyConstraints(settings);
        }
      } catch (_) {
        /* optional downscale — ignore */
      }
    }

    syncOverlaySize();
    state.cameraOn = true;
    el.cameraToggle.textContent = "カメラ OFF";
    el.cameraToggle.classList.add("active");
    beginCalibration(false);

    if (!state.animating) {
      state.animating = true;
      requestAnimationFrame(loop);
    }
  } catch (err) {
    console.error(err);
    releaseCameraTracks();
    let msg = `カメラを起動できません: ${err.message || err.name}`;
    if (err.name === "NotAllowedError" || err.name === "SecurityError") {
      msg =
        "カメラ権限が拒否されました。アドレスバーのカメラ許可を「許可」にして再読み込みしてください。";
    } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
      msg = "利用可能なカメラが見つかりません。接続を確認してください。";
    } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
      msg =
        "カメラを開始できません（ほかのアプリ・タブが使用中のことが多いです）。Zoom / Teams / ほかのブラウザタブを閉じてから、もう一度「カメラ ON」を押してください。";
    } else if (err.name === "OverconstrainedError") {
      msg = "この端末では指定のカメラ設定を使えません。もう一度お試しください。";
    }
    showCameraError(msg);
    setStatus(msg);
  }
}

function stopCamera() {
  releaseCameraTracks();
  state.cameraOn = false;
  state.smoothedLandmarks = null;
  state.handedness = null;
  state.handReady = false;
  state.lookArmed = false;
  state.aimNeutral = null;
  state.gestureProfile = null;
  state.aimAlign = createAimAlignState(false);
  state.palmDemo = createPalmDemoState(false);
  state.calib = createCalibState(false, false);
  showCalibUI(false);
  clearOverlay();
  setMode("idle", true);
  clearDirectionIndicators();
  el.cameraToggle.textContent = "カメラ ON";
  el.cameraToggle.classList.remove("active");
  el.handMeta.textContent = "手: —";
  setStatus("カメラを停止しました。");
}

function showCameraError(message) {
  el.cameraError.hidden = false;
  el.cameraError.textContent = message;
}

function syncOverlaySize() {
  // Draw at CSS display size (not full camera buffer) — major canvas win
  const rect = el.overlay.getBoundingClientRect();
  const w = Math.max(160, Math.round(rect.width) || 240);
  const h = Math.max(120, Math.round(rect.height) || 180);
  if (el.overlay.width !== w || el.overlay.height !== h) {
    el.overlay.width = w;
    el.overlay.height = h;
  }
}

/* -------------------------------------------------------------------------- */
/* Landmark helpers                                                           */
/* -------------------------------------------------------------------------- */
function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.hypot(dx, dy, dz);
}

function smoothLandmarks(raw) {
  const alpha = state.handReady
    ? CONFIG.recognition.landmarkAlpha
    : CONFIG.recognition.landmarkAlphaCalib;
  if (!state.smoothedLandmarks || state.smoothedLandmarks.length !== raw.length) {
    state.smoothedLandmarks = raw.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 }));
    return state.smoothedLandmarks;
  }
  for (let i = 0; i < raw.length; i++) {
    const s = state.smoothedLandmarks[i];
    s.x += (raw[i].x - s.x) * alpha;
    s.y += (raw[i].y - s.y) * alpha;
    s.z += ((raw[i].z ?? 0) - s.z) * alpha;
  }
  return state.smoothedLandmarks;
}

/**
 * MediaPipe Tasks returns handedness as Category[][] (per hand → categories).
 * Older snippets sometimes treat it as Category[] — support both.
 */
function getHandednessInfo(detection) {
  const entry = detection?.handedness?.[0];
  if (!entry) return { score: 1, categoryName: "Unknown" };
  const cat = Array.isArray(entry) ? entry[0] : entry;
  const score =
    typeof cat?.score === "number" && Number.isFinite(cat.score) ? cat.score : 1;
  const categoryName = cat?.categoryName || cat?.displayName || "Unknown";
  return { score, categoryName };
}

/**
 * Quality gate for locking onto a real, stable hand.
 * Returns { ok, reason, score, categoryName }.
 */
function assessHandQuality(rawLandmarks, detection) {
  const cfg = CONFIG.calibration;
  const { score, categoryName } = getHandednessInfo(detection);

  // Only reject very low scores; missing/unknown score is treated as OK
  if (score < cfg.minScore) {
    return { ok: false, reason: "信頼度不足", score, categoryName };
  }

  const wrist = rawLandmarks[LANDMARK.WRIST];
  const mid = rawLandmarks[LANDMARK.MIDDLE_MCP];
  const tip = rawLandmarks[LANDMARK.INDEX_TIP];
  const points = [wrist, mid, tip, rawLandmarks[LANDMARK.PINKY_MCP]];

  for (const p of points) {
    if (
      p.x < cfg.edgeMargin ||
      p.x > 1 - cfg.edgeMargin ||
      p.y < cfg.edgeMargin ||
      p.y > 1 - cfg.edgeMargin
    ) {
      return { ok: false, reason: "手が枠外寄り", score, categoryName };
    }
  }

  const span = dist(wrist, mid);
  if (span < cfg.minHandSpan) {
    return { ok: false, reason: "手が小さすぎる/遠い", score, categoryName };
  }

  // Soft jitter check — only reject large jumps (false tracks)
  if (state.calib.active && state.calib.lastRawTip) {
    const jitter = Math.hypot(
      tip.x - state.calib.lastRawTip.x,
      tip.y - state.calib.lastRawTip.y
    );
    if (jitter > cfg.maxTipJitter) {
      return { ok: false, reason: "もう少し手を安定させて", score, categoryName };
    }
  }

  return { ok: true, reason: "良好", score, categoryName };
}

function handleCalibrationFrame(quality, rawLandmarks) {
  const tip = rawLandmarks[LANDMARK.INDEX_TIP];
  state.calib.lastRawTip = { x: tip.x, y: tip.y };

  if (quality.ok) {
    state.calib.missStreak = 0;
    state.calib.progress += 1;
  } else {
    state.calib.missStreak += 1;
    if (state.calib.missStreak >= CONFIG.calibration.missDecay) {
      state.calib.progress = Math.max(0, state.calib.progress - 2);
      el.calibHint.textContent = quality.reason
        ? `${quality.reason}。手のひらを正面に向けて静止してください`
        : "手のひらを正面に向けて静止してください";
    }
  }

  const ratio = state.calib.progress / state.calib.targetFrames;
  updateCalibUI(ratio);
  el.handMeta.textContent = `調整 ${Math.round(clamp(ratio, 0, 1) * 100)}% · 信頼度 ${Math.round(quality.score * 100)}%`;

  if (state.calib.progress >= state.calib.targetFrames) {
    finishCalibration();
  }
}

function handleHandLostDuringReady() {
  state.calib.lostStreak += 1;
  // Always freeze pose; do not jump
  freezeViewpoint();
  state.moveCandidateCount = 0;
  el.handMeta.textContent = "手: 未検出";
  updateDebugPanel({ shape: "lost", score: 0 });

  // Grace: keep mode briefly so flicker does not thrash look↔idle↔move
  if (state.calib.lostStreak < CONFIG.recognition.lostGraceFrames) {
    setStatus("手が一時的に外れました…");
    return;
  }

  if (state.mode !== "idle") setMode("idle", true);

  if (state.calib.lostStreak >= CONFIG.calibration.lostBeforeRecalib) {
    beginCalibration(true);
  } else {
    setStatus("手が外れました。戻すと操作を再開できます。");
  }
}

/**
 * Mirror-aware point: video is CSS-mirrored (scaleX(-1)),
 * so we flip X for drawing and for user-facing directions.
 */
function mirroredX(x) {
  return 1 - x;
}

/* -------------------------------------------------------------------------- */
/* STEP 3 — Fist / index-point classification                                 */
/* -------------------------------------------------------------------------- */
function handScale(landmarks) {
  // Wrist → middle MCP as palm size reference (stable under pointing)
  return Math.max(
    0.04,
    dist(landmarks[LANDMARK.WRIST], landmarks[LANDMARK.MIDDLE_MCP])
  );
}

function fingerCurlRatio(landmarks, tipIdx, mcpIdx) {
  return dist(landmarks[tipIdx], landmarks[mcpIdx]) / handScale(landmarks);
}

/**
 * Palm roughly facing webcam.
 * Open palms are often coplanar (tip z ≈ MCP z), so also accept wide
 * fingertip spread in the image plane (rejects edge-on hands).
 */
function palmFacingCamera(landmarks) {
  const scale = handScale(landmarks);
  const spread =
    dist(landmarks[LANDMARK.INDEX_TIP], landmarks[LANDMARK.PINKY_TIP]) / scale;
  if (spread >= 0.75) return true;

  const tipIdx = [
    LANDMARK.INDEX_TIP,
    LANDMARK.MIDDLE_TIP,
    LANDMARK.RING_TIP,
    LANDMARK.PINKY_TIP,
  ];
  const mcpIdx = [
    LANDMARK.INDEX_MCP,
    LANDMARK.MIDDLE_MCP,
    LANDMARK.RING_MCP,
    LANDMARK.PINKY_MCP,
  ];
  let tipZ = 0;
  let mcpZ = 0;
  for (let i = 0; i < 4; i++) {
    tipZ += landmarks[tipIdx[i]].z ?? 0;
    mcpZ += landmarks[mcpIdx[i]].z ?? 0;
  }
  tipZ /= 4;
  mcpZ /= 4;
  const wristZ = landmarks[LANDMARK.WRIST].z ?? 0;
  // Soft: allow near-coplanar; reject only clear tip-away (back of hand / edge)
  return tipZ <= mcpZ + 0.02 || tipZ < wristZ + 0.01;
}

/**
 * Robust analysis with hysteresis.
 * Priority: open palm (move) > index-point (look) > idle.
 * Open palm must win over indexExtended (all fingers open otherwise looks like look).
 */
function analyzeHand(landmarks) {
  const th = getGestureThresholds();
  const palmMin =
    state.mode === "move" ? th.palmOpenMinRatio * 0.9 : th.palmOpenMinRatio;
  const thumbMin =
    state.mode === "move" ? th.thumbOpenMin * 0.88 : th.thumbOpenMin;
  const extendTh =
    state.mode === "look" ? th.indexExtendThreshold * 0.9 : th.indexExtendThreshold;
  const otherCurlTh =
    state.mode === "look" ? th.otherCurlThreshold * 1.08 : th.otherCurlThreshold;

  const indexTip = landmarks[LANDMARK.INDEX_TIP];
  const indexMcp = landmarks[LANDMARK.INDEX_MCP];
  const indexPip = landmarks[LANDMARK.INDEX_PIP];
  const wrist = landmarks[LANDMARK.WRIST];

  const curls = sampleFingerCurls(landmarks);
  const indexRatio = curls.index;
  const middleRatio = curls.middle;
  const thumb = thumbOpenRatio(landmarks);

  const tipWrist = dist(indexTip, wrist);
  const pipWrist = dist(indexPip, wrist);
  const tipBeyondPip = tipWrist > pipWrist * 1.04;
  const tipCloserZ = (indexTip.z ?? 0) < (indexMcp.z ?? 0) - 0.01;
  const indexLeads = indexRatio + 0.1 >= middleRatio;
  const tipTowardCamera = tipCloserZ && indexLeads && indexRatio > 0.55;

  const openCount =
    (curls.index >= palmMin ? 1 : 0) +
    (curls.middle >= palmMin ? 1 : 0) +
    (curls.ring >= palmMin ? 1 : 0) +
    (curls.pinky >= palmMin ? 1 : 0);

  const facing = palmFacingCamera(landmarks);
  const isPalmOpen =
    openCount >= th.palmOpenFingerMin &&
    thumb >= thumbMin &&
    facing;

  // Pointing: index extended, others mostly curled — never when palm is open
  const othersClosed =
    (curls.middle < otherCurlTh ? 1 : 0) +
    (curls.ring < otherCurlTh ? 1 : 0) +
    (curls.pinky < otherCurlTh ? 1 : 0);

  const indexExtended =
    !isPalmOpen &&
    (tipTowardCamera || (indexRatio > extendTh && tipBeyondPip && indexLeads));

  const isPointing =
    indexExtended && othersClosed >= th.lookOthersClosedMin && !isPalmOpen;

  let shape = "idle";
  if (isPalmOpen) shape = "move";
  else if (isPointing) shape = "look";

  const analysis = {
    shape,
    indexExtended: isPointing,
    indexCurled: indexRatio < th.indexCurlThreshold && !isPointing,
    indexRatio,
    othersClosed,
    isPalmOpen,
    isFist: false,
    tipBeyondPip,
    tipTowardCamera,
    thumb,
    openCount,
  };
  state.lastHandAnalysis = analysis;
  return analysis;
}

function classifyHandShape(landmarks) {
  return analyzeHand(landmarks).shape;
}

function updateModeFromShape(shape) {
  const now = performance.now();
  if (now - state.lastModeChangeAt < CONFIG.recognition.modeCooldownMs) {
    return;
  }

  // Entering move needs more confirmation than look/idle
  const needed =
    shape === "move"
      ? CONFIG.recognition.moveConfirmFrames
      : CONFIG.recognition.confirmFrames;

  if (shape === state.candidateMode) {
    state.candidateCount += 1;
  } else {
    state.candidateMode = shape;
    state.candidateCount = 1;
  }

  if (state.candidateMode !== state.mode && state.candidateCount >= needed) {
    setMode(state.candidateMode);
  }
}

function setMode(mode, force = false) {
  if (!force && mode === state.mode) return;
  state.mode = mode;
  state.lastModeChangeAt = performance.now();
  state.moveCandidateCount = 0;

  if (mode === "look" && state.viewer) {
    // Keep the on-screen pose (current*). Do NOT re-read viewer
    // or adopt an ahead targetYaw — that caused freeze jumps.
    state.targetYaw = state.currentYaw;
    state.targetPitch = state.currentPitch;
    applyViewerPose(state.currentYaw, state.currentPitch);
    resetLookState();
    state.viewFrozen = false;
    setStatus("視点操作：人差し指の指す方向へ、連続的に視点が動きます。");
  } else if (mode === "idle") {
    freezeViewpoint();
  } else {
    // move mode: lock the current view while advancing
    freezeViewpoint();
  }

  const map = {
    idle: { label: "視点固定", className: "mode-idle" },
    look: { label: "視点操作", className: "mode-look" },
    move: { label: "前進", className: "mode-move" },
  };
  const info = map[mode];
  el.modeLabel.textContent = info.label;
  el.modeBadge.className = `mode-badge ${info.className} mode-changed`;
  el.modeBadge.dataset.mode = mode;
  window.setTimeout(() => el.modeBadge.classList.remove("mode-changed"), 560);

  if (mode === "idle") {
    setStatus("手を認識できません。視点を固定しています。");
  } else if (mode === "look") {
    setStatus("視点操作：人差し指の指す方向へ、連続的に視点が動きます。");
  } else {
    setStatus("前進：手のひらを見せたまま少し待つと次のシーンへ進みます。");
  }
}

/* -------------------------------------------------------------------------- */
/* STEP 4 — Continuous look toward index pointing direction                   */
/* -------------------------------------------------------------------------- */
function computeIndexAim(landmarks) {
  const wrist = landmarks[LANDMARK.WRIST];
  const mcp = landmarks[LANDMARK.INDEX_MCP];
  const pip = landmarks[LANDMARK.INDEX_PIP];
  const tip = landmarks[LANDMARK.INDEX_TIP];
  state.indexGuide = { wrist, mcp, tip };

  const scale = handScale(landmarks);

  // Wrist / MCP / PIP / TIP blend → free aim (hand-scaled, mirrored)
  let dx =
    (tip.x - pip.x) * 0.55 + (tip.x - mcp.x) * 0.3 + (tip.x - wrist.x) * 0.15;
  let dy =
    (tip.y - pip.y) * 0.55 + (tip.y - mcp.y) * 0.3 + (tip.y - wrist.y) * 0.15;

  dx = -dx / scale; // mirror + normalize by palm size
  dy = dy / scale;
  return { x: dx, y: dy };
}

/** Soft deadzone + power curve; keeps full 2D direction (no axis snap). */
function shapeAimResponse(v, deadZone, power) {
  const a = Math.abs(v);
  if (a <= deadZone) return 0;
  const t = Math.min(1.5, (a - deadZone) / Math.max(0.001, 1.2 - deadZone));
  return Math.sign(v) * Math.pow(t, power);
}

/**
 * Continuous free-aim look via One-Euro-filtered pointing vector,
 * relative to front-point neutral captured in aim-align.
 */
function applyIndexLookControl(landmarks, now = performance.now()) {
  if (!state.lookArmed || !state.aimNeutral) return;

  const {
    deadZone,
    responsePower,
    yawSensitivity,
    pitchSensitivity,
    maxYawSpeed,
    maxPitchSpeed,
    directApply,
    leftYawBoost,
  } = CONFIG.viewpoint;

  ensureAimFilters();
  const raw = computeIndexAim(landmarks);
  const sx = state.aimFilterX.filter(raw.x, now);
  const sy = state.aimFilterY.filter(raw.y, now);

  // Relative to "point at camera" neutral — stops forced look-up on start
  let rx = sx - state.aimNeutral.x;
  let ry = sy - state.aimNeutral.y;

  let nx = shapeAimResponse(rx, deadZone, responsePower);
  let ny = shapeAimResponse(ry, deadZone, responsePower);

  // Left aim felt weak — boost negative yaw side only
  if (nx < 0) nx *= leftYawBoost ?? 1.2;

  state.lookDir = { x: nx, y: ny };

  if (nx === 0 && ny === 0) {
    clearDirectionIndicators();
    if (el.aimPip) el.aimPip.hidden = true;
    return;
  }

  state.viewFrozen = false;

  const dt =
    state._lastLookAt != null
      ? clamp((now - state._lastLookAt) / 1000, 0.008, 0.05)
      : 0.016;
  state._lastLookAt = now;

  let dYaw = nx * yawSensitivity * dt;
  let dPitch = -ny * pitchSensitivity * dt;
  dYaw = clamp(dYaw, -maxYawSpeed, maxYawSpeed);
  dPitch = clamp(dPitch, -maxPitchSpeed, maxPitchSpeed);

  state.targetYaw += dYaw;
  state.targetPitch = clamp(state.targetPitch + dPitch, -85, 85);

  const instant = clamp(directApply ?? 0.75, 0, 1);
  state.currentYaw += dYaw * instant;
  state.currentPitch = clamp(state.currentPitch + dPitch * instant, -85, 85);
  applyViewerPose(state.currentYaw, state.currentPitch);

  updateFreeAimIndicator(nx, ny);
}

/** Free-angle pip only — do not light up discrete U/D/L/R arrows while looking */
function updateFreeAimIndicator(nx, ny) {
  clearDirectionIndicators();
  if (!el.aimPip) return;
  el.aimPip.hidden = false;
  const reach = 28;
  const mag = Math.hypot(nx, ny) || 1;
  const ux = (nx / mag) * Math.min(1, mag * 4);
  const uy = (ny / mag) * Math.min(1, mag * 4);
  el.aimPip.style.transform = `translate(calc(-50% + ${ux * reach}px), calc(-50% + ${uy * reach}px))`;
}

/* -------------------------------------------------------------------------- */
/* STEP 5 — Fist → advance forward                                            */
/* -------------------------------------------------------------------------- */
function applyForwardMove() {
  // Hard safety: never advance while index is extended
  if (state.lastHandAnalysis?.indexExtended) {
    state.moveCandidateCount = 0;
    return;
  }

  state.moveDir = "forward";
  clearDirectionIndicators();
  if (el.aimPip) el.aimPip.hidden = true;
  el.dirForward.classList.add("active", "move");

  state.moveCandidateCount += 1;
  if (state.moveCandidateCount < CONFIG.movement.confirmFrames) return;

  const now = performance.now();
  if (now - state.lastMoveAt < CONFIG.movement.moveCooldownMs) return;

  tryTravel("forward");
  state.moveCandidateCount = 0;
  state.lastMoveAt = now;
}

function tryTravel(direction) {
  const sceneId = getCurrentSceneId();
  const scene = SCENE_GRAPH[sceneId];
  if (!scene) return;

  const next = scene.links[direction];
  if (!next) {
    setStatus(`その方向（${directionLabel(direction)}）には進めません。`);
    return;
  }

  const yaw = state.currentYaw;
  const pitch = state.currentPitch;
  state.viewer.loadScene(next, pitch, yaw, state.viewer.getHfov());
  state.currentYaw = yaw;
  state.currentPitch = pitch;
  state.targetYaw = yaw;
  state.targetPitch = pitch;
  state.viewFrozen = true;
  showToast(SCENE_GRAPH[next].title);
  setStatus(`${directionLabel(direction)}へ移動 → ${SCENE_GRAPH[next].title}`);
}

function directionLabel(dir) {
  return { forward: "前進", back: "後退", left: "左", right: "右" }[dir] ?? dir;
}

/* -------------------------------------------------------------------------- */
/* Drawing                                                                    */
/* -------------------------------------------------------------------------- */
function clearOverlay() {
  overlayCtx.clearRect(0, 0, el.overlay.width, el.overlay.height);
}

function drawLandmarks(landmarks, force = false) {
  const now = performance.now();
  if (
    !force &&
    now - state.lastOverlayTime < CONFIG.perf.overlayIntervalMs
  ) {
    return;
  }
  state.lastOverlayTime = now;

  const w = el.overlay.width;
  const h = el.overlay.height;
  clearOverlay();

  const connections = CONFIG.perf.lightOverlay
    ? HAND_CONNECTIONS_LIGHT
    : HAND_CONNECTIONS;

  overlayCtx.save();
  overlayCtx.lineWidth = 2;
  overlayCtx.strokeStyle = "rgba(61, 255, 176, 0.85)";
  overlayCtx.beginPath();
  for (const [a, b] of connections) {
    const pa = landmarks[a];
    const pb = landmarks[b];
    overlayCtx.moveTo(mirroredX(pa.x) * w, pa.y * h);
    overlayCtx.lineTo(mirroredX(pb.x) * w, pb.y * h);
  }
  overlayCtx.stroke();

  overlayCtx.fillStyle = "#3dffb0";
  for (const i of TIP_INDICES) {
    const p = landmarks[i];
    overlayCtx.beginPath();
    overlayCtx.arc(mirroredX(p.x) * w, p.y * h, 3.5, 0, Math.PI * 2);
    overlayCtx.fill();
  }

  // Index aim guide only while looking (and armed)
  if (state.lookArmed && state.mode === "look" && state.indexGuide) {
    const mcp = state.indexGuide.mcp;
    const tip = state.indexGuide.tip;
    overlayCtx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    overlayCtx.lineWidth = 2.5;
    overlayCtx.beginPath();
    overlayCtx.moveTo(mirroredX(mcp.x) * w, mcp.y * h);
    overlayCtx.lineTo(mirroredX(tip.x) * w, tip.y * h);
    overlayCtx.stroke();
    overlayCtx.fillStyle = "#ffffff";
    overlayCtx.beginPath();
    overlayCtx.arc(mirroredX(tip.x) * w, tip.y * h, 5, 0, Math.PI * 2);
    overlayCtx.fill();
  }

  overlayCtx.restore();
}

function tickPerfFps(now) {
  state.perf.frames += 1;
  if (!state.perf.fpsWindowStart) state.perf.fpsWindowStart = now;
  const elapsed = now - state.perf.fpsWindowStart;
  if (elapsed >= 1000) {
    state.perf.fps = Math.round((state.perf.frames * 1000) / elapsed);
    state.perf.frames = 0;
    state.perf.fpsWindowStart = now;
  }
}

function clearDirectionIndicators() {
  for (const node of [el.dirForward, el.dirBack, el.dirLeft, el.dirRight]) {
    node.classList.remove("active", "move");
  }
}

/* -------------------------------------------------------------------------- */
/* Main loop                                                                  */
/* -------------------------------------------------------------------------- */
function loop(now) {
  if (!state.animating) return;
  requestAnimationFrame(loop);
  tickPerfFps(now);

  // Chase remaining pose delta only when needed (avoid redundant setYaw)
  if (state.viewer && state.mode === "look" && !state.viewFrozen) {
    const dyaw = state.targetYaw - state.currentYaw;
    const dpitch = state.targetPitch - state.currentPitch;
    if (
      Math.abs(dyaw) > CONFIG.perf.poseEpsilon ||
      Math.abs(dpitch) > CONFIG.perf.poseEpsilon
    ) {
      const lerp = CONFIG.viewpoint.poseLerp;
      state.currentYaw += dyaw * lerp;
      state.currentPitch += dpitch * lerp;
      applyViewerPose(state.currentYaw, state.currentPitch);
    }
  }

  if (!state.cameraOn || !state.handLandmarker) return;
  if (el.webcam.readyState < 2) return;

  const inTutorial = state.palmDemo.active || state.aimAlign.active || state.calib.active;
  const detectEvery = inTutorial
    ? CONFIG.perf.detectIntervalTutorialMs
    : CONFIG.perf.detectIntervalMs;
  if (now - state.lastDetectTime < detectEvery) return;
  state.lastDetectTime = now;

  const t0 = performance.now();
  let result;
  try {
    result = state.handLandmarker.detectForVideo(el.webcam, now);
  } catch (err) {
    console.warn("detectForVideo failed", err);
    return;
  }
  state.perf.detectMs = performance.now() - t0;

  if (!result.landmarks?.length) {
    state.smoothedLandmarks = null;
    state.handedness = null;
    clearOverlay();

    if (state.calib.active) {
      state.calib.missStreak += 1;
      state.calib.lastRawTip = null;
      if (state.calib.missStreak >= CONFIG.calibration.missDecay) {
        state.calib.progress = Math.max(0, state.calib.progress - 3);
        updateCalibUI(state.calib.progress / state.calib.targetFrames);
        el.calibHint.textContent =
          "手が検出できません。明るい場所で手のひらをカメラに向けてください";
      }
      if (now - state.lastDebugTime >= CONFIG.perf.debugIntervalMs) {
        state.lastDebugTime = now;
        el.handMeta.textContent = "調整中 · 未検出";
      }
      freezeViewpoint();
      return;
    }

    handleHandLostDuringReady();
    return;
  }

  const raw = result.landmarks[0];
  const quality = assessHandQuality(raw, result);

  // Palm calibration: skip heavy overlay most frames
  if (state.calib.active || !state.handReady) {
    if (!state.calib.active) beginCalibration(false);
    const landmarks = smoothLandmarks(raw);
    drawLandmarks(landmarks);
    handleCalibrationFrame(quality, raw);
    freezeViewpoint();
    return;
  }

  if (!quality.ok) {
    state.calib.lostStreak += 1;
    freezeViewpoint();
    state.moveCandidateCount = 0;
    maybeUpdateDebug(
      {
        shape: "lowQ",
        score: quality.score,
        handMeta: `手: 不安定 (${quality.reason})`,
      },
      now
    );
    if (state.calib.lostStreak >= CONFIG.recognition.lostGraceFrames) {
      if (state.mode !== "idle") setMode("idle", true);
    }
    if (state.calib.lostStreak >= CONFIG.calibration.lostBeforeRecalib) {
      beginCalibration(true);
    }
    return;
  }

  state.calib.lostStreak = 0;
  const landmarks = smoothLandmarks(raw);
  state.handedness = quality.categoryName;

  const analysis = analyzeHand(landmarks);
  const shape = analysis.shape;
  const scorePct = Math.round(quality.score * 100);
  const handLabel =
    state.handedness === "Left" ? "左" : state.handedness === "Right" ? "右" : state.handedness;
  maybeUpdateDebug(
    {
      shape,
      score: quality.score,
      handMeta: `手: ${handLabel} · ${scorePct}%`,
    },
    now
  );

  // Tutorial ① open palm → learn personal palm-open thresholds
  if (state.palmDemo.active) {
    drawLandmarks(landmarks); // internally rate-limited
    handlePalmDemoFrame(landmarks, analysis, now);
    return;
  }

  // Tutorial ② front point → aimNeutral (use RAW landmarks; foreshortening-safe eval)
  if (state.aimAlign.active) {
    drawLandmarks(landmarks);
    handleAimAlignFrame(raw, analysis, now);
    return;
  }

  if (!state.lookArmed) {
    freezeViewpoint();
    return;
  }

  drawLandmarks(landmarks);
  updateModeFromShape(shape);

  if (shape === "look") {
    state.moveCandidateCount = 0;
    applyIndexLookControl(raw, now);
    return;
  }

  if (shape === "move" && state.mode === "move" && analysis.isPalmOpen) {
    applyForwardMove();
    return;
  }

  if (!state.viewFrozen) freezeViewpoint();
}

/* -------------------------------------------------------------------------- */
/* UI helpers                                                                 */
/* -------------------------------------------------------------------------- */
function setStatus(text) {
  el.statusText.textContent = text;
}

function showToast(text) {
  el.sceneToast.hidden = false;
  el.sceneToast.textContent = text;
  window.clearTimeout(showToast._t);
  showToast._t = window.setTimeout(() => {
    el.sceneToast.hidden = true;
  }, 1800);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/* -------------------------------------------------------------------------- */
/* Boot                                                                       */
/* -------------------------------------------------------------------------- */
async function main() {
  initViewer();
  if (el.debugPanel && !CONFIG.perf.showDebug) el.debugPanel.hidden = true;

  el.cameraToggle.addEventListener("click", () => {
    if (state.cameraOn) stopCamera();
    else startCamera();
  });

  window.addEventListener("resize", syncOverlaySize);

  try {
    await initHandLandmarker();
  } catch (err) {
    console.error(err);
    setStatus("手認識モデルの読み込みに失敗しました。ネットワークを確認してください。");
    showCameraError("MediaPipe モデルを読み込めませんでした。");
  }
}

main();
