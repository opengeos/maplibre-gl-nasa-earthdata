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
   * @param options - Optional date, opacity, and insertion position
   */
  addLayer(
    layerId: string,
    options?: { date?: string; opacity?: number; before?: string },
  ): void {
    if (!this._map) return;
    if (this._addedLayers.has(layerId)) return;

    const layer = this._client.getLayer(layerId);
    if (!layer) {
      this._emitError(
        new Error(`Unknown GIBS layer: ${layerId} (capabilities not loaded?)`),
      );
      return;
    }

    const date = options?.date ?? layer.time?.default;
    const opacity = clamp(options?.opacity ?? 1, 0, 1);
    const mapId = LAYER_ID_PREFIX + layerId;

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
      },
      options?.before,
    );

    const added: AddedLayerState = { id: layerId, date, opacity };
    this._addedLayers.set(layerId, added);
    this._syncAddedLayersState();
    this._renderResults();
    this._emit("layeradd", { layer });
    this._emit("statechange");
  }

  /**
   * Removes a previously added GIBS layer from the map.
   *
   * @param layerId - The GIBS layer identifier
   */
  removeLayer(layerId: string): void {
    if (!this._addedLayers.has(layerId)) return;

    this._removeMapLayer(layerId);
    this._addedLayers.delete(layerId);
    this._syncAddedLayersState();
    this._renderResults();
    this._emit("layerremove", { layer: this._client.getLayer(layerId) });
    this._emit("statechange");
  }

  /**
   * Changes the date of an added time-enabled layer.
   *
   * @param layerId - The GIBS layer identifier
   * @param date - The new ISO 8601 date
   */
  setLayerDate(layerId: string, date: string): void {
    const added = this._addedLayers.get(layerId);
    const layer = this._client.getLayer(layerId);
    if (!this._map || !added || !layer) return;

    added.date = date;
    const mapId = LAYER_ID_PREFIX + layerId;
    const source = this._map.getSource(mapId) as RasterTileSource | undefined;
    const tiles = [buildTileUrl(layer, date)];

    if (source && typeof source.setTiles === "function") {
      source.setTiles(tiles);
    } else {
      // Fallback: re-create the source and layer
      this._removeMapLayer(layerId);
      this._addedLayers.delete(layerId);
      this.addLayer(layerId, { date, opacity: added.opacity });
      return;
    }

    this._syncAddedLayersState();
    this._emit("statechange");
  }

  /**
   * Changes the opacity of an added layer.
   *
   * @param layerId - The GIBS layer identifier
   * @param opacity - The new opacity (0 to 1)
   */
  setLayerOpacity(layerId: string, opacity: number): void {
    const added = this._addedLayers.get(layerId);
    if (!this._map || !added) return;

    added.opacity = clamp(opacity, 0, 1);
    this._map.setPaintProperty(
      LAYER_ID_PREFIX + layerId,
      "raster-opacity",
      added.opacity,
    );
    this._syncAddedLayersState();
    this._emit("statechange");
  }

  /**
   * Removes the map source and layer for a GIBS layer id, if present.
   */
  private _removeMapLayer(layerId: string): void {
    if (!this._map) return;
    const mapId = LAYER_ID_PREFIX + layerId;
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
    const desiredIds = new Set(desired.map((l) => l.id));

    for (const existingId of Array.from(this._addedLayers.keys())) {
      if (!desiredIds.has(existingId)) {
        this.removeLayer(existingId);
      }
    }

    for (const target of desired) {
      const existing = this._addedLayers.get(target.id);
      if (!existing) {
        this.addLayer(target.id, {
          date: target.date,
          opacity: target.opacity,
        });
      } else {
        if (target.date && target.date !== existing.date) {
          this.setLayerDate(target.id, target.date);
        }
        if (
          target.opacity !== undefined &&
          target.opacity !== existing.opacity
        ) {
          this.setLayerOpacity(target.id, target.opacity);
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

    // Create content area: search input, meta line, results list
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

    const meta = document.createElement("div");
    meta.className = "nasa-meta";
    this._metaEl = meta;

    const results = document.createElement("div");
    results.className = "nasa-results";
    results.setAttribute("role", "list");
    this._resultsEl = results;

    content.appendChild(search);
    content.appendChild(meta);
    content.appendChild(results);

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
   * Renders the (filtered) layer results list.
   */
  private _renderResults(): void {
    if (!this._resultsEl || !this._metaEl) return;
    if (!this._capabilities) {
      if (!this._loading) {
        this._renderStatus("Expand the panel to load the layer catalog.");
      }
      return;
    }

    const matches = searchLayers(this._capabilities.layers, this._state.query);
    const visible = matches.slice(0, this._options.maxResults);

    this._metaEl.textContent =
      matches.length > visible.length
        ? `Showing ${visible.length} of ${matches.length} layers`
        : `${matches.length} layer${matches.length === 1 ? "" : "s"}`;

    this._resultsEl.innerHTML = "";
    if (matches.length === 0) {
      const status = document.createElement("div");
      status.className = "nasa-status";
      status.textContent = "No layers match your search.";
      this._resultsEl.appendChild(status);
      return;
    }

    for (const layer of visible) {
      this._resultsEl.appendChild(this._createLayerRow(layer));
    }
  }

  /**
   * Creates a single layer row with title, badges, add/remove toggle,
   * and (when added) date and opacity controls.
   */
  private _createLayerRow(layer: GibsLayer): HTMLElement {
    const added = this._addedLayers.get(layer.id);

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

    info.appendChild(titleEl);
    info.appendChild(badges);

    const actionBtn = document.createElement("button");
    actionBtn.type = "button";
    actionBtn.className = `nasa-layer-action${added ? " nasa-layer-action-remove" : ""}`;
    actionBtn.textContent = added ? "Remove" : "Add";
    actionBtn.setAttribute(
      "aria-label",
      `${added ? "Remove" : "Add"} layer ${layer.title}`,
    );
    actionBtn.addEventListener("click", () => {
      if (this._addedLayers.has(layer.id)) {
        this.removeLayer(layer.id);
      } else {
        this.addLayer(layer.id);
      }
    });

    main.appendChild(info);
    main.appendChild(actionBtn);
    row.appendChild(main);

    // Controls for added layers: date picker and opacity slider
    if (added) {
      const controls = document.createElement("div");
      controls.className = "nasa-layer-controls";

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
            this.setLayerDate(layer.id, dateInput.value);
          }
        });

        dateLabel.appendChild(dateInput);
        controls.appendChild(dateLabel);
      }

      if (this._options.showOpacity) {
        const opacityLabel = document.createElement("label");
        opacityLabel.className = "nasa-control-label";
        opacityLabel.textContent = "Opacity";

        const opacityInput = document.createElement("input");
        opacityInput.type = "range";
        opacityInput.className = "nasa-opacity";
        opacityInput.min = "0";
        opacityInput.max = "1";
        opacityInput.step = "0.05";
        opacityInput.value = String(added.opacity);
        opacityInput.setAttribute("aria-label", `Opacity for ${layer.title}`);
        opacityInput.addEventListener("input", () => {
          this.setLayerOpacity(layer.id, Number(opacityInput.value));
        });

        opacityLabel.appendChild(opacityInput);
        controls.appendChild(opacityLabel);
      }

      if (controls.children.length > 0) {
        row.appendChild(controls);
      }
    }

    return row;
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
