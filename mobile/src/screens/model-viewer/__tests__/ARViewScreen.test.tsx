import React from 'react';
import { render } from '@testing-library/react-native';

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

  it('opens the live AR experience directly once the model is ready (no launch screen)', () => {
    const { getByTestId } = render(<ARViewScreen />);
    expect(getByTestId('ar-experience')).toBeTruthy();
    expect(experienceProps.modelUri).toBe('file:///cache/test-model-1.glb');
    expect(experienceProps.wireframeUri).toBe('file:///cache/test-model-1_wireframe.glb');
  });

  it('opens in Plane mode by default; the three modes are switched inline in-AR', () => {
    render(<ARViewScreen />);
    expect(experienceProps.initialTrackingMode).toBe('plane');
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

  it('hands the AR experience a records action that opens Quality Inspection for the same model', () => {
    render(<ARViewScreen />);
    expect(typeof experienceProps.onViewRecords).toBe('function');
    experienceProps.onViewRecords();
    expect(mockNavigate).toHaveBeenCalledWith(
      'QualityView',
      expect.objectContaining({ modelId: 'test-model-1', fileUrl: 'https://example.com/model.glb' }),
    );
  });
});
