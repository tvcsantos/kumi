/** Encrypts small strings at rest. Backed by Electron safeStorage (OS keychain) in the app. */
export interface SecretBox {
  available(): Promise<boolean>;
  encrypt(plain: string): Promise<string>;
  decrypt(cipher: string): Promise<string>;
}

/** Uses Electron's async safeStorage; imported lazily so tests can run without Electron. Call after the app is ready. */
export async function createSafeStorageBox(): Promise<SecretBox> {
  const { safeStorage } = await import('electron');
  return {
    available: () => safeStorage.isAsyncEncryptionAvailable(),
    encrypt: async (plain) => (await safeStorage.encryptStringAsync(plain)).toString('base64'),
    decrypt: async (cipher) => (await safeStorage.decryptStringAsync(Buffer.from(cipher, 'base64'))).result,
  };
}
