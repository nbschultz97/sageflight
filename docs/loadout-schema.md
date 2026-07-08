# Ceradon Loadout v1 — shared contract

The loose-coupling bridge between **COTS-Architect** (planning / inventory),
**Sageflight** (bench), and **ceradon-sim** (virtual testbench).
COTS-Architect exports a planned build as a loadout JSON file; Sageflight
imports it (Checklists tab, or `POST /api/loadout`) to generate a kit-check
stage and verify the delivered hardware against the plan; ceradon-sim imports
the same file (`ceradon-sim liftoff import-build plan.loadout.json`) to
generate a flyable sim drone matched to the planned parts.

**All tools work fully standalone.** The bridge is a file format, not a
runtime dependency — no shared services, no cross-repo imports. Sageflight
without a loadout behaves exactly as before; COTS-Architect never needs
Sageflight installed.

The validator lives at `lib/loadout.js` and is the source of truth; keep
this document in lockstep with it.

## Schema

```json
{
  "loadoutVersion": 1,
  "name": "Recon 5-inch — Build A",
  "source": "cots-architect",
  "exportedAt": "2026-07-08T12:00:00Z",
  "airframeClass": "5in-freestyle",
  "firmware": {
    "family": "Betaflight",
    "target": "SPEEDYBEEF405V3",
    "targetVersion": "4.5"
  },
  "components": [
    {
      "role": "flight_controller",
      "name": "SpeedyBee F405 V3",
      "manufacturer": "SpeedyBee",
      "part_number": "SB-F405-V3",
      "specs": { "mcu": "STM32F405" }
    },
    {
      "role": "esc",
      "name": "SpeedyBee BLS 50A 4-in-1",
      "manufacturer": "SpeedyBee",
      "part_number": "SB-BLS-50A",
      "specs": { "firmware_family": "BLHeli_S", "max_current_a": 50 }
    },
    {
      "role": "motor",
      "name": "T-Motor F60 Pro V",
      "manufacturer": "T-Motor",
      "part_number": "F60-PRO-V-KV1950",
      "quantity": 4,
      "specs": { "size": "2207", "kv": 1950 }
    },
    { "role": "propeller", "name": "HQProp 5x4.3x3", "specs": { "size": "5x4.3", "blades": 3 } },
    { "role": "camera", "name": "Caddx Ratel 2", "specs": { "tilt_deg": 22 } },
    { "role": "receiver", "name": "RadioMaster RP1 ELRS" },
    { "role": "vtx", "name": "Walksnail Avatar HD" },
    { "role": "battery", "name": "6S 1300mAh 120C", "quantity": 4,
      "specs": { "cells": 6, "capacity_mah": 1300, "chemistry": "LiPo" } }
  ],
  "payload_g": 0,
  "tune": {
    "tuneVersion": 1,
    "format": "betaflight-cli",
    "rates": {
      "rates_type": "betaflight",
      "roll_rc_rate": 100, "pitch_rc_rate": 100, "yaw_rc_rate": 100,
      "roll_srate": 70, "pitch_srate": 70, "yaw_srate": 70,
      "roll_expo": 30, "pitch_expo": 30, "yaw_expo": 30,
      "thr_mid": 50, "thr_expo": 0
    }
  },
  "notes": "Free text."
}
```

## Field reference

| Field | Required | Notes |
|---|---|---|
| `loadoutVersion` | ✅ | Literal `1`. Bump only with a schema change. |
| `name` | ✅ | Human-readable build name. |
| `components[]` | ✅ | At least one entry. |
| `components[].role` | ✅ | One of: `airframe`, `flight_controller`, `esc`, `motor`, `propeller`, `receiver`, `vtx`, `camera`, `battery`, `gps`, `other`. |
| `components[].name` | ✅ | Display name. |
| `components[].quantity` | — | Integer 1–16. Defaults to 1 (motors default to 4 for verification). |
| `components[].manufacturer`, `.part_number`, `.specs`, `.notes` | — | Free-form; `specs` is an object (recommended vocabulary below). |
| `source`, `exportedAt`, `airframeClass`, `firmware`, `notes` | — | Optional metadata. |
| `payload_g` | — | Mission payload mass in grams. Sageflight ignores it; ceradon-sim carries it into the sim drone's additional weight. Warn-only validation. |
| `tune` | — | Optional tune block (below). Warn-only validation — a malformed `tune` never rejects a loadout. |

## `specs` vocabulary (recommended, v1.1)

`specs` stays free-form and unvalidated, but producers and consumers agree on
these keys. **Field names follow the cots-catalog parts-library schema**
(snake_case, unit-suffixed) so COTS-Architect can copy fields verbatim.
Bold = emit whenever known (they drive ceradon-sim's part matching).

| role | key | type / example | consumer |
|---|---|---|---|
| motor | **`size`** | `"2207"` (stator code, string) | sim matching |
| motor | **`kv`** | `1950` | sim matching |
| motor | `max_thrust_g`, `max_current_a`, `weight_g` | numbers | planner, future sim physics |
| propeller | **`size`** | `"5x4.3"` (diameter×pitch inches, string) | sim matching |
| propeller | **`blades`** | `3` | sim matching |
| battery | **`cells`** | `6` | sim matching |
| battery | **`capacity_mah`** | `1300` | sim matching |
| battery | `chemistry`, `voltage_nominal_v`, `c_rating`, `weight_g` | per cots-catalog | bench, sim cells fallback |
| airframe | **`prop_size`** | `"5x4.3"` | sim frame-class fallback |
| airframe | `type`, `motor_count`, `motor_size`, `weight_g`, `max_payload_g` | per cots-catalog | bench cross-checks, sim fallbacks |
| esc | `max_current_a`, **`firmware_family`**, `protocols` | `50`, `"BLHeli_S"`, `["DShot600"]` | bench verification |
| flight_controller | `mcu` | `"STM32F405"` | bench |
| camera | **`tilt_deg`** | `22` | sim camera angle |
| receiver / vtx | `protocols`, `frequency_band`, `power_levels_mw` | per cots-catalog | bench, EMCON planning |

## `tune` block (optional, v1.1)

Carries the planned/refined control tune with the build so one file moves
planner → bench → sim and back. Keys are **Betaflight CLI names and units**
(`set roll_rc_rate = 100` style integers) — exactly what Sageflight's tune
layer reads off a real FC, so a bench-refined tune can round-trip into the
same loadout file. ceradon-sim converts to its internal scales on import.

| Field | Notes |
|---|---|
| `tune.tuneVersion` | Literal `1`. |
| `tune.format` | `"betaflight-cli"`. |
| `tune.rates` | Object of BF CLI rate keys: `rates_type`, `roll_rc_rate`, `roll_srate`, `roll_expo` (and pitch/yaw), `thr_mid`, `thr_expo`. Numbers in CLI units. |
| `tune.pids` | Optional; BF CLI PID keys (`p_roll`, `i_roll`, `d_roll`, …). |

## What Sageflight does with it

- **Kit-check stage** prepended to the build checklist (one item per component).
- **Airframe auto-select**: `airframeClass` maps onto Sageflight's checklist
  sets (`whoop`, `cinewhoop`, `longrange7`, `freestyle5` — fuzzy matched).
- **As-built verification** (`POST /api/loadout/verify`): compares
  `firmware.target` / `.family` / `.targetVersion` against the last FC scan,
  motor `quantity` against responsive ESC slots from the last 4-way
  interrogation, and `esc.specs.firmware_family` against interrogated ESC
  firmware. Missing bench data degrades to `unknown`, never a guess.
- **AI context**: the assistant's `get_loadout` tool exposes the plan, so
  "does what's on the bench match the plan?" is answerable in chat.

## What ceradon-sim does with it

- `ceradon-sim liftoff import-build plan.loadout.json` detects
  `loadoutVersion: 1`, matches components against its Liftoff part catalog
  (minimum for a good match: motor `size`+`kv`, propeller `size`, battery
  `cells`), converts `tune.rates` from BF CLI units, and carries `payload_g`
  into the sim drone's additional weight. Missing specs degrade to
  name-inference, then to unconstrained matches — flagged in the import notes,
  never fatal.

## Implementing the exporter in COTS-Architect

Serialize the selected architecture to this shape and offer it as a
`*.loadout.json` download. Component categories map to `role`; the parts
catalog's `part_number`/`manufacturer` fields carry over verbatim; put
anything else in `specs` using the vocabulary above.
