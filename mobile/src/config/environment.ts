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
const DEFAULT_PROD_API = 'https://pcsapi.fabrixr.com/api';

const isDev = __DEV__;

const apiUrl =
  process.env.EXPO_PUBLIC_API_URL ??
  (isDev ? 'http://localhost:3000/api' : DEFAULT_PROD_API);

/**
 * Web portal base URL — used to open web pages (e.g. the full-screen QC report
 * fill page /qr/:id) from the app, carrying the auth token.
 *
 * Prefer EXPO_PUBLIC_WEB_URL (set by the EAS `dev` profile). Otherwise DERIVE it
 * from the API URL — but the portal and the API are SEPARATE hosts, so we can't
 * just swap a port. We strip the `/api` suffix and map known API hosts to their
 * portal counterparts.
 *
 * The old fallback was `apiUrl.replace(':3000/api', ':4200')`, which only worked
 * for the localhost default: for ANY hosted apiUrl (e.g. when running `expo
 * start` with EXPO_PUBLIC_API_URL pointed at the deployed backend) the replace
 * was a no-op, so webUrl silently became the API host and opening /qr/:id hit
 * the backend → "Cannot GET /api/qr/:id" 404.
 */
function deriveWebUrl(api: string): string {
  const origin = api.replace(/\/api\/?$/, '');
  // Local dev: the API runs on :3000, the Angular portal on :4200 (covers
  // localhost, the Android emulator host and a LAN IP for a physical device).
  if (/localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\./.test(origin)) {
    return origin.replace(/:3000$/, ':4200');
  }
  // Hosted: the portal is a SIBLING host of the API, not a sub-path of it.
  return origin
    .replace('://backend-', '://frontend-') // Vercel preview deploys
    .replace('://pcsapi.', '://pcs.'); // custom domains
}

const webUrl = process.env.EXPO_PUBLIC_WEB_URL ?? deriveWebUrl(apiUrl);

export const environment = { apiUrl, webUrl };
