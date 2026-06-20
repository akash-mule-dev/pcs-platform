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

// Stub the heavy AR experience so the test never loads Viro/GLB code. It now
// owns model loading internally (camera-first), so the host just mounts it.
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

describe('ARViewScreen (camera-first host)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    experienceProps = null;
  });

  it('mounts the AR experience immediately (camera opens before the model loads)', () => {
    const { getByTestId } = render(<ARViewScreen />);
    expect(getByTestId('ar-experience')).toBeTruthy();
    // The host no longer downloads first — it hands the model source to the
    // experience, which streams it in over the live camera.
    expect(experienceProps.modelId).toBe('test-model-1');
    expect(experienceProps.fileUrl).toBe('https://example.com/model.glb');
  });

  it('opens in Plane mode by default; the three modes are switched inline in-AR', () => {
    render(<ARViewScreen />);
    expect(experienceProps.initialTrackingMode).toBe('plane');
  });

  it('passes no mesh isolation when none was requested', () => {
    render(<ARViewScreen />);
    expect(experienceProps.meshNames).toBeNull();
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
