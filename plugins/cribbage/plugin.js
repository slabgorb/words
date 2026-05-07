import { buildInitialState } from './server/state.js';
import { applyCribbageAction } from './server/actions.js';
import { cribbagePublicView } from './server/view.js';

export default {
  id: 'cribbage',
  displayName: 'Cribbage',
  players: 2,
  clientDir: 'plugins/cribbage/client',
  initialState: buildInitialState,
  applyAction: applyCribbageAction,
  publicView: cribbagePublicView,
};
