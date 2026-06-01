/**
 * Well-known secret ids (task T8.12; spec plan/07 §7.7).
 *
 * Stable keys under which the app stores its encrypted-at-rest secrets in the
 * {@link import('./secret-store').SecretStore}: the MAVLink v2 signing key and
 * the map/tile provider API key. Centralised so the writers (Settings screen,
 * connection wiring) and the Network transparency UI agree on ids.
 */

/** MAVLink v2 signing key (32 bytes) — see plan/03 §3.1 signing. */
export const SECRET_MAVLINK_SIGNING_KEY = 'mavlink.signingKey';

/** Map/tile provider API key — only ever sent to the configured provider. */
export const SECRET_MAP_API_KEY = 'map.apiKey';
