import type { Map } from "maplibre-gl";
import type { GibsLayer } from "../gibs/types";

/**
 * Options for configuring the NasaEarthdataControl
 */
export interface NasaEarthdataControlOptions {
  /**
   * Whether the control panel should start collapsed (showing only the toggle button)
   * @default true
   */
  collapsed?: boolean;

  /**
   * Position of the control on the map
   * @default 'top-right'
   */
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";

  /**
   * Title displayed in the control header
   * @default 'NASA Earthdata'
   */
  title?: string;

  /**
   * Initial width of the control panel in pixels. The panel can also be
   * resized by dragging its outer edge.
   * @default 320
   */
  panelWidth?: number;

  /**
   * Custom CSS class name for the control container
   */
  className?: string;

  /**
   * URL of the WMTS capabilities document
   * @default DEFAULT_CAPABILITIES_URL
   */
  capabilitiesUrl?: string;

  /**
   * Whether to include vector-tile (MVT) layers in search results
   * @default false
   */
  includeVector?: boolean;

  /**
   * Maximum number of layers rendered in the results list
   * @default 50
   */
  maxResults?: number;

  /**
   * Whether to show an opacity slider for added layers
   * @default true
   */
  showOpacity?: boolean;

  /**
   * Attribution string applied to added raster sources
   * @default 'NASA EOSDIS GIBS'
   */
  attribution?: string;

  /**
   * Color theme of the control. 'auto' follows the OS preference.
   * @default 'auto'
   */
  theme?: "auto" | "light" | "dark";
}

/**
 * State of a single GIBS layer added to the map
 */
export interface AddedLayerState {
  /**
   * GIBS layer identifier
   */
  id: string;

  /**
   * Selected ISO 8601 date (for time-enabled layers)
   */
  date?: string;

  /**
   * Layer opacity (0 to 1)
   */
  opacity: number;
}

/**
 * Internal state of the NASA Earthdata control
 */
export interface NasaEarthdataState {
  /**
   * Whether the control panel is currently collapsed
   */
  collapsed: boolean;

  /**
   * Current panel width in pixels
   */
  panelWidth: number;

  /**
   * Current search query
   */
  query: string;

  /**
   * Layers currently added to the map
   */
  addedLayers: AddedLayerState[];
}

/**
 * Event types emitted by the NASA Earthdata control
 */
export type NasaEarthdataEvent =
  | "collapse"
  | "expand"
  | "statechange"
  | "layeradd"
  | "layerremove"
  | "capabilitiesload"
  | "error";

/**
 * Payload passed to NASA Earthdata event handlers
 */
export interface NasaEarthdataEventPayload {
  /**
   * The event type
   */
  type: NasaEarthdataEvent;

  /**
   * Snapshot of the control state at the time of the event
   */
  state: NasaEarthdataState;

  /**
   * The GIBS layer involved (for 'layeradd' and 'layerremove')
   */
  layer?: GibsLayer;

  /**
   * The error that occurred (for 'error')
   */
  error?: Error;
}

/**
 * Event handler function type
 */
export type NasaEarthdataEventHandler = (
  event: NasaEarthdataEventPayload,
) => void;

/**
 * Props for the React wrapper component
 */
export interface NasaEarthdataReactProps extends NasaEarthdataControlOptions {
  /**
   * MapLibre GL map instance
   */
  map: Map;

  /**
   * Callback fired when the control state changes
   */
  onStateChange?: (state: NasaEarthdataState) => void;

  /**
   * Callback fired when a GIBS layer is added to the map
   */
  onLayerAdd?: (layer: GibsLayer) => void;

  /**
   * Callback fired when a GIBS layer is removed from the map
   */
  onLayerRemove?: (layerId: string) => void;
}
