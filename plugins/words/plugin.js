import { buildInitialState } from './server/state.js';
import { applyWordsAction } from './server/actions.js';
import { wordsPublicView } from './server/view.js';
import { validatePlacement, extractWords, scoreMove } from './server/engine.js';
import { loadDictionary } from './server/dictionary.js';

let _dict;
function dict() { return _dict ??= loadDictionary(); }

export default {
  id: 'words',
  displayName: 'Words',
  players: 2,
  clientDir: 'plugins/words/client',

  initialState: buildInitialState,
  applyAction: applyWordsAction,
  publicView: wordsPublicView,

  auxRoutes: {
    validate: {
      method: 'POST',
      handler: (req, res) => {
        const placement = req.body?.placement;
        if (!Array.isArray(placement)) return res.status(400).json({ error: 'placement required' });
        const board = req.game.state.board;
        const isFirstMove = !req.game.state.initialMoveDone;
        const geo = validatePlacement(board, placement, isFirstMove);
        if (!geo.valid) return res.json({ valid: false, reason: geo.reason });
        const { mainWord, crossWords } = extractWords(board, placement, geo.axis);
        const allWords = [mainWord, ...crossWords].filter(Boolean);
        const wordResults = allWords.map(w => ({ word: w.text, ok: dict().isWord(w.text) }));
        const allValid = wordResults.length > 0 && wordResults.every(w => w.ok);
        const points = allValid ? scoreMove(board, placement, mainWord, crossWords, req.game.state.variant) : 0;
        res.json({ valid: allValid, words: wordResults, points, score: points }); // score alias for backwards compat
      },
    },
  },
};
