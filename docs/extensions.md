# Extensions & scripting

Extensibility is a **core feature** of MVPlanner, not an add-on. There is one
stable, versioned JavaScript API (`mvp.*`) used two ways:

1. **Extensions** — packaged, persistent add-ons with a manifest, lifecycle, and
   declared permissions. They can add panels, commands, map layers, MAVLink
   handlers, transports, themes, and background automation.
2. **Scripting** — an in-app console/editor for live, ad-hoc JavaScript against
   the same API.

> **North-star:** anything the built-in UI can do, an extension can do — using
> the _same_ API the core uses internally.

This page is a tutorial built on the **seven bundled example extensions** in
[`extensions/`](../extensions/), which double as living docs and API smoke
tests. The full, authoritative signatures are the shipped TypeScript types and
the in-app **API reference** (Sim & Dev Tools → API reference).

## Anatomy of an extension

A minimal extension is a single `*.mvpext.js` module that exports a declarative
`manifest`, an `activate(ctx)` function, and an optional `deactivate()`:

```js
export const manifest = {
  id: 'com.example.hello',
  name: 'Hello Battery',
  version: '1.0.0',
  apiVersion: '^1.0',
  description: 'Adds a panel that shows battery voltage and warns when low.',
  author: 'Example',
  permissions: ['telemetry:read', 'ui:panel', 'notify'],
  // `contributes` declares STATIC, structured-clone-safe metadata so the host
  // can render the panel before activation. Implementations are registered in
  // activate().
  contributes: { panels: [{ id: 'battery', title: 'Battery', icon: 'battery' }] },
};

export function activate(ctx) {
  let el;
  const panelOff = ctx.ui.registerPanel({
    id: 'battery',
    title: 'Battery',
    icon: 'battery',
    mount(host) {
      el = host;
      return () => {
        el = undefined;
      };
    },
  });
  const off = ctx.mavlink.on(
    'SYS_STATUS',
    (m) => {
      const v = Number(m.fields.voltage_battery) / 1000;
      if (el) el.textContent = `${v.toFixed(2)} V`;
      if (v < 10.5) ctx.notify.warn(`Low battery: ${v.toFixed(2)} V`);
    },
    { rateHz: 1 },
  );
  ctx.onDispose(panelOff);
  ctx.onDispose(off);
}

export function deactivate() {} // optional
```

That panel + telemetry handler + low-battery alert is under 30 lines of body —
the parity goal for the API. (This is exactly what
[`battery-plus.mvpext.js`](../extensions/battery-plus.mvpext.js) does.)

### Manifest fields

`id`, `name`, `version`, `apiVersion` (a semver range like `^1.0`),
`description`, `author`, `permissions[]`, and optional `contributes`,
`dependencies`, `minAppVersion`, `icon`, `homepage`.

`contributes` carries **declarative metadata only** (no functions) so the
manifest can be persisted to IndexedDB: `panels`, `commands`, `themes`,
`mapLayers`, `transports`, `settings`. The actual implementations are registered
at `activate()`.

### Lifecycle

- **Install/import** → manifest validated → permissions reviewed by the user →
  stored locally (IndexedDB) → enabled.
- **Activate** — `activate(ctx)` runs when an activation event fires (lazy by
  default to keep startup fast).
- **Dispose** — every subscription/timer/DOM mount is tracked via
  `ctx.onDispose(...)` and torn down on disable/uninstall/reload, so there are no
  leaks. Always register your disposers.
- **Hot reload** — editing a dev extension re-runs `activate` cleanly.
- **Error isolation** — a throwing or looping extension is paused with a surfaced
  error; it cannot crash the core.

## Permissions

Extensions declare `permissions[]`; the user approves them on install and can
review or revoke them later. **No permission ⇒ the matching `ctx.*` member is
absent** (not a silent no-op), so capability checks are explicit — that is why
the examples guard with `if (!ctx.map) return;` and `ctx.command?.setMode(...)`.

| Scope            | Grants                                           |
| ---------------- | ------------------------------------------------ |
| `telemetry:read` | `ctx.mavlink.on/latest/rate/requestInterval`     |
| `mavlink:send`   | `ctx.mavlink.send(...)`                          |
| `command`        | `ctx.command.*` (arm/setMode/takeoff/rtl/…)      |
| `params:write`   | `ctx.params.*` (fetch/get/set/onChange)          |
| `mission:write`  | `ctx.mission.*` (read/write/current)             |
| `ui:panel`       | `ctx.ui.*` panels/commands/menus, `ctx.theme`    |
| `map`            | `ctx.map.addLayer/on`                            |
| `notify`         | `ctx.notify.*`                                   |
| `files`          | `ctx.files.openForRead/saveAs`                   |
| `net:<host>`     | `ctx.net.fetch(...)` to that host (egress shown) |
| `storage`        | `ctx.storage.get/set` (namespaced per-extension) |
| `transport`      | `ctx.transports.register(...)`                   |
| `dialect`        | `ctx.mavlink.loadDialect(...)`                   |

**High-risk** scopes that can change vehicle state — `command`, `mavlink:send`,
`params:write`, `mission:write` — are flagged in the install prompt, and the host
can require an extra confirmation when the extension issues a real
arm/mode/mission/motor command, especially while armed/in-air. Every
extension-initiated vehicle action and network call is written to the **action
audit log** with the extension id.

## The `mvp` / `ctx` API at a glance

Extensions receive a capability-scoped `ctx`; the scripting console gets the same
shape as a global `mvp`. All async calls return Promises.

```ts
ctx.version; // API semver string

// Connection & vehicle
ctx.connection.state();          ctx.connection.on('state', cb);
ctx.vehicles.list();             ctx.vehicles.active();  ctx.vehicles.on('change', cb);

// MAVLink (read)                 // perm: telemetry:read
ctx.mavlink.on(name, cb, { sysid?, compid?, rateHz? });
ctx.mavlink.latest(name);        ctx.mavlink.rate(name);  ctx.mavlink.requestInterval(name, hz);
ctx.mavlink.send?(name, fields, { signed? });   // perm: mavlink:send

// Commands / params / mission    // present only with the matching permission
ctx.command?.arm(true);  ctx.command?.setMode('AUTO');  ctx.command?.takeoff(alt);  ctx.command?.rtl();
ctx.params?.fetchAll(onProgress?, signal?);  ctx.params?.get(name);
ctx.params?.set(name, value);    ctx.params?.onChange(cb);
ctx.mission?.read(type?);        ctx.mission?.write(m);  ctx.mission?.current();

// UI / map / theme               // perm: ui:panel / map
ctx.ui?.registerPanel({ id, title, icon, mount(el, api) });
ctx.ui?.registerCommand({ id, title, run });   // appears in the command palette
ctx.ui?.toast(kind, msg);        ctx.ui?.confirm({ title, body, destructive?, armedAware? });
ctx.map?.addLayer({ id, render });               ctx.map?.on('click', cb);
ctx.theme?.register(tokens);

// Data / storage / files / net / transports
ctx.logs?.openCurrentTlog();     ctx.logs?.queryDataFlash(expr, range);
ctx.storage.get(key);            ctx.storage.set(key, value);     // namespaced KV
ctx.files?.openForRead();        ctx.files?.saveAs(blob, name);   // perm: files
ctx.net?.fetch(url, init);       // perm: net:<host>
ctx.transports?.register(factory);               // perm: transport

// Lifecycle & utilities
ctx.onDispose(fn);  ctx.log.info/warn/error(...);  ctx.notify.info/warn/error(...);
ctx.timers.setInterval(fn, ms);  ctx.timers.raf(fn);
ctx.events.on(topic, cb);        ctx.events.emit(topic, payload);
```

TypeScript types ship for editor autocomplete; experimental APIs live under
`ctx.experimental.*`.

## The bundled examples (your reference set)

Seven first-party extensions ship in [`extensions/`](../extensions/). Each is a
short, focused demonstration of one part of the API:

| Extension                                                                | Permissions                                  | Demonstrates                                                      |
| ------------------------------------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------- |
| [Battery+ panel](../extensions/battery-plus.mvpext.js)                   | `telemetry:read`, `ui:panel`, `notify`       | Panel registration, `SYS_STATUS` handler, low-battery alert.      |
| [Geo-tagger](../extensions/geo-tagger.mvpext.js)                         | `telemetry:read`, `storage`                  | Camera-trigger handler + active-vehicle GPS + namespaced storage. |
| [Param diff & presets](../extensions/param-diff-presets.mvpext.js)       | `telemetry:read`, `params:write`, `ui:panel` | Panel + commands, param diff, confirmable preset writes.          |
| [Custom NMEA/ADSB layer](../extensions/custom-nmea-adsb-layer.mvpext.js) | `map`, `telemetry:read`                      | `ctx.map.addLayer` overlay driven by telemetry.                   |
| [Auto-test script pack](../extensions/auto-test-script-pack.mvpext.js)   | `command`, `telemetry:read`                  | Safe scripted SITL sequences triggered via `ctx.events`.          |
| [Theme pack](../extensions/theme-pack.mvpext.js)                         | `ui:panel`                                   | `ctx.theme.register` token set + teardown.                        |
| [Custom transport demo](../extensions/custom-transport-demo.mvpext.js)   | `transport`                                  | `ctx.transports.register` echo transport factory.                 |

### A command + confirmable write (from Param diff & presets)

```js
ctx.ui.registerCommand({
  id: 'param-diff.apply-safe-gains',
  title: 'Param Diff: Apply safe demo gains',
  run: async () => {
    if (!(await ctx.ui.confirm({ title: 'Apply demo preset?', body: 'PSC_*', armedAware: true })))
      return;
    await ctx.params.set('PSC_POSXY_P', 1.0);
  },
});
```

`armedAware: true` strengthens the confirmation when the vehicle is armed or in
the air. Registered commands also appear in the command palette (`Ctrl/Cmd-K`).

### A custom map layer (from Custom NMEA/ADSB layer)

```js
const layerOff = ctx.map.addLayer({
  id: 'examples.adsb-nmea',
  render(mapCtx) {
    const cctx = mapCtx.canvas.getContext('2d');
    if (ownship && cctx) {
      const [x, y] = mapCtx.project(ownship.lat, ownship.lon);
      cctx.beginPath();
      cctx.arc(x, y, 5, 0, Math.PI * 2);
      cctx.fill();
    }
  },
});
ctx.onDispose(layerOff);
```

The renderer only receives a canvas + `project()` — it cannot reach map
internals or other extensions' state.

## Installing & enabling

Open **Sim & Dev Tools → Extensions manager**:

1. **Import** an extension by **drag-drop**, **file picker**, or **URL** (a
   single `.mvpext.js`, or a `.zip`/folder with a `manifest.json`). Everything
   works offline.
2. A **permission prompt** lists every requested scope, flagging high-risk
   vehicle-control permissions. Approve to install.
3. The extension is stored in IndexedDB and **enabled**. Use the manager to
   **enable/disable/reload** it or **review/revoke** its permissions later.

Incompatible `apiVersion` ranges are warned about, and unsafe extensions are
refused.

## Scripting console

For live, ad-hoc work, open **Sim & Dev Tools → Scripting console**. It is a real
code editor (syntax highlighting, autocomplete from the API types, history,
multi-line) exposing the same API as a global **`mvp`**, with **top-level
`await`**. The output pane pretty-prints returned values and shows logs and
errors with stack traces scoped to your code.

```js
// Read all PSC_* params, then nudge one and switch to LOITER.
const ps = (await mvp.params.fetchAll()).filter((p) => p.name.startsWith('PSC_'));
for (const p of ps) console.log(p.name, p.value);
await mvp.params.set('PSC_POSXY_P', 1.0);
mvp.command.setMode('LOITER');
```

Great for bulk parameter changes, ad-hoc telemetry math, log queries, custom
test sequences, and teaching MAVLink. Save scripts as **snippets/macros**, bind
them to commands/shortcuts/buttons, or run them on events (e.g. "on connect, set
these params"), and export/import them. The console runs under a scripting
permission profile you control, and the same safety confirmations and audit
logging apply.

## Stability

The `mvp` API is **semver-versioned** (`mvp.version`). Breaking changes bump the
major version with a migration note; deprecated APIs warn for at least one minor
cycle before removal. A conformance suite exercises the public API so refactors
cannot silently break extensions.
