// React entry point
export { NasaEarthdataControlReact } from "./lib/core/NasaEarthdataControlReact";

// React hooks
export { useNasaEarthdata } from "./lib/hooks";

// Re-export types for React consumers
export type {
  NasaEarthdataControlOptions,
  NasaEarthdataState,
  AddedLayerState,
  NasaEarthdataReactProps,
  NasaEarthdataEvent,
  NasaEarthdataEventPayload,
  NasaEarthdataEventHandler,
} from "./lib/core/types";
export type {
  GibsLayer,
  GibsLayerFormat,
  GibsTimeDimension,
  GibsCapabilities,
} from "./lib/gibs";
