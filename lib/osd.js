// Betaflight OSD element position encoding (osd.h):
//   value = (x & 0x1F) | ((x << 5) & 0x400) | ((y & 0x1F) << 5) | profileFlags
// Bit 10 is the HD extension bit giving X a 6th bit (canvas up to 63 wide);
// bits 11/12/13 are visibility in OSD profiles 1/2/3.

const PROFILE_FLAGS = [0x800, 0x1000, 0x2000];

function decodeOsdPos(value) {
  const v = +value || 0;
  return {
    x: (v & 0x1f) | ((v >> 5) & 0x20),
    y: (v >> 5) & 0x1f,
    profiles: PROFILE_FLAGS.map(f => !!(v & f)),
  };
}

function encodeOsdPos({ x, y, profiles }) {
  let v = (x & 0x1f) | ((x << 5) & 0x400) | ((y & 0x1f) << 5);
  PROFILE_FLAGS.forEach((f, i) => { if (profiles?.[i]) v |= f; });
  return v;
}

// Friendly names for common elements; anything else gets a prettified key.
const ELEMENT_NAMES = {
  osd_vbat_pos: 'Battery voltage',
  osd_avg_cell_voltage_pos: 'Avg cell voltage',
  osd_current_pos: 'Current draw',
  osd_mah_drawn_pos: 'mAh drawn',
  osd_rssi_pos: 'RSSI',
  osd_link_quality_pos: 'Link quality',
  osd_rssi_dbm_pos: 'RSSI dBm',
  osd_tim_1_pos: 'Timer 1',
  osd_tim_2_pos: 'Timer 2',
  osd_flymode_pos: 'Flight mode',
  osd_throttle_pos: 'Throttle',
  osd_vtx_channel_pos: 'VTX channel',
  osd_crosshairs_pos: 'Crosshairs',
  osd_ah_pos: 'Artificial horizon',
  osd_ah_sbar_pos: 'Horizon sidebars',
  osd_craft_name_pos: 'Craft name',
  osd_display_name_pos: 'Display name',
  osd_pilot_name_pos: 'Pilot name',
  osd_gps_speed_pos: 'GPS speed',
  osd_gps_sats_pos: 'GPS satellites',
  osd_gps_lat_pos: 'GPS latitude',
  osd_gps_lon_pos: 'GPS longitude',
  osd_home_dir_pos: 'Home direction',
  osd_home_dist_pos: 'Home distance',
  osd_altitude_pos: 'Altitude',
  osd_compass_bar_pos: 'Compass bar',
  osd_warnings_pos: 'Warnings',
  osd_battery_usage_pos: 'Battery usage bar',
  osd_disarmed_pos: 'DISARMED',
  osd_esc_tmp_pos: 'ESC temperature',
  osd_esc_rpm_pos: 'ESC RPM',
  osd_core_temp_pos: 'MCU temperature',
  osd_flip_arrow_pos: 'Turtle-mode arrow',
  osd_g_force_pos: 'G-force',
  osd_motor_diag_pos: 'Motor diagnostics',
  osd_debug_pos: 'Debug',
  osd_pidrate_profile_pos: 'PID/rate profile',
  osd_pid_roll_pos: 'Roll PID',
  osd_pid_pitch_pos: 'Pitch PID',
  osd_pid_yaw_pos: 'Yaw PID',
  osd_power_pos: 'Power (W)',
  osd_rc_channels_pos: 'RC channels',
  osd_camera_frame_pos: 'Camera frame',
  osd_sys_goggle_voltage_pos: 'Goggle voltage',
  osd_sys_vtx_voltage_pos: 'VTX voltage',
  osd_sys_bitrate_pos: 'VTX bitrate',
};

function friendlyName(key) {
  if (ELEMENT_NAMES[key]) return ELEMENT_NAMES[key];
  return key.replace(/^osd_/, '').replace(/_pos$/, '').replace(/_/g, ' ');
}

// Pull every osd_*_pos out of a parsed settings map.
function extractOsdElements(settings) {
  const elements = [];
  for (const [key, value] of Object.entries(settings || {})) {
    if (!/^osd_\w+_pos$/.test(key)) continue;
    elements.push({ key, name: friendlyName(key), value: +value, ...decodeOsdPos(value) });
  }
  return elements.sort((a, b) => a.name.localeCompare(b.name));
}

// Canvas hints from settings: HD displayport canvas if configured, else
// analog PAL/NTSC.
function canvasFromSettings(settings) {
  const w = +settings?.osd_canvas_width || 0;
  const h = +settings?.osd_canvas_height || 0;
  if (w >= 30 && h >= 13) return { cols: w, rows: h, hd: w > 31 };
  const ntsc = String(settings?.video_system || '').toUpperCase() === 'NTSC';
  return { cols: 30, rows: ntsc ? 13 : 16, hd: false };
}

module.exports = { decodeOsdPos, encodeOsdPos, extractOsdElements, canvasFromSettings, friendlyName, PROFILE_FLAGS };
