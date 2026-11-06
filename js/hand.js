/**
 * Hand input — contract: emits { present, pinch01, raw, score } per frame.
 * pinch01: 0 = thumb & index touching, 1 = fully open. Hand-scale normalized,
 * One-Euro smoothed. Video never leaves the browser (MediaPipe runs locally).
 */
import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm";
import { OneEuroFilter, clamp } from "./filters.js";

const LM = { WRIST: 0, THUMB_TIP: 4, INDEX_MCP: 5, INDEX_TIP: 8, MIDDLE_MCP: 9 };

const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const CFG = {
  camWidth: 480,
  camHeight: 360,
  camFps: 24,
  detectIntervalMs: 40,
  overlayIntervalMs: 50,
  /** pinch distance (hand-scale units) that maps to 0 / 1 initially; auto-expands */
  pinchClosed: 0.32,
  pinchOpen: 1.35,
  minScore: 0.5,
  lostGraceFrames: 6,
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export class HandInput {
  constructor({ video, overlay, onFrame, onStatus }) {
    this.video = video;
    this.overlay = overlay;
    this.ctx = overlay.getContext("2d");
    this.onFrame = onFrame;
    this.onStatus = onStatus || (() => {});
    this.landmarker = null;
    this.stream = null;
    this.running = false;
    this.lastDetect = 0;
    this.lastOverlay = 0;
    this.filter = new OneEuroFilter(1.6, 0.9, 1.0);
    this.range = { lo: CFG.pinchClosed, hi: CFG.pinchOpen };
    this.lostFrames = 0;
    this.lastPinch01 = null;
  }

  async init() {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );
    this.landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
    });
  }

  async start() {
    if (!window.isSecureContext) {
      throw new Error("カメラは HTTPS または localhost でのみ使えます。");
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("このブラウザはカメラAPIに対応していません。");
    }
    this.stopStream();
    const attempts = [
      { video: { facingMode: { ideal: "user" }, width: { ideal: CFG.camWidth }, height: { ideal: CFG.camHeight }, frameRate: { ideal: CFG.camFps } }, audio: false },
      { video: { facingMode: { ideal: "user" }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
      { video: true, audio: false },
    ];
    let lastErr = null;
    for (let i = 0; i < attempts.length; i++) {
      try {
        if (i > 0) await new Promise((r) => setTimeout(r, 250));
        this.stream = await navigator.mediaDevices.getUserMedia(attempts[i]);
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!this.stream) {
      const name = lastErr?.name || "";
      if (name === "NotAllowedError") throw new Error("カメラ権限が拒否されました。許可して再読み込みしてください。");
      if (name === "NotFoundError") throw new Error("カメラが見つかりません。");
      if (name === "NotReadableError") throw new Error("カメラを開始できません。他のアプリ・タブを閉じて再試行してください。");
      throw lastErr || new Error("カメラを開けませんでした。");
    }
    this.video.srcObject = this.stream;
    await this.video.play();
    this.syncOverlay();
    this.running = true;
    this.filter.reset();
    this.lostFrames = 0;
    requestAnimationFrame((t) => this.loop(t));
  }

  stopStream() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
  }

  stop() {
    this.running = false;
    this.stopStream();
    this.clearOverlay();
    this.onFrame({ present: false, pinch01: null, raw: null, score: 0 });
  }

  syncOverlay() {
    const rect = this.overlay.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.overlay.width = Math.max(1, Math.round(rect.width * dpr));
    this.overlay.height = Math.max(1, Math.round(rect.height * dpr));
  }

  clearOverlay() {
    this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  loop(now) {
    if (!this.running) return;
    requestAnimationFrame((t) => this.loop(t));
    if (!this.landmarker || this.video.readyState < 2) return;
    if (now - this.lastDetect < CFG.detectIntervalMs) return;
    this.lastDetect = now;

    let result;
    try {
      result = this.landmarker.detectForVideo(this.video, now);
    } catch (err) {
      console.warn("detectForVideo failed", err);
      return;
    }

    const lms = result.landmarks?.[0];
    const score = result.handedness?.[0]?.[0]?.score ?? 0;

    if (!lms || score < CFG.minScore) {
      this.lostFrames += 1;
      if (this.lostFrames >= CFG.lostGraceFrames) {
        this.filter.reset();
        this.clearOverlay();
        this.onFrame({ present: false, pinch01: null, raw: null, score });
      }
      return;
    }
    this.lostFrames = 0;

    const scale = Math.max(0.04, dist(lms[LM.WRIST], lms[LM.MIDDLE_MCP]));
    const rawPinch = dist(lms[LM.THUMB_TIP], lms[LM.INDEX_TIP]) / scale;

    // Auto-expanding range so different hand sizes reach 0 and 1
    if (rawPinch < this.range.lo) this.range.lo += (rawPinch - this.range.lo) * 0.3;
    if (rawPinch > this.range.hi) this.range.hi += (rawPinch - this.range.hi) * 0.3;

    const smooth = this.filter.filter(rawPinch, now);
    const span = Math.max(0.2, this.range.hi - this.range.lo);
    const pinch01 = clamp((smooth - this.range.lo) / span, 0, 1);
    this.lastPinch01 = pinch01;

    if (now - this.lastOverlay >= CFG.overlayIntervalMs) {
      this.lastOverlay = now;
      this.draw(lms, pinch01);
    }

    this.onFrame({ present: true, pinch01, raw: rawPinch, score, landmarks: lms });
  }

  draw(lms, pinch01) {
    const { ctx, overlay } = this;
    const W = overlay.width;
    const H = overlay.height;
    ctx.clearRect(0, 0, W, H);
    const P = (i) => ({ x: lms[i].x * W, y: lms[i].y * H });

    ctx.lineWidth = Math.max(1.5, W / 240);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    for (const [a, b] of CONNECTIONS) {
      const pa = P(a);
      const pb = P(b);
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
    }
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.8)";
    for (let i = 0; i < lms.length; i++) {
      const p = P(i);
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(2, W / 160), 0, Math.PI * 2);
      ctx.fill();
    }

    // Pinch highlight: thumb tip ↔ index tip
    const t = P(LM.THUMB_TIP);
    const i = P(LM.INDEX_TIP);
    ctx.strokeStyle = "#4fd1c5";
    ctx.lineWidth = Math.max(2.5, W / 120);
    ctx.beginPath();
    ctx.moveTo(t.x, t.y);
    ctx.lineTo(i.x, i.y);
    ctx.stroke();
    ctx.fillStyle = "#4fd1c5";
    for (const p of [t, i]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(4, W / 70), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#f6ad55";
    const mid = { x: (t.x + i.x) / 2, y: (t.y + i.y) / 2 };
    ctx.beginPath();
    ctx.arc(mid.x, mid.y, Math.max(5, W / 60) * (0.5 + pinch01), 0, Math.PI * 2);
    ctx.globalAlpha = 0.35;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}
