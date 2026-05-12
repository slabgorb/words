import { BOARD_SIZE, getRules } from '../board.js';

const COL_LETTERS = 'ABCDEFGHIJKLMNO';
const PREMIUM_GLYPH = { TW: '★', DW: '◆', TL: '▲', DL: '△' };

function renderBoard(state, botSide) {
  const rules = getRules(state.variant);
  const lines = [];
  // Column header.
  lines.push('     ' + COL_LETTERS.split('').join('  '));
  for (let r = 0; r < BOARD_SIZE; r++) {
    const rowLabel = String(r + 1).padStart(2, ' ');
    const cells = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      const tile = state.board[r][c];
      if (tile) {
        const isMine = tile.byPlayer === botSide;
        const letter = tile.blank ? tile.letter.toLowerCase() : tile.letter;
        cells.push((isMine ? 'O' : 'X') + letter);
      } else {
        const prem = rules.premiums[r][c];
        cells.push(prem ? ` ${PREMIUM_GLYPH[prem]}` : ' ·');
      }
    }
    lines.push(`${rowLabel}  ${cells.join(' ')}`);
  }
  return lines.join('\n');
}

function header(state, botSide) {
  const opp = botSide === 'a' ? 'b' : 'a';
  return [
    `You are playing side ${botSide.toUpperCase()}. Score: you ${state.scores[botSide]}, opponent ${state.scores[opp]}. Bag remaining: ${state.bag.length} tiles.`,
    `Consecutive scoreless turns: ${state.consecutiveScorelessTurns ?? 0}.`,
  ].join('\n');
}

function rackLine(state, botSide) {
  return `Your rack: ${state.racks[botSide].join(' ')}   (${state.racks[botSide].length} tiles)`;
}

function shortlistBlock(shortlist) {
  const lines = shortlist.map(e => `  ${e.id}: ${e.summary}`);
  return ['Legal candidates:', lines.join('\n')].join('\n');
}

const RESPONSE_FOOTER = 'Respond with a single JSON object (and nothing else): {"moveId": "<one of the candidate ids above>", "banter": "<short in-character line, may be empty>"}';

export function buildTurnPrompt({ state, shortlist, botSide }) {
  return [
    header(state, botSide),
    renderBoard(state, botSide),
    rackLine(state, botSide),
    shortlistBlock(shortlist),
    RESPONSE_FOOTER,
  ].join('\n\n');
}

function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  throw new Error('no JSON object found in response');
}

export function parseLlmResponse(text) {
  const json = extractJson(text);
  let parsed;
  try { parsed = JSON.parse(json); }
  catch (e) { throw new Error(`response is not valid JSON: ${e.message}`); }
  if (typeof parsed.moveId !== 'string') throw new Error('response missing moveId');
  return {
    moveId: parsed.moveId,
    banter: typeof parsed.banter === 'string' ? parsed.banter : '',
  };
}
