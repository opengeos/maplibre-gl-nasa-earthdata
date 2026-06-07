import { describe, it, expect } from 'vitest';
import { buildTileUrl } from '../src/lib/gibs';
import type { GibsLayer } from '../src/lib/gibs';

const timeLayer: GibsLayer = {
  id: 'Test_Time_Layer',
  title: 'Test Time Layer',
  format: 'png',
  fileExtension: 'png',
  tileMatrixSet: 'GoogleMapsCompatible_Level9',
  maxZoom: 9,
  resourceTemplate:
    'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Test_Time_Layer/default/{Time}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png',
  time: { default: '2026-03-01', values: ['1980-01-01/2026-03-01/P1M'] },
};

const staticLayer: GibsLayer = {
  id: 'Test_Static_Layer',
  title: 'Test Static Layer',
  format: 'jpeg',
  fileExtension: 'jpg',
  tileMatrixSet: 'GoogleMapsCompatible_Level8',
  maxZoom: 8,
  resourceTemplate:
    'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Test_Static_Layer/default/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpg',
};

describe('buildTileUrl', () => {
  it('substitutes the given time and maps WMTS placeholders to z/y/x', () => {
    expect(buildTileUrl(timeLayer, '2020-05-15')).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Test_Time_Layer/default/2020-05-15/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png'
    );
  });

  it('falls back to the layer default date when no time is given', () => {
    expect(buildTileUrl(timeLayer)).toContain('/2026-03-01/');
  });

  it('ignores time for layers without a {Time} placeholder', () => {
    expect(buildTileUrl(staticLayer, '2020-05-15')).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Test_Static_Layer/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg'
    );
  });
});
