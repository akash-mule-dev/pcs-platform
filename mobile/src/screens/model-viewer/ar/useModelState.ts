// AR session state for the model: placement, transform (position / scale /
// rotation), lock, and render mode. Pure React hooks (React 18 compatible).
//
// Two camera-first additions over the old version:
//   • PLACE sets position + placed atomically, so auto-placement never flashes
//     the model at a stale position for a frame.
//   • APPLY_AUTOFIT records the scale derived from the loaded model's bounding
//     box (computed once in the scene), so a beam stored in mm and a part stored
//     in m both appear at a sensible ~0.6 m viewing size instead of a guessed
//     fixed scale. `autoFitted` makes it strictly one-shot.
import { useReducer, useRef, useCallback } from 'react';
import { ModelState, ModelAction, Vec3, RenderMode } from './types';

// Provisional starting scale used only for the (invisible) first frame before
// the bbox is read and APPLY_AUTOFIT corrects it. Kept small so a model stored
// in millimetres isn't momentarily kilometres wide.
const DEFAULT_SCALE: Vec3 = [0.05, 0.05, 0.05];
const DEFAULT_POSITION: Vec3 = [0, 0, -1.5];
const DEFAULT_ROTATION: Vec3 = [0, 0, 0];

const RENDER_MODE_CYCLE: RenderMode[] = ['solid', 'ghost', 'wireframe'];

const initialState: ModelState = {
  uri: null,
  fileName: null,
  position: DEFAULT_POSITION,
  scale: DEFAULT_SCALE,
  rotation: DEFAULT_ROTATION,
  locked: false,
  placed: false,
  wireframeUri: null,
  renderMode: 'solid',
  autoFitted: false,
};

function modelReducer(state: ModelState, action: ModelAction): ModelState {
  switch (action.type) {
    case 'SET_URI':
      return {
        ...initialState,
        uri: action.uri,
        fileName: action.fileName,
      };
    case 'SET_POSITION':
      if (state.locked) return state;
      return { ...state, position: action.position };
    case 'NUDGE_POSITION':
      if (state.locked) return state;
      return {
        ...state,
        position: [
          state.position[0] + action.delta[0],
          state.position[1] + action.delta[1],
          state.position[2] + action.delta[2],
        ],
      };
    case 'PLACE':
      // Atomic: position + placed together (no stale-position flash).
      return { ...state, position: action.position, placed: true };
    case 'APPLY_AUTOFIT':
      // One-shot; ignored if already fitted (the scene also guards this).
      if (state.autoFitted) return state;
      return { ...state, scale: action.scale, autoFitted: true };
    case 'SET_SCALE':
      if (state.locked) return state;
      return { ...state, scale: action.scale };
    case 'SET_ROTATION':
      if (state.locked) return state;
      return { ...state, rotation: action.rotation };
    case 'TOGGLE_LOCK':
      return { ...state, locked: !state.locked };
    case 'SET_PLACED':
      return { ...state, placed: action.placed };
    case 'SET_WIREFRAME_URI':
      return { ...state, wireframeUri: action.wireframeUri };
    case 'CYCLE_RENDER_MODE': {
      const currentIdx = RENDER_MODE_CYCLE.indexOf(state.renderMode);
      const nextIdx = (currentIdx + 1) % RENDER_MODE_CYCLE.length;
      let nextMode = RENDER_MODE_CYCLE[nextIdx];
      // Skip wireframe if no wireframe URI is available yet.
      if (nextMode === 'wireframe' && !state.wireframeUri) {
        nextMode = RENDER_MODE_CYCLE[(nextIdx + 1) % RENDER_MODE_CYCLE.length];
      }
      return { ...state, renderMode: nextMode };
    }
    case 'SET_RENDER_MODE': {
      if (action.renderMode === 'wireframe' && !state.wireframeUri) return state;
      return { ...state, renderMode: action.renderMode };
    }
    case 'RESET':
      return {
        ...state,
        position: DEFAULT_POSITION,
        rotation: DEFAULT_ROTATION,
        locked: false,
        placed: false,
        renderMode: 'solid',
        // Keep the auto-fitted scale on reset — re-centering shouldn't shrink
        // the model back to the provisional size.
      };
    default:
      return state;
  }
}

export function useModelState() {
  const [state, dispatch] = useReducer(modelReducer, initialState);
  const baseScaleRef = useRef<Vec3>(DEFAULT_SCALE);

  const setUri = useCallback((uri: string, fileName: string) => {
    baseScaleRef.current = DEFAULT_SCALE;
    dispatch({ type: 'SET_URI', uri, fileName });
  }, []);

  const setPosition = useCallback((position: Vec3) => {
    dispatch({ type: 'SET_POSITION', position });
  }, []);

  const place = useCallback((position: Vec3) => {
    dispatch({ type: 'PLACE', position });
  }, []);

  const nudgePosition = useCallback((delta: Vec3) => {
    dispatch({ type: 'NUDGE_POSITION', delta });
  }, []);

  const setScale = useCallback((scale: Vec3) => {
    dispatch({ type: 'SET_SCALE', scale });
  }, []);

  const applyAutoFit = useCallback((scale: Vec3) => {
    baseScaleRef.current = scale;
    dispatch({ type: 'APPLY_AUTOFIT', scale });
  }, []);

  const setRotation = useCallback((rotation: Vec3) => {
    dispatch({ type: 'SET_ROTATION', rotation });
  }, []);

  const toggleLock = useCallback(() => {
    dispatch({ type: 'TOGGLE_LOCK' });
  }, []);

  const setPlaced = useCallback((placed: boolean) => {
    dispatch({ type: 'SET_PLACED', placed });
  }, []);

  const setWireframeUri = useCallback((wireframeUri: string) => {
    dispatch({ type: 'SET_WIREFRAME_URI', wireframeUri });
  }, []);

  const cycleRenderMode = useCallback(() => {
    dispatch({ type: 'CYCLE_RENDER_MODE' });
  }, []);

  const setRenderMode = useCallback((renderMode: RenderMode) => {
    dispatch({ type: 'SET_RENDER_MODE', renderMode });
  }, []);

  const toggleEdgesMode = useCallback(() => {
    dispatch({
      type: 'SET_RENDER_MODE',
      renderMode: state.renderMode === 'wireframe' ? 'solid' : 'wireframe',
    });
  }, [state.renderMode]);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  const handlePinch = useCallback(
    (pinchState: number, scaleFactor: number) => {
      if (state.locked) return;
      if (pinchState === 2) {
        const newScale: Vec3 = baseScaleRef.current.map(
          (s) => Math.max(0.001, Math.min(8, s * scaleFactor)),
        ) as Vec3;
        dispatch({ type: 'SET_SCALE', scale: newScale });
      } else if (pinchState === 3) {
        baseScaleRef.current = state.scale;
      }
    },
    [state.locked, state.scale],
  );

  return {
    state,
    setUri,
    setPosition,
    place,
    nudgePosition,
    setScale,
    applyAutoFit,
    setRotation,
    toggleLock,
    setPlaced,
    setWireframeUri,
    cycleRenderMode,
    setRenderMode,
    toggleEdgesMode,
    reset,
    handlePinch,
    baseScaleRef,
  };
}
