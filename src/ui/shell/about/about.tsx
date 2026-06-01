/**
 * About-panel view model and Solid component (T9.2; spec plan/08 §8.5/§8.9).
 *
 * The panel intentionally reads version constants and bundled dialect metadata at
 * module load so the single-file artifact carries the exact values shown to the
 * user. The NOTICES text is imported from a generated TypeScript asset, which
 * Vite inlines into MVPlanner.html.
 */
import { For, Show, createMemo, type Component } from 'solid-js';
import type { DialectTable } from '../../../contracts';
import { BUILTIN_DIALECTS } from '../../../mavlink/dialects';
import { APP_VERSION, BUILD_HASH, EXT_API_VERSION } from '../../../version';
import { NOTICES_TEXT } from './notices.generated';
import './messages';
import './about.css';

/** Translation function shape used by the About panel. */
export type AboutT = (key: string, vars?: Record<string, string | number>) => string;

/** One dialect row displayed in the About metadata table. */
export interface AboutDialectInfo {
  /** Dialect table name, e.g. `common`. */
  readonly name: string;
  /** Version string when a generated table provides one; otherwise a fallback. */
  readonly version: string;
}

interface DialectWithOptionalVersion extends DialectTable {
  readonly version?: unknown;
  readonly dialectVersion?: unknown;
}

/** Return a displayable version string from generated dialect metadata. */
export function dialectVersion(dialect: DialectTable, fallback: string): string {
  const candidate = dialect as DialectWithOptionalVersion;
  const raw = typeof candidate.version === 'string' ? candidate.version : candidate.dialectVersion;
  if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return fallback;
}

/** Build the deterministic bundled-dialect rows shown in About. */
export function bundledDialectInfo(
  t: AboutT,
  dialects: readonly DialectTable[] = BUILTIN_DIALECTS,
): readonly AboutDialectInfo[] {
  return dialects
    .map((dialect) => ({
      name: dialect.name,
      version: dialectVersion(dialect, t('about.versionUnavailable')),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Props for {@link AboutPanel}. */
export interface AboutPanelProps {
  /** i18n translator supplied by the shell. */
  readonly t: AboutT;
  /** Optional test seam for notices text. Defaults to the generated bundled asset. */
  readonly notices?: string;
  /** Optional test seam for dialect metadata. Defaults to the bundled dialects. */
  readonly dialects?: readonly DialectTable[];
}

/** Dockable About panel content. */
export const AboutPanel: Component<AboutPanelProps> = (props) => {
  const notices = createMemo(() => props.notices ?? NOTICES_TEXT);
  const dialects = createMemo(() => bundledDialectInfo(props.t, props.dialects));

  return (
    <section class="mvp-about" aria-labelledby="mvp-about-title">
      <header class="mvp-about__header">
        <p class="mvp-about__eyebrow">MVPlanner</p>
        <h2 id="mvp-about-title">{props.t('about.title')}</h2>
        <p class="mvp-about__description">{props.t('about.description')}</p>
      </header>

      <dl class="mvp-about__meta" aria-label={props.t('about.title')}>
        <div class="mvp-about__meta-row">
          <dt>{props.t('about.appVersion')}</dt>
          <dd>MVPlanner {APP_VERSION}</dd>
        </div>
        <div class="mvp-about__meta-row">
          <dt>{props.t('about.apiVersion')}</dt>
          <dd>{EXT_API_VERSION}</dd>
        </div>
        <div class="mvp-about__meta-row">
          <dt>{props.t('about.buildHash')}</dt>
          <dd>{BUILD_HASH}</dd>
        </div>
      </dl>

      <section class="mvp-about__card" aria-labelledby="mvp-about-dialects">
        <h3 id="mvp-about-dialects">{props.t('about.dialects')}</h3>
        <ul class="mvp-about__dialects">
          <For each={dialects()}>
            {(dialect) => (
              <li>
                <span class="mvp-about__dialect-name">{dialect.name}</span>
                <span class="mvp-about__dialect-version">
                  {props.t('about.dialectVersion')}: {dialect.version}
                </span>
              </li>
            )}
          </For>
        </ul>
      </section>

      <p class="mvp-about__privacy">{props.t('about.localFirst')}</p>

      <section class="mvp-about__card mvp-about__licenses" aria-labelledby="mvp-about-licenses">
        <h3 id="mvp-about-licenses">{props.t('about.licenses')}</h3>
        <p>{props.t('about.licensesSummary')}</p>
        <Show
          when={notices().trim().length > 0}
          fallback={<p class="mvp-about__empty">{props.t('about.noticesEmpty')}</p>}
        >
          <pre class="mvp-about__notices" data-testid="about-notices" tabindex="0">
            {notices()}
          </pre>
        </Show>
      </section>
    </section>
  );
};
