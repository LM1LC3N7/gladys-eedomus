# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15), its only
runtime dependency. It reads the peripherals of the user's eedomus box through
the eedomus API (the local API of the box, the eedomus cloud as the fallback),
turns every peripheral into a Gladys device, reads their values at a steady
pace and sends the Gladys commands back. Unofficial, not affiliated with
Connected Object.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/mapping.test.js          # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js            SDK bootstrap only
src/handlers.js     every SDK handler -> the app (shared with the tests)
src/app.js          EedomusApp: connection, value reads, inventory reloads,
                    states, presses, commands, transports, connection test
src/eedomus.js      the only network access: GET <base>/<get|set>?action=…,
                    the request queue, error kinds, the local/cloud fallback
src/inventory.js    periph.list + value_list + caract -> peripherals (pure)
src/mapping.js      one peripheral -> features, readers, writers (pure)
src/devices.js      peripherals -> Gladys devices + routing tables (pure)
src/publisher.js    states within the Gladys rate limit, presses apart
src/config.js       config_schema normalized (box address, credentials)
src/constants.js    manifest keys, limits, timings
src/i18n.js         runtime texts (en/fr)
test/fixtures/      the answers of a fictional box (made up, API shapes)
test/helpers/       a fake eedomus box; Gladys is the SDK's fake
```

## Rules

- **External ids are forever**: device = `eedomus:<periph_id>`, feature =
  `<role>` (`binary`, `brightness`, `state`, `position`, `setpoint`,
  `pilot-wire`, `selector`, `button`, `motion`, `opening`, `smoke`, `leak`,
  `temperature`, `humidity`, `lux`, `power`, `energy`, `voltage`, `current`,
  `pressure`, `co2`, `noise`, `rain`, `wind`, `volume`, `uv`, `value`, `text`,
  `battery`). Never change how they are built.
- The manifest keys (`test_connection`, the config keys) are frozen: users
  store them. `GLADYS_PREFER_LOCAL` is the reserved key of the core's "Prefer
  the local connection" toggle (both transports declared): never in the
  `config_schema`.
- Value conventions: the eedomus side is its value lists (strings: "0" off /
  closed, "100" on / open, levels, "MY", with French or English
  descriptions); the Gladys side the enums of `server/utils/constants.js`
  (copied in `src/mapping.js`, the SDK does not export them). A command is
  always one of the allowed values of a list (the box refuses any other with
  error 6): writers pick the nearest one.
- Remote presses go through `publisher.pushEvent` (publishStates): never
  through `publishChangedStates`, which would drop a second identical press.
  A press is a change of `last_value_change`, never read at the connection.
- Never send a unit Gladys does not know (`unitOf` returns undefined): the
  whole device list would be refused.
- **The API secret travels in the query string**: never log or put in a
  status a URL; `src/eedomus.js` errors carry no URL and the messages of the
  box are cleaned of the secret.
- **The box is slow**: one request at a time, 600 ms apart (it refuses closer
  ones); keep the reads batched (`periph.caract` with comma-separated ids) and
  never add a request per peripheral.
- Container limits: 256 MB RAM, 0.5 CPU, read-only rootfs, only `/data`
  writable, bridge network (unicast to the LAN only).
- Gladys rate limits: 300 states/min, 300 scene events/min.
- Tests never touch the network (`test/eedomus.test.js` uses a loopback server
  for the transport).
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow.
