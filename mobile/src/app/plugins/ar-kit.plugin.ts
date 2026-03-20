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

export interface ArKitPlugin {
  /**
   * Check if ARKit is supported on this device.
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
 * PcsArKit Capacitor Plugin
 *
 * iOS implementation uses ARKit + RealityKit for:
 * - Surface detection (ARPlaneAnchor)
 * - Image tracking (ARImageTrackingConfiguration / ARReferenceImage)
 * - USDZ/glTF model rendering via RealityKit
 * - Light estimation (ARLightEstimate)
 *
 * Native iOS code should be placed in:
 *   ios/App/App/Plugins/ArKitPlugin.swift
 *
 * Required iOS frameworks:
 *   ARKit, RealityKit, SceneKit
 * Minimum deployment target: iOS 14.0
 */
export const PcsArKit = registerPlugin<ArKitPlugin>('PcsArKit');
