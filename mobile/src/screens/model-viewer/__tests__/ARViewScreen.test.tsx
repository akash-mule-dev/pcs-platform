import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// ── Mocks ──

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({
    params: { modelId: 'test-model-1', fileUrl: 'https://example.com/model.glb' },
  }),
  useNavigation: () => ({ goBack: mockGoBack, navigate: mockNavigate }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

// Native Viro present → the screen treats AR as available.
jest.mock('@reactvision/react-viro', () => ({
  ViroARSceneNavigator: () => null,
}));

// Controllable model-preparation state.
let mockModelState: any;
jest.mock('../ar/useRemoteModel', () => ({
  useRemoteModel: () => mockModelState,
}));

// Stub the heavy AR experience so the test never loads Viro/GLB code.
let experienceProps: any = null;
jest.mock('../ar/ARExperience', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: any) => {
      experienceProps = props;
      return React.createElement(View, { testID: 'ar-experience' }, null);
    },
  };
});

// Must import AFTER mocks
import { ARViewScreen } from '../ARViewScreen';

const READY = {
  model: {
    uri: 'file:///cache/test-model-1.glb',
    fileName: 'model.glb',
    wireframeUri: 'file:///cache/test-model-1_wireframe.glb',
    dimensions: null,
  },
  loading: false,
  error: null,
  progress: null,
};

describe('ARViewScreen (host for ported AR experience)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    experienceProps = null;
    mockModelState = READY;
  });

  it('shows the AR QA Inspector intro once the model is ready', () => {
    const { getByText } = render(<ARViewScreen />);
    expect(getByText('AR QA Inspector')).toBeTruthy();
    expect(getByText('Start AR Session')).toBeTruthy();
  });

  it('shows a preparing state while the model downloads', () => {
    mockModelState = { model: null, loading: true, error: null, progress: 'Downloading model…' };
    const { getByText } = render(<ARViewScreen />);
    expect(getByText('Preparing model…')).toBeTruthy();
    expect(getByText('Downloading model…')).toBeTruthy();
  });

  it('shows an error state when preparation fails', () => {
    mockModelState = { model: null, loading: false, error: 'Download failed (HTTP 404)', progress: null };
    const { getByText } = render(<ARViewScreen />);
    expect(getByText('Couldn’t load the model')).toBeTruthy();
    expect(getByText('Download failed (HTTP 404)')).toBeTruthy();
  });

  it('opens the tracking-mode picker when Start AR Session is pressed', () => {
    const { getByText } = render(<ARViewScreen />);
    fireEvent.press(getByText('Start AR Session'));
    expect(getByText('Choose Tracking Mode')).toBeTruthy();
  });

  it('launches the AR experience with the prepared model after choosing a mode', () => {
    const { getByText, getByTestId } = render(<ARViewScreen />);
    fireEvent.press(getByText('Start AR Session'));
    fireEvent.press(getByText('World Position'));

    expect(getByTestId('ar-experience')).toBeTruthy();
    expect(experienceProps.modelUri).toBe('file:///cache/test-model-1.glb');
    expect(experienceProps.wireframeUri).toBe('file:///cache/test-model-1_wireframe.glb');
    expect(experienceProps.trackingMode).toBe('world');
  });

  it('links into Quality Inspection for the same model', () => {
    const { getByText } = render(<ARViewScreen />);
    fireEvent.press(getByText('View Quality Inspection'));
    expect(mockNavigate).toHaveBeenCalledWith(
      'QualityView',
      expect.objectContaining({ modelId: 'test-model-1', fileUrl: 'https://example.com/model.glb' }),
    );
  });
});
