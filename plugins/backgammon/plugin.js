import { buildInitialState } from './server/state.js';
import { applyBackgammonAction } from './server/actions.js';
import { backgammonPublicView } from './server/view.js';

export default {
  id: 'backgammon',
  displayName: 'Backgammon',
  players: 2,
  clientDir: 'plugins/backgammon/client',

  initialState: buildInitialState,
  applyAction: applyBackgammonAction,
  publicView: backgammonPublicView,
};
