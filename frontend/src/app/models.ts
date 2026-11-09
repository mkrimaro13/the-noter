import { resolveTimeFunctions } from './format';

export type BlockType = 'text' | 'heading' | 'list' | 'image' | 'code' | 'function' | 'subnote';

/**
 * How the cover relates to the note body: inside the reading column (`content`)
 * or as a full-width banner at the top (`landscape`).
 */
export type CoverLayout = 'content' | 'landscape';

/** Focal point of the cover image, as percentages of the image box. */
export interface CoverPosition {
  x: number;
  y: number;
}

export const DEFAULT_COVER_POSITION: CoverPosition = { x: 50, y: 50 };

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
  /** Code blocks: an optional language label, such as `ts` or `sql`. */
  language: string;
  /** Text blocks: the content of each column, including any hidden ones. */
  columns: string[];
  /** Image blocks: extra columns after the main image, including hidden ones. */
  imageColumns: ImageColumn[];
  /** Image blocks: whether the first column is a picture or writing. */
  mainColumnType: ImageColumnType;
  /** Text/image blocks: how many columns are currently visible (1–4). */
  columnCount: number;
  /** Sub-note blocks: the child note rendered inline. */
  noteId: string;
}

export type NoteMetaType = 'text' | 'number' | 'date' | 'url' | 'select' | 'checkbox';

/** Field kinds available to note metadata, in menu order. */
export const NOTE_META_TYPES: readonly NoteMetaType[] = [
  'text',
  'number',
  'date',
  'url',
  'select',
  'checkbox',
];

export interface NoteMeta {
  id: string;
  key: string;
  value: string;
  type: NoteMetaType;
  /** Choices shown for `select` metadata. */
  options: string[];
}

/** Coerces unknown stored input into a supported metadata type. */
export function normalizeMetaType(value: unknown): NoteMetaType {
  return NOTE_META_TYPES.includes(value as NoteMetaType) ? (value as NoteMetaType) : 'text';
}

/** Keeps a value meaningful when the user switches a field's type. */
export function coerceMetaValue(type: NoteMetaType, value: string): string {
  switch (type) {
    case 'checkbox':
      return value === 'true' ? 'true' : 'false';
    case 'number': {
      const trimmed = value.trim();
      return trimmed !== '' && Number.isFinite(Number(trimmed)) ? trimmed : '';
    }
    case 'date': {
      const trimmed = value.trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : '';
    }
    default:
      return value;
  }
}

/** Splits the comma-separated options field used by select metadata. */
export function parseMetaOptions(value: string): string[] {
  return value
    .split(',')
    .map((option) => option.trim())
    .filter((option, index, all) => option.length > 0 && all.indexOf(option) === index);
}

export interface Note {
  id: string;
  title: string;
  /** Emoji or short text shown beside the title. */
  icon: string;
  /** Cover image data URL (or remote URL), or an empty string. */
  cover: string;
  /** Whether the cover sits in the reading column or spans the full width. */
  coverLayout: CoverLayout;
  /** Which part of the image is visible inside the cover frame. */
  coverPosition: CoverPosition;
  /** Parent note id for nesting; null for a top-level note. */
  parentId: string | null;
  metadata: NoteMeta[];
  blocks: NoteBlock[];
  createdAt: number;
  updatedAt: number;
}

/** True when the note icon is an image source instead of an emoji or short text. */
export function isImageIcon(icon: string): boolean {
  return /^(data:image\/|https?:\/\/|blob:)/i.test(icon.trim());
}

/** One note in the nested sidebar tree. */
export interface NoteTreeItem {
  note: Note;
  depth: number;
  children: NoteTreeItem[];
}

export type BlockPatch = Partial<
  Pick<
    NoteBlock,
    'text' | 'items' | 'ordered' | 'src' | 'caption' | 'level' | 'language' | 'mainColumnType'
  >
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
  { type: 'code', label: 'Code', hint: 'A monospace snippet' },
  { type: 'function', label: 'Function', hint: 'A signature or expression' },
  { type: 'subnote', label: 'Sub-note', hint: 'A nested note, editable inline' },
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
    language: '',
    columns: type === 'text' ? [''] : [],
    imageColumns: [],
    mainColumnType: 'image',
    columnCount: 1,
    noteId: '',
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
export function blockPlainText(block: NoteBlock): string {
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
    case 'code':
    case 'function':
      return block.text;
    case 'subnote':
      // A sub-note keeps its writing in the child note, not in this block.
      return '';
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
    case 'code':
    case 'function': {
      // `latex`/`plain` are function-block display hints, not code languages.
      const language =
        type === 'code' && block.language !== 'latex' && block.language !== 'plain'
          ? block.language
          : '';
      return { ...block, type, text: content, language };
    }
    case 'subnote':
      return {
        ...block,
        type,
        text: '',
        items: [],
        columns: [],
        imageColumns: [],
        columnCount: 1,
      };
  }
}

export function createNote(parentId: string | null = null): Note {
  const now = Date.now();
  return {
    id: uid('n'),
    title: '',
    icon: '',
    cover: '',
    coverLayout: 'content',
    coverPosition: { ...DEFAULT_COVER_POSITION },
    parentId,
    metadata: [
      {
        id: uid('m'),
        key: 'creación',
        value: resolveTimeFunctions('now()'),
        type: 'text',
        options: [],
      },
    ],
    blocks: [createBlock('text')],
    createdAt: now,
    updatedAt: now,
  };
}
