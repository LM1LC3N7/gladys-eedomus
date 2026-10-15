// -----------------------------------------------------------------------------
// The integration: one eedomus box, its peripherals turned into Gladys
// devices, the values read at a steady pace, and the commands sent back.
// index.js only wires the SDK handlers to it.
//
// Lifecycle: start -> open (inventory: periph.list, periph.value_list,
// periph.caract) -> every `poll_interval` seconds, read the values of the
// peripherals created in Gladys (periph.caract with their ids, comma
// separated: one request for up to 100 of them) -> on a failure, reconnect
// with a growing delay (the reconnection reads the whole inventory again: the
// values missed meanwhile come back with it). The inventory is also read
// again every 15 minutes, on Scan, and when a peripheral was renamed.
//
// Two ways to the same API: the box on the local network, or the eedomus
// cloud (src/eedomus.js createConnection). The preferred one follows the
// "Prefer the local connection" toggle of Gladys; the badges show the way in
// use, degraded while on the other one.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { ENDPOINTS, LIMITS, TIMINGS } from './constants.js';
import { buildModel, emptyModel } from './devices.js';
import {
  ERROR_CODES,
  EedomusError,
  createClient,
  createConnection,
  isTransportError,
} from './eedomus.js';
import { T } from './i18n.js';
import { buildInventory, caractRecords } from './inventory.js';
import { StatePublisher } from './publisher.js';

/**
 * The ways to the API of a configuration, the preferred one first: the box
 * (when its address is known) and the cloud, same credentials.
 */
export function openConnection(config, { now = Date.now } = {}) {
  const credentials = { apiUser: config.apiUser, apiSecret: config.apiSecret };
  const cloud = {
    transport: 'cloud',
    client: createClient({ base: ENDPOINTS.cloud, ...credentials }),
  };
  if (!config.boxUrl) {
    return createConnection({ routes: [cloud], now });
  }
  const local = {
    transport: 'local',
    client: createClient({ base: `${config.boxUrl}${ENDPOINTS.localPath}`, ...credentials }),
  };
  const routes = config.preferLocal ? [local, cloud] : [cloud, local];
  return createConnection({ routes, now });
}

export class EedomusApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'eedomus' }),
    connect = openConnection,
    now = Date.now,
    timers = globalThis,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.connect = connect;
    this.now = now;
    this.timers = timers;
    this.config = normalizeConfig();
    this.connection = null;
    this.model = emptyModel();
    this.inventory = undefined;
    /** periph_id -> name of the peripherals of the inventory (offered or not) */
    this.known = new Map();
    /** periph_id -> last periph.caract record */
    this.records = new Map();
    this.online = false;
    /** feature id -> last value read, sent when the user creates the device */
    this.lastValues = new Map();
    this.created = new Set();
    /** device id -> last badge published (JSON) */
    this.transports = new Map();
    /** the way in use when the status was last written ("local:false") */
    this.route = undefined;
    this.timer = undefined;
    this.inventoryTimer = undefined;
    this.polling = false;
    this.readingInventory = false;
    this.failures = 0;
    this.generation = 0;
    this.lastStatus = undefined;
    this.publishedDevices = undefined;
    this.warned = new Set();
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    const generation = this.generation;
    this.config = normalizeConfig(raw);
    this.refreshCreated();
    if (this.config.error) {
      await this.setStatus(false, T.configError(this.config.error));
      return;
    }
    this.connection = this.newConnection();
    // Values are read every few seconds at most: no per-sensor spacing needed.
    this.publisher.configure({ intervalSeconds: 0, throttled: new Set() });
    this.publisher.start();
    await this.setStatus(false, T.connecting);
    await this.open(generation);
  }

  stop() {
    this.generation += 1;
    this.timers.clearTimeout(this.timer);
    this.timers.clearTimeout(this.inventoryTimer);
    this.timer = undefined;
    this.inventoryTimer = undefined;
    this.publisher.stop();
    this.connection?.close?.();
    this.connection = null;
    this.online = false;
    this.polling = false;
    this.failures = 0;
    this.route = undefined;
  }

  newConnection() {
    return this.connect(this.config, { now: this.now });
  }

  current(generation) {
    return generation === this.generation;
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  warnOnce(key, message) {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.logger.warn(message);
    }
  }

  /** Runs `fn` after `ms`, unless the app was restarted or stopped meanwhile. */
  schedule(generation, ms, fn) {
    this.timers.clearTimeout(this.timer);
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      if (this.current(generation)) {
        fn().catch((err) => this.logger.error(`eedomus loop: ${err.message}`));
      }
    }, ms);
  }

  connectedStatus() {
    return T.connected({
      transport: this.connection.transport,
      fallback: this.connection.fallback,
      reason: this.connection.reason,
      host: this.config.boxHost,
      devices: this.model.devices.length,
    });
  }

  routeKey() {
    return `${this.connection.transport}:${this.connection.fallback}`;
  }

  /**
   * The way changed (fallback, or back to the preferred one): status and
   * badges follow. `refresh`: write the status anyway (the count of devices
   * may have changed).
   */
  async followRoute(generation, { refresh = false } = {}) {
    if (!this.current(generation) || !this.online) {
      return;
    }
    const key = this.routeKey();
    if (key !== this.route) {
      this.route = key;
      const why = this.connection.reason ? ` (${this.connection.reason.message})` : '';
      this.logger.info(
        this.connection.fallback
          ? `eedomus: now through the ${this.connection.transport} API, the preferred one does not answer${why}`
          : `eedomus: back to the ${this.connection.transport} API`,
      );
    } else if (!refresh) {
      return;
    }
    await this.setStatus(true, this.connectedStatus());
    await this.publishAllTransports();
  }

  /** Connects: the inventory proves the credentials and gives the values. */
  async open(generation) {
    try {
      await this.loadInventory(generation, { initial: true });
      if (!this.current(generation)) {
        return;
      }
      this.online = true;
      this.failures = 0;
      this.route = this.routeKey();
      this.logger.info(
        `Connected to eedomus through the ${this.connection.transport} API` +
          `${this.connection.fallback ? ' (fallback)' : ''}: ${this.inventory.peripherals.length} peripherals`,
      );
      await this.setStatus(true, this.connectedStatus());
      await this.publishAllTransports();
      this.schedule(generation, this.pollDelay(), () => this.poll(generation));
      this.scheduleInventory(generation, TIMINGS.inventoryRefresh);
    } catch (err) {
      await this.fail(generation, err);
    }
  }

  async fail(generation, err) {
    if (!this.current(generation)) {
      return;
    }
    this.online = false;
    this.polling = false;
    this.failures += 1;
    const delay =
      err?.kind === 'auth'
        ? TIMINGS.authRetry
        : Math.min(TIMINGS.retryMax, TIMINGS.retryMin * 2 ** (this.failures - 1));
    if (err instanceof EedomusError) {
      this.logger.warn(`eedomus: ${err.message} (retrying in ${Math.round(delay / 1000)} s)`);
    } else {
      this.logger.error('eedomus: unexpected failure', err);
    }
    const preferred = this.connection?.routes?.[0]?.transport ?? 'local';
    await this.setStatus(false, T.failure(err, preferred, this.config.boxHost));
    await this.publishAllTransports();
    this.timers.clearTimeout(this.inventoryTimer);
    this.schedule(generation, delay, () => this.open(generation));
  }

  // --- Values --------------------------------------------------------------------

  /** Through the cloud, reads are spaced at least a minute (cloud quotas). */
  pollDelay() {
    const ms = this.config.pollInterval * 1000;
    return this.connection?.transport === 'cloud' ? Math.max(ms, TIMINGS.cloudPollMin) : ms;
  }

  /** The peripherals worth reading: the ones whose device the user created. */
  polledIds() {
    const created = this.createdDevices();
    return [...this.model.deviceIds]
      .filter(([deviceId]) => created.has(deviceId))
      .map(([, id]) => id);
  }

  async poll(generation) {
    const ids = this.polledIds();
    this.polling = true;
    try {
      for (let i = 0; i < ids.length; i += LIMITS.idsPerRequest) {
        const chunk = ids.slice(i, i + LIMITS.idsPerRequest);
        const body = await this.connection.call('get', 'periph.caract', {
          periph_id: chunk.join(','),
        });
        if (!this.current(generation)) {
          return;
        }
        this.applyValues(generation, caractRecords(body, chunk));
      }
    } catch (err) {
      if (err?.kind === 'api' && err.code === ERROR_CODES.UNKNOWN_DEVICE) {
        // A peripheral deleted in eedomus: the inventory read drops it from the list.
        this.warnOnce('unknown-device', `eedomus: ${err.message} (reading the peripherals again)`);
        if (!this.readingInventory) {
          this.scheduleInventory(generation, TIMINGS.inventoryDebounce);
        }
      } else {
        await this.fail(generation, err);
        return;
      }
    } finally {
      if (this.current(generation)) {
        this.polling = false;
      }
    }
    await this.followRoute(generation);
    this.schedule(generation, this.pollDelay(), () => this.poll(generation));
  }

  /** The values of a periph.caract answer; a renamed peripheral reads the inventory again. */
  applyValues(generation, records) {
    let reload = false;
    for (const record of records) {
      const id = record.periph_id;
      const name = this.known.get(id);
      const fresh = String(record.name ?? '').trim();
      if (name === undefined || (fresh !== '' && fresh !== name)) {
        reload = true;
      }
      this.applyRecord(record);
    }
    if (reload && !this.readingInventory) {
      this.scheduleInventory(generation, TIMINGS.inventoryDebounce);
    }
  }

  /**
   * One peripheral record: its values to the features, its presses as
   * events, its badge. `initial`: read at the connection (a press seen then
   * may be old news from an outage: not sent).
   */
  applyRecord(record, { initial = false } = {}) {
    const id = record.periph_id;
    const previous = this.records.get(id);
    const changed =
      previous !== undefined && previous.last_value_change !== record.last_value_change;
    this.records.set(id, record);
    for (const { featureId, read, event } of this.model.readers.get(id) ?? []) {
      if (event && (initial || !changed)) {
        continue;
      }
      let value;
      try {
        value = read(record);
      } catch (err) {
        this.warnOnce(`read:${featureId}`, `${featureId}: ${err.message}`);
        continue;
      }
      if (!value) {
        continue;
      }
      if (event) {
        if (this.created.has(featureId)) {
          this.publisher.pushEvent(featureId, value);
        }
      } else {
        this.record(featureId, value);
      }
    }
    const deviceId = this.deviceIdOf(id);
    if (deviceId && !initial) {
      this.publishTransport(deviceId).catch((err) =>
        this.logger.warn(`Transport badge failed: ${err.message}`),
      );
    }
  }

  /** Keeps the value, and sends it when the device exists in Gladys. */
  record(featureId, value) {
    this.lastValues.set(featureId, value);
    if (this.created.has(featureId)) {
      this.publisher.push(featureId, value);
    }
  }

  /** After a command: read the values soon, not at the next tick. */
  pollSoon() {
    const generation = this.generation;
    if (!this.online || this.polling) {
      return;
    }
    this.schedule(generation, TIMINGS.commandEcho, () => this.poll(generation));
  }

  // --- Inventory -----------------------------------------------------------------

  idsOf(id) {
    return this.gladys.externalIds('eedomus', id);
  }

  deviceIdOf(id) {
    const ids = this.idsOf(id);
    return this.model.deviceIds.has(ids.device) ? ids.device : undefined;
  }

  /** periph.list, the allowed values of the lists, the last values. */
  async readInventory(connection, timeout = TIMINGS.inventoryTimeout) {
    const list = await connection.call('get', 'periph.list', {}, { timeout });
    const values = await connection
      .call('get', 'periph.value_list', { periph_id: 'all' }, { timeout })
      .catch((err) => {
        if (isTransportError(err) || err?.kind === 'auth') {
          throw err;
        }
        this.warnOnce('value_list', `Reading the eedomus value lists failed: ${err.message}`);
        return [];
      });
    const caract = await connection.call('get', 'periph.caract', { periph_id: 'all' }, { timeout });
    return buildInventory({ list, values, caract });
  }

  /** Reads the peripherals and their values; publishes the devices and the values. */
  async loadInventory(generation, { force = false, initial = false } = {}) {
    let inventory;
    this.readingInventory = true;
    try {
      inventory = await this.readInventory(this.connection);
    } finally {
      this.readingInventory = false;
    }
    if (!this.current(generation)) {
      return;
    }
    const model = buildModel((id) => this.idsOf(id), inventory);
    this.inventory = inventory;
    this.model = model;
    this.known = new Map(inventory.peripherals.map((p) => [p.id, p.name]));
    for (const p of inventory.peripherals) {
      if (p.record.periph_id !== undefined) {
        this.applyRecord(p.record, { initial });
      }
    }
    const json = JSON.stringify(model.devices);
    if (force || json !== this.publishedDevices) {
      try {
        await this.gladys.publishDiscoveredDevices(model.devices);
        this.publishedDevices = json;
        this.logger.info(
          `${model.devices.length} devices offered in Discovery (${inventory.peripherals.length} eedomus peripherals)`,
        );
      } catch (err) {
        this.logger.error(`Publishing the discovered devices failed: ${err.message}`);
      }
    }
  }

  scheduleInventory(generation, ms) {
    this.timers.clearTimeout(this.inventoryTimer);
    this.inventoryTimer = this.timers.setTimeout(() => {
      this.inventoryTimer = undefined;
      if (!this.current(generation) || !this.online) {
        return; // the reconnection reads it anyway
      }
      this.loadInventory(generation)
        .then(async () => {
          await this.followRoute(generation, { refresh: true });
        })
        .catch((err) => this.logger.warn(`Reading the eedomus peripherals failed: ${err.message}`))
        .finally(() => {
          if (this.current(generation) && !this.inventoryTimer) {
            this.scheduleInventory(generation, TIMINGS.inventoryRefresh);
          }
        });
    }, ms);
  }

  /** The Scan button of the Discovery tab. */
  async rescan() {
    if (!this.online || !this.connection) {
      await this.gladys.publishDiscoveredDevices(this.model.devices);
      return;
    }
    const generation = this.generation;
    await this.loadInventory(generation, { force: true });
    await this.followRoute(generation, { refresh: true });
  }

  // --- Transport badges ----------------------------------------------------------

  /** The badge of a device: the way in use, the peripheral reachable by the box. */
  transportOf(deviceId) {
    if (!this.online || !this.connection) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    const record = this.records.get(this.model.deviceIds.get(deviceId));
    if (String(record?.last_value ?? '').toLowerCase() === 'unreachable') {
      // The SDK shows a message only with `degraded`: unreachable, and why.
      return {
        transport: DEVICE_TRANSPORTS.UNREACHABLE,
        degraded: true,
        message: T.badge.deviceUnreachable,
      };
    }
    const cloud = this.connection.transport === 'cloud';
    const transport = cloud ? DEVICE_TRANSPORTS.CLOUD : DEVICE_TRANSPORTS.LOCAL;
    if (this.connection.fallback) {
      return { transport, degraded: true, message: cloud ? T.badge.viaCloud : T.badge.viaBox };
    }
    return { transport };
  }

  async publishTransport(deviceId) {
    if (!this.createdDevices().has(deviceId)) {
      return;
    }
    const badge = this.transportOf(deviceId);
    const key = JSON.stringify(badge);
    if (this.transports.get(deviceId) === key) {
      return;
    }
    this.transports.set(deviceId, key);
    await this.gladys.publishTransports([{ external_id: deviceId, ...badge }]);
  }

  async publishAllTransports() {
    const entries = [];
    for (const deviceId of this.createdDevices()) {
      const badge = this.transportOf(deviceId);
      const key = JSON.stringify(badge);
      if (this.transports.get(deviceId) !== key) {
        this.transports.set(deviceId, key);
        entries.push({ external_id: deviceId, ...badge });
      }
    }
    for (let i = 0; i < entries.length; i += 100) {
      await this.gladys
        .publishTransports(entries.slice(i, i + 100))
        .catch((err) => this.logger.warn(`Transport badges failed: ${err.message}`));
    }
  }

  // --- Devices created by the user -------------------------------------------------

  createdDevices() {
    return new Set((this.gladys.devices ?? []).map((d) => d.external_id));
  }

  refreshCreated() {
    this.created = new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  async deviceCreated(device) {
    this.refreshCreated();
    this.transports.delete(device?.external_id);
    for (const f of device?.features ?? []) {
      const value = this.lastValues.get(f.external_id);
      if (value) {
        this.publisher.push(f.external_id, value);
      }
    }
    if (device?.external_id) {
      await this.publishTransport(device.external_id).catch(() => {});
    }
  }

  async deviceDeleted(device) {
    this.refreshCreated();
    if (device?.external_id) {
      this.transports.delete(device.external_id);
      this.publisher.forget(device.external_id);
    }
  }

  // --- Commands ------------------------------------------------------------------

  async setValue(device, feature, value) {
    const connection = this.connection;
    if (!connection || !this.online) {
      throw new Error('eedomus is not connected');
    }
    const writer = this.model.writers.get(feature.external_id);
    const id = this.model.owners.get(feature.external_id);
    if (!writer || id === undefined) {
      throw new Error(`${feature.name ?? feature.external_id} cannot be controlled`);
    }
    const target = writer.write(value);
    await connection.call('set', 'periph.value', { periph_id: id, value: target });
    this.logger.debug(`eedomus periph.value sent for ${feature.external_id}`);
    await this.followRoute(this.generation);
    this.pollSoon();
  }

  // --- Configuration screen button ---------------------------------------------------

  /** Tries each way with the saved configuration, reads the inventory, counts. */
  async testConnection() {
    const config = this.config;
    if (config.error) {
      return T.configError(config.error);
    }
    const connection = this.newConnection();
    try {
      const checks = [];
      for (const route of connection.routes) {
        try {
          await route.client.call('get', 'auth.test', {}, { timeout: TIMINGS.testTimeout });
          checks.push({ transport: route.transport });
        } catch (err) {
          if (!(err instanceof EedomusError)) {
            throw err;
          }
          checks.push({ transport: route.transport, error: err });
        }
      }
      const working = connection.routes[checks.findIndex((c) => !c.error)];
      if (!working) {
        const refused = checks.find((c) => c.error.kind === 'auth');
        if (refused) {
          return T.failure(refused.error);
        }
        return T.test.result({ checks, host: config.boxHost });
      }
      const inventory = await this.readInventory(working.client, TIMINGS.testTimeout);
      const model = buildModel((id) => this.idsOf(id), inventory);
      return T.test.result({
        checks,
        host: config.boxHost,
        inventory: {
          peripherals: inventory.peripherals.length,
          rooms: inventory.rooms,
          devices: model.devices.length,
          empty: model.counts.empty,
        },
      });
    } catch (err) {
      if (!(err instanceof EedomusError)) {
        this.logger.error('Connection test failed', err);
      }
      return T.failure(err, connection.routes[0].transport, config.boxHost);
    } finally {
      connection.close();
    }
  }
}
