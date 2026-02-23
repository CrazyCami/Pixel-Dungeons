# Pixel Dungeons (Kaplay.js)

Minimal real-time 2D dungeon prototype scaffold in Kaplay.js. This is a starting base for:
- class spin system
- dungeon + enemy + loot tables
- class-tailored loot drops
- simple real-time combat loop

## Setup

Kaplay uses ES modules, so you need to run a local web server.

```bash
npx http-server -c-1 -p 5173
```

Then open: `http://localhost:5173`

## Controls
- Move: WASD or Arrow keys
- Start Game (from menu): Enter
- Spin Class: Class Menu only

## Notes
- Data lives under `data/` as JSON.
- The game entry point is `src/main.js`.
- Art can be added under `assets/` and loaded in `src/main.js`.
