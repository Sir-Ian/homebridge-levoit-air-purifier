import axios from 'axios';
import crypto from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { VESYNC } from '../vesync/constants';

function getOrCreateTerminalId() {
  const p = '/workspace/.vesync-terminal-id';
  if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  const id = crypto.randomUUID();
  writeFileSync(p, id);
  return id;
}

async function main() {
  const email = process.env.VESYNC_EMAIL;
  const password = process.env.VESYNC_PASSWORD;

  if (!email || !password) {
    console.error('VESYNC_EMAIL and VESYNC_PASSWORD must be set');
    process.exit(1);
  }

  const pwdHashed = crypto.createHash('md5').update(password, 'utf8').digest('hex');
  const terminalId = getOrCreateTerminalId();

  try {
    const body = {
      method: 'login',
      account: email,
      password: pwdHashed,
      devToken: '',
      userType: 1,
      token: '',
      traceId: Date.now(),
      appVersion: VESYNC.APP_VERSION,
      clientType: VESYNC.CLIENT_TYPE,
      timeZone: VESYNC.TIMEZONE,
      countryCode: VESYNC.COUNTRY_CODE,
      terminalId
    };
    const headers = {
      'Content-Type': 'application/json',
      'Accept-Language': VESYNC.LOCALE,
      'User-Agent': VESYNC.USER_AGENT
    };

    console.log('LOGIN url:', `${VESYNC.BASE_URL}/cloud/v1/user/login`);
    console.log('LOGIN headers:', headers);
    console.log('LOGIN body:', { ...body, password: '<md5>' });

    const { data } = await axios.post('/cloud/v1/user/login', body, {
      baseURL: VESYNC.BASE_URL,
      headers
    });

    console.log('code:', data.code, 'token:', data.result?.token);
  } catch (error: any) {
    console.error('login failed');
    console.error('status:', error?.response?.status);
    console.error('data:', error?.response?.data);
  }
}

main();
