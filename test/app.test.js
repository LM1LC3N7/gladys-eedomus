// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys, and a fake eedomus box serving the fixtures through the real
// connection (local way, cloud way, fallback). Timers are mocked: the reads,
// the reconnections and the state flush run when the test ticks.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { EedomusApp } from '../src/app.js';
import { ACTIONS, TIMINGS } from '../src/constants.js';
import { EedomusError } from '../src/eedomus.js';
import { registerHandlers } from '../src/handlers.js';
import { T } from '../src/i18n.js';
import { COVER_STATE, PILOT_WIRE_MODE } from '../src/mapping.js';
import { API, fakeEedomus, settle } from './helpers/fakeEedomus.js';

const DEVICE = (id) => `ext:test-integration:eedomus:${id}`;
const POLL = 15_000;
const CONFIG = { box_address: '192.168.1.30', ...API };

async function setup(t, config = CONFIG, prepare = () => {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_792_092_000_000 });
  const gladys = createFakeGladys({ config });
  const box = fakeEedomus();
  prepare(box);
  const logs = [];
  const logger = createLogger({ level: 'silent' });
  for (const level of ['debug', 'info', 'warn', 'error']) {
    logger[level] = (...args) => logs.push(args.map(String).join(' '));
  }
  const app = new EedomusApp({ gladys, connect: box.connect, now: () => Date.now(), logger });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  const tick = async (ms) => {
    t.mock.timers.tick(ms);
    await settle();
  };
  return { gladys, app, box, tick, logs };
}

const deviceNamed = (gladys, name) => gladys.fake.discoveredDevices.find((d) => d.name === name);

async function created(gladys, name) {
  const device = deviceNamed(gladys, name);
  assert.ok(device, `${name} is discovered`);
  await gladys.fake.deviceCreated(device);
  return device;
}

const featureOf = (device, key) => {
  const feature = device.features.find((f) => f.external_id === `${device.external_id}:${key}`);
  assert.ok(feature, `${device.name} has ${key}`);
  return feature;
};

const statesOf = (gladys, featureId) =>
  gladys.fake.states.filter((s) => s.device_feature_external_id === featureId);

test('the peripherals become Gladys devices, the values flow once created', async (t) => {
  const { gladys, box, tick } = await setup(t);
  assert.equal(box.connections[0].config.boxUrl, 'http://192.168.1.30');
  assert.deepEqual(
    box.calls.map((c) => [c.transport, c.action, c.params.periph_id]),
    [
      ['local', 'periph.list', undefined],
      ['local', 'periph.value_list', 'all'],
      ['local', 'periph.caract', 'all'],
    ],
  );
  assert.equal(gladys.fake.discoveredDevices.length, 27);
  assert.ok(deviceNamed(gladys, 'Lampe salon (Salon)'));
  assert.ok(!gladys.fake.discoveredDevices.some((d) => d.name.startsWith('Widget')));
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(
    gladys.fake.connectionStatus.message.en,
    'Connected to the eedomus box (192.168.1.30, local API): 27 devices in Discovery.',
  );

  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.states.length, 0, 'nothing is sent for a device not created');

  await created(gladys, 'Variateur cuisine (Cuisine)');
  await created(gladys, 'Détecteur entrée température (Entrée)');
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(`${DEVICE(1061002)}:brightness`), 30);
  assert.equal(gladys.fake.lastState(`${DEVICE(1061011)}:temperature`), 20.8);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: DEVICE(1061011),
    transport: DEVICE_TRANSPORTS.LOCAL,
  });
});

test('every poll reads the created peripherals only, in one request', async (t) => {
  const { gladys, box, tick } = await setup(t);
  await tick(POLL);
  assert.equal(box.callsOf('periph.caract').length, 1, 'nothing created: nothing read');

  await created(gladys, 'Lampe salon (Salon)');
  await created(gladys, "Porte d'entrée (Entrée)");
  box.emit(1061001, { last_value: '100', last_value_text: 'On' });
  box.emit(1061013, { last_value: '100', last_value_text: 'Ouvert' });
  await tick(POLL);
  await tick(TIMINGS.flushInterval);
  assert.deepEqual(box.callsOf('periph.caract').at(-1).params, { periph_id: '1061001,1061013' });
  assert.equal(gladys.fake.lastState(`${DEVICE(1061001)}:binary`), 1);
  assert.equal(gladys.fake.lastState(`${DEVICE(1061013)}:opening`), 0, 'open door');
  assert.equal(box.callsOf('periph.list').length, 1, 'no inventory read for value changes');

  // One peripheral: the box answers one object without its id.
  await gladys.fake.deviceDeleted(deviceNamed(gladys, "Porte d'entrée (Entrée)"));
  box.emit(1061001, { last_value: '0', last_value_text: 'Off' });
  await tick(POLL);
  await tick(TIMINGS.flushInterval);
  assert.deepEqual(box.callsOf('periph.caract').at(-1).params, { periph_id: '1061001' });
  assert.equal(gladys.fake.lastState(`${DEVICE(1061001)}:binary`), 0);
});

test('every press of a remote is an event, none at the connection', async (t) => {
  const { gladys, box, tick } = await setup(t);
  const remote = await created(gladys, 'Télécommande salon (Salon)');
  await tick(POLL);
  await tick(TIMINGS.flushInterval);
  assert.equal(statesOf(gladys, `${remote.external_id}:button`).length, 0);

  box.emit(1061016, { last_value: '1', last_value_text: 'Simple appui' });
  await tick(POLL);
  box.emit(1061016, { last_value: '1', last_value_text: 'Simple appui' });
  await tick(POLL);
  box.emit(1061016, { last_value: '2', last_value_text: 'Double appui' });
  await tick(POLL);
  await tick(POLL); // read again, unchanged: not a new press
  await tick(TIMINGS.flushInterval);
  assert.deepEqual(
    statesOf(gladys, `${remote.external_id}:button`).map((s) => s.state),
    [1, 1, 2],
  );
});

test('the Gladys commands set an allowed value, the new value is read soon after', async (t) => {
  const { gladys, box, tick } = await setup(t);
  const run = async (name, key, value) => {
    const device = deviceNamed(gladys, name);
    const before = box.executed.length;
    const ack = await gladys.fake.setValue(device, featureOf(device, key), value);
    assert.equal(ack.success, true, `${name} ${key}=${value}: ${ack.error}`);
    return box.executed.slice(before);
  };
  const lamp = await created(gladys, 'Lampe salon (Salon)');
  assert.deepEqual(await run('Lampe salon (Salon)', 'binary', 1), [
    { periph_id: '1061001', value: '100' },
  ]);
  assert.equal(box.calls.at(-1).kind, 'set');
  await tick(TIMINGS.commandEcho);
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(`${lamp.external_id}:binary`), 1, 'read back at once');

  assert.deepEqual(await run('Variateur cuisine (Cuisine)', 'brightness', 42), [
    { periph_id: '1061002', value: '40' },
  ]);
  assert.deepEqual(await run('Volet salon (Salon)', 'state', COVER_STATE.CLOSE), [
    { periph_id: '1061005', value: '0' },
  ]);
  assert.deepEqual(await run('Volet chambre (Chambre)', 'state', COVER_STATE.STOP), [
    { periph_id: '1061006', value: 'MY' },
  ]);
  assert.deepEqual(await run('Radiateur chambre (Chambre)', 'pilot-wire', PILOT_WIRE_MODE.ECO), [
    { periph_id: '1061007', value: '25' },
  ]);
  assert.deepEqual(await run('Consigne salon (Salon)', 'setpoint', 20.5), [
    { periph_id: '1061008', value: '20.5' },
  ]);
  assert.deepEqual(await run('Thermostat bureau (Bureau)', 'setpoint', 20.3), [
    { periph_id: '1061009', value: '20.5' },
  ]);
  assert.deepEqual(await run('Mode alarme (Entrée)', 'selector', '2'), [
    { periph_id: '1061022', value: '2' },
  ]);

  const sensor = deviceNamed(gladys, 'Détecteur entrée température (Entrée)');
  const refused = await gladys.fake.setValue(sensor, featureOf(sensor, 'temperature'), 1);
  assert.equal(refused.success, false, 'a sensor cannot be controlled');

  const shutter = deviceNamed(gladys, 'Volet salon (Salon)');
  const noStop = await gladys.fake.setValue(shutter, featureOf(shutter, 'state'), 0);
  assert.equal(noStop.success, false);
  assert.match(noStop.error, /cannot be stopped/);

  box.failOn['periph.value'] = new EedomusError('api', 'Server error', { code: 7 });
  const failed = await gladys.fake.setValue(lamp, featureOf(lamp, 'binary'), 0);
  assert.equal(failed.success, false);
  assert.match(failed.error, /Server error/);
});

test('the box does not answer: through the cloud, degraded badges, back after 5 minutes', async (t) => {
  const { gladys, box, tick } = await setup(t);
  const lamp = await created(gladys, 'Lampe salon (Salon)');
  box.down.local = new EedomusError('network', 'host unreachable');
  box.emit(1061001, { last_value: '100', last_value_text: 'On' });
  await tick(POLL);
  await tick(TIMINGS.flushInterval);
  assert.equal(box.callsOf('periph.caract', 'cloud').length, 1);
  assert.equal(gladys.fake.lastState(`${lamp.external_id}:binary`), 1, 'read through the cloud');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /^Connected through the eedomus cloud: the box \(192\.168\.1\.30\) does not answer on the local network \(host unreachable\)/,
  );
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: lamp.external_id,
    transport: DEVICE_TRANSPORTS.CLOUD,
    degraded: true,
    message: T.badge.viaCloud,
  });

  // Through the cloud, the reads are a minute apart.
  const reads = box.callsOf('periph.caract').length;
  const localReads = box.callsOf('periph.caract', 'local').length;
  await tick(POLL);
  assert.equal(box.callsOf('periph.caract').length, reads);
  await tick(TIMINGS.cloudPollMin - POLL);
  assert.equal(box.callsOf('periph.caract').length, reads + 1);
  assert.equal(
    box.callsOf('periph.caract', 'local').length,
    localReads,
    'the box is not tried again before 5 minutes',
  );

  box.down.local = undefined;
  for (let waited = 0; waited < TIMINGS.preferredRetry; waited += TIMINGS.cloudPollMin) {
    await tick(TIMINGS.cloudPollMin);
  }
  assert.equal(box.calls.at(-1).transport, 'local');
  assert.equal(
    gladys.fake.connectionStatus.message.en,
    'Connected to the eedomus box (192.168.1.30, local API): 27 devices in Discovery.',
  );
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: lamp.external_id,
    transport: DEVICE_TRANSPORTS.LOCAL,
  });
});

test('no way answers: unreachable, the reconnection reads everything again', async (t) => {
  const { gladys, box, tick } = await setup(t);
  const lamp = await created(gladys, 'Lampe salon (Salon)');
  box.down.local = new EedomusError('network', 'connection refused');
  box.down.cloud = new EedomusError('network', 'host name not resolved');
  await tick(POLL);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.equal(
    gladys.fake.connectionStatus.message.en,
    'The eedomus box (192.168.1.30) is unreachable: connection refused. The eedomus cloud did not answer either: host name not resolved. Check its IP address, seen from the Gladys machine (not localhost). Retrying in a few seconds.',
  );
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: lamp.external_id,
    transport: DEVICE_TRANSPORTS.UNREACHABLE,
  });
  const offline = await gladys.fake.setValue(lamp, featureOf(lamp, 'binary'), 1);
  assert.equal(offline.success, false);
  assert.match(offline.error, /not connected/);

  // Missed while unreachable: the inventory brings it back.
  box.down = {};
  box.emit(1061001, { last_value: '100', last_value_text: 'On' });
  const inventories = box.callsOf('periph.list').length;
  await tick(TIMINGS.retryMin);
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(box.callsOf('periph.list').length, inventories + 1);
  assert.equal(gladys.fake.lastState(`${lamp.external_id}:binary`), 1);
  assert.equal(gladys.fake.transports.at(-1).transport, DEVICE_TRANSPORTS.LOCAL);
});

test('refused credentials: a clear status, retried every few minutes, never the secret', async (t) => {
  const { gladys, box, tick, logs } = await setup(t, {
    box_address: '192.168.1.30',
    api_user: 'gladys',
    api_secret: 'not-the-secret',
  });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the API credentials/);
  assert.equal(box.callsOf('periph.list', 'cloud').length, 0, 'a refusal is not retried elsewhere');
  const attempts = box.calls.length;
  await tick(TIMINGS.retryMax);
  assert.equal(box.calls.length, attempts);
  await tick(TIMINGS.authRetry - TIMINGS.retryMax);
  assert.equal(box.calls.length, attempts + 1);
  const said = JSON.stringify([gladys.fake.connectionStatuses, logs]);
  assert.doesNotMatch(said, /not-the-secret/);
});

test('without a box address: the cloud only, nominal, a read a minute', async (t) => {
  const { gladys, box, tick } = await setup(t, { ...API });
  const lamp = await created(gladys, 'Lampe salon (Salon)');
  assert.ok(box.calls.every((c) => c.transport === 'cloud'));
  assert.equal(
    gladys.fake.connectionStatus.message.en,
    'Connected through the eedomus cloud: 27 devices in Discovery.',
  );
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: lamp.external_id,
    transport: DEVICE_TRANSPORTS.CLOUD,
  });
  await tick(POLL);
  assert.equal(box.callsOf('periph.caract').length, 1, 'only the inventory read');
  await tick(TIMINGS.cloudPollMin - POLL);
  assert.equal(box.callsOf('periph.caract').length, 2);
});

test('"Prefer the local connection" off: the cloud first, the box as the fallback', async (t) => {
  const { gladys, box } = await setup(t, { ...CONFIG, GLADYS_PREFER_LOCAL: false });
  assert.ok(box.calls.every((c) => c.transport === 'cloud'));
  box.down.cloud = new EedomusError('timeout', 'no answer within 15 s');
  await gladys.fake.scanRequest();
  assert.equal(box.calls.at(-1).transport, 'local');
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /^Connected to the eedomus box \(192\.168\.1\.30, local API\): the eedomus cloud does not answer/,
  );
  await gladys.fake.configUpdated({ ...CONFIG, GLADYS_PREFER_LOCAL: true });
  assert.equal(box.connections.at(-1).routes[0].transport, 'local');
});

test('the connection test tries both ways and counts what is offered', async (t) => {
  const { gladys, box } = await setup(t);
  const ack = await gladys.fake.action(ACTIONS.TEST, {});
  assert.equal(ack.success, true);
  assert.equal(
    ack.data.message.en,
    'Local API (192.168.1.30): OK. eedomus cloud: OK. 28 peripherals, 10 rooms: 27 devices offered in Discovery, 1 left out (nothing to offer).',
  );
  assert.equal(
    ack.data.message.fr,
    'API locale (192.168.1.30) : OK. Cloud eedomus : OK. 28 périphériques, 10 pièces : 27 appareils proposés dans Découverte, 1 écarté (rien à proposer).',
  );
  assert.ok(
    box.connections.at(-1).routes.every((r) => r.client.closed),
    'closed after the test',
  );

  box.down.local = new EedomusError('network', 'connection refused');
  const fallback = await gladys.fake.action(ACTIONS.TEST, {});
  assert.match(
    fallback.data.message.en,
    /^Local API \(192\.168\.1\.30\): connection refused\. eedomus cloud: OK\. 28 peripherals/,
  );

  box.down.cloud = new EedomusError('network', 'host name not resolved');
  const down = await gladys.fake.action(ACTIONS.TEST, {});
  assert.equal(
    down.data.message.en,
    'Local API (192.168.1.30): connection refused. eedomus cloud: host name not resolved.',
  );
});

test('without credentials, the status says what to fill in', async (t) => {
  const { gladys, box } = await setup(t, {});
  assert.equal(gladys.fake.connectionStatus.message.en, T.notConfigured.en);
  assert.equal(box.connections.length, 0);
  const ack = await gladys.fake.action(ACTIONS.TEST, {});
  assert.deepEqual(ack.data.message, T.notConfigured);

  await gladys.fake.configUpdated({ box_address: '192.168.1.30', api_user: 'gladys' });
  assert.equal(gladys.fake.connectionStatus.message.en, T.noCredentials.en);
  await gladys.fake.configUpdated({ box_address: 'https://secure.eedomus.com', ...API });
  assert.match(gladys.fake.connectionStatus.message.en, /not an eedomus\.com address/);
});

test('a peripheral the box cannot reach gets an unreachable badge', async (t) => {
  const { gladys, box, tick } = await setup(t);
  const garden = await created(gladys, 'Lampe jardin (Jardin)');
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: garden.external_id,
    transport: DEVICE_TRANSPORTS.UNREACHABLE,
    degraded: true,
    message: T.badge.deviceUnreachable,
  });
  box.emit(1061023, { last_value: '0', last_value_text: 'Off' });
  await tick(POLL);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: garden.external_id,
    transport: DEVICE_TRANSPORTS.LOCAL,
  });
});

test('a renamed peripheral reads the inventory again, a deleted one leaves the reads', async (t) => {
  const { gladys, box, tick } = await setup(t);
  await created(gladys, 'Lampe salon (Salon)');
  await created(gladys, 'Prise TV (Salon)');
  box.records.get('1061001').name = 'Lampe canapé';
  box.list.find((p) => p.periph_id === '1061001').name = 'Lampe canapé';
  await tick(POLL);
  await tick(TIMINGS.inventoryDebounce);
  assert.ok(deviceNamed(gladys, 'Lampe canapé (Salon)'));

  box.remove(1061003);
  await tick(POLL);
  assert.equal(gladys.fake.connectionStatus.connected, true, 'not a connection failure');
  await tick(TIMINGS.inventoryDebounce);
  assert.ok(!deviceNamed(gladys, 'Prise TV (Salon)'));
  await tick(POLL);
  assert.deepEqual(box.callsOf('periph.caract').at(-1).params, { periph_id: '1061001' });
});

test('Scan reads the inventory again, the inventory is refreshed every 15 minutes', async (t) => {
  const { gladys, box, tick } = await setup(t);
  await gladys.fake.scanRequest();
  assert.equal(box.callsOf('periph.list').length, 2);
  box.list.push({ ...structuredClone(box.list[0]), periph_id: '1061099', name: 'Nouvelle lampe' });
  box.records.set('1061099', {
    ...structuredClone(box.records.get('1061001')),
    periph_id: '1061099',
  });
  box.values.push({ ...structuredClone(box.values[0]), periph_id: '1061099' });
  await tick(TIMINGS.inventoryRefresh);
  assert.ok(deviceNamed(gladys, 'Nouvelle lampe (Salon)'));
  assert.equal(
    gladys.fake.connectionStatus.message.en,
    'Connected to the eedomus box (192.168.1.30, local API): 28 devices in Discovery.',
  );
});
