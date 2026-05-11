const RANK_LABEL = { A:'Ace','2':'Two','3':'Three','4':'Four','5':'Five','6':'Six','7':'Seven','8':'Eight','9':'Nine',T:'Ten',J:'Jack',Q:'Queen',K:'King' };
const SUIT_LABEL = { H:'Hearts', D:'Diamonds', C:'Clubs', S:'Spades' };

function fmtCard(c) { return `${RANK_LABEL[c.rank]} of ${SUIT_LABEL[c.suit]}`; }

function commonHeader(state, botPlayerIdx) {
  const opp = 1 - botPlayerIdx;
  return [
    `Phase: ${state.phase}`,
    `Your score: ${state.scores[botPlayerIdx]} of ${state.matchTarget ?? 121}`,
    `Opponent score: ${state.scores[opp]} of ${state.matchTarget ?? 121}`,
  ].join('\n');
}

function legalMovesBlock(legalMoves) {
  const lines = legalMoves.map(m => `  - ${m.id}: ${m.summary}`);
  return `Legal moves:\n${lines.join('\n')}`;
}

const RESPONSE_FOOTER = 'Respond with a single JSON object (and nothing else): {"moveId": "<one of the legal move ids above>", "banter": "<short in-character line, may be empty>"}';

export function buildTurnPrompt({ state, legalMoves, botPlayerIdx }) {
  const blocks = [commonHeader(state, botPlayerIdx)];
  const hand = state.hands[botPlayerIdx];

  if (state.phase === 'discard') {
    const youAreDealer = state.dealer === botPlayerIdx;
    const cribOwner = youAreDealer ? 'YOUR crib' : "your OPPONENT'S crib";
    blocks.push(`The two cards you discard go to ${cribOwner}.`);
    blocks.push(`Your hand:\n${hand.map(c => `  - ${fmtCard(c)}`).join('\n')}`);
  } else if (state.phase === 'pegging') {
    const peg = state.pegging;
    blocks.push(`Pegging running total: ${peg.running}`);
    if (peg.history.length > 0) {
      blocks.push(`Cards already played this round (oldest first):\n${peg.history.map(c => `  - ${fmtCard(c)}`).join('\n')}`);
    }
    blocks.push(`Your remaining hand:\n${hand.map(c => `  - ${fmtCard(c)}`).join('\n')}`);
  } else if (state.phase === 'show') {
    blocks.push('The hand counts have been tallied. Acknowledge to continue.');
  }

  blocks.push(legalMovesBlock(legalMoves));
  blocks.push(RESPONSE_FOOTER);
  return blocks.join('\n\n');
}

function extractJson(text) {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
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
