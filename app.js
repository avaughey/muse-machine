import { GoogleGenAI } from "https://esm.run/@google/genai";
import { DECKS, DARES, SEEDS } from "./decks.js?v=2";
import { sky } from "./sky.js";
import { addTrack, allTracks, deleteTrack } from "./tracks.js";

const $ = (id) => document.getElementById(id);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));

// Whoever claimed the floor last owns the speakers ("last click wins").
let floorOwner = null;
document.addEventListener("engine-start", (e) => { floorOwner = e.detail; });

/* ================= Spark Deck ================= */

const cardState = {};

function rollCard(cat, el) {
  let val = pick(DECKS[cat]);
  while (DECKS[cat].length > 1 && val === cardState[cat]) val = pick(DECKS[cat]);
  cardState[cat] = val;
  const valEl = el.querySelector(".val");
  el.classList.remove("flip");
  void el.offsetWidth; // restart the flip animation
  el.classList.add("flip");
  valEl.textContent = val;
  refreshVibeStrip();
}

function buildCards() {
  const grid = $("cardGrid");
  for (const cat of Object.keys(DECKS)) {
    const el = document.createElement("div");
    el.className = "spark-card";
    el.innerHTML = `<span class="hint">🎲</span><div class="cat">${cat}</div><div class="val"></div>`;
    el.addEventListener("click", () => rollCard(cat, el));
    grid.appendChild(el);
    rollCard(cat, el);
  }
}

function rollConstraint() { $("constraintText").textContent = pick(DARES); refreshVibeStrip(); }
function rollSeed() { $("seedText").textContent = pick(SEEDS); }

$("rollAll").addEventListener("click", () => {
  document.querySelectorAll(".spark-card").forEach((el) =>
    rollCard(el.querySelector(".cat").textContent, el));
  rollConstraint();
  rollSeed();
});
$("rollConstraint").addEventListener("click", rollConstraint);
$("rollSeed").addEventListener("click", rollSeed);

/* ================= API key ================= */

const keyInput = $("apiKey");

/* ---- per-person workspaces (Sign in with Google keeps them apart) ---- */
// To enable the Sign in button: create an OAuth Web client ID in Google Cloud
// console and set it here (or via localStorage "muse.gclientid" for testing).
const GOOGLE_CLIENT_ID = localStorage.getItem("muse.gclientid") || "";

let currentUser = JSON.parse(localStorage.getItem("muse.session") || "null");
const userScope = () => (currentUser ? "u:" + currentUser.sub : "guest");
const store = {
  get(k) {
    const v = localStorage.getItem(`muse.${userScope()}.${k}`);
    if (v !== null) return v;
    return userScope() === "guest" ? localStorage.getItem("muse." + k) : null; // pre-signin data
  },
  set(k, v) { localStorage.setItem(`muse.${userScope()}.${k}`, v); },
};

function keySaved(len) {
  const el = $("keyStatus");
  el.className = "key-status" + (len ? " ok" : "");
  el.textContent = len ? "pass saved ✓" : "no pass yet";
  document.body.classList.toggle("has-key", !!len); // mobile collapses the pass bar
  $("inviteBtn").classList.toggle("hidden", !len);
}
$("keyToggle").addEventListener("click", () => document.body.classList.toggle("show-key"));
keyInput.addEventListener("input", () => {
  store.set("key", keyInput.value.trim());
  ai = null; // force re-auth with the new pass
  keySaved(keyInput.value.trim().length);
});
const getKey = () => keyInput.value.trim();

/* ---- Music Pass wizard + family invite links ---- */
$("getPass").addEventListener("click", () => $("passWizard").classList.remove("hidden"));
$("wizardClose").addEventListener("click", () => $("passWizard").classList.add("hidden"));

$("inviteBtn").addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}#pass=${btoa(getKey())}`;
  await navigator.clipboard.writeText(url).catch(() => {});
  $("dockStatus").textContent =
    "🎁 invite link copied — send it to family you trust; the app sets itself up when they open it";
});

// an invite link sets the pass automatically — grandma just taps it
if (location.hash.startsWith("#pass=")) {
  try {
    const pass = atob(location.hash.slice(6));
    if (pass) {
      store.set("key", pass);
      history.replaceState(null, "", location.pathname + location.search);
      setTimeout(() => { $("dockStatus").textContent = "🎉 you're in — your Music Pass is set. Try the Sing tab!"; }, 300);
    }
  } catch {}
}

/* ---- Sign in with Google (identity only — keeps each person's stuff separate) ---- */
function applyUserState() {
  keyInput.value = store.get("key") || "";
  keySaved(keyInput.value.length);
  ai = null;
  lyricsBox.value = store.get("lyrics") || "";
  retentionSel.value = store.get("retention") || "7d";
  const chip = $("userChip");
  if (currentUser) {
    chip.classList.remove("hidden");
    $("gsiBtn").classList.add("hidden");
    $("userPic").src = currentUser.picture || "";
    $("userName").textContent = currentUser.given_name || currentUser.name || "you";
  } else {
    chip.classList.add("hidden");
    $("gsiBtn").classList.remove("hidden");
  }
  renderHistory();
}

function initGoogleSignIn() {
  if (!GOOGLE_CLIENT_ID || inApp) { $("accountArea").classList.add("hidden"); return; }
  if (!window.google?.accounts?.id) { setTimeout(initGoogleSignIn, 500); return; }
  window.google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (resp) => {
      const p = JSON.parse(atob(resp.credential.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      currentUser = { sub: p.sub, name: p.name, given_name: p.given_name, picture: p.picture };
      localStorage.setItem("muse.session", JSON.stringify(currentUser));
      applyUserState();
    },
  });
  window.google.accounts.id.renderButton($("gsiBtn"), { type: "standard", size: "medium", shape: "pill" });
}
$("signOut").addEventListener("click", () => {
  currentUser = null;
  localStorage.removeItem("muse.session");
  window.google?.accounts?.id?.disableAutoSelect?.();
  applyUserState();
});

let ai = null;
function client() {
  if (!getKey()) throw new Error("You need a Music Pass first — tap “get a free pass” at the top of the page (or use a family invite link).");
  if (!ai) ai = new GoogleGenAI({ apiKey: getKey(), apiVersion: "v1alpha" });
  return ai;
}

/* ================= AI lyric sparks (Gemini text) ================= */

$("aiSparkBtn").addEventListener("click", async () => {
  const out = $("aiSparkOut");
  out.classList.remove("hidden");
  out.textContent = "summoning sparks…";
  try {
    const vibe = Object.entries(cardState).map(([k, v]) => `${k}: ${v}`).join(", ");
    const prompt =
      `You are a songwriting spark generator for someone with writer's block. ` +
      `Current vibe — ${vibe}. Creative dare: "${$("constraintText").textContent}". ` +
      `Seed line: "${$("seedText").textContent}".\n` +
      `Give exactly: (1) a one-sentence song concept, (2) three possible opening lines, ` +
      `(3) one left-field production idea. Punchy, evocative, no preamble, no markdown headers.`;
    const resp = await client().models.generateContent({
      model: "gemini-flash-latest",
      contents: prompt,
      config: { temperature: 1.2 },
    });
    out.textContent = resp.text;
  } catch (e) {
    out.textContent = "⚠ " + (e.message || e);
  }
});

/* ================= PCM stream player ================= */

// Safari needs the webkit prefix on older versions; iPhone Lockdown Mode
// removes Web Audio entirely — explain instead of "can't find variable".
function audioContextClass() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error(
    "This browser blocks Web Audio — on iPhone that's usually Lockdown Mode. " +
    "In Safari: tap aA (or ⋯) in the address bar → Website Settings → turn OFF " +
    "Lockdown Mode for this site, then reload. (The Sing tab still works without it.)");
  return AC;
}

class PcmPlayer {
  constructor() {
    const AC = audioContextClass();
    this.ctx = new AC({ sampleRate: 48000 });
    this.gain = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.gain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.nextTime = 0;
    this.sources = new Set();
  }
  push(base64) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const pcm = new Int16Array(bytes.buffer);
    const frames = pcm.length / 2;
    const buf = this.ctx.createBuffer(2, frames, 48000);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    for (let i = 0; i < frames; i++) {
      L[i] = pcm[2 * i] / 32768;
      R[i] = pcm[2 * i + 1] / 32768;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
    const now = this.ctx.currentTime;
    if (this.nextTime < now + 0.05) this.nextTime = now + 0.4; // (re)buffer lead-in
    src.start(this.nextTime);
    this.nextTime += buf.duration;
  }
  flush() {
    for (const s of this.sources) { try { s.stop(); } catch {} }
    this.sources.clear();
    this.nextTime = 0;
  }
}

let player = null;

/* ================= visualizer ================= */

function drawViz() {
  const canvas = $("viz");
  const g = canvas.getContext("2d");
  const render = () => {
    requestAnimationFrame(render);
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (!player) return;
    const data = new Uint8Array(player.analyser.frequencyBinCount);
    player.analyser.getByteFrequencyData(data);
    const bw = canvas.width / data.length;
    for (let i = 0; i < data.length; i++) {
      const h = (data[i] / 255) * canvas.height;
      const hue = (i / data.length) * 300;
      g.fillStyle = `hsl(${hue} 80% 72%)`;
      g.fillRect(i * bw, canvas.height - h, bw - 1, h);
    }
  };
  render();
}
drawViz();

/* ================= prompt mixer ================= */

function addPromptRow(text = "", weight = 1.0) {
  const row = document.createElement("div");
  row.className = "prompt-row";
  row.innerHTML = `
    <input type="text" placeholder="e.g. dreamy synthwave" value="">
    <input type="range" min="1" max="200" value="${Math.round(weight * 100)}" title="weight">
    <button class="del" title="remove">✕</button>`;
  row.querySelector('input[type="text"]').value = text;
  row.querySelector(".del").addEventListener("click", () => { row.remove(); steer(); });
  row.querySelectorAll("input").forEach((el) => el.addEventListener("input", steerSoon));
  $("promptList").appendChild(row);
  return row;
}

function readPrompts() {
  return [...document.querySelectorAll(".prompt-row")]
    .map((row) => ({
      text: row.querySelector('input[type="text"]').value.trim(),
      weight: Number(row.querySelector('input[type="range"]').value) / 100,
    }))
    .filter((p) => p.text);
}

$("addPrompt").addEventListener("click", () => addPromptRow());

/* Spark Deck → Jam */
$("sendToJam").addEventListener("click", () => {
  $("promptList").innerHTML = "";
  addPromptRow(cardState["GENRE"], 1.4);
  addPromptRow(cardState["MOOD"], 1.0);
  addPromptRow(cardState["LEAD INSTRUMENT"], 1.0);
  addPromptRow(`${cardState["TEXTURE"]}, ${cardState["ERA"]}`, 0.7);
  steerSoon();
  emit("goto-view", "jam");
});

/* ================= knobs ================= */

const knobDefs = [
  ["bpm", "bpmOut", (v) => v],
  ["density", "densityOut", (v) => (v / 100).toFixed(2)],
  ["brightness", "brightOut", (v) => (v / 100).toFixed(2)],
  ["temperature", "tempOut", (v) => (v / 100).toFixed(1)],
];
for (const [id, outId, fmt] of knobDefs) {
  $(id).addEventListener("input", () => {
    $(outId).textContent = fmt(Number($(id).value));
    steerSoon();
  });
}
$("scale").addEventListener("change", steerSoon);

function readConfig() {
  return {
    bpm: Number($("bpm").value),
    density: Number($("density").value) / 100,
    brightness: Number($("brightness").value) / 100,
    temperature: Number($("temperature").value) / 100,
    scale: $("scale").value,
  };
}

/* ================= Lyria session ================= */

let session = null;
let playing = false;
let lastHardConfig = "";

function setStatus(cls, text) {
  const el = $("status");
  el.className = "status " + cls;
  el.textContent = text;
}

function log(msg) {
  const el = $("log");
  el.insertAdjacentHTML("beforeend", `<div>${new Date().toLocaleTimeString()} · ${msg}</div>`);
  el.scrollTop = el.scrollHeight;
}

async function connect() {
  setStatus("busy", "connecting…");
  log("opening Lyria RealTime session…");
  session = await client().live.music.connect({
    model: "models/lyria-realtime-exp",
    callbacks: {
      onmessage: (msg) => {
        if (msg.setupComplete) log("session ready");
        if (msg.filteredPrompt)
          log(`⚠ prompt filtered: "${msg.filteredPrompt.text}" (${msg.filteredPrompt.filteredReason || "policy"})`);
        const chunks = msg.serverContent?.audioChunks;
        if (chunks && player) for (const c of chunks) player.push(c.data);
      },
      onerror: (e) => { setStatus("error", "error"); log("⚠ " + (e?.message || "stream error")); sky.fly(false); emit("engine-stop", "lyria"); },
      onclose: () => { if (playing) { setStatus("idle", "closed"); log("session closed"); sky.fly(false); emit("engine-stop", "lyria"); } },
    },
  });
}

async function pushState({ hard = false } = {}) {
  const prompts = readPrompts();
  if (!prompts.length) throw new Error("Add at least one prompt (or send a vibe from the Spark Deck).");
  await session.setWeightedPrompts({ weightedPrompts: prompts });
  await session.setMusicGenerationConfig({ musicGenerationConfig: readConfig() });
  if (hard && typeof session.resetContext === "function") {
    await session.resetContext(); // bpm/scale only take effect after a context reset
    log("groove restarted (bpm/scale change)");
  }
}

const hardKeys = () => JSON.stringify([$("bpm").value, $("scale").value]);

let steerTimer = null;
function steerSoon() { clearTimeout(steerTimer); steerTimer = setTimeout(steer, 350); }
async function steer() {
  if (!session || !playing) return;
  try {
    const hard = hardKeys() !== lastHardConfig;
    lastHardConfig = hardKeys();
    await pushState({ hard });
  } catch (e) { log("⚠ " + e.message); }
}

$("playBtn").addEventListener("click", async () => {
  try {
    if (!player) player = new PcmPlayer();
    await player.ctx.resume();
    sky.attachAnalyser(player.analyser);
    emit("engine-start", "lyria"); // claim the floor before the slow connect
    if (!session) await connect();
    lastHardConfig = hardKeys();
    await pushState();
    await session.play();
    if (floorOwner !== "lyria") { // someone else grabbed the speakers mid-connect
      try { await session.pause(); } catch {}
      player?.flush();
      return;
    }
    playing = true;
    sky.fly(true);
    setStatus("live", "● LIVE");
    log("playing — tweak knobs & weights to steer the music");
    $("playBtn").disabled = true;
    $("pauseBtn").disabled = false;
    $("stopBtn").disabled = false;
  } catch (e) {
    setStatus("error", "error");
    log("⚠ " + (e.message || e));
    emit("engine-stop", "lyria");
  }
});

$("pauseBtn").addEventListener("click", async () => {
  if (!session) return;
  await session.pause();
  player?.flush();
  playing = false;
  sky.fly(false);
  emit("engine-stop", "lyria");
  setStatus("idle", "paused");
  $("playBtn").disabled = false;
  $("pauseBtn").disabled = true;
});

$("stopBtn").addEventListener("click", async () => {
  if (!session) return;
  playing = false;
  sky.fly(false);
  emit("engine-stop", "lyria");
  try { await session.stop(); } catch {}
  player?.flush();
  setStatus("idle", "stopped");
  log("stopped");
  $("playBtn").disabled = false;
  $("pauseBtn").disabled = true;
  $("stopBtn").disabled = true;
});

/* ================= Lyric Pad ================= */

const lyricsBox = $("lyricsBox");
lyricsBox.addEventListener("input", () => store.set("lyrics", lyricsBox.value));

function refreshVibeStrip() {
  const strip = $("vibeStrip");
  strip.innerHTML = "";
  for (const val of Object.values(cardState)) {
    const chip = document.createElement("span");
    chip.className = "vibe-chip";
    chip.textContent = val;
    strip.appendChild(chip);
  }
  const dare = document.createElement("span");
  dare.className = "vibe-chip dare";
  dare.textContent = "⚡ " + $("constraintText").textContent;
  strip.appendChild(dare);
}

function appendLine(text) {
  const cur = lyricsBox.value;
  lyricsBox.value = cur + (cur && !cur.endsWith("\n") ? "\n" : "") + text + "\n";
  lyricsBox.dispatchEvent(new Event("input"));
  lyricsBox.scrollTop = lyricsBox.scrollHeight;
}

$("insertSeed").addEventListener("click", () => appendLine($("seedText").textContent));

function showSuggestions(lines, hint) {
  const out = $("suggestOut");
  out.classList.remove("hidden");
  out.innerHTML = `<div class="sugg-hint">${hint} — CLICK A LINE TO ADD IT</div>`;
  for (const line of lines) {
    const b = document.createElement("button");
    b.className = "sugg";
    b.textContent = line;
    b.addEventListener("click", () => appendLine(line));
    out.appendChild(b);
  }
}

async function suggest(kind) {
  const out = $("suggestOut");
  out.classList.remove("hidden");
  out.textContent = "thinking…";
  try {
    const vibe = Object.values(cardState).join(", ");
    const draft = lyricsBox.value.trim();
    const lastLine = draft.split("\n").filter((l) => l.trim() && !l.trim().startsWith("[")).pop() || "";
    const ask = kind === "rhymes"
      ? `The last lyric line is: "${lastLine}". Suggest 6 short follow-up lines that rhyme or near-rhyme with it, matching the vibe.`
      : `Continue these lyrics with 4 candidate next lines (varied directions, not a sequence).`;
    const resp = await client().models.generateContent({
      model: "gemini-flash-latest",
      contents:
        `You are a lyric co-writer. Vibe: ${vibe}. Creative dare: "${$("constraintText").textContent}".\n` +
        `Draft so far:\n${draft || "(blank page)"}\n\n${ask}\n` +
        `Return ONLY the lines, one per line, no numbering, no quotes, no commentary.`,
      config: { temperature: 1.25 },
    });
    const lines = resp.text.split("\n").map((l) => l.trim()).filter((l) => l && l.length < 90);
    showSuggestions(lines.slice(0, 6), kind === "rhymes" ? "RHYME IDEAS" : "NEXT-LINE IDEAS");
  } catch (e) {
    out.textContent = "⚠ " + (e.message || e);
  }
}
$("nextLines").addEventListener("click", () => suggest("next"));
$("rhymeHelp").addEventListener("click", () => suggest("rhymes"));

/* ================= Song Studio (Lyria 3 — sung vocals) ================= */

function setStudioStatus(cls, text) {
  const el = $("studioStatus");
  el.className = "status " + cls;
  el.textContent = text;
}

$("styleFromVibe").addEventListener("click", () => {
  $("songStyle").value =
    `${cardState["GENRE"]}, ${cardState["MOOD"]}, featuring ${cardState["LEAD INSTRUMENT"]}, ` +
    `${cardState["TEXTURE"]}, ${cardState["ERA"]} feel`;
});

// The live API nests results in steps[].content[] (docs show output_audio) — check both.
function findAudio(j) {
  const cands = [j.output_audio, j.outputAudio];
  for (const o of [].concat(j.output || j.outputs || [], j.steps || [])) {
    cands.push(o?.audio, (o?.type || "").includes("audio") ? o : null);
    for (const p of [].concat(o?.content || o?.parts || []))
      cands.push(p?.audio, p?.inline_data, p?.inlineData, p?.type === "audio" ? p : null);
  }
  return cands.find((c) => c?.data) || null;
}

function findText(j) {
  if (j.output_text || j.outputText) return j.output_text || j.outputText;
  for (const o of [].concat(j.output || j.outputs || [], j.steps || []))
    for (const p of [].concat(o?.content || o?.parts || []))
      if (typeof p?.text === "string" && p.text !== "<instrumental>") return p.text;
  return "";
}

const vibeStyleString = () =>
  `${cardState["GENRE"]}, ${cardState["MOOD"]}, featuring ${cardState["LEAD INSTRUMENT"]}, ` +
  `${cardState["TEXTURE"]}, ${cardState["ERA"]} feel, around ${$("bpm").value} BPM`;

// dropdown wins; "rolled voice" falls back to the VOICE card in the deck
const vocalChoice = () => {
  const v = $("vocalStyle").value;
  if (v === "instrumental") return "instrumental, no vocals";
  return v || cardState["VOICE"];
};

$("rollVoice").addEventListener("click", () => {
  const sel = $("vocalStyle");
  const real = [...sel.options].filter((o) => o.value !== "" && o.value !== "instrumental");
  let next = sel.value;
  while (next === sel.value) next = real[Math.floor(Math.random() * real.length)].value;
  sel.value = next;
  sel.classList.remove("flip");
  void sel.offsetWidth;
  sel.classList.add("flip");
});

let singing = false; // one song render at a time — the API isn't a jukebox

async function performSing(style, lyrics, statusVerb = "singing") {
  if (singing) return;
  try {
    if (!getKey()) throw new Error("You need a Music Pass first — tap “get a free pass” up top, or use a family invite link.");
    if (!style && !lyrics) throw new Error("Give it a style, some lyrics, or both.");
    singing = true;
    $("singBtn").disabled = true;
    $("ideaSing").disabled = true;
    const started = Date.now();
    const tick = setInterval(() =>
      setStudioStatus("busy", `${statusVerb}… ${Math.round((Date.now() - started) / 1000)}s`), 1000);
    setStudioStatus("busy", `${statusVerb}…`);
    try {
      const model = document.querySelector('input[name="songLen"]:checked').value;
      const input = [style, lyrics ? `Lyrics:\n${lyrics}` : ""].filter(Boolean).join("\n\n");
      const resp = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: { "x-goog-api-key": getKey(), "Content-Type": "application/json" },
        body: JSON.stringify({ model, input }),
      });
      if (!resp.ok) {
        const detail = (await resp.text()).slice(0, 300);
        throw new Error(`Lyria 3 said ${resp.status} — ${detail}`);
      }
      const j = await resp.json();
      const audio = findAudio(j);
      if (!audio) throw new Error("No audio came back: " + JSON.stringify(j).slice(0, 200));
      const mime = audio.mime_type || audio.mimeType || "audio/mpeg";
      const url = `data:${mime};base64,${audio.data}`;
      $("songAudio").src = url;
      $("songOut").classList.remove("hidden");
      const sungText = findText(j);
      if (sungText) {
        const lp = $("studioLyrics");
        lp.classList.remove("hidden");
        lp.textContent = "What it sang:\n" + sungText;
      }
      // remember it — history survives reloads, retention policy prunes it
      currentTrack = {
        id: String(Date.now()),
        ts: Date.now(),
        owner: userScope(),
        style,
        model,
        mime,
        data: audio.data,
        lyrics: sungText || lyrics || "",
      };
      await addTrack(currentTrack).catch((e) => {
        // storage refusals (private browsing, full disk) must not be silent
        $("dockStatus").textContent = "⚠ couldn't save to track history: " + (e?.message || e);
      });
      renderHistory();
      setStudioStatus("live", "♪ done");
      $("songAudio").play().catch(() => {});
    } finally {
      clearInterval(tick);
    }
  } catch (e) {
    setStudioStatus("error", "error");
    const lp = $("studioLyrics");
    lp.classList.remove("hidden");
    lp.textContent = "⚠ " + (e.message || e);
  } finally {
    singing = false;
    $("singBtn").disabled = false;
    $("ideaSing").disabled = false;
  }
}

$("singBtn").addEventListener("click", () =>
  performSing(
    [$("songStyle").value.trim(), vocalChoice()].filter(Boolean).join(", "),
    lyricsBox.value.trim()));

/* idea → full lyrics → sung song, one button */
$("ideaSing").addEventListener("click", async () => {
  if (singing) return;
  const idea = $("ideaBox").value.trim();
  try {
    if (!getKey()) throw new Error("You need a Music Pass first — tap “get a free pass” up top, or use a family invite link.");
    if (!idea) throw new Error("Type a sentence or two first — that's the whole point!");
    setStudioStatus("busy", "writing lyrics…");
    const model = document.querySelector('input[name="songLen"]:checked').value;
    const isClip = model.includes("clip");
    const structure = isClip
      ? "one [Verse] (4 short lines) and one [Chorus] (4 short lines) — it must fit in 30 seconds"
      : "[Verse 1], [Chorus], [Verse 2], [Chorus], [Bridge], [Verse 3], [Chorus]";
    const resp = await client().models.generateContent({
      model: "gemini-flash-latest",
      contents:
        `You are a hit songwriter. Expand this idea into complete, singable song lyrics.\n` +
        `Idea: "${idea}"\n` +
        `Musical vibe: ${vibeStyleString()}. Sung as: ${vocalChoice()}.\n` +
        `Structure: ${structure}.\n` +
        `Concrete imagery, a hook worth repeating, no clichés, and do not copy any existing song. ` +
        `Return ONLY the lyrics with [Section] tags — no title, no commentary.`,
      config: { temperature: 1.15 },
    });
    const lyrics = resp.text.trim();
    // land them in the Write tab so they can be tweaked and re-sung
    lyricsBox.value = lyrics;
    lyricsBox.dispatchEvent(new Event("input"));
    const style = ($("songStyle").value.trim() || vibeStyleString()) + ", " + vocalChoice();
    await performSing(style, lyrics, "singing your idea");
  } catch (e) {
    setStudioStatus("error", "error");
    const lp = $("studioLyrics");
    lp.classList.remove("hidden");
    lp.textContent = "⚠ " + (e.message || e);
  }
});

/* ================= track history, retention & saving ================= */

let currentTrack = null;
const inApp = location.port === "8123"; // served by the native shell's server

const RETENTION_MS = { "1d": 864e5, "7d": 6048e5, "30d": 2592e6 };

const retentionSel = $("retention");
retentionSel.addEventListener("change", async () => {
  store.set("retention", retentionSel.value);
  await applyRetention();
  renderHistory();
});

async function applyRetention() {
  const mode = retentionSel.value;
  if (mode === "forever") return;
  const cutoff = Date.now() - (RETENTION_MS[mode] || RETENTION_MS["7d"]);
  const mine = (await allTracks().catch(() => []))
    .filter((t) => (t.owner || "guest") === userScope() && t.ts < cutoff);
  for (const t of mine) await deleteTrack(t.id);
  if (mine.length) log(`track history: purged ${mine.length} expired track${mine.length === 1 ? "" : "s"}`);
}

function trackFilename(t) {
  const d = new Date(t.ts);
  const pad = (x) => String(x).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const ext = (t.mime || "").includes("wav") ? "wav" : "mp3";
  return `muse-${stamp}.${ext}`;
}

async function saveTrack(t) {
  if (!t) return;
  if (inApp) {
    // native shell writes it into the user's chosen folder
    const r = await fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: trackFilename(t), data: t.data }),
    });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || "save failed");
    $("dockStatus").textContent = `saved → ${j.path}`;
  } else {
    const bin = atob(t.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], trackFilename(t), { type: t.mime || "audio/mpeg" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      // phones: native share sheet — Save to Files, AirDrop, Messages…
      await navigator.share({ files: [file] }).catch(() => {});
    } else {
      // desktop browser: regular download (lands in ~/Downloads)
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = trackFilename(t);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  }
}

async function renderHistory() {
  const list = $("trackList");
  const tracks = (await allTracks().catch(() => []))
    .filter((t) => (t.owner || "guest") === userScope());
  list.innerHTML = "";
  if (!tracks.length) {
    const standalone = matchMedia("(display-mode: standalone)").matches;
    list.innerHTML = `<div class="track-empty">no tracks yet — sing something!` +
      (standalone
        ? `<br><small>heads-up: on iPhone, the home-screen app and the Safari tab keep separate histories — songs live where you made them.</small>`
        : ``) + `</div>`;
    return;
  }
  for (const t of tracks) {
    const row = document.createElement("div");
    row.className = "track-row";
    const when = new Date(t.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    row.innerHTML = `
      <span class="t-when">${when}</span>
      <span class="t-style" title=""></span>
      <button class="mini-btn t-play">▶ play</button>
      <button class="mini-btn t-save">⬇ save</button>
      <button class="t-del" title="delete">✕</button>`;
    const styleEl = row.querySelector(".t-style");
    styleEl.textContent = t.style || "(untitled vibe)";
    styleEl.title = t.style || "";
    row.querySelector(".t-play").addEventListener("click", () => {
      currentTrack = t;
      $("songAudio").src = `data:${t.mime};base64,${t.data}`;
      $("songOut").classList.remove("hidden");
      if (t.lyrics) {
        const lp = $("studioLyrics");
        lp.classList.remove("hidden");
        lp.textContent = "What it sang:\n" + t.lyrics;
      }
      $("songAudio").play().catch(() => {});
    });
    row.querySelector(".t-save").addEventListener("click", () =>
      saveTrack(t).catch((e) => { $("dockStatus").textContent = "⚠ " + e.message; }));
    row.querySelector(".t-del").addEventListener("click", async () => {
      await deleteTrack(t.id);
      renderHistory();
    });
    list.appendChild(row);
  }
}

$("songDl").addEventListener("click", () =>
  saveTrack(currentTrack).catch((e) => { $("dockStatus").textContent = "⚠ " + e.message; }));

/* save-folder picker — only meaningful inside the native app */
async function initFolderUI() {
  if (!inApp) return;
  try {
    const j = await (await fetch("/api/savedir")).json();
    $("folderInfo").classList.remove("hidden");
    $("dirPath").textContent = j.path;
    $("dirPath").title = j.path;
  } catch {}
  $("chooseDir").addEventListener("click", async () => {
    try {
      const j = await (await fetch("/api/choose-dir", { method: "POST" })).json();
      if (j.path) { $("dirPath").textContent = j.path; $("dirPath").title = j.path; }
    } catch {}
  });
}

/* ================= one-sound-at-a-time bus ================= */

// If any other engine starts, the Lyria jam bows out (and vice versa elsewhere).
document.addEventListener("engine-start", (e) => {
  log(`· bus: engine-start ${e.detail}`);
  if (e.detail !== "lyria" && playing) $("stopBtn").click();
  if (e.detail !== "song" && !$("songAudio").paused) $("songAudio").pause();
});
document.addEventListener("engine-stop", (e) => log(`· bus: engine-stop ${e.detail}`));
document.addEventListener("stop-all", () => {
  if (playing) $("stopBtn").click();
  if (!$("songAudio").paused) $("songAudio").pause();
});

// The rendered song counts as an engine too — it flies the sky and silences the rest.
$("songAudio").addEventListener("play", () => { emit("engine-start", "song"); sky.fly(true); });
$("songAudio").addEventListener("pause", () => { emit("engine-stop", "song"); sky.fly(false); });
$("songAudio").addEventListener("ended", () => { emit("engine-stop", "song"); sky.fly(false); });

/* Write tab → Sing tab */
$("singThese").addEventListener("click", () => {
  if (!$("songStyle").value.trim()) $("styleFromVibe").click();
  emit("goto-view", "sing");
});

/* ================= boot ================= */

buildCards();
rollConstraint();
rollSeed();
addPromptRow("dreamy synthwave", 1.2);
addPromptRow("warm analog bass", 0.8);
refreshVibeStrip();
navigator.storage?.persist?.().catch(() => {}); // ask iOS/browsers not to evict the track vault
applyUserState();
applyRetention().then(renderHistory);
initFolderUI();
initGoogleSignIn();
log("welcome — roll a vibe on the left, or hit PLAY to jam");
