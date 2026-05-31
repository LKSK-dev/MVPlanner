/**
 * Build an {@link IdNameResolver} from dialect tables (task T1.4).
 *
 * Optional: the registry resolves names from observed traffic on its own, but a
 * dialect-backed resolver lets queries reference messages that have not yet
 * appeared on the wire. Kept separate so the registry stays decoupled from the
 * dialect data (callers may inject any resolver instead).
 */
import type { DialectTable } from '../../contracts';
import type { IdNameResolver } from './types';

/**
 * Create a resolver over the given dialect tables. Earlier tables win on
 * duplicate names/ids, matching the codec's name-index precedence.
 */
export function createDialectResolver(dialects: readonly DialectTable[]): IdNameResolver {
  const idByName = new Map<string, number>();
  const nameById = new Map<number, string>();
  for (const dialect of dialects) {
    for (const meta of Object.values(dialect.messages)) {
      if (!idByName.has(meta.name)) idByName.set(meta.name, meta.id);
      if (!nameById.has(meta.id)) nameById.set(meta.id, meta.name);
    }
  }
  return {
    idOf: (name) => idByName.get(name),
    nameOf: (id) => nameById.get(id),
  };
}
