/**
 * `ui/shell/connection` public surface (T1.10; spec plan/03 §3.5 / §3.7,
 * plan/04 §4.1, plan/05 §5.2). The connection drawer + provider that wire the
 * {@link import('../../../transport/manager').ConnectionManager} into the app
 * store, command palette and top-bar chip. Cross-module consumers import from
 * here, never deep paths (conventions plan/implementation/00 §0.3).
 */
export { ConnectionProvider, type ConnectionProviderProps } from './provider';
export { ConnectionDrawer } from './drawer';
export { ConnectionContext, useConnection, type ConnectionContextValue } from './context';
export {
  normalizeConfigSchema,
  type FormField,
  type SelectField,
  type TextField,
  type NumberField,
  type FileField,
} from './config-form';
