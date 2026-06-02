/**
 * App Settings section registry. Assembles the ordered section list the pane
 * renders. Each section lives in its own file and exports a
 * `Component<{ deps: AppSettingsSectionDeps }>`; this module maps them to
 * {@link AppSettingsSection} render entries.
 *
 * (Sections are wired here as they land; the array order is the rail order.)
 */
import { createComponent } from 'solid-js';
import type { AppSettingsSection } from '../context';
import { RecentsSection } from './recents';
import { AppearanceSection } from './appearance';
import { UnitsSection } from './units';
import { LanguageSection } from './language';
import { MapsSection } from './maps';
import { KeybindsSection } from './keybinds';
import { ExtensionsSection } from './extensions';
import { GeneralSection } from './general';
import { AboutSection } from './about';

/** Build the ordered App Settings sections. */
export function buildAppSettingsSections(): AppSettingsSection[] {
  return [
    {
      id: 'recents',
      labelKey: 'appsettings.section.recents',
      render: (deps) => createComponent(RecentsSection, { deps }),
    },
    {
      id: 'appearance',
      labelKey: 'appsettings.section.appearance',
      render: (deps) => createComponent(AppearanceSection, { deps }),
    },
    {
      id: 'units',
      labelKey: 'appsettings.section.units',
      render: (deps) => createComponent(UnitsSection, { deps }),
    },
    {
      id: 'keybinds',
      labelKey: 'appsettings.section.keybinds',
      render: (deps) => createComponent(KeybindsSection, { deps }),
    },
    {
      id: 'language',
      labelKey: 'appsettings.section.language',
      render: (deps) => createComponent(LanguageSection, { deps }),
    },
    {
      id: 'maps',
      labelKey: 'appsettings.section.maps',
      render: (deps) => createComponent(MapsSection, { deps }),
    },
    {
      id: 'extensions',
      labelKey: 'appsettings.section.extensions',
      render: (deps) => createComponent(ExtensionsSection, { deps }),
    },
    {
      id: 'general',
      labelKey: 'appsettings.section.general',
      render: (deps) => createComponent(GeneralSection, { deps }),
    },
    {
      id: 'about',
      labelKey: 'appsettings.section.about',
      render: (deps) => createComponent(AboutSection, { deps }),
    },
  ];
}
