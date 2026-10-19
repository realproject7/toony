// The store-only ZIP writer, checked by reading every archive back with an
// independent parser written from the format: signatures, sizes, CRC-32,
// names, offsets and the central directory must all agree.

import assert from "node:assert/strict";
import { test } from "node:test";
import { crc32, createZip, ZipError } from "../zip.js";

interface ParsedEntry {
  name: string;
  data: Uint8Array;
  crc: number;
  flags: number;
  method: number;
  time: number;
  date: number;
}

/** Parse a ZIP through its end record and central directory, verifying local headers. */
function parseZip(bytes: Uint8Array): ParsedEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50, "end of central directory signature");
  const count = view.getUint16(end + 10, true);
  assert.equal(view.getUint16(end + 8, true), count);
  const size = view.getUint32(end + 12, true);
  const start = view.getUint32(end + 16, true);
  assert.equal(start + size, end, "central directory ends where the end record begins");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: ParsedEntry[] = [];
  let at = start;
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50, "central header signature");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const time = view.getUint16(at + 12, true);
    const date = view.getUint16(at + 14, true);
    const crc = view.getUint32(at + 16, true);
    const compressed = view.getUint32(at + 20, true);
    const uncompressed = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    assert.equal(compressed, uncompressed, "stored entries are not compressed");
    // The local header repeats the same facts, and the data follows it.
    assert.equal(view.getUint32(local, true), 0x04034b50, "local header signature");
    assert.equal(view.getUint16(local + 6, true), flags);
    assert.equal(view.getUint16(local + 8, true), method);
    assert.equal(view.getUint32(local + 14, true), crc);
    assert.equal(view.getUint32(local + 18, true), compressed);
    const localName = view.getUint16(local + 26, true);
    const localExtra = view.getUint16(local + 28, true);
    assert.equal(decoder.decode(bytes.subarray(local + 30, local + 30 + localName)), name);
    const dataStart = local + 30 + localName + localExtra;
    const data = bytes.subarray(dataStart, dataStart + compressed);
    assert.equal(crc32(data), crc, `${name} CRC-32`);
    entries.push({ name, data, crc, flags, method, time, date });
    at += 46 + nameLength + extra + comment;
  }
  assert.equal(at, end);
  return entries;
}

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test("an archive reads back with every name, byte and checksum intact", () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, ...Array(300).keys()]);
  const json = new TextEncoder().encode('{"manifestVersion":2}\n');
  const modified = new Date(2026, 9, 19, 14, 30, 8);
  const zip = createZip([
    { name: "ep-001-instagram/001.png", data: png, modified },
    { name: "ep-001-instagram/컷 2.png", data: new Uint8Array(), modified },
    { name: "ep-001-instagram/manifest.json", data: json, modified },
  ]);
  const entries = parseZip(zip);
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ["ep-001-instagram/001.png", "ep-001-instagram/컷 2.png", "ep-001-instagram/manifest.json"],
  );
  assert.deepEqual(entries[0]?.data, png);
  assert.equal(entries[1]?.data.length, 0);
  assert.deepEqual(entries[2]?.data, json);
  for (const entry of entries) {
    assert.equal(entry.method, 0, "stored");
    assert.equal(entry.flags & 0x0800, 0x0800, "UTF-8 names");
    // DOS time: 14:30:08, date 2026-10-19.
    assert.equal(entry.time, (14 << 11) | (30 << 5) | 4);
    assert.equal(entry.date, ((2026 - 1980) << 9) | (10 << 5) | 19);
  }
});

test("an empty archive is just the end record", () => {
  const zip = createZip([]);
  assert.equal(zip.length, 22);
  assert.deepEqual(parseZip(zip), []);
});

test("unsafe or repeated names are refused", () => {
  const data = new Uint8Array([1]);
  for (const name of ["/abs.png", "../up.png", "a//b.png", "a\\b.png", "", "a/./b.png"]) {
    assert.throws(() => createZip([{ name, data }]), ZipError, name);
  }
  assert.throws(
    () =>
      createZip([
        { name: "a.png", data },
        { name: "a.png", data },
      ]),
    ZipError,
  );
});
