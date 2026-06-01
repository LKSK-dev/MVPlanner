# Failsafe setup step (T5.8)

`createFailsafeStep({ params, getVehicleClass })` returns a Setup wizard `SetupStep` for ArduPilot failsafe parameters.

The step reads current values through `ParamClient.get`, writes edits through `ParamClient.set`, and skips parameters that are absent from the cache.

## Parameter mapping

- **RC:** `FS_THR_ENABLE` (0 Disabled, 1 RTL, 2 Continue in Auto, 3 Land), `FS_THR_VALUE`
- **Battery:** `BATT_LOW_VOLT`, `BATT_LOW_MAH`, `BATT_FS_LOW_ACT`, `BATT_CRT_VOLT`, `BATT_FS_CRT_ACT`
- **GCS:** `FS_GCS_ENABLE`
- **EKF / GPS:** `FS_EKF_ACTION`, `FS_EKF_THRESH`

Descriptions and units come from the local curated map, with available `param.meta` / `mavlink/param-meta` values filling numeric metadata where present.
