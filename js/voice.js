/**
 * Voice I/O. Recognition via Web Speech API (Chrome). TTS via speechSynthesis.
 * Recognition is paused while TTS speaks so the mic does not hear itself.
 */
export class Voice {
  constructor({ onInterim, onFinal, onState }) {
    this.onInterim = onInterim || (() => {});
    this.onFinal = onFinal || (() => {});
    this.onState = onState || (() => {});
    this.rec = null;
    this.wantListening = false;
    this.speaking = false;
    this.ttsEnabled = true;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = !!SR;
    if (SR) {
      this.rec = new SR();
      this.rec.lang = "ja-JP";
      this.rec.continuous = true;
      this.rec.interimResults = true;
      this.rec.maxAlternatives = 1;
      this.rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const t = r[0].transcript.trim();
          if (r.isFinal) this.onFinal(t);
          else interim += t;
        }
        if (interim) this.onInterim(interim);
      };
      this.rec.onend = () => {
        this.onState("ended");
        // Chrome stops after silence; restart while user wants listening
        if (this.wantListening && !this.speaking) {
          setTimeout(() => this.safeStart(), 150);
        }
      };
      this.rec.onerror = (e) => {
        this.onState(`error:${e.error}`);
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          this.wantListening = false;
        }
      };
    }
  }

  safeStart() {
    if (!this.rec) return;
    try {
      this.rec.start();
      this.onState("listening");
    } catch (_) {
      /* already started */
    }
  }

  start() {
    if (!this.supported) return false;
    this.wantListening = true;
    this.safeStart();
    return true;
  }

  stop() {
    this.wantListening = false;
    try {
      this.rec?.stop();
    } catch (_) {
      /* ignore */
    }
    this.onState("stopped");
  }

  speak(text) {
    if (!this.ttsEnabled || !("speechSynthesis" in window) || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    u.rate = 1.02;
    const voices = window.speechSynthesis.getVoices();
    const ja = voices.find((v) => v.lang?.startsWith("ja"));
    if (ja) u.voice = ja;
    u.onstart = () => {
      this.speaking = true;
      try { this.rec?.stop(); } catch (_) { /* ignore */ }
    };
    u.onend = u.onerror = () => {
      this.speaking = false;
      if (this.wantListening) setTimeout(() => this.safeStart(), 200);
    };
    window.speechSynthesis.speak(u);
  }

  cancelSpeech() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    this.speaking = false;
  }
}
