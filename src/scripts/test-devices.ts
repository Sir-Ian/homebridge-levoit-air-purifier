import axios from 'axios';
import crypto from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { VESYNC } from '../vesync/constants';

const api = axios.create({
  baseURL: VESYNC.BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    'Accept-Language': VESYNC.LOCALE,
    'User-Agent': VESYNC.ANDROID_FINGERPRINT.userAgent,
  },
  proxy: false,
});

function maskEmail(email: string) {
  return email.replace(/(.).+(@.*)/, '$1***$2');
}

function getOrCreateTerminalId() {
  const file = '/workspace/.vesync-terminal-id';
  if (existsSync(file)) {
    return readFileSync(file, 'utf8').trim();
  }
  const id = crypto.randomUUID();
  writeFileSync(file, id);
  return id;
}

function logError(prefix: string, error: any, email: string) {
  const status = error?.response?.status;
  const data = error?.response?.data;
  let msg = '';
  if (data) {
    if (typeof data === 'string') {
      msg = data.replace(new RegExp(email, 'gi'), maskEmail(email)).slice(0, 200);
    } else {
      msg = `code: ${data.code}, msg: ${data.msg}`;
    }
  }
  console.error(`${prefix} status: ${status ?? 'unknown'} ${msg}`);
}

async function login(email: string, password: string) {
  const md5Hex = crypto.createHash('md5').update(password, 'utf8').digest('hex');
  const terminalId = getOrCreateTerminalId();

  const attempt = async (clientType: string, userAgent: string) => {
    api.defaults.headers['User-Agent'] = userAgent;
    const bodyCommon = {
      method: 'login',
      password: md5Hex,
      appVersion: VESYNC.APP_VERSION,
      clientType,
      timeZone: VESYNC.TIMEZONE,
      countryCode: VESYNC.COUNTRY_CODE,
      traceId: Date.now(),
      terminalId,
    };
    try {
      return await api.post('/cloud/v1/user/login', { ...bodyCommon, account: email });
    } catch {
      return await api.post('/cloud/v1/user/login', { ...bodyCommon, email });
    }
  };

  try {
    const response = await attempt(
      VESYNC.ANDROID_FINGERPRINT.clientType,
      VESYNC.ANDROID_FINGERPRINT.userAgent
    );
    return response.data;
  } catch (error: any) {
    const status = error?.response?.status;
    const msg = error?.response?.data?.msg;
    if (status === 400 || status === 403 || msg === 'Forbidden') {
      const response = await attempt(
        VESYNC.IOS_FINGERPRINT.clientType,
        VESYNC.IOS_FINGERPRINT.userAgent
      );
      return response.data;
    }
    throw error;
  }
}

async function main() {
  const email = process.env.VESYNC_EMAIL;
  const password = process.env.VESYNC_PASSWORD;

  if (!email || !password) {
    console.error('VESYNC_EMAIL and VESYNC_PASSWORD must be set');
    process.exit(1);
  }

  try {
    const loginData = await login(email, password);
    if (loginData.code !== 0) {
      console.error(`Login failed code: ${loginData.code} msg: ${loginData.msg}`);
      process.exit(1);
    }
    api.defaults.headers.tk = loginData.result?.token;
    api.defaults.headers.accountid = loginData.result?.accountID;

    const { status, data } = await api.post('/cloud/v2/deviceManaged/devices', { method: 'devices' });
    if (status !== 200) {
      console.error(`Device request failed status: ${status}`);
      process.exit(1);
    }
    const region = data?.result?.deviceRegion;
    console.log('deviceRegion:', region);
    if (region && region !== 'US') {
      console.warn('Warning: non-US region');
    }
    const list = data?.result?.list;
    if (Array.isArray(list) && list.some((d: any) => d.deviceName === 'Core200S')) {
      console.log('Core200S found');
      process.exit(0);
    }
    console.error('Core200S not found');
    process.exit(1);
  } catch (error: any) {
    logError('Device test failed', error, email);
    process.exit(1);
  }
}

main();
