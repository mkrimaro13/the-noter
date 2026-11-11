import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA, migrateNoteDoc, schemaVersion } from './schema';

describe('schema migrations', () => {
  it('treats documents without a readable schema as version 1', () => {
    expect(schemaVersion({})).toBe(1);
    expect(schemaVersion({ schema: '2' })).toBe(1);
    expect(schemaVersion({ schema: 0 })).toBe(1);
    expect(schemaVersion({ schema: 2.5 })).toBe(1);
    expect(schemaVersion({ schema: 3 })).toBe(3);
  });

  it('upgrades legacy metadata entries to the typed shape', () => {
    const result = migrateNoteDoc({
      _id: 'note:n_1',
      _rev: '1-a',
      type: 'note',
      title: 'Legacy',
      metadata: [
        { id: 'm_1', key: 'Status', value: 'active' },
        { id: 'm_2', key: 'Count', value: '42' },
        { id: 'm_3', key: 'Broken', value: 'NaN' },
        { id: 'm_4', key: 'Done', value: 'true' },
      ],
    });

    expect(result.changed).toBe(true);
    expect(result.from).toBe(1);
    expect(result.to).toBe(CURRENT_SCHEMA);
    expect(result.doc['schema']).toBe(CURRENT_SCHEMA);
    expect(result.doc['metadata']).toEqual([
      { id: 'm_1', key: 'Status', value: 'active', type: 'text', options: [] },
      { id: 'm_2', key: 'Count', value: '42', type: 'text', options: [] },
      { id: 'm_3', key: 'Broken', value: 'NaN', type: 'text', options: [] },
      { id: 'm_4', key: 'Done', value: 'true', type: 'text', options: [] },
    ]);
    // CouchDB internals and document identity fields survive untouched.
    expect(result.doc['_rev']).toBe('1-a');
    expect(result.doc['title']).toBe('Legacy');
  });

  it('fills in options and keeps already typed entries', () => {
    const result = migrateNoteDoc({
      schema: 1,
      metadata: [{ id: 'm_1', key: 'Pick', value: 'b', type: 'select' }],
    });

    expect(result.doc['metadata']).toEqual([
      { id: 'm_1', key: 'Pick', value: 'b', type: 'select', options: [] },
    ]);
    expect(result.doc['schema']).toBe(CURRENT_SCHEMA);
  });

  it('coerces typed values that no longer match their type', () => {
    const result = migrateNoteDoc({
      schema: 1,
      metadata: [
        { id: 'm_1', key: 'N', value: 'abc', type: 'number' },
        { id: 'm_2', key: 'D', value: '2026-11-10', type: 'date' },
        { id: 'm_3', key: 'C', value: 'yes', type: 'checkbox' },
        { id: 'm_4', key: 'S', value: 'x', type: 'select', options: ['a', 7, 'b'] },
      ],
    });

    expect(result.doc['metadata']).toEqual([
      { id: 'm_1', key: 'N', value: '', type: 'number', options: [] },
      { id: 'm_2', key: 'D', value: '2026-11-10', type: 'date', options: [] },
      { id: 'm_3', key: 'C', value: 'false', type: 'checkbox', options: [] },
      { id: 'm_4', key: 'S', value: 'x', type: 'select', options: ['a', 'b'] },
    ]);
  });

  it('backfills the favorite flag on schema 2 documents', () => {
    const result = migrateNoteDoc({ schema: 2, title: 'Older build' });

    expect(result.changed).toBe(true);
    expect(result.from).toBe(2);
    expect(result.to).toBe(CURRENT_SCHEMA);
    expect(result.doc['schema']).toBe(CURRENT_SCHEMA);
    expect(result.doc['favorite']).toBe(false);
    expect(result.doc['title']).toBe('Older build');
  });

  it('keeps an explicit favorite flag while upgrading from schema 2', () => {
    const result = migrateNoteDoc({ schema: 2, title: 'Pinned', favorite: true });

    expect(result.changed).toBe(true);
    expect(result.doc['favorite']).toBe(true);
    expect(result.doc['schema']).toBe(CURRENT_SCHEMA);
  });

  it('leaves current documents untouched', () => {
    const doc = {
      schema: CURRENT_SCHEMA,
      metadata: [{ id: 'm_1', key: 'K', value: 'v', type: 'text', options: [] }],
    };
    const result = migrateNoteDoc(doc);

    expect(result.changed).toBe(false);
    expect(result.from).toBe(CURRENT_SCHEMA);
    expect(result.to).toBe(CURRENT_SCHEMA);
    expect(result.doc).toBe(doc);
  });

  it('ignores malformed metadata and never downgrades newer documents', () => {
    const odd = migrateNoteDoc({ schema: 1, metadata: 'nope' });
    expect(odd.changed).toBe(true);
    expect(odd.doc['metadata']).toBe('nope');
    expect(odd.doc['schema']).toBe(CURRENT_SCHEMA);

    const newer = { schema: CURRENT_SCHEMA + 1, metadata: [] };
    const kept = migrateNoteDoc(newer);
    expect(kept.changed).toBe(false);
    expect(kept.doc).toBe(newer);
  });

  it('does not mutate the input document', () => {
    const doc = { schema: 1, metadata: [{ id: 'm_1', key: 'K', value: 'v' }] };
    migrateNoteDoc(doc);

    expect(doc).toEqual({ schema: 1, metadata: [{ id: 'm_1', key: 'K', value: 'v' }] });
  });
});
