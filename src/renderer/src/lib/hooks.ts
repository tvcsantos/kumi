import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import type { RegistryInfo } from '@shared/registry';
import type { InstalledEntry } from '@shared/types';
import { api } from './api';

export function useInstalled() {
  return useQuery({ queryKey: ['installed'], queryFn: api.installedList, staleTime: 5_000 });
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
