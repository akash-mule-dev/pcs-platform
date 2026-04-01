const ENV = {
  development: {
    apiUrl: 'http://13.234.202.29:3001/api',
  },
  production: {
    apiUrl: 'http://13.234.202.29:3001/api',
  },
};

const isDev = __DEV__;
export const environment = isDev ? ENV.development : ENV.production;
