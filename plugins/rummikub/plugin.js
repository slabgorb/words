import { buildInitialState } from './server/state.js';
import { applyRummikubAction } from './server/actions.js';
import { rummikubPublicView } from './server/view.js';

export default {
  id: 'rummikub',
  displayName: 'Rummikub',
  players: 2,
  clientDir: 'plugins/rummikub/client',

  initialState: buildInitialState,
  applyAction: applyRummikubAction,
  publicView: rummikubPublicView,
};
