import { buildInitialState } from './server/state.js';
import { applyBuracoAction } from './server/actions.js';
import { buracoPublicView } from './server/view.js';

export default {
  id: 'buraco',
  displayName: 'Buraco',
  players: 2,
  clientDir: 'plugins/buraco/client',
  initialState: buildInitialState,
  applyAction: applyBuracoAction,
  publicView: buracoPublicView,
};
