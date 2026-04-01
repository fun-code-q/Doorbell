/* ============================================================
   QR Doorbell - Cryptography Module
   Uses Web Crypto API (AES-GCM + PBKDF2) — no external deps
   ============================================================ */
/* exported Crypto */

const Crypto = {
  /* --- Constants --- */
  ALGO: "AES-GCM",
  KEY_LENGTH: 256,
  PBKDF2_ITERATIONS: 100000,
  SALT_LENGTH: 16,
  IV_LENGTH: 12,

  /* --- Key Derivation (PBKDF2) --- */
  deriveKey: async function(passphrase, salt) {
    if (!salt) {
      salt = crypto.getRandomValues(new Uint8Array(this.SALT_LENGTH));
    }
    var enc = new TextEncoder();
    var keyMaterial = await crypto.subtle.importKey(
      "raw",
      enc.encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    var key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: this.PBKDF2_ITERATIONS,
        hash: "SHA-256"
      },
      keyMaterial,
      { name: this.ALGO, length: this.KEY_LENGTH },
      false,
      ["encrypt", "decrypt"]
    );
    return { key: key, salt: salt };
  },

  /* --- Encrypt text (AES-GCM) --- */
  encryptText: async function(plaintext, passphrase) {
    var iv = crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));
    var derived = await this.deriveKey(passphrase);
    var enc = new TextEncoder();
    var ciphertext = await crypto.subtle.encrypt(
      { name: this.ALGO, iv: iv },
      derived.key,
      enc.encode(plaintext)
    );
    /* Pack: salt(16) + iv(12) + ciphertext */
    var packed = new Uint8Array(derived.salt.length + iv.length + ciphertext.byteLength);
    packed.set(derived.salt, 0);
    packed.set(iv, derived.salt.length);
    packed.set(new Uint8Array(ciphertext), derived.salt.length + iv.length);
    return this.arrayBufferToBase64(packed.buffer);
  },

  /* --- Decrypt text (AES-GCM) --- */
  decryptText: async function(packedBase64, passphrase) {
    var packed = this.base64ToArrayBuffer(packedBase64);
    var salt = new Uint8Array(packed.slice(0, this.SALT_LENGTH));
    var iv = new Uint8Array(packed.slice(this.SALT_LENGTH, this.SALT_LENGTH + this.IV_LENGTH));
    var ciphertext = packed.slice(this.SALT_LENGTH + this.IV_LENGTH);
    var derived = await this.deriveKey(passphrase, salt);
    var decrypted = await crypto.subtle.decrypt(
      { name: this.ALGO, iv: iv },
      derived.key,
      ciphertext
    );
    return new TextDecoder().decode(decrypted);
  },

  /* --- Encrypt a blob (image) — returns { encryptedBlob, salt, iv } --- */
  encryptBlob: async function(blob, passphrase) {
    var iv = crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));
    var derived = await this.deriveKey(passphrase);
    var arrayBuf = await blob.arrayBuffer();
    var ciphertext = await crypto.subtle.encrypt(
      { name: this.ALGO, iv: iv },
      derived.key,
      arrayBuf
    );
    /* Pack: salt(16) + iv(12) + ciphertext */
    var packed = new Uint8Array(derived.salt.length + iv.length + ciphertext.byteLength);
    packed.set(derived.salt, 0);
    packed.set(iv, derived.salt.length);
    packed.set(new Uint8Array(ciphertext), derived.salt.length + iv.length);
    return new Blob([packed], { type: "application/octet-stream" });
  },

  /* --- Decrypt a blob (image) --- */
  decryptBlob: async function(encryptedBlob, passphrase) {
    var arrayBuf = await encryptedBlob.arrayBuffer();
    var salt = new Uint8Array(arrayBuf.slice(0, this.SALT_LENGTH));
    var iv = new Uint8Array(arrayBuf.slice(this.SALT_LENGTH, this.SALT_LENGTH + this.IV_LENGTH));
    var ciphertext = arrayBuf.slice(this.SALT_LENGTH + this.IV_LENGTH);
    var derived = await this.deriveKey(passphrase, salt);
    var decrypted = await crypto.subtle.decrypt(
      { name: this.ALGO, iv: iv },
      derived.key,
      ciphertext
    );
    return new Blob([decrypted], { type: "image/jpeg" });
  },

  /* --- Generate a random passphrase --- */
  generatePassphrase: function(length) {
    length = length || 32;
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    var arr = crypto.getRandomValues(new Uint8Array(length));
    var result = "";
    for (var i = 0; i < length; i++) {
      result += chars[arr[i] % chars.length];
    }
    return result;
  },

  /* --- Hash a string (SHA-256, for fingerprints) --- */
  hashString: async function(str) {
    var enc = new TextEncoder();
    var hashBuf = await crypto.subtle.digest("SHA-256", enc.encode(str));
    return this.arrayBufferToBase64(hashBuf);
  },

  /* --- Helpers --- */
  arrayBufferToBase64: function(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = "";
    for (var i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  },

  base64ToArrayBuffer: function(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  },

  /* --- Check if Web Crypto is available --- */
  isSupported: function() {
    return typeof crypto !== "undefined" && crypto.subtle;
  }
};
