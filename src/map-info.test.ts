import { expect, test } from 'bun:test';
import { activationDisplayName, readLocalMapInfo } from './map-info.ts';

test('names an activation file after the map image with the same stem', () => {
  const mapNamesByStem = new Map([['d9486050a', 'TopoActive Europe']]);
  expect(activationDisplayName('D9486050A.gma', mapNamesByStem)).toBe('Activation for TopoActive Europe');
});

test('falls back to the image file name when the paired map has no readable name', () => {
  expect(activationDisplayName('D1399570A.gma', new Map())).toBe('Activation for D1399570A.img');
});

test('returns empty info for files without a known header', async () => {
  expect(await readLocalMapInfo(new File([new Uint8Array(16)], 'D9486050A.gma'))).toEqual({ displayName: '', createdOn: '' });
});
