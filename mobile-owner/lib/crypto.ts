// QR Vault — Cryptography Module
// Pure JS AES-GCM + PBKDF2 implementation using node-forge.
// No native modules needed, fully Expo Go compatible.
// Data format: salt(16) + iv(12) + ciphertext + tag(16) (base64 encoded)
// Fully compatible with the web version's encrypted messages.

const forge = require('node-forge');

const ALGO = 'AES-GCM';
const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

// -----------------------------------------------------------------------
// Key derivation (PBKDF2 via forge)
// -----------------------------------------------------------------------
async function deriveKey(passphrase: string, saltBytes: string): Promise<{ key: string }> {
  // Using Promise.resolve just to keep the interface async matching the original
  return new Promise((resolve) => {
    // forge.pkcs5.pbkdf2(password, salt, numIterations, keyLength (in bytes), hash algorithm)
    const key = forge.pkcs5.pbkdf2(
      passphrase,
      saltBytes,
      PBKDF2_ITERATIONS,
      32, // 256 bits = 32 bytes
      forge.md.sha256.create()
    );
    resolve({ key });
  });
}

// -----------------------------------------------------------------------
// Encrypt text (AES-GCM)
// -----------------------------------------------------------------------
export async function encryptText(plaintext: string, passphrase: string): Promise<string> {
  const saltBytes = forge.random.getBytesSync(SALT_LENGTH);
  const ivBytes = forge.random.getBytesSync(IV_LENGTH);

  const derived = await deriveKey(passphrase, saltBytes);

  const cipher = forge.cipher.createCipher('AES-GCM', derived.key);
  cipher.start({ iv: ivBytes });
  cipher.update(forge.util.createBuffer(forge.util.encodeUtf8(plaintext)));
  cipher.finish();

  const ciphertext = cipher.output.getBytes();
  const tag = cipher.mode.tag.getBytes();

  // Pack: salt(16) + iv(12) + ciphertext + tag(16)
  const packed = saltBytes + ivBytes + ciphertext + tag;
  return forge.util.encode64(packed);
}

// -----------------------------------------------------------------------
// Decrypt text (AES-GCM)
// -----------------------------------------------------------------------
export async function decryptText(packedBase64: string, passphrase: string): Promise<string> {
  const packed = forge.util.decode64(packedBase64);
  const saltBytes = packed.substring(0, SALT_LENGTH);
  const ivBytes = packed.substring(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertextAndTag = packed.substring(SALT_LENGTH + IV_LENGTH);

  // Web Crypto AES-GCM automatically appends a 16-byte auth tag at the end.
  const ciphertext = ciphertextAndTag.substring(0, ciphertextAndTag.length - 16);
  const tag = ciphertextAndTag.substring(ciphertextAndTag.length - 16);

  const derived = await deriveKey(passphrase, saltBytes);

  const decipher = forge.cipher.createDecipher('AES-GCM', derived.key);
  decipher.start({
    iv: ivBytes,
    tag: forge.util.createBuffer(tag),
  });
  decipher.update(forge.util.createBuffer(ciphertext));
  const pass = decipher.finish();

  if (!pass) {
    throw new Error('Decryption failed. Invalid passphrase or corrupted data.');
  }

  return forge.util.decodeUtf8(decipher.output.getBytes());
}

// -----------------------------------------------------------------------
// Utility: generate a random passphrase
// -----------------------------------------------------------------------
export async function generatePassphrase(length = 32): Promise<string> {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const randomBytes = forge.random.getBytesSync(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[randomBytes.charCodeAt(i) % chars.length];
  }
  return result;
}

export const CryptoLib = {
  encryptText,
  decryptText,
  generatePassphrase,
  isSupported: () => true,
};

