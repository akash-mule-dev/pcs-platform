import React from 'react';
import { render, act } from '@testing-library/react-native';

// ── Mocks ──

const TRACKING_NORMAL = 3;
const TRACKING_LIMITED = 2;
const TRACKING_UNAVAILABLE = 1;

// Capture the props ViroARScene / ViroARPlane receive so tests can drive
// onClick / onTrackingUpdated / onAnchorFound as the native layer would.
let sceneProps: any = null;
let planeProps: any = null;

// @gltf-transform is pulled in (transitively, via the measurement overlays'
// dimension formatter). The scene never parses GLBs, so a stub is plenty.
jest.mock('@gltf-transform/core', () => ({
  WebIO: class {},
  Document: class {},
  Node: class {},
}));

jest.mock('@reactvision/react-viro', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    // forwardRef but DOES NOT expose a camera — sceneRef.current stays null, so
    // placement falls back to the tap/fixed position (deterministic in tests).
    ViroARScene: React.forwardRef((props: any, _ref: any) => {
      sceneProps = props;
      return React.createElement(View, { testID: 'viro-ar-scene' }, props.children);
    }),
    ViroAmbientLight: () => null,
    ViroDirectionalLight: () => null,
    ViroSpotLight: () => null,
    Viro3DObject: () => React.createElement(View, { testID: 'viro-3d-object' }, null),
    ViroNode: (props: any) => React.createElement(View, { testID: 'viro-node' }, props.children),
    ViroARPlane: (props: any) => {
      planeProps = props;
      return React.createElement(View, { testID: 'viro-ar-plane' }, props.children);
    },
    ViroText: () => null,
    ViroSphere: () => null,
    ViroBox: () => null,
    ViroPolyline: () => null,
    ViroARPlaneSelector: (props: any) => React.createElement(View, null, props.children),
    ViroARImageMarker: (props: any) => React.createElement(View, null, props.children),
    ViroMaterials: { createMaterials: jest.fn() },
    ViroARTrackingTargets: { createTargets: jest.fn() },
    ViroAnimations: { registerAnimations: jest.fn() },
    ViroTrackingStateConstants: {
      TRACKING_NORMAL,
      TRACKING_LIMITED,
      TRACKING_UNAVAILABLE,
    },
  };
});

// Must import AFTER mocks (this re-exports the ported ./ar/ARModelScene).
import ARModelScene from '../ARModelScene';

const DEFAULT_MEASUREMENTS = {
  showOverall: false,
  showParts: false,
  modelRulerActive: false,
  realRulerActive: false,
  modelRulerPoints: [],
  realRulerPoints: [],
  deviationActive: false,
  deviationModelPoint: null,
  deviationRealPoint: null,
  labelSize: 1,
};

function makeProps(overrides: Record<string, any> = {}) {
  return {
    sceneNavigator: {
      viroAppProps: {
        modelUri: 'file:///model.glb',
        wireframeUri: null,
        renderMode: 'solid' as const,
        trackingMode: 'world' as const,
        placed: false,
        autoFitted: false,
        // Default OFF so the existing render/tap tests stay timer-free.
        autoPlace: false,
        position: [0, 0, -1.5] as [number, number, number],
        scale: [0.05, 0.05, 0.05] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        locked: false,
        dimensions: null,
        measurements: DEFAULT_MEASUREMENTS,
        onPlace: jest.fn(),
        onAutoFit: jest.fn(),
        onPinch: jest.fn(),
        onRotate: jest.fn(),
        onModelStatus: jest.fn(),
        onTrackingUpdated: jest.fn(),
        onAddModelRulerPoint: jest.fn(),
        onAddRealRulerPoint: jest.fn(),
        ...overrides,
      },
    },
  };
}

describe('ARModelScene (camera-first AR scene)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sceneProps = null;
    planeProps = null;
  });

  it('always renders the AR scene (camera open before the model)', () => {
    const { getByTestId } = render(<ARModelScene {...makeProps()} />);
    expect(getByTestId('viro-ar-scene')).toBeTruthy();
  });

  it('does not render the model before it is placed', () => {
    const { queryByTestId } = render(<ARModelScene {...makeProps({ placed: false })} />);
    expect(queryByTestId('viro-3d-object')).toBeNull();
  });

  it('renders the model once placed (world mode)', () => {
    const { queryAllByTestId, queryByTestId } = render(
      <ARModelScene {...makeProps({ placed: true })} />,
    );
    // The model is wrapped in a transform node + a fade node, so there are
    // multiple viro-node hosts once placed.
    expect(queryAllByTestId('viro-node').length).toBeGreaterThan(0);
    expect(queryByTestId('viro-3d-object')).toBeTruthy();
  });

  it('maps native tracking states to friendly status strings', () => {
    const props = makeProps();
    render(<ARModelScene {...props} />);
    const onTrackingUpdated = props.sceneNavigator.viroAppProps.onTrackingUpdated;

    act(() => sceneProps.onTrackingUpdated(TRACKING_NORMAL));
    expect(onTrackingUpdated).toHaveBeenCalledWith('normal');

    act(() => sceneProps.onTrackingUpdated(TRACKING_LIMITED));
    expect(onTrackingUpdated).toHaveBeenCalledWith('limited');
  });

  it('places the model when the scene is tapped (manual fallback, not yet placed)', () => {
    const props = makeProps({ placed: false });
    render(<ARModelScene {...props} />);

    act(() => {
      sceneProps.onClick([0.1, -0.2, -1]);
    });

    // No camera exposed in the test, so placement falls back to the tap position.
    expect(props.sceneNavigator.viroAppProps.onPlace).toHaveBeenCalledWith([0.1, -0.2, -1]);
  });

  it('anchors the model under a ViroARPlane in anchor mode (no free placement needed)', () => {
    const { getByTestId, queryByTestId } = render(
      <ARModelScene {...makeProps({ anchorMode: true, placed: false })} />,
    );
    // The model rides an ARKit plane anchor instead of a free world coordinate,
    // and it renders even though it was never free-placed.
    expect(getByTestId('viro-ar-plane')).toBeTruthy();
    expect(queryByTestId('viro-3d-object')).toBeTruthy();
  });

  it('does not run free auto-place in anchor mode', async () => {
    jest.useFakeTimers();
    try {
      const props = makeProps({ anchorMode: true, autoPlace: true, placed: false });
      render(<ARModelScene {...props} />);
      await act(async () => {
        jest.advanceTimersByTime(6000);
      });
      // Placement is owned by the plane anchor — the camera-forward-ray fallback
      // must never fire (it would create a second, drifting free node).
      expect(props.sceneNavigator.viroAppProps.onPlace).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports the surface lock via onAnchorFound when the plane attaches', () => {
    const onAnchorFound = jest.fn();
    render(<ARModelScene {...makeProps({ anchorMode: true, onAnchorFound })} />);
    act(() => planeProps.onAnchorFound({}));
    expect(onAnchorFound).toHaveBeenCalled();
  });

  it('auto-places the model in front of the camera once ready (no tap)', async () => {
    jest.useFakeTimers();
    try {
      const props = makeProps({ placed: false, autoPlace: true });
      render(<ARModelScene {...props} />);
      // The auto-place loop warms up then (with no camera available in the test)
      // falls back to a fixed position straight ahead.
      await act(async () => {
        jest.advanceTimersByTime(6000);
      });
      expect(props.sceneNavigator.viroAppProps.onPlace).toHaveBeenCalledWith([0, -0.2, -1.5]);
    } finally {
      jest.useRealTimers();
    }
  });
});
