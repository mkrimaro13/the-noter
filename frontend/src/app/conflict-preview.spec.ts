import { describe, expect, it } from 'vitest';
import { conflictPreview } from './conflict-preview';

describe('conflictPreview', () => {
  it('describes a missing side as deleted', () => {
    expect(conflictPreview(null)).toEqual({
      title: 'Deleted',
      updatedAt: null,
      preview: 'This version no longer exists.',
    });
  });

  it('summarizes title, timestamp, and body text', () => {
    const preview = conflictPreview({
      title: ' Reading list ',
      updatedAt: 100,
      blocks: [
        { id: 'b_1', type: 'text', columns: ['  First   paragraph '] },
        { id: 'b_2', type: 'heading', text: 'Heading' },
        { id: 'b_3', type: 'list', items: ['milk', 'bread'] },
      ],
    });

    expect(preview).toEqual({
      title: 'Reading list',
      updatedAt: 100,
      preview: 'First paragraph Heading milk bread',
    });
  });

  it('falls back to Untitled and Empty note for bare documents', () => {
    expect(conflictPreview({})).toEqual({
      title: 'Untitled',
      updatedAt: null,
      preview: 'Empty note',
    });
    expect(conflictPreview({ title: '', blocks: [] })).toEqual({
      title: 'Untitled',
      updatedAt: null,
      preview: 'Empty note',
    });
  });

  it('caps long previews and skips malformed blocks', () => {
    const preview = conflictPreview({
      title: 'Long',
      updatedAt: 5,
      blocks: [42, null, { text: 'x'.repeat(300) }, { text: 'never included' }],
    });

    expect(preview.preview).toHaveLength(140);
    expect(preview.preview).toBe('x'.repeat(140));
  });

  it('accepts live notes as the local side', () => {
    const preview = conflictPreview({
      title: 'Local',
      updatedAt: 7,
      blocks: [{ text: 'local copy' }],
    });

    expect(preview.title).toBe('Local');
    expect(preview.preview).toBe('local copy');
  });
});
