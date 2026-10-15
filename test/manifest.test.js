// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULTS } from '../src/config.js';
import { ACTIONS, POLL_INTERVAL } from '../src/constants.js';
import { T } from '../src/i18n.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) {
      yield* texts(entry, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.match(manifest.gladys_version, /^>=5\.1\.0$/);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-eedomus:${manifest.version}`);
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  // Both ways: Gladys shows the "Prefer the local connection" toggle.
  assert.deepEqual(manifest.transports, ['local', 'cloud']);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
});

test('every text is in English and French', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
});

test('unofficial, and said so', () => {
  const intro = manifest.config_schema.find((f) => f.key === 'intro');
  assert.match(intro.description.en, /Unofficial, not affiliated with Connected Object\./);
  assert.match(intro.description.fr, /Non officiel, sans lien avec Connected Object\./);
  assert.match(read('README.md'), /not affiliated with Connected Object/);
  for (const lang of ['en', 'fr']) {
    assert.match(read(`docs/${lang}.md`), /Connected Object/);
  }
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    if (fields[key].default !== undefined || !['', null].includes(value)) {
      assert.deepEqual(fields[key].default, value, key);
    }
  }
  assert.equal(fields.api_secret.type, 'secret');
  assert.equal(fields.api_user.required, true);
  assert.equal(fields.api_secret.required, true);
  assert.equal(fields.box_address.required, false, 'empty: the cloud only');
  assert.equal(fields.GLADYS_PREFER_LOCAL, undefined, 'reserved key, rendered by the core');
  assert.deepEqual(
    [fields.poll_interval.min, fields.poll_interval.max],
    [POLL_INTERVAL.min, POLL_INTERVAL.max],
  );
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    for (const lang of ['en', 'fr']) {
      const length = section.description[lang].length;
      assert.ok(length <= 1000, `${section.key}.${lang}: ${length} characters`);
    }
    assert.ok((section.links ?? []).every((l) => l.url.startsWith('https://')));
    assert.ok((section.links ?? []).length <= 5);
  }
  for (const field of manifest.config_schema.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', `${field.key}: multi-language placeholder`);
  }
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  for (const action of manifest.actions) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120);
  }
  assert.equal(manifest.scene_triggers, undefined);
});

test('the badge messages fit the 200 characters of publishTransports', () => {
  for (const [name, message] of Object.entries(T.badge)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(message[lang].length <= 200, `${name}.${lang}: ${message[lang].length}`);
    }
  }
});
