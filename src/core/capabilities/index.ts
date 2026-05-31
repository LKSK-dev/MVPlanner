/**
 * `core/capabilities` public surface (impl 02 §2.3). Runtime feature detection
 * for graceful degradation across the supported-browser matrix (spec plan/01
 * §1.7). See {@link detectCapabilities} for the pure/injectable detector and
 * {@link detectRealCapabilities} for the real-globals convenience.
 */
export type { Capabilities, CapabilityEnv, CapabilityNavigator, CapabilityWindow } from './detect';
export { detectCapabilities, detectRealCapabilities } from './detect';
