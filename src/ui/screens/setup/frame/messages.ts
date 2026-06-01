/**
 * i18n registration for the frame/type setup step (T5.3). All keys are under
 * `setup.frame.*` and are contributed via the public registerMessages seam.
 */
import { registerMessages } from '../../../../core/i18n';

/** English strings owned by the frame setup step. */
export const FRAME_MESSAGES: Readonly<Record<string, string>> = {
  'setup.frame.title': 'Frame type',
  'setup.frame.safety':
    'Changing the vehicle frame rewrites ArduPilot frame parameters. Remove propellers and verify the airframe before arming.',
  'setup.frame.description':
    'Select the frame class and geometry that match the connected vehicle. MVPlanner writes the matching ArduPilot parameters.',
  'setup.frame.loading': 'Reading frame parameters…',
  'setup.frame.error': 'Frame parameter operation failed: {message}',
  'setup.frame.paramUnavailable': 'Not currently in the parameter cache',
  'setup.frame.currentValue': 'Current value: {value}',
  'setup.frame.currentOption': 'Current value: {label} ({value})',
  'setup.frame.unknownOption': 'Current value {value} is not one of the known options.',
  'setup.frame.selectPlaceholder': 'Select a frame value',
  'setup.frame.class.selectLabel': 'Frame class',
  'setup.frame.type.selectLabel': 'Frame type',
  'setup.frame.savePending': 'Writing {name}…',
  'setup.frame.done': 'A valid frame class is configured.',
  'setup.frame.todo': 'Choose a valid frame class to complete this step.',
  'setup.frame.na': 'No multirotor frame applies to this fixed-wing vehicle.',
  'setup.frame.parametersOnly.title': 'Configured via parameters',
  'setup.frame.parametersOnly.body':
    'This vehicle class uses firmware-specific frame parameters. Current relevant parameters are shown below; use the parameter editor for advanced frame setup.',
  'setup.frame.unsupported':
    'MVPlanner does not know a simple frame selector for this vehicle class. Configure the frame in the parameter editor.',
  'setup.frame.fixedWing.title': 'Fixed-wing (no QuadPlane frame)',
  'setup.frame.fixedWing.body':
    'Q_ENABLE is off, so this plane has no multirotor (VTOL) frame to configure. Set up the airframe via the servo function parameters (SERVOn_FUNCTION) instead. To configure a QuadPlane/VTOL frame, enable the QuadPlane stack (Q_ENABLE = 1) in the parameter editor and reconnect.',
  'setup.frame.param.frameClass': 'FRAME_CLASS',
  'setup.frame.param.frameType': 'FRAME_TYPE',
  'setup.frame.param.qFrameClass': 'Q_FRAME_CLASS',
  'setup.frame.param.qFrameType': 'Q_FRAME_TYPE',
  'setup.frame.param.frameConfig': 'FRAME_CONFIG',

  'setup.frame.copter.class.quad': 'Quad',
  'setup.frame.copter.class.hexa': 'Hexa',
  'setup.frame.copter.class.octo': 'Octo',
  'setup.frame.copter.class.octoQuad': 'OctoQuad',
  'setup.frame.copter.class.y6': 'Y6',
  'setup.frame.copter.class.tri': 'Tri',
  'setup.frame.copter.class.single': 'Single',
  'setup.frame.copter.class.coax': 'Coax',
  'setup.frame.copter.class.biCopter': 'BiCopter',
  'setup.frame.copter.class.heli': 'Heli',
  'setup.frame.copter.class.heliDual': 'Heli_Dual',
  'setup.frame.copter.class.heliQuad': 'Heli_Quad',
  'setup.frame.copter.class.dodecaHexa': 'DodecaHexa',
  'setup.frame.copter.class.heliQuad17': 'HeliQuad',

  'setup.frame.copter.type.plus': 'Plus',
  'setup.frame.copter.type.x': 'X',
  'setup.frame.copter.type.v': 'V',
  'setup.frame.copter.type.h': 'H',
  'setup.frame.copter.type.vTail': 'V-Tail',
  'setup.frame.copter.type.aTail': 'A-Tail',
  'setup.frame.copter.type.y6b': 'Y6B',
  'setup.frame.copter.type.y6f': 'Y6F',
  'setup.frame.copter.type.betaFlightX': 'BetaFlightX',
  'setup.frame.copter.type.djiX': 'DJIX',
  'setup.frame.copter.type.clockwiseX': 'ClockwiseX',

  'setup.frame.quadplane.class.quad': 'Quad',
  'setup.frame.quadplane.class.hexa': 'Hexa',
  'setup.frame.quadplane.class.octa': 'Octa',
  'setup.frame.quadplane.class.octaQuad': 'OctaQuad',
  'setup.frame.quadplane.class.y6': 'Y6',
  'setup.frame.quadplane.class.tri': 'Tri',
  'setup.frame.quadplane.class.tailsitter': 'Tailsitter',
  'setup.frame.quadplane.class.dodecaHexa': 'DodecaHexa',
  'setup.frame.quadplane.class.deca': 'Deca',
};

let registered = false;

/** Register frame setup English messages once (idempotent). */
export function registerFrameMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(FRAME_MESSAGES);
}

registerFrameMessages();
