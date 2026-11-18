import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as rules from '../src/rules.js';
const source = (await readFile(new URL('../src/game.js', import.meta.url), 'utf8')).replace(
  /^import[\s\S]*?from\s+['"]\.\/rules\.js['"];?\s*/,
  '',
);
function runtime() {
  const listeners = {},
    elements = new Map();
  const gradient = { addColorStop() {} };
  const context = new Proxy(
    { createLinearGradient: () => gradient, createRadialGradient: () => gradient },
    { get: (o, k) => (k in o ? o[k] : () => {}) },
  );
  const element = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        textContent: '',
        classList: { toggle() {} },
        addEventListener() {},
        getContext: () => context,
      });
    return elements.get(id);
  };
  const sandbox = {
    ...rules,
    Math,
    console,
    document: {
      querySelector: () => element('canvas'),
      createElement: () => ({ getContext: () => context }),
      getElementById: element,
      querySelectorAll: () => [],
      addEventListener: (k, v) => (listeners[k] = v),
    },
    window: { addEventListener() {} },
    localStorage: { getItem: () => 0, setItem() {} },
    requestAnimationFrame() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { sandbox, listeners, read: (code) => vm.runInContext(code, sandbox) };
}
test('canvas runtime launches, steps for 30 seconds, and keeps physics finite', () => {
  const game = runtime();
  game.listeners.keydown({ code: 'Space', preventDefault() {} });
  for (let i = 0; i < 7200; i++) {
    if (i % 100 === 0)
      game.read(`keys[0]=${i % 200 === 0};keys[1]=${i % 300 === 0};if(ball.ready)launch()`);
    game.read('physics(1/240)');
    if (i % 40 === 0) game.read('draw(); updateHUD()');
    assert.equal(
      game.read(
        'Number.isFinite(ball.x)&&Number.isFinite(ball.y)&&Number.isFinite(ball.vx)&&Number.isFinite(ball.vy)',
      ),
      true,
    );
  }
  assert.equal(game.read('clock>29'), true);
});
test('encounters, loot, returns, shields, and victory form a complete run', () => {
  const g = runtime();
  g.read("setup('goblin'); for(const t of [...targets])onTarget(t)");
  assert.equal(g.read('run.cleared'), true);
  g.read("run.last=1;onTarget(targets.find(t=>t.kind==='loot'));leave();physics(4)");
  assert.equal(g.read('run.table'), 'main');
  assert.equal(g.read('run.tier'), 1);
  assert.ok(g.read('run.items[1]'));
  g.read("setup('crypt');for(const t of [...targets])onTarget(t);leave();physics(4)");
  assert.equal(g.read('run.tier'), 2);
  g.read(
    "setup('dragon');run.items=[null,null];for(let i=0;i<4;i++){clock++;onTarget(targets[0])}",
  );
  assert.equal(g.read('run.shieldRaised'), true);
  assert.equal(g.read("targets.filter(t=>t.kind==='scale').length"), 4);
  const hp = g.read('targets[0].hp');
  g.read('clock++;onTarget(targets[0])');
  assert.equal(g.read('targets[0].hp'), hp);
  g.read(
    "for(const t of targets.filter(t=>t.kind==='scale')){clock++;onTarget(t);clock++;onTarget(t)};for(let i=0;i<4;i++){clock++;onTarget(targets[0])};leave()",
  );
  assert.equal(g.read('run.won&&run.over'), true);
});

test('a ball falling between the resting flippers enters the visible drain and costs one life', () => {
  const g = runtime();
  g.read('ball={x:244,y:760,vx:0,vy:180,ready:false};run.gold=7;run.items=["sword","fire"]');
  for (let i = 0; i < 240; i++) g.read('physics(1/240)');
  assert.equal(g.read('run.lives'), 2);
  assert.equal(g.read('run.gold'), 0);
  assert.equal(g.read('ball.ready'), true);
  assert.equal(g.read('ball.x'), 473);
});
test('skimming a cave does not trigger entry, but a shot through its mouth captures the ball', () => {
  const g = runtime();
  g.read(
    'targets.filter(t=>t.gate===0).forEach(t=>t.hp=0);ball={x:176,y:231,vx:220,vy:0,ready:false};physics(1/240)',
  );
  assert.equal(g.read('travel'), null);
  g.read('ball={x:176,y:247,vx:0,vy:-600,ready:false};physics(1/240)');
  assert.equal(g.read('travel.destination'), 'goblin');
  assert.equal(g.read('run.table'), 'main');
});
test('rail travel remains on screen, renders every phase, and releases without a position jump', () => {
  const g = runtime();
  g.read('ball={x:176,y:245,vx:0,vy:-400,ready:false};startTravel("goblin",false,{x:176,y:225})');
  let previous = g.read('({x:ball.x,y:ball.y})'),
    maxJump = 0;
  for (let i = 0; i < 914; i++) {
    g.read('physics(1/240)');
    const point = g.read('({x:ball.x,y:ball.y})');
    maxJump = Math.max(maxJump, Math.hypot(point.x - previous.x, point.y - previous.y));
    previous = point;
    assert.ok(point.x > 20 && point.x < 500 && point.y > 20 && point.y < 825);
    if (i % 15 === 0) g.read('draw()');
  }
  assert.equal(g.read('travel'), null);
  assert.equal(g.read('run.table'), 'goblin');
  assert.ok(maxJump < 5, `maximum step ${maxJump}`);
  assert.ok(g.read('ball.y>=704&&ball.y<710'));
});
test('pausing freezes a transition and a new run clears it', () => {
  const g = runtime();
  g.read('startTravel("crypt");paused=true;frame(100);frame(200)');
  assert.equal(g.read('travel.time'), 0);
  g.read('reset()');
  assert.equal(g.read('travel'), null);
  assert.equal(g.read('run.table'), 'main');
  assert.equal(g.read('ball.ready'), true);
});

test('the plunger launches out of the shooter lane onto the main playfield', () => {
  const g = runtime();
  g.read('launch()');
  let minX = 473;
  for (let i = 0; i < 720; i++) {
    g.read('physics(1/240)');
    minX = Math.min(minX, g.read('ball.x'));
  }
  assert.ok(minX < 400, `ball remained in the shooter lane at ${minX}`);
});

test('launch releases high on the left and the free fall misses targets on every table', () => {
  for (const table of ['main', 'goblin', 'crypt', 'dragon']) {
    const g = runtime();
    g.read(`setup('${table}');ready();launch()`);
    const before = g.read('JSON.stringify(targets.map(t=>[t.hp,t.armor]))');
    let previous = g.read('({x:ball.x,y:ball.y})');
    for (let i = 0; i < 313; i++) {
      g.read('physics(1/240)');
      const point = g.read('({x:ball.x,y:ball.y})');
      assert.ok(Math.hypot(point.x - previous.x, point.y - previous.y) < 9);
      previous = point;
      assert.ok(point.x >= 45 && point.x <= 485 && point.y >= 35 && point.y <= 800);
    }
    assert.equal(g.read('launchRide'), null);
    assert.equal(g.read('travel'), null);
    assert.ok(g.read('Math.abs(ball.x-110)<1&&ball.y>=145&&ball.y<150'));
    for (let i = 0; i < 400 && g.read('ball.y<590'); i++) g.read('physics(1/240)');
    assert.ok(g.read('ball.y>=590'));
    assert.equal(g.read('run.score'), 0);
    assert.equal(g.read('run.gold'), 0);
    assert.equal(g.read('JSON.stringify(targets.map(t=>[t.hp,t.armor]))'), before);
    assert.equal(g.read('travel'), null);
  }
});
test('new run clears an in-progress launch', () => {
  const g = runtime();
  g.read('launch();physics(.5);reset()');
  assert.equal(g.read('launchRide'), null);
  assert.equal(g.read('ball.ready'), true);
});

test('all three staggered caves capture at their own mouth and stay gated by their own guards', () => {
  for (let gate = 0; gate < 3; gate++) {
    const g = runtime();
    g.read(
      `const mouth=CAVES[${gate}];ball={x:mouth.x,y:mouth.y+22,vx:0,vy:-600,ready:false};physics(1/240)`,
    );
    assert.equal(g.read('travel'), null);
    g.read(
      `targets.filter(t=>t.gate===${gate}).forEach(t=>t.hp=0);ball={x:mouth.x,y:mouth.y+22,vx:0,vy:-600,ready:false};physics(1/240)`,
    );
    assert.equal(g.read('travel.destination'), 'goblin');
    assert.equal(g.read('travel.mouth.y'), g.read('mouth.y'));
  }
});

test('both inlane guides feed the flipper instead of leaking through the heel gap', () => {
  for (const side of [0, 1]) {
    const g = runtime();
    g.read(`ball={x:${side ? 356 : 132},y:690,vx:0,vy:150,ready:false};run.last=${1 - side}`);
    let touched = false;
    for (let i = 0; i < 360; i++) {
      g.read('physics(1/240)');
      if (g.read('run.score') > 0) {
        touched = true;
        break;
      }
      assert.equal(g.read('run.lives'), 3);
    }
    assert.equal(touched, true, `side ${side} never reached the flipper`);
    assert.equal(g.read('run.last'), side);
    assert.ok(g.read('ball.y<790'));
  }
});
test('a player can flip the ball back up after an inlane feed', () => {
  for (const side of [0, 1]) {
    const g = runtime();
    g.read(`ball={x:${side ? 356 : 132},y:690,vx:0,vy:150,ready:false}`);
    let returned = false;
    for (let i = 0; i < 480; i++) {
      if (g.read('ball.y>716')) g.read(`keys[${side}]=true`);
      g.read('physics(1/240)');
      if (g.read('run.score>0&&ball.vy< -100')) {
        returned = true;
        break;
      }
    }
    assert.equal(returned, true, `side ${side} could not return the feed`);
    assert.equal(g.read('run.lives'), 3);
  }
});

test('an upward shot into the left rail carries the ball into the inn with three choices', () => {
  const g = runtime();
  g.read('ball={x:85,y:557,vx:0,vy:-600,ready:false};physics(1/240)');
  assert.ok(g.read('innRide'));
  assert.equal(g.read('run.table'), 'main');
  for (let i = 0; i < 1300; i++) {
    g.read('physics(1/240)');
    if (i % 100 === 0) g.read('draw();updateHUD()');
  }
  assert.equal(g.read('run.table'), 'inn');
  assert.equal(g.read('targets.length'), 3);
  assert.equal(g.read('targets.every(t=>t.kind==="shop")'), true);
  assert.equal(g.read('bumpers.length'), 0);
  assert.equal(g.read('run.cleared'), true);
});
test('inn purchase holds the ball, equips the chosen flipper, and persists through return visits', () => {
  const g = runtime();
  g.read(
    'targets[0].hp=0;run.gold=20;const saved=JSON.stringify(targets);startTravel("inn",false,INN);physics(4)',
  );
  const price = g.read('ITEMS[targets[0].item].price'),
    item = g.read('targets[0].item');
  g.read('onTarget(targets[0])');
  assert.ok(g.read('shop'));
  assert.equal(g.read('ball.vy'), 0);
  g.read('flipper(1,true)');
  assert.equal(g.read('run.items[1]'), item);
  assert.equal(g.read('run.gold'), 20 - price);
  assert.equal(g.read('stock[0]'), null);
  assert.equal(g.read('targets[0].hp'), 0);
  g.read('leave();physics(4)');
  assert.equal(g.read('run.tier'), 0);
  assert.equal(g.read('run.table'), 'main');
  assert.equal(g.read('JSON.stringify(targets)===saved'), true);
  g.read('startTravel("inn",false,INN);physics(4);draw()');
  assert.equal(g.read('targets[0].hp'), 0);
  assert.equal(g.read('stock[0]'), null);
});
test('unaffordable inn choices leave the ball free and do not charge gold or score', () => {
  const g = runtime();
  g.read('startTravel("inn",false,INN);physics(4);run.gold=0;onTarget(targets[1])');
  assert.equal(g.read('shop'), null);
  assert.equal(g.read('run.gold'), 0);
  assert.equal(g.read('run.score'), 0);
});
test('leaving the inn without buying does not advance tiers or reset an open cave', () => {
  const g = runtime();
  g.read(
    'run.tier=1;targets.filter(t=>t.gate===2).forEach(t=>t.hp=0);const inventory=JSON.stringify(stock);startTravel("inn",false,INN);physics(4);leave();physics(4)',
  );
  assert.equal(g.read('run.tier'), 1);
  assert.equal(g.read('targets.filter(t=>t.gate===2).every(t=>t.hp===0)'), true);
  assert.equal(g.read('JSON.stringify(stock)===inventory'), true);
  assert.equal(g.read('run.score'), 0);
});
