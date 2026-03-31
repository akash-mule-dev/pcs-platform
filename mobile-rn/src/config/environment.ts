const ENV = {
  development: {
    apiUrl: 'http://localhost:3000/api',
  },
  production: {
    apiUrl: 'https://api.spadebloom.com/api',
  },
};

const isDev = __DEV__;
export const environment = isDev ? ENV.development : ENV.production;
