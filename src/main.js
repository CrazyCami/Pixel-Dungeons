import kaplay from "https://unpkg.com/kaplay@3001.0.19/dist/kaplay.mjs";

const GAME_WIDTH = 1920;
const GAME_HEIGHT = 1920;
const canvas = document.querySelector("#game");

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
  const scale = baseScale * 1.875;
  canvas.style.width = `${Math.floor(GAME_WIDTH * scale)}px`;
  canvas.style.height = `${Math.floor(GAME_HEIGHT * scale)}px`;
}

function scheduleFit() {
  fitCanvasToViewport();
  requestAnimationFrame(fitCanvasToViewport);
}

window.addEventListener("resize", scheduleFit);
window.addEventListener("load", scheduleFit);
scheduleFit();

const k = kaplay({
  global: false,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  canvas,
  background: [20, 18, 24],
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
  onKeyPress,
  isKeyDown,
  mousePos,
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
};

const menuMask = {
  data: null,
  width: 0,
  height: 0,
};

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
  menuMask.data = img.data;
  menuMask.width = off.width;
  menuMask.height = off.height;
}

function isBrownPixel(r, g, b, a) {
  if (a < 10) return false;
  const isDark = r < 140 && g < 120 && b < 90;
  const isBrownish = r > g && g > b;
  return isDark && isBrownish;
}

function spinClass() {
  const spinTable = DATA.classes.spin_table;
  const classId = weightedChoice(spinTable.map((e) => [e.class_id, e.weight]));
  state.player.classId = classId;
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
  const speed = stats.Speed ?? stats.speed ?? 180;
  const attack = stats["Physical damage"] ?? stats.attack ?? 5;
  const magicDamage = stats["Magic Damage"] ?? stats["Magic damage"] ?? stats.magic ?? 0;
  state.player = add([
    rect(20, 20),
    pos(GAME_WIDTH / 2, GAME_HEIGHT / 2),
    color(70, 200, 90),
    area(),
    "player",
    {
      speed,
      hp,
      attack,
      magicDamage,
      classId: "",
      lastHit: 0,
    },
  ]);
  state.player.onCollide("enemy", (enemy) => handleCombat(enemy));
}

function setupInput() {
  onKeyPress("r", () => {
    if (state.mode !== "game") return;
    spinClass();
  });
  onKeyPress("enter", () => {
    if (state.mode === "menu") {
      startGame();
      return;
    }
    startDungeon("dungeon_1");
  });
}

function setupMovement() {
  onUpdate(() => {
    if (state.mode !== "game") return;
    state.elapsed += dt();

    const dx = (isKeyDown("d") || isKeyDown("right")) - (isKeyDown("a") || isKeyDown("left"));
    const dy = (isKeyDown("s") || isKeyDown("down")) - (isKeyDown("w") || isKeyDown("up"));

    if (dx || dy) {
      const length = Math.hypot(dx, dy) || 1;
      const vx = (dx / length) * state.player.speed;
      const vy = (dy / length) * state.player.speed;
      state.player.move(vx, vy);
    }

    state.player.pos.x = Math.max(0, Math.min(GAME_WIDTH - 20, state.player.pos.x));
    state.player.pos.y = Math.max(0, Math.min(GAME_HEIGHT - 20, state.player.pos.y));

    updateHud();
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

    const baseScale = (Math.min(
      canvas.clientWidth / base.width,
      canvas.clientHeight / base.height,
    ) || 1) * 0.95;
    base.scale = vec2(baseScale);
    hover.scale = vec2(baseScale);

    const mouse = getMouseWorld();
    if (!mouse) {
      base.hidden = false;
      hover.hidden = true;
      return;
    }
    const scaleFactor = base.scale?.x ?? 1;
    const halfW = (menuMask.width * scaleFactor) / 2;
    const halfH = (menuMask.height * scaleFactor) / 2;
    const localX = mouse.x - base.pos.x + halfW;
    const localY = mouse.y - base.pos.y + halfH;

    let isHover = false;
    if (
      menuMask.data &&
      localX >= 0 &&
      localY >= 0 &&
      localX < menuMask.width * scaleFactor &&
      localY < menuMask.height * scaleFactor
    ) {
      const imgX = Math.floor(localX / scaleFactor);
      const imgY = Math.floor(localY / scaleFactor);
      const idx = (imgY * menuMask.width + imgX) * 4;
      const r = menuMask.data[idx];
      const g = menuMask.data[idx + 1];
      const b = menuMask.data[idx + 2];
      const a = menuMask.data[idx + 3];
      isHover = isBrownPixel(r, g, b, a);
    }

    base.hidden = isHover;
    hover.hidden = !isHover;
    if (isHover) {
      // keep exact size match with base
      hover.scale = vec2(base.scale.x);
    } else {
      hover.scale = vec2(base.scale.x);
    }
  });
}

function startGame() {
  state.mode = "game";
  if (state.menu.base) destroy(state.menu.base);
  if (state.menu.hover) destroy(state.menu.hover);
  state.menu.base = null;
  state.menu.hover = null;

  setupPlayer();
  setupHud();
  setupMovement();
  updateHud();
}

async function main() {
  await Promise.all([
    loadSprite("menu", "./data/Menu/Menu.png"),
    loadSprite("menuHover", "./data/Menu/Hovered%20menu.png"),
  ]);
  await loadMask("./data/Menu/Menu.png");

  DATA.classes = await loadJson("./data/classes.json");
  DATA.items = await loadJson("./data/items.json");
  DATA.lootTables = await loadJson("./data/loot_tables.json");
  DATA.dungeons = await loadJson("./data/dungeons.json");
  DATA.playerStats = await loadCsv("./data/Player Stats - Sheet1.csv");

  setupInput();
  setupMenu();
}

main().catch((err) => {
  add([
    text(`Failed to start: ${err.message}`, { size: 16 }),
    pos(10, 10),
    color(255, 80, 80),
  ]);
});
