export type BlockType = 'text' | 'heading' | 'list' | 'image';

export const MAX_TEXT_COLUMNS = 4;
export const MAX_HEADING_LEVEL = 6;

export type ImageColumnType = 'text' | 'image';

/** One extra column on an image block: either writing or another picture. */
export interface ImageColumn {
  id: string;
  type: ImageColumnType;
  text: string;
  src: string;
  caption: string;
}

export interface VisibleImageColumn extends ImageColumn {
  main: boolean;
}

export type ImageColumnPatch = Partial<Pick<ImageColumn, 'type' | 'text' | 'src' | 'caption'>>;

/**
 * A single piece of note content. Keeping every block shape on one interface
 * makes immutable updates simple and the editor template easy to follow.
 */
export interface NoteBlock {
  id: string;
  type: BlockType;
  text: string;
  items: string[];
  ordered: boolean;
  src: string;
  caption: string;
  /** Heading blocks: 1–6. */
  level: number;
  /** Text blocks: the content of each column, including any hidden ones. */
  columns: string[];
  /** Image blocks: extra columns after the main image, including hidden ones. */
  imageColumns: ImageColumn[];
  /** Image blocks: whether the first column is a picture or writing. */
  mainColumnType: ImageColumnType;
  /** Text/image blocks: how many columns are currently visible (1–4). */
  columnCount: number;
}

export interface NoteMeta {
  id: string;
  key: string;
  value: string;
}

export interface Note {
  id: string;
  title: string;
  metadata: NoteMeta[];
  blocks: NoteBlock[];
  createdAt: number;
  updatedAt: number;
}

export type BlockPatch = Partial<
  Pick<NoteBlock, 'text' | 'items' | 'ordered' | 'src' | 'caption' | 'level' | 'mainColumnType'>
>;

export interface BlockMenuItem {
  type: BlockType;
  label: string;
  hint: string;
}

export const BLOCK_MENU: readonly BlockMenuItem[] = [
  { type: 'text', label: 'Text', hint: 'A paragraph of writing' },
  { type: 'heading', label: 'Heading', hint: 'A section title' },
  { type: 'list', label: 'List', hint: 'Bulleted or numbered' },
  { type: 'image', label: 'Image', hint: 'Upload or link a picture' },
];

let sequence = 0;

export function uid(prefix: string): string {
  sequence += 1;
  return `${prefix}_${Date.now().toString(36)}${sequence.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createBlock(
  type: BlockType,
  patch: Partial<Omit<NoteBlock, 'id' | 'type'>> = {},
): NoteBlock {
  return {
    id: uid('b'),
    type,
    text: '',
    items: type === 'list' ? [''] : [],
    ordered: false,
    src: '',
    caption: '',
    level: 1,
    columns: type === 'text' ? [''] : [],
    imageColumns: [],
    mainColumnType: 'image',
    columnCount: 1,
    ...patch,
  };
}

export function createImageColumn(
  type: ImageColumnType = 'text',
  patch: Partial<Omit<ImageColumn, 'id' | 'type'>> = {},
): ImageColumn {
  return {
    id: uid('c'),
    type,
    text: '',
    src: '',
    caption: '',
    ...patch,
  };
}

export function visibleTextColumns(block: NoteBlock): string[] {
  if (block.type !== 'text') return [];
  const count = Math.min(Math.max(block.columnCount, 1), MAX_TEXT_COLUMNS);
  return block.columns.slice(0, count);
}

/**
 * Returns every visible image-block column, starting with the block's main
 * image. Hidden columns are omitted but kept in the block so lowering the
 * column count never destroys content.
 */
export function visibleImageColumns(block: NoteBlock): VisibleImageColumn[] {
  if (block.type !== 'image') return [];

  const count = Math.min(Math.max(block.columnCount, 1), MAX_TEXT_COLUMNS);
  const columns: VisibleImageColumn[] = [
    {
      id: block.id,
      type: block.mainColumnType,
      text: block.text,
      src: block.src,
      caption: block.caption,
      main: true,
    },
  ];

  for (let index = 0; index < count - 1; index += 1) {
    const column = block.imageColumns[index];
    columns.push(
      column
        ? { ...column, main: false }
        : {
            id: `${block.id}-column-${index}`,
            type: 'text',
            text: '',
            src: '',
            caption: '',
            main: false,
          },
    );
  }

  return columns;
}

/** Visible text and captions from the extra columns of an image block. */
export function visibleImageColumnText(block: NoteBlock): string[] {
  return visibleImageColumns(block)
    .filter((column) => !column.main)
    .flatMap((column) => (column.type === 'text' ? [column.text] : [column.caption]));
}

/** The writing held by a block, flattened so it can move between types. */
function blockPlainText(block: NoteBlock): string {
  switch (block.type) {
    case 'text':
      return visibleTextColumns(block).join('\n');
    case 'heading':
      return block.text;
    case 'list':
      return block.items.join('\n');
    case 'image':
      return visibleImageColumns(block)
        .map((column) => (column.type === 'text' ? column.text : column.caption))
        .filter((value) => value.length > 0)
        .join('\n');
  }
}

function linesOf(value: string): string[] {
  const lines = value.split(/\r?\n/);
  return lines.length > 0 ? lines : [''];
}

/**
 * Converts a block in place, keeping whatever content fits the new shape. Text
 * stays in `columns`, `text`, or `items`; picture captions and text columns can
 * become writing again when a block leaves the image type.
 */
export function convertBlock(block: NoteBlock, type: BlockType): NoteBlock {
  if (block.type === type) return block;

  const content = blockPlainText(block);

  switch (type) {
    case 'text': {
      const columns =
        block.type === 'image'
          ? visibleImageColumns(block).map((column) =>
              column.type === 'text' ? column.text : column.caption,
            )
          : [content];
      while (columns.length > 1 && columns[0].trim() === '') {
        columns.shift();
      }
      const columnCount = Math.min(Math.max(columns.length, 1), MAX_TEXT_COLUMNS);
      return { ...block, type, text: '', columns, columnCount };
    }
    case 'heading':
      return { ...block, type, text: content, level: 1 };
    case 'list':
      return {
        ...block,
        type,
        items: linesOf(content),
        ordered: block.type === 'list' ? block.ordered : false,
      };
    case 'image': {
      const imageColumns = content.length > 0 ? [createImageColumn('text', { text: content })] : [];
      return {
        ...block,
        type,
        src: block.src,
        caption: block.caption,
        mainColumnType: 'image',
        imageColumns,
        columnCount: imageColumns.length > 0 ? 2 : 1,
      };
    }
  }
}

export function createNote(): Note {
  const now = Date.now();
  return {
    id: uid('n'),
    title: '',
    metadata: [],
    blocks: [createBlock('text')],
    createdAt: now,
    updatedAt: now,
  };
}
