import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const config = JSON.parse(
  readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
);

test('every deployable Wrangler profile disables body-authored identity', () => {
  assert.equal(config.vars.ALLOW_DEV_IDENTITY, 'false');
  for (const environment of Object.values(config.env ?? {})) {
    assert.equal(environment.vars?.ALLOW_DEV_IDENTITY, 'false');
  }
});

test('every deployable Wrangler profile requires an external ticket secret', () => {
  assert.deepEqual(config.secrets?.required, ['TICKET_SECRET']);
  assert.equal(Object.hasOwn(config.vars, 'TICKET_SECRET'), false);
  for (const environment of Object.values(config.env ?? {})) {
    assert.deepEqual(environment.secrets?.required, ['TICKET_SECRET']);
    assert.equal(Object.hasOwn(environment.vars ?? {}, 'TICKET_SECRET'), false);
  }
});
