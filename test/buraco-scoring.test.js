import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDealScore, applyDealEnd } from '../plugins/buraco/server/phases/deal-end.js';

const C = (rank, suit, deckIndex = 0) => ({ id: `${suit}-${rank}-${deckIndex}`, rank, suit, deckIndex });
const J = (i, color) => ({ id: `jk-${i}`, kind: 'joker', index: i, color });
const W = (card, r, s) => ({ ...card, representsRank: r, representsSuit: s });

test('computeDealScore: meld points + buraco limpo bonus + going-out bonus, no penalties', () => {
  const buraco = [C('5','S'), C('6','S'), C('7','S'), C('8','S'), C('9','S'), C('T','S'), C('J','S')];
  // points: 5+5+5+10+10+10+10 = 55 (3-7 = 5pt, 8-K = 10pt)
  const score = computeDealScore({
    melds: [buraco],
    handCardsLeft: 0,
    mortoTaken: true,
    wentOut: true,
  });
  assert.equal(score.meldPoints, 55);
  assert.equal(score.buracoLimpo, 1);
  assert.equal(score.buracoSujo, 0);
  assert.equal(score.goingOutBonus, 100);
  assert.equal(score.mortoBonus, 0);
  assert.equal(score.handPenalty, 0);
  assert.equal(score.total, 55 + 200 + 100);
});

test('computeDealScore: buraco sujo bonus is +100', () => {
  const buracoSujo = [C('5','S'), W(J(0,'red'),'6','S'), C('7','S'), C('8','S'), C('9','S'), C('T','S'), C('J','S')];
  const score = computeDealScore({
    melds: [buracoSujo],
    handCardsLeft: 0,
    mortoTaken: true,
    wentOut: true,
  });
  assert.equal(score.buracoSujo, 1);
  assert.equal(score.buracoLimpo, 0);
  // points: 5(5) + 20(joker) + 5(7) + 10(8) + 10(9) + 10(T) + 10(J) = 70
  assert.equal(score.total, 70 + 100 + 100);
});

test('computeDealScore: morto-untaken penalty is -100', () => {
  const meld = [C('5','S'), C('6','S'), C('7','S')];
  const score = computeDealScore({
    melds: [meld],
    handCardsLeft: 11,
    mortoTaken: false,
    wentOut: false,
  });
  assert.equal(score.mortoBonus, -100);
  assert.equal(score.handPenalty, -11);
});

test('computeDealScore: hand-card penalty is -1 per card', () => {
  const score = computeDealScore({ melds: [], handCardsLeft: 5, mortoTaken: true, wentOut: false });
  assert.equal(score.handPenalty, -5);
});

test('applyDealEnd: scores both sides and starts a new deal', () => {
  const buraco = [C('5','S'), C('6','S'), C('7','S'), C('8','S'), C('9','S'), C('T','S'), C('J','S')];
  const s0 = {
    phase: 'deal-end',
    dealNumber: 1,
    currentTurn: 'a',
    hasDrawn: false,
    stock: [], discard: [],
    hands: { a: [], b: [C('K','D'), C('Q','D')] },
    melds: { a: [buraco], b: [] },
    mortos: { a: [], b: [] },
    mortoTaken: { a: true, b: true },
    scores: { a: { total: 0, deals: [] }, b: { total: 0, deals: [] } },
    lastEvent: null, winner: null,
  };
  function det() { let s = 1; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
  const r = applyDealEnd(s0, det());
  // Side a: 55 meld + 200 limpo + 100 going-out = 355
  // Side b: 0 melds + 0 bonuses + (-2 hand) = -2
  assert.equal(r.state.scores.a.total, 355);
  assert.equal(r.state.scores.b.total, -2);
  assert.equal(r.state.scores.a.deals.length, 1);
  assert.equal(r.state.scores.b.deals.length, 1);
  assert.equal(r.state.phase, 'draw');
  assert.equal(r.state.dealNumber, 2);
  assert.equal(r.state.hands.a.length, 11);
  assert.equal(r.state.hands.b.length, 11);
});

test('applyDealEnd: total >= 3000 → game-end with winner', () => {
  const s0 = {
    phase: 'deal-end',
    dealNumber: 5,
    currentTurn: 'a', hasDrawn: false,
    stock: [], discard: [],
    hands: { a: [], b: [] },
    melds: { a: [], b: [] },
    mortos: { a: [], b: [] },
    mortoTaken: { a: true, b: true },
    scores: { a: { total: 2900, deals: [] }, b: { total: 2000, deals: [] } },
    lastEvent: null, winner: null,
  };
  const buraco = [C('5','S'), C('6','S'), C('7','S'), C('8','S'), C('9','S'), C('T','S'), C('J','S')];
  s0.melds.a = [buraco];
  function det() { let s = 1; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
  const r = applyDealEnd(s0, det());
  assert.equal(r.state.phase, 'game-end');
  assert.equal(r.state.winner, 'a');
});
