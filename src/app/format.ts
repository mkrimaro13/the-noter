export function relativeTime(timestamp: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  if (diff < 45_000) return 'just now';
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))}m ago`;

  const then = new Date(timestamp);
  const today = new Date(now);
  const sameDay =
    then.getDate() === today.getDate() &&
    then.getMonth() === today.getMonth() &&
    then.getFullYear() === today.getFullYear();

  if (sameDay) {
    return then.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  if (then.getFullYear() === today.getFullYear()) {
    return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function blockCountLabel(count: number): string {
  return count === 1 ? '1 block' : `${count} blocks`;
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

const TIME_FUNCTION = /\b(now|today|time)\(([^)]*)\)/gi;
const DATE_PATTERN = /YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|A|a/g;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Expands small time helpers inside a metadata value when the field is committed.
 *
 * `now()` (date and time), `today()` (date), and `time()` (time) use the local
 * locale. Arguments switch to a specific form: `now(iso)`, `now(unix)`,
 * `now(date)`, `now(time)`, or a custom pattern such as
 * `now(YYYY-MM-DD HH:mm)`.
 */
export function resolveTimeFunctions(value: string, now = new Date()): string {
  return value.replace(TIME_FUNCTION, (_match, name: string, rawArgument: string) => {
    const functionName = name.toLowerCase();
    const argument = stripQuotes(rawArgument.trim());
    const mode = argument.toLowerCase();

    if (mode === '' || mode === 'datetime' || mode === 'date-time') {
      if (functionName === 'today') return formatDate(now);
      if (functionName === 'time') return formatTime(now);
      return `${formatDate(now)}, ${formatTime(now)}`;
    }

    if (mode === 'date' || mode === 'today') return formatDate(now);
    if (mode === 'time') return formatTime(now);
    if (mode === 'iso') return now.toISOString();
    if (mode === 'unix') return String(Math.floor(now.getTime() / 1000));
    if (mode === 'timestamp' || mode === 'ms') return String(now.getTime());

    return formatDatePattern(now, argument);
  });
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatDatePattern(date: Date, pattern: string): string {
  const hours = date.getHours();
  const tokens: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    YY: String(date.getFullYear()).slice(-2),
    MMMM: MONTHS[date.getMonth()],
    MMM: MONTHS[date.getMonth()].slice(0, 3),
    MM: pad(date.getMonth() + 1),
    M: String(date.getMonth() + 1),
    DD: pad(date.getDate()),
    D: String(date.getDate()),
    dddd: WEEKDAYS[date.getDay()],
    ddd: WEEKDAYS[date.getDay()].slice(0, 3),
    HH: pad(hours),
    H: String(hours),
    hh: pad(hours % 12 || 12),
    h: String(hours % 12 || 12),
    mm: pad(date.getMinutes()),
    m: String(date.getMinutes()),
    ss: pad(date.getSeconds()),
    s: String(date.getSeconds()),
    A: hours < 12 ? 'AM' : 'PM',
    a: hours < 12 ? 'am' : 'pm',
  };

  return pattern.replace(DATE_PATTERN, (token) => tokens[token] ?? token);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function stripQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' || first === "'") && first === last) {
    return value.slice(1, -1);
  }
  return value;
}
