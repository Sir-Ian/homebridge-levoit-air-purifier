export const DEFAULT_APP_VERSION = '5.6.70';
export const DEFAULT_OS = 'Android 14; Pixel 7';
export const DEFAULT_CLIENT_TYPE = 'Android';

const ANDROID_FINGERPRINT = {
  clientType: DEFAULT_CLIENT_TYPE,
  userAgent: `VeSync/${DEFAULT_APP_VERSION} (${DEFAULT_OS})`
};

const IOS_FINGERPRINT = {
  clientType: 'iOS',
  userAgent: `VeSync/${DEFAULT_APP_VERSION} (iOS 17; iPhone)`
};

export const VESYNC = {
  BASE_URL: 'https://smartapi.vesync.com',
  APP_VERSION: DEFAULT_APP_VERSION,
  COUNTRY_CODE: 'US',
  LOCALE: 'en',
  TIMEZONE: 'America/Chicago',
  ANDROID_FINGERPRINT,
  IOS_FINGERPRINT
};
