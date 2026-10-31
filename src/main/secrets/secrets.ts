/** Encrypts small strings at rest. Backed by Electron safeStorage (OS keychain) in the app. */
export interface SecretBox {
  available(): boolean;
  encrypt(plain: string): string;
  decrypt(cipher: string): string;
}

/** Uses Electron's safeStorage; imported lazily so tests can run without Electron. */
export async function createSafeStorageBox(): Promise<SecretBox> {
  const { safeStorage } = await import('electron');
  return {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
    decrypt: (cipher) => safeStorage.decryptString(Buffer.from(cipher, 'base64')),
  };
}
