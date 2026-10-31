import { describe, expect, it } from 'vitest';
import {
  BLOCK_MENU,
  MAX_TEXT_COLUMNS,
  blockPlainText,
  convertBlock,
  createBlock,
  createImageColumn,
  createNote,
  uid,
  visibleImageColumnText,
  visibleImageColumns,
  visibleTextColumns,
  type NoteBlock,
} from './models';

describe('uid', () => {
  it('prefixes ids and keeps them unique', () => {
    const first = uid('b');
    const second = uid('b');

    expect(first.startsWith('b_')).toBe(true);
    expect(first).not.toBe(second);
  });
});

describe('createBlock', () => {
  it('starts text blocks with one empty column', () => {
    const block = createBlock('text');

    expect(block.type).toBe('text');
    expect(block.columns).toEqual(['']);
    expect(block.columnCount).toBe(1);
    expect(block.id.startsWith('b_')).toBe(true);
  });

  it('starts list blocks with one empty item', () => {
    expect(createBlock('list').items).toEqual(['']);
  });

  it('applies patches after the defaults', () => {
    const block = createBlock('heading', { text: 'Title', level: 3 });

    expect(block.text).toBe('Title');
    expect(block.level).toBe(3);
    expect(block.type).toBe('heading');
  });
});

describe('createImageColumn', () => {
  it('defaults to a text column and applies patches', () => {
    expect(createImageColumn()).toMatchObject({ type: 'text', text: '', src: '', caption: '' });
    expect(createImageColumn('image', { src: 'a.png' })).toMatchObject({
      type: 'image',
      src: 'a.png',
    });
  });
});

describe('visibleTextColumns', () => {
  it('returns only visible columns and clamps the count', () => {
    const block = createBlock('text', {
      columns: ['a', 'b', 'c', 'd', 'e'],
      columnCount: 2,
    });

    expect(visibleTextColumns(block)).toEqual(['a', 'b']);

    expect(visibleTextColumns({ ...block, columnCount: 0 })).toEqual(['a']);
    expect(visibleTextColumns({ ...block, columnCount: 99 })).toEqual(['a', 'b', 'c', 'd']);
    expect(visibleTextColumns({ ...block, columnCount: MAX_TEXT_COLUMNS + 1 })).toHaveLength(
      MAX_TEXT_COLUMNS,
    );
  });

  it('returns nothing for other block types', () => {
    expect(visibleTextColumns(createBlock('heading'))).toEqual([]);
  });
});

describe('visibleImageColumns', () => {
  const imageBlock = (): NoteBlock =>
    createBlock('image', {
      src: 'main.png',
      caption: 'Main caption',
      imageColumns: [createImageColumn('text', { text: 'note' })],
      columnCount: 2,
    });

  it('starts with the main image and appends stored columns', () => {
    const block = imageBlock();
    const columns = visibleImageColumns(block);

    expect(columns).toHaveLength(2);
    expect(columns[0]).toMatchObject({
      id: block.id,
      type: 'image',
      src: 'main.png',
      main: true,
    });
    expect(columns[1]).toMatchObject({ type: 'text', text: 'note', main: false });
  });

  it('fills missing extra columns with empty text placeholders', () => {
    const columns = visibleImageColumns(createBlock('image', { imageColumns: [], columnCount: 3 }));

    expect(columns).toHaveLength(3);
    expect(columns[1]).toMatchObject({ type: 'text', text: '', main: false });
    expect(columns[2]).toMatchObject({ type: 'text', text: '', main: false });
  });

  it('keeps hidden columns out of the result', () => {
    const block = createBlock('image', {
      imageColumns: [createImageColumn('text', { text: 'hidden' })],
      columnCount: 1,
    });

    expect(visibleImageColumns(block)).toHaveLength(1);
  });

  it('returns nothing for other block types', () => {
    expect(visibleImageColumns(createBlock('text'))).toEqual([]);
  });
});

describe('visibleImageColumnText', () => {
  it('returns text for writing columns and captions for images', () => {
    const block = createBlock('image', {
      imageColumns: [
        createImageColumn('text', { text: 'writing' }),
        createImageColumn('image', { caption: 'picture caption' }),
      ],
      columnCount: 3,
    });

    expect(visibleImageColumnText(block)).toEqual(['writing', 'picture caption']);
  });
});

describe('blockPlainText', () => {
  it('flattens each block shape', () => {
    expect(blockPlainText(createBlock('text', { columns: ['a', 'b'], columnCount: 2 }))).toBe(
      'a\nb',
    );
    expect(blockPlainText(createBlock('heading', { text: 'Title' }))).toBe('Title');
    expect(blockPlainText(createBlock('list', { items: ['one', 'two'] }))).toBe('one\ntwo');
    expect(blockPlainText(createBlock('code', { text: 'const x = 1;' }))).toBe('const x = 1;');
    expect(blockPlainText(createBlock('function', { text: 'x^2' }))).toBe('x^2');
    expect(blockPlainText(createBlock('subnote', { noteId: 'n_1' }))).toBe('');
  });

  it('skips empty image captions but keeps text columns', () => {
    const block = createBlock('image', {
      src: 'a.png',
      caption: '',
      imageColumns: [createImageColumn('text', { text: 'note' })],
      columnCount: 2,
    });

    expect(blockPlainText(block)).toBe('note');
  });
});

describe('convertBlock', () => {
  it('returns the same block when the type does not change', () => {
    const block = createBlock('text');
    expect(convertBlock(block, 'text')).toBe(block);
  });

  it('moves text into a heading and resets the level', () => {
    const block = createBlock('text', { columns: ['Hello'], columnCount: 1 });
    const heading = convertBlock(block, 'heading');

    expect(heading.type).toBe('heading');
    expect(heading.text).toBe('Hello');
    expect(heading.level).toBe(1);
  });

  it('splits lines into list items', () => {
    const block = createBlock('text', { columns: ['one\ntwo'], columnCount: 1 });
    const list = convertBlock(block, 'list');

    expect(list.items).toEqual(['one', 'two']);
    expect(list.ordered).toBe(false);
  });

  it('keeps list ordering when converting between list shapes', () => {
    const list = createBlock('list', { items: ['one'], ordered: true });
    expect(convertBlock(list, 'list')).toBe(list);
  });

  it('turns a multi-column text block into an image with a writing column', () => {
    const block = createBlock('text', { columns: ['a', 'b'], columnCount: 2 });
    const image = convertBlock(block, 'image');

    expect(image.type).toBe('image');
    expect(image.mainColumnType).toBe('image');
    expect(image.imageColumns).toHaveLength(1);
    expect(image.imageColumns[0].text).toBe('a\nb');
    expect(image.columnCount).toBe(2);
  });

  it('keeps an image with no writing as a single column', () => {
    const image = convertBlock(createBlock('image'), 'image');
    expect(image.columnCount).toBe(1);
  });

  it('moves image captions and text back into text columns', () => {
    const image = createBlock('image', {
      src: 'a.png',
      caption: 'cap',
      imageColumns: [createImageColumn('text', { text: 'note' })],
      columnCount: 2,
    });
    const text = convertBlock(image, 'text');

    expect(text.columns).toEqual(['cap', 'note']);
    expect(text.columnCount).toBe(2);
    expect(text.text).toBe('');
  });

  it('drops leading empty columns when leaving an image', () => {
    const image = createBlock('image', {
      caption: '',
      imageColumns: [createImageColumn('text', { text: 'note' })],
      columnCount: 2,
    });
    const text = convertBlock(image, 'text');

    expect(text.columns).toEqual(['note']);
    expect(text.columnCount).toBe(1);

    const onlyEmptyFirst = convertBlock(
      createBlock('image', { caption: '', imageColumns: [], columnCount: 1 }),
      'text',
    );
    expect(onlyEmptyFirst.columns).toEqual(['']);
    expect(onlyEmptyFirst.columnCount).toBe(1);
  });

  it('carries content into code and clears function language hints', () => {
    const block = createBlock('text', { columns: ['const x = 1;'], columnCount: 1 });

    expect(convertBlock(block, 'code')).toMatchObject({
      type: 'code',
      text: 'const x = 1;',
      language: '',
    });

    const latex = createBlock('function', { text: 'x^2', language: 'latex' });
    expect(convertBlock(latex, 'code').language).toBe('');
    expect(convertBlock(latex, 'code').text).toBe('x^2');
  });

  it('keeps a real code language when converting to code', () => {
    const block = createBlock('function', { text: 'x', language: 'ts' });
    expect(convertBlock(block, 'code').language).toBe('ts');
  });

  it('clears writing when converting to a sub-note', () => {
    const block = createBlock('text', { columns: ['lost?'], columnCount: 1 });
    const subnote = convertBlock(block, 'subnote');

    expect(subnote.type).toBe('subnote');
    expect(subnote.text).toBe('');
    expect(subnote.items).toEqual([]);
    expect(subnote.columns).toEqual([]);
    expect(subnote.imageColumns).toEqual([]);
    expect(subnote.columnCount).toBe(1);
  });
});

describe('createNote', () => {
  it('creates a root note with one empty text block', () => {
    const note = createNote();

    expect(note.id.startsWith('n_')).toBe(true);
    expect(note.parentId).toBeNull();
    expect(note.title).toBe('');
    expect(note.blocks).toHaveLength(1);
    expect(note.blocks[0].type).toBe('text');
    expect(note.createdAt).toBe(note.updatedAt);
  });

  it('links a child note to its parent', () => {
    expect(createNote('n_parent').parentId).toBe('n_parent');
  });
});

describe('BLOCK_MENU', () => {
  it('lists every block type once', () => {
    const types = BLOCK_MENU.map((item) => item.type);
    expect(new Set(types).size).toBe(types.length);
    expect(types).toEqual(['text', 'heading', 'list', 'image', 'code', 'function', 'subnote']);
  });
});
