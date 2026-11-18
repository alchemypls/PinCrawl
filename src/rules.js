export const ITEMS = {
  sword: { name: 'IRON SWORD', symbol: '†', color: '#bed4df', price: 3 },
  fire: { name: 'FIRE STAFF', symbol: '✶', color: '#ee9256', price: 6 },
  purse: { name: 'COIN PURSE', symbol: '$', color: '#edc860', price: 3 },
  ward: { name: 'GUARDIAN WARD', symbol: '◇', color: '#9ad1c6', price: 10 },
};
export function newRun() {
  return {
    lives: 3,
    gold: 0,
    score: 0,
    items: [null, null],
    last: 0,
    tier: 0,
    table: 'main',
    cleared: false,
    lootTaken: false,
    sequence: 0,
    dragonHP: 8,
    shieldRaised: false,
    won: false,
    over: false,
  };
}
export function damage(target, item) {
  let amount = item === 'sword' ? 2 : 1;
  if (target.armor > 0) {
    if (item === 'fire') amount *= 2;
    const used = Math.min(target.armor, amount);
    target.armor -= used;
    amount -= used;
  }
  target.hp = Math.max(0, target.hp - amount);
  return target.hp === 0;
}
export function breakReward(run) {
  run.gold += run.items[run.last] === 'purse' ? 2 : 1;
  run.score += 1000;
}
export function drain(run) {
  if (run.items[run.last] === 'ward') {
    run.items[run.last] = null;
    return 'saved';
  }
  run.lives--;
  run.gold = 0;
  run.items = [null, null];
  if (run.lives <= 0) run.over = true;
  return run.over ? 'over' : 'lost';
}
export function buy(run, item, side) {
  if (!ITEMS[item] || run.gold < ITEMS[item].price) return false;
  run.gold -= ITEMS[item].price;
  run.items[side] = item;
  return true;
}
export function loot(run, item) {
  if (!run.cleared || run.lootTaken || !ITEMS[item]) return false;
  run.items[run.last] = item;
  run.lootTaken = true;
  return true;
}
export function cryptHit(run, index) {
  if (index !== run.sequence) {
    run.sequence = 0;
    return false;
  }
  run.sequence++;
  return run.sequence === 4;
}
