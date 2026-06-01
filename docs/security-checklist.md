# Security review checklist (T8.12)

Spec: plan/08 §8.3, plan/07 §7.7, plan/10 §10.8. See `SECURITY.md` for the full
posture + rationale. Re-run this checklist at each release.

| #   | Check                                                                           | How verified                                                                                      | Status |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------ |
| 1   | **Strict CSP holds** in the shipped artifact                                    | `index.html` meta + `scripts/postbuild.mjs` build-time assertion + `test/unit/csp-policy.test.ts` | ✅     |
| 2   | CSP `object-src/base-uri/frame-ancestors` are `'none'`                          | csp-policy test                                                                                   | ✅     |
| 3   | `script-src 'unsafe-eval'` is **only** for the first-party console (documented) | SECURITY.md §1; console is main-realm first-party, imported code is sandboxed                     | ✅     |
| 4   | `connect-src` openness is justified + egress is surfaced (not analytics)        | SECURITY.md §1/§4; Settings → Network                                                             | ✅     |
| 5   | **Signing keys + API keys encrypted at rest** (PBKDF2 → AES-GCM)                | `src/core/secrets`; `test/unit/secrets-store.test.ts` round-trip                                  | ✅     |
| 6   | **Wrong passphrase fails** + store stays locked                                 | secrets-store test                                                                                | ✅     |
| 7   | **Only ciphertext persisted** (no plaintext at rest)                            | secrets-store "no plaintext at rest" test                                                         | ✅     |
| 8   | **Secrets never logged**; export is redaction-aware                             | secrets-store export test; no `console.*` of secret material                                      | ✅     |
| 9   | **Egress fully listed** (map host, active link, ext grants, live log)           | `Settings → Network`; `test/unit/egress-network.test.ts`                                          | ✅     |
| 10  | **No analytics / no phone-home** statement present                              | Network section `network-no-phone-home`                                                           | ✅     |
| 11  | **No untrusted eval in the main realm** — imported extensions sandboxed         | runtime selector; `test/unit/sandbox-runtime-selector.test.ts`                                    | ✅     |
| 12  | Bundled examples trusted (in-process); imports untrusted (sandbox) by default   | selector test; `src/ui/screens/sim/controller.ts`                                                 | ✅     |
| 13  | Extension vehicle actions gated (armed-aware confirm) + audited with origin     | `src/ext/permissions/broker.ts` (pre-existing T7.2)                                               | ✅     |
| 14  | Extension `net:<host>` egress permission-gated + recorded                       | broker `recordEgress`; egress log                                                                 | ✅     |
| 15  | **Dependency audit** clean                                                      | `npm audit` → 0 vulnerabilities (T8.12)                                                           | ✅     |
| 16  | Secrets degrade safely when WebCrypto unavailable (no plaintext fallback)       | `createAppSecretStore` returns `undefined`; wiring no-ops                                         | ✅     |

## Residual risks / follow-ups

- **Sandboxed-extension UI contributions** (mount over RPC / iframe) and the
  **real-Worker spawner for imported code strings** remain browser/e2e-deferred
  (consistent with T7.2). The per-extension trust selector is in place; wiring a
  CSP-compatible blob-Worker spawner in `App` is the remaining step.
- **Map API key plaintext duplication:** the key is encrypted into the secret
  store (write-through), but the reactive store still persists the full
  `settings` object (including `apiKey`) in plaintext via its generic KV
  persistence. Making the secret store the _sole_ at-rest home for the key needs
  a small `core/store` change (exclude secret fields from the persisted slice) —
  out of T8.12's owned scope; recommended follow-up.
- **`script-src 'unsafe-eval'`** is accepted for the first-party scripting
  console; a future hardening moves the evaluator into the sandbox worker.
- The empty-passphrase ("device") secret wrap is obfuscation-level only; users
  who need real at-rest protection must set a passphrase (`rekey`).
