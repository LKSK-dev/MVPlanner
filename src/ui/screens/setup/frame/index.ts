/**
 * Frame/type setup step public surface (T5.3; spec plan/04 §4.4). Consumers
 * compose {@link createFrameStep} into the setup {@link WizardShell} registry.
 */
export { createFrameStep, type FrameStepDeps } from './frame-step';
export {
  COPTER_FRAME_CLASS_OPTIONS,
  COPTER_FRAME_TYPE_OPTIONS,
  QUADPLANE_FRAME_CLASS_OPTIONS,
  FRAME_PARAM_NAMES,
  definitionForVehicleClass,
  deriveFrameSelection,
  findFrameOption,
  hasValidFrameClass,
  isFrameParamName,
  isQuadPlaneEnabled,
  type FrameOption,
  type FrameParamDefinition,
  type FrameParamName,
  type FrameParamRole,
  type FrameParamSelection,
  type FrameParamValueReader,
  type FrameSelection,
  type FrameSelectionMode,
  type VehicleFrameDefinition,
} from './options';
export { FRAME_MESSAGES, registerFrameMessages } from './messages';
