export const environment = {
  production: false,
  // Dev environment -> dev backend served by the `dev` git branch, backed by the dev Neon DB.
  // demo-api.fabrixr.com is a Vercel per-domain Git Branch domain pinned to `dev` (VERCEL_ENV=preview,
  // so it stays on the dev DB). Replaces the fragile backend-git-dev-*.vercel.app branch alias.
  apiUrl: 'https://demo-api.fabrixr.com/api'
};
