// Static plugin registry. Add a plugin by importing it and adding it to the
// exported map. The order here is the order plugins appear in any picker UI.

import wordsPlugin from '../../plugins/words/plugin.js';
import rummikubPlugin from '../../plugins/rummikub/plugin.js';
import backgammonPlugin from '../../plugins/backgammon/plugin.js';
import cribbagePlugin from '../../plugins/cribbage/plugin.js';

export const plugins = {
  words: wordsPlugin,
  rummikub: rummikubPlugin,
  backgammon: backgammonPlugin,
  cribbage: cribbagePlugin,
};
