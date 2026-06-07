// Import styles
import "./lib/styles/plugin-control.css";

// Main entry point - Core exports
export { NasaEarthdataControl } from "./lib/core/NasaEarthdataControl";

// GIBS data layer exports
export {
  GibsClient,
  DEFAULT_CAPABILITIES_URL,
  parseCapabilities,
  buildTileUrl,
  searchLayers,
} from "./lib/gibs";

// Type exports
export type {
  NasaEarthdataControlOptions,
  NasaEarthdataState,
  AddedLayerState,
  NasaEarthdataEvent,
  NasaEarthdataEventPayload,
  NasaEarthdataEventHandler,
} from "./lib/core/types";
export type {
  GibsLayer,
  GibsLayerFormat,
  GibsTimeDimension,
  GibsCapabilities,
  ParseOptions,
  GibsClientOptions,
} from "./lib/gibs";

// Utility exports
export {
  clamp,
  formatNumericValue,
  generateId,
  debounce,
  throttle,
  classNames,
} from "./lib/utils";
