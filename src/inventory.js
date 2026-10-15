// -----------------------------------------------------------------------------
// The eedomus inventory: the answers of periph.list, periph.value_list and
// periph.caract -> the peripherals to offer, each with its room, its usage,
// its allowed values and its last values (pure).
//
// The box returns every value as a string ("21.5", "100", ""); ids are kept
// as strings. A peripheral is a channel of a module: a Fibaro motion sensor
// is three peripherals (motion, temperature, luminosity) whose children name
// their parent in `parent_periph_id`.
// -----------------------------------------------------------------------------

const text = (value) => String(value ?? '').trim();

/** A list of a body: an array, or the values of an object keyed by id. */
export const asList = (body) => {
  if (Array.isArray(body)) {
    return body;
  }
  return body && typeof body === 'object' ? Object.values(body) : [];
};

/**
 * The records of a periph.caract answer. One id asked: one object, without
 * its id; several (or "all"): a list of objects with their `periph_id`.
 * @param {unknown} body
 * @param {string[]} [asked] the ids of the request (when not "all")
 * @returns {object[]} every record with its `periph_id` as a string
 */
export function caractRecords(body, asked = []) {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    if (body.periph_id !== undefined) {
      return [{ ...body, periph_id: text(body.periph_id) }];
    }
    if (asked.length === 1 && ('last_value' in body || 'name' in body)) {
      return [{ ...body, periph_id: asked[0] }];
    }
  }
  return asList(body)
    .filter((r) => r && typeof r === 'object' && r.periph_id !== undefined)
    .map((r) => ({ ...r, periph_id: text(r.periph_id) }));
}

/** A room name in brackets ("[Invisible]") is the hidden room of the box. */
const roomOf = (name) => {
  const room = text(name);
  return room === '' || /^\[.*\]$/.test(room) ? undefined : room;
};

/**
 * @param {{ list: unknown, values?: unknown, caract?: unknown }} answers the
 *   bodies of periph.list, periph.value_list (periph_id=all) and periph.caract
 *   (periph_id=all)
 * @returns {{ peripherals: Array<{ id: string, name: string, room?: string, parentId?: string, usageId: string, usageName: string, valueType: string, unit: string, hasBattery: boolean, values: Array<{ value: string, description: string }>, record: object }>, rooms: number }}
 */
export function buildInventory({ list, values, caract }) {
  const allowed = new Map();
  for (const entry of asList(values)) {
    if (entry && entry.periph_id !== undefined) {
      allowed.set(
        text(entry.periph_id),
        asList(entry.values)
          .filter((v) => v && v.value !== undefined && v.value !== null)
          .map((v) => ({ value: String(v.value), description: text(v.description) })),
      );
    }
  }
  const records = new Map(caractRecords(caract).map((r) => [r.periph_id, r]));
  const peripherals = [];
  const rooms = new Set();
  for (const p of asList(list)) {
    if (!p || typeof p !== 'object' || p.periph_id === undefined || text(p.periph_id) === '') {
      continue;
    }
    const id = text(p.periph_id);
    const room = roomOf(p.room_name);
    if (room) {
      rooms.add(room);
    }
    const battery = text(p.battery);
    peripherals.push({
      id,
      name: text(p.name) || `eedomus ${id}`,
      room,
      parentId: text(p.parent_periph_id) || undefined,
      usageId: text(p.usage_id),
      usageName: text(p.usage_name),
      valueType: text(p.value_type).toLowerCase(),
      unit: text(p.unit),
      hasBattery: battery !== '' && Number.isFinite(Number(battery)),
      values: allowed.get(id) ?? [],
      record: records.get(id) ?? {},
    });
  }
  return { peripherals, rooms: rooms.size };
}
