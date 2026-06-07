import { describe, it, expect } from 'vitest';
import { searchLayers } from '../src/lib/gibs';
import type { GibsLayer } from '../src/lib/gibs';

function makeLayer(id: string, title: string): GibsLayer {
  return {
    id,
    title,
    format: 'png',
    fileExtension: 'png',
    tileMatrixSet: 'GoogleMapsCompatible_Level9',
    maxZoom: 9,
    resourceTemplate: `https://example.com/${id}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png`,
  };
}

const layers = [
  makeLayer('MODIS_Terra_TrueColor', 'Corrected Reflectance (True Color, MODIS Terra)'),
  makeLayer('MERRA2_Air_Temperature', '2-meter Air Temperature (Monthly)'),
  makeLayer('VIIRS_SNPP_NightLights', 'Black Marble Night Lights'),
];

describe('searchLayers', () => {
  it('returns all layers for an empty query', () => {
    expect(searchLayers(layers, '')).toHaveLength(3);
    expect(searchLayers(layers, '   ')).toHaveLength(3);
  });

  it('matches titles case-insensitively', () => {
    const result = searchLayers(layers, 'TEMPERATURE');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('MERRA2_Air_Temperature');
  });

  it('matches identifiers case-insensitively', () => {
    const result = searchLayers(layers, 'viirs_snpp');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('VIIRS_SNPP_NightLights');
  });

  it('returns an empty array when nothing matches', () => {
    expect(searchLayers(layers, 'no-such-layer')).toEqual([]);
  });
});
