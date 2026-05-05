import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlugin } from '../src/server/plugins.js';

const makeStub = (overrides = {}) => ({
  id: 'stub',
  displayName: 'Stub',
  players: 2,
  clientDir: 'plugins/stub/client',
  initialState: () => ({}),
  applyAction: () => ({ state: {}, ended: false }),
  publicView: ({ state }) => state,
  ...overrides,
});

test('valid plugin passes', () => {
  assert.doesNotThrow(() => validatePlugin(makeStub()));
});

test('missing id throws', () => {
  const p = makeStub();
  delete p.id;
  assert.throws(() => validatePlugin(p), /id/);
});

test('id with non-url-safe chars throws', () => {
  assert.throws(() => validatePlugin(makeStub({ id: 'has spaces' })), /url-safe/);
  assert.throws(() => validatePlugin(makeStub({ id: 'UPPER' })), /url-safe/);
});

test('players != 2 throws', () => {
  assert.throws(() => validatePlugin(makeStub({ players: 3 })), /players.*2/);
  assert.throws(() => validatePlugin(makeStub({ players: 1 })), /players.*2/);
});

test('missing initialState throws', () => {
  assert.throws(() => validatePlugin(makeStub({ initialState: undefined })), /initialState/);
});

test('missing applyAction throws', () => {
  assert.throws(() => validatePlugin(makeStub({ applyAction: undefined })), /applyAction/);
});

test('missing publicView throws', () => {
  assert.throws(() => validatePlugin(makeStub({ publicView: undefined })), /publicView/);
});

test('non-function applyAction throws', () => {
  assert.throws(() => validatePlugin(makeStub({ applyAction: 'not a fn' })), /applyAction/);
});

test('legalActions and auxRoutes are optional', () => {
  assert.doesNotThrow(() => validatePlugin(makeStub({ legalActions: undefined, auxRoutes: undefined })));
});

test('auxRoutes must be a plain object of {method, handler}', () => {
  assert.doesNotThrow(() => validatePlugin(makeStub({ auxRoutes: { validate: { method: 'POST', handler: () => {} } } })));
  assert.throws(() => validatePlugin(makeStub({ auxRoutes: 'nope' })), /auxRoutes/);
  assert.throws(() => validatePlugin(makeStub({ auxRoutes: { validate: { method: 'POST' } } })), /handler/);
  assert.throws(() => validatePlugin(makeStub({ auxRoutes: { validate: { handler: () => {} } } })), /method/);
});
