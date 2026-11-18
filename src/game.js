import { ITEMS, newRun, damage, breakReward, drain, buy, loot, cryptHit } from './rules.js';
const canvas = document.querySelector('canvas'),
  $ = (id) => document.getElementById(id);
let ctx = canvas.getContext('2d');
const W = 520,
  H = 840,
  STEP = 1 / 240,
  keys = [false, false],
  R = 8;
// Shared geometry keeps the visible machine and collision surfaces aligned.
const FIELD = { shooter: 473, drainY: 827 };
// Stagger the three entrances like the design's shot map, leaving the left
// orbit/drop corridor clear instead of lining every gate across the launch.
const CAVES = [
  { x: 176, y: 225, label: 'WARREN' },
  { x: 342, y: 145, label: 'OLD HALL' },
  { x: 370, y: 340, label: 'BURROW' },
];
const INN = { x: 85, y: 110, railBottom: 555 };
const GUIDES = [
  [35, 650, 93, 805],
  [395, 805, 445, 650],
  // Join the stationary heels so the guide cannot leave a drain-sized gap
  // as the flippers rotate. Rendering and collision use these same segments.
  [62, 590, 145, 745],
  [426, 590, 343, 745],
];
const SLINGS = [
  [
    [91, 605],
    [152, 678],
    [107, 671],
  ],
  [
    [397, 605],
    [336, 678],
    [381, 671],
  ],
];
const TRAVEL_DURATION = 3.8;
const smooth = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
let run,
  ball,
  targets = [],
  bumpers = [],
  particles = [],
  travel = null,
  launchRide = null,
  innRide = null,
  mainVisitState = null,
  shop = null,
  paused = false,
  sound = false,
  audioCtx,
  clock = 0,
  acc = 0,
  last = 0,
  eventUntil = 0,
  eventText = '',
  best = 0,
  stock = [],
  shopStockNames = [],
  flippers = [],
  trail = [];
try {
  best = Number(localStorage.getItem('pincrawl-best')) || 0;
} catch {}
const rnd = (a, b) => a + Math.random() * (b - a),
  clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function tone(freq = 250, duration = 0.06) {
  if (!sound) return;
  try {
    audioCtx ??= new AudioContext();
    const o = audioCtx.createOscillator(),
      g = audioCtx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(freq * 0.55, audioCtx.currentTime + duration);
    g.gain.setValueAtTime(0.035, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + duration);
  } catch {}
}
function announce(text, seconds = 2) {
  eventText = text;
  eventUntil = clock + seconds;
  updateHUD();
}
function questMessage() {
  if (run.over)
    return run.won ? 'TOME RECLAIMED · NEW RUN TO PLAY' : 'THE AMULET IS EMPTY · NEW RUN';
  if (paused) return 'PAUSED · P TO CONTINUE';
  if (shop) return `${ITEMS[shop.item].name} · ${ITEMS[shop.item].price}G · CHOOSE L / R`;
  if (ball.ready) return 'SPACE / LAUNCH TO PLUNGE';
  if (run.table === 'main')
    return run.tier < 2
      ? 'BREAK GUARDS · SHOOT AN OPEN CAVE'
      : 'SHOOT THE LEFT ORBIT · OPEN THE LAIR';
  if (run.table === 'inn') return 'SHOOT AN ITEM · OR TAKE THE EXIT';
  if (run.cleared) return 'PICK ONE LOOT · OR SHOOT THE EXIT';
  if (run.table === 'goblin') return 'BREAK THE THREE GOBLINS';
  if (run.table === 'crypt') return `SKELETONS IN ORDER · NEXT ${run.sequence + 1}`;
  return targets.some((t) => t.kind === 'scale' && t.hp)
    ? 'BREAK FOUR SCALES · EXPOSE THE DRAGON'
    : 'HIT THE DRAGON · RECLAIM THE TOME';
}

function travelMessage() {
  if (!travel) return null;
  if (travel.time < 0.65) return 'CAVE CAPTURE · BALL LOCKED';
  if (travel.time < 2.5)
    return travel.returning
      ? 'ASCENDING · THE KINGDOM REFORMS'
      : 'DESCENDING · THE DUNGEON TAKES SHAPE';
  return 'RAIL RELEASE APPROACHING · FLIPPERS READY';
}

function updateHUD() {
  const quest = questMessage();
  $('score').textContent = String(run.score).padStart(6, '0');
  $('gold').textContent = 'GOLD ' + String(run.gold).padStart(2, '0');
  $('lives').textContent = '◆ '.repeat(run.lives) + '◇ '.repeat(3 - run.lives);
  let message = quest;
  if (!run.over && !paused && !shop) {
    message = innRide
      ? 'INN RAIL · UP TO THE LANTERN'
      : travelMessage() || (clock < eventUntil ? eventText : quest);
  }
  $('message').textContent = message;
  $('best').textContent = 'BEST ' + String(Math.max(best, run.score)).padStart(6, '0');
  $('loadout').textContent =
    `L: ${ITEMS[run.items[0]]?.name || 'EMPTY'} / R: ${ITEMS[run.items[1]]?.name || 'EMPTY'}`;
  $('stage').textContent = {
    main: 'I · COUNTRYSIDE',
    goblin: 'II · GOBLIN WARREN',
    crypt: 'III · THE CRYPT',
    dragon: 'IV · DRAGON’S LAIR',
    inn: 'INN · THREE CHOICES',
  }[run.table];
  document
    .querySelectorAll('[data-step]')
    .forEach((el) =>
      el.classList.toggle(
        'active',
        Number(el.dataset.step) === { main: 0, goblin: 1, crypt: 2, dragon: 3 }[run.table],
      ),
    );
  $('pause').textContent = paused ? '▶' : 'Ⅱ';
}
function saveBest() {
  best = Math.max(best, run.score);
  try {
    localStorage.setItem('pincrawl-best', best);
  } catch {}
}
function makeFlippers() {
  flippers = [
    { x: 145, y: 745, length: 86, angle: 0.37, side: 0, omega: 0 },
    { x: 343, y: 745, length: 86, angle: Math.PI - 0.37, side: 1, omega: 0 },
  ];
}
function ready() {
  launchRide = null;
  ball = { x: FIELD.shooter, y: 774, vx: 0, vy: 0, ready: true };
  trail = [];
}
function reset() {
  run = newRun();
  clock = 0;
  shop = null;
  travel = null;
  innRide = null;
  mainVisitState = null;
  paused = false;
  particles = [];
  keys.fill(false);
  makeFlippers();
  ready();
  setup('main');
  announce('THREE LIVES · BRING BACK THE TOME', 4);
}
function target(x, y, kind, hp = 1, armor = 0, extra = {}) {
  return { x, y, kind, hp, armor, cool: 0, ...extra };
}
function restock() {
  stock = ['sword', 'fire', 'ward'];
  stock[0] = Math.random() < 0.5 ? 'sword' : 'purse';
  if (run.tier > 0) stock.sort(() => Math.random() - 0.5);
  shopStockNames = [...stock];
}
function setup(table) {
  if (table === 'main' && mainVisitState) {
    Object.assign(run, mainVisitState.state, { table: 'main' });
    targets = mainVisitState.targets;
    bumpers = mainVisitState.bumpers;
    mainVisitState = null;
    makeFlippers();
    trail = [];
    updateHUD();
    return;
  }
  run.table = table;
  run.cleared = false;
  run.lootTaken = false;
  run.sequence = 0;
  targets = [];
  bumpers = [];
  makeFlippers();
  if (table === 'main') {
    restock();
    for (let i = 0; i < 3; i++) {
      const { x, y } = CAVES[i];
      targets.push(target(x - 21, y + 66, 'guard', 1, run.tier === 1 ? 1 : 0, { gate: i }));
      targets.push(target(x + 21, y + 66, 'guard', 1, 0, { gate: i }));
    }
    bumpers = [
      { x: 252, y: 315, r: 29 },
      { x: 174, y: 434, r: 29 },
      { x: 282, y: 481, r: 29 },
    ];
  }
  if (table === 'inn') {
    run.cleared = true;
    targets = stock.map((item, i) =>
      target(154 + i * 100, 330, 'shop', item ? 1 : 0, 0, {
        item: item || shopStockNames[i],
        index: i,
      }),
    );
  }
  if (table === 'goblin') {
    targets = [target(166, 265, 'goblin'), target(244, 213, 'goblin'), target(356, 265, 'goblin')];
    bumpers = [
      { x: 185, y: 405, r: 30 },
      { x: 340, y: 440, r: 30 },
    ];
  }
  if (table === 'crypt') {
    targets = [0, 1, 2, 3].map((i) => target(160 + i * 68, 255, 'skeleton', 1, 0, { index: i }));
    bumpers = [
      { x: 192, y: 411, r: 29 },
      { x: 336, y: 411, r: 29 },
    ];
  }
  if (table === 'dragon') {
    run.dragonHP = 8;
    run.shieldRaised = false;
    targets = [target(244, 235, 'dragon', 8)];
    bumpers = [
      { x: 151, y: 401, r: 29 },
      { x: 367, y: 425, r: 29 },
    ];
  }
  trail = [];
  updateHUD();
}
// Only the shooter and upper orbit are scripted. The ball is released high
// on the left and falls under normal gravity through an empty corridor.
const LAUNCH_CURVES = [
  [
    [473, 774],
    [473, 540],
    [473, 290],
    [473, 130],
  ],
  [
    [473, 130],
    [473, 66],
    [427, 48],
    [365, 48],
  ],
  [
    [365, 48],
    [245, 48],
    [110, 48],
    [110, 145],
  ],
];
const launchTrack = [];
let launchLength = 0;
for (const curve of LAUNCH_CURVES)
  for (let i = launchTrack.length ? 1 : 0; i <= 60; i++) {
    const t = i / 60,
      u = 1 - t;
    const x =
      u * u * u * curve[0][0] +
      3 * u * u * t * curve[1][0] +
      3 * u * t * t * curve[2][0] +
      t * t * t * curve[3][0];
    const y =
      u * u * u * curve[0][1] +
      3 * u * u * t * curve[1][1] +
      3 * u * t * t * curve[2][1] +
      t * t * t * curve[3][1];
    const previous = launchTrack.at(-1);
    if (previous) launchLength += Math.hypot(x - previous.x, y - previous.y);
    launchTrack.push({ x, y, distance: launchLength });
  }
function launch() {
  if (paused || run.over || shop || travel || launchRide || !ball.ready) return;
  launchRide = { time: 0, duration: 1.3 };
  ball.ready = false;
  ball.vx = ball.vy = 0;
  trail = [];
  announce('UPPER ORBIT · CLEAR LEFT RETURN', 1.3);
  tone(480, 0.12);
}
function updateLaunch(dt) {
  launchRide.time = Math.min(launchRide.duration, launchRide.time + dt);
  const distance = smooth(launchRide.time / launchRide.duration) * launchLength;
  const index = launchTrack.findIndex((point) => point.distance >= distance);
  const b = launchTrack[index < 0 ? launchTrack.length - 1 : index],
    a = launchTrack[Math.max(0, index - 1)];
  const t = (distance - a.distance) / (b.distance - a.distance || 1);
  ball.x = a.x + (b.x - a.x) * t;
  ball.y = a.y + (b.y - a.y) * t;
  if (launchRide.time >= launchRide.duration) {
    launchRide = null;
    ball.vx = 0;
    ball.vy = 140;
    announce('LEFT RETURN · YOUR SHOT', 1.5);
  }
}
function boardSnapshot() {
  const image = document.createElement('canvas');
  image.width = W;
  image.height = H;
  const previous = ctx;
  ctx = image.getContext('2d');
  drawBoard();
  ctx = previous;
  return image;
}
function startTravel(destination, returning = false, mouth = { x: 244, y: 145 }) {
  if (travel) return;
  if (destination === 'inn' && run.table === 'main') {
    mainVisitState = {
      targets,
      bumpers,
      state: { cleared: run.cleared, lootTaken: run.lootTaken, sequence: run.sequence },
    };
  }
  const start = { x: ball.x, y: ball.y };
  const source = boardSnapshot();
  travel = {
    time: 0,
    duration: TRAVEL_DURATION,
    destination,
    origin: run.table,
    returning,
    start,
    mouth,
    source,
    switched: false,
  };
  ball.ready = false;
  ball.vx = ball.vy = 0;
  trail = [];
  announce(
    returning
      ? 'RETURN RAIL · ASCENDING TO THE KINGDOM'
      : 'CAVE CAPTURE · DESCENDING BELOW THE KINGDOM',
    TRAVEL_DURATION,
  );
  spark(mouth.x, mouth.y, '#e8c880', 22);
  tone(returning ? 340 : 180, 0.3);
}
function railPoint(t) {
  // Catmull–Rom curve: one continuous visible path, ending at an inlane.
  const mouth = travel.mouth;
  const points = travel.returning
    ? [
        mouth,
        { x: 105, y: 185 },
        { x: 66, y: 330 },
        { x: 66, y: 535 },
        { x: 104, y: 649 },
        { x: 163, y: 704 },
      ]
    : [
        mouth,
        { x: 418, y: mouth.y + 60 },
        { x: 454, y: Math.max(390, mouth.y + 130) },
        { x: 454, y: 535 },
        { x: 393, y: 649 },
        { x: 325, y: 704 },
      ];
  const n = points.length - 1,
    u = clamp(t, 0, 1) * n,
    i = Math.min(n - 1, Math.floor(u)),
    v = u - i;
  const p0 = points[Math.max(0, i - 1)],
    p1 = points[i],
    p2 = points[i + 1],
    p3 = points[Math.min(n, i + 2)];
  const axis = (k) =>
    0.5 *
    (2 * p1[k] +
      (-p0[k] + p2[k]) * v +
      (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * v * v +
      (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * v * v * v);
  return { x: axis('x'), y: axis('y') };
}
function updateTravel(dt) {
  travel.time = Math.min(travel.duration, travel.time + dt);
  const t = travel.time;
  if (t < 0.65) {
    const p = smooth(t / 0.65);
    ball.x = travel.start.x + (travel.mouth.x - travel.start.x) * p;
    ball.y = travel.start.y + (travel.mouth.y - travel.start.y) * p;
  } else {
    if (!travel.switched) {
      setup(travel.destination);
      travel.switched = true;
      travel.destinationImage = boardSnapshot();
    }
    const p = smooth((t - 0.65) / (travel.duration - 0.65));
    Object.assign(ball, railPoint(p));
  }
  if (t >= travel.duration) finishTravel();
}
function finishTravel() {
  const { returning, origin } = travel;
  const end = railPoint(1);
  travel = null;
  trail = [];
  ball = { ...end, vx: returning ? 65 : -65, vy: 180, ready: false };
  if (returning && run.tier === 2 && origin !== 'inn')
    announce('THE DRAGON RETURNS · LEFT ORBIT OPENS LAIR', 5);
  else announce(returning ? 'BACK IN THE KINGDOM' : 'RAIL RELEASE · FLIPPERS READY', 2);
}
function tryCaveCapture(mouth, destination, previousY) {
  // A shot must enter through the mouth, rather than skim its proximity circle.
  const lip = mouth.y + 20;
  if (ball.vy < -40 && previousY >= lip && ball.y <= lip && Math.abs(ball.x - mouth.x) < 19) {
    startTravel(destination, false, mouth);
    return true;
  }
  return false;
}
function complete() {
  if (run.cleared) return;
  run.cleared = true;
  run.score += 5000;
  const choices = ['sword', 'fire', 'purse', 'ward'].sort(() => Math.random() - 0.5).slice(0, 3);
  choices.forEach((item, i) => targets.push(target(166 + i * 100, 533, 'loot', 1, 0, { item })));
  announce('ENCOUNTER CLEARED · PICK ONE LOOT OR EXIT', 4);
  tone(660, 0.3);
}
function leave() {
  if (run.table === 'inn') {
    startTravel('main', true);
    return;
  }
  if (!run.cleared) return;
  if (run.table === 'dragon') {
    run.won = true;
    run.over = true;
    run.score += 25000 + run.lives * 5000;
    saveBest();
    announce('TOME RECLAIMED · THE KINGDOM IS SAVED', 10);
  } else {
    run.tier++;
    startTravel('main', true);
  }
}
function spark(x, y, color, count = 12) {
  for (let i = 0; i < count; i++)
    particles.push({ x, y, vx: rnd(-130, 130), vy: rnd(-180, 70), life: rnd(0.25, 0.65), color });
}
function onTarget(t) {
  if (t.cool > clock || t.hp <= 0) return;
  if (t.kind === 'shop') {
    t.cool = clock + 0.5;
    if (!stock[t.index]) return;
    if (run.gold < ITEMS[t.item].price) {
      announce(`${ITEMS[t.item].name} · NEED ${ITEMS[t.item].price} GOLD`, 2);
      tone(120);
      return;
    }
    shop = { item: t.item, index: t.index };
    ball.x = t.x;
    ball.y = t.y + 35;
    ball.vx = ball.vy = 0;
    announce('CHOOSE LEFT OR RIGHT FLIPPER', 2);
    return;
  }
  t.cool = clock + 0.24;
  const item = run.items[run.last];
  run.score += 100;
  tone(300 + t.x, 0.05);
  spark(t.x, t.y, t.kind === 'loot' ? '#f1ce76' : '#e59c7c', 7);
  if (t.kind === 'loot') {
    if (loot(run, t.item)) {
      targets.filter((x) => x.kind === 'loot').forEach((x) => (x.hp = 0));
      announce(`${ITEMS[t.item].name} · ${run.last === 0 ? 'LEFT' : 'RIGHT'} FLIPPER`, 3);
    }
    return;
  }
  if (t.kind === 'skeleton') {
    const success = cryptHit(run, t.index);
    targets
      .filter((x) => x.kind === 'skeleton')
      .forEach((x) => (x.hp = x.index < run.sequence ? 0 : 1));
    if (success) {
      breakReward(run);
      complete();
    } else if (run.sequence === 0) announce('WRONG ORDER · THE DEAD RISE AGAIN', 2);
    else {
      breakReward(run);
      announce(`SKELETON ${t.index + 1} DOWN`, 1);
    }
    return;
  }
  if (t.kind === 'dragon' && targets.some((x) => x.kind === 'scale' && x.hp > 0)) {
    announce('SCALES GUARD THE DRAGON', 1);
    return;
  }
  const dead = damage(t, item);
  if (t.kind === 'dragon') {
    run.dragonHP = t.hp;
    if (t.hp <= 4 && !run.shieldRaised && !dead) {
      run.shieldRaised = true;
      for (let i = 0; i < 4; i++) targets.push(target(164 + i * 64, 340, 'scale', 1, 1));
      announce('THE DRAGON RAISES ITS SCALES', 3);
    }
  }
  if (dead) {
    breakReward(run);
    spark(t.x, t.y, '#edc76c', 20);
    if (t.kind === 'guard') announce('GUARD DOWN · +GOLD', 1);
    if (
      run.table === 'goblin' &&
      targets.filter((x) => x.kind === 'goblin').every((x) => x.hp === 0)
    )
      complete();
    if (t.kind === 'dragon') complete();
  } else announce(t.armor ? 'ARMOR STRUCK' : 'PLATE BROKEN · HIT AGAIN', 1);
}
function flipper(side, down) {
  if (down && (paused || run.over)) return;
  keys[side] = down;
  if (down && shop) {
    if (buy(run, shop.item, side)) {
      stock[shop.index] = null;
      const choice = targets.find((t) => t.kind === 'shop' && t.index === shop.index);
      if (choice) choice.hp = 0;
      announce(`${ITEMS[shop.item].name} EQUIPPED`, 2);
    }
    shop = null;
    ball.vx = side ? -135 : 135;
    ball.vy = 100;
    ball.y += 28;
  }
}
function drainBall() {
  const result = drain(run);
  tone(100, 0.3);
  if (result === 'saved') {
    ball = {
      x: run.last === 0 ? 110 : 410,
      y: 620,
      vx: run.last === 0 ? 170 : -170,
      vy: 0,
      ready: false,
    };
    announce('GUARDIAN WARD · ONE DRAIN SAVED', 3);
  } else {
    saveBest();
    if (run.over) {
      ball.ready = false;
      ball.y = 880;
    } else ready();
    announce('DRAIN · GOLD AND ITEMS LOST', 3);
  }
  updateHUD();
}
function segment(ax, ay, bx, by, r = 5, kick = 0, fl = null) {
  const dx = bx - ax,
    dy = by - ay,
    len = dx * dx + dy * dy;
  const u = clamp(((ball.x - ax) * dx + (ball.y - ay) * dy) / len, 0, 1),
    px = ax + u * dx,
    py = ay + u * dy;
  let nx = ball.x - px,
    ny = ball.y - py,
    d = Math.hypot(nx, ny);
  if (d >= R + r) return;
  if (d < 0.001) {
    nx = 0;
    ny = -1;
    d = 1;
  }
  nx /= d;
  ny /= d;
  ball.x = px + nx * (R + r + 0.2);
  ball.y = py + ny * (R + r + 0.2);
  let svx = 0,
    svy = 0;
  if (fl) {
    svx = -fl.omega * (py - fl.y);
    svy = fl.omega * (px - fl.x);
  }
  const approach = (ball.vx - svx) * nx + (ball.vy - svy) * ny;
  if (approach < 0) {
    const impulse = -1.78 * approach + kick;
    ball.vx += impulse * nx;
    ball.vy += impulse * ny;
    if (fl) {
      run.last = fl.side;
      run.score += 10;
      tone(145, 0.03);
    }
  }
}
function physics(dt) {
  clock += dt;
  for (const p of particles) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 260 * dt;
  }
  particles = particles.filter((p) => p.life > 0);
  if (innRide) {
    innRide.time = Math.min(innRide.duration, innRide.time + dt);
    const p = smooth(innRide.time / innRide.duration);
    ball.x = innRide.start.x + (INN.x - innRide.start.x) * p;
    ball.y = innRide.start.y + (INN.y - innRide.start.y) * p;
    if (p >= 1) {
      innRide = null;
      startTravel('inn', false, INN);
    }
    return;
  }
  if (travel) {
    updateTravel(dt);
    return;
  }
  for (const f of flippers) {
    const resting = f.side === 0 ? 0.37 : Math.PI - 0.37,
      active = f.side === 0 ? -0.52 : Math.PI + 0.52;
    const desired = keys[f.side] ? active : resting;
    const delta = clamp(desired - f.angle, -dt * 14, dt * 14);
    f.omega = delta / dt;
    f.angle += delta;
  }
  if (launchRide) {
    updateLaunch(dt);
    return;
  }
  if (run.over || ball.ready || shop) return;
  ball.vy += 580 * dt;
  const damping = Math.exp(-0.08 * dt);
  ball.vx *= damping;
  ball.vy *= damping;
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed > 1400) {
    ball.vx *= 1400 / speed;
    ball.vy *= 1400 / speed;
  }
  const previousY = ball.y;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  // A dedicated shooter lane sits outside the symmetric main playfield.
  segment(35, 100, 35, 650);
  segment(490, 100, 490, 810);
  segment(35, 100, 100, 44);
  segment(100, 44, 425, 44);
  segment(425, 44, 490, 100);
  segment(445, 150, 445, 650, 4);
  segment(456, 150, 456, 810, 3);
  for (const guide of GUIDES) segment(...guide, 5);
  for (const vertices of SLINGS) {
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i],
        b = vertices[(i + 1) % vertices.length];
      segment(...a, ...b, 4, i === 0 ? 50 : 0);
    }
  }
  for (const f of flippers)
    segment(
      f.x,
      f.y,
      f.x + Math.cos(f.angle) * f.length,
      f.y + Math.sin(f.angle) * f.length,
      10,
      0,
      f,
    );
  for (const b of bumpers) {
    let dx = ball.x - b.x,
      dy = ball.y - b.y,
      d = Math.hypot(dx, dy);
    if (d < b.r + R) {
      dx /= d || 1;
      dy /= d || 1;
      ball.x = b.x + dx * (b.r + R + 0.1);
      ball.y = b.y + dy * (b.r + R + 0.1);
      const dot = ball.vx * dx + ball.vy * dy;
      if (dot < 0) {
        ball.vx -= 2 * dot * dx;
        ball.vy -= 2 * dot * dy;
        ball.vx += dx * 145;
        ball.vy += dy * 145;
        run.score += 25;
        b.flash = clock + 0.12;
        tone(410, 0.04);
        spark(b.x, b.y, '#a9c37d', 4);
      }
    }
  }
  for (const t of targets) {
    if (t.hp <= 0) continue;
    if (t.kind === 'dragon') t.x = 244 + Math.sin(clock * 0.85) * 65;
    const radius = t.kind === 'dragon' ? 37 : 19;
    const dx = ball.x - t.x,
      dy = ball.y - t.y,
      d = Math.hypot(dx, dy);
    if (d < R + radius) {
      const nx = dx / (d || 1),
        ny = dy / (d || 1);
      ball.x = t.x + nx * (R + radius + 1);
      ball.y = t.y + ny * (R + radius + 1);
      const dot = ball.vx * nx + ball.vy * ny;
      if (dot < 0) {
        ball.vx -= 1.8 * dot * nx;
        ball.vy -= 1.8 * dot * ny;
      }
      onTarget(t);
    }
  }
  if (run.table === 'main') {
    // Upward shots enter the bottom of the vertical rail; ordinary launch drops
    // remain outside it, on the right. The same wires draw and collide.
    if (
      ball.vy < -40 &&
      previousY >= INN.railBottom &&
      ball.y <= INN.railBottom &&
      Math.abs(ball.x - INN.x) < 10
    ) {
      innRide = { start: { x: ball.x, y: ball.y }, time: 0, duration: 1.5 };
      ball.vx = ball.vy = 0;
      trail = [];
      return;
    }
    for (const x of [INN.x - 17, INN.x + 17]) segment(x, INN.y + 19, x, INN.railBottom, 3);
    if (tryCaveCapture(INN, 'inn', previousY)) return;
    if (run.tier < 2) {
      for (let i = 0; i < 3; i++) {
        const mouth = CAVES[i];
        if (targets.some((t) => t.gate === i && t.hp > 0)) {
          segment(mouth.x - 24, mouth.y + 20, mouth.x + 24, mouth.y + 20, 4);
          continue;
        }
        if (tryCaveCapture(mouth, run.tier === 0 ? 'goblin' : 'crypt', previousY)) return;
      }
    } else {
      if (ball.x < 79 && ball.y < 170) run.lairOpen = true;
      if (run.lairOpen) {
        if (tryCaveCapture({ x: 244, y: 120 }, 'dragon', previousY)) return;
      } else segment(220, 140, 268, 140, 4);
    }
  } else if (
    run.cleared &&
    ball.vy < -40 &&
    previousY >= 165 &&
    ball.y <= 165 &&
    Math.abs(ball.x - 244) < 19
  ) {
    leave();
    return;
  }
  if (ball.y > FIELD.drainY) drainBall();
}
function line(x1, y1, x2, y2, color, width = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function circle(x, y, r, fill, stroke = null, width = 1) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}
function text(s, x, y, size = 11, color = '#dfd5b8', font = 'monospace') {
  ctx.fillStyle = color;
  ctx.font = `${size}px ${font}`;
  ctx.textAlign = 'center';
  ctx.fillText(s, x, y);
}
function rounded(x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
function tree(b) {
  circle(b.x, b.y + 7, b.r + 3, '#141d16');
  circle(b.x, b.y, b.r, '#665339', '#af9560', 3);
  for (let i = 0; i < 6; i++) {
    let a = (i * Math.PI) / 3;
    circle(
      b.x + Math.cos(a) * 15,
      b.y + Math.sin(a) * 13,
      16,
      b.flash > clock ? '#b6d58a' : '#3e694c',
      '#62825b',
    );
  }
  circle(b.x, b.y, 18, '#466f50');
  circle(b.x - 6, b.y - 6, 5, '#70946a');
}
function cave(x, y, label, open) {
  ctx.save();
  ctx.translate(x, y);
  // The arch surrounds a recessed mouth; its floor lip is also the capture line.
  ctx.shadowColor = '#0009';
  ctx.shadowBlur = 9;
  ctx.shadowOffsetY = 5;
  ctx.beginPath();
  ctx.arc(0, 0, 31, Math.PI, 0);
  ctx.lineTo(31, 23);
  ctx.lineTo(-31, 23);
  ctx.closePath();
  ctx.fillStyle = '#777662';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ad9d78';
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  const depth = ctx.createLinearGradient(0, -22, 0, 23);
  depth.addColorStop(0, '#020706');
  depth.addColorStop(1, open ? '#343224' : '#17211c');
  ctx.beginPath();
  ctx.arc(0, 0, 22, Math.PI, 0);
  ctx.lineTo(22, 20);
  ctx.lineTo(-22, 20);
  ctx.closePath();
  ctx.fillStyle = depth;
  ctx.fill();
  for (let i = 0; i < 7; i++) {
    const a = Math.PI + (i * Math.PI) / 6;
    line(Math.cos(a) * 24, Math.sin(a) * 24, Math.cos(a) * 31, Math.sin(a) * 31, '#4c5143', 2);
  }
  if (!open) {
    for (let i = -14; i <= 14; i += 9) line(i, -13, i, 20, '#71806a', 3);
    line(-21, 8, 21, 8, '#71806a', 2);
  } else {
    ctx.shadowColor = '#e5bb62';
    ctx.shadowBlur = 12;
    line(-22, 22, 22, 22, '#e5bc68', 2);
    ctx.shadowBlur = 0;
    for (let i = 0; i < 3; i++) {
      const y = 33 + i * 12;
      const alpha = 0.35 + 0.4 * (0.5 + 0.5 * Math.sin(clock * 3 - i));
      ctx.globalAlpha = alpha;
      line(-6, y + 4, 0, y - 1, '#e8c479', 2);
      line(0, y - 1, 6, y + 4, '#e8c479', 2);
    }
    ctx.globalAlpha = 1;
  }
  text(label, 0, -44, 9);
  ctx.restore();
}
function drawBumper(b) {
  if (run.table === 'main' || run.table === 'goblin') {
    tree(b);
    return;
  }
  const fire = run.table === 'dragon',
    lit = b.flash > clock;
  circle(b.x, b.y + 5, b.r + 3, '#101714');
  circle(b.x, b.y, b.r, fire ? '#4e372c' : '#596268', fire ? '#b47748' : '#9ba9ad', 3);
  circle(
    b.x,
    b.y,
    b.r - 7,
    lit ? '#e0c587' : fire ? '#26251e' : '#29353b',
    fire ? '#d69a54' : '#82969c',
    2,
  );
  text(fire ? '✶' : '✧', b.x, b.y + 9, 30, lit ? '#fff0c9' : fire ? '#d69a54' : '#b5c9c8');
}
function drawInnEntrance() {
  for (const x of [INN.x - 17, INN.x + 17]) {
    line(x, INN.y + 19, x, INN.railBottom, '#0d1713', 7);
    line(x, INN.y + 19, x, INN.railBottom, '#b8a276', 2);
  }
  for (let y = 190; y < 535; y += 75) {
    line(INN.x - 5, y + 5, INN.x, y, '#b9a06d', 1);
    line(INN.x, y, INN.x + 5, y + 5, '#b9a06d', 1);
  }
  rounded(INN.x - 27, 82, 54, 47, 3, '#5b5139', '#c1a676');
  ctx.beginPath();
  ctx.moveTo(INN.x - 33, 83);
  ctx.lineTo(INN.x, 57);
  ctx.lineTo(INN.x + 33, 83);
  ctx.closePath();
  ctx.fillStyle = '#947344';
  ctx.fill();
  rounded(INN.x - 10, 101, 20, 28, 8, '#111a13', '#d6b474');
  circle(INN.x + 18, 100, 3, '#f4d38b');
  text('INN', INN.x, 49, 10, '#f1d49a');
  text('INN ↑', INN.x, 580, 9, '#d6bd87');
}
function drawShopChoice(t) {
  const item = ITEMS[t.item],
    sold = !stock[t.index],
    afford = !sold && run.gold >= item.price;
  rounded(
    t.x - 43,
    t.y - 54,
    86,
    120,
    6,
    sold ? '#29271e' : '#342c20',
    afford ? '#e6c47d' : '#84714f',
  );
  text(sold ? 'SOLD' : item.name.split(' ')[0], t.x, t.y - 29, 10, sold ? '#847d67' : item.color);
  text(sold ? '—' : item.symbol, t.x, t.y + 7, 30, sold ? '#847d67' : item.color);
  text(sold ? '' : item.name.split(' ').slice(1).join(' '), t.x, t.y + 28, 9, item.color);
  text(sold ? '' : `${item.price} GOLD`, t.x, t.y + 51, 10, afford ? '#f2d497' : '#a99876');
}
function drawBoard() {
  ctx.clearRect(0, 0, W, H);
  const dungeon = run.table !== 'main',
    dragon = run.table === 'dragon',
    inn = run.table === 'inn';
  const gradient = ctx.createLinearGradient(0, 0, 0, H);
  gradient.addColorStop(
    0,
    inn
      ? '#675438'
      : dragon
        ? '#603b30'
        : run.table === 'crypt'
          ? '#3d4350'
          : dungeon
            ? '#4b5336'
            : '#344938',
  );
  gradient.addColorStop(
    1,
    inn ? '#30281d' : dragon ? '#2d211d' : run.table === 'crypt' ? '#202b32' : '#17281f',
  );
  rounded(8, 8, 504, 824, 40, '#151d17', '#88764c');
  rounded(26, 27, 468, 800, 35, gradient, '#8a805c');
  // Engraved floor and subtle map contours.
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(34, 37, 452, 775, 28);
  ctx.clip();
  ctx.globalAlpha = 0.19;
  for (let y = 50; y < 820; y += 42) {
    line(35, y, 485, y, '#b6af7c', 1);
    for (let x = 35 + (Math.floor(y / 42) % 2) * 35; x < 485; x += 70)
      line(x, y, x, y + 42, '#b6af7c', 1);
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    ctx.ellipse(244, 360, 110 + i * 21, 170 + i * 27, -0.25, 0, Math.PI * 2);
    ctx.strokeStyle = '#97a77a0b';
    ctx.stroke();
  }
  ctx.restore();
  // Cabinet wire rails.
  for (const x of [35, 445]) {
    line(x, 155, x, 600, '#161c17', 9);
    line(x, 155, x, 600, '#b89c68', 3);
    line(x + 3, 155, x + 3, 600, '#e2cda0', 1);
  }
  line(456, 150, 456, 810, '#a3ab9e', 3);
  line(490, 100, 490, 810, '#7f826b', 3);
  rounded(462, 794, 22, 14, 3, '#8d734d', '#cfbc84');
  text('↑', 473, 740, 16, '#b7a16e');
  text(
    inn
      ? 'THE LANTERN INN'
      : dragon
        ? 'THE HOARD'
        : run.table === 'crypt'
          ? 'HALL OF THE RESTLESS'
          : run.table === 'goblin'
            ? 'BENEATH THE ROOTS'
            : 'THE RUINED KINGDOM',
    244,
    76,
    12,
    '#d3be86',
  );
  if (run.table === 'main') {
    if (run.tier < 2) {
      for (let i = 0; i < 3; i++) {
        const { x, y, label } = CAVES[i];
        cave(x, y, label, !targets.some((t) => t.gate === i && t.hp > 0));
      }
    } else {
      cave(244, 120, 'THE DRAGON’S LAIR', run.lairOpen);
      text('← LEFT ORBIT TO OPEN THE LAIR', 244, 178, 9, '#db9f66');
    }
    text('OPEN A CAVE · GO BELOW', 244, 590, 9, '#c0aa76');
    drawInnEntrance();
  } else {
    cave(244, 145, run.table === 'inn' ? 'BACK TO THE KINGDOM' : 'RETURN RAIL', run.cleared);
  }
  for (const b of bumpers) drawBumper(b);
  for (const t of targets) {
    if (t.kind === 'shop') {
      drawShopChoice(t);
      continue;
    }
    if (t.hp <= 0) {
      if (t.kind === 'loot' || t.kind === 'skeleton' || t.kind === 'guard' || t.kind === 'goblin') {
        rounded(t.x - 14, t.y - 6, 28, 8, 1, '#1b221b', '#70644b');
      }
      continue;
    }
    if (t.kind === 'dragon') {
      ctx.save();
      ctx.translate(t.x, t.y);
      circle(0, 17, 46, '#9e7b32', '#ddbb5b', 2);
      ctx.fillStyle = '#7f3930';
      ctx.beginPath();
      ctx.moveTo(-17, 2);
      ctx.lineTo(-65, -29);
      ctx.lineTo(-48, 16);
      ctx.lineTo(-16, 26);
      ctx.moveTo(17, 2);
      ctx.lineTo(65, -29);
      ctx.lineTo(48, 16);
      ctx.lineTo(16, 26);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, 0, 24, 35, 0, 0, 7);
      ctx.fillStyle = '#b36142';
      ctx.fill();
      circle(0, -29, 20, '#a55035', '#d29462', 2);
      circle(-8, -31, 3, '#f5d86d');
      circle(8, -31, 3, '#f5d86d');
      text('◆', 0, 8, 18, '#e8bc7f');
      for (let i = 0; i < 8; i++) circle(-35 + i * 10, 57, 3, i < t.hp ? '#f2bf59' : '#453a29');
      ctx.restore();
      continue;
    }
    const isLoot = t.kind === 'loot',
      color = isLoot ? ITEMS[t.item].color : t.armor ? '#a2a8a0' : '#ae5142';
    rounded(t.x - 17, t.y - 20, 34, 34, 4, '#151e18', '#cfba82');
    rounded(t.x - 13, t.y - 17, 26, 27, 2, color, '#e1c28a');
    text(
      isLoot
        ? ITEMS[t.item].symbol
        : t.kind === 'skeleton'
          ? String(t.index + 1)
          : t.kind === 'goblin'
            ? '♟'
            : t.kind === 'scale'
              ? '◇'
              : '†',
      t.x,
      t.y + 3,
      18,
      '#251f19',
    );
    for (let j = 0; j < t.hp + t.armor; j++)
      circle(
        t.x + (j - (t.hp + t.armor - 1) / 2) * 9,
        t.y + 25,
        3,
        j < t.armor ? '#c8d2d3' : '#eb8864',
      );
    if (isLoot) text(ITEMS[t.item].name, t.x, t.y + 40, 8, ITEMS[t.item].color);
  }
  if (run.table === 'inn') {
    text('THREE CHOICES · GOLD FOR GEAR', 254, 237, 11, '#edc884');
    text('SHOOT AN ITEM · PRESS A FLIPPER TO EQUIP', 254, 454, 9, '#d7bc85');
    text('OR SHOOT THE OPEN EXIT TO LEAVE', 254, 480, 9, '#b7a889');
  }
  if (run.cleared && run.table !== 'inn') {
    text(run.table === 'dragon' ? 'RECLAIM THE TOME ↑' : 'EXIT ↑', 244, 160, 10, '#f3d27b');
    text('CHOOSE ONE · OR LEAVE IT BEHIND', 244, 594, 9, '#c8b374');
  }
  // Shot arrow lamps.
  for (const [x, y, a] of inn
    ? [[244, 570, 0]]
    : [
        [176, 337, -0.25],
        [342, 237, 0.25],
        [370, 451, 0.25],
        [244, 615, 0],
      ]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(-7, 6);
    ctx.lineTo(7, 6);
    ctx.closePath();
    ctx.fillStyle = run.cleared ? '#d8bd68' : '#977d41';
    ctx.fill();
    ctx.restore();
  }
  // The dark center trough is an actual opening below the flippers.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(188, 781);
  ctx.lineTo(209, 837);
  ctx.lineTo(279, 837);
  ctx.lineTo(300, 781);
  ctx.closePath();
  ctx.fillStyle = '#070c0b';
  ctx.fill();
  ctx.strokeStyle = '#756448';
  ctx.lineWidth = 2;
  ctx.stroke();
  for (let i = 0; i < 3; i++) {
    const y = 791 + i * 12;
    line(230, y, 244, y + 6, '#b77d4a', 2);
    line(244, y + 6, 258, y, '#b77d4a', 2);
  }
  text('DRAIN', 244, 830, 8, '#c39a6b');
  ctx.restore();
  for (const [ax, ay, bx, by] of GUIDES) {
    line(ax, ay, bx, by, '#131d18', 9);
    line(ax, ay, bx, by, '#a9a891', 4);
    line(ax + 1, ay, bx + 1, by, '#e7dfbf', 1);
  }
  for (const vertices of SLINGS) {
    ctx.beginPath();
    vertices.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = '#cbc7ae';
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#555a49';
    ctx.stroke();
    const cx = vertices.reduce((v, p) => v + p[0], 0) / 3,
      cy = vertices.reduce((v, p) => v + p[1], 0) / 3;
    ctx.beginPath();
    vertices.forEach(([x, y], i) => {
      x = cx + (x - cx) * 0.62;
      y = cy + (y - cy) * 0.62;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = '#914c3c';
    ctx.fill();
  }
  text('✦', 244, 663, 36, '#c6aa66');
  text('THE WIZARD’S AMULET', 244, 690, 8, '#8f9a7d');
  for (const f of flippers) {
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.angle);
    ctx.shadowColor = '#0009';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 5;
    rounded(-12, -11, f.length + 22, 22, 11, '#d3cbb1', '#6e715c');
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    rounded(0, -7, f.length, 14, 7, ITEMS[run.items[f.side]]?.color || '#b05745');
    circle(0, 0, 6, '#6e7260', '#ddd8c1');
    ctx.restore();
    if (run.items[f.side])
      text(ITEMS[run.items[f.side]].symbol, f.x, f.y - 24, 17, ITEMS[run.items[f.side]].color);
  }
  for (let i = 0; i < 3; i++)
    circle(90 + i * 20, 816, 4, i < run.lives ? '#e8c97c' : '#3a4230', '#85754e');
}
function drawTravel() {
  const t = travel.time;
  ctx.drawImage(travel.source, 0, 0);
  if (travel.destinationImage) {
    // Rows of individual stone tiles sink away, revealing the next biome.
    // The cabinet remains stationary; only the playfield terraforms.
    const tile = 52,
      rows = Math.ceil(775 / tile),
      cols = 9;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(29, 30, 462, 796, 29);
    ctx.clip();
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++) {
        const x = 29 + col * tile,
          y = 30 + row * tile;
        const delay = 0.65 + row * 0.075 + Math.abs(col - 4) * 0.035;
        const p = smooth((t - delay) / 0.65);
        if (p <= 0) continue;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, tile + 1, tile + 1);
        ctx.clip();
        ctx.drawImage(travel.destinationImage, 0, 0);
        if (p < 1) {
          ctx.globalAlpha = 1 - p;
          const shrink = 1 - p * 0.4;
          ctx.translate(x + tile / 2, y + tile / 2 + p * 24);
          ctx.scale(shrink, shrink);
          ctx.drawImage(travel.source, x, y, tile, tile, -tile / 2, -tile / 2, tile, tile);
          ctx.globalAlpha = (1 - p) * 0.35;
          ctx.fillStyle = '#e3bd74';
          ctx.fillRect(-tile / 2, -tile / 2, tile, 2);
        }
        ctx.restore();
      }
    ctx.restore();
  }
  const railFade = smooth((t - 0.4) / 0.4) * (1 - smooth((t - 3.25) / 0.55));
  if (railFade > 0) {
    ctx.save();
    ctx.globalAlpha = railFade;
    // A shadow, cross ties, and twin wires give the rail depth and direction.
    const color = travel.returning ? '#b88555' : '#c6d5d6';
    for (let i = 0; i < 50; i++) {
      const p = i / 49,
        a = railPoint(p),
        b = railPoint(Math.min(1, p + 0.005));
      const dx = b.x - a.x,
        dy = b.y - a.y,
        len = Math.hypot(dx, dy) || 1,
        nx = -dy / len,
        ny = dx / len;
      line(a.x - nx * 13, a.y - ny * 13, a.x + nx * 13, a.y + ny * 13, '#59635b', 3);
    }
    for (const offset of [-9, 9]) {
      ctx.beginPath();
      for (let i = 0; i <= 100; i++) {
        const p = i / 100,
          a = railPoint(p),
          b = railPoint(Math.min(1, p + 0.002));
        const dx = b.x - a.x,
          dy = b.y - a.y,
          len = Math.hypot(dx, dy) || 1;
        const x = a.x - (dy / len) * offset,
          y = a.y + (dx / len) * offset;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.strokeStyle = '#08100ecc';
      ctx.lineWidth = 9;
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 7;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.restore();
  }
  if (t < 0.9) {
    const p = t / 0.9;
    ctx.save();
    ctx.globalAlpha = 1 - p;
    circle(travel.mouth.x, travel.mouth.y, 24 + p * 30, '#d6b26412', '#e8c880', 2);
    ctx.restore();
  }
}
function draw() {
  if (travel) drawTravel();
  else drawBoard();
  if (!ball.ready && !run.over && !paused) {
    trail.push({ x: ball.x, y: ball.y });
    if (trail.length > 9) trail.shift();
  } else if (ball.ready) trail = [];
  for (let i = 0; i < trail.length; i++)
    circle(
      trail[i].x,
      trail[i].y,
      R * (i / trail.length),
      `rgba(215,230,222,${(i / trail.length) * 0.12})`,
    );
  if (!run.over) {
    const bx = ball.x,
      by = ball.y;
    const capture = travel
      ? travel.time < 0.65
        ? 1 - 0.45 * smooth(travel.time / 0.65)
        : 0.55 + 0.45 * smooth((travel.time - 0.65) / 0.25)
      : 1;
    ctx.save();
    ctx.translate(bx, by);
    ctx.scale(capture, capture);
    ctx.shadowColor = travel ? '#c6e3e0' : 'transparent';
    ctx.shadowBlur = travel ? 14 : 0;
    circle(3, 4, R + 2, '#0006');
    const metal = ctx.createRadialGradient(-3, -4, 1, 0, 0, 9);
    metal.addColorStop(0, '#fff');
    metal.addColorStop(0.35, '#e8ede6');
    metal.addColorStop(0.7, '#81918a');
    metal.addColorStop(1, '#394c45');
    circle(0, 0, R, metal, ITEMS[run.items[run.last]]?.color || '#e2e6d6', 1.5);
    ctx.restore();
  }
  for (const p of particles) {
    ctx.globalAlpha = Math.min(1, p.life * 3);
    circle(p.x, p.y, 2, p.color);
  }
  ctx.globalAlpha = 1;
  if (paused || run.over) {
    rounded(65, 355, 390, 115, 8, '#142018f5', '#c1ab74');
    text(
      paused ? 'THE KINGDOM CAN WAIT' : run.won ? 'THE TOME IS YOURS' : 'THE LAST LIGHT GOES OUT',
      260,
      397,
      20,
      '#e6ce91',
      'Georgia',
    );
    text(
      paused ? 'PRESS P TO RESUME' : `SCORE ${run.score.toLocaleString()} · START A NEW RUN`,
      260,
      435,
      11,
    );
  }
}
function frame(now) {
  if (!last) last = now;
  acc += Math.min((now - last) / 1000, 0.06);
  last = now;
  while (acc >= STEP) {
    if (!paused) physics(STEP);
    acc -= STEP;
  }
  draw();
  updateHUD();
  requestAnimationFrame(frame);
}
document.addEventListener('keydown', (e) => {
  if (['ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (['KeyA', 'ArrowLeft'].includes(e.code)) flipper(0, true);
  if (['KeyD', 'ArrowRight'].includes(e.code)) flipper(1, true);
  if (e.code === 'Space') launch();
  if (e.code === 'KeyP') togglePause();
  if (e.code === 'KeyM') {
    sound = !sound;
    announce(sound ? 'SOUND ON' : 'SOUND OFF', 1);
    tone();
  }
});
document.addEventListener('keyup', (e) => {
  if (['KeyA', 'ArrowLeft'].includes(e.code)) flipper(0, false);
  if (['KeyD', 'ArrowRight'].includes(e.code)) flipper(1, false);
});
window.addEventListener('blur', () => {
  keys.fill(false);
  if (!run.over) paused = true;
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    keys.fill(false);
    paused = true;
  }
});
function togglePause() {
  paused = !paused;
  keys.fill(false);
  updateHUD();
}
for (const [id, side] of [
  ['left', 0],
  ['right', 1],
]) {
  $(id).addEventListener('pointerdown', (e) => {
    e.preventDefault();
    $(id).setPointerCapture(e.pointerId);
    flipper(side, true);
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
    $(id).addEventListener(event, () => flipper(side, false));
}
$('launch').onclick = launch;
$('restart').onclick = reset;
$('pause').onclick = togglePause;
reset();
requestAnimationFrame(frame);
