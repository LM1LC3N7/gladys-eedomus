import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseBoxAddress } from '../src/config.js';

test('the local address of the box from what the user typed', () => {
  const url = (raw) => parseBoxAddress(raw).url;
  assert.equal(url('192.168.1.30'), 'http://192.168.1.30');
  assert.equal(url(' 192.168.1.30:8080 '), 'http://192.168.1.30:8080');
  assert.equal(url('http://eedomus.lan/'), 'http://eedomus.lan');
  assert.equal(url('http://192.168.1.30/api/get?action=periph.list'), 'http://192.168.1.30');
  assert.equal(parseBoxAddress('192.168.1.30:8080').host, '192.168.1.30:8080');
  assert.deepEqual(parseBoxAddress(''), {}, 'no address: the cloud only');
  assert.deepEqual(parseBoxAddress(undefined), {});
});

test('the addresses refused', () => {
  assert.deepEqual(parseBoxAddress('ftp://box'), { error: 'invalid' });
  assert.deepEqual(parseBoxAddress('http://'), { error: 'invalid' });
  assert.deepEqual(parseBoxAddress('http://admin:pw@192.168.1.30'), { error: 'credentials' });
  assert.deepEqual(
    parseBoxAddress('http://192.168.1.30/api/get?action=auth.test&api_user=u&api_secret=s'),
    { error: 'credentials' },
  );
  assert.deepEqual(parseBoxAddress('https://api.eedomus.com'), { error: 'cloud' });
  assert.deepEqual(parseBoxAddress('secure.eedomus.com'), { error: 'cloud' });
});

test('normalizeConfig: credentials, the preferred way, the bounds', () => {
  const config = normalizeConfig({
    box_address: '192.168.1.30',
    api_user: ' gladys ',
    api_secret: 'secret',
    poll_interval: '2',
  });
  assert.equal(config.error, undefined);
  assert.equal(config.boxUrl, 'http://192.168.1.30');
  assert.equal(config.apiUser, 'gladys');
  assert.equal(config.preferLocal, true, 'the default of GLADYS_PREFER_LOCAL');
  assert.equal(config.pollInterval, 5, 'bounded');
  assert.equal(normalizeConfig({ GLADYS_PREFER_LOCAL: false }).preferLocal, false);
  assert.equal(normalizeConfig({ poll_interval: 'x' }).pollInterval, 15);
});

test('normalizeConfig: what is missing', () => {
  assert.equal(normalizeConfig().error, 'empty');
  assert.equal(normalizeConfig({ box_address: '192.168.1.30' }).error, 'no-credentials');
  assert.equal(normalizeConfig({ api_user: 'gladys' }).error, 'no-credentials');
  assert.equal(normalizeConfig({ api_user: 'u', api_secret: 's' }).error, undefined);
  assert.equal(normalizeConfig({ api_user: 'u', api_secret: 's' }).boxUrl, undefined);
  assert.equal(
    normalizeConfig({ box_address: 'ftp://x', api_user: 'u', api_secret: 's' }).error,
    'invalid',
  );
});
