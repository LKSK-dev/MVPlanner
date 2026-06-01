/**
 * Solid view for the in-app extension API reference (task T7.5).
 *
 * Rendering stays intentionally thin: callers supply members already extracted
 * by the pure parser in `model.ts`; this component only handles grouping,
 * filtering and the copy-signature affordance.
 */
import { For, Show, createMemo, createSignal, type Component } from 'solid-js';
import './api-reference.css';
import './messages';
import {
  API_REFERENCE_GROUP_ORDER,
  filterApiReferenceMembers,
  type ApiReferenceGroup,
  type ApiReferenceMember,
  type ApiReferencePermission,
} from './model';

/** Translation function shape used by panels and tests. */
export type ApiReferenceT = (key: string, vars?: Record<string, string | number>) => string;

/** Props for {@link ApiReference}. */
export interface ApiReferenceProps {
  readonly members: readonly ApiReferenceMember[];
  readonly t: ApiReferenceT;
}

interface ApiReferenceGroupView {
  readonly group: ApiReferenceGroup;
  readonly members: readonly ApiReferenceMember[];
}

/** Searchable/tree-style extension API reference. */
export const ApiReference: Component<ApiReferenceProps> = (props) => {
  const [query, setQuery] = createSignal('');
  const [copiedPath, setCopiedPath] = createSignal<string | undefined>();

  const filtered = createMemo<readonly ApiReferenceMember[]>(() =>
    filterApiReferenceMembers(props.members, query()),
  );

  const groups = createMemo<readonly ApiReferenceGroupView[]>(() => groupMembers(filtered()));

  const copy = (member: ApiReferenceMember): void => {
    void copySignature(member.signature).then((ok) => {
      if (!ok) return;
      setCopiedPath(member.path);
      window.setTimeout(
        () => setCopiedPath((current) => (current === member.path ? undefined : current)),
        1200,
      );
    });
  };

  return (
    <section class="mvp-api-ref" aria-label={props.t('apiref.title')}>
      <header class="mvp-api-ref__header">
        <div>
          <h2 class="mvp-api-ref__title">{props.t('apiref.title')}</h2>
          <p class="mvp-api-ref__description">{props.t('apiref.description')}</p>
        </div>
        <label class="mvp-api-ref__search">
          <span>{props.t('apiref.search.label')}</span>
          <input
            type="search"
            value={query()}
            placeholder={props.t('apiref.search.placeholder')}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
      </header>

      <Show
        when={groups().length > 0}
        fallback={<p class="mvp-api-ref__empty">{props.t('apiref.empty')}</p>}
      >
        <div class="mvp-api-ref__groups">
          <For each={groups()}>
            {(group) => (
              <section class="mvp-api-ref__group" aria-labelledby={`apiref-group-${group.group}`}>
                <h3 id={`apiref-group-${group.group}`} class="mvp-api-ref__group-title">
                  {props.t(`apiref.group.${group.group}`)}
                </h3>
                <ul class="mvp-api-ref__members">
                  <For each={group.members}>
                    {(member) => (
                      <li class="mvp-api-ref__member">
                        <div class="mvp-api-ref__member-heading">
                          <code class="mvp-api-ref__path">ctx.{member.path}</code>
                          <span class="mvp-api-ref__permission">
                            {props.t('apiref.permission')}:{' '}
                            {permissionText(member.permission, props.t)}
                          </span>
                        </div>
                        <pre class="mvp-api-ref__signature">
                          <code>{member.signature}</code>
                        </pre>
                        <Show when={member.description}>
                          {(description) => (
                            <p class="mvp-api-ref__member-description">{description()}</p>
                          )}
                        </Show>
                        <button
                          type="button"
                          class="mvp-api-ref__copy"
                          onClick={() => copy(member)}
                        >
                          {copiedPath() === member.path
                            ? props.t('apiref.copy.done')
                            : props.t('apiref.copy')}
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </section>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
};

function groupMembers(members: readonly ApiReferenceMember[]): ApiReferenceGroupView[] {
  const byGroup = new Map<ApiReferenceGroup, ApiReferenceMember[]>();
  for (const member of members) {
    const list = byGroup.get(member.group);
    if (list === undefined) byGroup.set(member.group, [member]);
    else list.push(member);
  }
  return [...byGroup.entries()]
    .sort(([a], [b]) => groupOrder(a) - groupOrder(b))
    .map(([group, list]) => ({ group, members: list }));
}

function groupOrder(group: ApiReferenceGroup): number {
  const index = API_REFERENCE_GROUP_ORDER.indexOf(group);
  return index === -1 ? API_REFERENCE_GROUP_ORDER.length : index;
}

function permissionText(permission: ApiReferencePermission, t: ApiReferenceT): string {
  if (permission === null) return t('apiref.permission.none');
  if (permission === undefined) return t('apiref.permission.unlisted');
  return permission;
}

async function copySignature(signature: string): Promise<boolean> {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard === undefined) return false;
  await clipboard.writeText(signature);
  return true;
}
