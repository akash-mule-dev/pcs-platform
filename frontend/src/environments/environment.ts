// Derive the API host from however the browser reached the portal, so it works
// both on the dev machine (localhost) AND from another device on the LAN — e.g. a
// phone opening the /qr/:id QC-report page handed off by the mobile app. The dev
// backend listens on the same host at port 3000. Falls back to localhost when
// there's no `window` (build/SSR).
const apiHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

export const environment = {
  production: false,
  apiUrl: `http://${apiHost}:3000/api`
};
