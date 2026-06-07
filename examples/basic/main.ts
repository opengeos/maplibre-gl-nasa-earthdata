import maplibregl from 'maplibre-gl';
import { NasaEarthdataControl } from '../../src/index';
import '../../src/index.css';
import 'maplibre-gl/dist/maplibre-gl.css';

// Create map
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/liberty',
  center: [0, 20],
  zoom: 2,
});

// Add navigation controls to top-right
map.addControl(new maplibregl.NavigationControl(), 'top-right');

// Add fullscreen control to top-right (after navigation)
map.addControl(new maplibregl.FullscreenControl(), 'top-right');

// Add the NASA Earthdata control when the map loads
map.on('load', () => {
  // Set collapsed: true to start with just the 29x29 button (like navigation control)
  const earthdataControl = new NasaEarthdataControl({
    title: 'NASA Earthdata',
    collapsed: false,
    panelWidth: 320,
  });

  // Add control to the map
  map.addControl(earthdataControl, 'top-right');

  // Add Globe control to the map
  map.addControl(new maplibregl.GlobeControl(), 'top-right');

  // Listen for events
  earthdataControl.on('capabilitiesload', (event) => {
    console.log('GIBS layer catalog loaded', event.state);
  });

  earthdataControl.on('layeradd', (event) => {
    console.log('Layer added:', event.layer?.id);
  });

  earthdataControl.on('layerremove', (event) => {
    console.log('Layer removed:', event.layer?.id);
  });

  earthdataControl.on('error', (event) => {
    console.error('NASA Earthdata control error:', event.error);
  });

  // Layers can also be added programmatically once the catalog is loaded:
  // await earthdataControl.getCapabilities();
  // earthdataControl.addLayer('MODIS_Terra_CorrectedReflectance_TrueColor', {
  //   date: '2024-06-01',
  //   opacity: 0.8,
  // });

  console.log('NASA Earthdata control added to map');
});
