const APP_VERSION = '5.6.70';

const ANDROID_FINGERPRINT = {
  clientType: 'Android',
  userAgent: `VeSync/${APP_VERSION} (Android 14; Pixel 7)`
};

const IOS_FINGERPRINT = {
  clientType: 'iOS',
  userAgent: `VeSync/${APP_VERSION} (iOS 17; iPhone)`
};

export const VESYNC = {
  BASE_URL: 'https://smartapi.vesync.com',
  APP_VERSION,
  COUNTRY_CODE: 'US',
  LOCALE: 'en',
  TIMEZONE: 'America/Chicago',
  ANDROID_FINGERPRINT,
  IOS_FINGERPRINT
};
