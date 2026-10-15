// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { POLL_INTERVAL } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  box_address: '',
  api_user: '',
  api_secret: '',
  poll_interval: POLL_INTERVAL.default,
};

/**
 * The local address of the box from what the user typed: "192.168.1.30",
 * "192.168.1.30:80", "http://eedomus.lan/" or an API URL copied from the
 * eedomus portal ("http://192.168.1.30/api/get?action=…").
 * @returns {{ url?: string, host?: string, error?: 'invalid' | 'credentials' }}
 *   no url: no local address (the cloud only)
 */
export function parseBoxAddress(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') {
    return {};
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: 'invalid' };
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return { error: 'invalid' };
  }
  if (url.username || url.password || url.search.includes('api_secret')) {
    // The API credentials have their own fields (the secret is a secret).
    return { error: 'credentials' };
  }
  if (/(^|\.)eedomus\.com$/i.test(url.hostname)) {
    // The portal or the cloud API: the local address is the IP of the box.
    return { error: 'cloud' };
  }
  return { url: url.origin, host: url.host };
}

const bounded = (raw, { min, max, default: fallback }) => {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

export function normalizeConfig(raw = {}) {
  const given = Object.fromEntries(
    Object.entries(raw ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  );
  const c = { ...DEFAULTS, ...given };
  const box = parseBoxAddress(c.box_address);
  const apiUser = String(c.api_user ?? '').trim();
  const apiSecret = String(c.api_secret ?? '').trim();
  let error = box.error;
  if (!error && (apiUser === '' || apiSecret === '')) {
    error = apiUser === '' && apiSecret === '' && !box.url ? 'empty' : 'no-credentials';
  }
  return {
    boxUrl: box.url,
    boxHost: box.host,
    error,
    apiUser,
    apiSecret,
    // Reserved key of the "Prefer the local connection" toggle (both
    // transports declared): anything but an explicit false means true.
    preferLocal: raw?.GLADYS_PREFER_LOCAL !== false,
    pollInterval: bounded(c.poll_interval, POLL_INTERVAL),
  };
}
