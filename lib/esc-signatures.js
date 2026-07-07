// Known BLHeli_S / BLHeli_32 / AM32 / Bluejay ESC chip signatures.
// Shared knowledge base with fc-forensic (same author) — the 2-byte signature
// comes back in param[0..1] of the DEVICE_INIT_FLASH response.
//
// Sources:
// - https://github.com/bitdump/BLHeli/blob/master/BLHeli_S%20SiLabs/SI_EFM8BB_Defs.h
// - https://github.com/betaflight/betaflight-configurator/blob/master/src/js/protocols/fourWay.js
// - https://github.com/AlkaMotors/AM32-MultiRotor-ESC-firmware

const SIGNATURES = {
  // ------------------ BLHeli legacy — Atmel 8-bit ------------------
  0x9307: { mcu: 'ATmega8',     family: 'BLHeli (legacy)', arch: 'Atmel 8-bit',  flash_kb: 8 },
  0x9406: { mcu: 'ATmega48',    family: 'BLHeli (legacy)', arch: 'Atmel 8-bit',  flash_kb: 4 },
  0x9502: { mcu: 'ATmega32',    family: 'BLHeli (legacy)', arch: 'Atmel 8-bit',  flash_kb: 32 },

  // ------------------ BLHeli_S — SiLabs 8051 family ------------------
  // EFM8BB1 (original BB1 — 8KB flash)
  0x0011: { mcu: 'EFM8BB10F8',  family: 'BLHeli_S', arch: 'SiLabs 8051', flash_kb: 8 },
  0xE810: { mcu: 'EFM8BB10F8',  family: 'BLHeli_S', arch: 'SiLabs 8051', flash_kb: 8 },

  // EFM8BB2 (16KB flash, second-gen)
  0x0013: { mcu: 'EFM8BB21F16', family: 'BLHeli_S', arch: 'SiLabs 8051', flash_kb: 16 },
  0xE8B2: { mcu: 'EFM8BB21F16', family: 'BLHeli_S', arch: 'SiLabs 8051', flash_kb: 16 },
  0x061F: { mcu: 'EFM8BB21F16', family: 'BLHeli_S', arch: 'SiLabs 8051', flash_kb: 16 },

  // EFM8BB5 / BB51 (most modern BLHeli_S variant)
  0x2B06: { mcu: 'EFM8BB51F16', family: 'BLHeli_S', arch: 'SiLabs 8051', flash_kb: 16 },
  0xE81C: { mcu: 'EFM8BB51F16', family: 'BLHeli_S', arch: 'SiLabs 8051', flash_kb: 16 },

  // ------------------ BLHeli_32 / AM32 — ARM Cortex-M ------------------
  // For ARM ESCs the "signature" is often a firmware-family id, not raw MCU id.
  0x1F06: { mcu: 'ARM Cortex-M', family: 'BLHeli_32',      arch: 'ARM Cortex',       flash_kb: null },
  0x1F32: { mcu: 'ARM Cortex-M', family: 'BLHeli_32',      arch: 'ARM Cortex',       flash_kb: null },
  0x1F33: { mcu: 'STM32F051',    family: 'BLHeli_32',      arch: 'ARM Cortex-M0',    flash_kb: 64 },
  0x1F43: { mcu: 'STM32F415',    family: 'BLHeli_32',      arch: 'ARM Cortex-M4',    flash_kb: 128 },

  // AM32 (open-source firmware for STM32/AT32 ESCs)
  0xE802: { mcu: 'STM32F051 / AT32F415', family: 'AM32',   arch: 'ARM Cortex-M0/M4', flash_kb: 64 },
  0xE803: { mcu: 'STM32F421 / AT32F421', family: 'AM32',   arch: 'ARM Cortex-M0+',   flash_kb: 64 },

  // Bluejay (BLHeli_S fork). Returns a different device signature from stock
  // BLHeli_S even on the same EFM8BB21 chip. Confirmed via EEPROM string
  // `#BLHELI$EFM8B21#Bluejay` at 0x1A00.
  0xB2E8: { mcu: 'EFM8BB21F16', family: 'Bluejay', arch: 'SiLabs 8051', flash_kb: 16,
            note: 'Bluejay firmware (BLHeli_S fork) on BB21. Indicates user/custom reflash — not factory stock.' },
};

function lookup(signature) {
  const hit = SIGNATURES[signature];
  if (hit) return { ...hit, signatureKnown: true };

  // Heuristics for unknown signatures
  if (signature >= 0x1000 && signature < 0xF000) {
    return { mcu: 'UNKNOWN (ARM)', family: 'BLHeli_32 / AM32 / Bluejay (unknown)', arch: 'ARM Cortex', flash_kb: null, signatureKnown: false };
  }
  if (signature < 0x0100) {
    return { mcu: 'UNKNOWN (SiLabs 8-bit)', family: 'BLHeli_S (unknown variant)', arch: 'SiLabs 8051', flash_kb: null, signatureKnown: false };
  }
  return { mcu: 'UNKNOWN', family: 'UNKNOWN', arch: 'unknown', flash_kb: null, signatureKnown: false };
}

module.exports = { lookup, SIGNATURES };
