import { expect, test } from 'bun:test';
import { parseSidHeader, SidFormatError, sidCreatedOn, sidDisplayName, sidHeaderLength } from './sid.ts';

interface SidFixture {
  version: [number, number];
  tag: string;
  description: string;
  partNumber: string;
}

function buildSidHeader(fixture: SidFixture): Uint8Array {
  const bytes = new Uint8Array(sidHeaderLength);
  const view = new DataView(bytes.buffer);
  const encoder = new TextEncoder();
  bytes.set(encoder.encode('GARMIN SID'), 0);
  const stringBlockOffset = 0x2a + fixture.tag.length;
  view.setUint32(0x10, stringBlockOffset, true);
  view.setUint8(0x18, fixture.version[0]);
  view.setUint8(0x19, fixture.version[1]);
  view.setUint16(0x1f, 2026, true);
  view.setUint8(0x21, 2);
  view.setUint8(0x22, 17);
  bytes.set(encoder.encode(fixture.tag), 0x2a);
  let offset = stringBlockOffset;
  for (const text of [fixture.description, fixture.partNumber, 'OpenStreetMap contributors 2026']) {
    view.setUint32(offset, text.length, true);
    bytes.set(encoder.encode(text), offset + 4);
    offset += 4 + text.length;
  }
  return bytes;
}

test('names a POI search index by its description', () => {
  const header = parseSidHeader(buildSidHeader({
    version: [26, 10],
    tag: '',
    description: 'InstaSearch POI Index File - TopoActive Europe, East 2026.10',
    partNumber: '006-D8433-11',
  }));
  expect(header.partNumber).toBe('006-D8433-11');
  expect(sidDisplayName(header)).toBe('InstaSearch POI Index File - TopoActive Europe, East 2026.10');
  expect(sidCreatedOn(header)).toBe('2026-02-17');
});

test('names a shared search table by part number and version', () => {
  const header = parseSidHeader(buildSidHeader({ version: [2, 70], tag: 'ETYP', description: '', partNumber: '006-DA699-00' }));
  expect(sidDisplayName(header)).toBe('Search data 006-DA699-00 v2.70');
});

test('rejects files without the SID signature', () => {
  expect(() => parseSidHeader(new Uint8Array(sidHeaderLength))).toThrow(SidFormatError);
});

test('rejects strings that run past the header', () => {
  const bytes = buildSidHeader({ version: [2, 70], tag: '', description: 'x', partNumber: '006-DA699-00' });
  new DataView(bytes.buffer).setUint32(0x2a, 10_000, true);
  expect(() => parseSidHeader(bytes)).toThrow(SidFormatError);
});
