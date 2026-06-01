/**
 * Failsafe setup step public surface (T5.8).
 *
 * Importing this module registers the `setup.failsafe.*` i18n strings and
 * exposes {@link createFailsafeStep} for the Setup screen assembly.
 */
import './messages';

export { createFailsafeStep, FailsafeSetup } from './failsafe-step';
export type { FailsafeStepDeps, FailsafeSetupProps } from './failsafe-step';
export {
  FAILSAFE_FIELD_DEFS,
  FAILSAFE_PARAM_NAMES,
  FAILSAFE_SECTIONS,
  deriveFailsafeSections,
  deriveFailsafeStatus,
  isFailsafeParamName,
} from './metadata';
export type {
  FailsafeField,
  FailsafeFieldDef,
  FailsafeFieldKind,
  FailsafeMetaResolver,
  FailsafeOption,
  FailsafeParamName,
  FailsafeSection,
  FailsafeSectionId,
} from './metadata';
export { FAILSAFE_MESSAGES, registerFailsafeMessages } from './messages';
