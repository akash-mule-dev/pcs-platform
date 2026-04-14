const ENV = {
  development: {
    apiUrl: 'https://pcsapi.spadebloom.com/api',
  },
  production: {
    apiUrl: 'https://pcsapi.spadebloom.com/api',
  },
};

const isDev = __DEV__;
export const environment = isDev ? ENV.development : ENV.production;
