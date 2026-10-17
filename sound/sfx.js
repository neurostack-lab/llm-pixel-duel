/* sfx.js — общий 8-битный синтезатор для игр дуэли (WebAudio, без файлов и сети).
   Добавлен поверх ответов моделей; в самих играх добавлены только вызовы __SFX.play('имя').
   API:
     __SFX.play(name)        — звук события; всегда пишет {t: performance.now(), name} в window.__sfxLog
     клавиша / клик          — включает звук (политика автоплея браузеров); M — выкл/вкл
     window.__renderSfx(log, durationSec, opts) -> Promise<base64 WAV 44.1 кГц стерео 16 бит>
        opts: offsetMs (вычесть из t, по умолчанию 0), music (true), musicGain (1), sfxGain (1), pan (-1..1 для всех звуков)
        у события может быть своё поле pan (например, левая/правая игра в ролике «бок о бок»)
     ?nohint в адресе — без подсказки; ?rec — режим записи: без подсказки + полоса таймкода внизу окна
        (каждый кадр несёт performance.now() кадра 24 битами, клетки 30x16 px) и window.__sfxFrames — метки rAF;
        по ним скрипт записи ролика точно сводит звук с видео (recordVideo может терять/сдвигать кадры под нагрузкой). */
(function () {
  "use strict";
  if (window.__SFX) return;
  var LOG = (window.__sfxLog = window.__sfxLog || []);
  var REC = /[?&#]rec\b/.test(location.search + location.hash);
  if (REC) {
    var FR = (window.__sfxFrames = []), tc = null;
    var tick = function (ts) {
      if (!tc && document.body) {
        tc = document.createElement("canvas"); tc.width = 960; tc.height = 16;
        tc.style.cssText = "position:fixed;left:0;bottom:0;width:960px;height:16px;z-index:2147483647;image-rendering:pixelated";
        document.body.appendChild(tc);
      }
      FR.push(ts);
      if (tc) {
        var x = tc.getContext("2d"), v = Math.round(ts);
        x.fillStyle = "#000"; x.fillRect(0, 0, 960, 16);
        x.fillStyle = "#fff";
        for (var b = 0; b < 24; b++) if ((v >> b) & 1) x.fillRect(b * 30, 0, 30, 16);
        x.fillRect(24 * 30 + 10, 0, 10, 16); // маркер «полоса на месте»
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick); // зарегистрирован раньше игры -> в каждом кадре рисуется первым, с тем же ts
  }

  var SFX_GAIN = 0.55, MUSIC_GAIN = 0.2; // мелодия заметно тише звуков (RMS ~0.04 против ~0.06)
  function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  function note(s) {
    var m = /^([A-G])(#|b)?(\d)$/.exec(s);
    var b = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
    return midi(12 * (+m[3] + 1) + b);
  }

  /* ---------- примитивы: пульс 12.5/25/50 %, треугольник, шум ---------- */
  var cache = new WeakMap();
  function store(ctx) { var c = cache.get(ctx); if (!c) { c = {}; cache.set(ctx, c); } return c; }
  function pulseWave(ctx, duty) {
    var c = store(ctx), k = "p" + duty;
    if (!c[k]) {
      var N = 48, re = new Float32Array(N), im = new Float32Array(N);
      for (var n = 1; n < N; n++) re[n] = (2 * Math.sin(Math.PI * n * duty)) / (Math.PI * n);
      c[k] = ctx.createPeriodicWave(re, im);
    }
    return c[k];
  }
  function noiseBuf(ctx) {
    var c = store(ctx);
    if (!c.noise) {
      var len = ctx.sampleRate, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
      var lfsr = 1, v = 1; // 15-битный LFSR как у NES, отсчёт держится 4 сэмпла
      for (var i = 0; i < len; i++) {
        if ((i & 3) === 0) { var bit = (lfsr ^ (lfsr >> 1)) & 1; lfsr = (lfsr >> 1) | (bit << 14); v = (lfsr & 1) ? 1 : -1; }
        d[i] = v;
      }
      c.noise = b;
    }
    return c.noise;
  }
  var DUTY = { p12: 0.125, p25: 0.25, p50: 0.5 };
  // w: p12|p25|p50|tri; f -> f2 скольжение; v — громкость; hold — доля длительности до спада
  function tone(ctx, out, t, w, f, f2, dur, v, hold) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    if (w === "tri") o.type = "triangle"; else o.setPeriodicWave(pulseWave(ctx, DUTY[w] || 0.5));
    o.frequency.setValueAtTime(f, t);
    if (f2 && f2 !== f) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    var h = Math.max(0.004, dur * (hold == null ? 0.3 : hold));
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.003);
    g.gain.setValueAtTime(v, t + h);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(ctx, out, t, dur, v, rate, lp) {
    var s = ctx.createBufferSource(), g = ctx.createGain(), dst = g;
    s.buffer = noiseBuf(ctx); s.playbackRate.value = rate || 1;
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    if (lp) { var f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp; s.connect(f); f.connect(g); }
    else s.connect(g);
    dst.connect(out);
    s.start(t, (t * 7.31) % 0.5); s.stop(t + dur + 0.02);
  }
  function seq(ctx, out, t, w, notes, step, v, hold) {
    for (var i = 0; i < notes.length; i++) if (notes[i]) tone(ctx, out, t + i * step, w, note(notes[i]), 0, step * 0.95, v, hold);
  }

  /* ---------- звуки событий (одни и те же для живого звука и офлайн-рендера) ---------- */
  var SOUNDS = {
    jump: function (c, o, t) { tone(c, o, t, "p25", 290, 780, 0.16, 0.20, 0.25); },
    coin: function (c, o, t) { tone(c, o, t, "p25", note("B5"), 0, 0.07, 0.18, 0.9); tone(c, o, t + 0.07, "p25", note("E6"), 0, 0.30, 0.18, 0.15); },
    stomp: function (c, o, t) {
      tone(c, o, t, "tri", 560, 90, 0.13, 0.55, 0.15);
      tone(c, o, t, "p50", 240, 110, 0.07, 0.08, 0.2);
      noise(c, o, t, 0.09, 0.22, 1, 2600);
    },
    land: function (c, o, t) { tone(c, o, t, "tri", 150, 60, 0.05, 0.22, 0.1); noise(c, o, t, 0.045, 0.07, 0.5, 700); },
    bump: function (c, o, t) { tone(c, o, t, "tri", 210, 120, 0.09, 0.45, 0.2); noise(c, o, t, 0.06, 0.12, 0.7, 1500); },
    hurt: function (c, o, t) {
      tone(c, o, t, "p50", 700, 260, 0.14, 0.15, 0.3);
      tone(c, o, t + 0.13, "p50", 520, 140, 0.22, 0.15, 0.3);
      noise(c, o, t, 0.18, 0.20, 1.2, 3500);
    },
    death: function (c, o, t) {
      var n = ["E5", "D#5", "D5", "C#5"];
      for (var i = 0; i < n.length; i++) tone(c, o, t + i * 0.14, "p50", note(n[i]), note(n[i]) * 0.94, 0.13, 0.15, 0.6);
      tone(c, o, t + 0.56, "p50", note("C5"), note("C4"), 0.55, 0.16, 0.4);
      tone(c, o, t + 0.56, "tri", note("C3"), note("C2"), 0.6, 0.35, 0.5);
      noise(c, o, t, 0.25, 0.12, 0.8, 2000);
    },
    oneup: function (c, o, t) { seq(c, o, t, "p25", ["C6", "E6", "G6", "C7", "E7", "G7"], 0.06, 0.15, 0.8); },
    clear: function (c, o, t) {
      seq(c, o, t, "p25", ["G5", "C6", "E6", "G6"], 0.1, 0.16, 0.8);
      tone(c, o, t + 0.4, "p25", note("C7"), 0, 0.6, 0.16, 0.5);
      tone(c, o, t + 0.4, "p50", note("E6"), 0, 0.6, 0.08, 0.5);
      seq(c, o, t, "tri", ["C4", "G4", "C5", "E5"], 0.1, 0.35, 0.8);
      tone(c, o, t + 0.4, "tri", note("C4"), 0, 0.6, 0.35, 0.5);
    }
  };

  /* ---------- фоновый чиптюн-луп: Am | F | C | G, 140 BPM, 64 шестнадцатых (~6.9 с) ---------- */
  var STEP = 60 / 140 / 4, LOOP = 64;
  var LEAD = (
    "A4 - C5 - E5 - A5 - G5 - E5 - C5 - D5 E5 " +
    "F5 - - - E5 - C5 - A4 - C5 - F5 - E5 D5 " +
    "E5 - G5 - C6 - G5 - E5 - G5 - C6 - D6 - " +
    "B5 - - - G5 - D5 - B4 - D5 - G5 - - ."
  ).trim().split(/\s+/);
  var LEAD_N = [];
  (function () {
    for (var i = 0; i < LEAD.length; i++) {
      if (LEAD[i] === "-" || LEAD[i] === ".") continue;
      var len = 1; while (i + len < LEAD.length && LEAD[i + len] === "-") len++;
      LEAD_N[i] = { f: note(LEAD[i]), len: len };
    }
  })();
  var ROOTS = ["A2", "F2", "C3", "G2"], BASS_PAT = [0, 12, 0, 12, 0, 12, 0, 7];
  function musicStep(ctx, bus, t, s) {
    var L = LEAD_N[s];
    if (L) tone(ctx, bus.lead, t, "p25", L.f, 0, L.len * STEP * 0.92, 0.10, 0.5);
    if ((s & 1) === 0) {
      var r = note(ROOTS[s >> 4]) * Math.pow(2, BASS_PAT[(s >> 1) & 7] / 12);
      tone(ctx, bus.bass, t, "tri", r, 0, STEP * 1.6, 0.42, 0.6);
    }
    if ((s & 3) === 2) noise(ctx, bus.hat, t, 0.03, 0.05, 2, 0);
    if ((s & 7) === 0) tone(ctx, bus.bass, t, "tri", 160, 45, 0.08, 0.4, 0.1);
  }
  function makeMusicBus(ctx, dest, gain) {
    var g = ctx.createGain(); g.gain.value = gain; g.connect(dest);
    function part(pan, v) {
      var x = ctx.createGain(); x.gain.value = v;
      if (ctx.createStereoPanner) { var p = ctx.createStereoPanner(); p.pan.value = pan; x.connect(p); p.connect(g); }
      else x.connect(g);
      return x;
    }
    return { gain: g, lead: part(-0.2, 1), bass: part(0, 1), hat: part(0.3, 1) };
  }
  function makeMaster(ctx) {
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 6; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
    var m = ctx.createGain(); m.connect(comp); comp.connect(ctx.destination);
    return m;
  }

  /* ---------- живой звук ---------- */
  var ac = null, master = null, sfxBus = null, mus = null, enabled = false, muted = false, nextStep = 0, t0 = 0, timer = null, hint = null;
  function unlock() {
    if (!ac) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = makeMaster(ac);
      sfxBus = ac.createGain(); sfxBus.gain.value = SFX_GAIN; sfxBus.connect(master);
      mus = makeMusicBus(ac, master, MUSIC_GAIN);
    }
    if (ac.state !== "running") ac.resume();
    if (!enabled) {
      enabled = true;
      t0 = ac.currentTime + 0.1; nextStep = 0;
      timer = setInterval(pump, 50); pump();
    }
    updateHint();
  }
  function pump() {
    if (!ac) return;
    var ahead = ac.currentTime + 0.3;
    if (t0 + nextStep * STEP < ac.currentTime) { t0 = ac.currentTime + 0.05; nextStep = 0; } // вкладка спала — начать заново
    while (t0 + nextStep * STEP < ahead) { musicStep(ac, mus, t0 + nextStep * STEP, nextStep % LOOP); nextStep++; }
  }
  function setMuted(m) {
    muted = m;
    if (master) master.gain.setTargetAtTime(m ? 0 : 1, ac.currentTime, 0.02);
    updateHint();
  }
  function play(name) {
    LOG.push({ t: performance.now(), name: name });
    if (!enabled || muted || !ac || ac.state !== "running" || !SOUNDS[name]) return;
    try { SOUNDS[name](ac, sfxBus, ac.currentTime + 0.005); } catch (e) { /* звук не должен ломать игру */ }
  }

  /* ---------- подсказка ---------- */
  var noHint = REC || /nohint/.test(location.search + location.hash);
  function updateHint() {
    if (noHint) return;
    if (!hint) {
      hint = document.createElement("div");
      hint.style.cssText = "position:fixed;right:10px;bottom:8px;z-index:9;pointer-events:none;font:600 13px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;" +
        "color:#fff;background:rgba(0,0,0,.6);padding:5px 9px;border-radius:5px;letter-spacing:.2px";
      (document.body || document.documentElement).appendChild(hint);
    }
    if (!enabled) { hint.textContent = "♪ нажми любую клавишу — звук"; hint.style.display = ""; }
    else if (muted) { hint.textContent = "♪ звук выкл — M"; hint.style.display = ""; }
    else hint.style.display = "none";
  }
  if (document.body) updateHint(); else document.addEventListener("DOMContentLoaded", updateHint);

  window.addEventListener("keydown", function (e) {
    if (e.repeat) return;
    if (!enabled) { unlock(); return; }      // первая клавиша (в т.ч. M) — только включает звук
    if (e.code === "KeyM") setMuted(!muted);
  });
  window.addEventListener("pointerdown", function () { if (!enabled) unlock(); });

  /* ---------- офлайн-рендер по журналу ---------- */
  function toWavBase64(buf) {
    var ch = buf.numberOfChannels, n = buf.length, bytes = 44 + n * ch * 2, ab = new ArrayBuffer(bytes), dv = new DataView(ab);
    function str(o, s) { for (var i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); }
    str(0, "RIFF"); dv.setUint32(4, bytes - 8, true); str(8, "WAVE"); str(12, "fmt ");
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, buf.sampleRate, true);
    dv.setUint32(28, buf.sampleRate * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
    str(36, "data"); dv.setUint32(40, n * ch * 2, true);
    var data = []; for (var c = 0; c < ch; c++) data.push(buf.getChannelData(c));
    var o = 44;
    for (var i = 0; i < n; i++) for (c = 0; c < ch; c++) {
      var s = Math.max(-1, Math.min(1, data[c][i])); dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
    }
    var u8 = new Uint8Array(ab), parts = [];
    for (i = 0; i < u8.length; i += 0x8000) parts.push(String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)));
    return btoa(parts.join(""));
  }
  function renderSfx(logs, durationSec, opts) {
    opts = opts || {};
    var sr = 44100, dur = Math.max(0.1, +durationSec || 10);
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var ctx = new OAC(2, Math.ceil(dur * sr), sr);
    var m = makeMaster(ctx);
    var sb = ctx.createGain(); sb.gain.value = SFX_GAIN * (opts.sfxGain == null ? 1 : opts.sfxGain); sb.connect(m);
    var pans = {};
    function busFor(pan) {
      if (pan == null) pan = opts.pan;
      if (!pan || !ctx.createStereoPanner) return sb;
      if (!pans[pan]) { var pn = ctx.createStereoPanner(); pn.pan.value = Math.max(-1, Math.min(1, pan)); pn.connect(sb); pans[pan] = pn; }
      return pans[pan];
    }
    var ev = [].concat.apply([], (logs || LOG).map(function (x) { return Array.isArray(x) ? x : [x]; }));
    var off = +opts.offsetMs || 0, used = 0;
    for (var i = 0; i < ev.length; i++) {
      var t = (ev[i].t - off) / 1000;
      if (t >= 0 && t < dur && SOUNDS[ev[i].name]) { SOUNDS[ev[i].name](ctx, busFor(ev[i].pan), t); used++; }
    }
    if (opts.music !== false) {
      var mb = makeMusicBus(ctx, m, MUSIC_GAIN * (opts.musicGain == null ? 1 : opts.musicGain));
      for (var s = 0; s * STEP < dur; s++) musicStep(ctx, mb, s * STEP, s % LOOP);
    }
    return ctx.startRendering().then(function (buf) { renderSfx.lastUsed = used; return toWavBase64(buf); });
  }

  window.__renderSfx = renderSfx;
  window.__SFX = { play: play, unlock: unlock, mute: setMuted, render: renderSfx, names: Object.keys(SOUNDS) };
})();
