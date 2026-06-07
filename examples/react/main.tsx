import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import maplibregl, { Map } from 'maplibre-gl';
import { NasaEarthdataControlReact, useNasaEarthdata } from '../../src/react';
import type { GibsLayer } from '../../src/react';
import '../../src/index.css';
import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * Main App component demonstrating the React integration
 */
function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<Map | null>(null);
  const { state, setState, toggle } = useNasaEarthdata({ collapsed: false });
  const [lastAdded, setLastAdded] = useState<string | null>(null);

  // Initialize the map
  useEffect(() => {
    if (!mapContainer.current) return;

    const mapInstance = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [0, 20],
      zoom: 2,
    });

    // Add navigation controls to top-right
    mapInstance.addControl(new maplibregl.NavigationControl(), 'top-right');

    // Add fullscreen control to top-right (after navigation)
    mapInstance.addControl(new maplibregl.FullscreenControl(), 'top-right');

    mapInstance.on('load', () => {
      setMap(mapInstance);
    });

    return () => {
      mapInstance.remove();
    };
  }, []);

  const handleLayerAdd = (layer: GibsLayer) => {
    setLastAdded(layer.title);
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />

      {/* External toggle button */}
      <button
        onClick={toggle}
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          zIndex: 1,
          padding: '8px 16px',
          background: '#2563eb',
          color: 'white',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          fontWeight: 500,
        }}
      >
        {state.collapsed ? 'Expand' : 'Collapse'} Panel
      </button>

      {/* Status bar driven by control state */}
      <div
        style={{
          position: 'absolute',
          bottom: 10,
          left: 10,
          zIndex: 1,
          padding: '6px 12px',
          background: 'rgba(0, 0, 0, 0.65)',
          color: 'white',
          borderRadius: 4,
          fontSize: 12,
        }}
      >
        {state.addedLayers.length} layer{state.addedLayers.length === 1 ? '' : 's'} on map
        {lastAdded ? ` · last added: ${lastAdded}` : ''}
      </div>

      {/* NASA Earthdata control */}
      {map && (
        <NasaEarthdataControlReact
          map={map}
          title="NASA Earthdata"
          collapsed={state.collapsed}
          panelWidth={320}
          onStateChange={setState}
          onLayerAdd={handleLayerAdd}
        />
      )}
    </div>
  );
}

// Mount the app
const root = createRoot(document.getElementById('root')!);
root.render(<App />);
