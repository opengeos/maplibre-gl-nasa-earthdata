import type { GibsLayer } from "./types";

/**
 * Filters GIBS layers by a free-text query.
 *
 * Performs a case-insensitive substring match against the layer title and
 * identifier. An empty or whitespace-only query returns all layers.
 *
 * @param layers - The layers to search
 * @param query - The search query
 * @returns Layers whose title or identifier contains the query
 */
export function searchLayers(layers: GibsLayer[], query: string): GibsLayer[] {
  const q = query.trim().toLowerCase();
  if (!q) return layers;

  return layers.filter(
    (layer) =>
      layer.title.toLowerCase().includes(q) ||
      layer.id.toLowerCase().includes(q),
  );
}
