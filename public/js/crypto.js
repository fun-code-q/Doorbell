/* ============================================================
   QR Doorbell — Guest-side encryption helpers
   ------------------------------------------------------------
   Two functions exposed on window.Crypto:

     sealToBase64(plaintext, pubkeyB64)
         Single-recipient. Returns one base64 ciphertext or null.

     sealForMany(plaintext, pubkeysB64)
         Multi-recipient (Batch A #1). Returns an array of ciphertexts —
         one per recipient pubkey, in the same order. Owner devices try
         each one with their private key and the first that decrypts wins.

   Algorithm: libsodium crypto_box_seal (X25519 + XSalsa20-Poly1305,
   anonymous sender). Same as before; multi-recipient just loops.
   ============================================================ */
/* global sodium */
(function () {
  "use strict";

  function b64ToBytes(b64) {
    var safe = b64.replace(/-/g, "+").replace(/_/g, "/");
    while (safe.length % 4 !== 0) safe += "=";
    var bin = atob(safe);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  var Crypto = {
    ready: function () {
      if (window.sodium && window.sodium.ready) return window.sodium.ready;
      return Promise.resolve();
    },

    sealToBase64: async function (plaintext, pubB64) {
      if (!window.sodium || !pubB64) return null;
      await Crypto.ready();
      try {
        var pub = b64ToBytes(pubB64);
        var pt = new TextEncoder().encode(plaintext);
        return bytesToB64(window.sodium.crypto_box_seal(pt, pub));
      } catch (e) {
        console.warn("[Crypto] seal failed:", e);
        return null;
      }
    },

    /**
     * Encrypt to N recipients. Returns null if libsodium isn't ready or
     * the array is empty. Returns an array of ciphertexts on success;
     * the ith ciphertext is decryptable with the ith pubkey's secret key.
     */
    sealForMany: async function (plaintext, pubsB64) {
      if (!window.sodium || !Array.isArray(pubsB64) || pubsB64.length === 0) return null;
      await Crypto.ready();
      try {
        var pt = new TextEncoder().encode(plaintext);
        var out = [];
        for (var i = 0; i < pubsB64.length; i++) {
          var pub = b64ToBytes(pubsB64[i]);
          out.push(bytesToB64(window.sodium.crypto_box_seal(pt, pub)));
        }
        return out;
      } catch (e) {
        console.warn("[Crypto] sealForMany failed:", e);
        return null;
      }
    },

    /** Cryptographically-strong client UUID for request idempotency. */
    randomToken: function () {
      var buf = new Uint8Array(16);
      crypto.getRandomValues(buf);
      var hex = "";
      for (var i = 0; i < buf.length; i++) {
        var x = buf[i].toString(16);
        hex += x.length === 1 ? "0" + x : x;
      }
      return hex;
    },
  };

  window.Crypto = Crypto;
})();
