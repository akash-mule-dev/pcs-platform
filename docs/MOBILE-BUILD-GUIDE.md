# PCS Mobile App — Build Guide

## App Info
- **App Name:** PCS
- **Bundle ID:** com.primeterminal.pcs
- **Platforms:** Android, iOS
- **Framework:** React Native + Expo (SDK 52)

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- [Expo CLI](https://docs.expo.dev/get-started/installation/) — `npm install -g expo-cli`
- [Expo Go](https://expo.dev/go) on your phone (for quick testing)
- **Android:** [Android Studio](https://developer.android.com/studio) with an emulator configured
- **iOS (Mac only):** [Xcode 15+](https://developer.apple.com/xcode/) from the Mac App Store

---

## Development Setup

```bash
cd mobile-rn
npm install
npm start
```

This starts the Expo dev server. From the terminal:
- Press **`a`** → open on Android emulator
- Press **`i`** → open on iOS simulator (Mac only)
- Scan the **QR code** with Expo Go on your phone

### Connecting to the Backend

Edit `src/config/environment.ts` to point to your backend:

```typescript
// For local development, use your machine's local IP (not localhost)
// e.g., http://192.168.1.100:3000/api
const DEV_API_URL = 'http://localhost:3000/api';
```

> **Tip:** When testing on a physical device, replace `localhost` with your machine's IP address. Your phone and machine must be on the same network.

---

## Android Build

### Debug APK (for testing)

```bash
cd mobile-rn

# 1. Generate the native Android project
npx expo prebuild --platform android

# 2. Build debug APK
cd android
./gradlew assembleDebug

# APK location:
# android/app/build/outputs/apk/debug/app-debug.apk
```

### Production Build with EAS (Recommended)

[EAS Build](https://docs.expo.dev/build/introduction/) is Expo's cloud build service:

```bash
# Install EAS CLI (one-time)
npm install -g eas-cli

# Log in to your Expo account
eas login

# Configure the project (one-time)
eas build:configure

# Build for Android
eas build --platform android --profile production
```

### Local Production Build

```bash
cd mobile-rn

# Build APK locally
eas build --platform android --profile production --local

# Or build AAB (Android App Bundle) for Play Store
eas build --platform android --profile production --local
```

---

## iOS Build (Mac Only)

### Prerequisites
1. **Mac** with macOS 13+ (Ventura or later)
2. **Xcode 15+** (free from Mac App Store)
3. **Apple Developer Account** ($99/year) — https://developer.apple.com
4. **CocoaPods** — `sudo gem install cocoapods`

### Debug Build (simulator or device)

```bash
cd mobile-rn

# Generate the native iOS project
npx expo prebuild --platform ios

# Open in Xcode
npx expo run:ios
```

### In Xcode:
1. **Select your team** — Click on the project → "Signing & Capabilities" → Select your Apple Developer team
2. **Set Bundle Identifier** — Should be `com.primeterminal.pcs`
3. **Select a device** — Choose your iPhone or a simulator
4. **Build** — Press `Cmd + B` or click the play button
5. **Archive for distribution** — Product → Archive → Distribute App

### Production Build with EAS

```bash
# Build for iOS
eas build --platform ios --profile production

# Submit to App Store
eas submit --platform ios
```

### Testing on iPhone (without App Store)
1. Connect iPhone via USB
2. Run `npx expo run:ios --device`
3. First time: Go to iPhone Settings → General → VPN & Device Management → Trust your developer certificate

### Common Issues

**"No signing certificate"**
→ In Xcode: Settings → Accounts → Add your Apple ID → Download certificates

**"Untrusted Developer"**
→ On iPhone: Settings → General → VPN & Device Management → Trust

---

## Changing API URL

Edit the environment config before building:

```typescript
// src/config/environment.ts
const PROD_API_URL = 'https://api.spadebloom.com/api';  // ← Change this
```

Then rebuild with the appropriate command above.

---

## Project Structure

```
mobile-rn/
├── src/                        # Application source code
│   ├── components/             # Shared UI components
│   ├── config/                 # Environment configuration
│   ├── context/                # React context providers (Auth)
│   ├── navigation/             # React Navigation setup
│   ├── screens/                # App screens
│   │   ├── auth/               # Login screen
│   │   ├── dashboard/          # Operator dashboard
│   │   ├── model-viewer/       # 3D/AR model viewer
│   │   ├── profile/            # Operator profile
│   │   ├── time-tracking/      # Clock in/out
│   │   └── work-orders/        # Work order views
│   ├── services/               # API, auth, caching, offline
│   ├── theme/                  # Colors and styling
│   ├── types/                  # TypeScript type definitions
│   └── utils/                  # Utility functions
├── assets/                     # Icons, splash screen images
├── android/                    # Native Android project (after prebuild)
├── ios/                        # Native iOS project (after prebuild)
├── app.json                    # Expo configuration
├── babel.config.js             # Babel config
├── tsconfig.json               # TypeScript config
└── package.json                # Dependencies and scripts
```

---

## App Store Submission Checklist

### Google Play Store
- [ ] Production build (AAB via EAS or local)
- [ ] App screenshots (phone + tablet)
- [ ] App icon (512x512)
- [ ] Feature graphic (1024x500)
- [ ] Privacy policy URL
- [ ] Content rating questionnaire
- [ ] Google Play Developer account ($25 one-time)

### Apple App Store
- [ ] Archive built via EAS or Xcode
- [ ] App screenshots (6.7", 6.5", 5.5" iPhones + iPad)
- [ ] App icon (1024x1024, no alpha)
- [ ] Privacy policy URL
- [ ] App Review information
- [ ] Apple Developer account ($99/year)

---

## Useful Commands

| Command | Description |
|---------|-------------|
| `npm start` | Start Expo dev server |
| `npm run android` | Run on Android emulator |
| `npm run ios` | Run on iOS simulator |
| `npx expo prebuild` | Generate native projects |
| `npx expo prebuild --clean` | Regenerate native projects from scratch |
| `eas build --platform android` | Cloud build for Android |
| `eas build --platform ios` | Cloud build for iOS |
| `eas submit` | Submit to app stores |
