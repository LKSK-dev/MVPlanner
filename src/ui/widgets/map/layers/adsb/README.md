# ADS-B traffic layer (T8.8)

Display-only ADS-B support for the map overlay system.

```ts
const store = new TrafficStore({ now: () => performance.now() });
const unsubscribe = connectTrafficStore(mavlinkHost, store);
const removeLayer = map.addLayer(createAdsbTrafficLayer(() => store.all()));
```

For hover/selection, project the current store snapshot with
`projectTrafficTargets(...)`, pick a screen point with `pickTrafficTarget(...)`,
and show `trafficDetails(...)` in the owning screen/popup. The frozen `MapLayer`
contract is render-only, so pointer ownership stays with the Flight map assembly.

Pure/tested pieces: MAVLink field normalization, aging/eviction, projection,
aircraft icon rotation, hit-testing and details formatting. Canvas drawing is
happy-dom-deferred: the layer computes geometry first, then exits when
`getContext('2d')` is unavailable.
