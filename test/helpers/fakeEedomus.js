// A fake eedomus box behind the real connection of src/eedomus.js: the
// peripherals of the fixtures served by a local and a cloud client, the
// commands run with their effect, failures per way, the eedomus error codes.

import { ERROR_CODES, EedomusError, createConnection } from '../../src/eedomus.js';
import { CLOCK, answers, stamp } from '../fixtures/eedomus.js';

export const API = { api_user: 'gladys', api_secret: 'S3cr3t-api-key' };

export function fakeEedomus({ user = API.api_user, secret = API.api_secret } = {}) {
  const start = answers();
  const box = {
    ...start,
    /** periph_id -> its periph.caract record */
    records: new Map(start.caract.map((r) => [r.periph_id, r])),
    /** the box time (seconds) */
    clock: CLOCK,
    /** every call: { transport, kind, action, params } */
    calls: [],
    /** the periph.value commands run */
    executed: [],
    /** transport -> the error every call of that way throws */
    down: {},
    /** action -> the error that action throws */
    failOn: {},
    connections: [],
  };

  const find = (id) => box.list.find((p) => p.periph_id === String(id));
  const allowed = (id) => box.values.find((v) => v.periph_id === String(id))?.values ?? [];

  /** A peripheral changes on the box: its value, its text, its date. */
  box.emit = (id, changes = {}) => {
    box.clock += 1;
    const record = box.records.get(String(id));
    Object.assign(record, changes, { last_value_change: stamp(box.clock) });
    return record;
  };

  /** Removes a peripheral from the box (deleted in eedomus). */
  box.remove = (id) => {
    box.list = box.list.filter((p) => p.periph_id !== String(id));
    box.records.delete(String(id));
  };

  box.callsOf = (action, transport) =>
    box.calls.filter((c) => c.action === action && (!transport || c.transport === transport));

  function caract(periphId) {
    if (periphId === 'all') {
      return [...box.records.values()].map((r) => structuredClone(r));
    }
    const ids = String(periphId).split(',');
    for (const id of ids) {
      if (!box.records.has(id)) {
        throw new EedomusError('api', `Device does not exist ${id}`, {
          code: ERROR_CODES.UNKNOWN_DEVICE,
        });
      }
    }
    if (ids.length === 1) {
      // One peripheral: one object, without its id (API documentation).
      const { periph_id: _id, ...record } = structuredClone(box.records.get(ids[0]));
      return record;
    }
    return ids.map((id) => structuredClone(box.records.get(id)));
  }

  function setValue({ periph_id: id, value }) {
    const p = find(id);
    if (!p) {
      throw new EedomusError('api', `Device does not exist ${id}`, {
        code: ERROR_CODES.UNKNOWN_DEVICE,
      });
    }
    const list = allowed(id);
    const entry = list.find((v) => v.value === String(value));
    if (p.value_type === 'list' && list.length > 0 && !entry) {
      throw new EedomusError('api', `Value does not exist for this device ${value}`, {
        code: ERROR_CODES.UNKNOWN_VALUE,
      });
    }
    box.executed.push({ periph_id: String(id), value: String(value) });
    box.emit(id, { last_value: String(value), last_value_text: entry?.description ?? '' });
    return { result: '[OK]' };
  }

  function answer(kind, action, params) {
    if (box.failOn[action]) {
      throw box.failOn[action];
    }
    if (kind === 'set') {
      if (action === 'periph.value') {
        return setValue(params);
      }
    } else {
      switch (action) {
        case 'auth.test':
          return undefined;
        case 'periph.list':
          return structuredClone(box.list);
        case 'periph.value_list':
          return structuredClone(box.values);
        case 'periph.caract':
          return caract(params.periph_id);
        default:
      }
    }
    throw new EedomusError('api', `Invalid action ${action}`, { code: ERROR_CODES.INVALID_ACTION });
  }

  const client = (transport, config) => ({
    closed: false,
    async call(kind, action, params = {}) {
      box.calls.push({ transport, kind, action, params });
      if (box.down[transport]) {
        throw box.down[transport];
      }
      if (config.apiUser !== user || config.apiSecret !== secret) {
        throw new EedomusError('auth', 'Authentification error.', { code: ERROR_CODES.AUTH });
      }
      return answer(kind, action, params);
    },
    close() {
      this.closed = true;
    },
  });

  /** The connect of the app: the ways of openConnection, fake clients, the real router. */
  box.connect = (config, { now } = {}) => {
    const cloud = { transport: 'cloud', client: client('cloud', config) };
    const local = { transport: 'local', client: client('local', config) };
    let routes = [cloud];
    if (config.boxUrl) {
      routes = config.preferLocal ? [local, cloud] : [cloud, local];
    }
    const connection = createConnection({ routes, now });
    connection.config = config;
    box.connections.push(connection);
    return connection;
  };

  return box;
}

/** Lets the pending promises settle (no timer involved). */
export const settle = async (rounds = 20) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
