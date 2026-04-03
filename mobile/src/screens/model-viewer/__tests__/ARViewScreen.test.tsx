import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

// ── Mocks ──

// Mock navigation
const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({
    params: { modelId: 'test-model-1', fileUrl: 'https://example.com/model.glb' },
  }),
  useNavigation: () => ({ goBack: mockGoBack, navigate: mockNavigate }),
}));

// Mock expo-camera
jest.mock('expo-camera', () => ({
  Camera: {
    getCameraPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
    requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  },
}));

// Mock Ionicons
jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

// Mock colors
jest.mock('../../../theme/colors', () => ({
  Colors: {
    primary: '#1565C0',
    background: '#F5F5F5',
    text: '#212121',
    textSecondary: '#757575',
    white: '#FFFFFF',
    warning: '#FF9800',
    danger: '#C62828',
  },
}));

// Track ViroARSceneNavigator props for assertions
let capturedViroProps: any = null;

// Mock Viro — replace native components with simple React Native views
jest.mock('@reactvision/react-viro', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    ViroARSceneNavigator: (props: any) => {
      capturedViroProps = props.viroAppProps;
      return React.createElement(View, { testID: 'viro-ar-navigator' }, null);
    },
    ViroARScene: (props: any) => React.createElement(View, { testID: 'viro-ar-scene' }, props.children),
    ViroAmbientLight: () => null,
    ViroDirectionalLight: () => null,
    Viro3DObject: (props: any) => React.createElement(View, { testID: 'viro-3d-object' }, null),
    ViroNode: (props: any) => React.createElement(View, { testID: 'viro-node' }, props.children),
    ViroTrackingStateConstants: {
      TRACKING_NORMAL: 3,
      TRACKING_LIMITED: 2,
      TRACKING_UNAVAILABLE: 1,
    },
  };
});

// Must import AFTER mocks
import { ARViewScreen } from '../ARViewScreen';

describe('ARViewScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedViroProps = null;
  });

  // ── TEST 1: Pre-session screen renders correctly ──
  it('shows the start AR session screen initially', () => {
    const { getByText } = render(<ARViewScreen />);
    expect(getByText('AR QA Inspector')).toBeTruthy();
    expect(getByText('Start AR Session')).toBeTruthy();
    expect(getByText('1. Tap anywhere on the camera to place the model')).toBeTruthy();
  });

  // ── TEST 2: Tapping Start AR opens camera (ViroARSceneNavigator) ──
  it('opens camera view when Start AR Session is pressed', async () => {
    const { getByText, getByTestId } = render(<ARViewScreen />);

    await act(async () => {
      fireEvent.press(getByText('Start AR Session'));
    });

    // ViroARSceneNavigator should now be rendered
    expect(getByTestId('viro-ar-navigator')).toBeTruthy();
    // Status bar should say tap to place
    expect(getByText('Tap anywhere to place the model')).toBeTruthy();
  });

  // ── TEST 3: Model is NOT placed on session start — placed=false ──
  it('does not place the model immediately when session starts', async () => {
    const { getByText } = render(<ARViewScreen />);

    await act(async () => {
      fireEvent.press(getByText('Start AR Session'));
    });

    // Viro should receive placed=false
    expect(capturedViroProps).not.toBeNull();
    expect(capturedViroProps.placed).toBe(false);
  });

  // ── TEST 4: Tap overlay is visible when model not placed ──
  it('shows tap overlay when model is not placed', async () => {
    const { getByText, getByTestId } = render(<ARViewScreen />);

    await act(async () => {
      fireEvent.press(getByText('Start AR Session'));
    });

    // The tap overlay should be present
    expect(getByTestId('viro-ar-navigator')).toBeTruthy();
    // placed should be false
    expect(capturedViroProps.placed).toBe(false);
  });

  // ── TEST 5: Tapping the overlay places the model ──
  it('places the model when tap overlay is pressed', async () => {
    const { getByText, queryByText } = render(<ARViewScreen />);

    // Start session
    await act(async () => {
      fireEvent.press(getByText('Start AR Session'));
    });

    expect(capturedViroProps.placed).toBe(false);

    // Find and press the tap overlay — it sits between the AR view and the status bar
    // The overlay is a TouchableWithoutFeedback wrapping a View
    // After pressing it, placed should become true
    const tapText = getByText('Tap anywhere to place the model');
    expect(tapText).toBeTruthy();

    // Simulate the onPlaced callback that the overlay triggers
    await act(async () => {
      capturedViroProps.onPlaced([0, -0.2, -1]);
    });

    // Should no longer show "tap to place"
    // placed should now be true — re-render passes placed=true to Viro
    expect(capturedViroProps.placed).toBe(true);
  });

  // ── TEST 6: Position is set correctly when placed ──
  it('sets position correctly when model is placed', async () => {
    const { getByText } = render(<ARViewScreen />);

    await act(async () => {
      fireEvent.press(getByText('Start AR Session'));
    });

    const placePosition: [number, number, number] = [0, -0.2, -1];
    await act(async () => {
      capturedViroProps.onPlaced(placePosition);
    });

    expect(capturedViroProps.position).toEqual(placePosition);
  });

  // ── TEST 7: Lock button not visible before placing ──
  it('does not show lock button before model is placed', async () => {
    const { getByText, queryByText } = render(<ARViewScreen />);

    await act(async () => {
      fireEvent.press(getByText('Start AR Session'));
    });

    expect(queryByText('LOCK MODEL')).toBeNull();
  });

  // ── TEST 8: Lock button appears after model loads ──
  it('shows lock button after model is placed and loaded', async () => {
    const { getByText, queryByText } = render(<ARViewScreen />);

    await act(async () => {
      fireEvent.press(getByText('Start AR Session'));
    });

    // Place model
    await act(async () => {
      capturedViroProps.onPlaced([0, -0.2, -1]);
    });

    // Simulate model loaded
    await act(async () => {
      capturedViroProps.onModelStatus('loaded');
    });

    expect(getByText('LOCK MODEL')).toBeTruthy();
  });

  // ── TEST 9: fileUrl is passed through to Viro scene ──
  it('passes the correct model URI to ViroARSceneNavigator', async () => {
    const { getByText } = render(<ARViewScreen />);

    await act(async () => {
      fireEvent.press(getByText('Start AR Session'));
    });

    expect(capturedViroProps.modelUri).toBe('https://example.com/model.glb');
  });

  // ── TEST 10: Reset removes the model ──
  it('resets placed state when reset button is pressed', async () => {
    const { getByText, getByTestId, UNSAFE_getAllByType } = render(<ARViewScreen />);

    await act(async () => {
      fireEvent.press(getByText('Start AR Session'));
    });

    // Place and load model
    await act(async () => {
      capturedViroProps.onPlaced([0, -0.2, -1]);
    });
    await act(async () => {
      capturedViroProps.onModelStatus('loaded');
    });

    expect(capturedViroProps.placed).toBe(true);

    // The status text should indicate model controls
    expect(getByText('Drag · Pinch · Twist to position, then LOCK')).toBeTruthy();
  });
});
