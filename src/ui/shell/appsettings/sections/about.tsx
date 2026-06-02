/**
 * App Settings → About section (spec docs/appsettings §3/§7). A thin wrapper
 * that renders the shared {@link AboutPanel} (app/API versions, build hash,
 * bundled dialects + license notices) inside the App Settings pane, fed the
 * pane's i18n translator from {@link AppSettingsSectionDeps}.
 */
import { type Component } from 'solid-js';
import { AboutPanel } from '../../about';
import type { AppSettingsSectionDeps } from '../context';

/** The App Settings About section. */
export const AboutSection: Component<{ deps: AppSettingsSectionDeps }> = (props) => {
  return <AboutPanel t={props.deps.t} />;
};
