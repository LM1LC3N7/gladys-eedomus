// -----------------------------------------------------------------------------
// One eedomus peripheral -> Gladys features: the usages, the value lists
// (on/off, levels, open/close/stop, pilot wire orders, temperatures), the
// units, and the values written back (always an allowed value of the list).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInventory } from '../src/inventory.js';
import {
  BUTTON_STATUS,
  COVER_STATE,
  OPENING_SENSOR_STATE,
  PILOT_WIRE_MODE,
  buttonStatus,
  isPilotWire,
  mapPeripheral,
  measureOf,
  num,
  pilotWireMode,
} from '../src/mapping.js';
import { answers } from './fixtures/eedomus.js';

const inventory = () => {
  const a = answers();
  return buildInventory({ list: a.list, values: a.values, caract: a.caract });
};

/** The peripheral of the fixtures with this name, mapped. */
function mapped(name, changes = {}) {
  const p = inventory().peripherals.find((x) => x.name === name);
  assert.ok(p, name);
  const peripheral = { ...p, ...changes };
  const m = mapPeripheral(peripheral);
  const reader = (key) => m.readers.find((r) => r.key === key);
  return {
    p: peripheral,
    keys: m.features.map((f) => f.key),
    feature: (key) => m.features.find((f) => f.key === key),
    read: (key, record) => reader(key).read({ ...peripheral.record, ...record }),
    write: (key, value) => m.writers[key].write(value),
    reader,
    writers: m.writers,
  };
}

/** A made-up peripheral: a float or a list with its values. */
const peripheral = (fields) => ({
  id: '9',
  name: 'Test',
  usageId: '0',
  usageName: '',
  valueType: 'float',
  unit: '',
  hasBattery: false,
  values: [],
  record: {},
  ...fields,
});

test('num reads the numbers of the box, nothing else', () => {
  assert.equal(num('21.5'), 21.5);
  assert.equal(num('19,5'), 19.5);
  assert.equal(num('-2'), -2);
  assert.equal(num(12), 12);
  assert.equal(num('unreachable'), undefined);
  assert.equal(num(''), undefined);
  assert.equal(num('10 %'), undefined);
});

test('a lamp: on/off from 0 / 100, the mains-cut values ignored', () => {
  const lamp = mapped('Lampe salon');
  assert.deepEqual(lamp.keys, ['binary']);
  assert.equal(lamp.feature('binary').category, 'light');
  assert.equal(lamp.feature('binary').has_feedback, true);
  assert.deepEqual(lamp.read('binary', { last_value: '100' }), { state: 1 });
  assert.deepEqual(lamp.read('binary', { last_value: '0' }), { state: 0 });
  assert.equal(lamp.read('binary', { last_value: '-2' }), null, 'mains cut: not a state');
  assert.equal(lamp.read('binary', { last_value: 'unreachable' }), null);
  assert.equal(lamp.write('binary', 1), '100');
  assert.equal(lamp.write('binary', 0), '0');
});

test('a dimmer: the level written is the nearest value of its list', () => {
  const dimmer = mapped('Variateur cuisine');
  assert.deepEqual(dimmer.keys, ['binary', 'brightness']);
  assert.deepEqual(dimmer.read('brightness', { last_value: '30' }), { state: 30 });
  assert.equal(dimmer.write('brightness', 42), '40');
  assert.equal(dimmer.write('brightness', 96), '100');
  assert.equal(dimmer.write('brightness', 3), '10', 'a low level stays on');
  assert.equal(dimmer.write('brightness', 0), '0');
  // A float lamp takes any level.
  const float = mapPeripheral(peripheral({ usageId: '1' }));
  assert.deepEqual(
    float.features.map((f) => f.key),
    ['binary', 'brightness'],
  );
  assert.equal(float.writers.brightness.write(42.4), '42');
});

test('a plug is a switch, its child channel a power meter', () => {
  const plug = mapped('Prise TV');
  assert.deepEqual(plug.keys, ['binary']);
  assert.equal(plug.feature('binary').category, 'switch');
  const meter = mapped('Prise TV consommation');
  assert.deepEqual(meter.keys, ['power']);
  assert.equal(meter.feature('power').unit, 'watt');
  assert.equal(meter.feature('power').read_only, true);
  assert.deepEqual(meter.read('power', { last_value: '1250.5' }), { state: 1250.5 });
});

test('a shutter with levels: open, close, a position; no stop in its list', () => {
  const shutter = mapped('Volet salon');
  assert.deepEqual(shutter.keys, ['state', 'position']);
  assert.deepEqual(shutter.read('state', { last_value: '100', last_value_text: 'Ouvert' }), {
    state: COVER_STATE.OPEN,
  });
  assert.deepEqual(shutter.read('state', { last_value: '0', last_value_text: 'Fermé' }), {
    state: COVER_STATE.CLOSE,
  });
  assert.deepEqual(shutter.read('state', { last_value: '40', last_value_text: '40 %' }), {
    state: COVER_STATE.STOP,
  });
  assert.deepEqual(shutter.read('position', { last_value: '40' }), { state: 40 });
  assert.equal(shutter.write('state', COVER_STATE.OPEN), '100');
  assert.equal(shutter.write('state', COVER_STATE.CLOSE), '0');
  assert.throws(() => shutter.write('state', COVER_STATE.STOP), /cannot be stopped/);
  assert.equal(shutter.write('position', 33), '30');
});

test('a shutter with a stop order (MY): state only', () => {
  const shutter = mapped('Volet chambre');
  assert.deepEqual(shutter.keys, ['state']);
  assert.equal(shutter.write('state', COVER_STATE.STOP), 'MY');
  assert.deepEqual(shutter.read('state', { last_value: 'MY', last_value_text: '' }), {
    state: COVER_STATE.STOP,
  });
});

test('pilot wire heating: the orders by their names, written as their values', () => {
  const heater = mapped('Radiateur chambre');
  assert.deepEqual(heater.keys, ['pilot-wire']);
  assert.equal(heater.feature('pilot-wire').type, 'pilot-wire-mode');
  assert.deepEqual(heater.read('pilot-wire', { last_value: '25', last_value_text: 'Eco' }), {
    state: PILOT_WIRE_MODE.ECO,
  });
  assert.deepEqual(heater.read('pilot-wire', { last_value: '45', last_value_text: '' }), {
    state: PILOT_WIRE_MODE.COMFORT_1,
  });
  assert.equal(heater.write('pilot-wire', PILOT_WIRE_MODE.FROST_PROTECTION), '15');
  assert.equal(heater.write('pilot-wire', PILOT_WIRE_MODE.COMFORT_2), '35');
  assert.equal(heater.write('pilot-wire', PILOT_WIRE_MODE.OFF), '0');
  // A 4-order module has no comfort -1 / -2.
  const four = peripheral({
    usageId: '4',
    valueType: 'list',
    values: ['Arrêt', 'Hors-gel', 'Éco', 'Confort'].map((d, i) => ({
      value: String(i),
      description: d,
    })),
  });
  assert.ok(isPilotWire(four));
  assert.throws(() => mapPeripheral(four).writers['pilot-wire'].write(3), /no such pilot wire/);
  assert.equal(pilotWireMode('Confort-1'), PILOT_WIRE_MODE.COMFORT_1);
  assert.equal(pilotWireMode('Comfort -2'), PILOT_WIRE_MODE.COMFORT_2);
  assert.equal(pilotWireMode('Délestage'), PILOT_WIRE_MODE.OFF);
  assert.equal(pilotWireMode('Frost protection'), PILOT_WIRE_MODE.FROST_PROTECTION);
  // An on/off heating relay is a switch.
  const relay = peripheral({
    usageId: '4',
    valueType: 'list',
    values: [
      { value: '0', description: 'Off' },
      { value: '100', description: 'On' },
    ],
  });
  assert.deepEqual(
    mapPeripheral(relay).features.map((f) => [f.key, f.category]),
    [['binary', 'switch']],
  );
});

test('setpoints: a float, or a list of temperatures (whatever its usage)', () => {
  const setpoint = mapped('Consigne salon');
  assert.deepEqual(setpoint.keys, ['setpoint']);
  assert.deepEqual([setpoint.feature('setpoint').min, setpoint.feature('setpoint').max], [5, 30]);
  assert.equal(setpoint.write('setpoint', 20.55), '20.6');
  const thermostat = mapped('Thermostat bureau');
  assert.deepEqual(thermostat.keys, ['setpoint']);
  assert.deepEqual(
    [thermostat.feature('setpoint').min, thermostat.feature('setpoint').max],
    [16, 22],
  );
  assert.equal(thermostat.write('setpoint', 20.3), '20.5');
  assert.equal(thermostat.write('setpoint', 25), '22');
});

test('sensors: motion, opening (Gladys 1 = closed), smoke, flood', () => {
  const motion = mapped('Détecteur entrée');
  assert.deepEqual(motion.keys, ['motion', 'battery']);
  assert.deepEqual(motion.read('motion', { last_value: '100', last_value_text: 'Mouvement' }), {
    state: 1,
  });
  assert.deepEqual(motion.read('motion', { last_value: '0', last_value_text: 'Aucun mouvement' }), {
    state: 0,
  });
  assert.deepEqual(motion.read('motion', { last_value: '50', last_value_text: 'Vibration' }), {
    state: 1,
  });
  const door = mapped("Porte d'entrée");
  assert.deepEqual(door.read('opening', { last_value: '0', last_value_text: 'Fermé' }), {
    state: OPENING_SENSOR_STATE.CLOSE,
  });
  assert.deepEqual(door.read('opening', { last_value: '100', last_value_text: 'Ouvert' }), {
    state: OPENING_SENSOR_STATE.OPEN,
  });
  const smoke = mapped('Détecteur fumée');
  assert.deepEqual(smoke.read('smoke', { last_value: '100', last_value_text: 'Alarme' }), {
    state: 1,
  });
  const flood = mapped('Détecteur inondation');
  assert.deepEqual(flood.keys, ['leak', 'battery']);
  assert.deepEqual(flood.read('leak', { last_value: '0', last_value_text: 'Sec' }), { state: 0 });
  assert.equal(flood.read('battery', { battery: '255' }), null, '255: low, not a level');
  assert.equal(Object.keys(flood.writers).length, 0);
});

test('a remote: every new value is a press, named by its description', () => {
  const remote = mapped('Télécommande salon');
  assert.deepEqual(remote.keys, ['button', 'battery']);
  assert.equal(remote.reader('button').event, true);
  assert.deepEqual(remote.read('button', { last_value: '2', last_value_text: 'Double appui' }), {
    state: BUTTON_STATUS.DOUBLE_CLICK,
  });
  assert.equal(buttonStatus('Simple appui'), BUTTON_STATUS.CLICK);
  assert.equal(buttonStatus('Appui long'), BUTTON_STATUS.LONG_CLICK);
  assert.equal(buttonStatus('Relâchement appui long'), BUTTON_STATUS.LONG_CLICK_RELEASE);
  assert.equal(buttonStatus('Triple appui'), BUTTON_STATUS.TRIPLE);
  assert.equal(buttonStatus('Off'), BUTTON_STATUS.OFF);
  assert.equal(buttonStatus('On'), BUTTON_STATUS.ON);
  assert.equal(buttonStatus(''), BUTTON_STATUS.CLICK);
});

test('measurements follow their unit, the usage when there is none', () => {
  const kind = (fields) => measureOf(peripheral(fields));
  assert.deepEqual(kind({ unit: '°C' }), ['temperature', 'celsius']);
  assert.deepEqual(kind({ usageId: '7', unit: '' }), ['temperature', 'celsius']);
  // eedomus users keep the "Température" usage for any value: the unit wins.
  assert.deepEqual(kind({ usageId: '7', unit: 'W' }), ['power', 'watt']);
  assert.deepEqual(kind({ usageId: '7', unit: 'Wh' }), ['energy', 'watt-hour']);
  assert.deepEqual(kind({ usageId: '7', unit: 'kVA' }), ['value', 'kilovolt-ampere']);
  assert.deepEqual(kind({ usageId: '7', unit: 'dB' }), ['noise', 'decibel']);
  assert.deepEqual(kind({ usageId: '22', unit: '%' }), ['humidity', 'percent']);
  assert.deepEqual(kind({ usageId: '23', unit: '%', name: 'CPU Box' }), ['value', 'percent']);
  assert.deepEqual(kind({ usageId: '23', unit: 'Ko' }), ['value', 'kilobyte']);
  assert.deepEqual(kind({ usageId: '41', unit: 'mm' }), ['rain', 'mm']);
  assert.deepEqual(kind({ unit: 'mm' }), ['value', 'mm']);
  assert.deepEqual(kind({ unit: 'Erreur(s)' }), ['value', undefined], 'unknown unit: none');
  assert.deepEqual(kind({ unit: ' ' }), ['value', undefined]);
  const tag = mapped('Station extérieure batterie');
  assert.deepEqual(tag.keys, ['battery']);
  assert.deepEqual(mapped('CO2 salon').keys, ['co2']);
  assert.deepEqual(mapped('Pluie').keys, ['rain']);
  assert.deepEqual(mapped("Compteur d'eau").keys, ['volume']);
});

test('the other lists: a command for actuator usages, a text for the rest', () => {
  const alarm = mapped('Mode alarme');
  assert.deepEqual(alarm.keys, ['selector']);
  assert.deepEqual(
    alarm.feature('selector').supported_options.map((o) => [o.value, o.label]),
    [
      ['0', 'Désactivée'],
      ['1', 'Partielle'],
      ['2', 'Totale'],
    ],
  );
  assert.deepEqual(alarm.read('selector', { last_value: '2' }), { text: '2' });
  assert.equal(alarm.write('selector', '1'), '1');
  assert.equal(alarm.write('selector', 'Totale'), '2');
  assert.throws(() => alarm.write('selector', '7'), /not a value/);
  const phase = mapped('Phase de la journée');
  assert.deepEqual(phase.keys, ['text']);
  assert.deepEqual(phase.read('text', { last_value: '2', last_value_text: '' }), {
    text: 'Soirée',
  });
  assert.deepEqual(mapped('Messages box').read('text', {}), { text: 'Tout va bien' });
});

test('nothing to offer: an HTML widget, an unknown value type', () => {
  assert.equal(mapped('Widget météo').keys.length, 0);
  assert.equal(mapPeripheral(peripheral({ valueType: 'xml' })).features.length, 0);
});

test('the battery of a module sits on its main channel only', () => {
  assert.ok(mapped('Détecteur entrée').keys.includes('battery'));
  assert.ok(!mapped('Détecteur entrée température').keys.includes('battery'));
});
