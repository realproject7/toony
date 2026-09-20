/** One literal POSIX-shell argument, including quotes and embedded newlines. */
export function shellQuote(value: string | number): string {
  const text = String(value);
  return /^[A-Za-z0-9._/-]+$/.test(text) ? text : `'${text.replace(/'/g, "'\\''")}'`;
}
