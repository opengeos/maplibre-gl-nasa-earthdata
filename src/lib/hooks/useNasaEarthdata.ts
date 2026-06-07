import { useState, useCallback } from "react";
import type { NasaEarthdataState, AddedLayerState } from "../core/types";

/**
 * Default initial state for the NASA Earthdata control
 */
const DEFAULT_STATE: NasaEarthdataState = {
  collapsed: true,
  panelWidth: 320,
  query: "",
  addedLayers: [],
};

/**
 * Custom hook for managing NASA Earthdata control state in React applications.
 *
 * This hook provides a simple way to track and update the state
 * of a NasaEarthdataControl from React components.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { state, setState, setCollapsed, toggle } = useNasaEarthdata();
 *
 *   return (
 *     <div>
 *       <button onClick={toggle}>
 *         {state.collapsed ? 'Expand' : 'Collapse'}
 *       </button>
 *       <NasaEarthdataControlReact
 *         map={map}
 *         collapsed={state.collapsed}
 *         onStateChange={setState}
 *       />
 *     </div>
 *   );
 * }
 * ```
 *
 * @param initialState - Optional initial state values
 * @returns Object containing state and update functions
 */
export function useNasaEarthdata(initialState?: Partial<NasaEarthdataState>) {
  const [state, setState] = useState<NasaEarthdataState>({
    ...DEFAULT_STATE,
    ...initialState,
  });

  /**
   * Sets the collapsed state
   */
  const setCollapsed = useCallback((collapsed: boolean) => {
    setState((prev) => ({ ...prev, collapsed }));
  }, []);

  /**
   * Sets the panel width
   */
  const setPanelWidth = useCallback((panelWidth: number) => {
    setState((prev) => ({ ...prev, panelWidth }));
  }, []);

  /**
   * Sets the search query
   */
  const setQuery = useCallback((query: string) => {
    setState((prev) => ({ ...prev, query }));
  }, []);

  /**
   * Sets the list of added layers
   */
  const setAddedLayers = useCallback((addedLayers: AddedLayerState[]) => {
    setState((prev) => ({ ...prev, addedLayers }));
  }, []);

  /**
   * Resets the state to default values
   */
  const reset = useCallback(() => {
    setState({ ...DEFAULT_STATE, ...initialState });
  }, [initialState]);

  /**
   * Toggles the collapsed state
   */
  const toggle = useCallback(() => {
    setState((prev) => ({ ...prev, collapsed: !prev.collapsed }));
  }, []);

  return {
    state,
    setState,
    setCollapsed,
    setPanelWidth,
    setQuery,
    setAddedLayers,
    reset,
    toggle,
  };
}
