# maplibre-gl-nasa-earthdata

A [MapLibre GL JS](https://maplibre.org/) plugin for searching and adding [NASA GIBS](https://earthdata.nasa.gov/gibs) (Global Imagery Browse Services) Earthdata imagery layers to a map.

[![npm version](https://img.shields.io/npm/v/maplibre-gl-nasa-earthdata.svg)](https://www.npmjs.com/package/maplibre-gl-nasa-earthdata)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

The plugin adds a collapsible map control that fetches the GIBS WMTS capabilities document, lets users search the catalog of 1,100+ raster layers by name, and add imagery layers to the map with per-layer date and opacity controls.

## Features

- **Layer Search** - Search 1,100+ NASA GIBS raster layers by title or identifier
- **Category Browser** - Layers grouped into collapsible categories by platform/instrument (MODIS, VIIRS, MERRA2, ...)
- **Layer Management** - Added-layers panel with visibility toggle, legend display, opacity slider, and removal
- **Insert Before** - Choose where new layers are inserted in the map's layer stack (e.g. below labels)
- **Time Dimension Support** - Date picker for time-enabled layers (daily/monthly imagery); add the same layer multiple times with different dates to compare
- **Collapsible Control** - Compact 29x29 button that expands into a floating panel
- **Resizable Panel** - Drag the panel edge to adjust its width in any corner
- **Dark and Light Mode** - Follows the OS preference, or force a theme via the `theme` option
- **Small Screen Friendly** - Panel fits the viewport with a vertical scrollbar
- **TypeScript Support** - Full type definitions for all public APIs
- **React Integration** - React wrapper component and custom hook
- **Programmatic API** - Search and add/remove layers from code
- **GeoLibre Bundle Output** - Builds a zip plugin bundle for GeoLibre Desktop

## Installation

```bash
npm install maplibre-gl-nasa-earthdata
```

## Quick Start

### Vanilla JavaScript/TypeScript

```typescript
import maplibregl from "maplibre-gl";
import { NasaEarthdataControl } from "maplibre-gl-nasa-earthdata";
import "maplibre-gl-nasa-earthdata/style.css";

const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/liberty",
  center: [0, 20],
  zoom: 2,
});

map.on("load", () => {
  const control = new NasaEarthdataControl({
    title: "NASA Earthdata",
    collapsed: false,
  });

  map.addControl(control, "top-right");

  control.on("layeradd", (event) => {
    console.log("Added layer:", event.layer?.id);
  });
});
```

### Programmatic layer management

```typescript
const control = new NasaEarthdataControl();
map.addControl(control, "top-right");

// Load the GIBS catalog, then add a layer by identifier
await control.getCapabilities();
control.addLayer("MODIS_Terra_CorrectedReflectance_TrueColor", {
  date: "2024-06-01",
  opacity: 0.8,
});

// Update or remove later
control.setLayerDate("MODIS_Terra_CorrectedReflectance_TrueColor", "2024-07-01");
control.setLayerOpacity("MODIS_Terra_CorrectedReflectance_TrueColor", 0.5);
control.removeLayer("MODIS_Terra_CorrectedReflectance_TrueColor");
```

### React

```tsx
import { useEffect, useRef, useState } from "react";
import maplibregl, { Map } from "maplibre-gl";
import {
  NasaEarthdataControlReact,
  useNasaEarthdata,
} from "maplibre-gl-nasa-earthdata/react";
import "maplibre-gl-nasa-earthdata/style.css";

function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<Map | null>(null);
  const { state, setState, toggle } = useNasaEarthdata();

  useEffect(() => {
    if (!mapContainer.current) return;

    const mapInstance = new maplibregl.Map({
      container: mapContainer.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [0, 20],
      zoom: 2,
    });

    mapInstance.on("load", () => setMap(mapInstance));

    return () => mapInstance.remove();
  }, []);

  return (
    <div style={{ width: "100%", height: "100vh" }}>
      <div ref={mapContainer} style={{ width: "100%", height: "100%" }} />
      {map && (
        <NasaEarthdataControlReact
          map={map}
          collapsed={state.collapsed}
          onStateChange={setState}
          onLayerAdd={(layer) => console.log("Added:", layer.id)}
        />
      )}
    </div>
  );
}
```

## API

### NasaEarthdataControl

The main control class implementing MapLibre's `IControl` interface.

#### Constructor Options

| Option            | Type                            | Default                | Description                                                               |
| ----------------- | ------------------------------- | ---------------------- | ------------------------------------------------------------------------- |
| `collapsed`       | `boolean`                       | `true`                 | Whether the panel starts collapsed (showing only the 29x29 toggle button) |
| `position`        | `string`                        | `'top-right'`          | Control position on the map                                               |
| `title`           | `string`                        | `'NASA Earthdata'`     | Title displayed in the header                                             |
| `panelWidth`      | `number`                        | `320`                  | Initial width of the dropdown panel in pixels (drag the edge to resize)   |
| `className`       | `string`                        | `''`                   | Custom CSS class name                                                     |
| `capabilitiesUrl` | `string`                        | GIBS EPSG:3857 best    | URL of the WMTS capabilities document                                     |
| `includeVector`   | `boolean`                       | `false`                | Include vector-tile (MVT) layers in search results                        |
| `showOpacity`     | `boolean`                       | `true`                 | Show an opacity slider for added layers                                   |
| `attribution`     | `string`                        | NASA EOSDIS GIBS link  | Attribution applied to added raster sources                               |
| `theme`           | `'auto' \| 'light' \| 'dark'`   | `'auto'`               | Color theme; `'auto'` follows the OS preference                           |

#### Methods

- `getCapabilities(force?)` - Fetch and cache the GIBS layer catalog
- `search(query)` - Search loaded layers by title or identifier
- `addLayer(layerId, { date?, opacity?, visible?, before? })` - Add a GIBS layer to the map. Time-enabled layers can be added multiple times with different dates; each addition is an instance with a unique `key` (see `AddedLayerState`)
- `removeLayer(keyOrId)` - Remove an instance by key, or all instances of a layer by its GIBS identifier
- `setLayerDate(keyOrId, date)` - Change the date of a time-enabled layer instance
- `setLayerOpacity(keyOrId, opacity)` - Change an instance's opacity (0 to 1)
- `setLayerVisibility(keyOrId, visible)` - Show or hide an added instance
- `getAddedLayers()` - Get the state of all added layers
- `toggle()` / `expand()` / `collapse()` - Control the panel
- `getState()` / `setState(state)` - Read or reconcile the control state
- `on(event, handler)` / `off(event, handler)` - Manage event handlers
- `getMap()` / `getContainer()` - Access the map instance and container element

#### Events

- `collapse` / `expand` - Panel visibility changed
- `statechange` - State changed (query, added layers, etc.)
- `layeradd` / `layerremove` - A GIBS layer was added or removed (payload includes `layer`)
- `capabilitiesload` - The GIBS catalog finished loading
- `error` - An error occurred (payload includes `error`)

### NasaEarthdataControlReact

React wrapper component for `NasaEarthdataControl`.

#### Props

All `NasaEarthdataControl` options plus:

| Prop            | Type       | Description                            |
| --------------- | ---------- | -------------------------------------- |
| `map`           | `Map`      | MapLibre GL map instance (required)    |
| `onStateChange` | `function` | Callback fired when state changes      |
| `onLayerAdd`    | `function` | Callback fired when a layer is added   |
| `onLayerRemove` | `function` | Callback fired when a layer is removed |

### useNasaEarthdata

Custom React hook for managing control state.

```typescript
const {
  state, // Current state
  setState, // Update entire state
  setCollapsed, // Set collapsed state
  setPanelWidth, // Set panel width
  setQuery, // Set the search query
  setAddedLayers, // Set the added layers list
  reset, // Reset to initial state
  toggle, // Toggle collapsed state
} = useNasaEarthdata(initialState);
```

### GIBS helpers

Lower-level building blocks are exported for advanced use:

- `GibsClient` - Fetches, parses, and caches the capabilities document
- `parseCapabilities(xml, options?)` - Parse a WMTS capabilities XML string
- `buildTileUrl(layer, time?)` - Build an XYZ tile URL template for a layer
- `searchLayers(layers, query)` - Filter layers by title or identifier
- `DEFAULT_CAPABILITIES_URL` - The default GIBS capabilities URL

### Exported Types

`NasaEarthdataControlOptions`, `NasaEarthdataState`, `AddedLayerState`, `NasaEarthdataEvent`, `NasaEarthdataEventPayload`, `NasaEarthdataEventHandler`, `NasaEarthdataReactProps`, `GibsLayer`, `GibsLayerFormat`, `GibsTimeDimension`, `GibsCapabilities`, `ParseOptions`, `GibsClientOptions`

## Theming

The control renders properly in both light and dark mode:

- By default (`theme: 'auto'`), colors follow the OS `prefers-color-scheme` setting.
- Pass `theme: 'dark'` or `theme: 'light'` to force a theme.
- All colors are driven by CSS custom properties (prefixed `--ne-`) on the
  `.maplibre-gl-nasa-earthdata` class, so they can be overridden in your own CSS.

## Build a GeoLibre plugin zip

GeoLibre Desktop loads external plugins from an app data `plugins/` directory. The zip must contain `plugin.json` at the root, plus a bundled ESM entry and optional CSS file.

```bash
npm install
npm run package:geolibre
```

This creates:

```text
geolibre-plugin/maplibre-gl-nasa-earthdata-0.1.0.zip
```

Copy the zip into GeoLibre Desktop's app data `plugins/` directory and restart GeoLibre. On Linux with the default app identifier, that directory is usually:

```text
~/.local/share/org.geolibre.desktop/plugins/
```

For the GeoLibre web app, serve the unpacked plugin with CORS enabled:

```bash
npm run package:geolibre
npm run serve:geolibre -- 8000
```

Then add `http://localhost:8000/plugin.json` in GeoLibre Settings > Plugins.

## Development

### Setup

```bash
# Clone the repository
git clone https://github.com/opengeos/maplibre-gl-nasa-earthdata.git
cd maplibre-gl-nasa-earthdata

# Install dependencies
npm install

# Start development server
npm run dev
```

### Scripts

| Script                     | Description                              |
| -------------------------- | ---------------------------------------- |
| `npm run dev`              | Start development server                 |
| `npm run build`            | Build the library and GeoLibre bundle    |
| `npm run build:lib`        | Build the standalone MapLibre library    |
| `npm run build:geolibre`   | Build the GeoLibre ESM and CSS bundle    |
| `npm run package:geolibre` | Build and zip the GeoLibre plugin bundle |
| `npm run build:examples`   | Build examples for deployment            |
| `npm run test`             | Run tests                                |
| `npm run test:ui`          | Run tests with UI                        |
| `npm run test:coverage`    | Run tests with coverage                  |
| `npm run lint`             | Lint the code                            |
| `npm run format`           | Format the code                          |

### Project Structure

```text
maplibre-gl-nasa-earthdata/
├── geolibre-plugin/
│   └── plugin.json          # GeoLibre external plugin manifest
├── scripts/
│   └── package-geolibre-plugin.mjs
├── src/
│   ├── index.ts              # Main entry point
│   ├── geolibre.ts           # GeoLibre plugin wrapper entry point
│   ├── react.ts              # React entry point
│   ├── index.css             # Root styles
│   └── lib/
│       ├── core/             # Control class, React wrapper, and types
│       ├── gibs/             # GIBS capabilities parsing and tile URLs
│       ├── hooks/            # React hooks
│       ├── utils/            # Utility functions
│       └── styles/           # Component styles
├── tests/                    # Test files
├── examples/                 # Example applications
│   ├── basic/               # Vanilla JS example
│   └── react/               # React example
└── .github/workflows/        # CI/CD workflows
```

## Docker

The examples can be run using Docker. The image is automatically built and published to GitHub Container Registry.

```bash
# Pull the latest image
docker pull ghcr.io/opengeos/maplibre-gl-nasa-earthdata:latest

# Run the container
docker run -p 8080:80 ghcr.io/opengeos/maplibre-gl-nasa-earthdata:latest
```

Then open http://localhost:8080/maplibre-gl-nasa-earthdata/ in your browser to view the examples.

```bash
# Or build locally
docker build -t maplibre-gl-nasa-earthdata .
docker run -p 8080:80 maplibre-gl-nasa-earthdata
```

## Attribution

Imagery provided by services from NASA's [Global Imagery Browse Services (GIBS)](https://earthdata.nasa.gov/gibs), part of NASA's Earth Observing System Data and Information System (EOSDIS). The plugin applies a NASA EOSDIS GIBS attribution to added raster sources by default.

## License

MIT License - see [LICENSE](LICENSE) for details.
