/** Type declarations for the first-party example extensions (T7.6, JS modules). */
import type { ExtManifest } from '../src/contracts';
import type { ExtModule } from '../src/ext/host';

/** An example extension module: a runtime ExtModule plus its declared manifest. */
export type ExampleExtensionModule = ExtModule & { readonly manifest: ExtManifest };

export const batteryPlus: ExampleExtensionModule;
export const geoTagger: ExampleExtensionModule;
export const paramDiffPresets: ExampleExtensionModule;
export const customNmeaAdsbLayer: ExampleExtensionModule;
export const autoTestScriptPack: ExampleExtensionModule;
export const themePack: ExampleExtensionModule;
export const customTransportDemo: ExampleExtensionModule;

/** All seven example extension modules in display order. */
export const examples: readonly ExampleExtensionModule[];
