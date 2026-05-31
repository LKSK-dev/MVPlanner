/**
 * i18n shim (T0.1). All user-facing strings route through `t()` from day one
 * (conventions plan/implementation/00 §0.3). The full runtime-switchable
 * catalog + locale formatting lands in T0.8; this keeps the call-site contract
 * stable so no hard-coded UI copy accumulates.
 */
const en: Record<string, string> = {
  'app.name': 'MVPlanner',
  'app.tagline': 'Modern MAVLink Ground Control',
  'nav.flight': 'Flight',
  'nav.plan': 'Plan',
  'nav.setup': 'Setup',
  'nav.config': 'Config',
  'nav.logs': 'Logs',
  'nav.sim': 'Sim',
  'screen.placeholder': '{screen} — coming in a later milestone',
  'conn.disconnected': 'Disconnected',
};

export type MessageVars = Record<string, string | number>;

/** Translate a key, substituting `{var}` placeholders. Falls back to the key. */
export function t(key: string, vars?: MessageVars): string {
  let s = en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}
