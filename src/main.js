import { Scene, Environment, Character, Animation } from '@viggle/splat-engine';

const BASE = import.meta.env.BASE_URL;
const A = (f) => BASE + 'assets/' + f;
const $ = (id) => document.getElementById(id);
const DEBUG = new URLSearchParams(location.search).has('debug');

// ---- world layout (metres; floor y = 0; kitchen at -z, street door at +z) ----
const ENV_SCALE = 2.87;          // measured: floor sits 0.523 file units below the capture point (1.5 m)
const EYE = 1.55;
const SPAWN = { x: 0.55, z: 3.3, yaw: 0 };        // yaw 0 looks toward -z (the kitchen)
const BOUNDS = { x0: -1.0, x1: 1.0, z0: -3.05, z1: 4.3 };
const TABLES = [{ x: 0, z: 1.0 }, { x: 0, z: -1.25 }, { x: 0, z: -2.0 }, { x: 0, z: -2.7 }];
const TABLE_R = 0.55;
const PHONE = { x: 0.65, z: -3.1 };
const TILL = { x: -0.7, z: -3.1 };
const GHOST_START = { x: 0.85, z: 4.9 };
const DARK = { r: 0.012, g: 0.026, b: 0.03 };

// ---- UI helpers ----
function objective(zh, en) {
  const o = $('objective');
  if (!zh) { o.style.opacity = 0; return; }
  o.innerHTML = `${zh}<small>${en}</small>`; o.style.opacity = 1;
}
let capTimer = 0;
function caption(zh, en, ms = 2600) {
  const c = $('caption');
  c.innerHTML = `${zh}${en ? `<small>${en}</small>` : ''}`; c.style.opacity = 1;
  clearTimeout(capTimer); capTimer = setTimeout(() => (c.style.opacity = 0), ms);
}
function promptText(t) { const p = $('prompt'); if (t) { p.textContent = t; p.style.opacity = 1; } else p.style.opacity = 0; }
const black = (v) => ($('black').style.opacity = v);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- film grain ----
(() => { if (new URLSearchParams(location.search).has('lite')) return;
  const g = $('grain'), ctx = g.getContext('2d');
  g.width = 256; g.height = 256; g.style.width = '100%'; g.style.height = '100%'; g.style.imageRendering = 'pixelated';
  const img = ctx.createImageData(256, 256);
  const tick = () => {
    for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    ctx.putImageData(img, 0, 0); setTimeout(tick, 60);
  };
  tick();
})();

// ---- audio ----
const sounds = {};
function snd(name, { loop = false, vol = 1 } = {}) {
  const a = new Audio(A(name)); a.loop = loop; a.volume = vol; a.preload = 'auto'; sounds[name] = a; return a;
}
const ring = snd('ring.mp3', { loop: true, vol: 0.0 });
const call = snd('call.mp3', { vol: 0.9 });
const who = snd('who.mp3', { vol: 1 });
const vo = snd('vo.mp3', { vol: 0.95 });
const drone = snd('drone.mp3', { loop: true, vol: 0 });
function fade(a, to, ms) {
  const from = a.volume, t0 = performance.now();
  const step = () => { const k = Math.min(1, (performance.now() - t0) / ms); a.volume = from + (to - from) * k; if (k < 1) requestAnimationFrame(step); };
  step();
}

// ---- loading with progress ----
async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  const total = +res.headers.get('content-length') || 0;
  const reader = res.body.getReader(); const chunks = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; if (total) onProgress(got / total); }
  return URL.createObjectURL(new Blob(chunks));
}

const canvas = $('c');
function resize() { canvas.width = innerWidth * Math.min(devicePixelRatio, 1.5); canvas.height = innerHeight * Math.min(devicePixelRatio, 1.5); }
resize(); addEventListener('resize', resize);

const scene = await Scene.create(canvas, {
  fov: 68, near: 0.05, far: 60,
  bgColor: { r: 0, g: 0, b: 0, a: 1 },
  cameraPosition: { x: SPAWN.x, y: EYE, z: SPAWN.z },
  cameraTarget: { x: SPAWN.x, y: EYE, z: SPAWN.z - 1 },
});
scene.start();
window.__scene = scene;

const bar = document.querySelector('#progress i');
const envUrl = await fetchWithProgress(A('realphoto.spz'), (k) => (bar.style.width = (k * 85).toFixed(1) + '%'));
const env = await Environment.load(scene, envUrl, { filename: 'room.spz', scale: ENV_SCALE, position: { x: 0, y: 1.5, z: 0 } });
env.setTint(0.6, DARK);
if (!new URLSearchParams(location.search).has('lite')) canvas.style.filter = 'contrast(1.18) saturate(0.7)';
bar.style.width = '92%';

const ghost = await Character.load(scene, A('xiangge.vsplat'));
await Animation.loadGlb(scene, A('idle.glb'), 'idle');
ghost.playAnimation('idle', { loop: true });
ghost.setReveal(0);
ghost.setTint(0.55, DARK);
const GHOST_Y = 0.1;
ghost.setPosition(GHOST_START.x, GHOST_Y, GHOST_START.z);
ghost.setRotation(0, 180, 0);
bar.style.width = '100%';
window.__env = env; window.__ghost = ghost;

// ---- first-person controller ----
const cam = scene.cameraEntity;
const player = { x: SPAWN.x, z: SPAWN.z, yaw: SPAWN.yaw, pitch: -4, bob: 0 };
const keys = new Set();
let locked = false, dragging = false, playing = false;
addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'KeyE') interact(); });
addEventListener('keyup', (e) => keys.delete(e.code));
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
canvas.addEventListener('mousedown', () => { if (!playing) return; if (!locked) { canvas.requestPointerLock?.(); dragging = true; } else interact(); });
addEventListener('mouseup', () => (dragging = false));
addEventListener('mousemove', (e) => {
  if (!playing || !(locked || dragging)) return;
  player.yaw -= e.movementX * 0.12; player.pitch = Math.max(-60, Math.min(50, player.pitch - e.movementY * 0.12));
});

function collide(nx, nz) {
  nx = Math.max(BOUNDS.x0, Math.min(BOUNDS.x1, nx));
  nz = Math.max(BOUNDS.z0, Math.min(BOUNDS.z1, nz));
  for (const t of TABLES) {
    const dx = nx - t.x, dz = nz - t.z, d = Math.hypot(dx, dz);
    if (d < TABLE_R) { const k = TABLE_R / (d || 1e-4); nx = t.x + dx * k; nz = t.z + dz * k; }
  }
  return [nx, nz];
}
function forward() { const r = player.yaw * Math.PI / 180; return { x: -Math.sin(r), z: -Math.cos(r) }; }
function facing(p, maxDeg) {
  const f = forward(); const dx = p.x - player.x, dz = p.z - player.z; const d = Math.hypot(dx, dz) || 1;
  return (f.x * dx + f.z * dz) / d > Math.cos(maxDeg * Math.PI / 180);
}
const dist = (p) => Math.hypot(p.x - player.x, p.z - player.z);

let last = performance.now();
scene.app.on('update', () => {
  const now = performance.now(); const dtReal = Math.min(0.3, (now - last) / 1000); const dt = Math.min(0.05, dtReal); last = now;
  if (playing && !frozen) {
    const f = forward(); const rgt = { x: -f.z, z: f.x };
    let mx = 0, mz = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) { mx += f.x; mz += f.z; }
    if (keys.has('KeyS') || keys.has('ArrowDown')) { mx -= f.x; mz -= f.z; }
    if (keys.has('KeyD')) { mx += rgt.x; mz += rgt.z; }
    if (keys.has('KeyA')) { mx -= rgt.x; mz -= rgt.z; }
    if (keys.has('ArrowLeft')) player.yaw += 90 * dt;
    if (keys.has('ArrowRight')) player.yaw -= 90 * dt;
    const m = Math.hypot(mx, mz);
    if (m > 0) { const sp = 1.45 * dt / m; [player.x, player.z] = collide(player.x + mx * sp, player.z + mz * sp); player.bob += dt * 7.5; }
    tickStory(dtReal);
  }
  const ey = EYE + Math.sin(player.bob) * 0.018;
  const yr = player.yaw * Math.PI / 180, pr = player.pitch * Math.PI / 180;
  cam.setPosition(player.x, ey, player.z);
  cam.lookAt(player.x - Math.sin(yr) * Math.cos(pr), ey + Math.sin(pr), player.z - Math.cos(yr) * Math.cos(pr));
  if (DEBUG) $('objective').textContent = `x ${player.x.toFixed(2)} z ${player.z.toFixed(2)} yaw ${player.yaw.toFixed(0)} state ${state}`;
});

// ---- story ----
let state = 'intro', frozen = false, t = 0;
let ghostPos = { ...GHOST_START }, ghostOn = false, sinceStep = 0, unseen = 0, spotted = false;

function near(p, r = 1.15, deg = 55) { return dist(p) < r && facing(p, deg); }

function tickStory(dt) {
  t += dt;
  if (state === 'ring') {
    const d = dist(PHONE); ring.volume = Math.max(0.12, Math.min(1, 1.6 / (d + 0.6)));
    promptText(near(PHONE) ? '[E] 聽電話 Answer' : '');
  } else if (state === 'till') {
    promptText(near(TILL) ? '[E] 開錢櫃 Open the till' : '');
  } else if (state === 'hunt') {
    promptText('');
    const gd = Math.hypot(ghostPos.x - player.x, ghostPos.z - player.z);
    const seen = facing(ghostPos, 40);
    if (!spotted) { if (seen && gd < 9) { spotted = true; sinceStep = 0; unseen = 0; } ghost.setRotation(0, Math.atan2(player.x - ghostPos.x, player.z - ghostPos.z) * 180 / Math.PI, 0); return; }
    unseen = seen ? 0 : unseen + dt; sinceStep += dt;
    // He moves only in the dark: when you look away, or every few seconds the tube gives out
    if ((unseen > 0.9 && sinceStep > 1.2) || sinceStep > 3.2) { sinceStep = 0; flickerStep(); }
    if (gd < 1.35) finale();
    ghost.setRotation(0, Math.atan2(player.x - ghostPos.x, player.z - ghostPos.z) * 180 / Math.PI, 0);
  }
}

async function flickerStep() {
  black(0.96); env.setTint(0.95, { r: 0, g: 0, b: 0 });
  await wait(140);
  // step toward the player, keeping to the open floor
  const dx = player.x - ghostPos.x, dz = player.z - ghostPos.z, d = Math.hypot(dx, dz);
  const s = Math.min(1.25, Math.max(0, d - 1.0));
  let nx = ghostPos.x + dx / d * s, nz = ghostPos.z + dz / d * s;
  for (const tb of TABLES) { const ex = nx - tb.x, ez = nz - tb.z, e = Math.hypot(ex, ez); if (e < 0.6) { nx = tb.x + (ex >= 0 ? 0.62 : -0.62); } }
  ghostPos = { x: Math.max(-0.95, Math.min(0.95, nx)), z: nz };
  ghost.setPosition(ghostPos.x, GHOST_Y, ghostPos.z);
  await wait(90);
  black(0); env.setTint(0.6, DARK);
}

async function interact() {
  if (!playing || frozen) return;
  if (state === 'ring' && near(PHONE)) {
    state = 'call'; ring.pause(); promptText(''); objective('');
    call.currentTime = 0; call.play();
    caption('「四人餐?」', '"A table for four?"', 1900);
    setTimeout(() => caption('「喂?」', '"Hello?"', 1600), 2300);
    setTimeout(() => caption('「喂?」', '"...Hello?"', 1500), 4600);
    setTimeout(() => caption('……', 'The line goes dead.', 1800), 6100);
    setTimeout(() => { state = 'till'; objective('埋數 — 去開錢櫃', 'Close out the till'); }, 7900);
  } else if (state === 'till' && near(TILL)) {
    state = 'note'; promptText(''); objective('');
    $('note').classList.add('show');
    caption('錢櫃入面……有張陰司紙。', 'In the till, among the takings: a hell note.', 3200);
    fade(drone, 0.55, 3000);
    await wait(3400);
    $('note').classList.remove('show');
    await wait(700);
    // the tube starts to go
    for (const ms of [90, 60, 200]) { black(0.95); await wait(ms); black(0); await wait(260); }
    black(0.97); await wait(380);
    ghost.setReveal(1); ghostOn = true;
    ghost.setPosition(ghostPos.x, GHOST_Y, ghostPos.z);
    black(0);
    state = 'hunt'; t = 0; sinceStep = 0;
    objective('後面……', 'Behind you.');
  }
}

async function finale() {
  if (state === 'end') return;
  state = 'end'; frozen = true; objective(''); promptText('');
  black(1); fade(drone, 0, 300);
  await wait(500);
  who.currentTime = 2.4; who.play();
  setTimeout(() => caption('「呢啲錢,邊個收㗎?」', '"Who took this money?"', 2600), 350);
  await wait(3300);
  $('end').style.display = 'flex';
  document.exitPointerLock?.();
  playing = false;
}

function reset() {
  Object.assign(player, { x: SPAWN.x, z: SPAWN.z, yaw: SPAWN.yaw, pitch: -4, bob: 0 });
  ghostPos = { ...GHOST_START }; ghost.setReveal(0); ghostOn = false; spotted = false; unseen = 0; sinceStep = 0;
  ghost.setPosition(ghostPos.x, GHOST_Y, ghostPos.z);
  state = 'intro'; frozen = false; t = 0; black(0); env.setTint(0.6, DARK);
  for (const a of Object.values(sounds)) { a.pause(); a.currentTime = 0; }
}

async function begin() {
  $('start').style.display = 'none'; $('end').style.display = 'none';
  reset(); playing = true; $('crosshair').style.opacity = 1;
  canvas.requestPointerLock?.();
  drone.volume = 0; drone.play(); fade(drone, 0.16, 4000);
  await wait(900);
  vo.play(); caption('嗰晚埋數,錢櫃有幾張陰司紙。', 'That night, closing out the till, there were hell notes in the drawer.', 3600);
  await wait(4400);
  if (state !== 'intro') return;
  state = 'ring'; ring.currentTime = 0; ring.play();
  objective('電話響 — 去櫃枱聽', 'The phone is ringing. Answer it at the counter');
}

const go = $('go');
go.disabled = false; go.textContent = '入去 ENTER';
go.addEventListener('click', begin);
$('again').addEventListener('click', begin);
window.__ready = true;
window.__debug = { player, get state() { return state; }, interact, begin, finale, ghostPos: () => ghostPos };
