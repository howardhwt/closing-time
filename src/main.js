import { Scene, Environment, Character, Animation } from '@viggle/splat-engine';
import { LANGS, LANG_DISPLAY, T, detectLang, saveLang } from './i18n.js';

const BASE = import.meta.env.BASE_URL;
const A = (f) => BASE + 'assets/' + f;
const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const DEV = Q.has('dev');
const LITE = Q.has('lite');
const TOUCH = matchMedia('(hover:none) and (pointer:coarse)').matches || Q.has('touch');
if (TOUCH) document.documentElement.classList.add('touch');

// ---------------------------------------------------------------------------
// Layout. Metres, floor at y = 0. Each scene is a raw PINOC reconstruction:
// origin = capture point (placed at 1.5 m), scale measured from the floor.
// ---------------------------------------------------------------------------
const EYE = 1.55;
const DARK = { r: 0.012, g: 0.026, b: 0.03 };
const L = {
  shop: {
    file: 'shop.spz', scale: 2.34, tint: 0.55,           // floor 0.642 file units below the capture point
    bounds: { x0: -0.9, x1: 0.85, z0: -2.8, z1: 5.6 },    // the aisle between the booths; door at -z, bar at +z
    blockers: [],
    spawnStart: { x: 0.0, z: 3.8, yaw: 0 },
    counter: { x: 0.25, z: -2.3 },                        // stand here, facing +x, to reach the till
    till: { x: 1.2, z: -2.4 },
    boss: { x: 1.85, z: -2.4, yaw: -90 },                 // 祥哥 behind the counter, facing the aisle
    exit: { x: 0.0, z: -3.05 },                           // the glass double door
    spawnReturn: { x: -0.2, z: -2.4, yaw: 180 },
  },
  corridor: {
    file: 'corridor.spz', scale: 2.57, tint: 0.5,         // floor 0.583 file units down; captured in front of the green door
    bounds: { x0: -0.45, x1: 0.45, z0: -0.5, z1: 7.8 },
    blockers: [],
    spawn: { x: 0, z: 7.4, yaw: 0 },                      // far end of the corridor, facing the green door at -z
    door: { x: 0, z: -1.25 },
    ghost: { x: 0, z: -0.85, yaw: 0 },
    escape: { x: 0, z: 7.6 },
  },
};
if (Q.get('layout')) { try { const o = JSON.parse(Q.get('layout')); for (const k in o) Object.assign(L[k], o[k]); } catch { /* ignore */ } }

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------
let lang = detectLang();
const t = (k) => T[lang][k] ?? T.en[k] ?? k;
let curObjective = null;
function applyLang() {
  document.documentElement.lang = lang === 'en' ? 'en' : lang;
  document.querySelectorAll('[data-t]').forEach((el) => {
    if (el.id === 'go') { el.textContent = el.disabled ? t('loading') : t('enter'); return; }
    el.textContent = t(el.dataset.t);
  });
  document.querySelectorAll('#langs button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.l === lang)));
  if (curObjective) objective(curObjective);
}
for (const l of LANGS) {
  const b = document.createElement('button'); b.dataset.l = l; b.textContent = LANG_DISPLAY[l]; b.setAttribute('role', 'radio');
  b.onclick = (e) => { e.stopPropagation(); lang = l; saveLang(l); applyLang(); };
  $('langs').appendChild(b);
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function objective(k) { curObjective = k; const o = $('objective'); if (!k) { o.style.opacity = 0; return; } o.textContent = t(k); o.style.opacity = 1; }
let capTimer = 0;
function caption(k, ms = 2600) { const c = $('caption'); c.textContent = t(k); c.style.opacity = 1; clearTimeout(capTimer); capTimer = setTimeout(() => (c.style.opacity = 0), ms); }
let promptKey = null;
function prompt(k) {
  if (k === promptKey) return;
  promptKey = k; const p = $('prompt');
  if (k && !TOUCH) { p.textContent = t(k); p.style.opacity = 1; } else p.style.opacity = 0;
  $('actBtn').classList.toggle('on', !!k);
}
const black = (v) => ($('black').style.opacity = v);
const fadeOut = (v) => ($('fade').style.opacity = v);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(() => { // film grain
  if (LITE) return;
  const g = $('grain'), ctx = g.getContext('2d');
  g.width = 200; g.height = 200; g.style.width = '100%'; g.style.height = '100%'; g.style.imageRendering = 'pixelated';
  const img = ctx.createImageData(200, 200);
  const tickG = () => { for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; } ctx.putImageData(img, 0, 0); setTimeout(tickG, 70); };
  tickG();
})();

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------
function snd(name, { loop = false, vol = 1 } = {}) { const a = new Audio(A(name)); a.loop = loop; a.volume = vol; a.preload = 'auto'; return a; }
const S = {
  vo: snd('vo.mp3', { vol: 0.95 }), ring: snd('ring.mp3', { loop: true, vol: 0 }), call: snd('call.mp3', { vol: 0.9 }),
  order: snd('order.mp3'), knock: snd('knock.mp3'), takeaway: snd('takeaway.mp3'), door: snd('dooropen.mp3'),
  tube: snd('tube.mp3', { vol: 0.5 }), latch: snd('latch.mp3'), who: snd('who.mp3'), drone: snd('drone.mp3', { loop: true, vol: 0 }),
};
function fade(a, to, ms) { const from = a.volume, t0 = performance.now(); const step = () => { const k = Math.min(1, (performance.now() - t0) / ms); a.volume = from + (to - from) * k; if (k < 1) requestAnimationFrame(step); }; step(); }
function play(a, from = 0) { try { a.currentTime = from; const p = a.play(); if (p) p.catch(() => {}); } catch { /* ignore */ } }

// ---------------------------------------------------------------------------
// Engine and assets
// ---------------------------------------------------------------------------
async function fetchBlob(url, onProgress) {
  const res = await fetch(url); const total = +res.headers.get('content-length') || 0;
  const reader = res.body.getReader(); const chunks = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; if (total && onProgress) onProgress(got / total); }
  return URL.createObjectURL(new Blob(chunks));
}
const canvas = $('c');
const DPR = TOUCH ? 1 : Math.min(devicePixelRatio, 1.5);
function resize() { canvas.width = innerWidth * DPR; canvas.height = innerHeight * DPR; }
resize(); addEventListener('resize', resize);
if (!LITE) canvas.style.filter = 'contrast(1.18) saturate(0.7)';

applyLang();
const scene = await Scene.create(canvas, { fov: TOUCH ? 74 : 68, near: 0.05, far: 60, bgColor: { r: 0, g: 0, b: 0, a: 1 },
  cameraPosition: { x: 0, y: EYE, z: 3 }, cameraTarget: { x: 0, y: EYE, z: 0 } });
scene.start();
const bar = document.querySelector('#progress i');

async function loadEnv(key, onProgress) {
  const cfg = L[key];
  const url = await fetchBlob(A(cfg.file), onProgress);
  const env = await Environment.load(scene, url, { filename: key + '.spz', scale: cfg.scale, position: { x: 0, y: 1.5, z: 0 } });
  env.setTint(cfg.tint, DARK);
  return env;
}
const envs = {};
envs.shop = await loadEnv('shop', (k) => (bar.style.width = (k * 80).toFixed(1) + '%'));

await Animation.loadGlb(scene, A('idle.glb'), 'idle');
const ANIMS = new Set(['idle']);
await Promise.all(['phone', 'count', 'send', 'eerie', 'lunge'].map((n) =>
  Animation.loadGlb(scene, A(`m-${n}.glb`), n).then(() => ANIMS.add(n)).catch(() => {})));
function anim(ch, name, loop = true) {
  const n = ANIMS.has(name) ? name : 'idle';
  try { ch.crossfadeTo(n, { duration: 0.25, loop: n === 'idle' ? true : loop }); } catch { ch.playAnimation(n, { loop }); }
}
const boss = await Character.load(scene, A('xiangge.vsplat'));
boss.playAnimation('idle', { loop: true }); boss.setTint(0.5, DARK);
const granny = await Character.load(scene, A('granny.vsplat'));
granny.playAnimation('idle', { loop: true }); granny.setTint(0.55, DARK); granny.setReveal(0); granny.setActive(false);
bar.style.width = '90%';

// the corridor streams in behind the start card
const corridorReady = loadEnv('corridor', (k) => (bar.style.width = (90 + k * 10).toFixed(1) + '%'))
  .then((e) => { envs.corridor = e; e.entity.enabled = false; bar.style.width = '100%'; });

function placeChar(ch, p) { ch.setPosition(p.x, 0.08, p.z); if (p.yaw !== undefined) ch.setRotation(0, p.yaw, 0); }

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------
const cam = scene.cameraEntity;
const player = { x: 0, z: 3, yaw: 0, pitch: -4, bob: 0, scene: 'shop' };
const keys = new Set();
let locked = false, dragging = false, playing = false, frozen = false, walkHeld = false;
addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'KeyE' || e.code === 'Space') interact(); });
addEventListener('keyup', (e) => keys.delete(e.code));
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
function look(dx, dy, k) { player.yaw -= dx * k; player.pitch = Math.max(-60, Math.min(50, player.pitch - dy * k)); }
if (!TOUCH) {
  canvas.addEventListener('mousedown', () => { if (!playing && !DEV) return; if (!locked) { canvas.requestPointerLock?.(); dragging = true; } else interact(); });
  addEventListener('mouseup', () => (dragging = false));
  addEventListener('mousemove', (e) => { if (!(playing || DEV) || !(locked || dragging)) return; look(e.movementX, e.movementY, 0.12); });
} else {
  $('touch').style.display = 'block';
  let lt = null;
  canvas.addEventListener('touchstart', (e) => { const tt = e.changedTouches[0]; lt = { id: tt.identifier, x: tt.clientX, y: tt.clientY }; }, { passive: true });
  canvas.addEventListener('touchmove', (e) => { for (const tt of e.changedTouches) if (lt && tt.identifier === lt.id) { look(tt.clientX - lt.x, tt.clientY - lt.y, 0.28); lt.x = tt.clientX; lt.y = tt.clientY; } }, { passive: true });
  canvas.addEventListener('touchend', () => (lt = null), { passive: true });
  const wb = $('walkBtn');
  wb.addEventListener('touchstart', (e) => { e.preventDefault(); walkHeld = true; });
  wb.addEventListener('touchend', (e) => { e.preventDefault(); walkHeld = false; });
  wb.addEventListener('touchcancel', () => (walkHeld = false));
  $('actBtn').addEventListener('touchstart', (e) => { e.preventDefault(); interact(); });
}

function collide(nx, nz) {
  const c = L[player.scene];
  nx = Math.max(c.bounds.x0, Math.min(c.bounds.x1, nx)); nz = Math.max(c.bounds.z0, Math.min(c.bounds.z1, nz));
  for (const b of c.blockers) { const dx = nx - b.x, dz = nz - b.z, d = Math.hypot(dx, dz); if (d < b.r) { const k = b.r / (d || 1e-4); nx = b.x + dx * k; nz = b.z + dz * k; } }
  return [nx, nz];
}
function fwd() { const r = player.yaw * Math.PI / 180; return { x: -Math.sin(r), z: -Math.cos(r) }; }
function facing(p, deg) { const f = fwd(); const dx = p.x - player.x, dz = p.z - player.z; const d = Math.hypot(dx, dz) || 1; return (f.x * dx + f.z * dz) / d > Math.cos(deg * Math.PI / 180); }
const dist = (p) => Math.hypot(p.x - player.x, p.z - player.z);
const near = (p, r = 1.2, deg = 60) => dist(p) < r && facing(p, deg);
function setPlayer(p, sceneKey) { player.scene = sceneKey; player.x = p.x; player.z = p.z; player.yaw = p.yaw ?? 0; player.pitch = -4; }

let last = performance.now();
scene.app.on('update', () => {
  const now = performance.now(); const dtReal = Math.min(0.3, (now - last) / 1000); const dt = Math.min(0.05, dtReal); last = now;
  if ((playing && !frozen) || DEV) {
    const f = fwd(), rg = { x: -f.z, z: f.x }; let mx = 0, mz = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp') || walkHeld) { mx += f.x; mz += f.z; }
    if (keys.has('KeyS') || keys.has('ArrowDown')) { mx -= f.x; mz -= f.z; }
    if (keys.has('KeyD')) { mx += rg.x; mz += rg.z; }
    if (keys.has('KeyA')) { mx -= rg.x; mz -= rg.z; }
    if (keys.has('ArrowLeft')) player.yaw += 90 * dt;
    if (keys.has('ArrowRight')) player.yaw -= 90 * dt;
    const m = Math.hypot(mx, mz);
    if (m > 0) { const sp = 1.45 * dt / m; if (DEV) { player.x += mx * sp * 2; player.z += mz * sp * 2; } else [player.x, player.z] = collide(player.x + mx * sp, player.z + mz * sp); player.bob += dt * 7.5; }
    if (!DEV) tick(dtReal);
  }
  const ey = EYE + Math.sin(player.bob) * 0.018, yr = player.yaw * Math.PI / 180, pr = player.pitch * Math.PI / 180;
  cam.setPosition(player.x, ey, player.z);
  cam.lookAt(player.x - Math.sin(yr) * Math.cos(pr), ey + Math.sin(pr), player.z - Math.cos(yr) * Math.cos(pr));
  if (DEV) $('objective').textContent = `${player.scene} x ${player.x.toFixed(2)} z ${player.z.toFixed(2)} yaw ${((player.yaw % 360) + 360) % 360 | 0}`;
});

// ---------------------------------------------------------------------------
// The stalker moves only in the dark: when you look away, or when the tube gives out
// ---------------------------------------------------------------------------
let stalker = null;
function startStalk(ch, pos, onReach, step = 1.2) { stalker = { ch, pos: { ...pos }, spotted: false, unseen: 0, since: 0, step, onReach }; }
function tickStalker(dt) {
  const s = stalker; if (!s) return;
  const d = Math.hypot(s.pos.x - player.x, s.pos.z - player.z);
  const seen = facing(s.pos, 40);
  s.ch.setRotation(0, Math.atan2(player.x - s.pos.x, player.z - s.pos.z) * 180 / Math.PI, 0);
  if (!s.spotted) { if (seen) { s.spotted = true; s.since = 0; } return; }
  s.unseen = seen ? 0 : s.unseen + dt; s.since += dt;
  if ((s.unseen > 0.9 && s.since > 1.1) || s.since > 3.0) { s.since = 0; flickerStep(); }
  if (d < 1.35) { const cb = s.onReach; stalker = null; cb(); }
}
async function flickerStep() {
  const s = stalker; if (!s) return;
  const env = envs[player.scene]; const tint = L[player.scene].tint;
  black(0.96); env.setTint(0.95, { r: 0, g: 0, b: 0 }); play(S.tube, 0.2);
  await wait(140);
  if (stalker === s) {
    const dx = player.x - s.pos.x, dz = player.z - s.pos.z, d = Math.hypot(dx, dz) || 1;
    const k = Math.min(s.step, Math.max(0, d - 1.0));
    s.pos.x += dx / d * k; s.pos.z += dz / d * k;
    s.ch.setPosition(s.pos.x, 0.08, s.pos.z);
  }
  await wait(90);
  black(0); env.setTint(tint, DARK);
}

// ---------------------------------------------------------------------------
// Story: you are 阿輝, the delivery boy.
// shop (phone, order) -> corridor (green door, the 尾房 resident) -> shop (till, 祥哥)
// ---------------------------------------------------------------------------
let state = 'intro', ambient = 3;
const sh = L.shop, co = L.corridor;
function tick(dt) {
  tickStalker(dt);
  if (state === 'ring') {
    S.ring.volume = Math.max(0.15, Math.min(1, 1.8 / (dist(sh.till) + 0.6)));
    prompt(near(sh.till, 1.4, 60) ? 'p_counter' : null);
  } else if (state === 'leave') prompt(near(sh.exit, 1.5, 70) ? 'p_leave' : null);
  else if (state === 'door') {
    prompt(near(co.door, 1.5, 60) ? 'p_knock' : null);
    ambient -= dt; if (ambient < 0) { ambient = 4 + Math.random() * 4; play(S.tube, 0.3); black(0.85); setTimeout(() => black(0), 70 + Math.random() * 120); }
  }
  else if (state === 'run') { prompt(null); if (player.z > co.escape.z - 0.4) escaped(); }
  else if (state === 'till') prompt(near(sh.till, 1.4, 60) ? 'p_till' : null);
  else prompt(null);
}

async function interact() {
  if (!playing || frozen || !promptKey) return;
  const k = promptKey; prompt(null);
  if (k === 'p_counter') {
    state = 'call'; objective(null); S.ring.pause(); anim(boss, 'phone', false);
    play(S.call); caption('call1', 1900);
    setTimeout(() => caption('call2', 1500), 2300);
    setTimeout(() => caption('call3', 1400), 4600);
    await wait(6400);
    anim(boss, 'send', false); play(S.order); setTimeout(() => caption('order', 3000), 100);
    await wait(3400);
    anim(boss, 'count', true);
    state = 'leave'; objective('o_deliver');
  } else if (k === 'p_leave') {
    state = 'travel'; objective(null);
    await toCorridor();
  } else if (k === 'p_knock') {
    state = 'knock'; objective(null);
    play(S.knock); await wait(1300);
    play(S.takeaway); caption('takeaway', 1800); await wait(2600);
    caption('silence', 1800); fade(S.drone, 0.1, 800); await wait(2400);
    play(S.door); black(0.98); envs.corridor.setTint(0.97, { r: 0, g: 0, b: 0 });
    await wait(1700);
    caption('dooropen', 2200);
    // she is standing in the doorway when the light comes back
    frozen = true;
    granny.setActive(true); placeChar(granny, co.ghost); granny.setReveal(1); anim(granny, 'eerie', true);
    player.x = 0; player.z = Math.max(player.z, co.ghost.z + 2.4); player.yaw = 0; player.pitch = -2;
    await wait(900);
    envs.corridor.setTint(co.tint, DARK); black(0);
    fade(S.drone, 0.7, 2000);
    await wait(1600);
    caption('money', 2000);
    await wait(1500);
    // the tube gives out; when it comes back she is on you
    black(0.97); play(S.tube, 0.2); await wait(180);
    placeChar(granny, { x: 0, z: player.z - 1.15, yaw: 0 }); anim(granny, 'lunge', false);
    black(0); await wait(520);
    black(1); play(S.latch); fade(S.drone, 0, 200);
    await wait(1600);
    await backToShop();
  } else if (k === 'p_till') {
    state = 'note'; objective(null);
    $('note').classList.add('show'); caption('note', 3200);
    fade(S.drone, 0.55, 3000);
    await wait(3400); $('note').classList.remove('show'); await wait(500);
    for (const ms of [90, 60, 200]) { black(0.95); play(S.tube, 0.1); await wait(ms); black(0); await wait(260); }
    black(0.97); await wait(380);
    const p = { x: 0.1, z: sh.counter.z + 3.0 }; // he is suddenly out on the floor, between you and the booths
    placeChar(boss, p); anim(boss, 'eerie', true); black(0);
    state = 'hunt'; objective('o_behind');
    startStalk(boss, p, finale, 1.25);
  }
}

async function toCorridor() {
  frozen = true; fadeOut(1); fade(S.drone, 0.05, 900); await wait(1000);
  if (!envs.corridor) { $('toast').textContent = t('loadingCorridor'); $('toast').style.opacity = 1; await corridorReady; $('toast').style.opacity = 0; }
  envs.shop.entity.enabled = false; envs.corridor.entity.enabled = true;
  boss.setActive(false); granny.setActive(false);
  setPlayer(co.spawn, 'corridor');
  await wait(400); fadeOut(0); frozen = false; fade(S.drone, 0.22, 3000);
  state = 'door'; objective('o_door');
  setTimeout(() => { play(S.tube, 0); black(0.9); setTimeout(() => black(0), 120); }, 2600);
}
async function caught() {
  if (state !== 'run') return;
  state = 'caught'; frozen = true; objective(null);
  await wait(500); black(1); play(S.latch); caption('caught', 1600);
  await wait(1800); await backToShop();
}
async function escaped() {
  if (state !== 'run') return;
  stalker = null; state = 'escaped'; frozen = true; objective(null);
  play(S.latch); fadeOut(1); await wait(1200); await backToShop();
}
async function backToShop() {
  granny.setReveal(0); granny.setActive(false);
  envs.corridor.entity.enabled = false; envs.shop.entity.enabled = true;
  boss.setActive(true); placeChar(boss, sh.boss); anim(boss, 'count', true);
  setPlayer(sh.spawnReturn, 'shop');
  fade(S.drone, 0.2, 1500);
  await wait(500); black(0); fadeOut(0); frozen = false;
  state = 'till'; objective('o_till');
}
async function finale() {
  if (state === 'end') return;
  state = 'end'; frozen = true; objective(null); prompt(null);
  await wait(750);
  black(1); fade(S.drone, 0, 300);
  await wait(500);
  play(S.who, 2.4); setTimeout(() => caption('who', 2600), 350);
  await wait(3300);
  $('end').style.display = 'flex'; $('langs').style.display = 'flex';
  document.exitPointerLock?.(); playing = false;
}

function reset() {
  stalker = null; state = 'intro'; frozen = false;
  envs.shop.entity.enabled = true; if (envs.corridor) envs.corridor.entity.enabled = false;
  envs.shop.setTint(sh.tint, DARK); if (envs.corridor) envs.corridor.setTint(co.tint, DARK);
  boss.setActive(true); boss.setReveal(1); placeChar(boss, sh.boss); anim(boss, 'count', true);
  granny.setReveal(0); granny.setActive(false);
  setPlayer(sh.spawnStart, 'shop'); black(0); fadeOut(0);
  for (const a of Object.values(S)) { a.pause(); a.currentTime = 0; }
}
async function begin() {
  $('start').style.display = 'none'; $('end').style.display = 'none'; $('langs').style.display = 'none';
  reset(); playing = true; $('crosshair').style.opacity = TOUCH ? 0 : 1;
  if (!TOUCH) canvas.requestPointerLock?.();
  S.drone.volume = 0; play(S.drone); fade(S.drone, 0.16, 4000);
  await wait(900);
  play(S.vo); caption('vo', 3600);
  await wait(4400);
  if (state !== 'intro') return;
  state = 'ring'; play(S.ring); objective('o_phone');
}

reset();
const go = $('go');
go.disabled = false; applyLang();
go.addEventListener('click', begin);
$('again').addEventListener('click', begin);
if (DEV) { $('start').style.display = 'none'; $('langs').style.display = 'none'; }
window.__ready = true;
window.__debug = { player, L, envs, boss, granny, corridorReady, interact, begin, finale, toCorridor, backToShop,
  get state() { return state; }, get stalker() { return stalker; },
  go(x, z, yaw = player.yaw, pitch = player.pitch) { Object.assign(player, { x, z, yaw, pitch }); },
  async show(k) { await corridorReady; envs.shop.entity.enabled = k === 'shop'; envs.corridor.entity.enabled = k === 'corridor'; player.scene = k; boss.setActive(k === 'shop'); },
  place(ch, x, z, yaw) { const c = ch === 'boss' ? boss : granny; c.setActive(true); c.setReveal(1); placeChar(c, { x, z, yaw }); } };
