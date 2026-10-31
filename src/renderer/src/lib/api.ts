import type { KumiApi } from '@shared/api';

export const api: KumiApi = window.kumi;

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
