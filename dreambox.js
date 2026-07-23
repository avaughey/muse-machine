// DreamBox — a fully offline generative jam engine. Everything here is
// synthesized in the browser with the Web Audio API: no network, no keys.
import { sky } from "./sky.js";

const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* ================= vibes (presets) ================= */
// Chords are semitone offsets from the chosen root.
const VIBES = {
  "☁️ Cloud Drift": {
    bpm: 74, swing: 10, density: 45, dream: 85, chaos: 25,
    prog: [[0, 4, 7, 14], [5, 9, 12, 16], [9, 12, 16, 19], [7, 11, 14, 17]], // Imaj9 IVmaj7 vi7 V
    arpWave: "triangle", bassWave: "sine", crackle: 0.012,
    kick: [0], snare: [], hat: [4, 12], octave: 0,
  },
  "🌇 Sunset Drive": {
    bpm: 100, swing: 6, density: 70, dream: 55, chaos: 30,
    prog: [[0, 3, 7, 10], [8, 12, 15, 19], [3, 7, 10, 14], [10, 14, 17, 20]], // i7 VI III VII
    arpWave: "sawtooth", bassWave: "triangle", crackle: 0,
    kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], octave: 0,
  },
  "👾 Pixel Arcade": {
    bpm: 128, swing: 0, density: 85, dream: 30, chaos: 45,
    prog: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], // I V vi IV
    arpWave: "square", bassWave: "square", crackle: 0,
    kick: [0, 4, 8, 12], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], octave: 12,
  },
  "🌧 Rainy Window": {
    bpm: 84, swing: 30, density: 55, dream: 75, chaos: 35,
    prog: [[2, 5, 9, 12], [7, 11, 14, 17], [0, 4, 7, 11], [9, 12, 16, 19]], // ii7 V7 Imaj7 vi7
    arpWave: "triangle", bassWave: "sine", crackle: 0.02,
    kick: [0, 7, 8], snare: [4, 12], hat: [2, 6, 10, 14], octave: 0,
  },
};

const LAYERS = ["DRUMS", "BASS", "ARP", "PAD", "CRACKLE"];
const mutes = Object.fromEntries(LAYERS.map((l) => [l, false]));
let vibeName = "☁️ Cloud Drift";
const vibe = () => VIBES[vibeName];

/* ================= audio graph ================= */

let ctx = null, master, analyser, reverb, revSend, delay, delSend, crackleGain;

function makeImpulse(seconds) {
  const len = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++)
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
  }
  return buf;
}

function ensureAudio() {
  if (ctx) return;
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = 0.9;
  analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  master.connect(analyser);
  analyser.connect(ctx.destination);

  reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(2.8);
  revSend = ctx.createGain();
  revSend.connect(reverb);
  reverb.connect(master);

  delay = ctx.createDelay(2);
  const fb = ctx.createGain();
  fb.gain.value = 0.35;
  const delFilter = ctx.createBiquadFilter();
  delFilter.type = "lowpass";
  delFilter.frequency.value = 2200;
  delSend = ctx.createGain();
  delSend.connect(delay);
  delay.connect(delFilter);
  delFilter.connect(fb);
  fb.connect(delay);
  delFilter.connect(master);

  // vinyl crackle: filtered noise + random pops, gated by the CRACKLE layer
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) {
    nd[i] = (Math.random() * 2 - 1) * 0.3;
    if (Math.random() < 0.0004) nd[i] = (Math.random() * 2 - 1) * 4; // pops
  }
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuf;
  noise.loop = true;
  const nf = ctx.createBiquadFilter();
  nf.type = "highpass";
  nf.frequency.value = 1800;
  crackleGain = ctx.createGain();
  crackleGain.gain.value = 0;
  noise.connect(nf);
  nf.connect(crackleGain);
  crackleGain.connect(master);
  noise.start();
}

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const params = () => ({
  bpm: +$("dbBpm").value,
  swing: +$("dbSwing").value / 100,
  density: +$("dbDensity").value / 100,
  dream: +$("dbDream").value / 100,
  chaos: +$("dbChaos").value / 100,
  root: 48 + +$("dbKey").value,
});

/* ================= voices ================= */

function env(g, t, a, peak, d, sustain = 0) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t + a + d);
}

function pluck(t, midi, wave, gain, cutoff, send = 0.3) {
  const o = ctx.createOscillator();
  o.type = wave;
  o.frequency.value = midiHz(midi);
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = cutoff;
  const g = ctx.createGain();
  env(g, t, 0.005, gain, 0.28);
  o.connect(f); f.connect(g);
  g.connect(master);
  const s = ctx.createGain();
  s.gain.value = send;
  g.connect(s); s.connect(delSend); s.connect(revSend);
  o.start(t); o.stop(t + 0.6);
}

function padChord(t, dur, offsets, p) {
  if (mutes.PAD) return;
  const cutoff = 400 + p.dream * 2600;
  for (const off of offsets) {
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = midiHz(p.root + 12 + off);
      o.detune.value = det + rand(-3, 3);
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(cutoff * 0.6, t);
      f.frequency.linearRampToValueAtTime(cutoff, t + dur * 0.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.05 + p.dream * 0.03, t + dur * 0.3);
      g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.05);
      o.connect(f); f.connect(g); g.connect(master);
      const s = ctx.createGain();
      s.gain.value = 0.5 + p.dream * 0.4;
      g.connect(s); s.connect(revSend);
      o.start(t); o.stop(t + dur * 1.1);
    }
  }
}

function kick(t) {
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  const g = ctx.createGain();
  env(g, t, 0.002, 0.85, 0.24);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + 0.3);
}

function snare(t, p) {
  const len = ctx.sampleRate * 0.2;
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = b;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = 1800;
  const g = ctx.createGain();
  env(g, t, 0.001, 0.4, 0.15);
  src.connect(f); f.connect(g); g.connect(master);
  const s = ctx.createGain();
  s.gain.value = 0.2 + p.dream * 0.4;
  g.connect(s); s.connect(revSend);
  src.start(t);
}

function hat(t, open = false) {
  const len = ctx.sampleRate * (open ? 0.25 : 0.05);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = b;
  const f = ctx.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = 7500;
  const g = ctx.createGain();
  env(g, t, 0.001, 0.16, open ? 0.2 : 0.04);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t);
}

/* ================= groove matrix ================= */

let matrix = null;

function rollGroove() {
  const v = vibe();
  const p = params();
  const on = (base, prob) => base || Math.random() < prob;
  const m = { kick: [], snare: [], hat: [], bass: [], arp: [] };
  for (let s = 0; s < 16; s++) {
    m.kick[s] = on(v.kick.includes(s), s % 4 === 0 ? 0 : p.density * 0.08);
    m.snare[s] = on(v.snare.includes(s), p.density * 0.04);
    m.hat[s] = on(v.hat.includes(s), p.density * 0.3);
    m.bass[s] = s % 8 === 0 || Math.random() < p.density * 0.25;
    m.arp[s] = Math.random() < 0.25 + p.density * 0.6 ? Math.floor(rand(0, 4)) : null;
  }
  matrix = m;
  paintGrid();
}

/* ================= scheduler ================= */

let running = false, step = 0, bar = 0, nextTime = 0, timer = null;

function scheduleStep(s, t, p) {
  const v = vibe();
  const chord = v.prog[bar % v.prog.length];
  if (!mutes.DRUMS) {
    if (matrix.kick[s]) kick(t);
    if (matrix.snare[s]) snare(t, p);
    if (matrix.hat[s]) hat(t, p.chaos > 0.6 && Math.random() < 0.15);
  }
  if (!mutes.BASS && matrix.bass[s]) {
    const oct = Math.random() < p.chaos * 0.3 ? 12 : 0;
    pluck(t, p.root - 12 + chord[0] + oct, v.bassWave, 0.5, 900, 0.05);
  }
  if (!mutes.ARP && matrix.arp[s] !== null) {
    let idx = matrix.arp[s];
    if (Math.random() < p.chaos) idx = Math.floor(rand(0, chord.length));
    const oct = Math.random() < p.chaos * 0.5 ? 24 : 12;
    const note = p.root + oct + v.octave + chord[idx % chord.length];
    pluck(t, note, v.arpWave, 0.16 + rand(0, 0.06), 800 + p.dream * 3800, 0.35 + p.dream * 0.4);
  }
  if (s === 0) {
    const barDur = (60 / p.bpm) * 4;
    padChord(t, barDur, chord, p);
  }
  // LED playhead + status pulse, timed to the audio clock
  const delayMs = Math.max(0, (t - ctx.currentTime) * 1000);
  setTimeout(() => { if (running) paintGrid(s); }, delayMs);
}

function tick() {
  const p = params();
  const stepDur = 60 / p.bpm / 4;
  while (nextTime < ctx.currentTime + 0.12) {
    const swung = nextTime + (step % 2 === 1 ? p.swing * stepDur * 0.55 : 0);
    scheduleStep(step, swung, p);
    nextTime += stepDur;
    step = (step + 1) % 16;
    if (step === 0) {
      bar++;
      if (Math.random() < 0.3) rollGroove(); // grooves evolve on their own
    }
  }
  timer = setTimeout(tick, 25);
}

/* ================= UI ================= */

const grid = $("dbGrid");
const cells = [];
function buildGrid() {
  const rows = ["kick", "snare", "hat", "bass", "arp"];
  for (let r = 0; r < rows.length; r++) {
    cells[r] = [];
    for (let s = 0; s < 16; s++) {
      const c = document.createElement("span");
      c.className = "db-cell";
      grid.appendChild(c);
      cells[r][s] = c;
    }
  }
}

function paintGrid(playhead = -1) {
  if (!matrix) return;
  const rows = [matrix.kick, matrix.snare, matrix.hat, matrix.bass, matrix.arp];
  for (let r = 0; r < rows.length; r++)
    for (let s = 0; s < 16; s++) {
      const c = cells[r][s];
      c.className = "db-cell"
        + (rows[r][s] !== null && rows[r][s] !== false ? " on" : "")
        + (s === playhead ? " now" : "")
        + (s % 4 === 0 ? " beat" : "");
    }
}

function buildVibes() {
  for (const name of Object.keys(VIBES)) {
    const b = document.createElement("button");
    b.className = "db-vibe" + (name === vibeName ? " active" : "");
    b.textContent = name;
    b.addEventListener("click", () => {
      vibeName = name;
      document.querySelectorAll(".db-vibe").forEach((x) => x.classList.toggle("active", x === b));
      const v = vibe();
      $("dbBpm").value = v.bpm; $("dbSwing").value = v.swing;
      $("dbDensity").value = v.density; $("dbDream").value = v.dream; $("dbChaos").value = v.chaos;
      syncOuts();
      if (crackleGain) crackleGain.gain.value = mutes.CRACKLE ? 0 : v.crackle;
      rollGroove();
    });
    $("dbVibes").appendChild(b);
  }
}

function buildLayers() {
  for (const l of LAYERS) {
    const b = document.createElement("button");
    b.className = "db-layer active";
    b.textContent = l;
    b.addEventListener("click", () => {
      mutes[l] = !mutes[l];
      b.classList.toggle("active", !mutes[l]);
      if (l === "CRACKLE" && crackleGain)
        crackleGain.gain.value = mutes.CRACKLE ? 0 : vibe().crackle;
    });
    $("dbLayers").appendChild(b);
  }
}

const outs = [["dbBpm", "dbBpmOut", (v) => v], ["dbSwing", "dbSwingOut", (v) => (v / 100).toFixed(1)],
  ["dbDensity", "dbDensityOut", (v) => (v / 100).toFixed(1)], ["dbDream", "dbDreamOut", (v) => (v / 100).toFixed(1)],
  ["dbChaos", "dbChaosOut", (v) => (v / 100).toFixed(1)]];
function syncOuts() { for (const [id, out, f] of outs) $(out).textContent = f(+$(id).value); }
for (const [id] of outs) $(id).addEventListener("input", syncOuts);
$("dbDensity").addEventListener("change", rollGroove);

const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));

// "last click wins" — track who claimed the speakers most recently
let floorOwner = null;
document.addEventListener("engine-start", (e) => { floorOwner = e.detail; });

$("dbPlay").addEventListener("click", async () => {
  emit("engine-start", "dreambox"); // claim the floor before any async setup
  ensureAudio();
  await ctx.resume();
  if (floorOwner !== "dreambox") return; // another engine grabbed it mid-await
  if (!matrix) rollGroove();
  crackleGain.gain.value = mutes.CRACKLE ? 0 : vibe().crackle;
  running = true;
  step = 0; bar = 0;
  nextTime = ctx.currentTime + 0.06;
  tick();
  sky.attachAnalyser(analyser);
  sky.fly(true);
  $("dbStatus").textContent = "● playing — 100% local";
  $("dbStatus").classList.add("live");
  $("dbPlay").disabled = true;
  $("dbStop").disabled = false;
});

function stopDreamBox() {
  if (!running) return;
  running = false;
  clearTimeout(timer);
  if (crackleGain) crackleGain.gain.value = 0;
  sky.fly(false);
  emit("engine-stop", "dreambox");
  $("dbStatus").textContent = "standby";
  $("dbStatus").classList.remove("live");
  $("dbPlay").disabled = false;
  $("dbStop").disabled = true;
  paintGrid();
}
$("dbStop").addEventListener("click", stopDreamBox);

// one sound at a time: stand down when any other engine starts
document.addEventListener("engine-start", (e) => { if (e.detail !== "dreambox") stopDreamBox(); });
document.addEventListener("stop-all", stopDreamBox);

$("dbDice").addEventListener("click", rollGroove);

buildGrid();
buildVibes();
buildLayers();
syncOuts();
rollGroove();
