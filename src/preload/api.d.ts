import type { KumiApi } from '../shared/api';

declare global {
  interface Window {
    kumi: KumiApi;
  }
}

export {};
