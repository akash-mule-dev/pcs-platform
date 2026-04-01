#!/bin/bash
# AR View Camera Test - Pure ADB automation
# Tests: Login → Models List → AR View → Camera Permission → AR Session

set -e
export PATH="$PATH:/c/Users/admin/AppData/Local/Android/Sdk/platform-tools"
SCREENSHOTS="$(dirname "$0")/screenshots"
mkdir -p "$SCREENSHOTS"

screenshot() {
  local name="$1"
  adb exec-out screencap -p > "$SCREENSHOTS/${name}.png"
  echo "  📸 Screenshot: $name"
}

tap() {
  adb shell input tap "$1" "$2"
  sleep 0.5
}

type_text() {
  # Use ADB input text (escape spaces)
  adb shell input text "$(echo "$1" | sed 's/ /%s/g')"
  sleep 0.3
}

echo "========================================="
echo "  PCS Mobile - AR View Camera Test"
echo "========================================="
echo ""

# --- Step 1: Verify device ---
echo "[1/9] Checking device..."
DEVICE=$(adb devices | grep -w "device" | head -1 | awk '{print $1}')
if [ -z "$DEVICE" ]; then
  echo "  ❌ FAIL: No device connected"
  exit 1
fi
echo "  ✅ Device: $DEVICE"

# --- Step 2: Ensure port forwarding ---
echo "[2/9] Setting up port forwarding..."
adb reverse tcp:8081 tcp:8081 > /dev/null 2>&1
echo "  ✅ Metro port forwarded"

# --- Step 3: Launch app fresh ---
echo "[3/9] Launching app..."
adb shell am force-stop com.primeterminal.pcs
sleep 1
adb shell am start -n com.primeterminal.pcs/.MainActivity > /dev/null 2>&1
echo "  Waiting for app to load..."
sleep 8
screenshot "01_app_launch"

# --- Step 4: Login ---
echo "[4/9] Logging in..."
# Tap email field (center of screen, roughly where email input is)
# Screen: 1080x2246. Email field at roughly y=780
tap 540 780
sleep 0.5
type_text "admin@pcs.local"

# Tap password field (roughly y=960)
tap 540 960
sleep 0.5
type_text "password123"

# Hide keyboard
adb shell input keyevent 111  # KEYCODE_ESCAPE
sleep 0.3

# Tap Sign In button (roughly y=1140)
tap 540 1140
echo "  Waiting for login..."
sleep 5
screenshot "02_after_login"

# --- Step 5: Navigate to 3D/AR tab ---
echo "[5/9] Navigating to 3D/AR tab..."
# Bottom tab bar: 5 tabs across 1080px. 3D/AR is 4th tab.
# Tab y position ~2190. 4th tab center: (3.5/5)*1080 = 756
tap 756 2190
sleep 3
screenshot "03_models_list"

# --- Step 6: Check if models loaded ---
echo "[6/9] Checking models list..."
# Use uiautomator to dump UI and check for content
UI_DUMP=$(adb shell uiautomator dump /dev/tty 2>/dev/null || true)
if echo "$UI_DUMP" | grep -qi "No models found"; then
  echo "  ❌ FAIL: No models found - API might be unreachable or returning empty"
  echo "  Checking API from device..."
  adb shell "curl -s -o /dev/null -w '%{http_code}' http://13.234.202.29:3001/api/health"
  echo ""
  screenshot "03_models_empty_FAIL"
  exit 1
fi
echo "  ✅ Models screen loaded"

# --- Step 7: Tap first model ---
echo "[7/9] Tapping first model..."
# Model cards start around y=350, first card center roughly y=450
tap 540 450
sleep 2
screenshot "04_action_sheet"

# --- Step 8: Tap AR View in action sheet ---
echo "[8/9] Selecting AR View..."
# Android AlertDialog buttons - AR View is typically the 2nd option
# Dump UI to find exact position
UI_DUMP2=$(adb shell uiautomator dump /dev/tty 2>/dev/null || true)

# Try to find and tap "AR View" button
if echo "$UI_DUMP2" | grep -q "AR View"; then
  # Extract bounds for AR View
  BOUNDS=$(echo "$UI_DUMP2" | grep -o 'text="AR View"[^/]*bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | head -1)
  if [ -n "$BOUNDS" ]; then
    # Parse bounds [left,top][right,bottom]
    LEFT=$(echo "$BOUNDS" | grep -o '\[[0-9]*,' | head -1 | tr -d '[,')
    TOP=$(echo "$BOUNDS" | grep -o ',[0-9]*\]' | head -1 | tr -d ',]')
    RIGHT=$(echo "$BOUNDS" | grep -o '\[[0-9]*,' | tail -1 | tr -d '[,')
    BOTTOM=$(echo "$BOUNDS" | grep -o ',[0-9]*\]' | tail -1 | tr -d ',]')
    CX=$(( (LEFT + RIGHT) / 2 ))
    CY=$(( (TOP + BOTTOM) / 2 ))
    echo "  Found AR View at ($CX, $CY)"
    tap $CX $CY
  else
    echo "  AR View found in text but couldn't parse bounds, trying center tap"
    tap 540 1200
  fi
else
  echo "  AR View not found in UI dump, trying positional tap"
  # Action sheet: "View 3D" first, "AR View" second, "Quality" third
  tap 540 1200
fi

sleep 3
screenshot "05_ar_screen"

# --- Step 9: Start AR Session ---
echo "[9/9] Starting AR session..."
UI_DUMP3=$(adb shell uiautomator dump /dev/tty 2>/dev/null || true)

if echo "$UI_DUMP3" | grep -qi "AR Not Available"; then
  echo "  ❌ FAIL: AR Not Available - Viro native module not in this build"
  screenshot "05_ar_not_available_FAIL"
  exit 1
fi

if echo "$UI_DUMP3" | grep -qi "Camera Permission Required"; then
  echo "  ⚠️ Camera permission was previously denied"
  screenshot "05_camera_denied"
  exit 1
fi

if echo "$UI_DUMP3" | grep -qi "Start AR Session"; then
  echo "  Tapping Start AR Session..."
  # Find and tap the button
  BOUNDS=$(echo "$UI_DUMP3" | grep -o 'text="Start AR Session"[^/]*bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | head -1)
  if [ -n "$BOUNDS" ]; then
    LEFT=$(echo "$BOUNDS" | grep -o '\[[0-9]*,' | head -1 | tr -d '[,')
    TOP=$(echo "$BOUNDS" | grep -o ',[0-9]*\]' | head -1 | tr -d ',]')
    RIGHT=$(echo "$BOUNDS" | grep -o '\[[0-9]*,' | tail -1 | tr -d '[,')
    BOTTOM=$(echo "$BOUNDS" | grep -o ',[0-9]*\]' | tail -1 | tr -d ',]')
    CX=$(( (LEFT + RIGHT) / 2 ))
    CY=$(( (TOP + BOTTOM) / 2 ))
    tap $CX $CY
  else
    # Fallback: Start AR button is usually in lower portion
    tap 540 1500
  fi
  sleep 3
  screenshot "06_permission_dialog"

  # Handle permission dialog
  UI_DUMP4=$(adb shell uiautomator dump /dev/tty 2>/dev/null || true)
  if echo "$UI_DUMP4" | grep -qi "While using the app"; then
    echo "  Granting camera permission..."
    BOUNDS=$(echo "$UI_DUMP4" | grep -o 'text="While using the app"[^/]*bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | head -1)
    if [ -n "$BOUNDS" ]; then
      LEFT=$(echo "$BOUNDS" | grep -o '\[[0-9]*,' | head -1 | tr -d '[,')
      TOP=$(echo "$BOUNDS" | grep -o ',[0-9]*\]' | head -1 | tr -d ',]')
      RIGHT=$(echo "$BOUNDS" | grep -o '\[[0-9]*,' | tail -1 | tr -d '[,')
      BOTTOM=$(echo "$BOUNDS" | grep -o ',[0-9]*\]' | tail -1 | tr -d ',]')
      CX=$(( (LEFT + RIGHT) / 2 ))
      CY=$(( (TOP + BOTTOM) / 2 ))
      tap $CX $CY
    else
      tap 540 1400
    fi
    sleep 5
  elif echo "$UI_DUMP4" | grep -qi "Allow"; then
    echo "  Granting camera permission (Allow)..."
    tap 540 1400
    sleep 5
  fi

  screenshot "07_ar_session_active"
  echo ""
  echo "========================================="
  echo "  ✅ AR session launched!"
  echo "  Check screenshot: 07_ar_session_active"
  echo "========================================="
else
  echo "  Unexpected screen state"
  screenshot "05_unexpected_state"
  exit 1
fi

echo ""
echo "All screenshots saved to: $SCREENSHOTS/"
echo "Done."
