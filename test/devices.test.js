// -----------------------------------------------------------------------------
// The inventory -> Gladys devices: one device per peripheral, stable ids,
// names with the room, the routing tables of the readers and writers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, deviceName } from '../src/devices.js';
import { buildInventory, caractRecords } from '../src/inventory.js';
import { answers } from './fixtures/eedomus.js';

const idsOf = (id) => ({
  device: `ext:test:eedomus:${id}`,
  feature: (key) => `ext:test:eedomus:${id}:${key}`,
});

const model = () => {
  const a = answers();
  return buildModel(idsOf, buildInventory({ list: a.list, values: a.values, caract: a.caract }));
};

test('the inventory: rooms, lists of values, last values', () => {
  const a = answers();
  const inventory = buildInventory({ list: a.list, values: a.values, caract: a.caract });
  assert.equal(inventory.peripherals.length, 28);
  assert.equal(inventory.rooms, 10, 'the hidden room does not count');
  const dimmer = inventory.peripherals.find((p) => p.name === 'Variateur cuisine');
  assert.equal(dimmer.room, 'Cuisine');
  assert.equal(dimmer.values.length, 11);
  assert.equal(dimmer.record.last_value, '30');
  const phase = inventory.peripherals.find((p) => p.name === 'Phase de la journée');
  assert.equal(phase.room, undefined, '[Invisible]');
  const child = inventory.peripherals.find((p) => p.name === 'Détecteur entrée température');
  assert.equal(child.parentId, '1061010');
});

test('one device per peripheral, named with its room', () => {
  const m = model();
  assert.equal(m.devices.length, 27);
  assert.deepEqual(m.counts, { peripherals: 28, empty: 1, overflow: 0 });
  const lamp = m.devices.find((d) => d.name === 'Lampe salon (Salon)');
  assert.equal(lamp.external_id, 'ext:test:eedomus:1061001');
  assert.equal(lamp.should_poll, false);
  assert.deepEqual(lamp.features[0].external_id, 'ext:test:eedomus:1061001:binary');
  assert.deepEqual(lamp.params, [
    { name: 'EEDOMUS_PERIPH_ID', value: '1061001' },
    { name: 'EEDOMUS_ROOM', value: 'Salon' },
    { name: 'EEDOMUS_USAGE', value: 'Lampe (1)' },
  ]);
  const child = m.devices.find((d) => d.name === 'Prise TV consommation (Salon)');
  assert.deepEqual(child.params.at(-1), { name: 'EEDOMUS_PARENT_ID', value: '1061003' });
  assert.ok(
    m.devices.find((d) => d.name === 'Phase de la journée'),
    'no room, no suffix',
  );
  assert.equal(m.owners.get('ext:test:eedomus:1061005:position'), '1061005');
  assert.equal(m.deviceIds.get('ext:test:eedomus:1061005'), '1061005');
  assert.equal(m.readers.get('1061016')[0].event, true);
});

test('names are cut at 100 characters', () => {
  assert.equal(deviceName({ name: 'x'.repeat(120) }).length, 100);
  assert.equal(deviceName({ name: 'Lampe', room: 'Salon' }), 'Lampe (Salon)');
});

test('periph.caract: one object for one id, a list for several', () => {
  assert.deepEqual(caractRecords({ name: 'Lampe', last_value: '0' }, ['1061001']), [
    { name: 'Lampe', last_value: '0', periph_id: '1061001' },
  ]);
  assert.deepEqual(
    caractRecords([{ periph_id: 1, last_value: '0' }, { periph_id: '2' }, null], ['1', '2']),
    [{ periph_id: '1', last_value: '0' }, { periph_id: '2' }],
  );
  assert.deepEqual(caractRecords({ periph_id: '3', last_value: '1' }), [
    { periph_id: '3', last_value: '1' },
  ]);
  assert.deepEqual(caractRecords(undefined), []);
});
