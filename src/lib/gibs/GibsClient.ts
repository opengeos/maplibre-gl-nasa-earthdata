import { parseCapabilities } from "./parseCapabilities";
import { searchLayers } from "./search";
import type { GibsCapabilities, GibsLayer } from "./types";

/**
 * Default URL of the NASA GIBS WMTS capabilities document (EPSG:3857, "best" imagery).
 */
export const DEFAULT_CAPABILITIES_URL =
  "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml";

/**
 * Options for creating a GibsClient.
 */
export interface GibsClientOptions {
  /**
   * URL of the WMTS capabilities document.
   * @default DEFAULT_CAPABILITIES_URL
   */
  url?: string;

  /**
   * Whether to include vector-tile (MVT) layers.
   * @default false
   */
  includeVector?: boolean;
}

/**
 * Fetches, parses, and caches the NASA GIBS WMTS capabilities document.
 *
 * Concurrent calls to {@link GibsClient.getCapabilities} are deduplicated:
 * the document is fetched and parsed at most once unless `force` is passed.
 *
 * @example
 * ```typescript
 * const client = new GibsClient();
 * const { layers } = await client.getCapabilities();
 * const matches = client.search('temperature');
 * ```
 */
export class GibsClient {
  private _url: string;
  private _includeVector: boolean;
  private _capabilities?: GibsCapabilities;
  private _pending?: Promise<GibsCapabilities>;

  /**
   * Creates a new GibsClient.
   *
   * @param options - Client options
   */
  constructor(options?: GibsClientOptions) {
    this._url = options?.url ?? DEFAULT_CAPABILITIES_URL;
    this._includeVector = options?.includeVector ?? false;
  }

  /**
   * Fetches and parses the capabilities document, caching the result.
   *
   * @param force - If true, refetch even if a cached result exists
   * @returns The parsed capabilities
   */
  async getCapabilities(force = false): Promise<GibsCapabilities> {
    if (this._capabilities && !force) return this._capabilities;
    if (this._pending && !force) return this._pending;

    this._pending = (async () => {
      const response = await fetch(this._url);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch capabilities: ${response.status} ${response.statusText}`,
        );
      }
      const xml = await response.text();
      const capabilities = parseCapabilities(xml, {
        includeVector: this._includeVector,
      });
      this._capabilities = capabilities;
      return capabilities;
    })();

    try {
      return await this._pending;
    } finally {
      this._pending = undefined;
    }
  }

  /**
   * Returns the cached capabilities, if already loaded.
   */
  getCachedCapabilities(): GibsCapabilities | undefined {
    return this._capabilities;
  }

  /**
   * Searches the cached layers by title or identifier.
   * Returns an empty array if capabilities have not been loaded yet.
   *
   * @param query - The search query
   */
  search(query: string): GibsLayer[] {
    return searchLayers(this._capabilities?.layers ?? [], query);
  }

  /**
   * Looks up a cached layer by identifier.
   *
   * @param id - The layer identifier
   */
  getLayer(id: string): GibsLayer | undefined {
    return this._capabilities?.layers.find((layer) => layer.id === id);
  }
}
