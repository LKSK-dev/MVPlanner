# Extension API Reference

Task T7.5 lives in `src/ui/screens/sim/api-ref` because the reference is developer tooling for the Sim/extensions area. The implementation is split into:

- `model.ts` — pure `.d.ts` parsing and permission joining from `CAPABILITY_MAP`.
- `api-reference.tsx` — thin Solid rendering: grouped list, search and copy-signature button.
- `register.tsx` — `createApiReferencePanel()` plus `registerApiReference()` for palette integration.

`buildBundledApiReferenceMembers()` reads `buildExtApiDts(EXT_API_VERSION)` and joins each extracted `ctx.*` member to the exported capability map. Tests can pass a small declaration snippet directly to `extractApiReferenceMembers()` so parsing behavior is deterministic and does not depend on the generated bundle.
