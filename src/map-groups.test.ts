import { expect, test } from 'bun:test';
import { groupMapRows } from './map-groups.ts';
import type { MapRow } from './state.ts';

function buildRow(path: string, displayName = ''): MapRow {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return {
    map: { id: 0, name, size: 0, path },
    displayName,
    createdOn: '',
    headerStatus: 'read',
  };
}

function groupPaths(rows: MapRow[]): string[][] {
  return groupMapRows(rows).map((group) => [group.primary, ...group.related].map((row) => row.map.path));
}

test('pairs an activation file with the image of the same stem', () => {
  expect(groupPaths([buildRow('GARMIN/d9486050a.gma'), buildRow('GARMIN/D9486050A.img')]))
    .toEqual([['GARMIN/D9486050A.img', 'GARMIN/d9486050a.gma']]);
});

test('pairs a search index with the image whose map name ends its description', () => {
  const rows = [
    buildRow('GARMIN/D6184160A.img', 'TopoActive Europe, East 2025.10'),
    buildRow('GARMIN/SID/D8433090A.sid', 'InstaSearch POI Index File - TopoActive Europe, East 2025.10'),
  ];
  expect(groupPaths(rows)).toEqual([['GARMIN/D6184160A.img', 'GARMIN/SID/D8433090A.sid']]);
});

test('leaves shared search tables and orphaned activation files standalone', () => {
  const rows = [
    buildRow('GARMIN/D9486050A.img', 'TopoActive Europe, Central 2025.10'),
    buildRow('GARMIN/1130472721.gma'),
    buildRow('GARMIN/SID/DA69900.sid', 'Search data 006-DA699-00 v2.70'),
  ];
  expect(groupPaths(rows)).toEqual([
    ['GARMIN/D9486050A.img'],
    ['GARMIN/1130472721.gma'],
    ['GARMIN/SID/DA69900.sid'],
  ]);
});
