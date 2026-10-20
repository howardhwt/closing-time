import { Scene, Environment, Character, Animation } from '@viggle/splat-engine';
import { Vec3, Entity, StandardMaterial, Texture, Asset, BLEND_NORMAL } from 'playcanvas';
import { LANGS, LANG_DISPLAY, T, detectLang, saveLang } from './i18n.js';
import STARTLE_PATH from './startle-path.json';

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
    // the till scene: geometry-guided panorama from the counter, PINOC + 3 fills. Rotated so the
    // street door is at -z and the counter at +x. Positions measured from the splat's own points.
    file: 'till.spz', scale: 2.236, rot: -90, tint: 0.1,
    bounds: { x0: -0.85, x1: 0.7, z0: -1.85, z1: 2.4 },   // between the drinks counter and the cashier counter
    camMaxZ: 2.9,                                          // the deep booths were never seen: keep the shoulder camera out
    spawn: { x: 0.05, z: 2.0, yaw: -8 },
    till: { x: 1.43, z: -0.13, y: 1.15 },                  // the register; the cold green pool sits here
    boss: { x: 2.25, z: -0.1, yaw: -90 },                  // 祥哥 behind the counter, facing the aisle
    bossPhone: { x: 2.2, z: -0.58, yaw: -90 },             // at the black phone while it rings
    note: { yaw: -90 },                                    // you stand straight in front of him
    exit: { x: 0.46, z: -1.85 },                           // the glass street door
    back: { x: 0.4, z: -1.6, yaw: 180 },
    handStand: { x: 0.05, z: -0.1, yaw: -90 },              // at the counter, the till between you
    booth: { from: { x: 0.0, y: 1.45, z: 1.2 }, to: { x: 0.1, y: 1.4, z: 0.9 }, look: { x: 1.43, y: 1.1, z: -0.13 } },
  },
  corridor: {
    file: 'corridor2.spz', scale: 1.74, tint: 0.0,
    bounds: { x0: -0.5, x1: 0.5, z0: -3.05, z1: 5.6 },
    spawn: { x: 0, z: 4.45, yaw: 0 },                      // at the top of the stairs, facing down the corridor to the green door
    camMaxZ: 4.5,                                          // the stairwell behind is unlit: keep the shoulder camera out of it
    door: { x: -0.13, z: -3.71, latchX: 0.33, h: 2.05 },          // measured by projecting the floor in Chrome
    knockStand: { x: -0.42, z: -2.98 },   // his knocking hand lands on the door, not the wall
    watchStand: { x: -0.15, z: -2.35 },   // one step back: the crack and the floor in view
    floorMoney: { x: -0.1, z: -2.95 },
    tubeAt: 2.0, gateAt: -0.9,                             // z where the dread beats fire
    exit: 5.05,                                            // into the dark stairwell, and down
    stairs: 3.7,                                           // z where [E] Go downstairs shows
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
// Mixer: every sound goes through a bus (voice, sfx, music) and a master gain, set from the menu.
const BUS_OF = { vo: 'voice', vo2: 'voice', call: 'voice', order: 'voice', takeaway: 'voice', who: 'voice', drone: 'music' };
const MIX = { master: 0.9, music: 0.8, sfx: 0.9, voice: 1.0 };
try { Object.assign(MIX, JSON.parse(localStorage.getItem('closing-mix') || '{}')); } catch { /* ignore */ }
const buses = {};
let actx = null, mjGain = null, mjLow = null;
function initAudio() {
  if (actx) return; try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const master = actx.createGain(); master.connect(actx.destination); buses.master = master;
    for (const b of ['music', 'sfx', 'voice']) { buses[b] = actx.createGain(); buses[b].connect(master); }
    applyMix();
    for (const [k, a] of Object.entries(S)) {
      const src = actx.createMediaElementSource(a); const bus = buses[BUS_OF[k] || 'sfx'];
      if (k === 'mahjong') { mjLow = actx.createBiquadFilter(); mjLow.type = 'lowpass'; mjLow.frequency.value = 400;
        mjGain = actx.createGain(); mjGain.gain.value = 0; src.connect(mjLow).connect(mjGain).connect(bus); S.mahjong.volume = 1; }
      else src.connect(bus);
    }
  } catch { actx = null; }
}
function applyMix() {
  if (buses.master) { buses.master.gain.value = MIX.master; for (const b of ['music', 'sfx', 'voice']) buses[b].gain.value = MIX[b]; }
  try { localStorage.setItem('closing-mix', JSON.stringify(MIX)); } catch { /* ignore */ }
}
function mahjongNear(d) {   // d = metres to the green door: a thin door getting thinner
  const k = Math.max(0, Math.min(1, 1 - (d - 0.6) / 7.5));
  if (mjGain) { mjGain.gain.value = 0.06 + 1.3 * Math.pow(k, 1.7); mjLow.frequency.value = 380 + 3600 * k * k; }
  else S.mahjong.volume = Math.min(1, 0.06 + 0.94 * Math.pow(k, 1.7));
}
function mahjongStop() { if (mjGain) mjGain.gain.value = 0; S.mahjong.pause(); }
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
if (!LITE) canvas.style.filter = 'contrast(1.04) saturate(0.85) brightness(1.3)';

applyLang();
const scene = await Scene.create(canvas, { fov: TOUCH ? 74 : 68, near: 0.05, far: 60, bgColor: { r: 0, g: 0, b: 0, a: 1 },
  cameraPosition: { x: 0, y: EYE, z: 3 }, cameraTarget: { x: 0, y: EYE, z: 0 } });
scene.start();
const bar = document.querySelector('#progress i');

async function loadEnv(key, onProgress) {
  const cfg = L[key];
  const url = await fetchBlob(A(cfg.file), onProgress);
  const env = await Environment.load(scene, url, { filename: key + '.spz', scale: cfg.scale, position: { x: 0, y: 1.5, z: 0 } });
  if (cfg.rot) env.entity.rotate(0, cfg.rot, 0);
  env.setTint(cfg.tint, DARK);
  return env;
}
const envs = {};
envs.shop = await loadEnv('shop', (k) => (bar.style.width = (k * 70).toFixed(1) + '%'));

await Animation.loadGlb(scene, A('idle.glb'), 'idle');
const ANIMS = new Set(['idle']);
await Promise.all(['phone', 'send', 'count', 'note', 'walk', 'startle', 'walkback', 'knock', 'pickup', 'handover'].map((n) =>
  Animation.loadGlb(scene, A(`m-${n}.glb`), n).then(() => ANIMS.add(n)).catch(() => {})));
function anim(ch, name, loop = true, fadeS = 0.3) {
  const n = ANIMS.has(name) ? name : 'idle';
  if (ch.currentAnimationName === n && loop) return;
  try { ch.crossfadeTo(n, { duration: fadeS, loop: n === 'idle' ? true : loop }); } catch { ch.playAnimation(n, { loop }); }
}
const boss = await Character.load(scene, A('xiangge.vsplat'));
boss.setLayers([scene.envLayerId]); boss.playAnimation('count', { loop: true }); boss.setTint(0.08, DARK);
const fai = await Character.load(scene, A('ahfai.vsplat'));
fai.setLayers([scene.envLayerId]); fai.playAnimation('idle', { loop: true }); fai.setTint(0.08, DARK);
if (NOBODY) fai.setActive(false);
const HEAD = Math.max(0, fai.armature.boneNames.findIndex((n) => /^head$/i.test(n)));
bar.style.width = '85%';

const corridorReady = loadEnv('corridor', (k) => (bar.style.width = (85 + k * 15).toFixed(1) + '%'))
  .then((e) => { envs.corridor = e; e.entity.enabled = false; bar.style.width = '100%'; });

// Props are real 3D: a modelled takeaway bag (GLB, built in Blender from the reference still) and
// thin notes printed with the 陰司紙. They draw on the overlay layer, unlit, dimmed to sit in the scene.
const OVERLAY = scene.app.scene.layers.getLayerByName('OverlaySplats')?.id ?? 0;
const PROP_GLOW = 0.62;
function unlit(mat) {
  mat.useLighting = false; const d = mat.diffuse; mat.emissive.set(d.r * PROP_GLOW, d.g * PROP_GLOW, d.b * PROP_GLOW);
  if (mat.diffuseMap) { mat.emissiveMap = mat.diffuseMap; mat.emissive.set(PROP_GLOW, PROP_GLOW, PROP_GLOW); }
  mat.diffuse.set(0, 0, 0); mat.update();
}
const bag = new Entity('bag', scene.app); bag.enabled = false; scene.app.root.addChild(bag);
scene.app.assets.loadFromUrl(A('prop-bag.glb'), 'container', (err, asset) => {
  if (err) return; const m = asset.resource.instantiateRenderEntity();
  m.findComponents('render').forEach((r) => { r.layers = [OVERLAY]; r.meshInstances.forEach((mi) => { mi.material = mi.material.clone(); unlit(mi.material); }); });
  bag.addChild(m);
});
const noteMat = new StandardMaterial(); noteMat.useLighting = false; noteMat.diffuse.set(0, 0, 0); noteMat.emissive.set(0.5, 0.5, 0.47); noteMat.update();
scene.app.assets.loadFromUrl(A('prop-note.jpg'), 'texture', (err, asset) => { if (!err) { noteMat.emissiveMap = asset.resource; noteMat.update(); } });
function noteEntity() { const e = new Entity('note', scene.app); e.addComponent('render', { type: 'box', castShadows: false }); e.render.layers = [OVERLAY]; e.render.material = noteMat; e.setLocalScale(0.16, 0.0015, 0.062); e.enabled = false; scene.app.root.addChild(e); return e; }
const floorNotes = [0, 1, 2, 3].map(noteEntity);
const handNotes = new Entity('handNotes', scene.app); scene.app.root.addChild(handNotes); handNotes.enabled = false;
[0, 1, 2, 3].forEach((i) => { const n = noteEntity(); n.enabled = true; scene.app.root.removeChild(n); handNotes.addChild(n); n.setLocalPosition(i * 0.006, i * 0.002, i * 0.004); n.setLocalEulerAngles(0, i * 7 - 10, 0); });
// once picked up, the notes go in his back pocket: a corner shows over the pocket in third person
const pocketNote = noteEntity(); pocketNote.setLocalScale(0.058, 0.04, 0.002);
const notes = { set enabled(v) { for (const n of floorNotes) n.enabled = v; } };
const BONE = (n) => Math.max(0, fai.armature.boneNames.findIndex((b) => b.toLowerCase() === n));
const HAND_L = BONE('hand_l'), HAND_R = BONE('hand_r'), PELVIS = BONE('pelvis');
const bonePos = (i) => { const m = fai.armature.getBoneWorldMatrix(i); return m ? m.getTranslation(new Vec3()) : null; };
const carry = { bag: false, notes: false, pocket: false };
const floorPose = [{ x: 0, z: 0, r: 0 }, { x: 0, z: 0, r: 0 }, { x: 0, z: 0, r: 0 }];
let bagAt = null;
function updateProps() {
  const corridor = player.scene === 'corridor' && envs.corridor && envs.corridor.entity.enabled;
  // in first person, what he carries sits low in the frame where an eye can see it, swinging with the walk
  const heldAt = (side, down, ahead) => { const c = cam.getPosition(), f = cam.forward, rt = cam.right, u = cam.up, sw = Math.sin(player.bob) * (player.moving ? 0.02 : 0.003);
    return { x: c.x + f.x * ahead + rt.x * side + u.x * (-down + sw), y: c.y + f.y * ahead + rt.y * side + u.y * (-down + sw), z: c.z + f.z * ahead + rt.z * side + u.z * (-down + sw) }; };
  const handAt = (i) => bonePos(i);
  if (carry.bag && !rail.on) {
    const p = view === 'third' ? handAt(HAND_L) : heldAt(-0.26, 0.22, 0.55);
    if (p) { bag.enabled = true; bag.setPosition(p.x, p.y, p.z); bag.setEulerAngles(0, camS.bodyYaw + 180 + Math.sin(player.bob * 0.5) * 6, Math.sin(player.bob) * 4); } else bag.enabled = false;
  } else if (bagAt && corridor) { bag.enabled = true; bag.setPosition(bagAt.x, bagAt.y, bagAt.z); bag.setEulerAngles(0, 12, 0); }
  else bag.enabled = false;
  floorNotes.forEach((n, i) => { if (n.enabled) { n.setPosition(floorPose[i].x, 0.004 + i * 0.002, floorPose[i].z); n.setEulerAngles(0, floorPose[i].r, 0); } });
  if (carry.notes && !rail.on) {
    const p = view === 'third' ? handAt(HAND_R) : heldAt(0.17, 0.26, 0.45);
    if (p) { handNotes.enabled = true; handNotes.setPosition(p.x, p.y, p.z); handNotes.setEulerAngles(view === 'third' ? 0 : 55, camS.bodyYaw + 180, 0); } else handNotes.enabled = false;
  } else handNotes.enabled = false;
  const showPocket = false;   // the pocket corner read badly on screen: the notes live in the inventory chip instead
  pocketNote.enabled = showPocket;
  if (showPocket) { const pv = bonePos(PELVIS); if (pv) { const b = camS.bodyYaw * Math.PI / 180, fx = -Math.sin(b), fz = -Math.cos(b), rx = -fz, rz = fx;
    pocketNote.setPosition(pv.x - fx * 0.12 + rx * 0.09, pv.y - 0.05, pv.z - fz * 0.12 + rz * 0.09); pocketNote.setEulerAngles(0, camS.bodyYaw + 180, 9); } }
  $('inv').style.opacity = carry.pocket ? 1 : 0;
}
function dropBag() { carry.bag = false; const d = L.corridor.door; bagAt = { x: d.latchX - 0.1, y: 0.41, z: d.z + 0.3 }; }   // origin is the handles: 0.41 m tall
const crack = new Entity('crack', scene.app);
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
  const spread = [{ x: -0.09, z: 0.0, r: 14 }, { x: 0.06, z: 0.09, r: -9 }, { x: 0.15, z: -0.05, r: 31 }, { x: -0.02, z: 0.17, r: -24 }];
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
const rail = { on: false, p: null, l: null };
let view = 'first';   // V or the touch button switches to a camera over his shoulder
function toggleView() { view = view === 'first' ? 'third' : 'first'; camS.init = false; }  // frame shots drive the camera directly
// ---- input: named actions, bound per device (keyboard/mouse, gamepad, touch) ----
const BIND = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA'], right: ['KeyD'],
  turnL: ['ArrowLeft', 'KeyQ'], turnR: ['ArrowRight'], interact: ['KeyE', 'Space', 'Enter'], view: ['KeyV'],
};
const keys = new Set();
let locked = false, playing = false, frozen = false, walkHeld = false;
const held = (a) => BIND[a].some((k) => keys.has(k));
addEventListener('keydown', (e) => {
  if (menuOpen && e.code !== 'Escape') return;
  if (BIND.forward.concat(BIND.back, BIND.turnL, BIND.turnR, BIND.interact).includes(e.code) && playing) e.preventDefault();
  if (e.repeat) return; keys.add(e.code);
  if (BIND.interact.includes(e.code)) interact();         // edge: once per press
  if (BIND.view.includes(e.code)) toggleView();
  if (e.code === 'Escape' && playing) { if (menuOpen) closeMenu(); else openMenu(true); }
  if (e.code === 'KeyH' && playing) toggleLegend();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());             // no stuck keys after alt-tab
let lockWanted = false;
document.addEventListener('pointerlockchange', () => { const was = locked; locked = document.pointerLockElement === canvas; $('lookhint').style.opacity = playing && !locked && !TOUCH && !menuOpen && !legendOn ? 1 : 0;
  if (was && !locked && playing && !menuOpen && !lockWanted) openMenu(true); lockWanted = false; });   // Esc while locked releases the cursor: that is the menu key
const LOOK = { mouse: 0.11, touch: 0.25, pad: 150, sens: 1 };      // deg per px / deg per second at full stick; sens from the menu
try { LOOK.sens = +localStorage.getItem('closing-sens') || 1; } catch { /* ignore */ }
let menuOpen = false;
function look(dx, dy, k) {
  if (frozen && !DEV) return;
  player.yaw -= dx * k; player.pitch = Math.max(view === 'third' ? -35 : -70, Math.min(view === 'third' ? 30 : 60, player.pitch - dy * k));
}
const mouse = { x: 0.5, y: 0.5, in: false };
if (!TOUCH) {
  // the view follows the mouse with no click needed; clicking locks the cursor for unlimited turning
  canvas.addEventListener('mousedown', () => { if (!playing && !DEV) return; if (menuOpen) return; if (!locked) canvas.requestPointerLock?.(); else interact(); });
  addEventListener('mousemove', (e) => {
    mouse.x = e.clientX / innerWidth; mouse.y = e.clientY / innerHeight; mouse.in = true;
    if (!(playing || DEV) || menuOpen) return; look(e.movementX, e.movementY, LOOK.mouse * LOOK.sens);
  });
  document.addEventListener('mouseleave', () => (mouse.in = false));
}
function edgeTurn(dt) {   // unlocked cursor near the left/right edge keeps turning, so the cursor never runs out of screen
  if (locked || TOUCH || !mouse.in || !playing || menuOpen) return;
  const e = 0.07; let k = 0; if (mouse.x < e) k = (e - mouse.x) / e; else if (mouse.x > 1 - e) k = -(mouse.x - (1 - e)) / e;
  if (k) look(-k * 160 * dt / (LOOK.mouse * LOOK.sens), 0, LOOK.mouse * LOOK.sens);
}
if (TOUCH) {
  $('touch').style.display = 'block';
  let lt = null;
  canvas.addEventListener('touchstart', (e) => { const tt = e.changedTouches[0]; lt = { id: tt.identifier, x: tt.clientX, y: tt.clientY }; }, { passive: true });
  canvas.addEventListener('touchmove', (e) => { for (const tt of e.changedTouches) if (lt && tt.identifier === lt.id) { look(tt.clientX - lt.x, tt.clientY - lt.y, LOOK.touch); lt.x = tt.clientX; lt.y = tt.clientY; } }, { passive: true });
  canvas.addEventListener('touchend', () => (lt = null), { passive: true });
  const wb = $('walkBtn');
  wb.addEventListener('touchstart', (e) => { e.preventDefault(); walkHeld = true; });
  wb.addEventListener('touchend', (e) => { e.preventDefault(); walkHeld = false; });
  wb.addEventListener('touchcancel', () => (walkHeld = false));
  $('actBtn').addEventListener('touchstart', (e) => { e.preventDefault(); interact(); });
  $('viewBtn').addEventListener('touchstart', (e) => { e.preventDefault(); toggleView(); });
}
// gamepad: radial deadzone on each stick; A interact, Y view (edge-detected)
const padPrev = { a: false, y: false };
function deadzone(x, y, dz = 0.2) { const m = Math.hypot(x, y); if (m < dz) return [0, 0]; const k = (m - dz) / (1 - dz) / m; return [x * k, y * k]; }
function readPad(dt) {
  const gp = navigator.getGamepads?.().find((g) => g && g.connected); if (!gp) return { mx: 0, my: 0 };
  const [mx, my] = deadzone(gp.axes[0] || 0, gp.axes[1] || 0); const [lx, ly] = deadzone(gp.axes[2] || 0, gp.axes[3] || 0);
  if (lx || ly) look(lx * LOOK.pad * dt / LOOK.mouse * LOOK.mouse, ly * LOOK.pad * dt * 0.7, 1);
  const a = !!gp.buttons[0]?.pressed, y = !!gp.buttons[3]?.pressed;
  if (a && !padPrev.a) interact(); if (y && !padPrev.y) toggleView(); padPrev.a = a; padPrev.y = y;
  return { mx, my };
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
async function walkTo(x, z, speed = 1.0) {   // 阿輝 walks there himself; no cuts, no teleports
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
// 祥哥 keeps an eye on you: his body turns to follow 阿輝 around the shop, within what the counter allows
const bossS = { x: 0, z: 0, yaw: -90, rate: 2.5, walk: null };
function placeBoss(p) { bossS.x = p.x; bossS.z = p.z; if (p.yaw !== undefined) bossS.yaw = p.yaw; boss.setPosition(p.x, 0.08, p.z); boss.setRotation(0, bossS.yaw, 0); }
async function bossWalk(to, ms = 1100) { anim(boss, 'walk', true, 0.2); boss.playbackSpeed = 0.7; const x0 = bossS.x, z0 = bossS.z, t0 = performance.now();
  for (;;) { const k = Math.min(1, (performance.now() - t0) / ms), e = k * k * (3 - 2 * k); bossS.x = x0 + (to.x - x0) * e; bossS.z = z0 + (to.z - z0) * e; boss.setPosition(bossS.x, 0.08, bossS.z); if (k >= 1) break; await wait(16); }
  boss.playbackSpeed = 1; }
// Clips turn his torso on their own (the old send-off starts ~40 degrees off), so aiming the entity is not enough:
// measure where his chest actually points (shoulder line) and steer the entity until the chest points at 阿輝.
const BB = (n) => boss.armature.boneNames.findIndex((b) => b.toLowerCase() === n);
const B_UL = BB('upperarm_l'), B_UR = BB('upperarm_r');
const bossV = { l: new Vec3(), r: new Vec3() };
function bossChestYaw() {
  if (B_UL < 0 || B_UR < 0) return null;
  const ml = boss.armature.getBoneWorldMatrix(B_UL), mr = boss.armature.getBoneWorldMatrix(B_UR); if (!ml || !mr) return null;
  ml.getTranslation(bossV.l); mr.getTranslation(bossV.r);
  const vx = bossV.r.x - bossV.l.x, vz = bossV.r.z - bossV.l.z;   // left shoulder to right shoulder
  return Math.atan2(vz, -vx) * 180 / Math.PI;                      // forward = up x (R - L)
}
function updateBoss(dt) {
  if (player.scene !== 'shop' || !envs.shop.entity.enabled) return;
  const want = Math.atan2(player.x - bossS.x, player.z - bossS.z) * 180 / Math.PI;   // a character at yaw 0 faces +z
  const lim = Math.max(-170, Math.min(-10, ((want + 540) % 360) - 180));
  const chest = bossChestYaw();
  const err = chest === null ? ((lim - bossS.yaw + 540) % 360) - 180 : ((lim - chest + 540) % 360) - 180;
  bossS.yaw += err * (1 - Math.exp(-bossS.rate * dt)); boss.setRotation(0, bossS.yaw, 0);
}
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));   // frame-rate independent
const angDamp = (cur, target, rate, dt) => { const d = ((target - cur + 540) % 360) - 180; return cur + d * (1 - Math.exp(-rate * dt)); };
const SPEED = { fwd: 1.35, back: 0.75, side: 0.9 };    // m/s, a cautious delivery boy
const move = { vx: 0, vz: 0, lx: 0, lz: 0 };           // world velocity; local (forward/right) speed for the animation
const camS = { x: 0, y: EYE, z: 0, eye: EYE, init: false, bodyYaw: 0 };
const startle = { t0: 0, x0: 0, z0: 0, yaw: 0 };
let lastPos = { x: 0, z: 0 };

let last = performance.now();
scene.app.on('update', () => {
  const now = performance.now(); const dtReal = Math.min(0.3, (now - last) / 1000); const dt = Math.min(0.05, dtReal); last = now;
  const f = fwd(), rg = { x: -f.z, z: f.x };
  // wanted local velocity from actions
  let inF = 0, inR = 0;
  edgeTurn(dt);
  if ((playing && !frozen && !menuOpen) || DEV) {
    if (held('forward') || walkHeld) inF += 1; if (held('back')) inF -= 1;
    if (held('right')) inR += 1; if (held('left')) inR -= 1;
    if (held('turnL')) player.yaw += 100 * dt; if (held('turnR')) player.yaw -= 100 * dt;
    const pad = readPad(dt); inF -= pad.my; inR += pad.mx;
  }
  const im = Math.hypot(inF, inR); if (im > 1) { inF /= im; inR /= im; }
  const wantF = inF * (inF >= 0 ? SPEED.fwd : SPEED.back), wantR = inR * SPEED.side;
  const tvx = f.x * wantF + rg.x * wantR, tvz = f.z * wantF + rg.z * wantR;
  // accelerate / brake smoothly instead of snapping to full speed
  move.vx = damp(move.vx, tvx, im > 0 ? 9 : 12, dt); move.vz = damp(move.vz, tvz, im > 0 ? 9 : 12, dt);
  if (Math.hypot(move.vx, move.vz) > 0.01 && !player.auto) {
    if (DEV) { player.x += move.vx * dt * 2; player.z += move.vz * dt * 2; } else [player.x, player.z] = collide(player.x + move.vx * dt, player.z + move.vz * dt);
  }
  if (player.act === 'startle') {
    const P = STARTLE_PATH.xz, k = Math.min(P.length - 1.001, (performance.now() - startle.t0) / 1000 / STARTLE_PATH.dt), i = Math.floor(k), u = k - i;
    const lx = P[i][0] + (P[i + 1][0] - P[i][0]) * u, lz = P[i][1] + (P[i + 1][1] - P[i][1]) * u, r = startle.yaw * Math.PI / 180;
    [player.x, player.z] = collide(startle.x0 + lx * Math.cos(r) + lz * Math.sin(r), startle.z0 - lx * Math.sin(r) + lz * Math.cos(r));
  }
  // what actually happened this frame (covers scripted walks too) drives the legs
  const dvx = (player.x - lastPos.x) / Math.max(dt, 1e-3), dvz = (player.z - lastPos.z) / Math.max(dt, 1e-3); lastPos = { x: player.x, z: player.z };
  move.lx = damp(move.lx, dvx * f.x + dvz * f.z, 10, dt); move.lz = damp(move.lz, dvx * rg.x + dvz * rg.z, 10, dt);
  const speed = Math.hypot(move.lx, move.lz);
  const moving = speed > 0.12; player.moving = moving;
  if (playing && !DEV) tick(dtReal);

  // the body: legs match the ground speed; the torso turns toward a sidestep instead of sliding
  if (!NOBODY && !rail.on) {
    let face = player.yaw;
    if (moving && move.lx > -0.1) face = player.yaw - Math.atan2(move.lz, Math.max(0.2, move.lx)) * 180 / Math.PI * 0.8;
    camS.bodyYaw = camS.init ? angDamp(camS.bodyYaw, face, 12, dt) : face;
    const off = view === 'third' ? 0 : 0.16; fai.setPosition(player.x - f.x * off, 0.08, player.z - f.z * off);
    fai.setRotation(0, camS.bodyYaw + 180, 0);
    if (!player.act) {
      if (!moving) { anim(fai, 'idle', true, 0.3); fai.playbackSpeed = 1; }
      else if (move.lx < -0.1) { anim(fai, 'walkback', true, 0.25); fai.playbackSpeed = Math.max(0.5, Math.min(1.3, -move.lx / SPEED.back)); }
      else { anim(fai, 'walk', true, 0.25); fai.playbackSpeed = Math.max(0.45, Math.min(1.3, speed / 1.45)); }
    }
  }

  // cameras: smoothed, frame-rate independent, applied after the body has moved
  if (rail.on) { cam.setPosition(rail.p.x, rail.p.y, rail.p.z); cam.lookAt(rail.l.x, rail.l.y, rail.l.z); camS.init = false; }
  else {
    const yr = player.yaw * Math.PI / 180, pr = player.pitch * Math.PI / 180;
    const lookDir = { x: -Math.sin(yr) * Math.cos(pr), y: Math.sin(pr), z: -Math.cos(yr) * Math.cos(pr) };
    if (view === 'third' && !NOBODY) {
      // spring arm over the right shoulder: pull in rather than leave the room
      const pivot = { x: player.x, y: 1.55, z: player.z };
      const want = 1.6, side = 0.32, b = L[player.scene].bounds, zmax = L[player.scene].camMaxZ ?? b.z1 + 0.3;
      let arm = want;
      for (; arm > 0.35; arm -= 0.05) {
        const px = pivot.x - lookDir.x * arm + rg.x * side, pz = pivot.z - lookDir.z * arm + rg.z * side;
        if (px > b.x0 - 0.02 && px < b.x1 + 0.02 && pz > b.z0 - 0.2 && pz < zmax) break;
      }
      // never leave the walkable box: if even the shortest arm pokes out, slide the camera back inside rather than into the wall
      const tx = Math.max(b.x0 - 0.02, Math.min(b.x1 + 0.02, pivot.x - lookDir.x * arm + rg.x * side)), ty = pivot.y + 0.28 - lookDir.y * arm, tz = Math.max(b.z0 - 0.2, Math.min(zmax, pivot.z - lookDir.z * arm + rg.z * side));
      if (!camS.init) Object.assign(camS, { x: tx, y: ty, z: tz, init: true });
      camS.x = damp(camS.x, tx, 14, dt); camS.y = damp(camS.y, ty, 14, dt); camS.z = damp(camS.z, tz, 14, dt);
      cam.setPosition(camS.x, camS.y, camS.z);
      cam.lookAt(pivot.x + lookDir.x * 2 + rg.x * side * 0.5, pivot.y + 0.1 + lookDir.y * 2, pivot.z + lookDir.z * 2 + rg.z * side * 0.5);
    } else {
      // eyes: steady x/z in front of the face; height follows the head (crouches, breathing) but smoothed
      const h = headPos();
      const eyeT = h ? h.y + 0.04 : EYE;
      camS.eye = camS.init ? damp(camS.eye, eyeT, player.act ? 9 : 6, dt) : eyeT;
      player.bob += speed * dt * 5.2;
      const bob = Math.sin(player.bob) * 0.012 * Math.min(1, speed / SPEED.fwd);
      const rch = player.reach;
      let ex = player.x + f.x * (rch - 0.16 + 0.12), ez = player.z + f.z * (rch - 0.16 + 0.12); const ey = camS.eye + bob;
      { const b = L[player.scene].bounds; ex = Math.max(b.x0 - 0.04, Math.min(b.x1 + 0.04, ex)); ez = Math.max(b.z0 - 0.1, Math.min(b.z1 + 0.1, ez)); }   // eyes stay out of the walls too
      camS.init = true; camS.x = ex; camS.y = ey; camS.z = ez;
      cam.setPosition(ex, ey, ez);
      cam.lookAt(ex + lookDir.x, ey + lookDir.y, ez + lookDir.z);
    }
  }
  updateBoss(dt); updatePool(); updateProps();
  if (DEV) $('objective').textContent = `${player.scene} x ${player.x.toFixed(2)} z ${player.z.toFixed(2)} yaw ${((player.yaw % 360) + 360) % 360 | 0} ${state}`;
});

// ---------------------------------------------------------------------------
// Story
// ---------------------------------------------------------------------------
let state = 'intro';
const sh = L.shop, co = L.corridor;
const beats = { tube: false, gate: false, steps: 0, stepsSaid: false, stopSaid: false, lookT: 0, walked: 0, lx: 0, lz: 0 };
let flick = 3, stepsTail = 0;

function tick(dt) {
  if (state === 'look') {
    // closing time: a last look round before the phone goes
    beats.lookT = (performance.now() - beats.t0) / 1000; beats.walked += Math.hypot(player.x - beats.lx, player.z - beats.lz); beats.lx = player.x; beats.lz = player.z;
    if ((beats.walked > 4 && beats.lookT > 8) || beats.lookT > 30) startRing();
  } else if (state === 'ring') {
    S.ring.volume = Math.max(0.15, Math.min(1, 1.8 / (dist(sh.till) + 0.6)));
    prompt(near(sh.till, 1.7, 60) ? 'p_counter' : null);
  } else if (state === 'leave') prompt(near(sh.exit, 1.6, 70) ? 'p_leave' : null);
  else if (state === 'door') {
    // mahjong grows as you near the green door
    mahjongNear(dist(co.door));
    if (!beats.tube && player.z < co.tubeAt) { beats.tube = true; tubeFlicker(true); }
    if (!beats.gate && player.z < co.gateAt) { beats.gate = true; play(S.gate); caption('s_gate', 2400); }
    flick -= dt; if (beats.tube && flick < 0) { flick = 5 + Math.random() * 6; tubeFlicker(false); }
    prompt(dist(co.door) < 1.5 && facing(co.door, 50) ? 'p_knock' : null);
  } else if (state === 'money') prompt(dist(co.floorMoney) < 1.4 ? 'p_pickup' : null);
  else if (state === 'walkback') {
    // footsteps that are not yours: they walk when you walk, and stop a beat after you stop
    if (player.moving) { stepsTail = 0.35; if (S.steps.paused) play(S.steps); S.steps.volume = 0.55; beats.steps += dt; if (!beats.stepsSaid && beats.steps > 1.2) { beats.stepsSaid = true; caption('s_steps', 2400); } }
    else if (!S.steps.paused) { stepsTail -= dt; if (stepsTail <= 0) { S.steps.pause(); if (!beats.stopSaid && beats.steps > 2) { beats.stopSaid = true; caption('s_stepsStop', 2600); } } }
    prompt(player.z > co.stairs && facing({ x: 0, z: co.exit + 1 }, 70) ? 'p_stairs' : null);
    if (player.z > co.exit) toShop();
  } else if (state === 'till') prompt(near(sh.till, 1.7, 60) ? 'p_hand' : null);
  else if (state === 'bosscall') prompt(near(sh.till, 1.8, 65) ? 'p_boss' : null);
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
    bossS.rate = 5; anim(boss, 'phone', false);
    play(S.call); caption('call1', 1900);
    setTimeout(() => caption('call2', 1500), 2300);
    setTimeout(() => caption('call3', 1400), 4600);
    await wait(6600);
    bossS.rate = 9; anim(boss, 'send', false); play(S.order); setTimeout(() => caption('order', 3000), 100);   // turns square on to you to send you off
    await wait(3600);
    frozen = false; carry.bag = true; bossS.rate = 2.5;
    bossWalk(sh.boss).then(() => anim(boss, 'count', true));
    state = 'leave'; objective('o_deliver');
  } else if (k === 'p_leave') {
    state = 'travel'; objective(null);
    await toCorridor();
  } else if (k === 'p_knock') {
    state = 'knock'; objective(null); frozen = true;
    await turnTo(0, -4, 350); await walkTo(co.knockStand.x, co.knockStand.z);
    dropBag(); await wait(300);
    act('knock', 2600); await wait(500); play(S.knock);
    await wait(250); mahjongStop(); await wait(900); caption('s_stop', 2400);   // the room goes quiet
    await wait(1400); play(S.takeaway); caption('takeaway', 1800);
    await wait(2800);
    caption('silence', 1800); fade(S.drone, 0.12, 900); await wait(2600);
    // the door jerks open a crack onto black; he hops back from it, frightened, eyes still on the gap
    play(S.door); caption('s_crack', 2600); openCrack(0.13, 380);
    await wait(120);
    if (ANIMS.has('startle')) {
      // the clip carries its own two steps back (off4, about 0.55 m): its root motion moves the player, and the camera with him
      // the engine plays clips in place, so his travel is replayed from the clip's own pelvis track (baked offline)
      startle.t0 = performance.now(); startle.x0 = player.x; startle.z0 = player.z; startle.yaw = camS.bodyYaw + 180;
      player.act = 'startle'; anim(fai, 'startle', false, 0.06); fai.playbackSpeed = 1;
      turnTo(-6, -50, 1400); await wait(3900);
      player.act = null; anim(fai, 'idle', true, 0.3);
    } else {
      player.act = 'step'; turnTo(-6, -50, 900); await walkTo(co.watchStand.x, co.watchStand.z, 0.9); await wait(200); player.act = null;
    }
    caption('s_notes', 2400); play(S.money); await slideNotes();
    await wait(600);
    state = 'money'; frozen = false; objective(null);
  } else if (k === 'p_pickup') {
    state = 'pickup'; frozen = true; prompt(null);
    // he picks them up without looking: eyes on the floor the whole time
    await turnTo(0, -40, 400); await walkTo(co.floorMoney.x, co.floorMoney.z + 0.55, 0.5);
    player.reach = 0.32; await turnTo(0, -50, 400);
    act('pickup', 3400); await wait(1500); play(S.money); notes.enabled = false; carry.notes = true; await wait(1300); carry.notes = false; carry.pocket = true; await wait(600); player.reach = 0.2;
    play(S.latch); caption('s_latch', 1800); openCrack(0, 250);
    await wait(900);
    await turnTo(180, -6, 1400);       // turn your back on it
    bagAt = null;                      // and when you look again, the bag is gone
    fade(S.drone, 0.3, 2000);
    frozen = false; state = 'walkback'; objective('o_back');
  } else if (k === 'p_hand') {
    state = 'handover'; objective(null); frozen = true;
    await turnTo(Math.atan2(-(sh.handStand.x - player.x), -(sh.handStand.z - player.z)) * 180 / Math.PI, -8, 400); await walkTo(sh.handStand.x, sh.handStand.z); await turnTo(sh.handStand.yaw, -12, 400);
    carry.pocket = false; carry.notes = true;            // out of the pocket, onto the counter
    act('handover', 2400); await wait(1300); carry.notes = false; play(S.money);
    caption('s_till', 2600); anim(boss, 'count', true);
    // he counts; you are free to wander
    await wait(1100); frozen = false; state = 'count1'; objective('o_wait');
    await wait(7000);
    // later that night, closing up the till
    fadeOut(1); await wait(1100); card('later', true); await wait(1700); card(null, false);
    anim(boss, 'count', true); state = 'count2'; objective('o_wait');
    await wait(400); fadeOut(0); caption('s_count', 2200);
    await wait(7000);
    // he stops counting and looks for you
    anim(boss, 'idle', true, 0.5); bossS.rate = 6; state = 'bosscall'; objective('o_boss');
  } else if (k === 'p_boss') {
    state = 'note'; objective(null); frozen = true;
    await turnTo(Math.atan2(-(sh.handStand.x - player.x), -(sh.handStand.z - player.z)) * 180 / Math.PI, -8, 400); await walkTo(sh.handStand.x, sh.handStand.z); await turnTo(sh.handStand.yaw, -10, 400);
    // he holds one note out to you
    bossS.rate = 9; anim(boss, 'note', false, 0.5);
    await wait(2400);
    $('note').classList.add('show');
    await wait(900);
    play(S.who, 2.4); setTimeout(() => caption('who', 2800), 350);
    await wait(3200);
    $('note').classList.remove('show'); black(1); fade(S.drone, 0, 600);
    await wait(1600);
    await frameEnd();
  } else if (k === 'p_stairs') {
    await toShop();
  }
}

async function toCorridor() {
  frozen = true; fadeOut(1); fade(S.drone, 0.05, 900); await wait(1000);
  if (!envs.corridor) { $('toast').textContent = t('loadingCorridor'); $('toast').style.opacity = 1; await corridorReady; $('toast').style.opacity = 0; }
  envs.shop.entity.enabled = false; envs.corridor.entity.enabled = true; boss.setActive(false);
  setPlayer(co.spawn, 'corridor');
  mahjongNear(dist(co.door)); play(S.mahjong);
  await wait(500); fadeOut(0); frozen = false; fade(S.drone, 0.22, 3000);
  setTimeout(() => caption('s_mahjong', 2600), 1600);
  state = 'door'; objective('o_door');
}
async function toShop() {
  if (state !== 'walkback') return;
  state = 'travel'; frozen = true; S.steps.pause(); fadeOut(1); objective(null); await wait(1000);
  envs.corridor.entity.enabled = false; envs.shop.entity.enabled = true;
  boss.setActive(true); placeBoss(sh.boss); bossS.rate = 2.5; anim(boss, 'idle', true);
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
function frameScene() { envs.shop.entity.enabled = true; if (envs.corridor) envs.corridor.entity.enabled = false; boss.setActive(false); player.scene = 'shop'; envs.shop.setTint(0.05, DARK); }
// the present-day frame: the till itself. A slow push on the drawer while 輝叔 remembers;
// at the end, the phone on the counter rings again.
async function still(file, ms, from = 1.0, to = 1.08, ox = 0, oy = 0) {
  const el = $('still'); el.src = A(file); el.style.transition = 'none';
  el.style.transform = `scale(${from})`; el.style.opacity = 0; await wait(50);
  el.style.transition = `transform ${ms}ms cubic-bezier(.3,.1,.3,1), opacity 900ms ease`;
  el.style.opacity = 1; el.style.transform = `scale(${to}) translate(${ox}%, ${oy}%)`;
  return () => { el.style.opacity = 0; };
}
async function frameStart() {
  frameScene(); rail.on = true; rail.p = sh.booth.from; rail.l = sh.booth.look;
  // no flash-forward: the night starts cold in 1989, and nothing about the notes is shown before it happens
  black(1); await wait(400); card('past', true); await wait(1700); card(null, false);
  rail.on = false; if (!NOBODY) fai.setActive(true); envs.shop.setTint(sh.tint, DARK);
  boss.setActive(true); placeBoss(sh.boss); anim(boss, 'count', true);
  setPlayer(sh.spawn, 'shop');
  await wait(300); black(0);
}
async function frameEnd() {
  frameScene(); rail.on = true; rail.p = sh.booth.to; rail.l = sh.booth.look;
  black(1); card('present', true); await wait(1400); card(null, false);
  const done = await still('frame-phone.jpg', 9000, 1.0, 1.1, -1, 0.5); black(0);
  await wait(900); play(S.vo2); caption('vo2', 4600);
  // the phone on the counter, once more
  await wait(5000); S.ring.volume = 0.7; play(S.ring); caption('s_ring', 1800); await wait(2100); stop(S.ring);
  black(1); await wait(600); done(); await wait(500);
  $('end').style.display = 'flex'; $('langs').style.display = 'flex';
  lockWanted = true; document.exitPointerLock?.(); playing = false; state = 'end'; $('legend').style.opacity = 0; $('menuBtn').style.display = 'none';
}

function reset() {
  state = 'intro'; frozen = false; rail.on = false; player.act = null;
  Object.assign(beats, { tube: false, gate: false, steps: 0, stepsSaid: false, stopSaid: false, lookT: 0, walked: 0, lx: sh.spawn.x, lz: sh.spawn.z });
  envs.shop.entity.enabled = true; if (envs.corridor) envs.corridor.entity.enabled = false;
  envs.shop.setTint(sh.tint, DARK); if (envs.corridor) envs.corridor.setTint(co.tint, DARK);
  boss.setActive(true); placeBoss(sh.boss); anim(boss, 'count', true);
  if (!NOBODY) fai.setActive(true);
  setPlayer(sh.spawn, 'shop'); black(0); fadeOut(0); $('note').classList.remove('show'); $('still').style.opacity = 0; notes.enabled = false; crack.enabled = false; crack.__w = 0; player.auto = false; carry.bag = false; carry.notes = false; bagAt = null; player.reach = 0.2; carry.pocket = false; bossS.rate = 2.5; closeMenu();
  for (const a of Object.values(S)) { a.pause(); a.currentTime = 0; }
}
async function begin() {
  initAudio(); if (actx && actx.state === 'suspended') actx.resume();
  $('start').style.display = 'none'; $('end').style.display = 'none'; $('langs').style.display = 'none';
  reset(); playing = true; frozen = true; $('crosshair').style.opacity = TOUCH ? 0 : 1; camS.init = false; toggleLegend(legendOn); $('menuBtn').style.display = 'block';
  if (!TOUCH) canvas.requestPointerLock?.();
  setTimeout(() => { $('lookhint').style.opacity = !locked && !TOUCH && !legendOn ? 1 : 0; }, 400);
  S.drone.volume = 0; play(S.drone); fade(S.drone, 0.16, 4000);
  await frameStart();
  frozen = false;
  placeBoss(sh.bossPhone);
  beats.lx = player.x; beats.lz = player.z; beats.t0 = performance.now(); state = 'look'; objective('o_look');
}
function startRing() {
  if (state !== 'look') return;
  state = 'ring'; S.ring.volume = 0.2; play(S.ring); caption('s_ring', 2000); objective('o_phone');
}

// ---------------------------------------------------------------------------
// Menu (Esc) and the controls legend (H)
// ---------------------------------------------------------------------------
function openMenu(fromEsc) {
  if (!playing || menuOpen) return; menuOpen = true; prompt(null);
  $('menu').style.display = 'flex'; $('langs').style.display = 'flex'; $('lookhint').style.opacity = 0;
  if (locked) { lockWanted = true; document.exitPointerLock?.(); }
  for (const k of ['master', 'music', 'sfx', 'voice']) $('v_' + k).value = Math.round(MIX[k] * 100);
  $('v_sens').value = Math.round(LOOK.sens * 100); $('legendChk').checked = legendOn;
}
function closeMenu() { if (!menuOpen) return; menuOpen = false; $('menu').style.display = 'none'; $('langs').style.display = 'none'; promptKey = null; }
let legendOn = true;
try { legendOn = localStorage.getItem('closing-legend') !== '0'; } catch { /* ignore */ }
function toggleLegend(v = !legendOn) { legendOn = v; $('legend').style.opacity = legendOn && playing ? 1 : 0; try { localStorage.setItem('closing-legend', legendOn ? '1' : '0'); } catch { /* ignore */ } }
for (const k of ['master', 'music', 'sfx', 'voice']) $('v_' + k).addEventListener('input', (e) => { MIX[k] = e.target.value / 100; applyMix(); });
$('v_sens').addEventListener('input', (e) => { LOOK.sens = e.target.value / 100; try { localStorage.setItem('closing-sens', LOOK.sens); } catch { /* ignore */ } });
$('legendChk').addEventListener('change', (e) => toggleLegend(e.target.checked));
$('m_resume').addEventListener('click', () => { closeMenu(); if (!TOUCH) canvas.requestPointerLock?.(); });
$('m_view').addEventListener('click', () => toggleView());
$('m_restart').addEventListener('click', () => { closeMenu(); begin(); });
$('menuBtn').addEventListener('click', (e) => { e.stopPropagation(); if (menuOpen) closeMenu(); else openMenu(); });

reset();
const go = $('go');
go.disabled = false; applyLang();
go.addEventListener('click', begin);
$('again').addEventListener('click', begin);
if (DEV) { $('start').style.display = 'none'; $('langs').style.display = 'none'; }
window.__ready = true;
window.__debug = { bossChestYaw, bossS, handNotes, toggleView, get view() { return view; }, cam, crack, notes, bag, floorNotes, floorPose, carry, dropBag, openCrack, slideNotes, walkTo, player, L, envs, boss, fai, corridorReady, interact, begin, toCorridor, toShop, frameStart, frameEnd, rail, S,
  get state() { return state; }, set state(v) { state = v; }, get playing() { return playing; }, set playing(v) { playing = v; },
  go(x, z, yaw = player.yaw, pitch = player.pitch) { Object.assign(player, { x, z, yaw, pitch }); },
  async show(k) { await corridorReady; envs.shop.entity.enabled = k === 'shop'; envs.corridor.entity.enabled = k === 'corridor'; player.scene = k; boss.setActive(k === 'shop'); } };
