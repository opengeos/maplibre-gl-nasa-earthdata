import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NasaEarthdataControl } from '../src/lib/core/NasaEarthdataControl';

const xml = readFileSync(resolve(__dirname, 'fixtures/capabilities.xml'), 'utf-8');

/**
 * Builds a minimal fake MapLibre map that records the source/layer ids it
 * knows about and the paint/layout properties applied to them. The set of
 * ids returned by getSource/getLayer is configurable so tests can simulate a
 * host application that has already recreated the control's native source and
 * layer from persisted state.
 */
function makeFakeMap(existingIds: string[] = []) {
  const sources = new Set(existingIds);
  const layers = new Set(existingIds);
  const paint = new Map<string, Record<string, unknown>>();
  const layout = new Map<string, Record<string, unknown>>();
  return {
    addSource: vi.fn((id: string) => {
      sources.add(id);
    }),
    addLayer: vi.fn((layer: { id: string }) => {
      layers.add(layer.id);
    }),
    getSource: vi.fn((id: string) => (sources.has(id) ? { id } : undefined)),
    getLayer: vi.fn((id: string) => (layers.has(id) ? { id } : undefined)),
    setPaintProperty: vi.fn((id: string, prop: string, value: unknown) => {
      const props = paint.get(id) ?? {};
      props[prop] = value;
      paint.set(id, props);
    }),
    setLayoutProperty: vi.fn((id: string, prop: string, value: unknown) => {
      const props = layout.get(id) ?? {};
      props[prop] = value;
      layout.set(id, props);
    }),
    getStyle: vi.fn(() => ({ layers: [] })),
    paint,
    layout,
  };
}

describe('NasaEarthdataControl.addLayer', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(xml, { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reuses an existing native source/layer and applies opacity/visibility', async () => {
    const control = new NasaEarthdataControl();
    await control.getCapabilities();

    // Simulate a host application that has already restored the native
    // source/layer from persisted state before activating the control.
    const mapId = 'nasa-gibs-Test_Blue_Marble';
    const fakeMap = makeFakeMap([mapId]);

    // Attach the fake map without going through onAdd (no DOM panel needed).
    (control as unknown as { _map: unknown })._map = fakeMap;

    expect(() =>
      control.addLayer('Test_Blue_Marble', { opacity: 0.4, visible: false }),
    ).not.toThrow();

    // The existing source/layer must be reused, not re-added.
    expect(fakeMap.addSource).not.toHaveBeenCalled();
    expect(fakeMap.addLayer).not.toHaveBeenCalled();

    // Requested opacity/visibility must be applied to the reused layer.
    expect(fakeMap.setPaintProperty).toHaveBeenCalledWith(
      mapId,
      'raster-opacity',
      0.4,
    );
    expect(fakeMap.setLayoutProperty).toHaveBeenCalledWith(
      mapId,
      'visibility',
      'none',
    );

    // State registration still happens.
    expect(control.getAddedLayers().map((l) => l.key)).toContain(
      'Test_Blue_Marble',
    );
  });

  it('adds a new native source/layer when none exists yet', async () => {
    const control = new NasaEarthdataControl();
    await control.getCapabilities();

    const fakeMap = makeFakeMap();
    (control as unknown as { _map: unknown })._map = fakeMap;

    control.addLayer('Test_Blue_Marble', { opacity: 0.7, visible: true });

    expect(fakeMap.addSource).toHaveBeenCalledTimes(1);
    expect(fakeMap.addLayer).toHaveBeenCalledTimes(1);
    // The new layer is created with the requested paint/layout, so no
    // post-hoc property updates are needed.
    expect(fakeMap.setPaintProperty).not.toHaveBeenCalled();
    expect(fakeMap.setLayoutProperty).not.toHaveBeenCalled();
  });
});
