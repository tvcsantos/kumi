import { contextBridge, ipcRenderer } from 'electron';
import { API_METHODS, channel, type IpcResult, type KumiApi } from '@shared/api';

const api = Object.fromEntries(
  API_METHODS.map((method) => [
    method,
    async (...args: unknown[]) => {
      const result = (await ipcRenderer.invoke(channel(method), ...args)) as IpcResult<unknown>;
      if (!result.ok) throw new Error(result.error);
      return result.value;
    },
  ]),
) as unknown as KumiApi;

contextBridge.exposeInMainWorld('kumi', api);
