const xrMode = process.env.XR_MODE || "AR";

module.exports = {
  expo: {
    name: "PCS",
    slug: "pcs-mobile",
    version: "1.0.0",
    orientation: xrMode === "VR" ? "landscape" : "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "automatic",
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#1565c0",
    },
    assetBundlePatterns: ["**/*"],
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.primeterminal.pcs",
      infoPlist: {
        NSCameraUsageDescription: "PCS needs camera access for AR features",
        NSPhotoLibraryUsageDescription:
          "Allow $(PRODUCT_NAME) to access your photos",
        NSPhotoLibraryAddUsageDescription:
          "Allow $(PRODUCT_NAME) to save photos",
        NSMicrophoneUsageDescription:
          "Allow $(PRODUCT_NAME) to use your microphone",
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#1565c0",
      },
      package: "com.primeterminal.pcs",
      permissions: [
        "INTERNET",
        "CAMERA",
        "android.permission.CAMERA",
        "android.permission.RECORD_AUDIO",
      ],
    },
    plugins: [
      // Repairs the MainApplication.kt that @reactvision/react-viro corrupts on
      // Expo SDK 52 / RN 0.76 (it prepends its package registration above the
      // `package` declaration). See plugins/withViroMainApplicationFix.js.
      // MUST be declared FIRST: Expo runs dangerous mods in REVERSE registration
      // order (withMod.js — the last-registered action runs first), so declaring
      // this before the Viro plugin makes it run AFTER Viro's mod, letting it fix
      // the damage last.
      [
        "./plugins/withViroMainApplicationFix",
        { platforms: xrMode === "VR" ? ["GVR"] : ["AR"] },
      ],
      [
        "@reactvision/react-viro",
        {
          android: {
            xrMode: xrMode,
          },
        },
      ],
      [
        "expo-camera",
        {
          cameraPermission: "PCS needs camera access for AR features",
        },
      ],
      [
        "expo-build-properties",
        {
          android: {
            usesCleartextTraffic: true,
          },
        },
      ],
    ],
    extra: {
      xrMode: xrMode,
      eas: {
        projectId: "6e85765c-56d8-4641-8970-c43ef8812509",
      },
    },
    owner: "akashmule",
  },
};
