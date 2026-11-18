# Pinball Dungeon Crawl

A local browser prototype based on the supplied `pinball-crawl.pdf`. Pure JavaScript and Canvas, with no build step or runtime dependencies. Requires Node **20.11 or later**.

## Play

From this repository directory:

```sh
npm start
```

Open **http://localhost:5174**. To use a different port, run `PORT=5175 npm start`.

| Control         | Action                   |
| --------------- | ------------------------ |
| A / Left arrow  | Left flipper             |
| D / Right arrow | Right flipper            |
| Space           | Launch                   |
| P               | Pause / resume           |
| M               | Toggle synthesized sound |
| New run         | Reset the run            |

Touch controls are available below the table. The game pauses when the window loses focus. Best score is stored locally; run progress is not saved across reloads. Google Fonts are optional; system fonts provide an offline fallback.

## The prototype

- One countryside table with three staggered cave entrances, each gated by its own guards. The shooter follows the upper orbit and releases into a clear left return.
- Three lives. A drain removes gold and both items while preserving encounter progress. Only a ward carried by the active flipper saves a drain, consuming the ward.
- Each flipper holds one item; the ball carries the last flipper's effect. Prototype items: iron sword, fire staff, coin purse, guardian ward.
- The upper-left inn has its own room, reached by shooting upward into the vertical rail marked `INN ↑`. Inside are three priced choices and an open exit. Hit an affordable item, then press a flipper to equip it.
- Inn visits preserve guards and dungeon progress. Purchases stay sold until a dungeon return restocks them. Visiting or leaving the inn does not advance a tier.
- Goblin warren: break three goblins. Crypt: hit four skeletons in order; a wrong hit resets the sequence. All three caves currently lead to that tier's same encounter.
- Cleared encounters open an exit and three loot targets. Choose one item for the last flipper, or leave without loot.
- After two dungeons, shoot the upper-left orbit to unlock the dragon's cave. The moving dragon raises four armored scale targets at half health. Defeat it and shoot the exit to win.
- Fixed-step 240 Hz playfield simulation, guide rails joined to the flipper heels, visible drain, backbox events, and scripted rail transitions with terrain changes.

## Develop and validate

Runtime needs no installation. Development checks use a pinned, development-only Prettier dependency:

```sh
npm ci
npm test
npm run check
```

`npm run check` checks JavaScript syntax and formatting. Run `npm run format` to apply formatting.

The tests cover item rules, resource loss, armor, purchases, ordered puzzles, complete run progression, continuous rail travel, launch clearance, feeds and return shots on both flippers, and inn entry/purchase/return behavior. Runtime tests use a mocked DOM/Canvas. Desktop/mobile rendering and transitions have also been checked separately in headless Chrome; those browser checks are not part of `npm test`.

| File                      | Purpose                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `src/game.js`             | Input, playfield simulation, scene transitions, rendering, HUD |
| `src/rules.js`            | Item, damage, economy, drain, and encounter rules              |
| `index.html`, `style.css` | Machine frame, controls, and responsive page                   |
| `server.mjs`              | Local static server; serves only game assets                   |
| `tests/`                  | Node rule tests and runtime harness                            |

## Scope and design notes

This is a Canvas prototype, **not the design document's Godot/C++ implementation**. It does not validate GDExtension web compilation, final physics feel, 3D presentation, or 15-minute pacing. Alternate layouts, additional dungeon types, full ramps/spinners, lane skill shots, wandering encounters, persistent unlocks, and a high-score list are not implemented.

[DESIGN_REVIEW.md](DESIGN_REVIEW.md) records the original PDF handoff assessment. [design-decisions.json](design-decisions.json) separates prototype assumptions from later requested changes. The source PDF is not bundled in this repository.
