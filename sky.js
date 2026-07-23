// Dreamland sky engine: procedural fluffy clouds with pseudo-3D depth.
// Idle = clouds hang in the air with a lazy breeze. Flying = camera dives
// forward through them, with wind speed boosted by the music's energy.

const canvas = document.getElementById("skyCanvas");
const g = canvas.getContext("2d");

let W, H, DPR;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = canvas.width = window.innerWidth * DPR;
  H = canvas.height = window.innerHeight * DPR;
}
window.addEventListener("resize", resize);
resize();

/* ---- pre-rendered cloud sprites: clustered puffs with a pastel wash ---- */

const HUES = [340, 25, 55, 140, 205, 265];

function makeSprite(hue) {
  const w = 460, h = 280;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const s = c.getContext("2d");

  const base = h * 0.6;
  const puffs = [];
  for (let i = 0; i < 7; i++)  // flat-ish underside
    puffs.push({ x: w * 0.14 + (w * 0.72) * (i / 6), y: base + (Math.random() * 16 - 8), r: 48 + Math.random() * 26 });
  for (let i = 0; i < 6; i++)  // billowing mid lobes
    puffs.push({ x: w * 0.22 + Math.random() * w * 0.56, y: base - 42 - Math.random() * 52, r: 42 + Math.random() * 34 });
  puffs.push({ x: w * 0.5 + (Math.random() * 40 - 20), y: base - 100, r: 58 }); // crown

  for (const p of puffs) {
    const grad = s.createRadialGradient(p.x, p.y - p.r * 0.3, p.r * 0.1, p.x, p.y, p.r);
    grad.addColorStop(0, "rgba(255,255,255,.96)");
    grad.addColorStop(0.62, "rgba(255,255,255,.6)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    s.fillStyle = grad;
    s.beginPath();
    s.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    s.fill();
  }

  // magical two-tone wash + a warmer belly shadow, kept inside the fluff
  s.globalCompositeOperation = "source-atop";
  const tint = s.createLinearGradient(0, 0, w, h);
  tint.addColorStop(0, `hsla(${hue}, 90%, 84%, .48)`);
  tint.addColorStop(1, `hsla(${(hue + 70) % 360}, 90%, 86%, .48)`);
  s.fillStyle = tint;
  s.fillRect(0, 0, w, h);
  const shade = s.createLinearGradient(0, base - 30, 0, h);
  shade.addColorStop(0, "rgba(255,255,255,0)");
  shade.addColorStop(1, `hsla(${hue}, 65%, 72%, .4)`);
  s.fillStyle = shade;
  s.fillRect(0, 0, w, h);
  return c;
}

const SPRITES = HUES.map(makeSprite);

/* ---- cloud field ---- */

const N = 26;
const NEAR = 0.07;

function spawn(z) {
  return {
    x: (Math.random() * 2 - 1) * 1.7,
    y: (Math.random() * 2 - 1) * 1.15,
    z: z ?? (NEAR + 0.1 + Math.random() * 0.9),
    sprite: SPRITES[(Math.random() * SPRITES.length) | 0],
    wob: Math.random() * Math.PI * 2,
  };
}

const clouds = [];
for (let i = 0; i < N; i++) clouds.push(spawn());

let speed = 0;
let targetSpeed = 0;
let analyser = null;
let last = performance.now();

export const sky = {
  fly(on) { targetSpeed = on ? 0.6 : 0; },
  attachAnalyser(a) { analyser = a; },
};
window.__sky = sky; // console handle for poking the weather

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  // the music is the wind: average spectrum energy boosts flight speed
  let boost = 0;
  if (analyser && targetSpeed > 0) {
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (const v of data) sum += v;
    boost = sum / data.length / 255;
  }
  speed += (targetSpeed * (1 + boost * 1.6) - speed) * Math.min(dt * 1.4, 1);

  g.clearRect(0, 0, W, H);
  const f = Math.min(W, H);
  clouds.sort((a, b) => b.z - a.z); // paint far to near

  for (const cl of clouds) {
    cl.z -= speed * dt * 0.55;
    cl.wob += dt;
    cl.x += Math.sin(cl.wob * 0.3) * dt * 0.005 + dt * 0.007; // lazy breeze
    if (cl.z <= NEAR) Object.assign(cl, spawn(1.05 + Math.random() * 0.25));
    if (cl.x > 2.1) cl.x = -2.1;

    const s = 1 / cl.z;
    const sx = W / 2 + cl.x * f * 0.5 * s;
    const sy = H / 2 + cl.y * f * 0.42 * s + Math.sin(cl.wob * 0.5) * 6 * DPR;
    const cw = 250 * DPR * s;
    const ch = cw * (280 / 460);
    // fade in while far away, fade out just before whooshing past the camera
    const alpha = Math.min(1, Math.max(0, (1.15 - cl.z) * 1.7)) * Math.min(1, (cl.z - NEAR) * 9);
    if (alpha <= 0.01) continue;
    g.globalAlpha = alpha * 0.92;
    g.drawImage(cl.sprite, sx - cw / 2, sy - ch / 2, cw, ch);
  }
  g.globalAlpha = 1;
}
requestAnimationFrame(frame);
