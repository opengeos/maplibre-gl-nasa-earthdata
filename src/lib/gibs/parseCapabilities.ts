import type {
  GibsCapabilities,
  GibsLayer,
  GibsLayerFormat,
  GibsTimeDimension,
  ParseOptions,
} from "./types";

const FORMAT_MAP: Record<string, GibsLayerFormat> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "application/vnd.mapbox-vector-tile": "mvt",
};

const MIME_MAP: Record<GibsLayerFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  mvt: "application/vnd.mapbox-vector-tile",
};

/**
 * Returns the direct child elements of a node matching a local tag name,
 * ignoring XML namespaces.
 */
function childrenByLocalName(parent: Element, localName: string): Element[] {
  const result: Element[] = [];
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (child.localName === localName) {
      result.push(child);
    }
  }
  return result;
}

/**
 * Returns the text content of the first direct child element matching a local tag name.
 */
function childText(parent: Element, localName: string): string | undefined {
  const child = childrenByLocalName(parent, localName)[0];
  return child?.textContent?.trim() || undefined;
}

/**
 * Parses the WGS84 bounding box of a layer element.
 */
function parseBbox(
  layerEl: Element,
): [number, number, number, number] | undefined {
  const bboxEl = childrenByLocalName(layerEl, "WGS84BoundingBox")[0];
  if (!bboxEl) return undefined;

  const lower = childText(bboxEl, "LowerCorner")?.split(/\s+/).map(Number);
  const upper = childText(bboxEl, "UpperCorner")?.split(/\s+/).map(Number);
  if (!lower || !upper || lower.length < 2 || upper.length < 2)
    return undefined;
  if ([...lower, ...upper].some((n) => Number.isNaN(n))) return undefined;

  return [lower[0], lower[1], upper[0], upper[1]];
}

/**
 * Parses the Time dimension of a layer element, if present.
 */
function parseTimeDimension(layerEl: Element): GibsTimeDimension | undefined {
  const dimensions = childrenByLocalName(layerEl, "Dimension");
  for (const dim of dimensions) {
    if (childText(dim, "Identifier") !== "Time") continue;

    const defaultValue = childText(dim, "Default");
    if (!defaultValue) return undefined;

    const values = childrenByLocalName(dim, "Value")
      .map((v) => v.textContent?.trim())
      .filter((v): v is string => Boolean(v));

    return { default: defaultValue, values };
  }
  return undefined;
}

/**
 * Parses the first legend URL advertised in a layer's default style.
 */
function parseLegendUrl(layerEl: Element): string | undefined {
  const styles = childrenByLocalName(layerEl, "Style");
  for (const style of styles) {
    const legend = childrenByLocalName(style, "LegendURL")[0];
    const href =
      legend?.getAttribute("xlink:href") ??
      legend?.getAttributeNS(null, "href");
    if (href) return href;
  }
  return undefined;
}

/**
 * Parses a single WMTS Layer element into a GibsLayer.
 * Returns undefined for layers that cannot be represented (missing
 * identifier, no tile resource template, or unsupported format).
 */
function parseLayer(
  layerEl: Element,
  includeVector: boolean,
): GibsLayer | undefined {
  const id = childText(layerEl, "Identifier");
  if (!id) return undefined;

  const title = childText(layerEl, "Title") ?? id;

  // Collect supported formats; prefer png > jpeg > mvt.
  const formats = childrenByLocalName(layerEl, "Format")
    .map((f) => FORMAT_MAP[f.textContent?.trim() ?? ""])
    .filter((f): f is GibsLayerFormat => Boolean(f));
  const format = (["png", "jpeg", "mvt"] as const).find((f) =>
    formats.includes(f),
  );
  if (!format) return undefined;
  if (format === "mvt" && !includeVector) return undefined;

  // Tile matrix set link, e.g. "GoogleMapsCompatible_Level9" -> maxZoom 9.
  const tmsLink = childrenByLocalName(layerEl, "TileMatrixSetLink")[0];
  const tileMatrixSet = tmsLink
    ? childText(tmsLink, "TileMatrixSet")
    : undefined;
  if (!tileMatrixSet) return undefined;
  const levelMatch = /Level(\d+)$/.exec(tileMatrixSet);
  const maxZoom = levelMatch ? parseInt(levelMatch[1], 10) : 9;

  // Tile resource template. Only consider templates whose advertised format
  // matches the chosen layer format, then prefer the template containing
  // {Time} when the layer is time-enabled so dates can be substituted.
  const resourceUrls = childrenByLocalName(layerEl, "ResourceURL").filter(
    (r) => r.getAttribute("resourceType") === "tile",
  );
  if (resourceUrls.length === 0) return undefined;

  const selectedMime = MIME_MAP[format];
  const formatMatched = resourceUrls.filter((r) => {
    const mime = r.getAttribute("format")?.trim().toLowerCase();
    return !mime || mime === selectedMime;
  });

  const templates = (formatMatched.length > 0 ? formatMatched : resourceUrls)
    .map((r) => r.getAttribute("template"))
    .filter((t): t is string => Boolean(t));
  if (templates.length === 0) return undefined;

  const time = parseTimeDimension(layerEl);
  const resourceTemplate =
    (time ? templates.find((t) => t.includes("{Time}")) : undefined) ??
    templates.find((t) => !t.includes("{Time}")) ??
    templates[0];

  const extMatch = /\.([a-z0-9]+)$/i.exec(resourceTemplate);
  const fileExtension = extMatch
    ? extMatch[1]
    : format === "jpeg"
      ? "jpg"
      : format;

  return {
    id,
    title,
    format,
    fileExtension,
    tileMatrixSet,
    maxZoom,
    bbox: parseBbox(layerEl),
    resourceTemplate,
    time,
    legendUrl: parseLegendUrl(layerEl),
  };
}

/**
 * Parses a WMTS GetCapabilities XML document into a GibsCapabilities object.
 *
 * Layers without a usable tile resource template are skipped. Vector-tile
 * (MVT) layers are skipped unless `options.includeVector` is true.
 *
 * @param xml - The raw WMTSCapabilities.xml document text
 * @param options - Parse options
 * @returns Parsed capabilities with layers sorted by title
 */
export function parseCapabilities(
  xml: string,
  options?: ParseOptions,
): GibsCapabilities {
  const includeVector = options?.includeVector ?? false;

  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw new Error(
      `Failed to parse capabilities XML: ${parserError.textContent ?? "unknown error"}`,
    );
  }

  const root = doc.documentElement;
  const contents = childrenByLocalName(root, "Contents")[0];
  if (!contents) {
    throw new Error("Invalid capabilities document: missing Contents element");
  }

  const layers: GibsLayer[] = [];
  for (const layerEl of childrenByLocalName(contents, "Layer")) {
    const layer = parseLayer(layerEl, includeVector);
    if (layer) layers.push(layer);
  }

  layers.sort((a, b) => a.title.localeCompare(b.title));

  return { layers, fetchedAt: Date.now() };
}
