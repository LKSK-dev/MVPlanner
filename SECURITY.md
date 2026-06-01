# MVPlanner — Security Posture (T8.12)

Spec: plan/08 §8.3 (security), plan/07 §7.7 (security & privacy of stored data),
plan/06 §6.5/§6.6 (extension sandbox + permissions).

MVPlanner is a **local-first, offline-capable, single-file** ground control
station. There is **no backend, no analytics, and nothing phones home**. Every
network destination is user-configured and surfaced in **Settings → Network**.

---

## 1. Content-Security-Policy

The single-file artifact (`dist/MVPlanner.html`) ships a strict CSP `<meta>`
(`index.html`, preserved into the build and asserted by `scripts/postbuild.mjs`):

```
default-src 'self';
object-src 'none';
base-uri 'none';
frame-ancestors 'none';
worker-src blob: 'self';
img-src 'self' data: blob: https:;
style-src 'self' 'unsafe-inline';
font-src 'self' data:;
script-src 'self' 'unsafe-inline' 'unsafe-eval';
connect-src 'self' https: http: ws: wss: data: blob:
```

### Directive rationale

| Directive         | Value                                      | Why                                                                                                         |
| ----------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `default-src`     | `'self'`                                   | Deny-by-default baseline for any directive not named.                                                       |
| `object-src`      | `'none'`                                   | No `<object>`/`<embed>`/plugins — no legacy plugin attack surface.                                          |
| `base-uri`        | `'none'`                                   | Block `<base>` injection that could re-target relative URLs.                                                |
| `frame-ancestors` | `'none'`                                   | The app may not be framed — anti-clickjacking.                                                              |
| `worker-src`      | `blob: 'self'`                             | The inlined MAVLink/log/map workers + the sandboxed-extension worker run from `blob:` URLs.                 |
| `img-src`         | `'self' data: blob: https:`                | Map raster tiles come from user-configured **https** providers; generated/HUD imagery uses `data:`/`blob:`. |
| `style-src`       | `'self' 'unsafe-inline'`                   | The single-file build inlines the stylesheet + uses inline style attributes (themable design tokens).       |
| `font-src`        | `'self' data:`                             | Fonts are inlined as `data:` in the single-file build.                                                      |
| `script-src`      | `'self' 'unsafe-inline' 'unsafe-eval'`     | See below.                                                                                                  |
| `connect-src`     | `'self' https: http: ws: wss: data: blob:` | See below.                                                                                                  |

### `script-src` — the `'unsafe-inline'` + `'unsafe-eval'` tradeoff

- **`'unsafe-inline'`** is **required by the single-file model**: the entire
  JS bundle is inlined into one `<script>` in `MVPlanner.html` (it runs by
  double-click from `file://`, where nonces/hashes for a hash-pinned external
  script do not apply the same way). A hash/nonce scheme is a future option if
  the app is ever served exclusively over HTTP with a build-time injected nonce.
- **`'unsafe-eval'`** is **required by the first-party scripting console**
  (`src/ext/scripting`): it evaluates user-authored snippets via `AsyncFunction`
  to give a live REPL against the MAVLink API. This is **first-party,
  user-initiated code in the main realm**, not remote code. **Imported /
  untrusted extensions do NOT run in the main realm** — they run through the
  sandbox runtime (see §3). The console is a deliberate power-user surface; the
  tradeoff is accepted for v1 and documented here. A future hardening is to move
  the console evaluator into the sandbox worker as well.

### `connect-src` — egress is user-driven, not CSP-restricted

`connect-src` intentionally allows `https:/http:/ws:/wss:`. MVPlanner connects
to **user-configured** endpoints only — vehicle bridges (ws/wss), tile providers
(https), elevation/terrain sources, and extension `net:<host>` calls. The host
set is not known at build time (it is whatever the operator types into the
connection drawer / settings), so restricting it in CSP would break the app's
core purpose. Instead, egress is **made transparent**: every destination is
listed in **Settings → Network**, extension egress is **permission-gated** by the
broker and **logged**, and there is **no analytics / no phone-home**.

---

## 2. Secrets encrypted at rest (`src/core/secrets`)

MAVLink v2 signing keys and map/tile provider API keys are encrypted at rest
with WebCrypto:

- **PBKDF2-HMAC-SHA256** (210k iterations) derives a 256-bit AES key from an
  **optional user passphrase** + a random 16-byte salt.
- **AES-GCM** (random 96-bit IV per record) encrypts each secret; only
  **ciphertext** (base64) is persisted to IndexedDB.
- AES-GCM is authenticated: a **wrong passphrase fails the decrypt** — this is
  how `unlock()` verifies a passphrase (via a stored verifier token); a failure
  raises `WrongPassphraseError` and mutates nothing.
- `lock()` drops the in-memory key; reads/writes then require `unlock()`.
- `rekey()` re-encrypts every secret under a new passphrase.
- **Secrets are never logged.** `export()` is **redaction-aware**: by default it
  emits ids only; even `{ redact: false }` emits ciphertext only — **plaintext
  never leaves the store**.
- With no passphrase (`unlock()` / empty), the wrap is obfuscation-level (the
  key is derivable by anyone who can run the app); a real passphrase provides
  meaningful at-rest protection. The UI surfaces this.

**Wiring:** the map/tile API key is routed through the secret store
(write-through on change + hydrate on startup) by `App`; the in-memory
`settings.mapSource.apiKey` consumed by the map stays as-is. Crypto + storage are
injected for testability. When WebCrypto is unavailable (non-secure context) the
wiring degrades to a no-op rather than ever storing plaintext.

---

## 3. Extensions: no untrusted eval in the main realm

- **Bundled first-party examples** are installed `trusted: true` and run in the
  **trusted in-process runtime** (they ship as vetted modules).
- **Imported / untrusted extensions** default to `trusted: false` and run through
  the **sandbox runtime** (`createSandboxRuntime`) — an isolated realm (a Web
  Worker in-browser) whose only privileged surface is the **permission broker**
  over RPC. Missing permission ⇒ the API method is **absent** from the guest
  proxy. Non-UI capabilities work over the broker RPC.
- Per-extension runtime selection is an **additive** `trusted` flag on
  `createExtensionSystem().install(...)` (`src/ext/api/system.ts`); the flag is
  session-scoped (not persisted) and defaults to untrusted on restore
  (fail-safe). The frozen `createExtensionSystem` contract was extended
  additively — no contract change.
- **Deferred:** sandboxed-extension **UI contributions** (mount over RPC / iframe)
  and a **real-Worker spawner for imported code strings** remain the
  browser/e2e-deferred path (consistent with the existing T7.2 design). Until a
  spawner is provided, the selector falls back to in-process; the selector +
  trust model are in place for when the browser spawner lands.

---

## 4. Egress transparency (Settings → Network)

A read-only panel lists every network destination:

- the configured **map-tile host** (from `settings.mapSource`),
- the **active link** (ws/wss bridge / WebRTC), reactive from connection state,
- extension **`net:<host>` grants**,
- a **live egress log** (the broker `recordEgress` sink) with a **clear** control,
- a prominent **"No analytics, no telemetry, no phone-home"** statement.

---

## 5. Dependency hygiene

`npm audit` is run as part of the security review (see the checklist). Result at
T8.12: **0 vulnerabilities**. Dependencies are pinned (see `package-lock.json`)
and minimal.

See `docs/security-checklist.md` for the reviewable checklist.
