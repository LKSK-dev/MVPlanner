/**
 * Recents module surface (spec docs/appsettings §5.1/§7.3): records and re-opens
 * recently used plans/logs/tlogs/param files, with offline content caching.
 */
export {
  type RecentEntry,
  type RecentKind,
  type RecentsStore,
  type RecentsStoreOptions,
  type RecordInput,
  createRecentsStore,
} from './store';
