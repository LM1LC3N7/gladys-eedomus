# TODO — eedomus bridge v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm run audit`, then update README, `docs/en.md`, `docs/fr.md`,
  `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only (before, the store would list an empty integration).
- No forum topic of its own, ever, and no forum post from a module session:
  the batch claimed in /t/10385 (post #178) gets one recap message there, with
  a link to each repo, once the ten are published.

## Status

- [x] **Milestone 1 — core** (2026-10-15): own client of the eedomus API
      (local API of the box, eedomus cloud as the fallback way following the
      "Prefer the local connection" toggle, one request at a time 600 ms
      apart, the secret kept out of every message), inventory (`periph.list`,
      `periph.value_list`, `periph.caract`, rooms, parents), mapping by usage,
      value list and unit (lamps and dimmers, plugs, heating relays, pilot
      wire, setpoints, shutters with stop and position, command lists,
      remotes as events, motion / opening / smoke / flood sensors, every
      measurement unit, texts, batteries), one device per peripheral, value
      reads of the created devices in one `periph.caract` request, commands
      (`periph.value` with an allowed value), transport badges (local, cloud,
      degraded on the fallback, unreachable), connection test of both ways,
      reconnection, manifest, docs en/fr. Tests on a fake box only: **no real
      eedomus box was available**.
- [ ] **Milestone 2 — a real box**: run against real boxes (testers of the
      forum, local and cloud), collect their `periph.list`, `value_list` and
      `caract` answers (anonymized) as fixtures, and check the list below.
- [ ] **Milestone 3 — more**: macros (`set periph.macro`, a scene action
      "run an eedomus macro"), the eedomus scenes and rules as scene actions,
      RGBW lamps (the colour list of the "couleur" channel as a colour
      feature), usage 0 lists that are commands (chimes, volumes: today a
      read-only text), thermostat modes (usage 115) as a thermostat mode, a
      push from the box (an HTTP actuator calling Gladys) instead of polling.
- [ ] **Milestone 4 — first release**: cover image, Docker image build check,
      `npx github:GladysAssistant/integration-store .`, Release workflow,
      topic (the forum recap is the main session's, see Working method).

## To check on a real box

- `periph.value_list&periph_id=all` and `periph.caract&periph_id=all` on the
  local API (hass-eedomus uses both; the documentation lists the actions, not
  the `all` of value_list), and `periph.caract` with comma-separated ids: one
  object for one id, a list for several (as documented)? What does an unknown
  id among several do (error 3 for all, or skipped)?
- The answer encoding (UTF-8 or Latin-1) of the local API and of the cloud.
- The time the box takes to answer `periph.caract` for 100 ids, and whether
  600 ms between requests is enough (hass-eedomus reports a refusal under
  500 ms, error code unknown).
- The cloud quotas (free and premium accounts): the reads through the cloud
  are a minute apart; is it low enough? What does the cloud answer once the
  quota is spent?
- The pilot wire modules (Qubino, eedomus fil pilote, Nodon…): the usage and
  the value list descriptions (recognized by their words: Arrêt / Hors gel /
  Eco / Confort -2 / Confort -1 / Confort).
- Shutters: the value lists of Z-Wave (Fibaro, Qubino) and RTS (Somfy through
  RFPlayer) shutters, the stop order ("Stop", "MY", other?), usages 48 and 109.
- Remotes: does `last_value_change` change when the same button is pressed
  twice (two "Simple appui" in a row)?
- Door sensors: the value list ("Fermé" 0 / "Ouvert" 100, or reversed?).
- `last_value` "unreachable" and the "Secteur coupé" (-2) values.
- The local API over https (the documentation says http only) and a box
  behind another port.

## Decisions

- **Own client, no dependency**: no JavaScript client of the eedomus API
  exists (npm: ten Homebridge plugins, `homebridge-eedomus` and its forks,
  last published 2016–2021; `jmellano/gladys-eedomus` is a Gladys 3 module).
  The actively maintained reference is
  [hass-eedomus](https://github.com/Dan4Jer/hass-eedomus) (Home Assistant,
  MIT, Python, commits in October 2026): not a dependency for Node, read as
  documentation of real answers (the `unit` of `periph.list`, `periph_id=all`,
  500 ms between requests, "unreachable", usages 52 and 109). The client
  (~300 lines) follows the official API documentation. The test fixtures are
  made up: a third-party box dump is not copied into this repository.
- **GET with the credentials in the query string**, as the documentation and
  every client do (POST is documented too but untested on real boxes): errors
  never quote a URL, the messages of the box are cleaned of the secret, the
  logs never print a request.
- **Two ways, one connection** (`createConnection`): the preferred way first,
  the other one on a transport failure (network, timeout, HTTP error, not an
  eedomus answer), the preferred one again every 5 minutes. Refusals (auth,
  unknown peripheral, bad value) are answers, not retried. The preferred way
  is the box unless the user turns off "Prefer the local connection"; without
  a box address, the cloud only.
- **Reads of the created devices only**: `periph.caract` with their ids,
  comma-separated, 100 per request, every `poll_interval` (15 s by default,
  5–300), a minute at least through the cloud. Nothing created, nothing read.
  The whole box (`periph_id=all`) is read with the inventory: at connection,
  every 15 minutes, on Scan, when a peripheral was renamed (its name in the
  values) or deleted (error 3 in the values).
- **One Gladys device per peripheral**: the channels of a module can sit in
  different rooms (a double relay lights two rooms); the parent is kept in the
  `EEDOMUS_PARENT_ID` parameter, the module's battery on its main channel
  only.
- **Mapping order**: value type `string` -> text; a list of pilot wire orders
  (by their descriptions) -> pilot wire, whatever its usage; usage 15 or a
  list of temperatures ("19°C") -> setpoint; usage 1 -> light (+ brightness
  when the list has levels); 2 and 4 -> switch; 48, 109, 42 -> shutter; 52 ->
  button events; 37, 21 -> motion; 27 smoke; 36 flood; 10 opening; 16, 43, 115
  lists -> a command list (text select); other lists -> a read-only text of
  the description; floats -> a measurement by unit. A unit beats the usage:
  real boxes keep "Température" (7) for watts, kVA or percentages.
- **Commands as allowed values**: on = "100" (else "On", else the largest
  number), off = "0" (else "Off"); levels and setpoints the nearest value of
  the list; shutter stop = the "Stop"/"MY" entry (none: refused with a clear
  error); a float takes the number itself.
- **Badges**: `last_value` "unreachable" (the box lost the peripheral) ->
  unreachable, degraded with the reason; on the fallback way -> its transport,
  degraded with the reason.
- **Remotes**: a press is a change of `last_value_change` (one-second
  resolution: two presses within a second are one), its kind named by the
  description (simple / double / triple / long / release / on / off).
