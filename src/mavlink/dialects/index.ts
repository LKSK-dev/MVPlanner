/**
 * Bundled, generated MAVLink dialect tables (T1.2; spec plan/03 §3.1).
 *
 * The JSON files in `generated/` are produced by `scripts/gen-dialects.py` from
 * pymavlink's already-merged v2.0 dialect modules. They are typed here as the
 * FROZEN {@link DialectTable} contract. Runtime import of arbitrary XML/JSON
 * dialects is a later task (T1.2 build note); this module only exposes the
 * built-in tables.
 *
 * @see scripts/gen-dialects.py — regenerate after a pymavlink bump.
 */
import type { DialectTable } from '../../contracts';

import ardupilotmegaJson from './generated/ardupilotmega.json';
import commonJson from './generated/common.json';

// Generated JSON is validated for structural correctness by the unit tests
// (`test/unit/dialects.test.ts`), so the import is cast to the frozen contract
// type rather than structurally re-checked (which would bloat type-check time).
export const commonDialect: DialectTable = commonJson as unknown as DialectTable;
export const ardupilotmegaDialect: DialectTable = ardupilotmegaJson as unknown as DialectTable;

/**
 * All built-in dialect tables. `ardupilotmega` is the superset (it bundles the
 * common/standard/minimal include chain); `common` is the lighter default.
 */
export const BUILTIN_DIALECTS: readonly DialectTable[] = [commonDialect, ardupilotmegaDialect];
