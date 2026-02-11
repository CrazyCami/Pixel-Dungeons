import kaplay from "https://unpkg.com/kaplay@3001.0.19/dist/kaplay.mjs";

const GAME_WIDTH = 1920;
const GAME_HEIGHT = 1920;
const UI_SCALE = 0.9;
const menuRef = { width: GAME_WIDTH, height: GAME_HEIGHT };
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

function getUiScale() {
  const baseScale = Math.min(
    canvas.clientWidth / GAME_WIDTH,
    canvas.clientHeight / GAME_HEIGHT,
  ) || 1;
  return baseScale * UI_SCALE;
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
    current: null,
    rolls: null,
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
  return {
    data: img.data,
    width: off.width,
    height: off.height,
  };
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

function spinClass() {
  if (!state.player) {
    state.player = {
      classId: "none",
      lastHit: 0,
      hp: 0,
      attack: 0,
      speed: 0,
      magicDamage: 0,
    };
  }
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
  onKeyPress("escape", () => {
    if (state.mode === "menu") return;
    showMenu();
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
      showScreen("Press Esc to return");
      return;
    }
    if (isInsideMask(buttonMasks.class, mouse, base.pos, scaleFactor)) {
      showClassMenu();
      return;
    }
    if (isInsideMask(buttonMasks.custom, mouse, base.pos, scaleFactor)) {
      showScreen("Press Esc to return");
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

    if (state.classMenu.description) state.classMenu.description.pos = vec2(descPos.x, descPos.y);
    if (state.classMenu.current) state.classMenu.current.pos = vec2(currentPos.x, currentPos.y);
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

function showMenu() {
  state.mode = "menu";
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
  if (state.classMenu.current) {
    destroy(state.classMenu.current);
    state.classMenu.current = null;
  }
  if (state.classMenu.rolls) {
    destroy(state.classMenu.rolls);
    state.classMenu.rolls = null;
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
  const classId = state.player?.classId || "none";
  const data = DATA.classes.classes[classId] ?? DATA.classes.classes.none;
  const perks = data.perks?.length ? data.perks.join("\n") : "None";
  const ability = data.ability || "None";
  const cooldown =
    data.cooldown_seconds == null ? "None" : `${data.cooldown_seconds}s`;

  if (state.classMenu.current) {
    state.classMenu.current.text = `Current Class:\n${data.name}`;
  }
  if (state.classMenu.description) {
    state.classMenu.description.text = `Perks:\n${perks}\n\nAbility:\n${ability}\n\nCooldown: ${cooldown}`;
  }
  if (state.classMenu.rolls) {
    state.classMenu.rolls.text = "Class Rolls:\nInfinite";
  }
}

function showClassMenu() {
  state.mode = "class_menu";
  if (state.menu.base) state.menu.base.hidden = true;
  if (state.menu.hover) state.menu.hover.hidden = true;

  if (state.classMenu.bg) destroy(state.classMenu.bg);
  if (state.classMenu.description) destroy(state.classMenu.description);
  if (state.classMenu.current) destroy(state.classMenu.current);
  if (state.classMenu.rolls) destroy(state.classMenu.rolls);

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

  state.classMenu.description = add([
    text("", { size: 24, width: descWidth }),
    pos(descPos.x, descPos.y),
    anchor("center"),
    color(0, 0, 0),
  ]);
  state.classMenu.current = add([
    text("", { size: 24 }),
    pos(currentPos.x, currentPos.y),
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

function startGame() {
  state.mode = "game";
  if (state.menu.base) state.menu.base.hidden = true;
  if (state.menu.hover) state.menu.hover.hidden = true;

  setupPlayer();
  setupHud();
  setupMovement();
  updateHud();
}

async function main() {
  await Promise.all([
    loadSprite("menu", "./data/Menu/Menu.png"),
    loadSprite("menuHover", "./data/Menu/Hovered%20menu.png"),
    loadSprite("classMenu", "./data/Class%20Menu/Class%20Menu.png"),
  ]);
  Object.assign(menuMask, await loadMask("./data/Menu/Menu%20area.png"));
  menuRef.width = menuMask.width || menuRef.width;
  menuRef.height = menuMask.height || menuRef.height;
  Object.assign(hoverMask, await loadMask("./data/Menu/Hovered%20menu%20area.png"));
  Object.assign(buttonMasks.play, await loadMask("./data/Menu/Play%20Button.png"));
  Object.assign(buttonMasks.custom, await loadMask("./data/Menu/Custom%20button.png"));
  Object.assign(buttonMasks.class, await loadMask("./data/Menu/Class%20button.png"));
  Object.assign(classMenuMasks.back, await loadMask("./data/Class%20Menu/Back%20Button%20-%20Class%20Menu.png"));
  Object.assign(classMenuMasks.description, await loadMask("./data/Class%20Menu/Class%20Description%20-%20Class%20Menu.png"));
  Object.assign(classMenuMasks.current, await loadMask("./data/Class%20Menu/Current%20Class%20-%20Class%20Menu.png"));
  Object.assign(classMenuMasks.rolls, await loadMask("./data/Class%20Menu/Class%20Rolls%20-%20Class%20Menu.png"));
  Object.assign(classMenuMasks.spin, await loadMask("./data/Class%20Menu/Spin%20Button%20-%20Class%20Menu.png"));

  DATA.classes = await loadJson("./data/classes.json");
  DATA.items = await loadJson("./data/items.json");
  DATA.lootTables = await loadJson("./data/loot_tables.json");
  DATA.dungeons = await loadJson("./data/dungeons.json");
  DATA.playerStats = await loadCsv("./data/Player Stats - Sheet1.csv");

  setupInput();
  setupMenu();
  setupClassMenu();
}

main().catch((err) => {
  add([
    text(`Failed to start: ${err.message}`, { size: 16 }),
    pos(10, 10),
    color(255, 80, 80),
  ]);
});
