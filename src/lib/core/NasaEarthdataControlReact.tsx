import { useEffect, useRef } from "react";
import { NasaEarthdataControl } from "./NasaEarthdataControl";
import type { NasaEarthdataReactProps } from "./types";

/**
 * React wrapper component for NasaEarthdataControl.
 *
 * This component manages the lifecycle of a NasaEarthdataControl instance,
 * adding it to the map on mount and removing it on unmount.
 *
 * @example
 * ```tsx
 * import { NasaEarthdataControlReact } from 'maplibre-gl-nasa-earthdata/react';
 *
 * function MyMap() {
 *   const [map, setMap] = useState<Map | null>(null);
 *
 *   return (
 *     <>
 *       <div ref={mapContainer} />
 *       {map && (
 *         <NasaEarthdataControlReact
 *           map={map}
 *           title="NASA Earthdata"
 *           collapsed={false}
 *           onLayerAdd={(layer) => console.log('Added', layer.id)}
 *         />
 *       )}
 *     </>
 *   );
 * }
 * ```
 *
 * @param props - Component props including map instance and control options
 * @returns null - This component renders nothing directly
 */
export function NasaEarthdataControlReact({
  map,
  onStateChange,
  onLayerAdd,
  onLayerRemove,
  ...options
}: NasaEarthdataReactProps): null {
  const controlRef = useRef<NasaEarthdataControl | null>(null);

  useEffect(() => {
    if (!map) return;

    // Create the control instance
    const control = new NasaEarthdataControl(options);
    controlRef.current = control;

    // Register event handlers if provided
    if (onStateChange) {
      control.on("statechange", (event) => {
        onStateChange(event.state);
      });
    }
    if (onLayerAdd) {
      control.on("layeradd", (event) => {
        if (event.layer) {
          onLayerAdd(event.layer);
        }
      });
    }
    if (onLayerRemove) {
      control.on("layerremove", (event) => {
        if (event.layer) {
          onLayerRemove(event.layer.id);
        }
      });
    }

    // Add control to map
    map.addControl(control, options.position || "top-right");

    // Cleanup on unmount
    return () => {
      if (map.hasControl(control)) {
        map.removeControl(control);
      }
      controlRef.current = null;
    };
  }, [map]);

  // Update options when they change
  useEffect(() => {
    if (controlRef.current) {
      // Handle collapsed state changes
      const currentState = controlRef.current.getState();
      if (
        options.collapsed !== undefined &&
        options.collapsed !== currentState.collapsed
      ) {
        if (options.collapsed) {
          controlRef.current.collapse();
        } else {
          controlRef.current.expand();
        }
      }
    }
  }, [options.collapsed]);

  return null;
}
