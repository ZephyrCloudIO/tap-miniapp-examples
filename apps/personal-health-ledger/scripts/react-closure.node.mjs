import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSingleReactHookRuntime,
  countReactHookRuntimes,
} from './react-closure.mjs';

const reactRuntime =
  'e.useMemo=function(t,n){return r.H.useMemo(t,n)};';

test('accepts one React hook runtime', () => {
  assert.equal(countReactHookRuntimes([reactRuntime]), 1);
  assert.doesNotThrow(() => assertSingleReactHookRuntime([reactRuntime]));
});

test('rejects duplicate React hook runtimes', () => {
  assert.throws(
    () => assertSingleReactHookRuntime([reactRuntime, reactRuntime]),
    /exactly one React hook runtime; found 2/u,
  );
});

test('rejects a missing React hook runtime', () => {
  assert.throws(
    () => assertSingleReactHookRuntime(['export const surfaceTarget="desktop";']),
    /exactly one React hook runtime; found 0/u,
  );
});
