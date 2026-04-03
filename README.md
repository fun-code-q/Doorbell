# QR Doorbell 🔔

A professional, secure, and contactless "Smart QR Wireless Doorbell" system. It provides a frictionless guest experience via location-aware QR codes and an industrial-grade owner dashboard available on both web and native mobile platforms.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build Status](https://github.com/fun-code-q/Doorbell/actions/workflows/ci.yml/badge.svg)](https://github.com/fun-code-q/Doorbell/actions)

## 🌟 Overview

`QR Doorbell` replaces traditional physical doorbells with a secure, digital alternative. 
- **Guests** scan a unique QR code to "ring" the doorbell and send optional messages without installing any app.
- **Owners** receive instant push notifications and manage rings through a powerful dashboard (Web PWA or Native Android/iOS App).

---

## ✨ Core Features

### 🏁 Guest Experience (App-Free)
- **Zero-Install**: Works directly in any modern mobile browser.
- **Location-Aware QR**: Prevents "fake" rings from remote locations.
- **Encrypted Messaging**: Optional client-side message encryption for privacy.
- **Internationalization**: Full i18n support for multiple languages.

### 🏠 Owner Management
- **Native Mobile App**: Built with Expo/React Native for real-time alerts.
- **Real-time Ring Feed**: Instant updates when someone is at the door via the mobile app.
- **Smart Replies**: One-tap replies (`ACK`, `COMING`, etc.) or custom messages.
- **Multi-House Support**: Manage multiple properties from a single account.
- **QR Tokenization**: Generate and revoke secure, time-limited QR tokens for different doors.
- **Audit Logs**: Full transparency with database-level audit trails.
- **CSV Export**: Export ring history for record-keeping.

### 🛡️ Security & Stability
- **Row-Level Security (RLS)**: Robust Postgres policies for tenant isolation.
- **Rate Limiting**: Integrated DB triggers to prevent spam.
- **End-to-End Encryption**: Secure message handling between guest and owner.
- **PWA Ready**: Offline support and home-screen installation.
- **Enterprise Settings**: Master PIN protection for sensitive owner actions.

---

## 🛠️ Tech Stack

### Frontend (Guest Web)
- **Vanilla HTML5/CSS3/JS**: No heavy frameworks, optimized for speed.
- **Supabase JS SDK**: Real-time DB and Auth integration.
- **Service Workers**: PWA capabilities and offline shell.

### Mobile App (Owner)
- **React Native & Expo**: Cross-platform native performance.
- **TypeScript**: Type-safe development for reliability.
- **Native Notifications**: Real-time push alerts via `expo-notifications`.
- **Secure Store**: Encrypted storage for credentials and keys.

### Backend & Infrastructure
- **Supabase**: PostgreSQL, Auth (Email/OTP), Storage, and Real-time.
- **Vercel**: Optimized edge hosting for the static guest interface.

---

## 🚀 Getting Started

### Prerequisites
- Node.js 20+
- A Supabase project

### 1. Database Setup
1. Open your Supabase SQL Editor.
2. Run the `supabase-final-master.sql` script to initialize the schema, RLS policies, and RPCs.

### 2. Web Application (Guest/Web Owner)
1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure `public/config.js` with your Supabase credentials:
   ```javascript
   window.__QR_CONFIG = {
     SUPABASE_URL: "your-url",
     SUPABASE_ANON_KEY: "your-anon-key"
   };
   ```
3. Start the dev server:
   ```bash
   npm run dev
   ```

### 3. Mobile Owner App
1. Navigate to the mobile directory:
   ```bash
   cd mobile-owner
   npm install
   ```
2. Setup environment variables in `mobile-owner/.env`:
   ```bash
   EXPO_PUBLIC_SUPABASE_URL=your-supabase-url
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```
3. Start the Expo development server:
   ```bash
   npx expo start
   ```

---

## 📦 Project Structure

```text
.
├── mobile-owner/       # Expo/React Native app for owners
├── public/             # Guest web interface (Static)
│   ├── js/             # Core logic (auth, crypto, guest)
│   ├── css/            # UI styles
│   ├── index.html      # Guest landing page
│   └── owner.html      # Legacy web owner dashboard
├── supabase-final-master.sql  # Database schema & policies
├── vercel.json         # Hosting configuration
└── package.json        # Main project config
```

---

## 🔧 Recent Improvements

This version includes several critical enhancements for production readiness:
- **XSS Prevention**: Enhanced message sanitization on the guest side.
- **PWA Optimization**: Improved manifest metadata and service worker cache strategy.
- **Reliability**: Robust validation for Supabase responses and race condition fixes in UI interaction.
- **Accessibility**: ARIA enhancements for better screen reader support.
- **Security**: HTTPS enforcement and flattened RLS policies to prevent PostgreSQL recursion errors.

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

Developed with ❤️ for secure and frictionless guest management.
