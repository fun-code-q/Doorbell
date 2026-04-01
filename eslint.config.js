export default [
  {
    ignores: [
      "node_modules/**",
      "public/icons/**"
    ]
  },
  {
    files: ["public/js/**/*.js", "public/config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        console: "readonly",
        crypto: "readonly",
        fetch: "readonly",
        Notification: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        File: "readonly",
        Blob: "readonly",
        Audio: "readonly",
        Image: "readonly",
        FileReader: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        atob: "readonly",
        btoa: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        requestAnimationFrame: "readonly",
        prompt: "readonly",
        confirm: "readonly",
        module: "readonly",
        supabase: "readonly",
        QRCode: "readonly",
        Utils: "readonly",
        I18n: "readonly",
        Auth: "readonly",
        App: "readonly",
        CONFIG: "readonly",
        Crypto: "readonly"
      }
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { "args": "none", "caughtErrors": "none", "ignoreRestSiblings": true }]
    }
  },
  {
    files: ["public/sw.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        self: "readonly",
        caches: "readonly",
        clients: "readonly",
        fetch: "readonly",
        Response: "readonly",
        URL: "readonly"
      }
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { "args": "none", "caughtErrors": "none", "ignoreRestSiblings": true }]
    }
  }
];
