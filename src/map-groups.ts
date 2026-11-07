import { hasMapImageExtension } from './device.ts';
import { fileStem } from './map-info.ts';
import type { MapRow } from './state.ts';

/** A map image plus the activation and search-index files that only work alongside it; files with no image stand alone. */
export interface MapGroup {
  primary: MapRow;
  related: MapRow[];
}

/** Images keep their input order, followed by unpaired files. */
export function groupMapRows(rows: MapRow[]): MapGroup[] {
  const images = rows.filter((row) => hasMapImageExtension(row.map.name));
  const companions = rows.filter((row) => !hasMapImageExtension(row.map.name));
  const owners = new Map(companions.map((row) => [row, findOwningImage(row, images)]));
  const imageGroups = images.map((image) => ({
    primary: image,
    related: companions.filter((row) => owners.get(row) === image),
  }));
  const standaloneGroups = companions
    .filter((row) => owners.get(row) === undefined)
    .map((row) => ({ primary: row, related: [] }));
  return [...imageGroups, ...standaloneGroups];
}

/**
 * Activation files share the image's stem (D9486050A.gma ↔ D9486050A.img). Search
 * indexes have unrelated stems and part numbers, so they match on the map name their
 * description ends with ("InstaSearch POI Index File - TopoActive Europe, East 2025.10").
 */
function findOwningImage(row: MapRow, images: MapRow[]): MapRow | undefined {
  const stem = fileStem(row.map.name);
  return images.find((image) => fileStem(image.map.name) === stem)
    ?? images.find((image) => image.displayName !== '' && row.displayName.endsWith(` - ${image.displayName}`));
}
