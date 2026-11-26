import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NasaEarthdataControl } from "../src/lib/core/NasaEarthdataControl";
import type { NasaEarthdataControlOptions } from "../src/lib/core/types";

const xml = readFileSync(
  resolve(__dirname, "fixtures/capabilities.xml"),
  "utf-8",
);

// Monthly layer in the fixture: default 2026-03-01, domain ends there.
const MONTHLY = "Test_Air_Temperature_Monthly";
// Layer without a time dimension.
const STATIC = "Test_Blue_Marble";

/** A fake map that records the source tile URLs it was asked to add. */
function makeFakeMap() {
  const sources = new Map<string, { tiles: string[] }>();
  const layers = new Set<string>();
  return {
    sources,
    addSource: vi.fn((id: string, spec: { tiles: string[] }) => {
      sources.set(id, spec);
    }),
    addLayer: vi.fn((layer: { id: string }) => {
      layers.add(layer.id);
    }),
    getSource: vi.fn((id: string) => sources.get(id)),
    getLayer: vi.fn((id: string) => (layers.has(id) ? { id } : undefined)),
    removeLayer: vi.fn((id: string) => layers.delete(id)),
    removeSource: vi.fn((id: string) => sources.delete(id)),
    setPaintProperty: vi.fn(),
    setLayoutProperty: vi.fn(),
    getStyle: vi.fn(() => ({ layers: [] })),
    off: vi.fn(),
  };
}

/** A probe fetch answering by URL, recording what it was asked. */
function probe(statusFor: (url: string) => number) {
  const requested: string[] = [];
  const fetch = vi.fn(async (url: string) => {
    requested.push(url);
    return { status: statusFor(url) };
  });
  return { fetch, requested };
}

/** The dates of the added layer instances. */
function addedDates(control: NasaEarthdataControl): (string | undefined)[] {
  return control.getAddedLayers().map((layer) => layer.date);
}

async function makeControl(options?: Partial<NasaEarthdataControlOptions>) {
  const control = new NasaEarthdataControl(options);
  await control.getCapabilities();
  const map = makeFakeMap();
  (control as unknown as { _map: unknown })._map = map;
  return { control, map };
}

/** Clicks the panel's Add button for a layer (the private panel path). */
function panelAdd(control: NasaEarthdataControl, layerId: string): void {
  (control as unknown as { _addFromPanel(id: string): void })._addFromPanel(
    layerId,
  );
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("default-date fallback", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(xml, { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds at the newest earlier date with imagery when the default has none", async () => {
    const { fetch, requested } = probe((url) =>
      url.includes("/2026-03-01/") ? 404 : 200,
    );
    const { control, map } = await makeControl({
      defaultDateFallback: { fetch },
    });

    await control.addLayerAtAvailableDate(MONTHLY);

    expect(addedDates(control)).toEqual(["2026-02-01"]);
    expect(requested).toEqual([
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Test_Air_Temperature_Monthly/default/2026-03-01/GoogleMapsCompatible_Level9/0/0/0.png",
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Test_Air_Temperature_Monthly/default/2026-02-01/GoogleMapsCompatible_Level9/0/0/0.png",
    ]);
    expect([...map.sources.values()][0].tiles[0]).toContain("/2026-02-01/");
  });

  it("keeps a default date that has imagery, with one probe", async () => {
    const { fetch, requested } = probe(() => 200);
    const { control } = await makeControl({ defaultDateFallback: { fetch } });
    await control.addLayerAtAvailableDate(MONTHLY);
    expect(addedDates(control)).toEqual(["2026-03-01"]);
    expect(requested).toHaveLength(1);
  });

  it("honours maxSteps and keeps the default when no date in range works", async () => {
    const { fetch, requested } = probe(() => 404);
    const { control } = await makeControl({
      defaultDateFallback: { fetch, maxSteps: 2 },
    });
    await control.addLayerAtAvailableDate(MONTHLY);
    expect(addedDates(control)).toEqual(["2026-03-01"]);
    expect(requested).toHaveLength(3);
  });

  it("keeps the default date when the probe fails outright", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { control } = await makeControl({ defaultDateFallback: { fetch } });
    await control.addLayerAtAvailableDate(MONTHLY);
    expect(addedDates(control)).toEqual(["2026-03-01"]);
  });

  it("adds calls naming a date or key, and non-time layers, without probing", async () => {
    const { fetch } = probe(() => 404);
    const { control } = await makeControl({ defaultDateFallback: { fetch } });
    await control.addLayerAtAvailableDate(MONTHLY, { date: "2026-03-01" });
    await control.addLayerAtAvailableDate(MONTHLY, { key: "restored" });
    await control.addLayerAtAvailableDate(STATIC);
    expect(fetch).not.toHaveBeenCalled();
    expect(control.getAddedLayers()).toHaveLength(3);
  });

  it("ignores a repeat add while that layer is still probing", async () => {
    const { fetch } = probe(() => 200);
    const { control } = await makeControl({ defaultDateFallback: { fetch } });
    const first = control.addLayerAtAvailableDate(MONTHLY);
    const second = control.addLayerAtAvailableDate(MONTHLY);
    await Promise.all([first, second]);
    expect(control.getAddedLayers()).toHaveLength(1);
    // Once the probe settled, a later add (another instance on purpose) goes through.
    await control.addLayerAtAvailableDate(MONTHLY);
    expect(control.getAddedLayers()).toHaveLength(2);
  });

  it("adds nothing once the control is removed while probing", async () => {
    const { fetch } = probe(() => 200);
    const { control, map } = await makeControl({
      defaultDateFallback: { fetch },
    });
    const pending = control.addLayerAtAvailableDate(MONTHLY);
    control.onRemove();
    // A later mount must not receive the stale add either.
    (control as unknown as { _map: unknown })._map = map;
    await pending;
    expect(map.addSource).not.toHaveBeenCalled();
  });

  it("probes the panel Add by default", async () => {
    const { fetch } = probe((url) =>
      url.includes("/2026-03-01/") ? 404 : 200,
    );
    const { control } = await makeControl({ defaultDateFallback: { fetch } });
    panelAdd(control, MONTHLY);
    expect(control.getAddedLayers()).toHaveLength(0);
    await settle();
    expect(addedDates(control)).toEqual(["2026-02-01"]);
  });

  it("adds at the default date at once when the option is false", async () => {
    const { control } = await makeControl({ defaultDateFallback: false });
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchSpy.mockClear();
    panelAdd(control, MONTHLY);
    expect(addedDates(control)).toEqual(["2026-03-01"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("leaves programmatic addLayer synchronous and unprobed", async () => {
    const { fetch } = probe(() => 404);
    const { control } = await makeControl({ defaultDateFallback: { fetch } });
    control.addLayer(MONTHLY);
    expect(addedDates(control)).toEqual(["2026-03-01"]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("getPanelElement", () => {
  it("is undefined until the control is added to a map", () => {
    expect(new NasaEarthdataControl().getPanelElement()).toBeUndefined();
  });
});
