import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCapabilities } from '../src/lib/gibs';

const xml = readFileSync(resolve(__dirname, 'fixtures/capabilities.xml'), 'utf-8');

describe('parseCapabilities', () => {
  it('parses raster layers and skips MVT and malformed layers by default', () => {
    const { layers } = parseCapabilities(xml);
    expect(layers.map((l) => l.id)).toEqual(['Test_Air_Temperature_Monthly', 'Test_Blue_Marble']);
  });

  it('includes MVT layers when includeVector is true', () => {
    const { layers } = parseCapabilities(xml, { includeVector: true });
    expect(layers.map((l) => l.id)).toContain('Test_Thermal_Anomalies');
    expect(layers).toHaveLength(3);
    // Mixed-format layers still resolve to raster (png) when vector is enabled
    const temp = layers.find((l) => l.id === 'Test_Air_Temperature_Monthly')!;
    expect(temp.format).toBe('png');
    expect(temp.resourceTemplate).toMatch(/\.png$/i);
  });

  it('always skips layers without a tile ResourceURL', () => {
    const { layers } = parseCapabilities(xml, { includeVector: true });
    expect(layers.map((l) => l.id)).not.toContain('Test_Broken_Layer');
  });

  it('derives the category from the identifier prefix', () => {
    const { layers } = parseCapabilities(xml);
    expect(layers.every((l) => l.category === 'Test')).toBe(true);
  });

  it('parses titles and sorts layers by title', () => {
    const { layers } = parseCapabilities(xml);
    expect(layers.map((l) => l.title)).toEqual(['Air Temperature (Monthly)', 'Blue Marble Imagery']);
  });

  it('parses maxZoom from the TileMatrixSet name', () => {
    const { layers } = parseCapabilities(xml);
    const temp = layers.find((l) => l.id === 'Test_Air_Temperature_Monthly')!;
    const marble = layers.find((l) => l.id === 'Test_Blue_Marble')!;
    expect(temp.tileMatrixSet).toBe('GoogleMapsCompatible_Level9');
    expect(temp.maxZoom).toBe(9);
    expect(marble.maxZoom).toBe(8);
  });

  it('parses format and file extension', () => {
    const { layers } = parseCapabilities(xml);
    const temp = layers.find((l) => l.id === 'Test_Air_Temperature_Monthly')!;
    const marble = layers.find((l) => l.id === 'Test_Blue_Marble')!;
    expect(temp.format).toBe('png');
    expect(temp.fileExtension).toBe('png');
    expect(temp.resourceTemplate).toMatch(/\.png$/i);
    expect(marble.format).toBe('jpeg');
    expect(marble.fileExtension).toBe('jpg');
    expect(marble.resourceTemplate).toMatch(/\.jpe?g$/i);
  });

  it('parses the time dimension with default and values', () => {
    const { layers } = parseCapabilities(xml);
    const temp = layers.find((l) => l.id === 'Test_Air_Temperature_Monthly')!;
    expect(temp.time).toBeDefined();
    expect(temp.time!.default).toBe('2026-03-01');
    expect(temp.time!.values).toEqual(['1980-01-01/2023-11-01/P1M', '2024-02-01/2026-03-01/P1M']);
  });

  it('omits the time dimension for non-time layers', () => {
    const { layers } = parseCapabilities(xml);
    const marble = layers.find((l) => l.id === 'Test_Blue_Marble')!;
    expect(marble.time).toBeUndefined();
  });

  it('prefers the {Time} resource template for time-enabled layers', () => {
    const { layers } = parseCapabilities(xml);
    const temp = layers.find((l) => l.id === 'Test_Air_Temperature_Monthly')!;
    expect(temp.resourceTemplate).toContain('{Time}');
  });

  it('parses the WGS84 bounding box', () => {
    const { layers } = parseCapabilities(xml);
    const temp = layers.find((l) => l.id === 'Test_Air_Temperature_Monthly')!;
    expect(temp.bbox).toEqual([-180, -85.051129, 180, 85.051129]);
  });

  it('parses the legend URL when present', () => {
    const { layers } = parseCapabilities(xml);
    const temp = layers.find((l) => l.id === 'Test_Air_Temperature_Monthly')!;
    const marble = layers.find((l) => l.id === 'Test_Blue_Marble')!;
    expect(temp.legendUrl).toBe('https://gibs.earthdata.nasa.gov/legends/Test_Air_Temperature_H.svg');
    expect(marble.legendUrl).toBeUndefined();
  });

  it('throws on a document without Contents', () => {
    expect(() => parseCapabilities('<Capabilities/>')).toThrow(/missing Contents/);
  });
});
