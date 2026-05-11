import { pipValue } from '../values.js';

const RANK_LABEL = { A:'Ace','2':'Two','3':'Three','4':'Four','5':'Five','6':'Six','7':'Seven','8':'Eight','9':'Nine',T:'Ten',J:'Jack',Q:'Queen',K:'King' };
const SUIT_LABEL = { H:'Hearts', D:'Diamonds', C:'Clubs', S:'Spades' };

function cardId(c) { return `${c.rank}${c.suit}`; }
function cardSummary(c) { return `${RANK_LABEL[c.rank]} of ${SUIT_LABEL[c.suit]}`; }

export function enumerateLegalMoves(state, botPlayerIdx) {
  switch (state.phase) {
    case 'discard': {
      const hand = state.hands[botPlayerIdx];
      const out = [];
      for (let i = 0; i < hand.length; i++) {
        for (let j = i + 1; j < hand.length; j++) {
          out.push({
            id: `discard:${i},${j}`,
            action: { type: 'discard', payload: { cards: [hand[i], hand[j]] } },
            summary: `Discard ${cardSummary(hand[i])} and ${cardSummary(hand[j])} to crib`,
          });
        }
      }
      return out;
    }
    case 'cut':
      return [{ id: 'cut', action: { type: 'cut' }, summary: 'Cut the deck' }];
    case 'pegging': {
      const hand = state.hands[botPlayerIdx];
      const running = state.pegging?.running ?? 0;
      const out = [];
      for (const c of hand) {
        if (running + pipValue(c) <= 31) {
          out.push({
            id: `play:${cardId(c)}`,
            action: { type: 'play', payload: { card: c } },
            summary: `Play ${cardSummary(c)} (running ${running} → ${running + pipValue(c)})`,
          });
        }
      }
      return out;
    }
    case 'show':
      return [{ id: 'next', action: { type: 'next' }, summary: 'Acknowledge the count and continue' }];
    case 'match-end':
    default:
      return [];
  }
}
