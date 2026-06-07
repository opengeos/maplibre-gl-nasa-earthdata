import type {
  IControl,
  Map as MapLibreMap,
  RasterTileSource,
} from "maplibre-gl";
import { GibsClient, DEFAULT_CAPABILITIES_URL } from "../gibs/GibsClient";
import { buildTileUrl } from "../gibs/tileUrl";
import { searchLayers } from "../gibs/search";
import type { GibsCapabilities, GibsLayer } from "../gibs/types";
import { clamp, debounce } from "../utils";
import type {
  NasaEarthdataControlOptions,
  NasaEarthdataState,
  NasaEarthdataEvent,
  NasaEarthdataEventHandler,
  NasaEarthdataEventPayload,
  AddedLayerState,
} from "./types";

/**
 * Default options for the NasaEarthdataControl
 */
const DEFAULT_OPTIONS: Required<NasaEarthdataControlOptions> = {
  collapsed: true,
  position: "top-right",
  title: "NASA Earthdata",
  panelWidth: 320,
  className: "",
  capabilitiesUrl: DEFAULT_CAPABILITIES_URL,
  includeVector: false,
  maxResults: 50,
  showOpacity: true,
  attribution:
    '<a href="https://earthdata.nasa.gov/gibs" target="_blank">NASA EOSDIS GIBS</a>',
  theme: "auto",
};

/**
 * Prefix used for source and layer ids added to the map
 */
const LAYER_ID_PREFIX = "nasa-gibs-";

/**
 * Event handlers map type
 */
type EventHandlersMap = globalThis.Map<
  NasaEarthdataEvent,
  Set<NasaEarthdataEventHandler>
>;

/**
 * A MapLibre GL control for searching and adding NASA GIBS (Global Imagery
 * Browse Services) WMTS layers to the map.
 *
 * The control renders a collapsible button. When expanded, it fetches the
 * GIBS capabilities document, lets the user search the layer catalog, and
 * add/remove raster layers with per-layer date and opacity controls.
 *
 * @example
 * ```typescript
 * const control = new NasaEarthdataControl({
 *   title: 'NASA Earthdata',
 *   collapsed: false,
 * });
 * map.addControl(control, 'top-right');
 * control.on('layeradd', (e) => console.log('Added', e.layer?.id));
 * ```
 */
export class NasaEarthdataControl implements IControl {
  private _map?: MapLibreMap;
  private _mapContainer?: HTMLElement;
  private _container?: HTMLElement;
  private _panel?: HTMLElement;
  private _options: Required<NasaEarthdataControlOptions>;
  private _state: NasaEarthdataState;
  private _eventHandlers: EventHandlersMap = new globalThis.Map();

  private _client: GibsClient;
  private _capabilities?: GibsCapabilities;
  private _loading = false;
  private _addedLayers: globalThis.Map<string, AddedLayerState> =
    new globalThis.Map();

  // Panel content elements
  private _searchInput?: HTMLInputElement;
  private _metaEl?: HTMLElement;
  private _resultsEl?: HTMLElement;
  private _addedEl?: HTMLElement;
  private _insertSelect?: HTMLSelectElement;

  // UI state: expanded category groups, open legends, insertion position
  private _expandedCategories = new Set<string>();
  private _openLegends = new Set<string>();
  private _insertBefore = "";

  // Panel positioning handlers
  private _resizeHandler: (() => void) | null = null;
  private _mapResizeHandler: (() => void) | null = null;
  private _clickOutsideHandler: ((e: MouseEvent) => void) | null = null;

  /**
   * Creates a new NasaEarthdataControl instance.
   *
   * @param options - Configuration options for the control
   */
  constructor(options?: Partial<NasaEarthdataControlOptions>) {
    this._options = { ...DEFAULT_OPTIONS, ...options };
    this._state = {
      collapsed: this._options.collapsed,
      panelWidth: this._options.panelWidth,
      query: "",
      addedLayers: [],
    };
    this._client = new GibsClient({
      url: this._options.capabilitiesUrl,
      includeVector: this._options.includeVector,
    });
  }

  /**
   * Called when the control is added to the map.
   * Implements the IControl interface.
   *
   * @param map - The MapLibre GL map instance
   * @returns The control's container element
   */
  onAdd(map: MapLibreMap): HTMLElement {
    this._map = map;
    this._mapContainer = map.getContainer();
    this._container = this._createContainer();
    this._panel = this._createPanel();

    // Append panel to map container for independent positioning (avoids overlap with other controls)
    this._mapContainer.appendChild(this._panel);

    // Setup event listeners for panel positioning and click-outside
    this._setupEventListeners();

    // Set initial panel state
    if (!this._state.collapsed) {
      this._panel.classList.add("expanded");
      this._loadCapabilities();
      // Update position after control is added to DOM
      requestAnimationFrame(() => {
        this._updatePanelPosition();
      });
    }

    return this._container;
  }

  /**
   * Called when the control is removed from the map.
   * Implements the IControl interface.
   */
  onRemove(): void {
    // Remove all added GIBS layers and sources from the map
    for (const layerId of Array.from(this._addedLayers.keys())) {
      this._removeMapLayer(layerId);
    }
    this._addedLayers.clear();
    this._state.addedLayers = [];

    // Remove event listeners
    if (this._resizeHandler) {
      window.removeEventListener("resize", this._resizeHandler);
      this._resizeHandler = null;
    }
    if (this._mapResizeHandler && this._map) {
      this._map.off("resize", this._mapResizeHandler);
      this._mapResizeHandler = null;
    }
    if (this._clickOutsideHandler) {
      document.removeEventListener("click", this._clickOutsideHandler);
      this._clickOutsideHandler = null;
    }

    // Remove panel from map container
    this._panel?.parentNode?.removeChild(this._panel);

    // Remove button container from control stack
    this._container?.parentNode?.removeChild(this._container);

    this._map = undefined;
    this._mapContainer = undefined;
    this._container = undefined;
    this._panel = undefined;
    this._searchInput = undefined;
    this._metaEl = undefined;
    this._resultsEl = undefined;
    this._addedEl = undefined;
    this._insertSelect = undefined;
    this._openLegends.clear();
    this._eventHandlers.clear();
  }

  /**
   * Gets the current state of the control.
   *
   * @returns The current control state
   */
  getState(): NasaEarthdataState {
    return {
      ...this._state,
      addedLayers: this._state.addedLayers.map((l) => ({ ...l })),
    };
  }

  /**
   * Updates the control state. Changes to `addedLayers` are reconciled
   * against the map: missing layers are added, extra layers are removed,
   * and date/opacity changes are applied.
   *
   * @param newState - Partial state to merge with current state
   */
  setState(newState: Partial<NasaEarthdataState>): void {
    if (
      newState.collapsed !== undefined &&
      newState.collapsed !== this._state.collapsed
    ) {
      if (newState.collapsed) {
        this.collapse();
      } else {
        this.expand();
      }
    }

    if (newState.panelWidth !== undefined) {
      this._state.panelWidth = newState.panelWidth;
      if (this._panel) {
        this._panel.style.width = `${newState.panelWidth}px`;
      }
    }

    if (newState.query !== undefined && newState.query !== this._state.query) {
      this._state.query = newState.query;
      if (this._searchInput) {
        this._searchInput.value = newState.query;
      }
      this._renderResults();
    }

    let deferStateEmit = false;
    if (newState.addedLayers) {
      // Reconciliation needs the layer catalog; defer it until the
      // capabilities are loaded so state restoration works before the
      // panel is first expanded.
      const desired = newState.addedLayers.map((l) => ({ ...l }));
      if (this._capabilities) {
        this._reconcileAddedLayers(desired);
      } else {
        // Emit statechange only after reconciliation so listeners never
        // see a stale addedLayers snapshot.
        deferStateEmit = true;
        void this.getCapabilities()
          .then(() => {
            this._reconcileAddedLayers(desired);
            this._renderResults();
            this._renderAddedSection();
            this._emit("statechange");
          })
          .catch((error: unknown) => {
            const err =
              error instanceof Error ? error : new Error(String(error));
            this._emitError(err);
          });
      }
    }

    if (!deferStateEmit) {
      this._emit("statechange");
    }
  }

  /**
   * Toggles the collapsed state of the control panel.
   */
  toggle(): void {
    this._state.collapsed = !this._state.collapsed;

    if (this._panel) {
      if (this._state.collapsed) {
        this._panel.classList.remove("expanded");
        this._emit("collapse");
      } else {
        this._panel.classList.add("expanded");
        this._updatePanelPosition();
        this._loadCapabilities();
        this._refreshInsertOptions();
        this._emit("expand");
      }
    }

    this._emit("statechange");
  }

  /**
   * Expands the control panel.
   */
  expand(): void {
    if (this._state.collapsed) {
      this.toggle();
    }
  }

  /**
   * Collapses the control panel.
   */
  collapse(): void {
    if (!this._state.collapsed) {
      this.toggle();
    }
  }

  /**
   * Registers an event handler.
   *
   * @param event - The event type to listen for
   * @param handler - The callback function
   */
  on(event: NasaEarthdataEvent, handler: NasaEarthdataEventHandler): void {
    if (!this._eventHandlers.has(event)) {
      this._eventHandlers.set(event, new Set());
    }
    this._eventHandlers.get(event)!.add(handler);
  }

  /**
   * Removes an event handler.
   *
   * @param event - The event type
   * @param handler - The callback function to remove
   */
  off(event: NasaEarthdataEvent, handler: NasaEarthdataEventHandler): void {
    this._eventHandlers.get(event)?.delete(handler);
  }

  /**
   * Gets the map instance.
   *
   * @returns The MapLibre GL map instance or undefined if not added to a map
   */
  getMap(): MapLibreMap | undefined {
    return this._map;
  }

  /**
   * Gets the control container element.
   *
   * @returns The container element or undefined if not added to a map
   */
  getContainer(): HTMLElement | undefined {
    return this._container;
  }

  /**
   * Fetches and caches the GIBS capabilities document.
   *
   * @param force - If true, refetch even if cached
   * @returns The parsed capabilities
   */
  async getCapabilities(force = false): Promise<GibsCapabilities> {
    const capabilities = await this._client.getCapabilities(force);
    this._capabilities = capabilities;
    return capabilities;
  }

  /**
   * Searches the loaded GIBS layers by title or identifier.
   * Returns an empty array if the capabilities have not been loaded yet.
   *
   * @param query - The search query
   * @returns Matching layers
   */
  search(query: string): GibsLayer[] {
    return searchLayers(this._capabilities?.layers ?? [], query);
  }

  /**
   * Gets the state of all layers currently added to the map.
   *
   * @returns Added layer states
   */
  getAddedLayers(): AddedLayerState[] {
    return Array.from(this._addedLayers.values()).map((l) => ({ ...l }));
  }

  /**
   * Adds a GIBS layer to the map as a raster source and layer.
   * Requires the capabilities to be loaded (call getCapabilities() first
   * when using the control programmatically).
   *
   * @param layerId - The GIBS layer identifier
   * @param options - Optional date, opacity, visibility, and insertion position
   */
  addLayer(
    layerId: string,
    options?: {
      date?: string;
      opacity?: number;
      visible?: boolean;
      before?: string;
      key?: string;
    },
  ): void {
    if (!this._map) return;

    const layer = this._client.getLayer(layerId);
    if (!layer) {
      this._emitError(
        new Error(`Unknown GIBS layer: ${layerId} (capabilities not loaded?)`),
      );
      return;
    }

    const date = options?.date ?? layer.time?.default;
    const opacity = clamp(options?.opacity ?? 1, 0, 1);
    const visible = options?.visible ?? true;
    const before = options?.before ?? this._insertBefore;

    // Restoring a known instance key is a no-op if it is already on the map
    if (options?.key && this._addedLayers.has(options.key)) return;
    const key = options?.key ?? this._instanceKey(layer, date);
    const mapId = LAYER_ID_PREFIX + key;

    this._map.addSource(mapId, {
      type: "raster",
      tiles: [buildTileUrl(layer, date)],
      tileSize: 256,
      maxzoom: layer.maxZoom,
      attribution: this._options.attribution,
    });
    this._map.addLayer(
      {
        id: mapId,
        type: "raster",
        source: mapId,
        paint: { "raster-opacity": opacity },
        layout: { visibility: visible ? "visible" : "none" },
      },
      before && this._map.getLayer(before) ? before : undefined,
    );

    const added: AddedLayerState = { key, id: layerId, date, opacity, visible };
    this._addedLayers.set(key, added);
    this._syncAddedLayersState();
    this._renderResults();
    this._renderAddedSection();
    this._refreshInsertOptions();
    this._emit("layeradd", { layer });
    this._emit("statechange");
  }

  /**
   * Builds a unique instance key for a layer/date pair. Non-time layers can
   * only be added once; time-enabled layers get one instance per addition,
   * so a numeric suffix disambiguates repeated adds at the same date.
   */
  private _instanceKey(layer: GibsLayer, date?: string): string {
    if (!layer.time) return layer.id;

    const base = `${layer.id}@${date ?? layer.time.default}`;
    if (!this._addedLayers.has(base)) return base;
    let n = 2;
    while (this._addedLayers.has(`${base}#${n}`)) n++;
    return `${base}#${n}`;
  }

  /**
   * Resolves an instance key or a GIBS layer identifier to instances.
   * An exact key match wins; otherwise all instances of the layer match.
   */
  private _resolveInstances(keyOrId: string): AddedLayerState[] {
    const exact = this._addedLayers.get(keyOrId);
    if (exact) return [exact];
    return Array.from(this._addedLayers.values()).filter(
      (l) => l.id === keyOrId,
    );
  }

  /**
   * Removes added GIBS layer instances from the map. Pass an instance key
   * to remove a single instance, or a GIBS layer identifier to remove all
   * instances of that layer.
   *
   * @param keyOrId - An instance key or a GIBS layer identifier
   */
  removeLayer(keyOrId: string): void {
    const instances = this._resolveInstances(keyOrId);
    if (instances.length === 0) return;

    for (const instance of instances) {
      this._removeMapLayer(instance.key);
      this._addedLayers.delete(instance.key);
      this._openLegends.delete(instance.key);
      this._emit("layerremove", { layer: this._client.getLayer(instance.id) });
    }
    this._syncAddedLayersState();
    this._renderResults();
    this._renderAddedSection();
    this._refreshInsertOptions();
    this._emit("statechange");
  }

  /**
   * Changes the date of an added time-enabled layer instance.
   *
   * @param keyOrId - An instance key or a GIBS layer identifier
   * @param date - The new ISO 8601 date
   */
  setLayerDate(keyOrId: string, date: string): void {
    const added = this._resolveInstances(keyOrId)[0];
    const layer = added ? this._client.getLayer(added.id) : undefined;
    if (!this._map || !added || !layer) return;

    added.date = date;
    const mapId = LAYER_ID_PREFIX + added.key;
    const source = this._map.getSource(mapId) as RasterTileSource | undefined;
    const tiles = [buildTileUrl(layer, date)];

    if (source && typeof source.setTiles === "function") {
      source.setTiles(tiles);
    } else {
      // Fallback: re-create the source and layer
      this._removeMapLayer(added.key);
      this._addedLayers.delete(added.key);
      this.addLayer(added.id, {
        date,
        opacity: added.opacity,
        visible: added.visible,
        key: added.key,
      });
      return;
    }

    this._syncAddedLayersState();
    this._emit("statechange");
  }

  /**
   * Changes the opacity of an added layer instance.
   *
   * @param keyOrId - An instance key or a GIBS layer identifier
   * @param opacity - The new opacity (0 to 1)
   */
  setLayerOpacity(keyOrId: string, opacity: number): void {
    const added = this._resolveInstances(keyOrId)[0];
    if (!this._map || !added) return;

    added.opacity = clamp(opacity, 0, 1);
    this._map.setPaintProperty(
      LAYER_ID_PREFIX + added.key,
      "raster-opacity",
      added.opacity,
    );
    this._syncAddedLayersState();
    this._emit("statechange");
  }

  /**
   * Toggles the visibility of an added layer instance on the map.
   *
   * @param keyOrId - An instance key or a GIBS layer identifier
   * @param visible - Whether the layer should be visible
   */
  setLayerVisibility(keyOrId: string, visible: boolean): void {
    const added = this._resolveInstances(keyOrId)[0];
    if (!this._map || !added) return;

    added.visible = visible;
    this._map.setLayoutProperty(
      LAYER_ID_PREFIX + added.key,
      "visibility",
      visible ? "visible" : "none",
    );
    this._syncAddedLayersState();
    this._emit("statechange");
  }

  /**
   * Removes the map source and layer for an instance key, if present.
   */
  private _removeMapLayer(key: string): void {
    if (!this._map) return;
    const mapId = LAYER_ID_PREFIX + key;
    if (this._map.getLayer(mapId)) {
      this._map.removeLayer(mapId);
    }
    if (this._map.getSource(mapId)) {
      this._map.removeSource(mapId);
    }
  }

  /**
   * Mirrors the internal added-layers map into the serializable state.
   */
  private _syncAddedLayersState(): void {
    this._state.addedLayers = this.getAddedLayers();
  }

  /**
   * Reconciles a desired added-layers list against the map:
   * adds missing layers, removes extras, and applies date/opacity changes.
   */
  private _reconcileAddedLayers(desired: AddedLayerState[]): void {
    const desiredKeys = new Set(desired.map((l) => l.key));

    for (const existingKey of Array.from(this._addedLayers.keys())) {
      if (!desiredKeys.has(existingKey)) {
        this.removeLayer(existingKey);
      }
    }

    for (const target of desired) {
      const existing = this._addedLayers.get(target.key);
      if (!existing) {
        this.addLayer(target.id, {
          date: target.date,
          opacity: target.opacity,
          visible: target.visible,
          key: target.key,
        });
      } else {
        if (target.date && target.date !== existing.date) {
          this.setLayerDate(target.key, target.date);
        }
        if (
          target.opacity !== undefined &&
          target.opacity !== existing.opacity
        ) {
          this.setLayerOpacity(target.key, target.opacity);
        }
        if (
          target.visible !== undefined &&
          target.visible !== existing.visible
        ) {
          this.setLayerVisibility(target.key, target.visible);
        }
      }
    }
  }

  /**
   * Loads the capabilities document (once) and renders the results list.
   */
  private _loadCapabilities(): void {
    if (this._capabilities || this._loading) return;

    this._loading = true;
    this._renderStatus("Loading NASA GIBS layer catalog…");

    this.getCapabilities()
      .then(() => {
        this._loading = false;
        this._renderResults();
        this._renderAddedSection();
        this._refreshInsertOptions();
        this._emit("capabilitiesload");
      })
      .catch((error: unknown) => {
        this._loading = false;
        const err = error instanceof Error ? error : new Error(String(error));
        this._renderStatus(
          `Failed to load layer catalog: ${err.message}`,
          true,
        );
        this._emitError(err);
      });
  }

  /**
   * Emits an event to all registered handlers.
   *
   * @param event - The event type to emit
   * @param extra - Extra payload fields (layer, error)
   */
  private _emit(
    event: NasaEarthdataEvent,
    extra?: Partial<NasaEarthdataEventPayload>,
  ): void {
    const handlers = this._eventHandlers.get(event);
    if (handlers) {
      const eventData: NasaEarthdataEventPayload = {
        type: event,
        state: this.getState(),
        ...extra,
      };
      handlers.forEach((handler) => handler(eventData));
    }
  }

  /**
   * Emits an 'error' event.
   */
  private _emitError(error: Error): void {
    this._emit("error", { error });
  }

  /**
   * Returns the theme class for the configured theme, if explicit.
   */
  private _themeClass(): string {
    if (this._options.theme === "dark") return " ne-theme-dark";
    if (this._options.theme === "light") return " ne-theme-light";
    return "";
  }

  /**
   * Creates the main container element for the control.
   * Contains a toggle button (29x29) matching navigation control size.
   *
   * @returns The container element
   */
  private _createContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = `maplibregl-ctrl maplibregl-ctrl-group plugin-control maplibre-gl-nasa-earthdata${this._themeClass()}${
      this._options.className ? ` ${this._options.className}` : ""
    }`;

    // Create toggle button (29x29 to match navigation control)
    const toggleBtn = document.createElement("button");
    toggleBtn.className = "plugin-control-toggle";
    toggleBtn.type = "button";
    toggleBtn.setAttribute("aria-label", this._options.title);
    // Globe icon
    toggleBtn.innerHTML = `
      <span class="plugin-control-icon">
        <svg viewBox="0 0 24 24" width="22" height="22" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9"/>
          <path d="M3 12h18"/>
          <path d="M12 3a13.5 13.5 0 0 1 0 18a13.5 13.5 0 0 1 0-18"/>
        </svg>
      </span>
    `;
    toggleBtn.addEventListener("click", () => this.toggle());

    container.appendChild(toggleBtn);

    return container;
  }

  /**
   * Creates the panel element with header, search box, and results list.
   * Panel is positioned as a dropdown below the toggle button.
   *
   * @returns The panel element
   */
  private _createPanel(): HTMLElement {
    const panel = document.createElement("div");
    panel.className = `plugin-control-panel maplibre-gl-nasa-earthdata${this._themeClass()}`;
    panel.style.width = `${this._options.panelWidth}px`;

    // Create header with title and close button
    const header = document.createElement("div");
    header.className = "plugin-control-header";

    const title = document.createElement("span");
    title.className = "plugin-control-title";
    title.textContent = this._options.title;

    const closeBtn = document.createElement("button");
    closeBtn.className = "plugin-control-close";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close panel");
    closeBtn.innerHTML = "&times;";
    closeBtn.addEventListener("click", () => this.collapse());

    header.appendChild(title);
    header.appendChild(closeBtn);

    // Create content area: search input, insert-before row, category list,
    // and the added-layers management section
    const content = document.createElement("div");
    content.className = "plugin-control-content nasa-content";

    const search = document.createElement("input");
    search.className = "plugin-control-input nasa-search";
    search.type = "search";
    search.placeholder = "Search layers (e.g. temperature)";
    search.setAttribute("aria-label", "Search NASA GIBS layers");
    search.value = this._state.query;
    const onSearch = debounce(() => {
      this._state.query = search.value;
      this._renderResults();
      this._emit("statechange");
    }, 250);
    search.addEventListener("input", onSearch);
    this._searchInput = search;

    // "Insert before" row: choose where new layers are inserted in the
    // map's layer stack
    const insertRow = document.createElement("div");
    insertRow.className = "nasa-insert-row";

    const insertLabel = document.createElement("span");
    insertLabel.className = "nasa-insert-label";
    insertLabel.textContent = "Insert before";

    const insertSelect = document.createElement("select");
    insertSelect.className = "nasa-insert-select";
    insertSelect.setAttribute("aria-label", "Insert new layers before");
    insertSelect.addEventListener("change", () => {
      this._insertBefore = insertSelect.value;
    });
    this._insertSelect = insertSelect;

    insertRow.appendChild(insertLabel);
    insertRow.appendChild(insertSelect);

    const meta = document.createElement("div");
    meta.className = "nasa-meta";
    this._metaEl = meta;

    // Scrollable body holding the category groups and the added layers
    const body = document.createElement("div");
    body.className = "nasa-body";

    const results = document.createElement("div");
    results.className = "nasa-results";
    this._resultsEl = results;

    const added = document.createElement("div");
    added.className = "nasa-added-section";
    this._addedEl = added;

    body.appendChild(results);
    body.appendChild(added);

    content.appendChild(search);
    content.appendChild(insertRow);
    content.appendChild(meta);
    content.appendChild(body);

    panel.appendChild(header);
    panel.appendChild(content);

    // Resize handle on the panel's outer edge for adjusting the width by
    // dragging. _updatePanelPosition() moves it to the correct side for the
    // control corner (left edge when right-anchored, right edge when
    // left-anchored).
    const resizeHandle = document.createElement("div");
    resizeHandle.className = "nasa-resize-handle";
    resizeHandle.setAttribute("aria-hidden", "true");
    resizeHandle.addEventListener("pointerdown", (e) =>
      this._startResize(e, resizeHandle),
    );
    panel.appendChild(resizeHandle);

    return panel;
  }

  /**
   * Starts a panel width drag-resize. The drag direction is derived from
   * the control corner so resizing works whether the panel is anchored to
   * the left or the right edge of the map.
   */
  private _startResize(e: PointerEvent, handle: HTMLElement): void {
    if (!this._panel) return;
    e.preventDefault();

    const startX = e.clientX;
    const startWidth = this._panel.getBoundingClientRect().width;
    // Right-anchored panels grow leftward, so invert the pointer delta
    const anchoredRight = !this._getControlPosition().endsWith("left");
    const maxWidth = Math.max(
      240,
      (this._mapContainer?.getBoundingClientRect().width ?? window.innerWidth) -
        20,
    );

    const onMove = (ev: PointerEvent) => {
      const delta = anchoredRight ? startX - ev.clientX : ev.clientX - startX;
      const width = Math.round(clamp(startWidth + delta, 240, maxWidth));
      this._state.panelWidth = width;
      if (this._panel) {
        this._panel.style.width = `${width}px`;
      }
    };
    const onEnd = (ev: PointerEvent) => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
      if (handle.hasPointerCapture(ev.pointerId)) {
        handle.releasePointerCapture(ev.pointerId);
      }
      this._panel?.classList.remove("nasa-resizing");
      this._emit("statechange");
    };

    handle.setPointerCapture(e.pointerId);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
    this._panel.classList.add("nasa-resizing");
  }

  /**
   * Shows a status message (loading or error) in the results area.
   */
  private _renderStatus(message: string, isError = false): void {
    if (!this._resultsEl || !this._metaEl) return;
    this._metaEl.textContent = "";
    this._resultsEl.innerHTML = "";
    const status = document.createElement("div");
    status.className = `nasa-status${isError ? " nasa-status-error" : ""}`;
    status.textContent = message;
    this._resultsEl.appendChild(status);
  }

  /**
   * Groups layers by category, merging categories with fewer layers than
   * the threshold into "Other". Returns entries sorted alphabetically
   * with "Other" last.
   */
  private _groupByCategory(layers: GibsLayer[]): [string, GibsLayer[]][] {
    const MIN_CATEGORY_SIZE = 3;
    const all = this._capabilities?.layers ?? [];

    // Count category sizes over the FULL catalog so a category does not
    // flip into "Other" while filtering
    const totals = new globalThis.Map<string, number>();
    for (const layer of all) {
      totals.set(layer.category, (totals.get(layer.category) ?? 0) + 1);
    }

    const groups = new globalThis.Map<string, GibsLayer[]>();
    for (const layer of layers) {
      const total = totals.get(layer.category) ?? 0;
      const key = total >= MIN_CATEGORY_SIZE ? layer.category : "Other";
      const group = groups.get(key);
      if (group) {
        group.push(layer);
      } else {
        groups.set(key, [layer]);
      }
    }

    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === "Other") return 1;
      if (b === "Other") return -1;
      return a.localeCompare(b);
    });
  }

  /**
   * Renders the (filtered) layer catalog grouped by category.
   */
  private _renderResults(): void {
    if (!this._resultsEl || !this._metaEl) return;
    if (!this._capabilities) {
      if (!this._loading) {
        this._renderStatus("Expand the panel to load the layer catalog.");
      }
      return;
    }

    const query = this._state.query.trim();
    const matches = searchLayers(this._capabilities.layers, query);
    const groups = this._groupByCategory(matches);

    const layerWord = matches.length === 1 ? "layer" : "layers";
    const categoryWord = groups.length === 1 ? "category" : "categories";
    this._metaEl.textContent = `${matches.length} ${layerWord} in ${groups.length} ${categoryWord}`;

    this._resultsEl.innerHTML = "";
    if (matches.length === 0) {
      const status = document.createElement("div");
      status.className = "nasa-status";
      status.textContent = "No layers match your search.";
      this._resultsEl.appendChild(status);
      return;
    }

    for (const [category, layers] of groups) {
      // While searching, auto-expand the matching categories
      const expanded = query ? true : this._expandedCategories.has(category);
      this._resultsEl.appendChild(
        this._createCategoryGroup(category, layers, expanded),
      );
    }
  }

  /**
   * Creates a collapsible category group with a count badge.
   */
  private _createCategoryGroup(
    category: string,
    layers: GibsLayer[],
    expanded: boolean,
  ): HTMLElement {
    const group = document.createElement("div");
    group.className = "nasa-category";

    const header = document.createElement("button");
    header.type = "button";
    header.className = `nasa-category-header${expanded ? " expanded" : ""}`;
    header.setAttribute("aria-expanded", String(expanded));

    const chevron = document.createElement("span");
    chevron.className = "nasa-category-chevron";
    chevron.innerHTML = `
      <svg viewBox="0 0 24 24" width="12" height="12" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 6l6 6-6 6"/>
      </svg>
    `;

    const name = document.createElement("span");
    name.className = "nasa-category-name";
    name.textContent = category;

    const count = document.createElement("span");
    count.className = "nasa-category-count";
    count.textContent = String(layers.length);

    header.appendChild(chevron);
    header.appendChild(name);
    header.appendChild(count);
    header.addEventListener("click", () => {
      if (this._expandedCategories.has(category)) {
        this._expandedCategories.delete(category);
      } else {
        this._expandedCategories.add(category);
      }
      this._renderResults();
    });

    group.appendChild(header);

    if (expanded) {
      const list = document.createElement("div");
      list.className = "nasa-category-layers";
      list.setAttribute("role", "list");

      const visible = layers.slice(0, this._options.maxResults);
      for (const layer of visible) {
        list.appendChild(this._createLayerRow(layer));
      }
      if (layers.length > visible.length) {
        const note = document.createElement("div");
        note.className = "nasa-status";
        note.textContent = `Showing ${visible.length} of ${layers.length} — refine your search`;
        list.appendChild(note);
      }

      group.appendChild(list);
    }

    return group;
  }

  /**
   * Creates a single catalog layer row with title, badges, and an action
   * button. Non-time layers toggle add/remove; time-enabled layers always
   * offer "Add" so additional instances with different dates can be added.
   * Per-layer controls live in the added-layers section.
   */
  private _createLayerRow(layer: GibsLayer): HTMLElement {
    const instanceCount = Array.from(this._addedLayers.values()).filter(
      (l) => l.id === layer.id,
    ).length;
    const added = instanceCount > 0;

    const row = document.createElement("div");
    row.className = `nasa-layer-row${added ? " nasa-layer-row-added" : ""}`;
    row.setAttribute("role", "listitem");

    const main = document.createElement("div");
    main.className = "nasa-layer-main";

    const info = document.createElement("div");
    info.className = "nasa-layer-info";

    const titleEl = document.createElement("div");
    titleEl.className = "nasa-layer-title";
    titleEl.textContent = layer.title;
    titleEl.title = layer.id;

    const badges = document.createElement("div");
    badges.className = "nasa-layer-badges";
    const formatBadge = document.createElement("span");
    formatBadge.className = "nasa-badge";
    formatBadge.textContent = layer.format;
    badges.appendChild(formatBadge);
    if (layer.time) {
      const timeBadge = document.createElement("span");
      timeBadge.className = "nasa-badge nasa-badge-time";
      timeBadge.textContent = "time";
      timeBadge.title = `Default date: ${layer.time.default}`;
      badges.appendChild(timeBadge);
    }
    if (instanceCount > 1) {
      const countBadge = document.createElement("span");
      countBadge.className = "nasa-badge nasa-badge-time";
      countBadge.textContent = `${instanceCount} added`;
      badges.appendChild(countBadge);
    }

    info.appendChild(titleEl);
    info.appendChild(badges);

    // Time-enabled layers can be added repeatedly (one instance per date),
    // so their button always reads "Add"
    const isRemove = added && !layer.time;
    const actionBtn = document.createElement("button");
    actionBtn.type = "button";
    actionBtn.className = `nasa-layer-action${isRemove ? " nasa-layer-action-remove" : ""}`;
    actionBtn.textContent = isRemove ? "Remove" : "Add";
    actionBtn.setAttribute(
      "aria-label",
      isRemove
        ? `Remove layer ${layer.title}`
        : added
          ? `Add layer ${layer.title} for another date`
          : `Add layer ${layer.title}`,
    );
    actionBtn.addEventListener("click", () => {
      if (!layer.time && this._resolveInstances(layer.id).length > 0) {
        this.removeLayer(layer.id);
      } else {
        this.addLayer(layer.id);
      }
    });

    main.appendChild(info);
    main.appendChild(actionBtn);
    row.appendChild(main);

    return row;
  }

  /**
   * Renders the "Added layers" management section: visibility checkbox,
   * legend toggle, remove button, opacity slider, and date picker.
   */
  private _renderAddedSection(): void {
    if (!this._addedEl) return;

    this._addedEl.innerHTML = "";
    if (this._addedLayers.size === 0) return;

    const heading = document.createElement("div");
    heading.className = "nasa-added-heading";
    heading.textContent = "Added layers";
    this._addedEl.appendChild(heading);

    for (const added of this._addedLayers.values()) {
      const layer = this._client.getLayer(added.id);
      if (layer) {
        this._addedEl.appendChild(this._createAddedRow(layer, added));
      }
    }
  }

  /**
   * Creates a management card for one added layer.
   */
  private _createAddedRow(
    layer: GibsLayer,
    added: AddedLayerState,
  ): HTMLElement {
    const card = document.createElement("div");
    card.className = "nasa-added-card";

    // Header row: visibility checkbox, title, legend toggle, remove
    const head = document.createElement("div");
    head.className = "nasa-added-head";

    const visLabel = document.createElement("label");
    visLabel.className = "nasa-added-vis";
    visLabel.title = "Toggle layer visibility";

    const visCheckbox = document.createElement("input");
    visCheckbox.type = "checkbox";
    visCheckbox.className = "nasa-added-checkbox";
    visCheckbox.checked = added.visible;
    visCheckbox.setAttribute(
      "aria-label",
      `Toggle visibility of ${layer.title}`,
    );
    visCheckbox.addEventListener("change", () => {
      this.setLayerVisibility(added.key, visCheckbox.checked);
    });

    const titleEl = document.createElement("span");
    titleEl.className = "nasa-added-title";
    titleEl.textContent = layer.title;
    titleEl.title = added.key;

    visLabel.appendChild(visCheckbox);
    visLabel.appendChild(titleEl);

    // Date chip distinguishes multiple instances of the same time layer
    let dateChip: HTMLElement | undefined;
    if (layer.time && added.date) {
      dateChip = document.createElement("span");
      dateChip.className = "nasa-badge nasa-badge-time";
      dateChip.textContent = added.date.slice(0, 10);
      visLabel.appendChild(dateChip);
    }

    const actions = document.createElement("div");
    actions.className = "nasa-added-actions";

    if (layer.legendUrl) {
      const legendBtn = document.createElement("button");
      legendBtn.type = "button";
      legendBtn.className = `nasa-icon-button${
        this._openLegends.has(added.key) ? " active" : ""
      }`;
      legendBtn.title = "Toggle legend";
      legendBtn.setAttribute("aria-label", `Toggle legend for ${layer.title}`);
      legendBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 6h13M8 12h13M8 18h13"/>
          <rect x="3" y="4.5" width="3" height="3" rx="0.5"/>
          <rect x="3" y="10.5" width="3" height="3" rx="0.5"/>
          <rect x="3" y="16.5" width="3" height="3" rx="0.5"/>
        </svg>
      `;
      legendBtn.addEventListener("click", () => {
        if (this._openLegends.has(added.key)) {
          this._openLegends.delete(added.key);
        } else {
          this._openLegends.add(added.key);
        }
        this._renderAddedSection();
      });
      actions.appendChild(legendBtn);
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "nasa-icon-button nasa-icon-button-danger";
    removeBtn.title = "Remove layer";
    removeBtn.setAttribute("aria-label", `Remove layer ${layer.title}`);
    removeBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
        <path d="M10 11v6M14 11v6"/>
      </svg>
    `;
    removeBtn.addEventListener("click", () => {
      this.removeLayer(added.key);
    });
    actions.appendChild(removeBtn);

    head.appendChild(visLabel);
    head.appendChild(actions);
    card.appendChild(head);

    // Opacity slider with live percentage readout
    if (this._options.showOpacity) {
      const opacityRow = document.createElement("label");
      opacityRow.className = "nasa-control-label";
      opacityRow.textContent = "Opacity";

      const opacityInput = document.createElement("input");
      opacityInput.type = "range";
      opacityInput.className = "nasa-opacity";
      opacityInput.min = "0";
      opacityInput.max = "1";
      opacityInput.step = "0.05";
      opacityInput.value = String(added.opacity);
      opacityInput.setAttribute("aria-label", `Opacity for ${layer.title}`);

      const opacityValue = document.createElement("span");
      opacityValue.className = "nasa-opacity-value";
      opacityValue.textContent = `${Math.round(added.opacity * 100)}%`;

      opacityInput.addEventListener("input", () => {
        const value = Number(opacityInput.value);
        this.setLayerOpacity(added.key, value);
        opacityValue.textContent = `${Math.round(value * 100)}%`;
      });

      opacityRow.appendChild(opacityInput);
      opacityRow.appendChild(opacityValue);
      card.appendChild(opacityRow);
    }

    // Date picker for time-enabled layers
    if (layer.time) {
      const dateLabel = document.createElement("label");
      dateLabel.className = "nasa-control-label";
      dateLabel.textContent = "Date";

      const dateInput = document.createElement("input");
      dateInput.type = "date";
      dateInput.className = "nasa-date";
      dateInput.value = (added.date ?? layer.time.default).slice(0, 10);
      const range = this._timeRange(layer);
      if (range.min) dateInput.min = range.min;
      if (range.max) dateInput.max = range.max;
      dateInput.addEventListener("change", () => {
        if (dateInput.value) {
          this.setLayerDate(added.key, dateInput.value);
          if (dateChip) {
            dateChip.textContent = dateInput.value;
          }
        }
      });

      dateLabel.appendChild(dateInput);
      card.appendChild(dateLabel);
    }

    // Legend image (GIBS horizontal legend SVG)
    if (layer.legendUrl && this._openLegends.has(added.key)) {
      const legend = document.createElement("img");
      legend.className = "nasa-legend-image";
      legend.src = layer.legendUrl;
      legend.alt = `Legend for ${layer.title}`;
      legend.loading = "lazy";
      card.appendChild(legend);
    }

    return card;
  }

  /**
   * Refreshes the "Insert before" dropdown with the map's current layers.
   */
  private _refreshInsertOptions(): void {
    if (!this._insertSelect || !this._map) return;

    const layers = this._map.getStyle()?.layers ?? [];
    const select = this._insertSelect;
    select.innerHTML = "";

    const topOption = document.createElement("option");
    topOption.value = "";
    topOption.textContent = "Top of map";
    select.appendChild(topOption);

    for (const layer of layers) {
      const option = document.createElement("option");
      option.value = layer.id;
      option.textContent = layer.id;
      select.appendChild(option);
    }

    // Restore the previous selection if the layer still exists
    if (this._insertBefore && layers.some((l) => l.id === this._insertBefore)) {
      select.value = this._insertBefore;
    } else {
      this._insertBefore = "";
      select.value = "";
    }
  }

  /**
   * Derives the min/max selectable dates from a layer's time domain values.
   */
  private _timeRange(layer: GibsLayer): { min?: string; max?: string } {
    const time = layer.time;
    if (!time) return {};

    let min: string | undefined;
    let max: string | undefined;
    for (const value of time.values) {
      const [start, end] = value.split("/");
      const startDate = start?.slice(0, 10);
      const endDate = (end ?? start)?.slice(0, 10);
      if (startDate && (!min || startDate < min)) min = startDate;
      if (endDate && (!max || endDate > max)) max = endDate;
    }
    const defaultDate = time.default.slice(0, 10);
    if (!max || defaultDate > max) max = defaultDate;
    return { min, max };
  }

  /**
   * Setup event listeners for panel positioning and click-outside behavior.
   */
  private _setupEventListeners(): void {
    // Click outside to close (check both container and panel since they're now separate).
    // Ignore targets that are no longer connected to the DOM: clicking an
    // Add/Remove button re-renders the results list, detaching the button
    // before this document-level handler runs.
    this._clickOutsideHandler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        this._container &&
        this._panel &&
        target.isConnected &&
        !this._container.contains(target) &&
        !this._panel.contains(target)
      ) {
        this.collapse();
      }
    };
    document.addEventListener("click", this._clickOutsideHandler);

    // Update panel position on window resize
    this._resizeHandler = () => {
      if (!this._state.collapsed) {
        this._updatePanelPosition();
      }
    };
    window.addEventListener("resize", this._resizeHandler);

    // Update panel position on map resize (e.g., sidebar toggle)
    this._mapResizeHandler = () => {
      if (!this._state.collapsed) {
        this._updatePanelPosition();
      }
    };
    this._map?.on("resize", this._mapResizeHandler);
  }

  /**
   * Detect which corner the control is positioned in.
   *
   * @returns The position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
   */
  private _getControlPosition():
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right" {
    const parent = this._container?.parentElement;
    if (!parent) return "top-right"; // Default

    if (parent.classList.contains("maplibregl-ctrl-top-left"))
      return "top-left";
    if (parent.classList.contains("maplibregl-ctrl-top-right"))
      return "top-right";
    if (parent.classList.contains("maplibregl-ctrl-bottom-left"))
      return "bottom-left";
    if (parent.classList.contains("maplibregl-ctrl-bottom-right"))
      return "bottom-right";

    return "top-right"; // Default
  }

  /**
   * Update the panel position based on button location and control corner.
   * Positions the panel next to the button, expanding in the appropriate direction.
   */
  private _updatePanelPosition(): void {
    if (!this._container || !this._panel || !this._mapContainer) return;

    // Get the toggle button (first child of container)
    const button = this._container.querySelector(".plugin-control-toggle");
    if (!button) return;

    const buttonRect = button.getBoundingClientRect();
    const mapRect = this._mapContainer.getBoundingClientRect();
    const position = this._getControlPosition();

    // Calculate button position relative to map container
    const buttonTop = buttonRect.top - mapRect.top;
    const buttonBottom = mapRect.bottom - buttonRect.bottom;
    const buttonLeft = buttonRect.left - mapRect.left;
    const buttonRight = mapRect.right - buttonRect.right;

    const panelGap = 5; // Gap between button and panel

    // Reset all positioning
    this._panel.style.top = "";
    this._panel.style.bottom = "";
    this._panel.style.left = "";
    this._panel.style.right = "";

    // Keep the resize handle on the panel's outer (growing) edge:
    // right edge for left-anchored panels, left edge for right-anchored ones
    this._panel
      .querySelector(".nasa-resize-handle")
      ?.classList.toggle("nasa-resize-handle-right", position.endsWith("left"));

    switch (position) {
      case "top-left":
        // Panel expands down and to the right
        this._panel.style.top = `${buttonTop + buttonRect.height + panelGap}px`;
        this._panel.style.left = `${buttonLeft}px`;
        break;

      case "top-right":
        // Panel expands down and to the left
        this._panel.style.top = `${buttonTop + buttonRect.height + panelGap}px`;
        this._panel.style.right = `${buttonRight}px`;
        break;

      case "bottom-left":
        // Panel expands up and to the right
        this._panel.style.bottom = `${buttonBottom + buttonRect.height + panelGap}px`;
        this._panel.style.left = `${buttonLeft}px`;
        break;

      case "bottom-right":
        // Panel expands up and to the left
        this._panel.style.bottom = `${buttonBottom + buttonRect.height + panelGap}px`;
        this._panel.style.right = `${buttonRight}px`;
        break;
    }
  }
}
