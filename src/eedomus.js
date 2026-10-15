// -----------------------------------------------------------------------------
// The eedomus API: the only network access.
//
// One GET per call: <base>/<get|set>?action=<service.action>&<params>
// &api_user=…&api_secret=… where <base> is http://<box IP>/api on the local
// network, or https://api.eedomus.com through the cloud (same credentials,
// from the eedomus portal). The answer is a JSON object
// { success: 1, body: … } or { success: 0, body: { error_code, error_msg } }
// (doc.eedomus.com, "API eedomus").
//
// The credentials travel in the query string, as the API wants: an error
// never quotes a URL, and a message of the box is cleaned of the secret.
//
// The box answers one request at a time and refuses requests closer than
// 500 ms: each client queues its calls and spaces them (TIMINGS.requestGap).
// A connection holds the local and the cloud clients and falls back from the
// preferred one to the other when it does not answer (see createConnection).
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';
import { LIMITS, TIMINGS } from './constants.js';

export class EedomusError extends Error {
  /**
   * @param {'auth'|'api'|'network'|'certificate'|'timeout'|'http'|'redirect'|'format'|'size'} kind
   * @param {string} message never a URL
   * @param {{ status?: number, code?: number }} [details] HTTP status, eedomus error_code
   */
  constructor(kind, message, { status, code } = {}) {
    super(message);
    this.name = 'EedomusError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

/** eedomus error codes (API documentation). */
export const ERROR_CODES = {
  AUTH: 1,
  MISSING_PARAMETER: 2,
  UNKNOWN_DEVICE: 3,
  INVALID_ACTION: 4,
  BAD_FORMAT: 5,
  UNKNOWN_VALUE: 6,
  SERVER: 7,
  TOGGLE: 8,
};

/** Failures of the way, not of the request: the other way may answer. */
const TRANSPORT_KINDS = new Set([
  'network',
  'certificate',
  'timeout',
  'http',
  'redirect',
  'format',
]);

export const isTransportError = (err) => TRANSPORT_KINDS.has(err?.kind);

const NETWORK_REASONS = {
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection reset',
  EHOSTUNREACH: 'host unreachable',
  ENETUNREACH: 'network unreachable',
  ENOTFOUND: 'unknown host name',
  EAI_AGAIN: 'host name not resolved',
  ETIMEDOUT: 'connection timed out',
  EPIPE: 'connection closed',
};

const CERTIFICATE_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** A socket error -> EedomusError (never the URL: it carries the API secret). */
export function networkError(err) {
  if (err instanceof EedomusError) {
    return err;
  }
  if (CERTIFICATE_CODES.has(err?.code)) {
    return new EedomusError('certificate', `certificate refused (${err.code})`);
  }
  const reason = NETWORK_REASONS[err?.code] ?? err?.code ?? 'network error';
  return new EedomusError('network', reason);
}

/**
 * GETs a URL and resolves { status, location, body } (body: a Buffer). The
 * first outcome wins: a destroyed request may still end or fail after it.
 * @param {string} url
 * @param {{ timeout: number, agent?: http.Agent, maxBytes?: number }} options
 */
export function httpGet(url, { timeout, agent, maxBytes }) {
  const limit = maxBytes ?? LIMITS.responseBytes;
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === 'https:' ? https : http;
    let timer;
    let settled = false;
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn(value);
      }
    };
    const req = lib.request(
      target,
      { method: 'GET', agent, headers: { Accept: 'application/json' } },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > limit) {
            const mb = Math.max(1, Math.round(limit / 1048576));
            settle(reject, new EedomusError('size', `answer larger than ${mb} MB`));
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          settle(resolve, {
            status: res.statusCode,
            location: res.headers.location,
            body: Buffer.concat(chunks),
          });
        });
        res.on('error', (err) => settle(reject, networkError(err)));
      },
    );
    timer = setTimeout(() => {
      settle(
        reject,
        new EedomusError('timeout', `no answer within ${Math.round(timeout / 1000)} s`),
      );
      req.destroy();
    }, timeout);
    req.on('error', (err) => settle(reject, networkError(err)));
    req.end();
  });
}

/** The text of an answer: UTF-8, or Latin-1 when it is not valid UTF-8. */
export function decodeBody(body) {
  if (typeof body === 'string') {
    return body;
  }
  const text = Buffer.from(body ?? []).toString('utf8');
  return text.includes('�') ? Buffer.from(body).toString('latin1') : text;
}

/** JSON, tolerating raw control characters (a peripheral name with a tab…). */
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    try {
      // eslint-disable-next-line no-control-regex
      return JSON.parse(text.replace(/[\u0000-\u001f]+/g, ' '));
    } catch {
      return undefined;
    }
  }
}

/** The `body` of a successful answer, or the EedomusError the answer carries. */
export function parseAnswer({ status, location, body }) {
  if (status >= 300 && status < 400) {
    let where;
    try {
      where = new URL(location).origin;
    } catch {
      where = 'another address';
    }
    throw new EedomusError('redirect', `redirected to ${where}`, { status });
  }
  const json = parseJson(decodeBody(body));
  const isAnswer = json && typeof json === 'object' && !Array.isArray(json) && 'success' in json;
  if (!isAnswer) {
    if (status === 401 || status === 403) {
      throw new EedomusError('auth', `access refused (HTTP ${status})`, { status });
    }
    throw status === 200
      ? new EedomusError('format', 'not an eedomus API answer', { status })
      : new EedomusError('http', `HTTP ${status}`, { status });
  }
  if (Number(json.success) === 1) {
    return json.body;
  }
  const code = Number(json.body?.error_code);
  const what = String(json.body?.error_msg ?? '')
    .trim()
    .slice(0, 300);
  const kind = code === ERROR_CODES.AUTH ? 'auth' : 'api';
  throw new EedomusError(kind, what || `error ${Number.isFinite(code) ? code : '?'}`, {
    status,
    code: Number.isFinite(code) ? code : undefined,
  });
}

/** The query string of a call, every value encoded, the credentials last. */
export function queryOf(action, params = {}) {
  const parts = [`action=${encodeURIComponent(action)}`];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.join('&');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A client of one way to the API.
 * @param {{ base: string, apiUser: string, apiSecret: string, get?: typeof httpGet, gap?: number, wait?: (ms: number) => Promise<void>, now?: () => number }} options
 *   base: http://<box>/api or https://api.eedomus.com
 */
export function createClient({
  base,
  apiUser,
  apiSecret,
  get = httpGet,
  gap = TIMINGS.requestGap,
  wait = sleep,
  now = Date.now,
}) {
  const agent = new (base.startsWith('https:') ? https : http).Agent({
    keepAlive: true,
    maxSockets: 1,
  });
  const credentials = `api_user=${encodeURIComponent(apiUser)}&api_secret=${encodeURIComponent(apiSecret)}`;
  const secrets = [apiSecret, encodeURIComponent(apiSecret)].filter((s) => s.length >= 4);
  let queue = Promise.resolve();
  let lastEnd = -Infinity;

  /** A message of the box never repeats the secret (it may echo a parameter). */
  const clean = (err) => {
    for (const secret of secrets) {
      if (err?.message?.includes(secret)) {
        err.message = err.message.split(secret).join('***');
      }
    }
    return err;
  };

  /** One request at a time, `gap` ms after the end of the previous one. */
  function enqueue(task) {
    const run = queue.then(async () => {
      const delay = lastEnd + gap - now();
      if (delay > 0) {
        await wait(delay);
      }
      try {
        return await task();
      } finally {
        lastEnd = now();
      }
    });
    queue = run.catch(() => {});
    return run;
  }

  return {
    /**
     * One action; resolves with the `body` of the answer.
     * @param {'get'|'set'} kind
     * @param {string} action e.g. 'periph.list', 'periph.value'
     */
    call(kind, action, params = {}, { timeout = TIMINGS.requestTimeout } = {}) {
      const url = `${base}/${kind}?${queryOf(action, params)}&${credentials}`;
      return enqueue(async () => {
        try {
          return parseAnswer(await get(url, { timeout, agent }));
        } catch (err) {
          throw clean(networkError(err));
        }
      });
    },
    close() {
      agent.destroy();
    },
  };
}

/**
 * The ways to the API, the preferred one first: a call goes through the
 * preferred way, and through the other one when the preferred does not answer
 * (network, timeout, not an eedomus answer). A refusal (credentials, unknown
 * peripheral) is an answer: it is not retried elsewhere. Once on the other
 * way, the preferred one is tried again every `retryAfter` ms.
 * @param {{ routes: Array<{ transport: 'local'|'cloud', client: { call: Function, close?: Function } }>, now?: () => number, retryAfter?: number }} options
 */
export function createConnection({ routes, now = Date.now, retryAfter = TIMINGS.preferredRetry }) {
  let active = 0;
  let since = 0;
  /** Why the preferred way was left (an EedomusError), while on the other one. */
  let reason;

  return {
    routes,
    /** The way in use: 'local' or 'cloud'. */
    get transport() {
      return routes[active].transport;
    },
    /** True on the other way (the preferred one did not answer). */
    get fallback() {
      return active > 0;
    },
    get reason() {
      return active > 0 ? reason : undefined;
    },
    async call(kind, action, params, options) {
      const order =
        active === 0 || now() - since >= retryAfter ? routes.map((_, i) => i) : [active];
      let first;
      for (const i of order) {
        try {
          const body = await routes[i].client.call(kind, action, params, options);
          if (i !== active) {
            active = i;
            since = now();
          }
          return body;
        } catch (err) {
          if (!isTransportError(err)) {
            throw err;
          }
          if (i === 0) {
            reason = err;
            since = now();
          }
          if (first === undefined) {
            first = err;
          } else {
            first.fallbackError = err; // the status names both
          }
        }
      }
      // No way answered: the next attempt starts again from the preferred one.
      active = 0;
      throw first;
    },
    close() {
      for (const route of routes) {
        route.client.close?.();
      }
    },
  };
}
