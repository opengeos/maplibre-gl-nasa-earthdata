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
  previousGibsDates,
  gibsProbeTileUrl,
  findGibsFallbackDate,
  fetchWithTimeout,
  DEFAULT_FALLBACK_MAX_STEPS,
  DEFAULT_PROBE_TIMEOUT_MS,
} from "./lib/gibs";

// Type exports
export type {
  NasaEarthdataControlOptions,
  NasaEarthdataState,
  AddedLayerState,
  NasaEarthdataEvent,
  NasaEarthdataEventPayload,
  NasaEarthdataEventHandler,
  DefaultDateFallbackOptions,
} from "./lib/core/types";
export type {
  GibsLayer,
  GibsLayerFormat,
  GibsTimeDimension,
  GibsCapabilities,
  ParseOptions,
  GibsClientOptions,
  ProbeFetch,
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
