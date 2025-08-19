import axios from 'axios';
import crypto from 'crypto';
import { VESYNC } from '../vesync/constants';

async function main() {
  const email = process.env.VESYNC_EMAIL;
  const password = process.env.VESYNC_PASSWORD;

  if (!email || !password) {
    console.error('VESYNC_EMAIL and VESYNC_PASSWORD must be set');
    process.exit(1);
  }

  const pwdHashed = crypto.createHash('md5').update(password, 'utf8').digest('hex');

  try {
    const { data } = await axios.post(
      `${VESYNC.BASE_URL}/cloud/v1/user/login`,
      {
        account: email,
        password: pwdHashed,
        devToken: '',
        userType: 1,
        method: 'login',
        token: '',
        traceId: Date.now(),
        appVersion: VESYNC.APP_VERSION,
        clientType: VESYNC.CLIENT_TYPE,
        timeZone: VESYNC.TIMEZONE,
        countryCode: VESYNC.COUNTRY_CODE
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': VESYNC.LOCALE,
          'User-Agent': VESYNC.USER_AGENT
        }
      }
    );

    console.log('code:', data.code, 'token:', data.result?.token);
  } catch (error: any) {
    console.error('login failed', error?.response?.data ?? error.message);
  }
}

main();
