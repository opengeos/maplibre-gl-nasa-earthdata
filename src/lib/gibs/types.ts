/**
 * Image format of a GIBS layer.
 */
export type GibsLayerFormat = "png" | "jpeg" | "mvt";

/**
 * Time dimension metadata for a GIBS layer.
 */
export interface GibsTimeDimension {
  /**
   * Default date (ISO 8601) advertised by the capabilities document.
   */
  default: string;

  /**
   * Raw time domain values. Each entry is either a single date or a
   * "start/end/period" range (e.g. "2002-07-04/2026-06-01/P1D").
   */
  values: string[];
}

/**
 * A single WMTS layer parsed from the GIBS capabilities document.
 */
export interface GibsLayer {
  /**
   * Layer identifier (ows:Identifier), e.g. "MODIS_Terra_CorrectedReflectance_TrueColor".
   */
  id: string;

  /**
   * Human-readable layer title (ows:Title).
   */
  title: string;

  /**
   * Image format of the layer tiles.
   */
  format: GibsLayerFormat;

  /**
   * File extension used in tile URLs (derived from the resource template).
   */
  fileExtension: string;

  /**
   * TileMatrixSet identifier, e.g. "GoogleMapsCompatible_Level9".
   */
  tileMatrixSet: string;

  /**
   * Maximum native zoom level (parsed from the TileMatrixSet name).
   */
  maxZoom: number;

  /**
   * WGS84 bounding box as [west, south, east, north], if advertised.
   */
  bbox?: [number, number, number, number];

  /**
   * Raw tile ResourceURL template with {Time}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol} placeholders.
   */
  resourceTemplate: string;

  /**
   * Time dimension, if the layer is time-enabled.
   */
  time?: GibsTimeDimension;

  /**
   * URL of the first advertised legend image, if any.
   */
  legendUrl?: string;
}

/**
 * Parsed GIBS capabilities document.
 */
export interface GibsCapabilities {
  /**
   * All parsed layers, sorted by title.
   */
  layers: GibsLayer[];

  /**
   * Timestamp (ms since epoch) when the document was parsed.
   */
  fetchedAt: number;
}

/**
 * Options for parsing the capabilities document.
 */
export interface ParseOptions {
  /**
   * Whether to include vector-tile (MVT) layers in the result.
   * @default false
   */
  includeVector?: boolean;
}
