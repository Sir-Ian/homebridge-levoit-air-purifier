import axios, { AxiosInstance } from 'axios';
import { Logger } from 'homebridge';
import AsyncLock from 'async-lock';
import crypto from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

import deviceTypes, { humidifierDeviceTypes } from './deviceTypes';
import VeSyncHumidifier from './VeSyncHumidifier';
import { VeSyncGeneric } from './VeSyncGeneric';
import DebugMode from '../debugMode';
import VeSyncFan from './VeSyncFan';
import { VESYNC } from '../vesync/constants';

export enum BypassMethod {
  STATUS = 'getPurifierStatus',
  MODE = 'setPurifierMode',
  NIGHT = 'setNightLight',
  DISPLAY = 'setDisplay',
  LOCK = 'setChildLock',
  SWITCH = 'setSwitch',
  SPEED = 'setLevel'
}

export enum HumidifierBypassMethod {
  HUMIDITY = 'setTargetHumidity',
  STATUS = 'getHumidifierStatus',
  MIST_LEVEL = 'setVirtualLevel',
  MODE = 'setHumidityMode',
  DISPLAY = 'setDisplay',
  SWITCH = 'setSwitch',
  LEVEL = 'setLevel',
}

const lock = new AsyncLock();

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default class VeSync {
  private api: AxiosInstance;
  private accountId?: string;
  private token?: string;
  private lastRequest = 0;
  private minuteStart = Date.now();
  private requestsThisMinute = 0;
  private readonly terminalId: string;
  private clientType: string = VESYNC.ANDROID_FINGERPRINT.clientType;

  constructor(
    private readonly email: string,
    private readonly password: string,
    public readonly debugMode: DebugMode,
    public readonly log: Logger
  ) {
    this.api = axios.create({
      baseURL: VESYNC.BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': VESYNC.LOCALE,
        'User-Agent': VESYNC.ANDROID_FINGERPRINT.userAgent
      }
    });
    this.terminalId = this.loadTerminalId();
  }

  private loadTerminalId() {
    const file = '/var/lib/homebridge/vesync-terminal-id';
    try {
      return readFileSync(file, 'utf8').trim();
    } catch {
      const id = crypto.randomUUID();
      try {
        mkdirSync('/var/lib/homebridge', { recursive: true });
        writeFileSync(file, id);
      } catch (error: any) {
        this.log.warn('Failed to persist terminalId', error?.message ?? error);
      }
      return id;
    }
  }

  private maskEmail(email: string) {
    return email.replace(/(.).+(@.*)/, '$1***$2');
  }

  private logAxiosError(prefix: string, error: any) {
    const status = error?.response?.status;
    const data = error?.response?.data;
    let msg = '';
    if (data) {
      if (typeof data === 'string') {
        msg = data.replace(new RegExp(this.email, 'gi'), this.maskEmail(this.email)).slice(0, 200);
      } else {
        msg = `code: ${data.code}, msg: ${data.msg}`;
      }
    }
    this.log.error(`${prefix} status: ${status ?? 'unknown'} ${msg}`);
  }

  private generateDetailBody() {
    return {
      appVersion: VESYNC.APP_VERSION,
      traceId: Date.now()
    };
  }

  private generateBody(includeAuth = false) {
    return {
      timeZone: VESYNC.TIMEZONE,
      countryCode: VESYNC.COUNTRY_CODE,
      clientType: this.clientType,
      ...(includeAuth
        ? {
          accountID: this.accountId,
          token: this.token
        }
        : {})
    };
  }

  private async rateLimit() {
    const now = Date.now();
    const diff = now - this.lastRequest;
    if (diff < 1000) {
      await delay(1000 - diff);
    }
    if (now - this.minuteStart >= 60_000) {
      this.requestsThisMinute = 0;
      this.minuteStart = now;
    }
    if (this.requestsThisMinute >= 60) {
      const wait = 60_000 - (now - this.minuteStart);
      await delay(wait);
      this.requestsThisMinute = 0;
      this.minuteStart = Date.now();
    }
    this.lastRequest = Date.now();
    this.requestsThisMinute++;
  }

  private async requestWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      await this.rateLimit();
      try {
        return await fn();
      } catch (error: any) {
        if (error?.response?.status === 429 && attempt < 4) {
          const backoff = Math.min(1000 * 2 ** attempt, 60_000);
          const jitter = Math.random() * 1000;
          await delay(backoff + jitter);
          continue;
        }
        throw error;
      }
    }
    throw new Error('Max retries reached');
  }

  private generateV2Body(fan: VeSyncGeneric, method: BypassMethod | HumidifierBypassMethod, data = {}) {
    return {
      method: 'bypassV2',
      debugMode: false,
      deviceRegion: fan.region,
      cid: fan.cid,
      configModule: fan.configModule,
      payload: {
        data: {
          ...data
        },
        method,
        source: 'APP'
      }
    };
  }

  public async sendCommand(
    fan: VeSyncGeneric,
    method: BypassMethod | HumidifierBypassMethod,
    body = {}
  ): Promise<boolean> {
      return lock.acquire('api-call', async () => {
        try {
          this.debugMode.debug(
            '[SEND COMMAND]',
            `Sending command ${method} to ${fan.name}`,
            `with (${JSON.stringify(body)})...`
          );

          const response = await this.requestWithRetry(() =>
            this.api.put('/cloud/v2/deviceManaged/bypassV2', {
              ...this.generateV2Body(fan, method, body),
              ...this.generateDetailBody(),
              ...this.generateBody(true)
            })
          );

        if (!response?.data) {
          this.debugMode.debug(
            '[SEND COMMAND]',
            'No response data!! JSON:',
            JSON.stringify(response)
          );
        }

          const { code, msg } = response.data ?? {};
          const isSuccess = code === 0;
          if (!isSuccess) {
            this.debugMode.debug(
              '[SEND COMMAND]',
              `Failed to send command ${method} to ${fan.name}`,
              `with (${JSON.stringify(body)})!`,
              `code: ${code}, msg: ${msg}`
            );
          }

        await delay(500);

        return isSuccess;
        } catch (error: any) {
          this.logAxiosError(`Failed to send command ${method} to ${fan?.name}`, error);
          return false;
        }
      });
    }

  public async getDeviceInfo(fan: VeSyncGeneric, humidifier = false): Promise<any> {
    return lock.acquire('api-call', async () => {
        try {
          this.debugMode.debug('[GET DEVICE INFO]', 'Getting device info...');

          const response = await this.requestWithRetry(() =>
            this.api.post(
              '/cloud/v2/deviceManaged/bypassV2',
              {
                ...this.generateV2Body(fan, humidifier ? HumidifierBypassMethod.STATUS : BypassMethod.STATUS),
                ...this.generateDetailBody(),
                ...this.generateBody(true)
              }
            )
          );

          if (!response?.data) {
          this.debugMode.debug(
            '[GET DEVICE INFO]',
            'No response data!! JSON:',
            JSON.stringify(response)
          );
          }

          const { code, msg } = response.data ?? {};
          if (code !== 0) {
            this.debugMode.debug('[GET DEVICE INFO]', `code: ${code}, msg: ${msg}`);
          }

          await delay(500);

          this.debugMode.debug(
            '[GET DEVICE INFO]',
            'JSON:',
            JSON.stringify(response.data)
          );

          return response.data;
        } catch (error: any) {
          this.logAxiosError(`Failed to get device info for ${fan?.name}`, error);

          return null;
        }
      });
    }

  public async startSession(): Promise<boolean> {
    this.debugMode.debug('[START SESSION]', 'Starting auth session...');
    const firstLoginSuccess = await this.login();
    if (!firstLoginSuccess) {
      this.log.error('[START SESSION] Initial login failed');
      return false;
    }
    setInterval(this.login.bind(this), 1000 * 60 * 55);
    return true;
  }
  private async login(): Promise<boolean> {
    return lock.acquire('api-call', async () => {
      try {
        if (!this.email || !this.password) {
          throw new Error('Email and password are required');
        }

        this.debugMode.debug('[LOGIN]', 'Logging in...');

        const md5Hex = crypto.createHash('md5').update(this.password, 'utf8').digest('hex');

        const attempt = async () => {
          const bodyCommon = {
            method: 'login',
            password: md5Hex,
            appVersion: VESYNC.APP_VERSION,
            clientType: this.clientType,
            timeZone: VESYNC.TIMEZONE,
            countryCode: VESYNC.COUNTRY_CODE,
            traceId: Date.now(),
            terminalId: this.terminalId
          };
          try {
            return await this.requestWithRetry(() =>
              this.api.post('/cloud/v1/user/login', { ...bodyCommon, account: this.email })
            );
          } catch {
            return await this.requestWithRetry(() =>
              this.api.post('/cloud/v1/user/login', { ...bodyCommon, email: this.email })
            );
          }
        };

        let response;
        try {
          response = await attempt();
        } catch (error: any) {
          const status = error?.response?.status;
          const msg = error?.response?.data?.msg;
          if (status === 400 || status === 403 || msg === 'Forbidden') {
            this.clientType = VESYNC.IOS_FINGERPRINT.clientType;
            this.api.defaults.headers['User-Agent'] = VESYNC.IOS_FINGERPRINT.userAgent;
            response = await attempt();
          } else {
            throw error;
          }
        }

        if (!response?.data) {
          this.debugMode.debug('[LOGIN]', 'No response data!! JSON:', JSON.stringify(response));
          return false;
        }

        const { code, msg, result } = response.data;
        if (code !== 0) {
          this.log.error(`[LOGIN] Failed with code ${code}, msg: ${msg}`);
          this.debugMode.debug('[LOGIN]', `Failed with code ${code}, msg: ${msg}`);
          return false;
        }

        const { token, accountID } = result ?? {};
        if (!token || !accountID) {
          this.log.error('[LOGIN] Missing token or accountID in response');
          this.debugMode.debug('[LOGIN]', 'The authentication failed!! JSON:', JSON.stringify(response.data));
          return false;
        }

        this.debugMode.debug('[LOGIN]', 'The authentication success');

        this.accountId = accountID;
        this.token = token;

        this.api.defaults.headers.tk = this.token!;
        this.api.defaults.headers.accountid = this.accountId!;

        await delay(500);
        return true;
      } catch (error: any) {
        this.logAxiosError('Failed to login', error);
        return false;
      }
    });
  }

  public async getDevices() {
    return lock.acquire<{
      purifiers: VeSyncFan[];
      humidifiers: VeSyncHumidifier[];
    }>('api-call', async () => {
      try {
        const response = await this.requestWithRetry(() =>
          this.api.post('/cloud/v2/deviceManaged/devices', {
            method: 'devices',
            pageNo: 1,
            pageSize: 1000,
            ...this.generateDetailBody(),
            ...this.generateBody(true)
          })
        );

        if (!response?.data) {
          this.debugMode.debug(
            '[GET DEVICES]',
            'No response data!! JSON:',
            JSON.stringify(response)
          );

          return {
            purifiers: [],
            humidifiers: []
          };
        }

        const { code, msg, result } = response.data ?? {};
        if (code !== 0) {
          this.debugMode.debug('[GET DEVICES]', `code: ${code}, msg: ${msg}`);
          return {
            purifiers: [],
            humidifiers: []
          };
        }

        const region = result?.deviceRegion;
        if (region) {
          this.log.info(`deviceRegion: ${region}`);
          if (region !== 'US') {
            this.log.warn('Non-US region detected');
          }
        }

        if (!Array.isArray(result?.list)) {
          this.debugMode.debug(
            '[GET DEVICES]',
            'No list found!! JSON:',
            JSON.stringify(response.data)
          );

          return {
            purifiers: [],
            humidifiers: []
          };
        }

        const { list } = result ?? { list: [] };

        this.debugMode.debug(
          '[GET DEVICES]',
          'Device List -> JSON:',
          JSON.stringify(list)
        );


        let purifiers = list
          .filter(
            ({ deviceType, type, extension }) =>
              !!deviceTypes.find(({ isValid }) => isValid(deviceType)) &&
              type === 'wifi-air' &&
              !!extension?.fanSpeedLevel
          )
          .map(VeSyncFan.fromResponse(this));

          // Newer Vital purifiers
          purifiers = purifiers.concat(list
          .filter(
            ({ deviceType, type, deviceProp }) =>
              !!deviceTypes.find(({ isValid }) => isValid(deviceType)) &&
              type === 'wifi-air' &&
              !!deviceProp
          )
          .map((fan: any) => ({ ...fan, extension: { ...fan.deviceProp, airQualityLevel: fan.deviceProp.AQLevel, mode: fan.deviceProp.workMode } }))
          .map(VeSyncFan.fromResponse(this)));

        const humidifiers = list
          .filter(
            ({ deviceType, type, extension }) =>
              !!humidifierDeviceTypes.find(({ isValid }) => isValid(deviceType)) &&
              type === 'wifi-air' &&
              !extension
          )
          .map(VeSyncHumidifier.fromResponse(this));

        await delay(1500);

        return {
          purifiers,
          humidifiers
        };
      } catch (error: any) {
        this.logAxiosError('Failed to get devices', error);
        return {
          purifiers: [],
          humidifiers: []
        };
      }
    });
  }
}
