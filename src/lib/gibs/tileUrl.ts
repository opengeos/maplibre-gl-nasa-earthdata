import type { GibsLayer } from "./types";

/**
 * Builds a MapLibre-compatible XYZ tile URL template from a GIBS layer.
 *
 * Substitutes {Time} with the given date (or the layer's default date),
 * {TileMatrixSet} with the layer's tile matrix set, and maps the WMTS
 * placeholders {TileMatrix}/{TileRow}/{TileCol} to {z}/{y}/{x}.
 *
 * @param layer - The GIBS layer to build a URL for
 * @param time - Optional ISO 8601 date overriding the layer's default date
 * @returns A tile URL template usable in a MapLibre raster source
 */
export function buildTileUrl(layer: GibsLayer, time?: string): string {
  return layer.resourceTemplate
    .replace("{Time}", time ?? layer.time?.default ?? "default")
    .replace("{TileMatrixSet}", layer.tileMatrixSet)
    .replace("{TileMatrix}", "{z}")
    .replace("{TileRow}", "{y}")
    .replace("{TileCol}", "{x}");
}
