// A small store-only ZIP writer for "Download all". Exported images are already
// compressed (PNG/JPEG), so entries are stored as they are: no compression code,
// no dependency. Names are UTF-8 (general purpose flag bit 11). Archives larger
// than the classic ZIP limits (4 GiB, 65,535 entries) are refused rather than
// written in a form some tools cannot read.

export interface ZipEntry {
  /** Path inside the archive, with "/" separators. */
  name: string;
  data: Uint8Array;
  /** Modification time recorded for the entry (local time, two-second steps). */
  modified?: Date;
}

export class ZipError extends Error {}

const UINT32_MAX = 0xffffffff;
const ENTRIES_MAX = 0xffff;
const UTF8_FLAG = 0x0800;
const VERSION = 20;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3), as ZIP records it. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (CRC_TABLE[(crc ^ (data[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time fields; dates before 1980 clamp to 1980-01-01. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = date.getFullYear();
  if (year < 1980) return { time: 0, date: (1 << 5) | 1 };
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((Math.min(year, 2107) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function checkName(name: string): void {
  if (
    name.length === 0 ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.split("/").some((part) => part === ".." || part === "." || part.length === 0)
  ) {
    throw new ZipError(`"${name}" is not a safe archive path.`);
  }
}

/** Build a store-only ZIP archive of `entries`, in the given order. */
export function createZip(entries: readonly ZipEntry[]): Uint8Array {
  if (entries.length > ENTRIES_MAX) throw new ZipError("Too many files for one archive.");
  const encoder = new TextEncoder();
  const seen = new Set<string>();
  const records = entries.map((entry) => {
    checkName(entry.name);
    if (seen.has(entry.name)) throw new ZipError(`"${entry.name}" appears twice.`);
    seen.add(entry.name);
    if (entry.data.length > UINT32_MAX) throw new ZipError("A file is too large for the archive.");
    const name = encoder.encode(entry.name);
    if (name.length > 0xffff) throw new ZipError("A file name is too long for the archive.");
    return {
      name,
      data: entry.data,
      crc: crc32(entry.data),
      when: dosDateTime(entry.modified ?? new Date()),
    };
  });

  const localSize = records.reduce((sum, r) => sum + 30 + r.name.length + r.data.length, 0);
  const centralSize = records.reduce((sum, r) => sum + 46 + r.name.length, 0);
  if (localSize > UINT32_MAX || localSize + centralSize + 22 > UINT32_MAX) {
    throw new ZipError("The files are too large for one archive.");
  }
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let offset = 0;
  const u16 = (value: number) => {
    view.setUint16(offset, value, true);
    offset += 2;
  };
  const u32 = (value: number) => {
    view.setUint32(offset, value >>> 0, true);
    offset += 4;
  };

  const localOffsets: number[] = [];
  for (const r of records) {
    localOffsets.push(offset);
    u32(0x04034b50);
    u16(VERSION);
    u16(UTF8_FLAG);
    u16(0); // stored
    u16(r.when.time);
    u16(r.when.date);
    u32(r.crc);
    u32(r.data.length);
    u32(r.data.length);
    u16(r.name.length);
    u16(0);
    out.set(r.name, offset);
    offset += r.name.length;
    out.set(r.data, offset);
    offset += r.data.length;
  }

  const centralStart = offset;
  records.forEach((r, i) => {
    u32(0x02014b50);
    u16(VERSION);
    u16(VERSION);
    u16(UTF8_FLAG);
    u16(0);
    u16(r.when.time);
    u16(r.when.date);
    u32(r.crc);
    u32(r.data.length);
    u32(r.data.length);
    u16(r.name.length);
    u16(0); // extra
    u16(0); // comment
    u16(0); // disk
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(localOffsets[i] as number);
    out.set(r.name, offset);
    offset += r.name.length;
  });

  const centralLength = offset - centralStart;
  u32(0x06054b50);
  u16(0);
  u16(0);
  u16(records.length);
  u16(records.length);
  u32(centralLength);
  u32(centralStart);
  u16(0);
  return out;
}
