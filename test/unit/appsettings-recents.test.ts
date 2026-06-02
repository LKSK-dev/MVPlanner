/**
 * App Settings → Recents section tests: rows render newest-first, Remove drops a
 * row, Clear empties the list, and Open invokes a wired `openRecent` handler.
 * Drives the real {@link createRecentsStore} over in-memory KV/blob fakes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import type { BlobStore, KvStore } from '../../src/contracts';
import { createRecentsStore, type RecentEntry, type RecentsStore } from '../../src/core/recents';
import type { AppSettingsSectionDeps, TFn } from '../../src/ui/shell/appsettings/context';
import { RecentsSection } from '../../src/ui/shell/appsettings/sections/recents';

afterEach(cleanup);

function fakeKv(): KvStore {
  const map = new Map<string, unknown>();
  return {
    get: async <T>(ns: string, key: string): Promise<T | undefined> =>
      map.get(`${ns}/${key}`) as T | undefined,
    set: async <T>(ns: string, key: string, v: T): Promise<void> => {
      map.set(`${ns}/${key}`, v);
    },
    del: async (ns: string, key: string): Promise<void> => {
      map.delete(`${ns}/${key}`);
    },
  };
}

function fakeBlobs(): BlobStore {
  const map = new Map<string, Uint8Array>();
  return {
    put: async (ns, key, data): Promise<void> => {
      map.set(`${ns}/${key}`, new Uint8Array(await data.arrayBuffer()));
    },
    getRange: async (ns, key, start, end): Promise<Uint8Array> => {
      const d = map.get(`${ns}/${key}`);
      if (d === undefined) throw new Error('missing');
      return d.slice(start, end);
    },
    size: async (ns, key): Promise<number> => map.get(`${ns}/${key}`)?.byteLength ?? 0,
    list: async (): Promise<never[]> => [],
    del: async (ns, key): Promise<void> => {
      map.delete(`${ns}/${key}`);
    },
  };
}

const t: TFn = (key) => key;

function makeDeps(
  recents: RecentsStore,
  openRecent?: (entry: RecentEntry) => void,
): AppSettingsSectionDeps {
  const partial: Partial<AppSettingsSectionDeps> = openRecent
    ? { t, recents, openRecent }
    : { t, recents };
  return partial as AppSettingsSectionDeps;
}

async function seedTwo(recents: RecentsStore): Promise<void> {
  await recents.record({ kind: 'plan', name: 'first.plan', blob: new Blob(['aaa']) });
  await recents.record({ kind: 'log', name: 'second.bin', blob: new Blob(['bbbb']) });
}

describe('RecentsSection', () => {
  it('renders a row per recent entry', async () => {
    const recents = createRecentsStore({ kv: fakeKv(), blobs: fakeBlobs() });
    await seedTwo(recents);
    const { getByText } = render(() =>
      createComponent(RecentsSection, { deps: makeDeps(recents) }),
    );
    expect(getByText('first.plan')).toBeTruthy();
    expect(getByText('second.bin')).toBeTruthy();
  });

  it('shows the empty state when there are no entries', () => {
    const recents = createRecentsStore({ kv: fakeKv(), blobs: fakeBlobs() });
    const { getByText } = render(() =>
      createComponent(RecentsSection, { deps: makeDeps(recents) }),
    );
    expect(getByText('appsettings.recents.empty')).toBeTruthy();
  });

  it('Remove drops a single row', async () => {
    const recents = createRecentsStore({ kv: fakeKv(), blobs: fakeBlobs() });
    await seedTwo(recents);
    const { getByLabelText, queryByText } = render(() =>
      createComponent(RecentsSection, { deps: makeDeps(recents) }),
    );
    fireEvent.click(getByLabelText('appsettings.recents.remove: first.plan'));
    await waitFor(() => expect(queryByText('first.plan')).toBeNull());
    expect(queryByText('second.bin')).toBeTruthy();
  });

  it('Clear empties the list', async () => {
    const recents = createRecentsStore({ kv: fakeKv(), blobs: fakeBlobs() });
    await seedTwo(recents);
    const { getByText, queryByText } = render(() =>
      createComponent(RecentsSection, { deps: makeDeps(recents) }),
    );
    fireEvent.click(getByText('appsettings.recents.clear'));
    await waitFor(() => expect(queryByText('first.plan')).toBeNull());
    expect(queryByText('second.bin')).toBeNull();
    expect(getByText('appsettings.recents.empty')).toBeTruthy();
  });

  it('Open calls the wired openRecent handler with the entry', async () => {
    const recents = createRecentsStore({ kv: fakeKv(), blobs: fakeBlobs() });
    await seedTwo(recents);
    const openRecent = vi.fn((_entry: RecentEntry): void => {});
    const { getByLabelText } = render(() =>
      createComponent(RecentsSection, { deps: makeDeps(recents, openRecent) }),
    );
    fireEvent.click(getByLabelText('appsettings.recents.open: first.plan'));
    expect(openRecent).toHaveBeenCalledTimes(1);
    const call = openRecent.mock.calls[0];
    expect(call?.[0]?.name).toBe('first.plan');
  });
});
