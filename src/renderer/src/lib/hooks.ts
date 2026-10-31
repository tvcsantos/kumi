import { useQuery } from '@tanstack/react-query';
import type { InstalledEntry } from '@shared/types';
import { api } from './api';

export function useInstalled() {
  return useQuery({ queryKey: ['installed'], queryFn: api.installedList, staleTime: 5_000 });
}

/** Entries Kumi installed from a given registry server. */
export function useInstalledByServer(registryName: string): InstalledEntry[] {
  const { data } = useInstalled();
  return data?.entries.filter((e) => e.record?.source?.registryName === registryName) ?? [];
}
