const ENV = {
  development: {
    apiUrl: 'https://pcsapi.spadebloom.com/api',
    arViewerUrl: 'https://akash-mule-dev.github.io/pcs-platform/ar-viewer.html',
  },
  production: {
    apiUrl: 'https://pcsapi.spadebloom.com/api',
    arViewerUrl: 'https://akash-mule-dev.github.io/pcs-platform/ar-viewer.html',
  },
};

const isDev = __DEV__;
export const environment = isDev ? ENV.development : ENV.production;
