import kaplay from "https://unpkg.com/kaplay@3001.0.19/dist/kaplay.mjs";

const GAME_WIDTH = 1920;
const GAME_HEIGHT = 1920;
const UI_SCALE = 0.9;
const MAP_ZOOM = 5;
const EDGE_ZOOM_MULTIPLIER = 1.85;
const menuRef = { width: GAME_WIDTH, height: GAME_HEIGHT };
const canvas = document.querySelector("#game");
const loadedSpriteKeys = new Set();
const spriteLoadPromises = new Map();

const mouseScreen = { x: 0, y: 0 };
window.addEventListener("mousemove", (event) => {
  mouseScreen.x = event.clientX;
  mouseScreen.y = event.clientY;
});

function getMouseWorld() {
  const rect = canvas.getBoundingClientRect();
  const nx = (mouseScreen.x - rect.left) / rect.width;
  const ny = (mouseScreen.y - rect.top) / rect.height;
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
  return { x: nx * GAME_WIDTH, y: ny * GAME_HEIGHT };
}

function fitCanvasToViewport() {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const baseScale = Math.min(vw / GAME_WIDTH, vh / GAME_HEIGHT) || 1;
  const isEdgeBrowser = /\bEdg\//.test(navigator.userAgent);
  const browserZoom = isEdgeBrowser ? EDGE_ZOOM_MULTIPLIER : 1;
  const scale = baseScale * browserZoom;
  canvas.style.width = `${Math.floor(GAME_WIDTH * scale)}px`;
  canvas.style.height = `${Math.floor(GAME_HEIGHT * scale)}px`;
}

function getUiScale() {
  const baseScale = Math.min(
    canvas.clientWidth / GAME_WIDTH,
    canvas.clientHeight / GAME_HEIGHT,
  ) || 1;
  return baseScale * UI_SCALE;
}

function safeSpriteScale(obj) {
  if (!obj || !obj.width || !Number.isFinite(obj.width) || obj.width <= 0) {
    return getUiScale();
  }
  return getUiScale() * (menuRef.width / obj.width);
}

function scheduleFit() {
  fitCanvasToViewport();
  requestAnimationFrame(fitCanvasToViewport);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const isLocalhost = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (!isLocalhost && location.protocol !== "https:") return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("Service worker registration failed", err);
    });
  });
}

window.addEventListener("resize", scheduleFit);
window.addEventListener("load", scheduleFit);
scheduleFit();
registerServiceWorker();

const k = kaplay({
  global: false,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  canvas,
  background: [20, 18, 24],
  debug: false,
});

const {
  add,
  sprite,
  rect,
  pos,
  color,
  area,
  text,
  onUpdate,
  onMousePress,
  onKeyPress,
  isKeyDown,
  anchor,
  scale,
  loadSprite,
  width,
  height,
  vec2,
  destroy,
  dt,
  rand,
} = k;

const DATA = {
  classes: null,
  items: null,
  lootTables: null,
  dungeons: null,
  playerStats: null,
};

const state = {
  player: null,
  selectedClassId: "none",
  selectedAvatarId: "human",
  currentDungeonId: "",
  infoLog: ["Press R to spin class", "Press Enter to start dungeon"],
  lootLog: [],
  elapsed: 0,
  enemies: [],
  mode: "menu",
  menu: {
    base: null,
    hover: null,
  },
  screen: {
    bg: null,
    label: null,
  },
  classMenu: {
    bg: null,
    description: null,
    descriptionShadow: null,
    current: null,
    currentShadow: null,
    rolls: null,
    rollsShadow: null,
  },
  customMenu: {
    bg: null,
    currentBox: null,
    currentLabel: null,
    leftBox: null,
    leftLabel: null,
    rightBox: null,
    rightLabel: null,
    currentIndex: 0,
  },
  game: {
    mapBg: null,
    movementReady: false,
    playerWorld: null,
    facing: "right",
    lastMoveDirection: "side",
    animTimer: 0,
    animFrame: 0,
    hudTimer: 0,
  },
  loading: {
    overlay: null,
    label: null,
  },
};

const menuMask = { data: null, width: 0, height: 0 };
const hoverMask = { data: null, width: 0, height: 0 };
const buttonMasks = {
  play: { data: null, width: 0, height: 0 },
  custom: { data: null, width: 0, height: 0 },
  class: { data: null, width: 0, height: 0 },
};
const classMenuMasks = {
  back: { data: null, width: 0, height: 0 },
  description: { data: null, width: 0, height: 0 },
  current: { data: null, width: 0, height: 0 },
  rolls: { data: null, width: 0, height: 0 },
  spin: { data: null, width: 0, height: 0 },
};
const customMenuMasks = {
  back: { data: null, width: 0, height: 0 },
  current: { data: null, width: 0, height: 0 },
  left: { data: null, width: 0, height: 0 },
  right: { data: null, width: 0, height: 0 },
  scrollLeft: { data: null, width: 0, height: 0 },
  scrollRight: { data: null, width: 0, height: 0 },
};
const mapMasks = {
  spawn: { data: null, width: 0, height: 0 },
  walk: { data: null, width: 0, height: 0 },
};

const assetState = {
  menuReady: false,
  classMenuReady: false,
  customMenuReady: false,
  gameReady: false,
  classMenuPromise: null,
  customMenuPromise: null,
  gamePromise: null,
};

const AVATARS = [
  { id: "human", color: [148, 94, 72], sprite: "avatarHumanStandingRight" },
];

const hud = {
  status: null,
  info: null,
  loot: null,
};

function logPush(list, message, max = 6) {
  list.push(message);
  if (list.length > max) list.splice(0, list.length - max);
}

function weightedChoice(entries) {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * total;
  for (const [itemId, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return itemId;
  }
  return entries[entries.length - 1][0];
}

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

async function loadCsv(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  const text = await res.text();
  const [headerLine, dataLine] = text.trim().split(/\r?\n/);
  if (!headerLine || !dataLine) return {};
  const headers = headerLine.split(",").map((h) => h.trim());
  const values = dataLine.split(",").map((v) => v.trim());
  return headers.reduce((acc, header, idx) => {
    const value = Number(values[idx]);
    acc[header] = Number.isFinite(value) ? value : values[idx];
    return acc;
  }, {});
}

async function loadMask(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  const off = document.createElement("canvas");
  off.width = bitmap.width;
  off.height = bitmap.height;
  const ctx = off.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  const img = ctx.getImageData(0, 0, off.width, off.height);
  if (typeof bitmap.close === "function") bitmap.close();
  return {
    data: img.data,
    width: off.width,
    height: off.height,
  };
}

async function loadSpriteOnce(name, path) {
  if (loadedSpriteKeys.has(name)) return;
  if (spriteLoadPromises.has(name)) {
    await spriteLoadPromises.get(name);
    return;
  }
  const pending = loadSprite(name, path)
    .then(() => {
      loadedSpriteKeys.add(name);
    })
    .finally(() => {
      spriteLoadPromises.delete(name);
    });
  spriteLoadPromises.set(name, pending);
  await pending;
}

function isInsideMask(mask, mouse, basePos, scaleFactor) {
  if (!mask?.data || !mouse) return false;
  const halfW = (mask.width * scaleFactor) / 2;
  const halfH = (mask.height * scaleFactor) / 2;
  const localX = mouse.x - basePos.x + halfW;
  const localY = mouse.y - basePos.y + halfH;
  if (
    localX < 0 ||
    localY < 0 ||
    localX >= mask.width * scaleFactor ||
    localY >= mask.height * scaleFactor
  ) {
    return false;
  }
  const imgX = Math.floor(localX / scaleFactor);
  const imgY = Math.floor(localY / scaleFactor);
  const idx = (imgY * mask.width + imgX) * 4;
  const a = mask.data[idx + 3];
  return a > 10;
}

function maskBounds(mask) {
  if (!mask?.data) return null;
  let minX = mask.width;
  let minY = mask.height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const idx = (y * mask.width + x) * 4 + 3;
      if (mask.data[idx] > 10) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (minX > maxX || minY > maxY) return null;
  return { minX, minY, maxX, maxY };
}

function maskCenterWorld(mask, basePos, scaleFactor) {
  const bounds = maskBounds(mask);
  if (!bounds) return { x: basePos.x, y: basePos.y };
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const halfW = (mask.width * scaleFactor) / 2;
  const halfH = (mask.height * scaleFactor) / 2;
  return {
    x: basePos.x - halfW + cx * scaleFactor,
    y: basePos.y - halfH + cy * scaleFactor,
  };
}

function maskCenterLocal(mask) {
  const bounds = maskBounds(mask);
  if (!bounds) {
    return { x: mask.width / 2, y: mask.height / 2 };
  }
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

function maskSizeWorld(mask, scaleFactor) {
  const bounds = maskBounds(mask);
  if (!bounds) {
    return {
      width: mask.width * scaleFactor,
      height: mask.height * scaleFactor,
    };
  }
  return {
    width: Math.max(8, (bounds.maxX - bounds.minX) * scaleFactor),
    height: Math.max(8, (bounds.maxY - bounds.minY) * scaleFactor),
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isWalkableAtWorld(x, y) {
  if (!mapMasks.walk?.data) return true;
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= mapMasks.walk.width || py >= mapMasks.walk.height) {
    return false;
  }
  const idx = (py * mapMasks.walk.width + px) * 4 + 3;
  return mapMasks.walk.data[idx] > 10;
}

function updateGameCamera() {
  const map = state.game.mapBg;
  const player = state.player;
  const world = state.game.playerWorld;
  if (!map || !player || !world) return;

  const mapScale = safeSpriteScale(map) * MAP_ZOOM;
  map.scale = vec2(mapScale);

  const halfW = (map.width * mapScale) / 2;
  const halfH = (map.height * mapScale) / 2;

  let mapX = GAME_WIDTH / 2 + halfW - world.x * mapScale;
  let mapY = GAME_HEIGHT / 2 + halfH - world.y * mapScale;

  if (halfW <= GAME_WIDTH / 2) {
    mapX = GAME_WIDTH / 2;
  } else {
    mapX = clamp(mapX, GAME_WIDTH - halfW, halfW);
  }

  if (halfH <= GAME_HEIGHT / 2) {
    mapY = GAME_HEIGHT / 2;
  } else {
    mapY = clamp(mapY, GAME_HEIGHT - halfH, halfH);
  }

  map.pos = vec2(mapX, mapY);

  const playerScreenX = mapX - halfW + world.x * mapScale;
  const playerScreenY = mapY - halfH + world.y * mapScale;
  player.pos = vec2(playerScreenX, playerScreenY);
}

function getHumanSpriteForMovement(dx, dy) {
  const moving = dx !== 0 || dy !== 0;
  const facing = state.game.facing;
  const twoFrameStep = state.game.animFrame % 2 === 0;
  const sideFrame = state.game.animFrame % 4;
  if (!moving) {
    if (state.game.lastMoveDirection === "forward") {
      return facing === "left"
        ? "avatarHumanStandingForwardLeft"
        : "avatarHumanStandingForwardRight";
    }
    return facing === "left"
      ? "avatarHumanStandingLeft"
      : "avatarHumanStandingRight";
  }

  if (dx < 0) {
    state.game.facing = "left";
    state.game.lastMoveDirection = "side";
    if (sideFrame === 0) return "avatarHumanWalkingLeft1";
    if (sideFrame === 1) return "avatarHumanWalkingLeft2";
    if (sideFrame === 2) return "avatarHumanWalkingLeft3";
    return "avatarHumanWalkingLeft4";
  }

  if (dx > 0) {
    state.game.facing = "right";
    state.game.lastMoveDirection = "side";
    if (sideFrame === 0) return "avatarHumanWalkingRight1";
    if (sideFrame === 1) return "avatarHumanWalkingRight2";
    if (sideFrame === 2) return "avatarHumanWalkingRight3";
    return "avatarHumanWalkingRight4";
  }

  // Up movement uses forward-walk frames.
  if (dy < 0) {
    state.game.lastMoveDirection = "forward";
    if (facing === "left") {
      state.game.facing = "left";
      if (sideFrame === 0) return "avatarHumanWalkingForwardLeft1";
      if (sideFrame === 1) return "avatarHumanWalkingForwardLeft2";
      if (sideFrame === 2) return "avatarHumanWalkingForwardLeft3";
      return "avatarHumanWalkingForwardLeft4";
    }
    state.game.facing = "right";
    if (sideFrame === 0) return "avatarHumanWalkingForwardRight1";
    if (sideFrame === 1) return "avatarHumanWalkingForwardRight2";
    if (sideFrame === 2) return "avatarHumanWalkingForwardRight3";
    return "avatarHumanWalkingForwardRight4";
  }

  // Down movement uses down-walk frames.
  if (dy > 0) {
    state.game.lastMoveDirection = "down";
    if (facing === "left") {
      state.game.facing = "left";
      return twoFrameStep
        ? "avatarHumanWalkingDownLeft1"
        : "avatarHumanWalkingDownLeft2";
    }
    state.game.facing = "right";
    return twoFrameStep
      ? "avatarHumanWalkingDownRight1"
      : "avatarHumanWalkingDownRight2";
  }

  return "avatarHumanStandingRight";
}

function avatarAt(index) {
  const len = AVATARS.length;
  const normalized = ((index % len) + len) % len;
  return AVATARS[normalized];
}

function updateCustomMenuPreviews() {
  const custom = state.customMenu;
  const current = avatarAt(custom.currentIndex);
  state.selectedAvatarId = current.id;
}

function showLoading(message) {
  if (!state.loading.overlay) {
    state.loading.overlay = add([
      rect(GAME_WIDTH, GAME_HEIGHT),
      pos(0, 0),
      color(0, 0, 0),
    ]);
  }
  if (!state.loading.label) {
    state.loading.label = add([
      text("", { size: 24 }),
      pos(GAME_WIDTH / 2, GAME_HEIGHT / 2),
      anchor("center"),
      color(230, 230, 230),
    ]);
  }
  state.loading.label.text = message;
}

function hideLoading() {
  if (state.loading.label) {
    destroy(state.loading.label);
    state.loading.label = null;
  }
  if (state.loading.overlay) {
    destroy(state.loading.overlay);
    state.loading.overlay = null;
  }
}

async function ensureClassMenuAssets() {
  if (assetState.classMenuReady) return;
  if (assetState.classMenuPromise) return assetState.classMenuPromise;
  assetState.classMenuPromise = (async () => {
    showLoading("Loading Class Menu...");
    await loadSpriteOnce("classMenu", "./data/Class%20Menu/Class%20Menu.png");
    Object.assign(classMenuMasks.back, await loadMask("./data/Class%20Menu/Back%20Button%20-%20Class%20Menu.png"));
    Object.assign(classMenuMasks.description, await loadMask("./data/Class%20Menu/Class%20Description%20-%20Class%20Menu.png"));
    Object.assign(classMenuMasks.current, await loadMask("./data/Class%20Menu/Current%20Class%20-%20Class%20Menu.png"));
    Object.assign(classMenuMasks.rolls, await loadMask("./data/Class%20Menu/Class%20Rolls%20-%20Class%20Menu.png"));
    Object.assign(classMenuMasks.spin, await loadMask("./data/Class%20Menu/Spin%20Button%20-%20Class%20Menu.png"));
    assetState.classMenuReady = true;
  })();
  try {
    await assetState.classMenuPromise;
  } finally {
    assetState.classMenuPromise = null;
    hideLoading();
  }
}

async function ensureCustomMenuAssets() {
  if (assetState.customMenuReady) return;
  if (assetState.customMenuPromise) return assetState.customMenuPromise;
  assetState.customMenuPromise = (async () => {
    showLoading("Loading Custom Menu...");
    await Promise.all([
      loadSpriteOnce("customMenu", "./data/Custom%20Menu/Custom%20Menu.png"),
      loadSpriteOnce("avatarHumanStandingRight", "./data/Avatars/Human/Human%20Standing%20Right.png"),
    ]);
    Object.assign(customMenuMasks.back, await loadMask("./data/Custom%20Menu/Back%20Button%20-%20Custom%20Menu.png"));
    Object.assign(customMenuMasks.current, await loadMask("./data/Custom%20Menu/Current%20Avatar%20-%20Custom%20Menu.png"));
    Object.assign(customMenuMasks.left, await loadMask("./data/Custom%20Menu/Left%20Avatar%20-%20Custom%20Menu.png"));
    Object.assign(customMenuMasks.right, await loadMask("./data/Custom%20Menu/Right%20Avatar%20-%20Custom%20Menu.png"));
    Object.assign(customMenuMasks.scrollLeft, await loadMask("./data/Custom%20Menu/Scroll%20Left%20Button%20-%20Custom%20Menu.png"));
    Object.assign(customMenuMasks.scrollRight, await loadMask("./data/Custom%20Menu/Scroll%20Right%20Button%20-%20Custom%20Menu.png"));
    assetState.customMenuReady = true;
  })();
  try {
    await assetState.customMenuPromise;
  } finally {
    assetState.customMenuPromise = null;
    hideLoading();
  }
}

async function ensureGameAssets() {
  if (assetState.gameReady) return;
  if (assetState.gamePromise) return assetState.gamePromise;
  assetState.gamePromise = (async () => {
    showLoading("Loading Map...");
    await Promise.all([
      loadSpriteOnce("map", "./data/Map/Map.png"),
      loadSpriteOnce("avatarHumanStandingRight", "./data/Avatars/Human/Human%20Standing%20Right.png"),
      loadSpriteOnce("avatarHumanStandingLeft", "./data/Avatars/Human/Human%20Standing%20Left.png"),
      loadSpriteOnce("avatarHumanStandingForwardRight", "./data/Avatars/Human/Human%20Standing%20Forward%20Right.png"),
      loadSpriteOnce("avatarHumanStandingForwardLeft", "./data/Avatars/Human/Human%20Standing%20Forward%20Left.png"),
      loadSpriteOnce("avatarHumanWalkingLeft1", "./data/Avatars/Human/Human%20Walking%20Left%20-%201.png"),
      loadSpriteOnce("avatarHumanWalkingLeft2", "./data/Avatars/Human/Human%20Walking%20Left%20-%202.png"),
      loadSpriteOnce("avatarHumanWalkingLeft3", "./data/Avatars/Human/Human%20Walking%20Left%20-%203.png"),
      loadSpriteOnce("avatarHumanWalkingLeft4", "./data/Avatars/Human/Human%20Walking%20Left%20-%204.png"),
      loadSpriteOnce("avatarHumanWalkingRight1", "./data/Avatars/Human/Human%20Walking%20Right%20-%201.png"),
      loadSpriteOnce("avatarHumanWalkingRight2", "./data/Avatars/Human/Human%20Walking%20Right%20-%202.png"),
      loadSpriteOnce("avatarHumanWalkingRight3", "./data/Avatars/Human/Human%20Walking%20Right%20-%203.png"),
      loadSpriteOnce("avatarHumanWalkingRight4", "./data/Avatars/Human/Human%20Walking%20Right%20-%204.png"),
      loadSpriteOnce("avatarHumanWalkingDownRight1", "./data/Avatars/Human/Human%20Walking%20Down%20Right%20-%201.png"),
      loadSpriteOnce("avatarHumanWalkingDownRight2", "./data/Avatars/Human/Human%20Walking%20Down%20Right%20-%202.png"),
      loadSpriteOnce("avatarHumanWalkingDownLeft1", "./data/Avatars/Human/Human%20Walking%20Down%20Left%20-%201.png"),
      loadSpriteOnce("avatarHumanWalkingDownLeft2", "./data/Avatars/Human/Human%20Walking%20Down%20Left%20-%202.png"),
      loadSpriteOnce("avatarHumanWalkingForwardRight1", "./data/Avatars/Human/Human%20Walking%20Forward%20Right%20-%201.png"),
      loadSpriteOnce("avatarHumanWalkingForwardRight2", "./data/Avatars/Human/Human%20Walking%20Forward%20Right%20-%202.png"),
      loadSpriteOnce("avatarHumanWalkingForwardRight3", "./data/Avatars/Human/Human%20Walking%20Forward%20Right%20-%203.png"),
      loadSpriteOnce("avatarHumanWalkingForwardRight4", "./data/Avatars/Human/Human%20Walking%20Forward%20Right%20-%204.png"),
      loadSpriteOnce("avatarHumanWalkingForwardLeft1", "./data/Avatars/Human/Human%20Walking%20Forward%20Left%20-%201.png"),
      loadSpriteOnce("avatarHumanWalkingForwardLeft2", "./data/Avatars/Human/Human%20Walking%20Forward%20Left%20-%202.png"),
      loadSpriteOnce("avatarHumanWalkingForwardLeft3", "./data/Avatars/Human/Human%20Walking%20Forward%20Left%20-%203.png"),
      loadSpriteOnce("avatarHumanWalkingForwardLeft4", "./data/Avatars/Human/Human%20Walking%20Forward%20Left%20-%204.png"),
    ]);
    Object.assign(mapMasks.spawn, await loadMask("./data/Map/Map%20-%20Spawn%20Area.png"));
    Object.assign(mapMasks.walk, await loadMask("./data/Map/Map%20-%20Walk%20Section.png"));
    assetState.gameReady = true;
  })();
  try {
    await assetState.gamePromise;
  } finally {
    assetState.gamePromise = null;
    hideLoading();
  }
}

function spinClass() {
  const spinTable = DATA.classes.spin_table;
  const classId = weightedChoice(spinTable.map((e) => [e.class_id, e.weight]));
  state.selectedClassId = classId;
  if (state.player) {
    state.player.classId = classId;
  }
  const className = DATA.classes.classes[classId]?.name ?? classId;
  logPush(state.infoLog, `Spun class: ${className}`, 4);
}

function startDungeon(dungeonId) {
  state.currentDungeonId = dungeonId;
  state.enemies.forEach((enemy) => destroy(enemy));
  state.enemies = [];
  spawnEnemies(5);
  const name = DATA.dungeons.dungeons[dungeonId]?.name ?? dungeonId;
  logPush(state.infoLog, `Entered ${name}`, 4);
}

function spawnEnemies(count) {
  const dungeon = DATA.dungeons.dungeons[state.currentDungeonId || "dungeon_1"];
  const table = DATA.dungeons.enemy_tables[dungeon.enemy_table_id];
  for (let i = 0; i < count; i++) {
    const enemyId = weightedChoice(table.map((e) => [e.enemy_id, e.weight]));
    const data = DATA.dungeons.enemies[enemyId];
    const enemy = add([
      rect(18, 18),
      pos(rand(50, GAME_WIDTH - 50), rand(50, GAME_HEIGHT - 50)),
      color(200, 60, 60),
      area(),
      "enemy",
      {
        hp: data.hp,
        attack: data.attack,
        lastHit: 0,
      },
    ]);
    state.enemies.push(enemy);
  }
}

function handleCombat(enemy) {
  const now = state.elapsed;
  const player = state.player;
  if (now - player.lastHit < 0.25 || now - enemy.lastHit < 0.25) return;

  enemy.hp -= player.attack;
  player.hp -= enemy.attack;
  player.lastHit = now;
  enemy.lastHit = now;

  if (enemy.hp <= 0) {
    destroy(enemy);
    state.enemies = state.enemies.filter((e) => e !== enemy);
    dropLoot();
  }
}

function dropLoot() {
  if (!state.currentDungeonId) return;
  const tableId = DATA.dungeons.dungeons[state.currentDungeonId].loot_table_id;
  const entries = DATA.lootTables.tables[tableId];

  const classTags = state.player.classId
    ? DATA.classes.classes[state.player.classId]?.loot_affinity_tags ?? []
    : [];

  const weighted = entries.map((entry) => {
    let weight = entry.weight;
    if (classTags.length && entry.tags?.some((tag) => classTags.includes(tag))) {
      weight *= 1.5;
    }
    return [entry.item_id, weight];
  });

  const itemId = weightedChoice(weighted);
  const item = DATA.items.items[itemId];
  logPush(state.lootLog, `Loot: ${item?.name ?? itemId}`);
}

function updateHud() {
  const player = state.player;
  hud.status.text = `HP: ${player.hp}\nClass: ${player.classId || "None"}\nDungeon: ${state.currentDungeonId || "None"}`;
  hud.info.text = state.infoLog.join("\n");
  hud.loot.text = state.lootLog.join("\n");
}

function setupHud() {
  hud.status = add([
    text("", { size: 16 }),
    pos(10, 10),
    color(230, 230, 230),
  ]);
  hud.info = add([
    text("", { size: 16 }),
    pos(10, 90),
    color(200, 200, 200),
  ]);
  hud.loot = add([
    text("", { size: 16 }),
    pos(10, 170),
    color(200, 200, 200),
  ]);
}

function setupPlayer() {
  const stats = DATA.playerStats ?? {};
  const hp = stats.Health ?? stats.hp ?? 50;
  const speed = (stats.Speed ?? stats.speed ?? 180) * 3;
  const attack = stats["Physical damage"] ?? stats.attack ?? 5;
  const magicDamage = stats["Magic Damage"] ?? stats["Magic damage"] ?? stats.magic ?? 0;
  const spawnLocal = maskCenterLocal(mapMasks.spawn);
  state.game.playerWorld = { x: spawnLocal.x, y: spawnLocal.y };
  state.game.facing = "right";
  state.game.lastMoveDirection = "side";
  state.game.animTimer = 0;
  state.game.animFrame = 0;
  state.game.hudTimer = 0;

  const equippedAvatar = AVATARS.find((a) => a.id === state.selectedAvatarId);
  const initialSprite =
    state.selectedAvatarId === "human"
      ? "avatarHumanStandingRight"
      : equippedAvatar?.sprite;
  const avatarComponents =
    initialSprite
      ? [sprite(initialSprite), scale(0.1)]
      : [rect(14, 24), color(20, 20, 20)];
  state.player = add([
    ...avatarComponents,
    pos(GAME_WIDTH / 2, GAME_HEIGHT / 2),
    anchor("center"),
    area(),
    "player",
    {
      speed,
      hp,
      attack,
      magicDamage,
      classId: state.selectedClassId || "none",
      lastHit: 0,
    },
  ]);
  state.player.onCollide("enemy", (enemy) => handleCombat(enemy));
  updateGameCamera();
}

function setupInput() {
  onKeyPress("r", () => {
    if (state.mode !== "game") return;
    spinClass();
  });
  onKeyPress("enter", () => {
    if (state.mode === "menu") {
      startGame().catch((err) => console.error(err));
      return;
    }
    if (state.mode !== "game") return;
    startDungeon("dungeon_1");
  });
  onKeyPress("escape", () => {
    if (state.mode === "menu") return;
    showMenu();
  });
}

function setupMovement() {
  onUpdate(() => {
    if (state.mode !== "game") return;
    if (!state.player) return;
    state.elapsed += dt();

    const dx = (isKeyDown("d") || isKeyDown("right")) - (isKeyDown("a") || isKeyDown("left"));
    const dy = (isKeyDown("s") || isKeyDown("down")) - (isKeyDown("w") || isKeyDown("up"));

    if (dx || dy) {
      const length = Math.hypot(dx, dy) || 1;
      const mapScale = state.game.mapBg?.scale?.x ?? 1;
      const worldDx = ((dx / length) * state.player.speed * dt()) / mapScale;
      const worldDy = ((dy / length) * state.player.speed * dt()) / mapScale;
      const nextX = state.game.playerWorld.x + worldDx;
      const nextY = state.game.playerWorld.y + worldDy;
      const playerScale = typeof state.player.scale?.x === "number"
        ? state.player.scale.x
        : typeof state.player.scale === "number"
          ? state.player.scale
          : 1;
      const bodyHeightWorld = ((state.player.height ?? 0) * playerScale) / mapScale;
      const bodyWidthWorld = ((state.player.width ?? 0) * playerScale) / mapScale;
      const collisionYOffset = bodyHeightWorld > 0 ? bodyHeightWorld * 0.2 : 0;
      const sideProbeOffset = bodyWidthWorld > 0 ? bodyWidthWorld * 0.1 : 0;
      const probeY = nextY + collisionYOffset;
      const canMove =
        isWalkableAtWorld(nextX, probeY)
        && isWalkableAtWorld(nextX - sideProbeOffset, probeY)
        && isWalkableAtWorld(nextX + sideProbeOffset, probeY);

      if (canMove) {
        state.game.playerWorld = { x: nextX, y: nextY };
      }
    }

    if (state.selectedAvatarId === "human" && typeof state.player.use === "function") {
      const moving = dx !== 0 || dy !== 0;
      if (moving) {
        state.game.animTimer += dt();
        if (state.game.animTimer >= 0.16) {
          state.game.animTimer = 0;
          state.game.animFrame = (state.game.animFrame + 1) % 4;
        }
      } else {
        state.game.animTimer = 0;
        state.game.animFrame = 0;
      }
      const spriteName = getHumanSpriteForMovement(dx, dy);
      if (state.player.sprite !== spriteName) {
        state.player.use(sprite(spriteName));
      }
    }

    updateGameCamera();

    state.game.hudTimer += dt();
    if (state.game.hudTimer >= 0.1) {
      state.game.hudTimer = 0;
      if (hud.status && hud.info && hud.loot) {
        updateHud();
      }
    }
  });
}

function setupMenu() {
  const center = vec2(width() / 2, height() / 2);
  const base = add([
    sprite("menu"),
    pos(center),
    anchor("center"),
    scale(1),
    "menu",
  ]);
  const hover = add([
    sprite("menuHover"),
    pos(center),
    anchor("center"),
    scale(1),
    "menu",
  ]);
  hover.hidden = true;
  state.menu.base = base;
  state.menu.hover = hover;

  onUpdate(() => {
    if (state.mode !== "menu") return;
    if (!base || !hover) return;

    const baseScale = getUiScale() * (menuRef.width / base.width);
    base.scale = vec2(baseScale);
    hover.scale = vec2(baseScale);

    const mouse = getMouseWorld();
    if (!mouse) {
      base.hidden = false;
      hover.hidden = true;
      return;
    }
    const scaleFactor = base.scale?.x ?? 1;
    const shouldHover = hover.hidden
      ? isInsideMask(menuMask, mouse, base.pos, scaleFactor)
      : isInsideMask(hoverMask, mouse, base.pos, scaleFactor);

    base.hidden = shouldHover;
    hover.hidden = !shouldHover;
    hover.scale = vec2(base.scale.x);
  });

  onMousePress("left", () => {
    if (state.mode !== "menu") return;
    const mouse = getMouseWorld();
    if (!mouse) return;
    const scaleFactor = base.scale?.x ?? 1;

    if (isInsideMask(buttonMasks.play, mouse, base.pos, scaleFactor)) {
      startGame().catch((err) => console.error(err));
      return;
    }
    if (isInsideMask(buttonMasks.class, mouse, base.pos, scaleFactor)) {
      openClassMenu().catch((err) => console.error(err));
      return;
    }
    if (isInsideMask(buttonMasks.custom, mouse, base.pos, scaleFactor)) {
      openCustomMenu().catch((err) => console.error(err));
    }
  });
}

function setupClassMenu() {
  onUpdate(() => {
    if (state.mode !== "class_menu") return;
    const base = state.classMenu.bg;
    if (!base) return;

    const baseScale = getUiScale() * (menuRef.width / base.width);
    base.scale = vec2(baseScale);

    const descPos = maskCenterWorld(classMenuMasks.description, base.pos, baseScale);
    const currentPos = maskCenterWorld(classMenuMasks.current, base.pos, baseScale);
    const rollsPos = maskCenterWorld(classMenuMasks.rolls, base.pos, baseScale);
    const thickOffset = 1;

    if (state.classMenu.descriptionShadow) {
      state.classMenu.descriptionShadow.pos = vec2(descPos.x + thickOffset, descPos.y);
    }
    if (state.classMenu.description) state.classMenu.description.pos = vec2(descPos.x, descPos.y);
    if (state.classMenu.currentShadow) {
      state.classMenu.currentShadow.pos = vec2(currentPos.x + thickOffset, currentPos.y);
    }
    if (state.classMenu.current) state.classMenu.current.pos = vec2(currentPos.x, currentPos.y);
    if (state.classMenu.rollsShadow) {
      state.classMenu.rollsShadow.pos = vec2(rollsPos.x + thickOffset, rollsPos.y);
    }
    if (state.classMenu.rolls) state.classMenu.rolls.pos = vec2(rollsPos.x, rollsPos.y);
  });

  onMousePress("left", () => {
    if (state.mode !== "class_menu") return;
    const base = state.classMenu.bg;
    if (!base) return;
    const mouse = getMouseWorld();
    if (!mouse) return;
    const scaleFactor = base.scale?.x ?? 1;

    if (isInsideMask(classMenuMasks.back, mouse, base.pos, scaleFactor)) {
      showMenu();
      return;
    }
    if (isInsideMask(classMenuMasks.spin, mouse, base.pos, scaleFactor)) {
      spinClass();
      updateClassMenuText();
    }
  });
}

function setupCustomMenu() {
  onUpdate(() => {
    if (state.mode !== "custom_menu") return;
    const base = state.customMenu.bg;
    if (!base) return;

    const baseScale = getUiScale() * (menuRef.width / base.width);
    base.scale = vec2(baseScale);

    const currentPos = maskCenterWorld(customMenuMasks.current, base.pos, baseScale);
    const leftPos = maskCenterWorld(customMenuMasks.left, base.pos, baseScale);
    const rightPos = maskCenterWorld(customMenuMasks.right, base.pos, baseScale);
    const currentSize = maskSizeWorld(customMenuMasks.current, baseScale);
    const leftSize = maskSizeWorld(customMenuMasks.left, baseScale);
    const rightSize = maskSizeWorld(customMenuMasks.right, baseScale);

    if (state.customMenu.currentBox) state.customMenu.currentBox.pos = vec2(currentPos.x, currentPos.y);
    if (state.customMenu.leftBox) state.customMenu.leftBox.pos = vec2(leftPos.x, leftPos.y);
    if (state.customMenu.rightBox) state.customMenu.rightBox.pos = vec2(rightPos.x, rightPos.y);
    if (state.customMenu.currentBox?.width && state.customMenu.currentBox?.height) {
      const fitScale = Math.min(
        (currentSize.width * 0.8) / state.customMenu.currentBox.width,
        (currentSize.height * 0.8) / state.customMenu.currentBox.height,
      );
      const middleScale = (Number.isFinite(fitScale) && fitScale > 0 ? fitScale : 1) * 1.5;
      state.customMenu.currentBox.scale = vec2(middleScale);

      if (state.customMenu.leftBox?.width && state.customMenu.leftBox?.height) {
        const leftFit = Math.min(
          (leftSize.width * 0.8) / state.customMenu.leftBox.width,
          (leftSize.height * 0.8) / state.customMenu.leftBox.height,
        );
        const leftBase = Number.isFinite(leftFit) && leftFit > 0 ? leftFit : 1;
        const leftCurrentScale = Math.min(leftBase, middleScale * 1.5);
        state.customMenu.leftBox.scale = vec2(leftCurrentScale * 2);
      }
      if (state.customMenu.rightBox?.width && state.customMenu.rightBox?.height) {
        const rightFit = Math.min(
          (rightSize.width * 0.8) / state.customMenu.rightBox.width,
          (rightSize.height * 0.8) / state.customMenu.rightBox.height,
        );
        const rightBase = Number.isFinite(rightFit) && rightFit > 0 ? rightFit : 1;
        const rightCurrentScale = Math.min(rightBase, middleScale * 1.5);
        state.customMenu.rightBox.scale = vec2(rightCurrentScale * 2);
      }
    }
  });

  onMousePress("left", () => {
    if (state.mode !== "custom_menu") return;
    const base = state.customMenu.bg;
    if (!base) return;
    const mouse = getMouseWorld();
    if (!mouse) return;
    const scaleFactor = base.scale?.x ?? 1;

    if (isInsideMask(customMenuMasks.back, mouse, base.pos, scaleFactor)) {
      showMenu();
      return;
    }
    if (isInsideMask(customMenuMasks.scrollLeft, mouse, base.pos, scaleFactor)) {
      state.customMenu.currentIndex -= 1;
      updateCustomMenuPreviews();
      return;
    }
    if (isInsideMask(customMenuMasks.scrollRight, mouse, base.pos, scaleFactor)) {
      state.customMenu.currentIndex += 1;
      updateCustomMenuPreviews();
    }
  });
}

function showMenu() {
  state.mode = "menu";
  if (state.player && typeof state.player.move === "function") {
    destroy(state.player);
  }
  state.player = null;
  state.enemies.forEach((enemy) => destroy(enemy));
  state.enemies = [];
  if (state.game.mapBg) {
    destroy(state.game.mapBg);
    state.game.mapBg = null;
  }
  if (hud.status) {
    destroy(hud.status);
    hud.status = null;
  }
  if (hud.info) {
    destroy(hud.info);
    hud.info = null;
  }
  if (hud.loot) {
    destroy(hud.loot);
    hud.loot = null;
  }
  if (state.screen.bg) {
    destroy(state.screen.bg);
    state.screen.bg = null;
  }
  if (state.screen.label) {
    destroy(state.screen.label);
    state.screen.label = null;
  }
  if (state.classMenu.bg) {
    destroy(state.classMenu.bg);
    state.classMenu.bg = null;
  }
  if (state.classMenu.description) {
    destroy(state.classMenu.description);
    state.classMenu.description = null;
  }
  if (state.classMenu.descriptionShadow) {
    destroy(state.classMenu.descriptionShadow);
    state.classMenu.descriptionShadow = null;
  }
  if (state.classMenu.current) {
    destroy(state.classMenu.current);
    state.classMenu.current = null;
  }
  if (state.classMenu.currentShadow) {
    destroy(state.classMenu.currentShadow);
    state.classMenu.currentShadow = null;
  }
  if (state.classMenu.rolls) {
    destroy(state.classMenu.rolls);
    state.classMenu.rolls = null;
  }
  if (state.classMenu.rollsShadow) {
    destroy(state.classMenu.rollsShadow);
    state.classMenu.rollsShadow = null;
  }
  if (state.customMenu.bg) {
    destroy(state.customMenu.bg);
    state.customMenu.bg = null;
  }
  if (state.customMenu.currentBox) {
    destroy(state.customMenu.currentBox);
    state.customMenu.currentBox = null;
  }
  if (state.customMenu.currentLabel) {
    destroy(state.customMenu.currentLabel);
    state.customMenu.currentLabel = null;
  }
  if (state.customMenu.leftBox) {
    destroy(state.customMenu.leftBox);
    state.customMenu.leftBox = null;
  }
  if (state.customMenu.leftLabel) {
    destroy(state.customMenu.leftLabel);
    state.customMenu.leftLabel = null;
  }
  if (state.customMenu.rightBox) {
    destroy(state.customMenu.rightBox);
    state.customMenu.rightBox = null;
  }
  if (state.customMenu.rightLabel) {
    destroy(state.customMenu.rightLabel);
    state.customMenu.rightLabel = null;
  }
  if (state.menu.base) state.menu.base.hidden = false;
  if (state.menu.hover) state.menu.hover.hidden = true;
}

function showScreen(title) {
  state.mode = "screen";
  if (state.menu.base) state.menu.base.hidden = true;
  if (state.menu.hover) state.menu.hover.hidden = true;
  if (state.screen.bg) destroy(state.screen.bg);
  if (state.screen.label) destroy(state.screen.label);
  state.screen.bg = add([
    rect(GAME_WIDTH, GAME_HEIGHT),
    pos(0, 0),
    color(0, 0, 0),
  ]);
  state.screen.label = add([
    text(title, { size: 24 }),
    pos(GAME_WIDTH / 2, GAME_HEIGHT / 2),
    anchor("center"),
    color(230, 230, 230),
  ]);
}

function updateClassMenuText() {
  const classId = state.player?.classId || state.selectedClassId || "none";
  const data = DATA.classes.classes[classId] ?? DATA.classes.classes.none;
  const perks = data.perks?.length ? data.perks.join("\n") : "None";
  const ability = data.ability || "None";
  const cooldown =
    data.cooldown_seconds == null ? "None" : `${data.cooldown_seconds}s`;

  if (state.classMenu.current) {
    state.classMenu.current.text = `Current Class:\n${data.name}`;
  }
  if (state.classMenu.currentShadow) {
    state.classMenu.currentShadow.text = `Current Class:\n${data.name}`;
  }
  if (state.classMenu.description) {
    state.classMenu.description.text = `Perks:\n${perks}\n\nAbility:\n${ability}\n\nCooldown: ${cooldown}`;
  }
  if (state.classMenu.descriptionShadow) {
    state.classMenu.descriptionShadow.text = `Perks:\n${perks}\n\nAbility:\n${ability}\n\nCooldown: ${cooldown}`;
  }
  if (state.classMenu.rolls) {
    state.classMenu.rolls.text = "Class Rolls: \u221e";
  }
  if (state.classMenu.rollsShadow) {
    state.classMenu.rollsShadow.text = "Class Rolls: \u221e";
  }
}

async function openClassMenu() {
  await ensureClassMenuAssets();
  showClassMenu();
}

function showClassMenu() {
  state.mode = "class_menu";
  if (state.menu.base) state.menu.base.hidden = true;
  if (state.menu.hover) state.menu.hover.hidden = true;

  if (state.classMenu.bg) destroy(state.classMenu.bg);
  if (state.classMenu.description) destroy(state.classMenu.description);
  if (state.classMenu.descriptionShadow) destroy(state.classMenu.descriptionShadow);
  if (state.classMenu.current) destroy(state.classMenu.current);
  if (state.classMenu.currentShadow) destroy(state.classMenu.currentShadow);
  if (state.classMenu.rolls) destroy(state.classMenu.rolls);
  if (state.classMenu.rollsShadow) destroy(state.classMenu.rollsShadow);

  state.classMenu.bg = add([
    sprite("classMenu"),
    pos(GAME_WIDTH / 2, GAME_HEIGHT / 2),
    anchor("center"),
    scale(1),
  ]);

  const base = state.classMenu.bg;
  const baseScale = getUiScale() * (menuRef.width / base.width);
  base.scale = vec2(baseScale);

  const descPos = maskCenterWorld(classMenuMasks.description, base.pos, baseScale);
  const currentPos = maskCenterWorld(classMenuMasks.current, base.pos, baseScale);
  const rollsPos = maskCenterWorld(classMenuMasks.rolls, base.pos, baseScale);
  const descBounds = maskBounds(classMenuMasks.description);
  const descWidth = descBounds
    ? Math.max(200, (descBounds.maxX - descBounds.minX) * baseScale * 0.85)
    : 520;

  const thickOffset = 1;
  state.classMenu.descriptionShadow = add([
    text("", { size: 22, width: descWidth }),
    pos(descPos.x + thickOffset, descPos.y),
    anchor("center"),
    color(0, 0, 0),
  ]);
  state.classMenu.description = add([
    text("", { size: 22, width: descWidth }),
    pos(descPos.x, descPos.y),
    anchor("center"),
    color(0, 0, 0),
  ]);
  state.classMenu.currentShadow = add([
    text("", { size: 26 }),
    pos(currentPos.x + thickOffset, currentPos.y),
    anchor("center"),
    color(0, 0, 0),
  ]);
  state.classMenu.current = add([
    text("", { size: 26 }),
    pos(currentPos.x, currentPos.y),
    anchor("center"),
    color(0, 0, 0),
  ]);
  state.classMenu.rollsShadow = add([
    text("", { size: 22 }),
    pos(rollsPos.x + thickOffset, rollsPos.y),
    anchor("center"),
    color(0, 0, 0),
  ]);
  state.classMenu.rolls = add([
    text("", { size: 22 }),
    pos(rollsPos.x, rollsPos.y),
    anchor("center"),
    color(0, 0, 0),
  ]);

  updateClassMenuText();
}

function showCustomMenu() {
  state.mode = "custom_menu";
  if (state.menu.base) state.menu.base.hidden = true;
  if (state.menu.hover) state.menu.hover.hidden = true;

  if (state.customMenu.bg) destroy(state.customMenu.bg);
  if (state.customMenu.currentBox) destroy(state.customMenu.currentBox);
  if (state.customMenu.currentLabel) destroy(state.customMenu.currentLabel);
  if (state.customMenu.leftBox) destroy(state.customMenu.leftBox);
  if (state.customMenu.leftLabel) destroy(state.customMenu.leftLabel);
  if (state.customMenu.rightBox) destroy(state.customMenu.rightBox);
  if (state.customMenu.rightLabel) destroy(state.customMenu.rightLabel);

  state.customMenu.bg = add([
    sprite("customMenu"),
    pos(GAME_WIDTH / 2, GAME_HEIGHT / 2),
    anchor("center"),
    scale(1),
  ]);

  const base = state.customMenu.bg;
  const baseScale = getUiScale() * (menuRef.width / base.width);
  base.scale = vec2(baseScale);

  const currentPos = maskCenterWorld(customMenuMasks.current, base.pos, baseScale);
  const leftPos = maskCenterWorld(customMenuMasks.left, base.pos, baseScale);
  const rightPos = maskCenterWorld(customMenuMasks.right, base.pos, baseScale);
  const currentSize = maskSizeWorld(customMenuMasks.current, baseScale);
  const leftSize = maskSizeWorld(customMenuMasks.left, baseScale);
  const rightSize = maskSizeWorld(customMenuMasks.right, baseScale);

  state.customMenu.currentBox = add([
    sprite("avatarHumanStandingRight"),
    pos(currentPos.x, currentPos.y),
    anchor("center"),
  ]);
  const previewScale = Math.min(
    (currentSize.width * 0.8) / state.customMenu.currentBox.width,
    (currentSize.height * 0.8) / state.customMenu.currentBox.height,
  );
  const middleScale = (Number.isFinite(previewScale) && previewScale > 0 ? previewScale : 1) * 1.5;
  state.customMenu.currentBox.scale = vec2(middleScale);

  state.customMenu.leftBox = add([
    sprite("avatarHumanStandingRight"),
    pos(leftPos.x, leftPos.y),
    anchor("center"),
  ]);
  const leftFit = Math.min(
    (leftSize.width * 0.8) / state.customMenu.leftBox.width,
    (leftSize.height * 0.8) / state.customMenu.leftBox.height,
  );
  const leftBase = Number.isFinite(leftFit) && leftFit > 0 ? leftFit : 1;
  const leftCurrentScale = Math.min(leftBase, middleScale * 1.5);
  state.customMenu.leftBox.scale = vec2(leftCurrentScale * 2);

  state.customMenu.rightBox = add([
    sprite("avatarHumanStandingRight"),
    pos(rightPos.x, rightPos.y),
    anchor("center"),
  ]);
  const rightFit = Math.min(
    (rightSize.width * 0.8) / state.customMenu.rightBox.width,
    (rightSize.height * 0.8) / state.customMenu.rightBox.height,
  );
  const rightBase = Number.isFinite(rightFit) && rightFit > 0 ? rightFit : 1;
  const rightCurrentScale = Math.min(rightBase, middleScale * 1.5);
  state.customMenu.rightBox.scale = vec2(rightCurrentScale * 2);

  updateCustomMenuPreviews();
}

async function openCustomMenu() {
  await ensureCustomMenuAssets();
  showCustomMenu();
}

async function startGame() {
  await ensureGameAssets();
  state.mode = "game";
  if (state.menu.base) state.menu.base.hidden = true;
  if (state.menu.hover) state.menu.hover.hidden = true;
  if (state.game.mapBg) destroy(state.game.mapBg);
  state.game.mapBg = add([
    sprite("map"),
    pos(GAME_WIDTH / 2, GAME_HEIGHT / 2),
    anchor("center"),
    scale(1),
  ]);
  state.game.mapBg.scale = vec2(safeSpriteScale(state.game.mapBg) * MAP_ZOOM);

  if (state.player && typeof state.player.move === "function") {
    destroy(state.player);
  }
  state.player = null;
  state.enemies.forEach((enemy) => destroy(enemy));
  state.enemies = [];

  if (hud.status) destroy(hud.status);
  if (hud.info) destroy(hud.info);
  if (hud.loot) destroy(hud.loot);
  hud.status = null;
  hud.info = null;
  hud.loot = null;
  setupPlayer();
  setupHud();
  if (!state.game.movementReady) {
    setupMovement();
    state.game.movementReady = true;
  }
  updateHud();
}

async function main() {
  await Promise.all([
    loadSpriteOnce("menu", "./data/Menu/Menu.png"),
    loadSpriteOnce("menuHover", "./data/Menu/Hovered%20menu.png"),
  ]);
  Object.assign(menuMask, await loadMask("./data/Menu/Menu%20area.png"));
  menuRef.width = menuMask.width || menuRef.width;
  menuRef.height = menuMask.height || menuRef.height;
  Object.assign(hoverMask, await loadMask("./data/Menu/Hovered%20menu%20area.png"));
  Object.assign(buttonMasks.play, await loadMask("./data/Menu/Play%20Button.png"));
  Object.assign(buttonMasks.custom, await loadMask("./data/Menu/Custom%20button.png"));
  Object.assign(buttonMasks.class, await loadMask("./data/Menu/Class%20button.png"));
  assetState.menuReady = true;

  DATA.classes = await loadJson("./data/classes.json");
  DATA.items = await loadJson("./data/items.json");
  DATA.lootTables = await loadJson("./data/loot_tables.json");
  DATA.dungeons = await loadJson("./data/dungeons.json");
  DATA.playerStats = await loadCsv("./data/Player Stats - Sheet1.csv");

  setupInput();
  setupMenu();
  setupClassMenu();
  setupCustomMenu();
}

main().catch((err) => {
  add([
    text(`Failed to start: ${err.message}`, { size: 16 }),
    pos(10, 10),
    color(255, 80, 80),
  ]);
});
