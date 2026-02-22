# PCS Mobile App — Build Guide

## App Info
- **App Name:** PCS
- **Bundle ID:** com.primeterminal.pcs
- **Platforms:** Android, iOS
- **Framework:** Ionic 8 + Angular + Capacitor 8

---

## Android (APK) — Already Built ✅

The debug APK is at:
```
android/app/build/outputs/apk/debug/app-debug.apk
```

### Rebuild Android
```bash
cd /home/vboxuser/pcs-platform/mobile

# 1. Build Angular app
npx ng build --configuration=production

# 2. Sync to Android
npx cap sync android

# 3. Build APK
cd android
./gradlew assembleDebug

# APK location:
# android/app/build/outputs/apk/debug/app-debug.apk
```

### Build Release APK (for Play Store)
```bash
cd android

# Generate signing key (one-time)
keytool -genkey -v -keystore pcs-release.keystore -alias pcs -keyalg RSA -keysize 2048 -validity 10000

# Build release
./gradlew assembleRelease

# Sign the APK
jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 -keystore pcs-release.keystore app/build/outputs/apk/release/app-release-unsigned.apk pcs

# Align
zipalign -v 4 app/build/outputs/apk/release/app-release-unsigned.apk PCS-release.apk
```

---

## iOS (IPA) — Requires Mac + Xcode

### Prerequisites
1. **Mac** with macOS 13+ (Ventura or later)
2. **Xcode 15+** (free from Mac App Store)
3. **Apple Developer Account** ($99/year) — https://developer.apple.com
4. **CocoaPods** — `sudo gem install cocoapods`

### Step-by-Step Build

```bash
# 1. Clone the repo on your Mac
git clone https://github.com/akash-mule-dev/pcs-platform.git
cd pcs-platform/mobile

# 2. Install dependencies
npm install

# 3. Build Angular app for production
npx ng build --configuration=production

# 4. Sync to iOS
npx cap sync ios

# 5. Open in Xcode
npx cap open ios
```

### In Xcode:
1. **Select your team** — Click on "App" in the sidebar → "Signing & Capabilities" → Select your Apple Developer team
2. **Set Bundle Identifier** — Should be `com.primeterminal.pcs`
3. **Select a device** — Choose your iPhone or "Any iOS Device (arm64)"
4. **Build** — Press `Cmd + B` or click the ▶️ button
5. **Archive for distribution** — Product → Archive → Distribute App

### Testing on iPhone (without App Store)
1. Connect iPhone via USB
2. In Xcode, select your iPhone as build target
3. Click ▶️ to build and install
4. First time: Go to iPhone Settings → General → VPN & Device Management → Trust your developer certificate

### Common Issues

**"No signing certificate"**
→ In Xcode: Preferences → Accounts → Add your Apple ID → Download certificates

**"Untrusted Developer"**
→ On iPhone: Settings → General → VPN & Device Management → Trust

**"App Transport Security"**
→ Already configured in Info.plist to allow HTTP (cleartext) for our API server

---

## Changing API URL

Edit the environment file before building:

```typescript
// src/environments/environment.prod.ts
export const environment = {
  production: true,
  apiUrl: 'http://43.204.37.17:3000/api'  // ← Change this
};
```

Then rebuild:
```bash
npx ng build --configuration=production
npx cap sync           # Syncs to both android and ios
```

---

## Project Structure
```
mobile/
├── src/                    # Angular/Ionic source code
├── www/                    # Built web assets (ng build output)
├── android/                # Android native project
│   ├── app/src/main/
│   │   ├── AndroidManifest.xml
│   │   ├── res/            # Icons, splash, layouts
│   │   └── assets/public/  # Web assets (capacitor sync)
│   └── build/outputs/apk/  # Built APKs
├── ios/                    # iOS native project
│   ├── App/
│   │   ├── App/
│   │   │   ├── Info.plist
│   │   │   ├── Assets.xcassets/  # Icons, splash
│   │   │   └── public/          # Web assets
│   │   └── App.xcodeproj
│   └── Podfile
├── resources/              # Source icons (1024x1024)
│   ├── icon.png
│   └── splash.png
├── capacitor.config.ts     # Capacitor configuration
└── BUILD-GUIDE.md          # This file
```

---

## App Store Submission Checklist

### Google Play Store
- [ ] Signed release APK or AAB (Android App Bundle)
- [ ] App screenshots (phone + tablet)
- [ ] App icon (512x512)
- [ ] Feature graphic (1024x500)
- [ ] Privacy policy URL
- [ ] Content rating questionnaire
- [ ] Google Play Developer account ($25 one-time)

### Apple App Store
- [ ] Archive built from Xcode
- [ ] App screenshots (6.7", 6.5", 5.5" iPhones + iPad)
- [ ] App icon (1024x1024, no alpha)
- [ ] Privacy policy URL
- [ ] App Review information
- [ ] Apple Developer account ($99/year)
