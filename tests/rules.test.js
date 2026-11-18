import test from 'node:test';
import assert from 'node:assert/strict';
import { newRun, damage, breakReward, drain, buy, loot, cryptHit } from '../src/rules.js';
test('draining loses resources but preserves dungeon progression', () => {
  const r = newRun();
  r.tier = 1;
  r.sequence = 2;
  r.gold = 8;
  r.items = ['sword', 'fire'];
  assert.equal(drain(r), 'lost');
  assert.equal(r.lives, 2);
  assert.equal(r.gold, 0);
  assert.deepEqual(r.items, [null, null]);
  assert.equal(r.tier, 1);
  assert.equal(r.sequence, 2);
});
test('only a ward on the active flipper saves a drain, and is consumed', () => {
  const r = newRun();
  r.items = ['ward', 'sword'];
  r.last = 1;
  assert.equal(drain(r), 'lost');
  r.items = ['ward', 'sword'];
  r.last = 0;
  r.gold = 5;
  assert.equal(drain(r), 'saved');
  assert.equal(r.lives, 2);
  assert.equal(r.gold, 5);
  assert.deepEqual(r.items, [null, 'sword']);
});
test('three ordinary drains end the run', () => {
  const r = newRun();
  drain(r);
  drain(r);
  assert.equal(drain(r), 'over');
  assert.equal(r.lives, 0);
  assert.equal(r.over, true);
});
test('damage crosses armor into health, with no double stacking', () => {
  const mob = { armor: 2, hp: 1 };
  assert.equal(damage(mob, 'sword'), false);
  assert.deepEqual(mob, { armor: 0, hp: 1 });
  assert.equal(damage(mob, 'sword'), true);
});
test('fire doubles armor damage but not bare health damage', () => {
  const mob = { armor: 2, hp: 3 };
  damage(mob, 'fire');
  assert.deepEqual(mob, { armor: 0, hp: 3 });
  damage(mob, 'fire');
  assert.equal(mob.hp, 2);
});
test('purse reward follows the last flipper only', () => {
  const r = newRun();
  r.items = ['purse', 'sword'];
  breakReward(r);
  assert.equal(r.gold, 2);
  r.last = 1;
  breakReward(r);
  assert.equal(r.gold, 3);
});
test('shop refuses unaffordable purchase and equips chosen side', () => {
  const r = newRun();
  r.gold = 5;
  assert.equal(buy(r, 'fire', 1), false);
  assert.equal(r.gold, 5);
  assert.equal(buy(r, 'sword', 1), true);
  assert.equal(r.gold, 2);
  assert.deepEqual(r.items, [null, 'sword']);
});
test('loot requires a cleared encounter and grants at most one choice', () => {
  const r = newRun();
  assert.equal(loot(r, 'sword'), false);
  r.cleared = true;
  r.last = 1;
  assert.equal(loot(r, 'fire'), true);
  assert.equal(loot(r, 'ward'), false);
  assert.deepEqual(r.items, [null, 'fire']);
});
test('crypt wrong hits reset the sequence, correct four complete it', () => {
  const r = newRun();
  cryptHit(r, 0);
  cryptHit(r, 1);
  assert.equal(r.sequence, 2);
  cryptHit(r, 3);
  assert.equal(r.sequence, 0);
  for (let i = 0; i < 3; i++) assert.equal(cryptHit(r, i), false);
  assert.equal(cryptHit(r, 3), true);
});
