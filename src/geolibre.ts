import { NasaEarthdataControl } from "./lib/core/NasaEarthdataControl";
import type { NasaEarthdataState } from "./lib/core/types";
import "./lib/styles/plugin-control.css";

type GeoLibreMapControlPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

interface GeoLibreAppAPI {
  addMapControl: (
    control: NasaEarthdataControl,
    position?: GeoLibreMapControlPosition,
  ) => boolean;
  removeMapControl: (control: NasaEarthdataControl) => void;
}

interface GeoLibrePlugin {
  id: string;
  name: string;
  version: string;
  activate: (app: GeoLibreAppAPI) => boolean | void;
  deactivate: (app: GeoLibreAppAPI) => void;
  getMapControlPosition?: () => GeoLibreMapControlPosition;
  setMapControlPosition?: (
    app: GeoLibreAppAPI,
    position: GeoLibreMapControlPosition,
  ) => boolean | void;
  getProjectState?: () => unknown;
  applyProjectState?: (app: GeoLibreAppAPI, state: unknown) => boolean | void;
}

let control: NasaEarthdataControl | null = null;
let position: GeoLibreMapControlPosition = "top-right";
let pendingState: Partial<NasaEarthdataState> | null = null;

function createControl(): NasaEarthdataControl {
  const nextControl = new NasaEarthdataControl({
    collapsed: pendingState?.collapsed ?? true,
    panelWidth: pendingState?.panelWidth ?? 320,
    title: "NASA Earthdata",
  });

  if (pendingState) {
    nextControl.setState(pendingState);
  }

  return nextControl;
}

function isPluginState(value: unknown): value is Partial<NasaEarthdataState> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if ("collapsed" in candidate && typeof candidate.collapsed !== "boolean") {
    return false;
  }
  if ("panelWidth" in candidate && typeof candidate.panelWidth !== "number") {
    return false;
  }
  if ("query" in candidate && typeof candidate.query !== "string") {
    return false;
  }
  if ("addedLayers" in candidate && !Array.isArray(candidate.addedLayers)) {
    return false;
  }

  return true;
}

export const plugin: GeoLibrePlugin = {
  id: "maplibre-gl-nasa-earthdata",
  name: "NASA Earthdata",
  version: "0.1.0",
  activate(app) {
    control = control ?? createControl();
    const added = app.addMapControl(control, position);
    if (!added) {
      control = null;
      return false;
    }
  },
  deactivate(app) {
    if (!control) return;
    pendingState = control.getState();
    app.removeMapControl(control);
    control = null;
  },
  getMapControlPosition() {
    return position;
  },
  setMapControlPosition(app, nextPosition) {
    position = nextPosition;
    if (!control) return;

    app.removeMapControl(control);
    const added = app.addMapControl(control, position);
    if (!added) {
      pendingState = control.getState();
      control = null;
      return false;
    }
  },
  getProjectState() {
    return control?.getState() ?? pendingState ?? undefined;
  },
  applyProjectState(_app, state) {
    if (!isPluginState(state)) return false;
    pendingState = state;
    control?.setState(state);
  },
};

export default plugin;
