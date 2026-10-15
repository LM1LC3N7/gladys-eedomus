// -----------------------------------------------------------------------------
// The client of the eedomus API: the answers, the errors, the queue, the
// fallback between the box and the cloud, and the secret kept out of every
// message. Requests go to a scripted `get`, or to a loopback HTTP server for
// the transport itself (127.0.0.1 only, never the network).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  EedomusError,
  createClient,
  createConnection,
  decodeBody,
  httpGet,
  networkError,
  parseAnswer,
  queryOf,
} from '../src/eedomus.js';

const SECRET = 'S3cr3t-api-key';
const json = (value, status = 200) => ({ status, body: Buffer.from(JSON.stringify(value)) });

/** A scripted `get`: answers in order, every request recorded. */
function script(...answers) {
  const urls = [];
  const get = async (url) => {
    urls.push(url);
    const next = answers.shift();
    if (!next) {
      throw new Error('unexpected request');
    }
    if (next instanceof Error) {
      throw next;
    }
    return typeof next === 'function' ? next(url) : next;
  };
  return { get, urls };
}

const kindOf = (fn) => {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof EedomusError, err.message);
    return [err.kind, err.message, err.code];
  }
  return undefined;
};

test('queryOf: the action first, every value encoded', () => {
  assert.equal(
    queryOf('periph.value', { periph_id: '1061001', value: 'Confort -1', skip: undefined }),
    'action=periph.value&periph_id=1061001&value=Confort%20-1',
  );
  assert.equal(
    queryOf('periph.caract', { periph_id: '1,2' }),
    'action=periph.caract&periph_id=1%2C2',
  );
});

test('parseAnswer: the body, the eedomus errors, the transport errors', () => {
  assert.deepEqual(parseAnswer(json({ success: 1, body: [{ periph_id: '1' }] })), [
    { periph_id: '1' },
  ]);
  assert.deepEqual(parseAnswer(json({ success: '1', body: { result: '[OK]' } })), {
    result: '[OK]',
  });
  assert.deepEqual(
    kindOf(() =>
      parseAnswer(
        json({ success: 0, body: { error_code: 1, error_msg: 'Authentification error.' } }),
      ),
    ),
    ['auth', 'Authentification error.', 1],
  );
  assert.deepEqual(
    kindOf(() =>
      parseAnswer(json({ success: '0', body: { error_code: '3', error_msg: 'Unknown device' } })),
    ),
    ['api', 'Unknown device', 3],
  );
  assert.deepEqual(
    kindOf(() => parseAnswer(json({ success: 0 }))),
    ['api', 'error ?', undefined],
  );
  assert.equal(
    kindOf(() => parseAnswer({ status: 200, body: Buffer.from('<html>') }))[0],
    'format',
  );
  assert.equal(kindOf(() => parseAnswer(json({ result: [] })))[0], 'format');
  assert.deepEqual(
    kindOf(() => parseAnswer({ status: 502, body: Buffer.from('Bad gateway') })),
    ['http', 'HTTP 502', undefined],
  );
  assert.equal(kindOf(() => parseAnswer({ status: 403, body: Buffer.from('') }))[0], 'auth');
  assert.deepEqual(
    kindOf(() =>
      parseAnswer({ status: 302, location: `https://api.eedomus.com/x?api_secret=${SECRET}` }),
    ),
    ['redirect', 'redirected to https://api.eedomus.com', undefined],
  );
});

test('the answers in Latin-1 and with raw control characters still parse', () => {
  const latin1 = Buffer.from('{"success":1,"body":{"name":"Entrée"}}', 'latin1');
  assert.equal(decodeBody(latin1), '{"success":1,"body":{"name":"Entrée"}}');
  assert.equal(parseAnswer({ status: 200, body: latin1 }).name, 'Entrée');
  const tab = Buffer.from('{"success":1,"body":{"name":"Lampe\tsalon"}}', 'utf8');
  assert.equal(parseAnswer({ status: 200, body: tab }).name, 'Lampe salon');
});

test('networkError names the socket errors', () => {
  assert.deepEqual(
    [networkError({ code: 'ECONNREFUSED' }).kind, networkError({ code: 'ECONNREFUSED' }).message],
    ['network', 'connection refused'],
  );
  assert.equal(networkError({ code: 'CERT_HAS_EXPIRED' }).kind, 'certificate');
  assert.equal(networkError({}).message, 'network error');
});

test('a call: <base>/<get|set>?action=…, the credentials last, the body back', async () => {
  const { get, urls } = script(json({ success: 1, body: { result: '[OK]' } }));
  const client = createClient({
    base: 'http://192.168.1.30/api',
    apiUser: 'gladys',
    apiSecret: SECRET,
    get,
    gap: 0,
  });
  const body = await client.call('set', 'periph.value', { periph_id: '1061001', value: '100' });
  assert.deepEqual(body, { result: '[OK]' });
  assert.equal(
    urls[0],
    `http://192.168.1.30/api/set?action=periph.value&periph_id=1061001&value=100&api_user=gladys&api_secret=${SECRET}`,
  );
  client.close();
});

test('the secret never reaches a message, even when the box echoes it', async () => {
  const echo = json({ success: 0, body: { error_code: 5, error_msg: `Bad format ${SECRET}` } });
  const { get } = script(echo, networkError({ code: 'ECONNRESET' }));
  const client = createClient({
    base: 'http://box/api',
    apiUser: 'u',
    apiSecret: SECRET,
    get,
    gap: 0,
  });
  await assert.rejects(client.call('get', 'periph.list'), (err) => {
    assert.equal(err.message, 'Bad format ***');
    return true;
  });
  await assert.rejects(client.call('get', 'periph.list'), /connection reset/);
  client.close();
});

test('one request at a time, spaced by the gap after the end of the previous one', async () => {
  let clock = 0;
  const waits = [];
  const order = [];
  const get = async (url) => {
    order.push(`start ${url.includes('list') ? 'list' : 'caract'} @${clock}`);
    clock += 300; // the box takes 300 ms to answer
    order.push(`end @${clock}`);
    return json({ success: 1, body: [] });
  };
  const client = createClient({
    base: 'http://box/api',
    apiUser: 'u',
    apiSecret: SECRET,
    get,
    gap: 600,
    now: () => clock,
    wait: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
  });
  await Promise.all([client.call('get', 'periph.list'), client.call('get', 'periph.caract')]);
  assert.deepEqual(order, ['start list @0', 'end @300', 'start caract @900', 'end @1200']);
  assert.deepEqual(waits, [600]);
  client.close();
});

// --- The fallback between the two ways -----------------------------------------

function fakeRoute(transport) {
  const route = {
    transport,
    calls: 0,
    error: undefined,
    client: {
      async call() {
        route.calls += 1;
        if (route.error) {
          throw route.error;
        }
        return transport;
      },
      close() {
        route.closed = true;
      },
    },
  };
  return route;
}

test('the preferred way, the other one when it does not answer, back every 5 minutes', async () => {
  let now = 0;
  const local = fakeRoute('local');
  const cloud = fakeRoute('cloud');
  const connection = createConnection({
    routes: [local, cloud],
    now: () => now,
    retryAfter: 300_000,
  });
  assert.equal(await connection.call('get', 'periph.list'), 'local');
  assert.deepEqual([connection.transport, connection.fallback], ['local', false]);

  local.error = new EedomusError('network', 'host unreachable');
  assert.equal(await connection.call('get', 'periph.list'), 'cloud');
  assert.deepEqual([connection.transport, connection.fallback], ['cloud', true]);
  assert.equal(connection.reason.message, 'host unreachable');

  now += 60_000;
  await connection.call('get', 'periph.list');
  assert.equal(local.calls, 2, 'not retried before the delay');

  now += 240_000;
  await connection.call('get', 'periph.list');
  assert.equal(local.calls, 3, 'retried after 5 minutes, still down');
  assert.equal(connection.transport, 'cloud');

  local.error = undefined;
  now += 300_000;
  assert.equal(await connection.call('get', 'periph.list'), 'local');
  assert.deepEqual([connection.transport, connection.fallback], ['local', false]);
  assert.equal(connection.reason, undefined);
  connection.close();
  assert.ok(local.closed && cloud.closed);
});

test('a refusal is an answer: never retried through the other way', async () => {
  const local = fakeRoute('local');
  const cloud = fakeRoute('cloud');
  const connection = createConnection({ routes: [local, cloud] });
  local.error = new EedomusError('auth', 'Authentification error.', { code: 1 });
  await assert.rejects(connection.call('get', 'periph.list'), /Authentification/);
  local.error = new EedomusError('api', 'Unknown device', { code: 3 });
  await assert.rejects(connection.call('get', 'periph.caract'), /Unknown device/);
  assert.equal(cloud.calls, 0);
});

test('no way answers: the error of the preferred one, naming the other', async () => {
  const local = fakeRoute('local');
  const cloud = fakeRoute('cloud');
  const connection = createConnection({ routes: [local, cloud] });
  local.error = new EedomusError('timeout', 'no answer within 15 s');
  cloud.error = new EedomusError('network', 'unknown host name');
  await assert.rejects(connection.call('get', 'periph.list'), (err) => {
    assert.equal(err.message, 'no answer within 15 s');
    assert.equal(err.fallbackError.message, 'unknown host name');
    return true;
  });
  assert.equal(connection.transport, 'local', 'the next attempt starts from the preferred way');
});

// --- The transport, on a loopback server ----------------------------------------

async function loopback(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test('httpGet over a real socket: an answer, a size limit, a timeout, no URL in errors', async (t) => {
  const seen = [];
  const base = await loopback(t, (req, res) => {
    seen.push(req.url);
    if (req.url.includes('big')) {
      res.end('x'.repeat(4096));
    } else if (req.url.includes('slow')) {
      setTimeout(() => res.end('{}'), 500);
    } else if (req.url.includes('cut')) {
      req.socket.destroy();
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: 1, body: [{ periph_id: '1', name: 'Entrée' }] }));
    }
  });
  const client = createClient({
    base: `${base}/api`,
    apiUser: 'gladys',
    apiSecret: SECRET,
    gap: 0,
  });
  assert.deepEqual(await client.call('get', 'periph.list'), [{ periph_id: '1', name: 'Entrée' }]);
  assert.match(seen[0], /^\/api\/get\?action=periph\.list&api_user=gladys&api_secret=/);

  await assert.rejects(httpGet(`${base}/big`, { timeout: 1000, maxBytes: 1024 }), /larger than/);
  await assert.rejects(httpGet(`${base}/slow`, { timeout: 100 }), /no answer within/);
  await assert.rejects(client.call('get', 'cut', {}, { timeout: 1000 }), (err) => {
    assert.ok(err instanceof EedomusError);
    assert.doesNotMatch(err.message, /api_secret|S3cr3t|127\.0\.0\.1/);
    return true;
  });
  client.close();
});
