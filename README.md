# Cube Roller

A physics game in a blocky world: roll your cube in your hands to roll it in the world, or turn its layers to push off the ground.

An official [acubemy](https://acubemy.com) plugin for Bluetooth smart cubes. Install it on acubemy under **Games & Plugins** with the URL `https://github.com/acubemy/cube-roller`.

## Controls

- Calibrate once (white on top, green in front); the virtual cube then follows your cube's orientation
- Keep rolling the cube in your hands to roll forward
- Layer turns push the cube with real physics; hop up blue stairs with fast R L' turns

## Structure

| File | Purpose |
| --- | --- |
| `acubemy-plugin.json` | Plugin manifest (id, name, entry file, permissions) |
| `index.html` | Entry page, loads the acubemy SDK, the stylesheet and the game module |
| `style.css` | HUD styles |
| `main.js` | Game logic (Three.js + Rapier physics) |

Relative paths work like on any static site: acubemy serves the repo at a pinned commit or tag, so you can split your plugin into as many CSS, JS and asset files as you like.

## License

MIT
