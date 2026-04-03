// QR Vault — i18n Hook
// Ports i18n.js from the web — same translation strings, React hooks pattern

import { useState, useCallback, useEffect } from 'react';
import { getLocales } from 'expo-localization';
import { Storage } from '../lib/storage';

// -----------------------------------------------------------------------
// Translations (identical strings from web i18n.js)
// -----------------------------------------------------------------------
const translations: Record<string, Record<string, string>> = {
  en: {
    app_name: 'QR Doorbell',
    sign_in: 'Sign In',
    sign_up: 'Create Vault',
    sign_out: 'Sign Out',
    email: 'Email',
    password: 'Password',
    owner_signin_subtitle: 'Sign in to manage your doorbell',
    owner_signup_subtitle: 'Create your secure vault',
    no_account: "Don't have an account?",
    create_one: 'Create one',
    have_account: 'Already have an account?',
    dashboard: 'Dashboard',
    activity_log: 'Activity Log',
    point_factory: 'Point Factory',
    door_management: 'Door Management',
    settings: 'Settings',
    audit_log: 'Audit Log',
    rings_today: 'Rings Today',
    pending: 'Pending',
    avg_response: 'Avg Response',
    total_rings: 'Total Rings',
    all: 'All',
    waiting: 'Waiting',
    responded: 'Responded',
    search_rings: 'Search rings...',
    mark_all_read: 'Mark All Read',
    export_csv: 'Export CSV',
    monitoring: 'Monitoring secure signals...',
    no_rings_found: 'No rings found',
    ack: 'ACK',
    acknowledged: 'Acknowledged.',
    coming: 'COMING',
    secure_reply: 'REPLY',
    custom_reply: 'Enter your response:',
    delete: 'Delete',
    confirm_delete: 'Are you sure?',
    deleted: 'Deleted successfully',
    signal_inbound: 'Signal Inbound',
    signal_dispatched: 'Signal Dispatched',
    point_identifier: 'Point Identifier (e.g. Penthouse)',
    generate: 'GENERATE',
    archive_png: 'SAVE PNG',
    door_name: 'Door Name',
    description: 'Description (optional)',
    add_door: 'Add Door',
    edit: 'Edit',
    saved: 'Saved successfully',
    save: 'Save',
    notification_sound: 'Sound',
    vibration: 'Vibration',
    push_enabled: 'Push Notifications',
    language: 'Language',
    auto_logout: 'Auto Logout (min)',
    no_audit_entries: 'No audit entries yet',
    error_generic: 'An unexpected error occurred',
    error_occurred: 'An error occurred',
    new_ring_alert: 'New visitor at {door}',
    session_expired: 'Session expired. Please sign in again.',
    timeout_warning: 'You will be logged out in {seconds} seconds due to inactivity.',
    stay_active: 'Stay Active',
    loading: 'Loading...',
    offline_message: 'Connection lost. Some features may not be available.',
    retry: 'Retry',
    vault_setup: 'System Setup',
    vault_setup_desc: 'Please configure your Supabase credentials before accessing the dashboard.',
    next: 'Load More',
    passphrase_prompt: 'Set Encryption Passphrase',
    passphrase_hint: 'This key decrypts visitor messages. Store it safely.',
    passphrase_placeholder: 'Enter a strong passphrase...',
    passphrase_confirm: 'Confirm Passphrase',
    passphrase_mismatch: 'Passphrases do not match',
    passphrase_saved: 'Passphrase saved securely',
  },
  de: {
    app_name: 'QR Türklingel',
    sign_in: 'Anmelden',
    sign_up: 'Vault Erstellen',
    sign_out: 'Abmelden',
    email: 'E-Mail',
    password: 'Passwort',
    owner_signin_subtitle: 'Anmelden zum Verwalten',
    owner_signup_subtitle: 'Erstellen Sie Ihren sicheren Vault',
    no_account: 'Noch kein Konto?',
    create_one: 'Konto erstellen',
    have_account: 'Bereits ein Konto?',
    dashboard: 'Dashboard',
    activity_log: 'Aktivitätsprotokoll',
    point_factory: 'QR-Generator',
    door_management: 'Tür-Verwaltung',
    settings: 'Einstellungen',
    audit_log: 'Prüfprotokoll',
    rings_today: 'Klingel Heute',
    pending: 'Ausstehend',
    avg_response: 'Ø Antwortzeit',
    total_rings: 'Gesamt Klingel',
    all: 'Alle',
    waiting: 'Wartend',
    responded: 'Beantwortet',
    search_rings: 'Klingeln suchen...',
    mark_all_read: 'Alle als gelesen',
    export_csv: 'CSV Exportieren',
    monitoring: 'Überwachung aktiv...',
    no_rings_found: 'Keine Klingeln gefunden',
    ack: 'BESTÄTIGT',
    acknowledged: 'Bestätigt.',
    coming: 'KOMME',
    secure_reply: 'ANTWORT',
    custom_reply: 'Eigene Antwort:',
    delete: 'Löschen',
    confirm_delete: 'Sind Sie sicher?',
    deleted: 'Erfolgreich gelöscht',
    signal_inbound: 'Signal unterwegs',
    signal_dispatched: 'Signal gesendet',
    point_identifier: 'Punkt-Name (z.B. Penthouse)',
    generate: 'ERZEUGEN',
    archive_png: 'PNG SPEICHERN',
    door_name: 'Tür-Name',
    description: 'Beschreibung (optional)',
    add_door: 'Tür Hinzufügen',
    edit: 'Bearbeiten',
    saved: 'Erfolgreich gespeichert',
    save: 'Speichern',
    notification_sound: 'Ton',
    vibration: 'Vibration',
    push_enabled: 'Push-Benachrichtigungen',
    language: 'Sprache',
    auto_logout: 'Auto-Abmeldung (Min)',
    no_audit_entries: 'Noch keine Prüfprotokoll-Einträge',
    error_generic: 'Ein unerwarteter Fehler ist aufgetreten',
    error_occurred: 'Ein Fehler ist aufgetreten',
    new_ring_alert: 'Neuer Besucher an {door}',
    session_expired: 'Sitzung abgelaufen. Bitte melden Sie sich erneut an.',
    timeout_warning: 'Sie werden in {seconds} Sekunden wegen Inaktivität abgemeldet.',
    stay_active: 'Aktiv bleiben',
    loading: 'Laden...',
    offline_message: 'Verbindung verloren. Einige Funktionen sind möglicherweise nicht verfügbar.',
    retry: 'Wiederholen',
    vault_setup: 'System-Einrichtung',
    vault_setup_desc: 'Bitte konfigurieren Sie Ihre Supabase-Zugangsdaten.',
    next: 'Mehr Laden',
    passphrase_prompt: 'Verschlüsselungs-Passphrase setzen',
    passphrase_hint: 'Dieser Schlüssel entschlüsselt Besuchernachrichten.',
    passphrase_placeholder: 'Passphrase eingeben...',
    passphrase_confirm: 'Passphrase bestätigen',
    passphrase_mismatch: 'Passphrases stimmen nicht überein',
    passphrase_saved: 'Passphrase sicher gespeichert',
  },
};

// -----------------------------------------------------------------------
// Hook
// -----------------------------------------------------------------------
let globalLang = 'en';

export function useI18n() {
  const [lang, setLangState] = useState(globalLang);

  useEffect(() => {
    Storage.get<string>('lang').then((saved) => {
      if (saved && translations[saved]) {
        globalLang = saved;
        setLangState(saved);
      } else {
        // Detect device locale
        const locale = getLocales()[0]?.languageCode ?? 'en';
        const detected = translations[locale] ? locale : 'en';
        globalLang = detected;
        setLangState(detected);
        Storage.set('lang', detected);
      }
    });
  }, []);

  const setLang = useCallback(async (newLang: string) => {
    if (!translations[newLang]) return;
    globalLang = newLang;
    setLangState(newLang);
    await Storage.set('lang', newLang);
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      const dict = translations[lang] || translations.en;
      let str = dict[key] || translations.en[key] || key;
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        });
      }
      return str;
    },
    [lang]
  );

  return { lang, setLang, t };
}

// Standalone translate for use outside hooks (in logic utilities)
export function translate(key: string, params?: Record<string, string | number>): string {
  const dict = translations[globalLang] || translations.en;
  let str = dict[key] || translations.en[key] || key;
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    });
  }
  return str;
}
