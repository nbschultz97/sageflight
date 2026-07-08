# Ceradon Loadout v1 — shared contract

The loose-coupling bridge between **COTS-Architect** (planning / inventory)
and **Sageflight** (bench). COTS-Architect exports a planned build as a
loadout JSON file; Sageflight imports it (Checklists tab, or
`POST /api/loadout`) to generate a kit-check stage and verify the delivered
hardware against the plan.

**Both tools work fully standalone.** The bridge is a file format, not a
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
      "specs": { "firmware_family": "BLHeli_S", "current_a": 50 }
    },
    {
      "role": "motor",
      "name": "T-Motor F60 Pro V",
      "manufacturer": "T-Motor",
      "part_number": "F60-PRO-V-KV1950",
      "quantity": 4,
      "specs": { "kv": 1950 }
    },
    { "role": "receiver", "name": "RadioMaster RP1 ELRS" },
    { "role": "vtx", "name": "Walksnail Avatar HD" },
    { "role": "battery", "name": "6S 1300mAh 120C", "quantity": 4 }
  ],
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
| `components[].manufacturer`, `.part_number`, `.specs`, `.notes` | — | Free-form; `specs` is an object. |
| `source`, `exportedAt`, `airframeClass`, `firmware`, `notes` | — | Optional metadata. |

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

## Implementing the exporter in COTS-Architect

Serialize the selected architecture to this shape and offer it as a
`*.loadout.json` download. Component categories map to `role`; the parts
catalog's `part_number`/`manufacturer` fields carry over verbatim; put
anything else in `specs`.
