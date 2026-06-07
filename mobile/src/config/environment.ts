/**
 * Mobile environment config.
 *
 * The API base URL can be overridden at build/run time with EXPO_PUBLIC_API_URL,
 * e.g. point a device at your LOCAL backend during development:
 *   EXPO_PUBLIC_API_URL=http://192.168.1.50:3000/api npx expo start
 * (Android emulator: http://10.0.2.2:3000/api  ·  iOS simulator: http://localhost:3000/api)
 *
 * Without the override: dev builds default to localhost, production builds to the
 * hosted API. This is what lets the mobile app and the web portal share one backend.
 */
const DEFAULT_PROD_API = 'https://pcsapi.spadebloom.com/api';

const isDev = __DEV__;

const apiUrl =
  process.env.EXPO_PUBLIC_API_URL ??
  (isDev ? 'http://localhost:3000/api' : DEFAULT_PROD_API);

export const environment = { apiUrl };
