# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Changed

- README: the store install note replaces the work-in-progress notice, and the
  Releasing section no longer says the store topic is still to be added.

## [0.1.1] - 2026-10-16

### Added

- Connection to an eedomus box through its local API, with the API user and
  secret of the eedomus portal, and through the eedomus cloud when the box does
  not answer (or the cloud only, without a box address). The "Prefer the local
  connection" toggle of Gladys chooses the preferred way.
- Every peripheral of the box offered in Discovery, one Gladys device per
  peripheral, named after its room.
- Lamps and dimmers, plugs and appliances, heating relays, pilot wire heating
  (off, frost protection, eco, comfort -2, comfort -1, comfort), temperature
  setpoints, shutters (open, close, stop when the box has one, position),
  alarm arming and other command lists, remotes and wall switches (every press
  an event), motion, opening, smoke and flood sensors, temperature, humidity,
  luminosity, power, energy, pressure, CO₂, noise, rain, wind, UV, water and
  gas meters, texts, battery levels.
- The values follow the box at the configured pace (15 s by default, a minute
  through the cloud), in one request for the devices added in Gladys; the
  values missed while the box was unreachable come back at the reconnection.
- Gladys commands sent to the box as one of the allowed values of the
  peripheral, the new value read back at once.
- Transport badges: local or cloud, degraded on the fallback way, unreachable
  when nothing answers or when the box cannot reach the peripheral.
- "Test the connection" button: the local API and the cloud tried apart, then
  the peripherals, rooms and devices offered.

[Unreleased]: https://github.com/LM1LC3N7/gladys-eedomus/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-eedomus/releases/tag/v0.1.1
