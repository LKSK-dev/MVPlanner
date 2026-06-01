# About panel

T9.2 owns this shell contribution:

- `registerAbout()` registers the dockable About panel and the `About MVPlanner` command-palette entry.
- `AboutPanel` shows app/API/build metadata, bundled MAVLink dialect rows, the local-first/no-telemetry statement, and the generated license notices.
- `notices.generated.ts` is produced by `node scripts/gen-notices.mjs` from runtime npm dependencies and is imported as a string so licenses are inlined into the single-file build.
