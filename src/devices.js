// -----------------------------------------------------------------------------
// The eedomus inventory -> Gladys devices and routing tables (pure).
//
// One Gladys device per eedomus peripheral (a module's channels can sit in
// different rooms: a double relay lights two rooms). External ids:
//   device  ext:<selector>:eedomus:<periph_id>
//   feature <device>:<role>                    (src/mapping.js)
// The periph_id of a peripheral never changes while it exists: the external
// ids stay stable.
// -----------------------------------------------------------------------------

import { LIMITS } from './constants.js';
import { mapPeripheral } from './mapping.js';

/** Peripheral names repeat from room to room ("Lampe"): the room is part of the name. */
export const deviceName = (p) => (p.room ? `${p.name} (${p.room})` : p.name).slice(0, 100);

const paramsOf = (p) =>
  [
    { name: 'EEDOMUS_PERIPH_ID', value: p.id },
    { name: 'EEDOMUS_ROOM', value: p.room },
    { name: 'EEDOMUS_USAGE', value: p.usageName ? `${p.usageName} (${p.usageId})` : p.usageId },
    { name: 'EEDOMUS_PARENT_ID', value: p.parentId },
  ]
    .filter((x) => x.value !== undefined && x.value !== null && String(x.value) !== '')
    .map((x) => ({ name: x.name, value: String(x.value).slice(0, 255) }));

export function emptyModel() {
  return {
    devices: [],
    /** periph_id -> [{ featureId, read, event }] */
    readers: new Map(),
    /** feature id -> { write, text } */
    writers: new Map(),
    /** feature id -> periph_id (periph.value names the peripheral) */
    owners: new Map(),
    /** device id -> periph_id */
    deviceIds: new Map(),
    /** peripherals read, and left out because nothing maps / over the limit */
    counts: { peripherals: 0, empty: 0, overflow: 0 },
  };
}

/**
 * @param {(id: string) => { device: string, feature: (key: string) => string }} idsOf
 *   the external ids of one peripheral (gladys.externalIds('eedomus', id))
 * @param {{ peripherals: object[] }} inventory see src/inventory.js
 */
export function buildModel(idsOf, inventory) {
  const model = emptyModel();
  for (const p of inventory.peripherals) {
    model.counts.peripherals += 1;
    const mapped = mapPeripheral(p);
    if (mapped.features.length === 0) {
      model.counts.empty += 1;
      continue;
    }
    if (model.devices.length >= LIMITS.devices) {
      model.counts.overflow += 1;
      continue;
    }
    const ids = idsOf(p.id);
    model.devices.push({
      name: deviceName(p),
      external_id: ids.device,
      should_poll: false,
      params: paramsOf(p),
      features: mapped.features.map(({ key, ...feature }) => ({
        ...feature,
        external_id: ids.feature(key),
      })),
    });
    model.deviceIds.set(ids.device, p.id);
    model.readers.set(
      p.id,
      mapped.readers.map(({ key, read, event }) => ({ featureId: ids.feature(key), read, event })),
    );
    for (const [key, writer] of Object.entries(mapped.writers)) {
      model.writers.set(ids.feature(key), writer);
      model.owners.set(ids.feature(key), p.id);
    }
  }
  return model;
}
