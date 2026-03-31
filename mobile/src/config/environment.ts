const ENV = {
  development: {
    apiUrl: 'http://192.168.1.108:3000/api',
  },
  production: {
    apiUrl: 'https://api.spadebloom.com/api',
  },
};

const isDev = __DEV__;
export const environment = isDev ? ENV.development : ENV.production;
