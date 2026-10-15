// -----------------------------------------------------------------------------
// Keys shared with the manifest (frozen: users store them in their
// configuration) and the tuning of the integration.
// -----------------------------------------------------------------------------

/** Manifest `actions` keys. */
export const ACTIONS = {
  TEST: 'test_connection',
};

/** Pace of the value reads (seconds), mirrored by the manifest. */
export const POLL_INTERVAL = { min: 5, max: 300, default: 15 };

/** The two ways to the same API: the box on the LAN, or the eedomus cloud. */
export const ENDPOINTS = {
  /** `http://<box>/api/get?action=…`: the box speaks plain http only. */
  localPath: '/api',
  cloud: 'https://api.eedomus.com',
};

export const LIMITS = {
  /** Gladys accepts 300 states per minute: keep a margin for the other paths. */
  statesPerMinute: 250,
  /** Size of an eedomus answer read (bytes): the inventory of a big box is a few hundred KB. */
  responseBytes: 16 * 1024 * 1024,
  /** Text states sent to Gladys. */
  text: 1000,
  /** Values of a list offered as options. */
  options: 50,
  /** Devices published at once (publishDiscoveredDevices). */
  devices: 2000,
  /** Peripherals read by one periph.caract request (comma-separated ids). */
  idsPerRequest: 100,
};

export const TIMINGS = {
  /** The pending states are sent at this pace. */
  flushInterval: 1000,
  /** An unchanged value is re-sent this often, so it stays recently dated in Gladys. */
  stateHeartbeat: 30 * 60_000,
  /**
   * The box serves one request at a time and refuses requests closer than
   * 500 ms (reported by hass-eedomus): the client queues them, this far apart.
   */
  requestGap: 600,
  /** One request (the inventory requests get `inventoryTimeout`). */
  requestTimeout: 15_000,
  inventoryTimeout: 60_000,
  /** One request of the connection test (the button waits 90 s). */
  testTimeout: 20_000,
  /** Reads through the cloud are spaced at least this much (cloud quotas). */
  cloudPollMin: 60_000,
  /** On the fallback way, the preferred one is tried again this often. */
  preferredRetry: 5 * 60_000,
  /** The inventory is read again this often: new peripherals, renames, rooms. */
  inventoryRefresh: 15 * 60_000,
  /** A peripheral renamed in eedomus showed up in the values: wait for the burst to end. */
  inventoryDebounce: 3000,
  /** After a Gladys command, the values are read this soon (not at the next tick). */
  commandEcho: 1500,
  /** Reconnection delays after a failure (doubled each time, up to the max). */
  retryMin: 10_000,
  retryMax: 120_000,
  /** Refused credentials are retried slowly: the user has to change them. */
  authRetry: 10 * 60_000,
};
