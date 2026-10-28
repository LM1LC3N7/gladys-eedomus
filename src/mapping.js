// -----------------------------------------------------------------------------
// One eedomus peripheral -> Gladys features, readers and writers (pure).
//
// A peripheral of periph.list says what it is used for (`usage_id`, chosen in
// eedomus: lamp, electrical appliance, shutter, temperature…), how its value
// is typed (`value_type`: list, float or string) and its unit. A "list"
// peripheral only takes the values of its periph.value_list ("0" Off, "100"
// On, "50" 50 %…), each with a description. The values come from
// periph.caract: `last_value`, `last_value_text` (the description of the
// value), `last_value_change`, `battery`.
//
// `mapPeripheral` returns:
//   features  the Gladys features (key relative to the device, part of the
//             external id: never change a key),
//   readers   [{ key, read(record) -> { state } | { text } | null, event }],
//             an `event` reader is a press: read only when the value changed
//             (last_value_change), and sent even when the value is the same,
//   writers   { [key]: { write(value) -> string, text } } (the value of
//             periph.value: always one of the allowed values of a list).
// Value conventions: the Gladys side follows the enums of
// server/utils/constants.js in the Gladys core (copied here, the SDK does not
// export them); the eedomus side its value lists (0 = off / closed, 100 = on /
// open, the descriptions in French or English).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { LIMITS } from './constants.js';

// Value enums of the Gladys core (server/utils/constants.js), not in the SDK.
export const COVER_STATE = { STOP: 0, OPEN: 1, CLOSE: -1 };
export const OPENING_SENSOR_STATE = { OPEN: 0, CLOSE: 1 };
export const PILOT_WIRE_MODE = {
  OFF: 0,
  FROST_PROTECTION: 1,
  ECO: 2,
  COMFORT_1: 3,
  COMFORT_2: 4,
  COMFORT: 5,
};
export const BUTTON_STATUS = {
  CLICK: 1,
  DOUBLE_CLICK: 2,
  LONG_CLICK_RELEASE: 4,
  LONG_CLICK: 6,
  ON: 7,
  OFF: 8,
  TRIPLE: 18,
  QUADRUPLE: 19,
  RELEASE: 20,
};

/**
 * The eedomus usages (`usage_id`) the mapping knows: the usage list of the
 * eedomus store documentation, and the ones seen on real boxes.
 */
export const USAGE = {
  OTHER: '0',
  LIGHT: '1',
  APPLIANCE: '2',
  HEATING: '4',
  TEMPERATURE: '7',
  OPENING: '10',
  SETPOINT: '15',
  ALARM_ARMING: '16',
  PRESENCE: '21',
  HUMIDITY: '22',
  LUMINOSITY: '24',
  WATER_METER: '25',
  ELECTRICITY_METER: '26',
  SMOKE: '27',
  WIND: '29',
  UV: '31',
  PRESSURE: '32',
  FLOOD: '36',
  MOTION: '37',
  RAIN: '41',
  OPENING_GROUP: '42',
  OTHER_ACTUATOR: '43',
  GAS_METER: '45',
  SHUTTER: '48',
  REMOTE: '52',
  SHUTTERS: '109',
  THERMOSTAT_MODE: '115',
};

/** Usages of an actuator: their lists are offered as commands. */
const COMMAND_USAGES = new Set([USAGE.ALARM_ARMING, USAGE.OTHER_ACTUATOR, USAGE.THERMOSTAT_MODE]);
const SHUTTER_USAGES = new Set([USAGE.SHUTTER, USAGE.SHUTTERS, USAGE.OPENING_GROUP]);

// --- Values ----------------------------------------------------------------------

/** A description, lower case and without accents ("Fermé" -> "ferme"). */
export const norm = (raw) =>
  String(raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** A number of the box ("21.5", "-2", "19,5", 12), or undefined ("unreachable", ""). */
export function num(raw) {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : undefined;
  }
  const text = String(raw ?? '').trim();
  if (!/^[-+]?\d+(?:[.,]\d+)?(?:e[-+]?\d+)?$/i.test(text)) {
    return undefined;
  }
  const n = Number(text.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const cut = (text, max = LIMITS.text) => {
  const s = String(text ?? '');
  return s.length > max ? s.slice(0, max) : s;
};

/** The description of the current value: last_value_text, else its list entry. */
export function currentText(p, r) {
  const shown = String(r?.last_value_text ?? '').trim();
  if (shown !== '') {
    return shown;
  }
  const value = String(r?.last_value ?? '');
  return p.values.find((v) => v.value === value)?.description ?? '';
}

/** The list values that are numbers, with their number. */
const numbered = (p) =>
  p.values.map((v) => ({ ...v, n: num(v.value) })).filter((v) => v.n !== undefined);

/** The allowed value nearest to a number (within [min, max]), or undefined. */
function nearest(p, wanted, min = -Infinity, max = Infinity) {
  let best;
  for (const v of numbered(p)) {
    if (v.n < min || v.n > max) {
      continue;
    }
    if (!best || Math.abs(v.n - wanted) < Math.abs(best.n - wanted)) {
      best = v;
    }
  }
  return best?.value;
}

const byWords = (p, words) => p.values.find((v) => words.test(norm(v.description)))?.value;

const ON_WORDS = /^(on|marche|allume|allumer|actif|active|activee)$/;
const OFF_WORDS = /^(off|arret|eteint|eteindre|inactif|desactive|desactivee)$/;
const OPEN_WORDS = /ouvr|ouver|open|^haut|^mont|^up$/;
const CLOSE_WORDS = /ferm|clos|^bas$|^descen|^down$/;
const STOP_WORDS = /stop|^my\b|^arret/;

/** The "on" value of a list: 100, else "On", else its largest number. */
function onValue(p) {
  const values = numbered(p);
  return (
    values.find((v) => v.n === 100)?.value ??
    byWords(p, ON_WORDS) ??
    values.filter((v) => v.n > 0).sort((a, b) => b.n - a.n)[0]?.value
  );
}

/** The "off" value of a list: 0, else "Off". */
const offValue = (p) => numbered(p).find((v) => v.n === 0)?.value ?? byWords(p, OFF_WORDS);

/** A list with levels between off and on (a dimmer, a shutter with positions). */
const hasLevels = (p) => numbered(p).some((v) => v.n > 0 && v.n < 100);

/** Pilot wire orders by their eedomus description (French or English). */
export function pilotWireMode(description) {
  const text = norm(description);
  if (/hors.?gel|frost|anti.?gel/.test(text)) {
    return PILOT_WIRE_MODE.FROST_PROTECTION;
  }
  if (/^eco|economi/.test(text)) {
    return PILOT_WIRE_MODE.ECO;
  }
  if (/conf?ort|comfort/.test(text)) {
    if (/-\s*2|moins\s*2/.test(text)) {
      return PILOT_WIRE_MODE.COMFORT_2;
    }
    if (/-\s*1|moins\s*1/.test(text)) {
      return PILOT_WIRE_MODE.COMFORT_1;
    }
    return PILOT_WIRE_MODE.COMFORT;
  }
  if (/^(arret|off|stop|delestage|eteint)/.test(text)) {
    return PILOT_WIRE_MODE.OFF;
  }
  return undefined;
}

/** A list of pilot wire orders: eco, plus frost protection or comfort, three modes at least. */
export function isPilotWire(p) {
  const modes = new Set(p.values.map((v) => pilotWireMode(v.description)));
  modes.delete(undefined);
  return (
    modes.size >= 3 &&
    modes.has(PILOT_WIRE_MODE.ECO) &&
    (modes.has(PILOT_WIRE_MODE.FROST_PROTECTION) || modes.has(PILOT_WIRE_MODE.COMFORT))
  );
}

/** A list of temperatures ("19" "19°C", "19.5" "19.5°C"…): a setpoint. */
export function isTemperatureList(p) {
  const values = numbered(p);
  return (
    values.length >= 3 &&
    values.every((v) => /°|\bdeg/i.test(v.description) && v.n > -50 && v.n < 100)
  );
}

/** The press a description names (Gladys BUTTON_STATUS). */
export function buttonStatus(description) {
  const text = norm(description);
  if (/quadruple/.test(text)) {
    return BUTTON_STATUS.QUADRUPLE;
  }
  if (/triple/.test(text)) {
    return BUTTON_STATUS.TRIPLE;
  }
  if (/double/.test(text)) {
    return BUTTON_STATUS.DOUBLE_CLICK;
  }
  const long = /long|maintenu|prolonge|hold/.test(text);
  if (/relach|release/.test(text)) {
    return long ? BUTTON_STATUS.LONG_CLICK_RELEASE : BUTTON_STATUS.RELEASE;
  }
  if (long) {
    return BUTTON_STATUS.LONG_CLICK;
  }
  if (/^off\b|eteint/.test(text)) {
    return BUTTON_STATUS.OFF;
  }
  if (/^on\b|allum/.test(text)) {
    return BUTTON_STATUS.ON;
  }
  return BUTTON_STATUS.CLICK;
}

/** Descriptions of a quiet state: no motion, no smoke, no water, OK. */
const QUIET_WORDS =
  /^(ok|normal|aucun|aucune|pas |no |non |rien|absen|repos|fin |sec$|dry|clear|calme|inacti|off$|ras$)/;

/** An alarm-like sensor: 1 when something is detected. */
function detected(p, r) {
  const n = num(r.last_value);
  if (n === undefined || n < 0) {
    return undefined;
  }
  if (n === 0 || QUIET_WORDS.test(norm(currentText(p, r)))) {
    return 0;
  }
  return 1;
}

// --- Units -----------------------------------------------------------------------

/** What a measurement is, by its eedomus unit (lower case). */
const UNITS = {
  '°c': ['temperature', U.CELSIUS],
  c: ['temperature', U.CELSIUS],
  '°f': ['temperature', U.FAHRENHEIT],
  '%': ['percent', U.PERCENT],
  lux: ['lux', U.LUX],
  lx: ['lux', U.LUX],
  w: ['power', U.WATT],
  watt: ['power', U.WATT],
  watts: ['power', U.WATT],
  kw: ['power', U.KILOWATT],
  wh: ['energy', U.WATT_HOUR],
  kwh: ['energy', U.KILOWATT_HOUR],
  v: ['voltage', U.VOLT],
  a: ['current', U.AMPERE],
  ma: ['current', U.MILLI_AMPERE],
  hpa: ['pressure', U.HECTO_PASCAL],
  mbar: ['pressure', U.MILLIBAR],
  bar: ['pressure', U.BAR],
  pa: ['pressure', U.PASCAL],
  kpa: ['pressure', U.KILO_PASCAL],
  ppm: ['co2', U.PPM],
  db: ['noise', U.DECIBEL],
  dba: ['noise', U.DECIBEL],
  'mm/h': ['rain', U.MILLIMETER_PER_HOUR],
  'mm/j': ['rain', U.MILLIMETER_PER_DAY],
  'mm/jour': ['rain', U.MILLIMETER_PER_DAY],
  'mm/d': ['rain', U.MILLIMETER_PER_DAY],
  'mm/24h': ['rain', U.MILLIMETER_PER_DAY],
  mm: ['millimeter', U.MM],
  'km/h': ['wind', U.KILOMETER_PER_HOUR],
  'm/s': ['wind', U.METER_PER_SECOND],
  m3: ['volume', U.CUBIC_METER],
  'm³': ['volume', U.CUBIC_METER],
  l: ['volume', U.LITER],
  litre: ['volume', U.LITER],
  litres: ['volume', U.LITER],
  uv: ['uv', U.UV_INDEX],
  kva: ['value', U.KILOVOLT_AMPERE],
  va: ['value', U.VOLT_AMPERE],
  ko: ['value', U.KILOBYTE],
  kb: ['value', U.KILOBYTE],
  mo: ['value', U.MEGABYTE],
  mb: ['value', U.MEGABYTE],
  go: ['value', U.GIGABYTE],
  gb: ['value', U.GIGABYTE],
  '°': ['value', U.DEGREE],
  '€': ['value', U.EURO],
  eur: ['value', U.EURO],
  ms: ['value', U.MILLISECONDS],
  s: ['value', U.SECONDS],
  sec: ['value', U.SECONDS],
  min: ['value', U.MINUTES],
  h: ['value', U.HOURS],
  ppb: ['value', U.PPB],
  'µg/m3': ['value', U.MICROGRAM_PER_CUBIC_METER],
  'µg/m³': ['value', U.MICROGRAM_PER_CUBIC_METER],
};

/** The kind and the Gladys unit of an eedomus unit; undefined for an unknown unit. */
export function unitOf(unit) {
  return UNITS[
    String(unit ?? '')
      .trim()
      .toLowerCase()
  ];
}

/** Measurement specs by kind: [feature key, category, type, min, max]. */
const MEASURES = {
  temperature: ['temperature', C.TEMPERATURE_SENSOR, T.SENSOR.DECIMAL, -100, 200],
  humidity: ['humidity', C.HUMIDITY_SENSOR, T.SENSOR.DECIMAL, 0, 100],
  lux: ['lux', C.LIGHT_SENSOR, T.SENSOR.DECIMAL, 0, 200_000],
  power: ['power', C.ENERGY_SENSOR, T.ENERGY_SENSOR.POWER, -1e6, 1e6],
  energy: ['energy', C.ENERGY_SENSOR, T.ENERGY_SENSOR.ENERGY, 0, 1e12],
  voltage: ['voltage', C.ENERGY_SENSOR, T.ENERGY_SENSOR.VOLTAGE, 0, 100_000],
  current: ['current', C.ENERGY_SENSOR, T.ENERGY_SENSOR.CURRENT, 0, 100_000],
  pressure: ['pressure', C.PRESSURE_SENSOR, T.SENSOR.DECIMAL, 0, 100_000],
  co2: ['co2', C.CO2_SENSOR, T.SENSOR.DECIMAL, 0, 100_000],
  noise: ['noise', C.NOISE_SENSOR, T.SENSOR.DECIMAL, 0, 200],
  rain: ['rain', C.PRECIPITATION_SENSOR, T.PRECIPITATION_SENSOR.DECIMAL, 0, 100_000],
  wind: ['wind', C.SPEED_SENSOR, T.SPEED_SENSOR.DECIMAL, 0, 1000],
  volume: ['volume', C.VOLUME_SENSOR, T.SENSOR.DECIMAL, 0, 1e12],
  uv: ['uv', C.UV_SENSOR, T.UV_SENSOR.INTEGER, 0, 20],
  battery: ['battery', C.BATTERY, T.BATTERY.INTEGER, 0, 100],
  value: ['value', C.UNKNOWN, T.UNKNOWN.UNKNOWN, -1e12, 1e12],
};

/** What a numeric peripheral measures: its unit first, its usage when it has none. */
export function measureOf(p) {
  const known = unitOf(p.unit);
  const usage = p.usageId;
  if (!known) {
    // No unit, or one Gladys does not know (it would refuse the whole list).
    const byUsage = {
      [USAGE.TEMPERATURE]: ['temperature', U.CELSIUS],
      [USAGE.HUMIDITY]: ['humidity', U.PERCENT],
      [USAGE.LUMINOSITY]: ['lux', U.LUX],
      [USAGE.UV]: ['uv', U.UV_INDEX],
    }[usage];
    return byUsage ?? ['value', undefined];
  }
  const [kind, unit] = known;
  if (kind === 'percent') {
    if (usage === USAGE.HUMIDITY || /humidi/.test(norm(p.name))) {
      return ['humidity', unit];
    }
    return /batter/.test(norm(p.name)) ? ['battery', unit] : ['value', unit];
  }
  if (kind === 'millimeter') {
    return usage === USAGE.RAIN ? ['rain', unit] : ['value', unit];
  }
  if (kind === 'co2' && /\b(cov|voc)\b/.test(norm(p.name))) {
    return ['value', unit];
  }
  return [kind, unit];
}

// --- Labels -----------------------------------------------------------------------

/** Names of the secondary features (eedomus is a French box: French by default). */
const LABELS = {
  brightness: 'luminosité',
  position: 'position',
  battery: 'batterie',
};

// --- The peripheral ---------------------------------------------------------------

/**
 * The options of a list of values, as the Gladys core accepts them. It refuses the
 * WHOLE publication for one option with a blank label, a blank or padded value or a
 * value seen twice, and all of it comes from the box: so an option without a usable
 * value, or repeated, is left out, and one without a description is labelled with its
 * value.
 */
export function selectOptions(values) {
  const seen = new Set();
  const options = [];
  for (const v of values) {
    const value = String(v.value);
    if (value === '' || value !== value.trim() || seen.has(value)) {
      continue;
    }
    seen.add(value);
    options.push({
      value,
      label: cut(v.description, 100).trim() || value,
      sort_order: options.length,
    });
  }
  return options.slice(0, LIMITS.options);
}

class PeripheralMapper {
  /** @param {object} p one peripheral of src/inventory.js */
  constructor(p) {
    this.p = p;
    this.name = p.name;
    this.features = [];
    this.readers = [];
    this.writers = {};
  }

  label(key) {
    return `${this.name} – ${LABELS[key]}`;
  }

  /**
   * One feature.
   * @param {string} key part of the external id: never change it
   * @param {object} spec category, type, unit, min, max, supported_options
   * @param {{ read?: Function, write?: Function, text?: boolean, event?: boolean }} io
   */
  add(key, name, spec, { read, write, text = false, event = false } = {}) {
    if (this.features.some((f) => f.key === key)) {
      return;
    }
    const feature = {
      key,
      name: cut(name, 100),
      category: spec.category,
      type: spec.type,
      min: spec.min ?? 0,
      max: spec.max ?? 1,
      read_only: !write,
      // Feedback: the box reports the new value in periph.caract.
      has_feedback: Boolean(write && read),
      keep_history: !text,
    };
    if (spec.unit) {
      feature.unit = spec.unit;
    }
    if (spec.supported_options) {
      feature.supported_options = spec.supported_options;
    }
    this.features.push(feature);
    if (read) {
      this.readers.push({ key, read, event });
    }
    if (write) {
      this.writers[key] = { write, text };
    }
  }

  isList() {
    return this.p.valueType === 'list' && this.p.values.length > 0;
  }

  // --- Actuators ----------------------------------------------------------------------

  /** On/off of a lamp, a plug, a heating relay. */
  onOff(category, type) {
    const p = this.p;
    const list = this.isList();
    this.add(
      'binary',
      this.name,
      { category, type, min: 0, max: 1 },
      {
        read: (r) => {
          const n = num(r.last_value);
          return n === undefined || n < 0 ? null : { state: n > 0 ? 1 : 0 };
        },
        write: (value) => {
          const on = Number(value) > 0;
          const target = list ? (on ? onValue(p) : offValue(p)) : on ? '100' : '0';
          if (target === undefined) {
            throw new Error(`${this.name} has no "${on ? 'on' : 'off'}" value in eedomus`);
          }
          return target;
        },
      },
    );
  }

  /** The level of a dimmer: 0–100, the nearest allowed value of a list. */
  level(category, type) {
    const p = this.p;
    const list = this.isList();
    this.add(
      'brightness',
      this.label('brightness'),
      { category, type, min: 0, max: 100, unit: U.PERCENT },
      {
        read: (r) => {
          const n = num(r.last_value);
          return n === undefined || n < 0 ? null : { state: clamp(Math.round(n), 0, 100) };
        },
        write: (value) => {
          const wanted = clamp(Math.round(Number(value) || 0), 0, 100);
          if (!list) {
            return String(wanted);
          }
          const target = wanted === 0 ? offValue(p) : nearest(p, wanted, 1, 100);
          if (target === undefined) {
            throw new Error(`${this.name} has no level near ${wanted} % in eedomus`);
          }
          return target;
        },
      },
    );
  }

  light() {
    this.onOff(C.LIGHT, T.LIGHT.BINARY);
    if (!this.isList() || hasLevels(this.p)) {
      this.level(C.LIGHT, T.LIGHT.BRIGHTNESS);
    }
  }

  appliance() {
    this.onOff(C.SWITCH, T.SWITCH.BINARY);
    if (this.isList() && hasLevels(this.p)) {
      this.level(C.SWITCH, T.SWITCH.DIMMER);
    }
  }

  /** Shutters: open / close / stop (when the list has a stop), and the position. */
  shutter() {
    const p = this.p;
    const list = this.isList();
    const stopValue = list ? byWords(p, STOP_WORDS) : undefined;
    this.add(
      'state',
      this.name,
      { category: C.SHUTTER, type: T.SHUTTER.STATE, min: -1, max: 1 },
      {
        read: (r) => {
          const text = norm(currentText(p, r));
          if (STOP_WORDS.test(text)) {
            return { state: COVER_STATE.STOP };
          }
          if (OPEN_WORDS.test(text)) {
            return { state: COVER_STATE.OPEN };
          }
          if (CLOSE_WORDS.test(text)) {
            return { state: COVER_STATE.CLOSE };
          }
          const n = num(r.last_value);
          if (n === undefined || n < 0) {
            return null;
          }
          if (n === 0) {
            return { state: COVER_STATE.CLOSE };
          }
          return { state: n >= 100 ? COVER_STATE.OPEN : COVER_STATE.STOP };
        },
        write: (value) => {
          const wanted = Number(value);
          if (wanted === COVER_STATE.STOP) {
            if (stopValue === undefined) {
              throw new Error(`${this.name} cannot be stopped from eedomus`);
            }
            return stopValue;
          }
          const open = wanted === COVER_STATE.OPEN;
          if (!list) {
            return open ? '100' : '0';
          }
          const target = open
            ? (byWords(p, OPEN_WORDS) ?? nearest(p, 100, 1, 100))
            : (byWords(p, CLOSE_WORDS) ?? offValue(p));
          if (target === undefined) {
            throw new Error(`${this.name} has no "${open ? 'open' : 'close'}" value in eedomus`);
          }
          return target;
        },
      },
    );
    if (!list || hasLevels(p)) {
      this.add(
        'position',
        this.label('position'),
        { category: C.SHUTTER, type: T.SHUTTER.POSITION, min: 0, max: 100, unit: U.PERCENT },
        {
          read: (r) => {
            const n = num(r.last_value);
            return n === undefined || n < 0 ? null : { state: clamp(Math.round(n), 0, 100) };
          },
          write: (value) => {
            const wanted = clamp(Math.round(Number(value) || 0), 0, 100);
            const target = list ? nearest(p, wanted, 0, 100) : String(wanted);
            if (target === undefined) {
              throw new Error(`${this.name} has no position near ${wanted} % in eedomus`);
            }
            return target;
          },
        },
      );
    }
  }

  /** A temperature setpoint: a float, or a list of temperatures. */
  setpoint() {
    const p = this.p;
    const list = this.isList();
    const temperatures = numbered(p).map((v) => v.n);
    const unit = unitOf(p.unit)?.[0] === 'temperature' ? unitOf(p.unit)[1] : U.CELSIUS;
    this.add(
      'setpoint',
      this.name,
      {
        category: C.THERMOSTAT,
        type: T.THERMOSTAT.TARGET_TEMPERATURE,
        min: list ? Math.min(...temperatures) : unit === U.FAHRENHEIT ? 41 : 5,
        max: list ? Math.max(...temperatures) : unit === U.FAHRENHEIT ? 86 : 30,
        unit,
      },
      {
        read: (r) => {
          const n = num(r.last_value);
          return n === undefined ? null : { state: n };
        },
        write: (value) => {
          const wanted = Number(value);
          if (!Number.isFinite(wanted)) {
            throw new Error(`${value} is not a temperature`);
          }
          return list ? nearest(p, wanted) : String(Math.round(wanted * 10) / 10);
        },
      },
    );
  }

  pilotWire() {
    const p = this.p;
    this.add(
      'pilot-wire',
      this.name,
      { category: C.HEATER, type: T.HEATER.PILOT_WIRE_MODE, min: 0, max: 5 },
      {
        read: (r) => {
          const mode = pilotWireMode(currentText(p, r));
          return mode === undefined ? null : { state: mode };
        },
        write: (value) => {
          const wanted = Number(value);
          const entry = p.values.find((v) => pilotWireMode(v.description) === wanted);
          if (!entry) {
            throw new Error(`${this.name} has no such pilot wire order in eedomus`);
          }
          return entry.value;
        },
      },
    );
  }

  /** The values of an actuator list, as a list of options. */
  selector() {
    const p = this.p;
    const options = selectOptions(p.values);
    this.add(
      'selector',
      this.name,
      { category: C.TEXT, type: T.TEXT.SELECT, min: 0, max: 0, supported_options: options },
      {
        text: true,
        read: (r) => {
          const value = String(r.last_value ?? '');
          return options.some((o) => o.value === value) ? { text: value } : null;
        },
        write: (value) => {
          const wanted = String(value).trim();
          const option = options.find((o) => o.value === wanted || o.label === wanted);
          if (!option) {
            throw new Error(`${value} is not a value of ${this.name}`);
          }
          return option.value;
        },
      },
    );
  }

  // --- Sensors -------------------------------------------------------------------------

  binarySensor(key, category, read) {
    this.add(
      key,
      this.name,
      { category, type: T.SENSOR.BINARY, min: 0, max: 1 },
      {
        read: (r) => {
          const state = read(r);
          return state === undefined ? null : { state };
        },
      },
    );
  }

  opening() {
    const p = this.p;
    // eedomus: "Fermé" / "Ouvert" (0 / 100). Gladys: OPEN 0, CLOSE 1.
    this.binarySensor('opening', C.OPENING_SENSOR, (r) => {
      const text = norm(currentText(p, r));
      if (CLOSE_WORDS.test(text)) {
        return OPENING_SENSOR_STATE.CLOSE;
      }
      if (OPEN_WORDS.test(text)) {
        return OPENING_SENSOR_STATE.OPEN;
      }
      const n = num(r.last_value);
      if (n === undefined || n < 0) {
        return undefined;
      }
      return n === 0 ? OPENING_SENSOR_STATE.CLOSE : OPENING_SENSOR_STATE.OPEN;
    });
  }

  /** A remote or a wall switch: every new value is a press (an event). */
  button() {
    const p = this.p;
    this.add(
      'button',
      this.name,
      { category: C.BUTTON, type: T.BUTTON.CLICK, min: 0, max: 100 },
      {
        read: (r) => {
          if (String(r.last_value ?? '') === '') {
            return null;
          }
          return { state: buttonStatus(currentText(p, r)) };
        },
        event: true,
      },
    );
  }

  /** A number with its unit; the category follows the unit. */
  measure() {
    const [kind, unit] = measureOf(this.p);
    const [key, category, type, min, max] = MEASURES[kind];
    const spec = { category, type, min, max };
    if (unit) {
      spec.unit = unit;
    }
    this.add(key, this.name, spec, {
      read: (r) => {
        const n = num(r.last_value);
        if (n === undefined) {
          return null;
        }
        return { state: type === T.SENSOR.INTEGER || kind === 'uv' ? Math.round(n) : n };
      },
    });
  }

  text() {
    const p = this.p;
    this.add(
      'text',
      this.name,
      { category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0 },
      {
        text: true,
        read: (r) => {
          if (r.last_value === undefined || r.last_value === null) {
            return null;
          }
          const shown = p.valueType === 'list' ? currentText(p, r) : '';
          return { text: cut(shown || String(r.last_value)) };
        },
      },
    );
  }

  battery() {
    this.add(
      'battery',
      this.label('battery'),
      { category: C.BATTERY, type: T.BATTERY.INTEGER, min: 0, max: 100, unit: U.PERCENT },
      {
        read: (r) => {
          const n = num(r.battery);
          // 255: the "low battery" of the API, not a level.
          return n === undefined || n < 0 || n > 100 ? null : { state: Math.round(n) };
        },
      },
    );
  }

  // --- Dispatch -------------------------------------------------------------------------

  map() {
    const p = this.p;
    const usage = p.usageId;
    const list = this.isList();
    if (p.valueType === 'string') {
      this.text();
    } else if (p.valueType === 'list' || p.valueType === 'float') {
      if (list && isPilotWire(p)) {
        this.pilotWire();
      } else if (usage === USAGE.SETPOINT || (list && isTemperatureList(p))) {
        this.setpoint();
      } else if (usage === USAGE.LIGHT) {
        this.light();
      } else if (usage === USAGE.APPLIANCE || usage === USAGE.HEATING) {
        this.appliance();
      } else if (SHUTTER_USAGES.has(usage)) {
        this.shutter();
      } else if (usage === USAGE.REMOTE) {
        this.button();
      } else if (usage === USAGE.MOTION || usage === USAGE.PRESENCE) {
        this.binarySensor('motion', C.MOTION_SENSOR, (r) => detected(p, r));
      } else if (usage === USAGE.SMOKE) {
        this.binarySensor('smoke', C.SMOKE_SENSOR, (r) => detected(p, r));
      } else if (usage === USAGE.FLOOD) {
        this.binarySensor('leak', C.LEAK_SENSOR, (r) => detected(p, r));
      } else if (usage === USAGE.OPENING) {
        this.opening();
      } else if (list && COMMAND_USAGES.has(usage)) {
        this.selector();
      } else if (list) {
        this.text();
      } else {
        this.measure();
      }
    }
    // A module's battery is repeated on each of its channels: on the main one only.
    if (p.hasBattery && !p.parentId && this.features.length > 0) {
      this.battery();
    }
    return { features: this.features, readers: this.readers, writers: this.writers };
  }
}

/**
 * @param {object} peripheral one peripheral of buildInventory (src/inventory.js)
 * @returns {{ features: object[], readers: Array<{ key: string, read: Function, event: boolean }>, writers: Record<string, { write: Function, text: boolean }> }}
 */
export function mapPeripheral(peripheral) {
  return new PeripheralMapper(peripheral).map();
}
