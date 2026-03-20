import { registerPlugin } from '@capacitor/core';

export interface ArSessionOptions {
  modelUrl: string;
  enableImageTracking: boolean;
  trackingImages: {
    name: string;
    imageUrl: string;
    physicalWidth: number; // in meters
  }[];
  enablePlaneDetection: boolean;
  enableLightEstimation: boolean;
}

export interface ArCorePlugin {
  /**
   * Check if ARCore is supported on this device.
   */
  checkSupport(): Promise<{ supported: boolean; reason?: string }>;

  /**
   * Start an AR session with the given options.
   * Displays a full-screen AR camera view with model rendering.
   */
  startSession(options: ArSessionOptions): Promise<void>;

  /**
   * Stop the current AR session.
   */
  stopSession(): Promise<void>;

  /**
   * Reset the current model placement.
   */
  resetPlacement(): Promise<void>;

  /**
   * Set the model scale.
   */
  setModelScale(options: { scale: number }): Promise<void>;

  /**
   * Set the model rotation (degrees around Y axis).
   */
  setModelRotation(options: { y: number }): Promise<void>;

  /**
   * Capture a screenshot of the current AR view.
   */
  captureScreenshot(): Promise<{ imagePath: string }>;

  /**
   * Add a listener for AR events.
   */
  addListener(
    eventName: 'onImageDetected' | 'onImageLost' | 'onModelPlaced' | 'onError',
    callback: (event: any) => void,
  ): Promise<{ remove: () => void }>;

  /**
   * Remove all listeners.
   */
  removeAllListeners(): Promise<void>;
}

/**
 * PcsArCore Capacitor Plugin
 *
 * Android implementation uses ARCore + Sceneform for:
 * - Surface detection and hit-testing
 * - Image tracking (AugmentedImageDatabase)
 * - glTF/GLB model rendering
 * - Light estimation for realistic rendering
 *
 * Native Android code should be placed in:
 *   android/app/src/main/java/com/pcs/plugins/ArCorePlugin.java
 *
 * Required Android dependencies:
 *   com.google.ar:core:1.42.0
 *   com.google.ar.sceneform:sceneform:1.17.1
 */
export const PcsArCore = registerPlugin<ArCorePlugin>('PcsArCore');
