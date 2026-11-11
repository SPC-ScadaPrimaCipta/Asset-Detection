/**
 * YOLO P&ID Model v203 — Class Map (203 classes, 1024×1024 input)
 *
 * VERIFIED MODEL ARCHITECTURE (via onnxruntime-node inspection):
 *
 *   Input  : [1, 3, 1024, 1024]  NCHW, RGB, float32, normalized [0,1]
 *   Output : [1, 207, 21504]
 *     channel 0-3   : bbox (cx, cy, width, height) in 1024×1024 letterbox space
 *     channel 4-206 : final confidence for 203 classes (NOT logits)
 *     class ID      : channel - 4
 *
 * VERIFIED FACTS (2026-10-06):
 *   1. Model emits 203 classes (IDs 0-202). No duplicates in metadata.
 *   2. Input size is 1024×1024 (NOT 640×640 like the old model).
 *   3. Channel 4 contains small non-zero values on blank input but is NOT
 *      objectness — class confidence channels start at 4.
 *   4. All labels follow hierarchical naming: <category>.<type>.<standard>
 *      (e.g., 'valve.ball.iso', 'equipment.pump.niso').
 *   5. Class 0 remains a raw model class; validity is not inferred here.
 *
 * Semantic fields are deliberately unresolved in this phase. The raw label is
 * the only model-derived class identity; Legend matching must resolve register
 * fields from `legend_symbols.asset_type`, `symbol_name`, `aliases`, and
 * `tag_pattern` before persistence. Labels in the `unknown.*` category are not
 * filtered or disabled automatically.
 */

/** Number of classes the ONNX model emits. */
export const YOLO_V203_CLASS_COUNT = 203;

/** Highest valid class ID (inclusive). */
export const YOLO_V203_MAX_CLASS_ID = YOLO_V203_CLASS_COUNT - 1;

/** Channel offset of the first class score in the output tensor. */
export const YOLO_V203_CLASS_CHANNEL_OFFSET = 4;

/** Number of candidate anchors in the output tensor. */
export const YOLO_V203_CANDIDATE_COUNT = 21504;

/** Model input size (square). */
export const YOLO_V203_INPUT_SIZE = 1024;

/** Total output channels: bbox (4) + classes (203). */
export const YOLO_V203_OUTPUT_CHANNELS = 4 + YOLO_V203_CLASS_COUNT; // 207

export interface YoloV203ClassInfo {
  id: number;
  /** Raw label exactly as stored in ONNX metadata. */
  yoloLabel: string;
  /** Semantic register fields are unresolved until Legend matching. */
  assetType: null;
  equipmentClass: null;
  detectionSubtype: null;
}

/**
 * Raw class names extracted from ONNX metadata (yolo-pid-v8n-203.onnx).
 * Generated 2026-10-06 via onnxruntime-node inspection.
 */
const RAW_CLASS_NAMES_V203: Record<number, string> = {
  0: 'valve.3way_ball.iso',
  1: 'valve.3way_gate.niso',
  2: 'valve.3way_globe.iso',
  3: 'valve.4way_ball.niso',
  4: 'valve.4way_gate.pip',
  5: 'unknown.alkylation.niso',
  6: 'valve.angle_blowdown.niso',
  7: 'valve.angle_ball.iso',
  8: 'valve.angle.iso',
  9: 'unknown.automatic_stoker.niso',
  10: 'equipment.axial_compressor.niso',
  11: 'valve.back_pressure_regulator.pip',
  12: 'valve.balance_diaphragm.pip',
  13: 'valve.ball.iso',
  14: 'valve.general_nc.iso',
  15: 'unknown.boom_loader.niso',
  16: 'valve.butterfly.niso',
  17: 'equipment.progressive_cavity_pump.pip',
  18: 'equipment.centrifugal_blower.pip',
  19: 'equipment.centrifugal_compressor.niso',
  20: 'equipment.pump.niso',
  21: 'valve.check.pip',
  22: 'tower.chimney.niso',
  23: 'valve.ball_closed.iso',
  24: 'valve.plug_globe.niso',
  25: 'valve.plug.niso',
  26: 'instrument.compressor_turbine.niso',
  27: 'equipment.conveyor.niso',
  28: 'tower.counterflow_forced_draft.niso',
  29: 'tower.counterflow_natural_draft.niso',
  30: 'tower.crossflow_inducted.niso',
  31: 'unknown.cylinder.niso',
  32: 'valve.diaphragm.niso',
  33: 'equipment.diesel_engine.pip',
  34: 'instrument.double_flow_turbine.niso',
  35: 'equipment.drum.niso',
  36: 'fitting.ejector.pip',
  37: 'equipment.electric_motor.pip',
  38: 'valve.electric_operated_gate.pip',
  39: 'equipment.elevator.iso',
  40: 'valve.fail_closed.niso',
  41: 'valve.fail_indeterminate.niso',
  42: 'valve.fail_lock.niso',
  43: 'valve.fail_open.niso',
  44: 'equipment.blower.niso',
  45: 'valve.flanged.niso',
  46: 'valve.flanged_ball.niso',
  47: 'valve.flanged_butterfly.niso',
  48: 'valve.flanged_plug.niso',
  49: 'valve.flanged_ends.niso',
  50: 'valve.flanged_globe.niso',
  51: 'valve.float_operated.niso',
  52: 'instrument.flow_controller.niso',
  53: 'instrument.flow_recorder.niso',
  54: 'instrument.flow_transmitter.niso',
  55: 'instrument.flow_meter.niso',
  56: 'unknown.fluid_catalytic_cracking.niso',
  57: 'unknown.fluid_cooking.niso',
  58: 'unknown.fluid_reactor.niso',
  59: 'equipment.furnace.pip',
  60: 'valve.general.iso',
  61: 'unknown.gauge.niso',
  62: 'equipment.gear_pump.niso',
  63: 'valve.globe.iso',
  64: 'valve.manual_operated_angle.niso',
  65: 'valve.manual_operated_ball.niso',
  66: 'valve.manual_operated.pip',
  67: 'valve.manual_operated_globe.niso',
  68: 'equipment.heat_exchanger_TEMA.pip',
  69: 'unknown.hoist.niso',
  70: 'equipment.horizontal_pump.pip',
  71: 'equipment.horizontal_vessel.niso',
  72: 'valve.hydraulic_closed.niso',
  73: 'valve.hydraulic_operated_ball.niso',
  74: 'valve.hydraulic_operated_gate.niso',
  75: 'valve.hydraulic_operated_globe.niso',
  76: 'unknown.hydrocracking.niso',
  77: 'unknown.hydrodesulfurization.niso',
  78: 'valve.integrated_block.niso',
  79: 'valve.knife.iso',
  80: 'instrument.level_arm.niso',
  81: 'instrument.level_alarm_high.niso',
  82: 'instrument.level_alarm_low.niso',
  83: 'instrument.level_controller.niso',
  84: 'instrument.level_indicator.niso',
  85: 'instrument.level_meter.niso',
  86: 'instrument.level_recorder.niso',
  87: 'instrument.level_transmitter.niso',
  88: 'equipment.liquid_ring_vacuum_pump.pip',
  89: 'instrument.magnetic.pip',
  90: 'unknown.manhole.niso',
  91: 'equipment.mixer.pip',
  92: 'equipment.mixing_reactor.niso',
  93: 'equipment.motor.niso',
  94: 'instrument.motor_driven_turbine.niso',
  95: 'valve.motor_operated_angle.niso',
  96: 'valve.motor_operated_butterfly.niso',
  97: 'valve.motor_operated_diaphragm.niso',
  98: 'valve.motor_operated.pip',
  99: 'valve.motor_operated_globe.niso',
  100: 'valve.motor_operated_plug.niso',
  101: 'valve.motor_operated_gate.niso',
  102: 'valve.gate.iso',
  103: 'unknown.not_gate.niso',
  104: 'instrument.odometer.niso',
  105: 'unknown.oil_burner.niso',
  106: 'instrument.orifice.pip',
  107: 'equipment.overhead_conveyor.niso',
  108: 'valve.pressure_relief.niso',
  109: 'valve.pressure_relief.pip',
  110: 'tower.packed.niso',
  111: 'valve.pinch.pip',
  112: 'valve.piston_operated.niso',
  113: 'tower.plate.niso',
  114: 'valve.plug.iso',
  115: 'valve.3way_pneumatic_diagram.niso',
  116: 'valve.pneumatic_diaphragm_angle.niso',
  117: 'valve.pneumatic_diaphragm_ball.niso',
  118: 'valve.pneumatic_diaphragm_butterfly.niso',
  119: 'valve.control.iso',
  120: 'valve.pneumatic_diaphragm_globe.niso',
  121: 'equipment.positive_displacement.niso',
  122: 'valve.powered_gate.niso',
  123: 'instrument.diaphragm.niso',
  124: 'instrument.pressure_controller.niso',
  125: 'instrument.pressure_gauge.niso',
  126: 'instrument.pressure_indicating_controller.niso',
  127: 'instrument.pressure_indicator.niso',
  128: 'instrument.pressure_recorder.niso',
  129: 'instrument.pressure_recording_controller.niso',
  130: 'valve.pressure_reducing_regulator.pip',
  131: 'instrument.pressure_transmitter.niso',
  132: 'valve.quarter_turn_double_acting.niso',
  133: 'valve.quarter_turn_spring_acting.niso',
  134: 'equipment.reciprocation_compressor.niso',
  135: 'valve.relief.niso',
  136: 'instrument.rotameter.pip',
  137: 'equipment.rotary_compressor.niso',
  138: 'instrument.rotary_meter.niso',
  139: 'valve.rotary_piston_pneumatic_butterfly.niso',
  140: 'valve.rotary_piston_pneumatic_closed_gate.niso',
  141: 'valve.piston_operated.pip',
  142: 'valve.rotary.pip',
  143: 'unknown.sampler.niso',
  144: 'equipment.scraper_conveyor.niso',
  145: 'equipment.screw_conveyor.iso',
  146: 'equipment.screw_pump.niso',
  147: 'unknown.skip_hoist.niso',
  148: 'valve.slide.niso',
  149: 'valve.socket_ends.niso',
  150: 'valve.socket_weld.niso',
  151: 'valve.solenoid_closed.niso',
  152: 'valve.solenoid_operated.pip',
  153: 'valve.stop_check.pip',
  154: 'equipment.centrifugal_sump.pip',
  155: 'equipment.tank.niso',
  156: 'instrument.temperature_indicator.niso',
  157: 'valve.treaded.niso',
  158: 'equipment.triple_fan_blade.niso',
  159: 'unknown.tubular.niso',
  160: 'equipment.turbine_driver.pip',
  161: 'equipment.turbine_pump.niso',
  162: 'equipment.vacuum_pump.niso',
  163: 'equipment.vane_pump.niso',
  164: 'equipment.vertical_pump.niso',
  165: 'equipment.vertical_vessel.pip',
  166: 'valve.welded.niso',
  167: 'unknown.boiler.niso',
  168: 'signal.pneumatic.iso',
  169: 'valve.pressure_safety.niso',
  170: 'unknown.radio_link.niso',
  171: 'unknown.reformer.niso',
  172: 'instrument.temperature_controller.niso',
  173: 'instrument.temperature_recorder.niso',
  174: 'instrument.temperature_transmitter.niso',
  175: 'valve.ball.niso',
  176: 'valve.globe.niso',
  177: 'valve.butterfly.pip',
  178: 'valve.check.niso',
  179: 'valve.needle.niso',
  180: 'valve.half_filled_gate.niso',
  181: 'valve.globe_nc.iso',
  182: 'valve.ball_nc.niso',
  183: 'fitting.paddle_blind.niso',
  184: 'fitting.closed_fig8_blind.pip',
  185: 'fitting.open_fig8_blind.pip',
  186: 'fitting.concentric_reducer.pip',
  187: 'fitting.flange.iso',
  188: 'equipment.heat_exchanger.iso',
  189: 'piping_insulation.niso',
  190: 'fittings.flow_arrow.niso',
  191: 'unknown.sight_glass.niso',
  192: 'instrument.field_discrete.iso',
  193: 'instrument.primary_accessible_discrete.iso',
  194: 'instrument.aux_accessible_discrete.iso',
  195: 'unknown.box.niso',
  196: 'fitting.primary_accessible_dcs.iso',
  197: 'instrument.general.niso',
  198: 'fitting.reducer.iso',
  199: 'fitting.product_arrow.iso',
  200: 'valve.butterfly.iso',
  201: 'valve.swing_check.iso',
  202: 'fitting.eccentric_reducer.iso',
};

/**
 * Exported array of YOLO class names (203 classes, indexed by class ID).
 * Used for quick lookup: YOLO_CLASS_NAMES_V203[classId] → class label.
 */
export const YOLO_CLASS_NAMES_V203: string[] = Object.values(RAW_CLASS_NAMES_V203);

/**
 * Build YoloV203ClassInfo map from raw class names.
 * Semantic register fields stay unresolved; Legend matching owns that mapping.
 */
export const YOLO_V203_CLASS_MAP: Record<number, YoloV203ClassInfo> = (() => {
  const map: Record<number, YoloV203ClassInfo> = {};
  for (let id = 0; id <= YOLO_V203_MAX_CLASS_ID; id++) {
    const label = RAW_CLASS_NAMES_V203[id];
    if (!label) {
      throw new Error(`Missing class name for id ${id} in RAW_CLASS_NAMES_V203`);
    }
    map[id] = {
      id,
      yoloLabel: label,
      assetType: null,
      equipmentClass: null,
      detectionSubtype: null,
    };
  }
  return map;
})();

/**
 * Resolve a raw class id to its class info.
 * Returns null if id is outside the model's raw class range.
 */
export function resolveYoloV203Class(classId: number): YoloV203ClassInfo | null {
  if (!Number.isInteger(classId) || classId < 0 || classId >= YOLO_V203_CLASS_COUNT) {
    return null;
  }

  const info = YOLO_V203_CLASS_MAP[classId];
  if (!info) {
    return null;
  }

  return info;
}

/**
 * Get all raw class ids emitted by v203 (0..202).
 */
export function getV203CanonicalClassIds(): number[] {
  return Object.values(YOLO_V203_CLASS_MAP)
    .map((c) => c.id);
}

/**
 * Build-time / load-time validation. Throws if the map is inconsistent.
 */
export function validateYoloV203ClassMap(expectedClassCount = YOLO_V203_CLASS_COUNT): void {
  const ids = Object.keys(YOLO_V203_CLASS_MAP)
    .map(Number)
    .sort((a, b) => a - b);

  if (ids.length !== expectedClassCount) {
    throw new Error(
      `YOLO v203 class map mismatch: map has ${ids.length} entries, expected ${expectedClassCount}`,
    );
  }

  if (ids[0] !== 0 || ids[ids.length - 1] !== expectedClassCount - 1) {
    throw new Error('YOLO v203 class IDs are not contiguous 0..N-1');
  }

  // Verify all labels are present
  for (const info of Object.values(YOLO_V203_CLASS_MAP)) {
    if (!info.yoloLabel || info.yoloLabel.trim() === '') {
      throw new Error(`Class ${info.id} has empty or missing yoloLabel`);
    }
  }
}

// Fail fast if the map is malformed.
validateYoloV203ClassMap();
