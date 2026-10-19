import { Scene, Environment, Character, Animation } from '@viggle/splat-engine';
import { Vec3, Entity, StandardMaterial, Texture, Asset, BLEND_NORMAL } from 'playcanvas';
import { LANGS, LANG_DISPLAY, T, detectLang, saveLang } from './i18n.js';

// 收舖 Closing Time, Release 1: Night 1 and the present-day frame (GDD, 21 Oct 2026).
// You are 阿輝, the delivery boy. No fail state. The residents are never seen.

const BASE = import.meta.env.BASE_URL;
const A = (f) => BASE + 'assets/' + f;
const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const DEV = Q.has('dev');
const LITE = Q.has('lite');
const NOBODY = Q.has('nobody');          // kill switch: camera only, no 阿輝 body
const TOUCH = matchMedia('(hover:none) and (pointer:coarse)').matches || Q.has('touch');
if (TOUCH) document.documentElement.classList.add('touch');

// ---------------------------------------------------------------------------
// Layout. Metres, floor at y = 0. Scenes are raw PINOC reconstructions placed
// with their capture point at 1.5 m; scale measured from the floor depth.
// ---------------------------------------------------------------------------
const EYE = 1.55;
const DARK = { r: 0.012, g: 0.026, b: 0.03 };
const L = {
  shop: {
    file: 'shop.spz', scale: 2.34, tint: 0.32,
    bounds: { x0: -0.9, x1: 0.85, z0: -2.8, z1: 5.6 },   // the aisle; street door at -z
    spawn: { x: 0.0, z: 3.8, yaw: 0 },
    till: { x: 1.6, z: -2.4, y: 1.15 },                    // the cold green pool sits here
    boss: { x: 2.05, z: -2.4, yaw: -90 },                  // 祥哥 behind the counter (measured)
    note: { yaw: -40 },                                    // he turns so the note comes at you
    exit: { x: 0.0, z: -3.05 },
    back: { x: 0.0, z: -2.7, yaw: 180 },
    handStand: { x: 0.3, z: -2.0, yaw: -77 },   // clear of the side wall, 祥哥 in full view
    booth: { from: { x: 0.35, y: 1.35, z: 4.9 }, to: { x: 0.05, y: 1.25, z: 3.3 }, look: { x: -1.35, y: 0.95, z: 2.3 } },
  },
  corridor: {
    file: 'corridor2.spz', scale: 1.74, tint: 0.05,
    bounds: { x0: -0.5, x1: 0.5, z0: -3.05, z1: 4.35 },
    spawn: { x: 0, z: 4.0, yaw: 0 },                       // stair end, facing the green door at -z
    door: { x: -0.13, z: -3.71, latchX: 0.33, h: 2.05 },          // measured by projecting the floor in Chrome
    knockStand: { x: -0.42, z: -2.98 },   // his knocking hand lands on the door, not the wall
    watchStand: { x: -0.15, z: -2.35 },   // one step back: the crack and the floor in view
    floorMoney: { x: -0.1, z: -2.95 },
    tubeAt: 2.0, gateAt: -0.9,                             // z where the dread beats fire
    exit: 4.25,
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
function caption(k, ms = 2600) { const c = $('caption'); c.textContent = t(k); c.classList.toggle('sfx', k.startsWith('s_')); c.style.opacity = 1; clearTimeout(capTimer); capTimer = setTimeout(() => (c.style.opacity = 0), ms); }
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
function card(k, on) { const c = $('chapter'); if (on) { c.textContent = t(k); c.style.opacity = 1; } else c.style.opacity = 0; }

(() => { // film grain
  if (LITE) return;
  const g = $('grain'), ctx = g.getContext('2d');
  g.width = 200; g.height = 200; g.style.width = '100%'; g.style.height = '100%'; g.style.imageRendering = 'pixelated';
  const img = ctx.createImageData(200, 200);
  const tickG = () => { for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; } ctx.putImageData(img, 0, 0); setTimeout(tickG, 70); };
  tickG();
})();

// ---------------------------------------------------------------------------
// Audio. No music: the drone and the room.
// ---------------------------------------------------------------------------
function snd(name, { loop = false, vol = 1 } = {}) { const a = new Audio(A(name)); a.loop = loop; a.volume = vol; a.preload = 'auto'; return a; }
const S = {
  vo: snd('vo.mp3', { vol: 0.95 }), vo2: snd('vo2.mp3', { vol: 0.95 }),
  ring: snd('ring.mp3', { loop: true, vol: 0 }), call: snd('call.mp3', { vol: 0.9 }), order: snd('order.mp3'),
  knock: snd('knock.mp3'), takeaway: snd('takeaway.mp3'), door: snd('dooropen.mp3', { vol: 0.8 }), latch: snd('latch.mp3'),
  tube: snd('tube.mp3', { vol: 0.5 }), gate: snd('gate.mp3', { vol: 0.85 }), money: snd('money.mp3', { vol: 0.8 }),
  mahjong: snd('mahjong.mp3', { loop: true, vol: 0 }), steps: snd('steps.mp3', { loop: true, vol: 0 }),
  who: snd('who.mp3'), drone: snd('drone.mp3', { loop: true, vol: 0 }),
};
function fade(a, to, ms) { const from = a.volume, t0 = performance.now(); const step = () => { const k = Math.min(1, (performance.now() - t0) / ms); a.volume = from + (to - from) * k; if (k < 1) requestAnimationFrame(step); }; step(); }
function play(a, from = 0) { try { a.currentTime = from; const p = a.play(); if (p) p.catch(() => {}); } catch { /* ignore */ } }
function stop(a) { a.pause(); a.volume = 0; }

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
if (!LITE) canvas.style.filter = 'contrast(1.06) saturate(0.8) brightness(1.12)';

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
envs.shop = await loadEnv('shop', (k) => (bar.style.width = (k * 70).toFixed(1) + '%'));

await Animation.loadGlb(scene, A('idle.glb'), 'idle');
const ANIMS = new Set(['idle']);
await Promise.all(['phone', 'send', 'count', 'note', 'walk', 'knock', 'pickup', 'handover'].map((n) =>
  Animation.loadGlb(scene, A(`m-${n}.glb`), n).then(() => ANIMS.add(n)).catch(() => {})));
function anim(ch, name, loop = true, fadeS = 0.3) {
  const n = ANIMS.has(name) ? name : 'idle';
  if (ch.currentAnimationName === n && loop) return;
  try { ch.crossfadeTo(n, { duration: fadeS, loop: n === 'idle' ? true : loop }); } catch { ch.playAnimation(n, { loop }); }
}
const boss = await Character.load(scene, A('xiangge.vsplat'));
boss.setLayers([scene.envLayerId]); boss.playAnimation('count', { loop: true }); boss.setTint(0.22, DARK);
const fai = await Character.load(scene, A('ahfai.vsplat'));
fai.setLayers([scene.envLayerId]); fai.playAnimation('idle', { loop: true }); fai.setTint(0.2, DARK);
if (NOBODY) fai.setActive(false);
const HEAD = Math.max(0, fai.armature.boneNames.findIndex((n) => /^head$/i.test(n)));
bar.style.width = '85%';

const corridorReady = loadEnv('corridor', (k) => (bar.style.width = (85 + k * 15).toFixed(1) + '%'))
  .then((e) => { envs.corridor = e; e.entity.enabled = false; bar.style.width = '100%'; });

// Props are drawn as images projected into the scene (homography onto the screen), so they
// carry their reference textures exactly. They sit over the splats; nothing in the shots needs to hide them.
const propLayer = $('props');
function propImg(file) { const im = document.createElement('img'); im.src = A(file); im.className = 'prop'; propLayer.appendChild(im); im.__on = false; return im; }
const bag = propImg('prop-bag.png'); bag.__w = 0.24; bag.__h = 0.48;
const floorNotes = [0, 1, 2].map(() => propImg('prop-note.jpg'));
const handNotes = propImg('prop-note.jpg');
const notes = { set enabled(v) { for (const n of floorNotes) n.__on = v; } };
const BONE = (n) => Math.max(0, fai.armature.boneNames.findIndex((b) => b.toLowerCase() === n));
const HAND_L = BONE('hand_l'), HAND_R = BONE('hand_r');
const bonePos = (i) => { const m = fai.armature.getBoneWorldMatrix(i); return m ? m.getTranslation(new Vec3()) : null; };
const carry = { bag: false, notes: false };
const floorPose = [{ x: 0, z: 0, r: 0 }, { x: 0, z: 0, r: 0 }, { x: 0, z: 0, r: 0 }];
let bagAt = null;
const pv = new Vec3(), ps = new Vec3();
function toScreen(p) { pv.set(p.x, p.y, p.z); cam.camera.worldToScreen(pv, ps); const c = cam.getPosition(), f = cam.forward; return { x: ps.x, y: ps.y, front: (p.x - c.x) * f.x + (p.y - c.y) * f.y + (p.z - c.z) * f.z > 0.05 }; }
function homography(w, h, q) {   // maps (0,0) (w,0) (w,h) (0,h) to the four screen points q
  const [x0, y0, x1, y1, x2, y2, x3, y3] = [q[0].x, q[0].y, q[1].x, q[1].y, q[2].x, q[2].y, q[3].x, q[3].y];
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1; const g = (sx * dy2 - dx2 * sy) / den, hh = (dx1 * sy - sx * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + hh * x3, d = y1 - y0 + g * y1, e = y3 - y0 + hh * y3;
  return `matrix3d(${a / w},${d / w},0,${g / w},${b / h},${e / h},0,${hh / h},0,0,1,0,${x0},${y0},0,1)`;
}
function placeQuad(el, corners) {
  if (!el.complete || !el.naturalWidth) { el.style.display = 'none'; return; }
  const q = corners.map(toScreen); if (q.some((p) => !p.front)) { el.style.display = 'none'; return; }
  el.style.display = 'block'; el.style.transform = homography(el.naturalWidth, el.naturalHeight, q);
}
function flatQuad(c, w, h, yawDeg) { const r = yawDeg * Math.PI / 180, ax = { x: Math.cos(r) * w / 2, z: -Math.sin(r) * w / 2 }, az = { x: Math.sin(r) * h / 2, z: Math.cos(r) * h / 2 };
  return [{ x: c.x - ax.x - az.x, y: c.y, z: c.z - ax.z - az.z }, { x: c.x + ax.x - az.x, y: c.y, z: c.z + ax.z - az.z }, { x: c.x + ax.x + az.x, y: c.y, z: c.z + ax.z + az.z }, { x: c.x - ax.x + az.x, y: c.y, z: c.z - ax.z + az.z }]; }
function standQuad(c, w, h) { const rt = cam.right; return [{ x: c.x - rt.x * w / 2, y: c.y + h / 2, z: c.z - rt.z * w / 2 }, { x: c.x + rt.x * w / 2, y: c.y + h / 2, z: c.z + rt.z * w / 2 }, { x: c.x + rt.x * w / 2, y: c.y - h / 2, z: c.z + rt.z * w / 2 }, { x: c.x - rt.x * w / 2, y: c.y - h / 2, z: c.z - rt.z * w / 2 }]; }
function hide(el) { el.style.display = 'none'; }
function updateProps() {
  const corridor = player.scene === 'corridor' && envs.corridor && envs.corridor.entity.enabled;
  // carried things sit where a first-person eye can see them: low in the frame, swinging with the walk
  const held = (side, down, ahead) => { const c = cam.getPosition(), f = cam.forward, rt = cam.right, u = cam.up, sw = Math.sin(performance.now() / 260) * (player.moving ? 0.018 : 0.004);
    return { x: c.x + f.x * ahead + rt.x * side + u.x * (-down + sw), y: c.y + f.y * ahead + rt.y * side + u.y * (-down + sw), z: c.z + f.z * ahead + rt.z * side + u.z * (-down + sw) }; };
  if (carry.bag && !rail.on) placeQuad(bag, standQuad(held(-0.2, 0.3, 0.42), 0.17, 0.34));
  else if (bagAt && corridor) placeQuad(bag, standQuad(bagAt, bag.__w, bag.__h)); else hide(bag);
  floorNotes.forEach((n, i) => { if (n.__on && corridor) placeQuad(n, flatQuad({ x: floorPose[i].x, y: 0.012, z: floorPose[i].z }, 0.16, 0.062, floorPose[i].r)); else hide(n); });
  if (carry.notes && !rail.on) placeQuad(handNotes, standQuad(held(0.16, 0.2, 0.4), 0.13, 0.05));
  else hide(handNotes);
}
function dropBag() { carry.bag = false; const d = L.corridor.door; bagAt = { x: d.latchX - 0.08, y: 0.24, z: d.z + 0.3 }; }
const crack = new Entity('crack');
crack.addComponent('render', { type: 'box', castShadows: false }); crack.enabled = false; scene.app.root.addChild(crack);
{ const ov = scene.app.scene.layers.getLayerByName('OverlaySplats'); if (ov) crack.render.layers = [ov.id]; }
{ const m = new StandardMaterial(); m.useLighting = false; m.diffuse.set(0, 0, 0); m.emissive.set(0, 0, 0); m.update(); crack.render.material = m; }
async function openCrack(to, ms) {
  const d = L.corridor.door; crack.enabled = true; const w0 = crack.__w || 0; const t0 = performance.now();
  for (;;) { const k = Math.min(1, (performance.now() - t0) / ms), e = k * k * (3 - 2 * k), w = w0 + (to - w0) * e; crack.__w = w;
    crack.setLocalScale(Math.max(0.001, w), d.h, 0.02); crack.setPosition(d.latchX - w / 2, d.h / 2, d.z + 0.012); if (k >= 1) break; await wait(16); }
  if (to <= 0.001) crack.enabled = false;
}
async function slideNotes() {
  const p = L.corridor.floorMoney; const z0 = L.corridor.door.z + 0.02; const t0 = performance.now();
  const spread = [{ x: -0.09, z: 0.0, r: 14 }, { x: 0.06, z: 0.09, r: -9 }, { x: 0.15, z: -0.05, r: 31 }];
  notes.enabled = true;
  for (;;) { const k = Math.min(1, (performance.now() - t0) / 1400);
    spread.forEach((sp, i) => { const ki = Math.max(0, Math.min(1, k * 1.25 - i * 0.12)), e = 1 - (1 - ki) * (1 - ki);
      floorPose[i] = { x: p.x + sp.x * e, z: z0 + (p.z + sp.z - z0) * e, r: sp.r * e }; });
    if (k >= 1) break; await wait(16); }
}
function placeChar(ch, p) { ch.setPosition(p.x, 0.08, p.z); if (p.yaw !== undefined) ch.setRotation(0, p.yaw, 0); }

// ---------------------------------------------------------------------------
// The cold green pool at the till: a world-anchored glow over the dark shop
// ---------------------------------------------------------------------------
const pool = $('pool'); const tmpV = new Vec3(); const scr = new Vec3();
function updatePool() {
  if (player.scene !== 'shop' || !envs.shop.entity.enabled) { pool.style.opacity = 0; return; }
  const c = L.shop.till; tmpV.set(c.x, c.y, c.z);
  const cc = cam.camera; if (!cc) return;
  cc.worldToScreen(tmpV, scr);
  const d = Math.hypot(c.x - cam.getPosition().x, c.z - cam.getPosition().z);
  const behind = scr.z < 0;
  pool.style.opacity = behind ? 0 : 0.9;
  const size = Math.max(260, Math.min(1100, 1500 / (d + 0.4)));
  pool.style.transform = `translate(${scr.x - size / 2}px, ${scr.y - size / 2}px)`;
  pool.style.width = pool.style.height = size + 'px';
}

// ---------------------------------------------------------------------------
// Player: 阿輝, a PINOC body with the camera at his eyes
// ---------------------------------------------------------------------------
const cam = scene.cameraEntity;
const player = { x: 0, z: 3, yaw: 0, pitch: -4, bob: 0, scene: 'shop', moving: false, act: null, reach: 0.2, auto: false };
const rail = { on: false, p: null, l: null };  // frame shots drive the camera directly
const keys = new Set();
let locked = false, dragging = false, playing = false, frozen = false, walkHeld = false;
addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'KeyE' || e.code === 'Space') interact(); });
addEventListener('keyup', (e) => keys.delete(e.code));
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
function look(dx, dy, k) { if (frozen && !DEV) return; player.yaw -= dx * k; player.pitch = Math.max(-60, Math.min(50, player.pitch - dy * k)); }
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

function collide(nx, nz) { const b = L[player.scene].bounds; return [Math.max(b.x0, Math.min(b.x1, nx)), Math.max(b.z0, Math.min(b.z1, nz))]; }
function fwd() { const r = player.yaw * Math.PI / 180; return { x: -Math.sin(r), z: -Math.cos(r) }; }
function facing(p, deg) { const f = fwd(); const dx = p.x - player.x, dz = p.z - player.z; const d = Math.hypot(dx, dz) || 1; return (f.x * dx + f.z * dz) / d > Math.cos(deg * Math.PI / 180); }
const dist = (p) => Math.hypot(p.x - player.x, p.z - player.z);
const near = (p, r = 1.2, deg = 60) => dist(p) < r && facing(p, deg);
function setPlayer(p, sceneKey) { player.scene = sceneKey; player.x = p.x; player.z = p.z; player.yaw = p.yaw ?? 0; player.pitch = -4; }
async function turnTo(yaw, pitch, ms = 700) {   // ease the view, used when an action takes the camera
  const y0 = player.yaw, p0 = player.pitch; let dy = ((yaw - y0 + 540) % 360) - 180; const t0 = performance.now();
  for (;;) { const k = Math.min(1, (performance.now() - t0) / ms), e = k * k * (3 - 2 * k); player.yaw = y0 + dy * e; player.pitch = p0 + (pitch - p0) * e; if (k >= 1) break; await wait(16); }
}
async function walkTo(x, z, speed = 0.75) {   // 阿輝 walks there himself; no cuts, no teleports
  player.auto = true;
  for (;;) { const dx = x - player.x, dz = z - player.z, d = Math.hypot(dx, dz); if (d < 0.03) break;
    const st = Math.min(d, speed * 0.016); player.x += dx / d * st; player.z += dz / d * st; await wait(16); }
  player.auto = false;
}
async function act(name, ms) {               // 阿輝 does something with his own hands
  player.act = name; anim(fai, name, false, 0.25); await wait(ms); player.act = null; anim(fai, 'idle', true, 0.4);
}

const headM = { pos: new Vec3() };
function headPos() {
  if (NOBODY) return null;
  const m = fai.armature.getBoneWorldMatrix(HEAD); if (!m) return null;
  m.getTranslation(headM.pos); return headM.pos;
}

let last = performance.now();
scene.app.on('update', () => {
  const now = performance.now(); const dtReal = Math.min(0.3, (now - last) / 1000); const dt = Math.min(0.05, dtReal); last = now;
  let moving = false;
  if ((playing && !frozen) || DEV) {
    const f = fwd(), rg = { x: -f.z, z: f.x }; let mx = 0, mz = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp') || walkHeld) { mx += f.x; mz += f.z; }
    if (keys.has('KeyS') || keys.has('ArrowDown')) { mx -= f.x; mz -= f.z; }
    if (keys.has('KeyD')) { mx += rg.x; mz += rg.z; }
    if (keys.has('KeyA')) { mx -= rg.x; mz -= rg.z; }
    if (keys.has('ArrowLeft')) player.yaw += 90 * dt;
    if (keys.has('ArrowRight')) player.yaw -= 90 * dt;
    const m = Math.hypot(mx, mz);
    if (m > 0) { moving = true; const sp = 1.15 * dt / m; if (DEV) { player.x += mx * sp * 2; player.z += mz * sp * 2; } else [player.x, player.z] = collide(player.x + mx * sp, player.z + mz * sp); }
  }
  moving = moving || player.auto; player.moving = moving;
  if (playing && !DEV) tick(dtReal);

  // the body: stands where you stand, faces where you face
  const f = fwd();
  if (!NOBODY && !rail.on) {
    fai.setPosition(player.x - f.x * 0.16, 0.08, player.z - f.z * 0.16);
    fai.setRotation(0, player.yaw + 180, 0);
    if (!player.act) { anim(fai, moving ? 'walk' : 'idle', true, 0.25); fai.playbackSpeed = moving ? 0.8 : 1; }
  }
  if (rail.on) { cam.setPosition(rail.p.x, rail.p.y, rail.p.z); cam.lookAt(rail.l.x, rail.l.y, rail.l.z); }
  else {
    const h = headPos();
    if (!h) player.bob += moving ? dt * 7.5 : 0;
    const rch = player.reach + (moving ? 0.06 : 0);  // a little further out while walking, clear of his own head
    const ex = h ? h.x + f.x * rch : player.x, ez = h ? h.z + f.z * rch : player.z;
    const ey = h ? h.y + 0.04 : EYE + Math.sin(player.bob) * 0.018;
    const yr = player.yaw * Math.PI / 180, pr = player.pitch * Math.PI / 180;
    cam.setPosition(ex, ey, ez);
    cam.lookAt(ex - Math.sin(yr) * Math.cos(pr), ey + Math.sin(pr), ez - Math.cos(yr) * Math.cos(pr));
  }
  updatePool(); updateProps();
  if (DEV) $('objective').textContent = `${player.scene} x ${player.x.toFixed(2)} z ${player.z.toFixed(2)} yaw ${((player.yaw % 360) + 360) % 360 | 0} ${state}`;
});

// ---------------------------------------------------------------------------
// Story
// ---------------------------------------------------------------------------
let state = 'intro';
const sh = L.shop, co = L.corridor;
const beats = { tube: false, gate: false, steps: 0, stepsSaid: false, stopSaid: false };
let flick = 3, stepsTail = 0;

function tick(dt) {
  if (state === 'ring') {
    S.ring.volume = Math.max(0.15, Math.min(1, 1.8 / (dist(sh.till) + 0.6)));
    prompt(near(sh.till, 1.7, 60) ? 'p_counter' : null);
  } else if (state === 'leave') prompt(near(sh.exit, 1.6, 70) ? 'p_leave' : null);
  else if (state === 'door') {
    // mahjong grows as you near the green door
    S.mahjong.volume = Math.max(0.05, Math.min(0.75, 1.6 / (dist(co.door) + 0.4)));
    if (!beats.tube && player.z < co.tubeAt) { beats.tube = true; tubeFlicker(true); }
    if (!beats.gate && player.z < co.gateAt) { beats.gate = true; play(S.gate); caption('s_gate', 2400); }
    flick -= dt; if (beats.tube && flick < 0) { flick = 5 + Math.random() * 6; tubeFlicker(false); }
    prompt(dist(co.door) < 1.5 && facing(co.door, 50) ? 'p_knock' : null);
  } else if (state === 'money') prompt(dist(co.floorMoney) < 1.4 ? 'p_pickup' : null);
  else if (state === 'walkback') {
    // footsteps that are not yours: they walk when you walk, and stop a beat after you stop
    if (player.moving) { stepsTail = 0.35; if (S.steps.paused) play(S.steps); S.steps.volume = 0.55; beats.steps += dt; if (!beats.stepsSaid && beats.steps > 1.2) { beats.stepsSaid = true; caption('s_steps', 2400); } }
    else if (!S.steps.paused) { stepsTail -= dt; if (stepsTail <= 0) { S.steps.pause(); if (!beats.stopSaid && beats.steps > 2) { beats.stopSaid = true; caption('s_stepsStop', 2600); } } }
    if (player.z > co.exit) toShop();
  } else if (state === 'till') prompt(near(sh.till, 1.7, 60) ? 'p_hand' : null);
  else prompt(null);
}

async function tubeFlicker(withCaption) {
  const env = envs[player.scene]; const tint = L[player.scene].tint;
  play(S.tube, 0.2); if (withCaption) caption('s_tube', 2000);
  for (const ms of [70, 40, 120]) { black(0.9); env.setTint(0.9, { r: 0, g: 0, b: 0 }); await wait(ms); black(0); env.setTint(tint, DARK); await wait(90); }
}

async function interact() {
  if (!playing || frozen || !promptKey) return;
  const k = promptKey; prompt(null);
  if (k === 'p_counter') {
    state = 'call'; objective(null); frozen = true; stop(S.ring);
    anim(boss, 'phone', false);
    play(S.call); caption('call1', 1900);
    setTimeout(() => caption('call2', 1500), 2300);
    setTimeout(() => caption('call3', 1400), 4600);
    await wait(6600);
    anim(boss, 'send', false); play(S.order); setTimeout(() => caption('order', 3000), 100);
    await wait(3600);
    anim(boss, 'count', true); frozen = false; carry.bag = true;
    state = 'leave'; objective('o_deliver');
  } else if (k === 'p_leave') {
    state = 'travel'; objective(null);
    await toCorridor();
  } else if (k === 'p_knock') {
    state = 'knock'; objective(null); frozen = true;
    await turnTo(0, -4, 350); await walkTo(co.knockStand.x, co.knockStand.z);
    dropBag(); await wait(300);
    act('knock', 2600); await wait(500); play(S.knock);
    await wait(250); stop(S.mahjong); await wait(900); caption('s_stop', 2400);   // the room goes quiet
    await wait(1400); play(S.takeaway); caption('takeaway', 1800);
    await wait(2800);
    caption('silence', 1800); fade(S.drone, 0.12, 900); await wait(2600);
    // he steps back; the door opens a crack onto black, and the notes slide out to his feet
    player.act = 'step'; await walkTo(co.watchStand.x, co.watchStand.z, 0.5); player.act = null;
    await turnTo(-6, -40, 700);
    play(S.door); caption('s_crack', 2600); await openCrack(0.13, 2600);
    caption('s_notes', 2400); play(S.money); await slideNotes();
    await wait(600);
    state = 'money'; frozen = false; objective(null);
  } else if (k === 'p_pickup') {
    state = 'pickup'; frozen = true; prompt(null);
    // he picks them up without looking: eyes on the floor the whole time
    await turnTo(0, -40, 400); await walkTo(co.floorMoney.x, co.floorMoney.z + 0.55, 0.5);
    player.reach = 0.32; await turnTo(0, -50, 400);
    act('pickup', 3400); await wait(1500); play(S.money); notes.enabled = false; carry.notes = true; await wait(1900); player.reach = 0.2;
    play(S.latch); caption('s_latch', 1800); openCrack(0, 250);
    await wait(900);
    await turnTo(180, -6, 1400);       // turn your back on it
    bagAt = null;                      // and when you look again, the bag is gone
    fade(S.drone, 0.3, 2000);
    frozen = false; state = 'walkback'; objective('o_back');
  } else if (k === 'p_hand') {
    state = 'handover'; objective(null); frozen = true;
    await turnTo(-77, -8, 400); await walkTo(sh.handStand.x, sh.handStand.z); await turnTo(sh.handStand.yaw, -12, 400);
    act('handover', 2400); await wait(1300); carry.notes = false; play(S.money);
    caption('s_till', 2600); anim(boss, 'count', true);
    await wait(2800);
    // later that night, closing up the till
    fadeOut(1); await wait(1100); card('later', true); await wait(1700); card(null, false);
    anim(boss, 'count', true); player.yaw = sh.handStand.yaw; player.pitch = -8;
    await wait(400); fadeOut(0); caption('s_count', 2200);
    await wait(3800);
    // he stops counting, turns, and holds one note out to you
    boss.setRotation(0, sh.note.yaw, 0); anim(boss, 'note', false, 0.5);
    await wait(2400);
    $('note').classList.add('show');
    await wait(900);
    play(S.who, 2.4); setTimeout(() => caption('who', 2800), 350);
    await wait(3200);
    $('note').classList.remove('show'); black(1); fade(S.drone, 0, 600);
    await wait(1600);
    await frameEnd();
  }
}

async function toCorridor() {
  frozen = true; fadeOut(1); fade(S.drone, 0.05, 900); await wait(1000);
  if (!envs.corridor) { $('toast').textContent = t('loadingCorridor'); $('toast').style.opacity = 1; await corridorReady; $('toast').style.opacity = 0; }
  envs.shop.entity.enabled = false; envs.corridor.entity.enabled = true; boss.setActive(false);
  setPlayer(co.spawn, 'corridor');
  S.mahjong.volume = 0.05; play(S.mahjong);
  await wait(500); fadeOut(0); frozen = false; fade(S.drone, 0.22, 3000);
  setTimeout(() => caption('s_mahjong', 2600), 1600);
  state = 'door'; objective('o_door');
}
async function toShop() {
  if (state !== 'walkback') return;
  state = 'travel'; frozen = true; S.steps.pause(); fadeOut(1); objective(null); await wait(1000);
  envs.corridor.entity.enabled = false; envs.shop.entity.enabled = true;
  boss.setActive(true); placeChar(boss, sh.boss); anim(boss, 'idle', true);
  setPlayer(sh.back, 'shop');
  await wait(500); fadeOut(0); frozen = false;
  state = 'till'; objective('o_counter');
}

// the present-day frame: an empty booth, 輝叔's voice
async function railShot(from, to, lookAt, ms) {
  rail.on = true; fai.setActive(false); const t0 = performance.now();
  rail.l = lookAt;
  for (;;) { const k = Math.min(1, (performance.now() - t0) / ms), e = k * k * (3 - 2 * k);
    rail.p = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, z: from.z + (to.z - from.z) * e };
    if (k >= 1) break; await wait(16); }
}
function frameScene() { envs.shop.entity.enabled = true; if (envs.corridor) envs.corridor.entity.enabled = false; boss.setActive(false); player.scene = 'shop'; envs.shop.setTint(0.3, DARK); }
async function frameStart() {
  frameScene(); rail.on = true; rail.p = sh.booth.from; rail.l = sh.booth.look;
  black(1); card('present', true); await wait(1400); card(null, false); black(0);
  const push = railShot(sh.booth.from, sh.booth.to, sh.booth.look, 7000);
  await wait(900); play(S.vo); caption('vo', 3800);
  await push; await wait(400);
  black(1); await wait(700); card('past', true); await wait(1500); card(null, false);
  rail.on = false; if (!NOBODY) fai.setActive(true); envs.shop.setTint(sh.tint, DARK);
  boss.setActive(true); placeChar(boss, sh.boss); anim(boss, 'count', true);
  setPlayer(sh.spawn, 'shop');
  await wait(300); black(0);
}
async function frameEnd() {
  frameScene(); rail.on = true; rail.p = sh.booth.to; rail.l = sh.booth.look;
  black(1); card('present', true); await wait(1400); card(null, false); black(0);
  const drift = railShot(sh.booth.to, { x: sh.booth.to.x - 0.1, y: sh.booth.to.y, z: sh.booth.to.z - 0.35 }, sh.booth.look, 6500);
  await wait(800); play(S.vo2); caption('vo2', 4600);
  // the phone, once, far away
  await wait(5200); S.ring.volume = 0.35; play(S.ring); await wait(1900); stop(S.ring);
  await drift; black(1); await wait(900);
  $('end').style.display = 'flex'; $('langs').style.display = 'flex';
  document.exitPointerLock?.(); playing = false; state = 'end';
}

function reset() {
  state = 'intro'; frozen = false; rail.on = false; player.act = null;
  Object.assign(beats, { tube: false, gate: false, steps: 0, stepsSaid: false, stopSaid: false });
  envs.shop.entity.enabled = true; if (envs.corridor) envs.corridor.entity.enabled = false;
  envs.shop.setTint(sh.tint, DARK); if (envs.corridor) envs.corridor.setTint(co.tint, DARK);
  boss.setActive(true); placeChar(boss, sh.boss); anim(boss, 'count', true);
  if (!NOBODY) fai.setActive(true);
  setPlayer(sh.spawn, 'shop'); black(0); fadeOut(0); $('note').classList.remove('show'); notes.enabled = false; crack.enabled = false; crack.__w = 0; player.auto = false; carry.bag = false; carry.notes = false; bagAt = null; player.reach = 0.2;
  for (const a of Object.values(S)) { a.pause(); a.currentTime = 0; }
}
async function begin() {
  $('start').style.display = 'none'; $('end').style.display = 'none'; $('langs').style.display = 'none';
  reset(); playing = true; frozen = true; $('crosshair').style.opacity = TOUCH ? 0 : 1;
  if (!TOUCH) canvas.requestPointerLock?.();
  S.drone.volume = 0; play(S.drone); fade(S.drone, 0.16, 4000);
  await frameStart();
  frozen = false;
  await wait(1500);
  if (state !== 'intro') return;
  state = 'ring'; S.ring.volume = 0.2; play(S.ring); caption('s_ring', 2000); objective('o_phone');
}

reset();
const go = $('go');
go.disabled = false; applyLang();
go.addEventListener('click', begin);
$('again').addEventListener('click', begin);
if (DEV) { $('start').style.display = 'none'; $('langs').style.display = 'none'; }
window.__ready = true;
window.__debug = { cam, crack, notes, bag, floorNotes, floorPose, carry, dropBag, openCrack, slideNotes, walkTo, player, L, envs, boss, fai, corridorReady, interact, begin, toCorridor, toShop, frameStart, frameEnd, rail, S,
  get state() { return state; }, set state(v) { state = v; }, get playing() { return playing; }, set playing(v) { playing = v; },
  go(x, z, yaw = player.yaw, pitch = player.pitch) { Object.assign(player, { x, z, yaw, pitch }); },
  async show(k) { await corridorReady; envs.shop.entity.enabled = k === 'shop'; envs.corridor.entity.enabled = k === 'corridor'; player.scene = k; boss.setActive(k === 'shop'); } };
