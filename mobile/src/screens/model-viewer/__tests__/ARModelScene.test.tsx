import React from 'react';
import { render, act } from '@testing-library/react-native';

// ── Mocks ──

const TRACKING_NORMAL = 3;
const TRACKING_LIMITED = 2;

let lastTrackingCallback: ((state: number) => void) | null = null;

jest.mock('@reactvision/react-viro', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    ViroARScene: (props: any) => {
      // Capture the onTrackingUpdated callback so tests can invoke it
      lastTrackingCallback = props.onTrackingUpdated;
      return React.createElement(View, { testID: 'viro-ar-scene' }, props.children);
    },
    ViroAmbientLight: () => null,
    ViroDirectionalLight: () => null,
    Viro3DObject: (props: any) => React.createElement(View, { testID: 'viro-3d-object' }, null),
    ViroNode: (props: any) => React.createElement(View, { testID: 'viro-node' }, props.children),
    ViroTrackingStateConstants: {
      TRACKING_NORMAL,
      TRACKING_LIMITED,
      TRACKING_UNAVAILABLE: 1,
    },
  };
});

import ARModelScene from '../ARModelScene';

const baseProps = {
  sceneNavigator: {
    viroAppProps: {
      modelUri: 'https://example.com/model.glb',
      placed: false,
      position: [0, -0.2, -1] as [number, number, number],
      scale: [0.5, 0.5, 0.5] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      locked: false,
      onPlaced: jest.fn(),
      onDrag: jest.fn(),
      onPinch: jest.fn(),
      onRotate: jest.fn(),
      onModelStatus: jest.fn(),
      onTrackingUpdated: jest.fn(),
    },
  },
};

describe('ARModelScene', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lastTrackingCallback = null;
  });

  // ── TEST 1: No model rendered when placed=false ──
  it('does not render 3D object when placed is false', () => {
    const { queryByTestId } = render(<ARModelScene {...baseProps} />);
    expect(queryByTestId('viro-3d-object')).toBeNull();
    expect(queryByTestId('viro-node')).toBeNull();
  });

  // ── TEST 2: No model even with tracking ready but placed=false ──
  it('does not render 3D object when tracking is ready but placed is false', () => {
    const { queryByTestId } = render(<ARModelScene {...baseProps} />);

    // Simulate tracking becoming ready
    expect(lastTrackingCallback).not.toBeNull();
    act(() => { lastTrackingCallback!(TRACKING_NORMAL); });

    // Still no model — placed is false
    expect(queryByTestId('viro-3d-object')).toBeNull();
  });

  // ── TEST 3: No model when placed=true but tracking not ready yet ──
  it('does not render 3D object when placed but tracking not ready', () => {
    const props = {
      sceneNavigator: {
        viroAppProps: { ...baseProps.sceneNavigator.viroAppProps, placed: true },
      },
    };
    const { queryByTestId } = render(<ARModelScene {...props} />);

    // tracking hasn't fired yet, so trackingReady is false
    expect(queryByTestId('viro-3d-object')).toBeNull();
  });

  // ── TEST 4: Model renders when placed=true AND tracking ready ──
  it('renders 3D object when placed is true and tracking is ready', () => {
    const props = {
      sceneNavigator: {
        viroAppProps: { ...baseProps.sceneNavigator.viroAppProps, placed: true },
      },
    };
    const { queryByTestId, rerender } = render(<ARModelScene {...props} />);

    // Simulate tracking ready
    act(() => { lastTrackingCallback!(TRACKING_NORMAL); });

    // Re-render to pick up state change
    rerender(<ARModelScene {...props} />);

    expect(queryByTestId('viro-node')).toBeTruthy();
    expect(queryByTestId('viro-3d-object')).toBeTruthy();
  });

  // ── TEST 5: AR scene is always rendered (camera is open) ──
  it('always renders ViroARScene regardless of placed state', () => {
    const { getByTestId } = render(<ARModelScene {...baseProps} />);
    expect(getByTestId('viro-ar-scene')).toBeTruthy();
  });

  // ── TEST 6: Tracking callback notifies parent ──
  it('calls onTrackingUpdated when tracking state changes', () => {
    render(<ARModelScene {...baseProps} />);

    act(() => { lastTrackingCallback!(TRACKING_NORMAL); });
    expect(baseProps.sceneNavigator.viroAppProps.onTrackingUpdated).toHaveBeenCalledWith('normal');

    act(() => { lastTrackingCallback!(TRACKING_LIMITED); });
    expect(baseProps.sceneNavigator.viroAppProps.onTrackingUpdated).toHaveBeenCalledWith('limited');
  });
});
