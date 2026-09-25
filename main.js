import * as THREE from "three";
import RAPIER from "rapier";

await RAPIER.init();
document.getElementById("loading").remove();

const acubemy = window.acubemy;
const COLORS = { U: 0xffffff, R: 0xe0192f, F: 0x12b24c, D: 0xffd500, L: 0xff7a00, B: 0x1463d8 };
// One world block = one cube, so every roll moves exactly one tile.
const BLOCK = 2;
const CUBIE = BLOCK / 3;
const CHUNK_TILES = 16;
const CHUNK = CHUNK_TILES * BLOCK;
const VIEW_RADIUS = 2;
const GRAVITY = 25;
const PHYSICS_DT = 1 / 120;
// Spring-damper pulling the virtual cube towards the physical orientation.
const ORIENT_STIFFNESS = 160;
const ORIENT_DAMPING = 14;
const MAX_TORQUE = 200;
const KEY_SPIN_GAIN = 30;
const MAX_SPIN = 14;
// Layer turns are driven by a velocity motor on a hinge between layer and middle.
const TURN_SPEED = 14;
const MOTOR_GAIN = 12;
const TURN_TIMEOUT = 0.6;
// Rounded edges make rolling over edges and corners smooth instead of snaggy.
const CUBE_ROUNDING = 0.08;
const CUBE_FRICTION = 1.0;
const GRIP_FRICTION = 1.0;
// Steps up to ~1.3 can be rolled over; higher ones need fast R L' turns (layer
// corners lever the cube up) or a very fast roll.
const CLIMB_STEP = 1.5;
// Goal tower ahead of spawn: two rollable stone steps, then 1.6 high blue steps.
// In simulation R L' hops get up in 7–9 s; rolling alone fails below ~8 rad/s.
const TOWER_X = [0, 1, 2];
const TOWER_CLIMB = { height: 1.6, depth: 1, count: 2 };
const TOWER_STEPS = [
  { tz: -5, h: 1 },
  { tz: -6, h: 2 },
];
for (let i = 0; i < TOWER_CLIMB.count; i++) {
  for (let d = 0; d < TOWER_CLIMB.depth; d++) {
    TOWER_STEPS.push({ tz: -7 - i * TOWER_CLIMB.depth - d, h: 2 + TOWER_CLIMB.height * (i + 1), level: i });
  }
}
const TOWER_TOP_TZ = -7 - TOWER_CLIMB.count * TOWER_CLIMB.depth;
const TOWER_TOP = { tz: [TOWER_TOP_TZ, TOWER_TOP_TZ - 1, TOWER_TOP_TZ - 2], h: 2 + TOWER_CLIMB.height * TOWER_CLIMB.count };
const GOAL = { x: 1.5 * BLOCK, y: TOWER_TOP.h, z: (TOWER_TOP_TZ - 0.5) * BLOCK };

// --- Renderer / scene ------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa8d8ff);
scene.fog = new THREE.Fog(0xa8d8ff, 40, 100);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 300);

scene.add(new THREE.HemisphereLight(0xffffff, 0x6d8f5a, 1.15));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 });
scene.add(sun, sun.target);

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// --- Physics world ---------------------------------------------------------
const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
world.timestep = PHYSICS_DT;
world.numSolverIterations = 8;
world.createCollider(RAPIER.ColliderDesc.cuboid(4000, 1, 4000).setTranslation(0, -1, 0).setFriction(GRIP_FRICTION));

const v3 = (v) => new THREE.Vector3(v.x, v.y, v.z);
const quatOf = (body) => {
  const r = body.rotation();
  return new THREE.Quaternion(r.x, r.y, r.z, r.w);
};

function createCubePart(half, mass, pos, rot, linvel, angvel) {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation(rot)
      .setLinvel(linvel.x, linvel.y, linvel.z)
      .setAngvel(angvel)
      .setLinearDamping(0.05)
      .setAngularDamping(0.2)
      .setCcdEnabled(true)
      .setCanSleep(false),
  );
  const r = CUBE_ROUNDING;
  world.createCollider(
    RAPIER.ColliderDesc.roundCuboid(half.x - r, half.y - r, half.z - r, r)
      .setMass(mass)
      .setFriction(CUBE_FRICTION)
      .setRestitution(0.05),
    body,
  );
  return body;
}

// --- Ground (tile grid) -------------------------------------------------------
const groundCanvas = document.createElement("canvas");
groundCanvas.width = groundCanvas.height = 128;
const g = groundCanvas.getContext("2d");
g.fillStyle = "#86c56f"; g.fillRect(0, 0, 128, 128);
g.fillStyle = "#7bbb64"; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
g.strokeStyle = "rgba(0,0,0,.08)"; g.lineWidth = 2;
g.strokeRect(0, 0, 64, 64); g.strokeRect(64, 64, 64, 64); g.strokeRect(64, 0, 64, 64); g.strokeRect(0, 64, 64, 64);
const groundTex = new THREE.CanvasTexture(groundCanvas);
groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
groundTex.repeat.set(400 / (BLOCK * 2), 400 / (BLOCK * 2));
groundTex.colorSpace = THREE.SRGBColorSpace;
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ map: groundTex }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// --- Avatar model: 26 cubies ---------------------------------------------------
const avatar = new THREE.Group();
scene.add(avatar);

// Kociemba facelet layout: 9 stickers per face in URFDLB order, row-major.
const FACE_DEFS = [
  { face: "U", normal: [0, 1, 0], pos: (r, c) => [c - 1, 1, r - 1] },
  { face: "R", normal: [1, 0, 0], pos: (r, c) => [1, 1 - r, 1 - c] },
  { face: "F", normal: [0, 0, 1], pos: (r, c) => [c - 1, 1 - r, 1] },
  { face: "D", normal: [0, -1, 0], pos: (r, c) => [c - 1, -1, 1 - r] },
  { face: "L", normal: [-1, 0, 0], pos: (r, c) => [-1, 1 - r, c - 1] },
  { face: "B", normal: [0, 0, -1], pos: (r, c) => [1 - c, 1 - r, -1] },
];
const FACE_NORMALS = Object.fromEntries(FACE_DEFS.map((d) => [d.face, new THREE.Vector3(...d.normal)]));

const cubieGeo = new THREE.BoxGeometry(CUBIE * 0.97, CUBIE * 0.97, CUBIE * 0.97);
const cubieMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.5 });
const stickerGeo = new THREE.PlaneGeometry(CUBIE * 0.82, CUBIE * 0.82);
const zAxis = new THREE.Vector3(0, 0, 1);
const cubies = new Map();
const stickers = [];

for (let x = -1; x <= 1; x++) {
  for (let y = -1; y <= 1; y++) {
    for (let z = -1; z <= 1; z++) {
      if (x === 0 && y === 0 && z === 0) continue;
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(cubieGeo, cubieMat);
      mesh.castShadow = true;
      group.add(mesh);
      group.userData.home = new THREE.Vector3(x, y, z).multiplyScalar(CUBIE);
      group.position.copy(group.userData.home);
      avatar.add(group);
      cubies.set(`${x},${y},${z}`, group);
    }
  }
}
for (const def of FACE_DEFS) {
  const normal = new THREE.Vector3(...def.normal);
  for (let i = 0; i < 9; i++) {
    const [x, y, z] = def.pos(Math.floor(i / 3), i % 3);
    const mesh = new THREE.Mesh(stickerGeo, new THREE.MeshStandardMaterial({ color: COLORS[def.face], roughness: 0.3 }));
    mesh.position.copy(normal).multiplyScalar(CUBIE * 0.487);
    mesh.quaternion.setFromUnitVectors(zAxis, normal);
    cubies.get(`${x},${y},${z}`).add(mesh);
    stickers.push(mesh);
  }
}

function resetCubiesAndPaint(facelets) {
  for (const cubie of cubies.values()) {
    cubie.position.copy(cubie.userData.home);
    cubie.quaternion.identity();
  }
  for (let i = 0; i < 54; i++) stickers[i].material.color.setHex(COLORS[facelets[i]] ?? 0x333333);
}

// --- Cube physics -----------------------------------------------------------
// At rest the cube is one rigid body. While layers turn it splits along the
// turn axis into three slabs — middle slice plus both outer layers, each
// hinged to the middle with a motor — so opposite faces can turn at once.
const FULL_HALF = new THREE.Vector3(BLOCK / 2, BLOCK / 2, BLOCK / 2);
let cubeBody = createCubePart(FULL_HALF, 1, new THREE.Vector3(BLOCK / 2, BLOCK / 2, BLOCK / 2), { x: 0, y: 0, z: 0, w: 1 }, new THREE.Vector3(), new THREE.Vector3());
let split = null;
const moveQueue = [];
let latestFacelets = acubemy.getFacelets();
let paintTimer = 0;

const FACES_ON_AXIS = { x: ["R", "L"], y: ["U", "D"], z: ["F", "B"] };
const axisOf = (face) => (FACES_ON_AXIS.x.includes(face) ? "x" : FACES_ON_AXIS.y.includes(face) ? "y" : "z");

/** The body the player's rotation acts on: the middle slice while layers turn. */
const drivenBody = () => (split ? split.middle : cubeBody);

function splitCube(axis) {
  const q = quatOf(cubeBody);
  const rot = cubeBody.rotation();
  const center = v3(cubeBody.translation());
  const v = v3(cubeBody.linvel());
  const w = v3(cubeBody.angvel());
  const half = FULL_HALF.clone().setComponent("xyz".indexOf(axis), CUBIE / 2);
  const part = (localOffset) => {
    const offset = localOffset.clone().applyQuaternion(q);
    return createCubePart(half, 1 / 3, center.clone().add(offset), rot, v.clone().add(w.clone().cross(offset)), w);
  };

  world.removeRigidBody(cubeBody);
  const middle = part(new THREE.Vector3());
  const layers = FACES_ON_AXIS[axis].map((face) => {
    const n = FACE_NORMALS[face];
    const body = part(n.clone().multiplyScalar(CUBIE));
    // The hinge sits on the plane between layer and middle, along the face normal.
    const joint = world.createImpulseJoint(
      RAPIER.JointData.revolute(n.clone().multiplyScalar(CUBIE / 2), n.clone().multiplyScalar(-CUBIE / 2), n),
      middle,
      body,
      true,
    );
    joint.setContactsEnabled(false);
    joint.configureMotorModel(RAPIER.MotorModel.ForceBased);

    const pivot = new THREE.Group();
    avatar.add(pivot);
    for (const cubie of cubies.values()) {
      if (Math.abs(cubie.position[axis] - n[axis] * CUBIE) < 0.01) pivot.attach(cubie);
    }
    return { face, n, body, joint, pivot, angle: 0, target: 0, elapsed: 0 };
  });
  split = { axis, middle, layers };
}

function mergeCube() {
  const { middle, layers } = split;
  const v = v3(middle.linvel());
  const w = v3(middle.angvel());
  for (const layer of layers) {
    v.add(v3(layer.body.linvel()));
    w.add(v3(layer.body.angvel()));
  }
  const center = v3(middle.translation());
  const middleQ = quatOf(middle);
  cubeBody = createCubePart(FULL_HALF, 1, center, middle.rotation(), v.divideScalar(3), w.divideScalar(3));
  for (const layer of layers) world.removeRigidBody(layer.body);
  world.removeRigidBody(middle);

  avatar.position.copy(center);
  avatar.quaternion.copy(middleQ);
  avatar.updateMatrixWorld(true);
  for (const layer of layers) {
    layer.pivot.quaternion.setFromAxisAngle(layer.n, layer.target);
    layer.pivot.updateMatrixWorld(true);
    for (const cubie of [...layer.pivot.children]) {
      avatar.attach(cubie);
      cubie.position.set(
        Math.round(cubie.position.x / CUBIE) * CUBIE,
        Math.round(cubie.position.y / CUBIE) * CUBIE,
        Math.round(cubie.position.z / CUBIE) * CUBIE,
      );
    }
    avatar.remove(layer.pivot);
  }
  split = null;
}

/** Signed rotation of a layer relative to the middle, unwrapped around its last value. */
function layerAngle(layer) {
  const rel = quatOf(split.middle).invert().multiply(quatOf(layer.body));
  const s = rel.x * layer.n.x + rel.y * layer.n.y + rel.z * layer.n.z;
  let angle = 2 * Math.atan2(s, rel.w);
  while (angle - layer.angle > Math.PI) angle -= 2 * Math.PI;
  while (angle - layer.angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

// Moves on the current split axis join in right away; others wait for the merge.
function pumpMoves() {
  while (moveQueue.length) {
    const { face, prime } = moveQueue[0];
    const axis = axisOf(face);
    if (split && split.axis !== axis) return;
    if (!split) splitCube(axis);
    const layer = split.layers.find((l) => l.face === face);
    layer.target += prime ? Math.PI / 2 : -Math.PI / 2;
    layer.elapsed = 0;
    moveQueue.shift();
  }
}

function driveLayers(dt) {
  if (!split) return;
  let busy = false;
  for (const layer of split.layers) {
    layer.elapsed += dt;
    layer.angle = layerAngle(layer);
    const remaining = layer.target - layer.angle;
    const speed = Math.sign(remaining) * Math.min(TURN_SPEED, Math.abs(remaining) * 25);
    layer.joint.configureMotorVelocity(speed, MOTOR_GAIN);
    if (Math.abs(remaining) > 0.03 && layer.elapsed < TURN_TIMEOUT) busy = true;
  }
  if (busy) return;
  mergeCube();
  if (moveQueue.length) pumpMoves();
  else resetCubiesAndPaint(latestFacelets);
}

acubemy.onMove((move) => {
  clearTimeout(paintTimer);
  moveQueue.push(move);
  pumpMoves();
});
acubemy.onStateChange((facelets) => {
  latestFacelets = facelets;
  // The state update can arrive just before its move; give the move a
  // moment so the turn animates from the old colors instead of snapping.
  clearTimeout(paintTimer);
  paintTimer = setTimeout(() => {
    if (!split && !moveQueue.length) resetCubiesAndPaint(latestFacelets);
  }, 60);
});

// --- Blocky procedural world ----------------------------------------------------
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const coinGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.14, 24);
coinGeo.rotateX(Math.PI / 2);
const coinMat = new THREE.MeshStandardMaterial({ color: 0xffc400, metalness: 0.6, roughness: 0.25, emissive: 0x6b4b00 });
const STEP_MATS = [0xd9c9a3, 0xcbb994].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));
const WALL_MATS = [0xff6b6b, 0xf06595, 0x9775fa, 0x63e6be, 0xff922b, 0x868e96].map(
  (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75 }),
);
const CLIMB_MATS = [0x5c7cfa, 0x4c6ef5].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
const TOWER_MAT = new THREE.MeshStandardMaterial({ color: 0xf1e3c2, roughness: 0.8 });

function addBlock(chunk, tx, tz, h, mat) {
  const x = (tx + 0.5) * BLOCK, z = (tz + 0.5) * BLOCK;
  const w = BLOCK * 0.985;
  const mesh = new THREE.Mesh(unitBox, mat);
  mesh.scale.set(w, h, w);
  mesh.position.set(x, h / 2, z);
  mesh.castShadow = mesh.receiveShadow = true;
  chunk.group.add(mesh);
  const collider = RAPIER.ColliderDesc.cuboid(BLOCK / 2, h / 2, BLOCK / 2).setTranslation(x, h / 2, z).setFriction(GRIP_FRICTION);
  chunk.colliders.push(world.createCollider(collider));
  chunk.heights.set(`${tx},${tz}`, h);
}

function addCoin(chunk, tx, tz) {
  const id = `${tx},${tz}`;
  const top = chunk.heights.get(id) ?? 0;
  if (collected.has(id)) return;
  const mesh = new THREE.Mesh(coinGeo, coinMat);
  mesh.position.set((tx + 0.5) * BLOCK, top + BLOCK * 0.6, (tz + 0.5) * BLOCK);
  mesh.castShadow = true;
  chunk.group.add(mesh);
  chunk.coins.push({ id, mesh });
}

/** Staircase of too-high-to-roll steps going up along +dir, with a coin stash on the landing. */
function addClimbStairs(chunk, tx, tz, dirX, dirZ, steps, width) {
  for (let s = 0; s < steps; s++) {
    for (let k = 0; k < width; k++) {
      const x = tx + dirX * s + (dirX ? 0 : k), z = tz + dirZ * s + (dirZ ? 0 : k);
      addBlock(chunk, x, z, CLIMB_STEP * (s + 1), CLIMB_MATS[s % 2]);
      if (s === steps - 1) addCoin(chunk, x, z);
    }
  }
}

const chunks = new Map();
const collected = new Set();
const nearSpawn = (tx, tz) => Math.abs(tx) < 4 && Math.abs(tz) < 4;
const towerArea = (tx, tz) => tx >= -1 && tx <= 3 && tz >= TOWER_TOP_TZ - 3 && tz <= -4;

function addGoalTower(chunk) {
  for (const step of TOWER_STEPS) {
    for (const tx of TOWER_X) addBlock(chunk, tx, step.tz, step.h, step.level === undefined ? STEP_MATS[0] : CLIMB_MATS[step.level % 2]);
  }
  for (const tz of TOWER_TOP.tz) for (const tx of TOWER_X) addBlock(chunk, tx, tz, TOWER_TOP.h, TOWER_MAT);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 12), new THREE.MeshStandardMaterial({ color: 0xeeeeee }));
  pole.position.set(GOAL.x, GOAL.y + 2, GOAL.z - BLOCK * 0.4);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), new THREE.MeshStandardMaterial({ color: 0xff8a00, side: THREE.DoubleSide }));
  flag.position.set(GOAL.x + 0.8, GOAL.y + 3.4, GOAL.z - BLOCK * 0.4);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.12, 12, 40), new THREE.MeshStandardMaterial({ color: 0xffc400, emissive: 0x805a00 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.set(GOAL.x, GOAL.y + 0.05, GOAL.z);
  [pole, flag, ring].forEach((m) => { m.castShadow = true; chunk.group.add(m); });
}

function buildChunk(cx, cz) {
  const rand = mulberry32((cx * 73856093) ^ (cz * 19349663) ^ 0x5bd1e995);
  const chunk = { group: new THREE.Group(), colliders: [], coins: [], heights: new Map() };
  const tx0 = cx * CHUNK_TILES, tz0 = cz * CHUNK_TILES;
  const free = (x, z) => !nearSpawn(x, z) && !towerArea(x, z) && !chunk.heights.has(`${x},${z}`);
  if (cx === 0 && cz === -1) addGoalTower(chunk);

  // Stone terraces of half-block steps: grippy, so rolling tips you up.
  for (let i = 0, n = 1 + Math.floor(rand() * 3); i < n; i++) {
    const w = 2 + Math.floor(rand() * 4), d = 2 + Math.floor(rand() * 4);
    const sx = tx0 + Math.floor(rand() * (CHUNK_TILES - w)), sz = tz0 + Math.floor(rand() * (CHUNK_TILES - d));
    const levels = rand() < 0.4 ? 2 : 1;
    for (let x = sx; x < sx + w; x++) {
      for (let z = sz; z < sz + d; z++) {
        if (!free(x, z)) continue;
        const inner = levels === 2 && x > sx && x < sx + w - 1 && z > sz && z < sz + d - 1;
        addBlock(chunk, x, z, inner ? BLOCK : BLOCK / 2, STEP_MATS[inner ? 1 : 0]);
      }
    }
  }
  // Blue staircases: only climbable with layer turns.
  for (let i = 0, n = 1 + Math.floor(rand() * 2); i < n; i++) {
    const steps = 2 + Math.floor(rand() * 3), width = 3;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const [dx, dz] = dirs[Math.floor(rand() * 4)];
    const tx = tx0 + 4 + Math.floor(rand() * (CHUNK_TILES - 8)), tz = tz0 + 4 + Math.floor(rand() * (CHUNK_TILES - 8));
    let ok = true;
    for (let s = 0; s < steps && ok; s++) for (let k = 0; k < width; k++) ok &&= free(tx + dx * s + (dx ? 0 : k), tz + dz * s + (dz ? 0 : k));
    if (ok) addClimbStairs(chunk, tx, tz, dx, dz, steps, width);
  }
  // Walls and towers to roll around.
  for (let i = 0, n = 3 + Math.floor(rand() * 4); i < n; i++) {
    const tx = tx0 + Math.floor(rand() * CHUNK_TILES), tz = tz0 + Math.floor(rand() * CHUNK_TILES);
    const horizontal = rand() < 0.5, len = 1 + Math.floor(rand() * 4), h = BLOCK * (1 + Math.floor(rand() * 3));
    const mat = WALL_MATS[Math.floor(rand() * WALL_MATS.length)];
    for (let k = 0; k < len; k++) {
      const x = tx + (horizontal ? k : 0), z = tz + (horizontal ? 0 : k);
      if (free(x, z)) addBlock(chunk, x, z, h, mat);
    }
  }
  // Loose coins on the ground and low terraces.
  for (let i = 0; i < 6; i++) {
    const tx = tx0 + Math.floor(rand() * CHUNK_TILES), tz = tz0 + Math.floor(rand() * CHUNK_TILES);
    if (!nearSpawn(tx, tz) && !towerArea(tx, tz) && (chunk.heights.get(`${tx},${tz}`) ?? 0) <= BLOCK / 2) addCoin(chunk, tx, tz);
  }
  scene.add(chunk.group);
  return chunk;
}

function updateChunks(px, pz) {
  const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
  for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
    for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz++) {
      const key = `${pcx + dx},${pcz + dz}`;
      if (!chunks.has(key)) chunks.set(key, buildChunk(pcx + dx, pcz + dz));
    }
  }
  for (const [key, chunk] of chunks) {
    const [cx, cz] = key.split(",").map(Number);
    if (Math.abs(cx - pcx) > VIEW_RADIUS + 1 || Math.abs(cz - pcz) > VIEW_RADIUS + 1) {
      scene.remove(chunk.group);
      chunk.colliders.forEach((c) => world.removeCollider(c, false));
      chunks.delete(key);
    }
  }
}

// --- Input: the virtual cube is pulled towards the physical cube's orientation --
const Y = new THREE.Vector3(0, 1, 0);
let physicalQuat = null;
const physicalSpin = new THREE.Vector3();
let lastGyroAt = 0;
let calibrated = false;
let cameraYaw = 0;
let cameraYawTarget = 0;
let coins = 0;
let startedAt = performance.now();
let finished = false;
const keys = new Set();
const hasGyro = () => performance.now() - lastGyroAt < 1000;

// Angular velocity from consecutive orientations: Δq = q_now · q_prev⁻¹ (world frame).
acubemy.onGyro((raw) => {
  const now = performance.now();
  const q = new THREE.Quaternion(raw.x, raw.y, raw.z, raw.w);
  if (physicalQuat) {
    const dt = Math.max(0.008, (now - lastGyroAt) / 1000);
    physicalSpin.lerp(rotationVector(q.clone().multiply(physicalQuat.clone().invert())).divideScalar(dt), 0.5);
  }
  physicalQuat = q;
  lastGyroAt = now;
});

/** Axis × angle of a rotation, taking the short way round. */
function rotationVector(q) {
  const sign = q.w < 0 ? -1 : 1;
  const w = Math.min(1, q.w * sign);
  const s = Math.sqrt(1 - w * w);
  if (s < 1e-6) return new THREE.Vector3();
  return new THREE.Vector3(q.x, q.y, q.z).multiplyScalar((sign * 2 * Math.acos(w)) / s);
}

// A spring-damper towards the physical orientation: torque grows linearly
// with the angle between both cubes, so fast hand turns pull harder.
function orientationTorque(body) {
  if (performance.now() - lastGyroAt > 150) physicalSpin.set(0, 0, 0);
  const yaw = new THREE.Quaternion().setFromAxisAngle(Y, cameraYaw);
  const target = yaw.clone().multiply(physicalQuat);
  const error = rotationVector(target.multiply(quatOf(body).invert()));
  const spinError = physicalSpin.clone().applyQuaternion(yaw).sub(v3(body.angvel()));
  return error.multiplyScalar(ORIENT_STIFFNESS).add(spinError.multiplyScalar(ORIENT_DAMPING));
}

function keyboardTorque(body) {
  const k = 5;
  const spin = new THREE.Vector3(
    (keys.has("ArrowUp") ? -k : 0) + (keys.has("ArrowDown") ? k : 0),
    0,
    (keys.has("ArrowLeft") ? k : 0) + (keys.has("ArrowRight") ? -k : 0),
  ).applyAxisAngle(Y, cameraYaw);
  if (spin.lengthSq() === 0) return null;
  return spin.sub(v3(body.angvel())).multiplyScalar(KEY_SPIN_GAIN);
}

function applyControlTorque() {
  const body = drivenBody();
  body.resetTorques(false);
  const torque = hasGyro() && calibrated && physicalQuat ? orientationTorque(body) : keyboardTorque(body);
  if (torque) {
    if (torque.length() > MAX_TORQUE) torque.setLength(MAX_TORQUE);
    body.addTorque(torque, true);
  }
  const w = v3(body.angvel());
  if (w.length() > MAX_SPIN) body.setAngvel(w.setLength(MAX_SPIN), true);
}

window.addEventListener("keydown", (e) => {
  keys.add(e.key);
  if (e.key === "q" || e.key === "Q") cameraYawTarget += Math.PI / 2;
  if (e.key === "e" || e.key === "E") cameraYawTarget -= Math.PI / 2;
});
window.addEventListener("keyup", (e) => keys.delete(e.key));

// --- HUD --------------------------------------------------------------------
const hud = {
  score: document.getElementById("score"),
  device: document.getElementById("device"),
  calibrate: document.getElementById("calibrate"),
  calibrateOverlay: document.getElementById("calib"),
  respawn: document.getElementById("respawn"),
  help: document.getElementById("help"),
  goal: document.getElementById("goal"),
  goalTime: document.getElementById("goal-time"),
};
function renderScore() {
  hud.score.firstChild.nodeValue = String(coins);
}
function renderHelp() {
  const device = acubemy.getDevice();
  hud.device.textContent = device.connected ? `${device.deviceName ?? "Smart cube"}${hasGyro() ? " · gyro" : ""}` : "No cube · keyboard mode";
  hud.calibrate.hidden = !hasGyro();
  hud.calibrateOverlay.hidden = !hasGyro() || calibrated;
  hud.help.textContent = hasGyro()
    ? "Reach the flag on the tower · roll your cube to move · hop up blue stairs with fast R L' turns"
    : device.connected
      ? "No gyro: turn layers to push the cube around · arrows spin it"
      : "Arrows spin the cube · keys U R F D L B turn layers · Q/E rotate camera";
}
function respawn() {
  if (split) mergeCube();
  cubeBody.setTranslation({ x: GOAL.x, y: BLOCK / 2 + 0.05, z: BLOCK / 2 }, true);
  cubeBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  cubeBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  cubeBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
}
function restart() {
  respawn();
  startedAt = performance.now();
  finished = false;
  hud.goal.hidden = true;
}
function checkGoal(center, now) {
  if (finished) return;
  const onPlatform = Math.abs(center.x - GOAL.x) < BLOCK * 1.5 && Math.abs(center.z - GOAL.z) < BLOCK * 1.5;
  if (center.y < GOAL.y || !onPlatform) return;
  finished = true;
  hud.goalTime.textContent = `${((now - startedAt) / 1000).toFixed(1)} s · ${coins} coins`;
  hud.goal.hidden = false;
}
function calibrate() {
  acubemy.calibrateGyro();
  calibrated = true;
  renderHelp();
}
hud.calibrate.addEventListener("click", calibrate);
document.getElementById("calib-button").addEventListener("click", calibrate);
hud.respawn.addEventListener("click", respawn);
document.getElementById("goal-button").addEventListener("click", restart);
acubemy.onDeviceChange(renderHelp);

// --- Loop -------------------------------------------------------------------
function collectCoins(center, now) {
  for (const chunk of chunks.values()) {
    for (const coin of chunk.coins) {
      if (coin.taken) continue;
      coin.mesh.rotation.y = now / 400;
      if (coin.mesh.position.distanceTo(center) < BLOCK * 0.9) {
        coin.taken = true;
        collected.add(coin.id);
        chunk.group.remove(coin.mesh);
        coins++;
        renderScore();
      }
    }
  }
}

function syncAvatar() {
  const body = drivenBody();
  avatar.position.copy(v3(body.translation()));
  avatar.quaternion.copy(quatOf(body));
  if (split) for (const layer of split.layers) layer.pivot.quaternion.setFromAxisAngle(layer.n, layer.angle);
}

function renderFrame(dt) {
  const p = avatar.position;
  cameraYaw += (cameraYawTarget - cameraYaw) * Math.min(1, dt * 6);
  const back = new THREE.Vector3(0, 0, 1).applyAxisAngle(Y, cameraYaw);
  camera.position.lerp(p.clone().addScaledVector(back, 11).setY(p.y + 8), Math.min(1, dt * 4));
  camera.lookAt(p.x, p.y + 0.5, p.z);
  sun.position.set(p.x + 18, 40, p.z + 12);
  sun.target.position.copy(p);
  ground.position.set(Math.round(p.x / (BLOCK * 2)) * BLOCK * 2, 0, Math.round(p.z / (BLOCK * 2)) * BLOCK * 2);
}

respawn();
resetCubiesAndPaint(latestFacelets);
renderScore();
renderHelp();
setInterval(renderHelp, 1000);
updateChunks(0, 0);

let last = performance.now();
let accumulator = 0;
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  accumulator += dt;
  for (let i = 0; accumulator >= PHYSICS_DT && i < 8; i++) {
    applyControlTorque();
    driveLayers(PHYSICS_DT);
    world.step();
    accumulator -= PHYSICS_DT;
  }
  accumulator = Math.min(accumulator, PHYSICS_DT);
  if (avatar.position.y < -20) respawn();
  syncAvatar();
  collectCoins(avatar.position, now);
  checkGoal(avatar.position, now);
  updateChunks(avatar.position.x, avatar.position.z);
  renderFrame(dt);
  renderer.render(scene, camera);
});
