import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import type { RegistryInfo } from '@shared/registry';
import type { InstalledEntry, RuntimeStatus } from '@shared/types';
import { api } from './api';

const RUNTIMES_KEY = ['runtimes'];

/** npx, uvx & co. and where they were found. */
export function useRuntimes() {
  return useQuery({ queryKey: RUNTIMES_KEY, queryFn: () => api.runtimesCheck() });
}

/** Checks the runtimes again, re-reading PATH first if one is missing, so a fresh install shows up. */
export function useRecheckRuntimes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.runtimesCheck({ refreshPath: true }),
    onSuccess: (runtimes: RuntimeStatus[]) => queryClient.setQueryData(RUNTIMES_KEY, runtimes),
  });
}

/**
 * While `enabled`, re-checks the runtimes each time the Kumi window regains focus: the user is likely coming back
 * from an installer. Window focus, not React Query's own focus handling, which only listens to `visibilitychange`
 * and so misses switching apps in Electron.
 */
export function useRecheckRuntimesOnFocus(enabled: boolean) {
  const { mutate } = useRecheckRuntimes();
  useEffect(() => {
    if (!enabled) return;
    const onFocus = () => mutate();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [enabled, mutate]);
}

export function useInstalled() {
  return useQuery({ queryKey: ['installed'], queryFn: api.installedList, staleTime: 5_000 });
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: api.settingsGet });
}

export function useRegistries() {
  return useQuery({ queryKey: ['registries'], queryFn: api.registriesList });
}

/** Looks up a registry's display info; undefined while loading or when it was removed. */
export function useRegistry(id: string): RegistryInfo | undefined {
  return useRegistries().data?.find((r) => r.id === id);
}

/** Entries Kumi installed from a given registry server. */
export function useInstalledByServer(registryId: string, registryName: string): InstalledEntry[] {
  const { data } = useInstalled();
  return data?.entries.filter((e) => e.record?.source?.registryName === registryName && e.record.source.registryId === registryId) ?? [];
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

/** Whether the app is showing its dark theme. Follows the Appearance setting and, on System, the OS. */
export function useDarkMode(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      darkQuery.addEventListener('change', onChange);
      return () => darkQuery.removeEventListener('change', onChange);
    },
    () => darkQuery.matches,
  );
}
