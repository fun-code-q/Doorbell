# QR Doorbell 🔔 — Pro Edition

A professional, high-reliability, and contactless "Smart QR Wireless Doorbell" system. This project delivers a **frictionless guest experience** via location-aware QR codes and an **industrial-grade owner notification engine** optimized for Android 14+ and iOS.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Deploy Edge Functions](https://github.com/fun-code-q/Doorbell/actions/workflows/deploy-supabase.yml/badge.svg)](https://github.com/fun-code-q/Doorbell/actions/workflows/deploy-supabase.yml)

---

## 🌟 The "Bulletproof" Notification Engine
Unlike standard apps, QR Doorbell is built for **100% Ring Reliability**. It treats doorbell rings as high-priority events that bypass system restrictions.

- **Dual-Payload Delivery**: Sends both a visible "Alert" and a hidden "Headless Wake-up" to ensure the app reacts even if it was "killed" by the system.
- **Full-Screen Ring UI**: On Android, rings bypass the lock screen and show a direct "Answer/Decline" interface immediately.
- **High-Priority FCM**: Configured with `priority: high` and a 5-minute TTL to penetrate Android's "Doze" mode.
- **Persistent Vibration**: Custom vibration patterns until the owner takes action.

---

## ✨ Core Features

### 🏁 Guest Experience (App-Free)
- **Zero-Install**: Works directly in any modern mobile browser.
- **Location-Aware QR**: Prevents "fake" rings from remote locations.
- **Threaded Live Chat**: Real-time messaging between guest and owner.

### 🏠 Owner Management
- **Native Pro App**: Built with Expo/React Native for real-time alerts.
- **Power-User Dashboard**: Manage multiple houses and door points from one screen.
- **Notification Troubleshooting**: Built-in wizard to help owners configure "Overlay" and "Battery Optimization" permissions.

---

## 🛠️ Automated Cloud & CI/CD
This project is pre-configured for automated DevOps:
- **GitHub Actions**: Every push to `main` automatically deploys your Supabase Edge Functions.
- **Supabase Webhooks**: Database triggers are pre-wired to the notification pipeline via `pg_net`.

---

## 🚀 Quick Start (Owner)

### 1. Cloud Pre-requisites
1. **Supabase**: Enable the `pg_net` extension.
2. **Secrets**: Set your `EXPO_ACCESS_TOKEN` in Supabase Edge Function secrets.
3. **GitHub**: Add your `EXPO_TOKEN`, `SUPABASE_ACCESS_TOKEN`, and `SUPABASE_URL` to your repository secrets.

### 2. Mobile App Setup
> [!IMPORTANT]
> **Development Build Required**: Due to native Android permissions (`USE_FULL_SCREEN_INTENT`), this app requires a **Development Build** to function. Standard Expo Go will not handle background waking.

1. Navigate to `mobile-owner/`
2. Install dependencies: `npm install`
3. Launch development build:
   ```bash
   npx expo run:android  # For Android
   npx expo run:ios      # For iOS
   ```

---

## 📦 Project Structure

```text
.
├── mobile-owner/       # Expo/React Native app (Owner Dashboard)
├── supabase/           # Edge Functions & CI/CD workflows
├── public/             # Guest Web Interface (Vanilla JS/HTML)
├── .github/            # Automated deployment workflows
└── supabase-final-master.sql  # Full database schema & policies
```

---

## 📄 License
MIT License - Developed with ❤️ for secure and frictionless guest management.
CENSE](LICENSE) for details.

---

Developed with ❤️ for secure and frictionless guest management.
