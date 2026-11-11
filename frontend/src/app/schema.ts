import { NoteMetaType, coerceMetaValue, normalizeMetaType } from './models';

/**
 * Document schema version written by this build. Documents pulled from
 * CouchDB carry their version in the top-level `schema` field; anything older
 * than {@link CURRENT_SCHEMA} is upgraded by {@link migrateNoteDoc} before it
 * reaches the store.
 */
export const CURRENT_SCHEMA = 2;

interface MigrationResult {
  doc: Record<string, unknown>;
  changed: boolean;
}

type DocMigration = (doc: Record<string, unknown>) => MigrationResult;

/**
 * Migrations from one schema version to the next, keyed by the version they
 * start from. Documents written before the `schema` field existed never
 * carried it, so a missing or unreadable value is treated as version 1.
 */
const MIGRATIONS: Readonly<Record<number, DocMigration>> = {
  /**
   * 1 → 2: typed metadata. Older documents stored metadata entries with only
   * `id`, `key`, and `value`; fill in `type` and `options` so every stored
   * note has the full shape the editor expects.
   */
  1: (doc) => {
    const next = { ...doc };
    let changed = next['schema'] !== CURRENT_SCHEMA;

    if (Array.isArray(next['metadata'])) {
      const metadata = next['metadata'].map((entry) => {
        if (typeof entry !== 'object' || entry === null) return entry;

        const record = entry as Record<string, unknown>;
        const type = normalizeMetaType(record['type']);
        const value = typeof record['value'] === 'string' ? record['value'] : '';
        const coerced = coerceMetaValue(type, value);
        const optionsRaw = Array.isArray(record['options']) ? record['options'] : null;
        const options = optionsRaw
          ? optionsRaw.filter((option): option is string => typeof option === 'string')
          : [];

        const entryChanged = record['type'] !== type || record['value'] !== coerced || !optionsRaw;
        if (entryChanged) changed = true;

        return { ...record, type, value: coerced, options };
      });

      if (changed) next['metadata'] = metadata;
    }

    if (changed) next['schema'] = CURRENT_SCHEMA;
    return { doc: next, changed };
  },
};

export interface NoteDocMigration {
  /** The migrated document, safe to read note fields from. */
  doc: Record<string, unknown>;
  /** True when a migration ran and rewrote the document shape. */
  changed: boolean;
  /** Schema version of the input document. */
  from: number;
  /** Schema version of the returned document. */
  to: number;
}

/**
 * Brings a CouchDB note document up to {@link CURRENT_SCHEMA}. The input is
 * never mutated; unknown or newer versions are returned untouched because they
 * cannot be downgraded.
 */
export function migrateNoteDoc(doc: Record<string, unknown>): NoteDocMigration {
  const from = schemaVersion(doc);
  let current = doc;
  let changed = false;

  for (let version = from; version < CURRENT_SCHEMA; version += 1) {
    const migration = MIGRATIONS[version];
    if (!migration) break;
    const result = migration(current);
    current = result.doc;
    changed = changed || result.changed;
  }

  return { doc: current, changed, from, to: schemaVersion(current) };
}

/** Reads the schema version of a stored document, defaulting to the oldest. */
export function schemaVersion(doc: Record<string, unknown>): number {
  const value = doc['schema'];
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) return value;
  return 1;
}
