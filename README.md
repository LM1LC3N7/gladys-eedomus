# gladys-eedomus

[Gladys Assistant](https://gladysassistant.com) external integration bridging
an **eedomus box**: every peripheral of the box becomes a Gladys device of the
Discovery tab, its values follow the box every few seconds, and Gladys
controls it through the box. Made for eedomus users who move to Gladys at
their own pace, or run both side by side.
Unofficial, not affiliated with Connected Object (the maker of eedomus).

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **In the Gladys store.** Install it from **Integrations**, or with **Install
> from GitHub** and `https://github.com/LM1LC3N7/gladys-eedomus`. First version,
> tested on a simulated box, not yet on a real eedomus. Feedback and bug reports
> are welcome in the
> [GitHub issues](https://github.com/LM1LC3N7/gladys-eedomus/issues).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (EedomusApp) ⇄ src/eedomus.js ⇄ box (local API) | api.eedomus.com
                                   ├─ src/inventory.js  periph.list + value lists + values (pure)
                                   ├─ src/mapping.js    one peripheral -> features, readers, writers (pure)
                                   ├─ src/devices.js    peripherals -> Gladys devices + routing tables (pure)
                                   └─ src/publisher.js  states within 300/min, remote presses apart
```

Every call is a GET of the eedomus API, `…/get?action=…` or `…/set?action=…`,
with the API user and secret of the eedomus portal:

- **Two ways**: the box on the local network (`http://<box IP>/api/…`) and the
  eedomus cloud (`https://api.eedomus.com/…`), same credentials. The preferred
  one follows the "Prefer the local connection" toggle of Gladys (the box by
  default); when it does not answer, the calls go through the other one and the
  preferred one is tried again every 5 minutes. A refusal (credentials, unknown
  peripheral) is an answer, never retried elsewhere. Without a box address, the
  cloud only.
- **One request at a time**: the box serves one request at a time and refuses
  requests closer than 500 ms; each client queues its calls 600 ms apart.
- **Inventory**: `periph.list` (name, room, usage, value type, unit, parent),
  `periph.value_list&periph_id=all` (the allowed values of the lists, with
  their descriptions) and `periph.caract&periph_id=all` (the last values). Read
  at connection, every 15 minutes, on Scan, and when a peripheral was renamed.
- **Values**: `periph.caract&periph_id=<id>,<id>,…` every `poll_interval`
  seconds (15 by default, a minute at least through the cloud), for the
  peripherals created in Gladys only: one request for up to 100 of them.
  `last_value_change` tells a new press of a remote from the same value read
  again.
- **Commands**: `set periph.value&periph_id=…&value=…`, always one of the
  allowed values of a list (the nearest level of a dimmer, the "Stop"/"MY"
  order of a shutter, the value of a pilot wire order), then the values are
  read again 1.5 s later.
- **Mapping**: by the `usage_id` chosen in eedomus (lamp, appliance, heating,
  shutter, setpoint, motion, opening, smoke, flood, remote…), by the
  descriptions of the value lists (pilot wire orders, temperatures,
  open/close/stop), and by the unit for the measurements (°C, %, Lux, W, kWh,
  hPa, ppm, dB, mm/j…: eedomus users often keep the "Temperature" usage for
  any value, so the unit wins). The Gladys core enums on the other side (an
  opening sensor is 0 = open in Gladys). One device per peripheral: external
  ids `ext:<selector>:eedomus:<periph_id>` and `…:<role>`.
- **Badges**: `local` or `cloud`, degraded while on the fallback way;
  `unreachable` when no way answers, or when the box itself cannot reach the
  peripheral (`last_value` "unreachable").
- **Secrets**: the API secret travels in the query string, as the API wants:
  errors never quote a URL, and a message of the box is cleaned of the secret.

## Reused work

No JavaScript client of the eedomus API exists on npm: the ten packages found
are Homebridge plugins (`homebridge-eedomus` and its forks, last published
between 2016 and 2021), each with a few lines of HTTP calls for its accessory;
`jmellano/gladys-eedomus` (2022) is a module of the former Gladys 3. The only
actively maintained integration is
[hass-eedomus](https://github.com/Dan4Jer/hass-eedomus) (Home Assistant, MIT,
Python): not usable as a dependency, read as documentation of the real
answers. The API being small, the client is our own (~300 lines on
`node:http`), written from the official
[API documentation](https://doc.eedomus.com/view/API_eedomus) and the
[usage list of the eedomus store documentation](https://doc.eedomus.com/view/Le_store_eedomus).
hass-eedomus taught the facts the documentation does not give: the `unit` field
of `periph.list`, `periph_id=all` on the local API, the 500 ms between two
requests, the "unreachable" value, the usages of real boxes (remotes 52,
shutters 109). Nothing was copied; the test fixtures are made up.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/eedomus.js` builds the answers of a fictional box (28
peripherals of every kind) in the shapes of the API documentation;
`test/helpers/fakeEedomus.js` serves them behind the real connection (local
and cloud ways, failures per way, the eedomus error codes). The app tests run
the real SDK wiring against the SDK's fake Gladys. `test/eedomus.test.js`
checks the HTTP transport on a loopback server. No real box was used yet: see
[TODO.md](TODO.md) for what remains to check on one.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic lists the repository in the Gladys store.

## License

Apache-2.0. eedomus is a trademark of Connected Object; this project is
not affiliated with Connected Object.
