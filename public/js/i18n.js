/* global MutationObserver */
/* ============================================================
   QR Doorbell - Internationalization (i18n)
   ============================================================ */
/* exported I18n */

const I18n = {
  currentLang: "en",
  observer: null,
  _isApplying: false,
  _queuedApply: false,

  translations: {
    en: {
      app_name: "QR DoorBell",
      guest_title: "QR DoorBell",
      ring_button: "Ring",
      ring_button_sending: "Reaching Center...",
      ring_button_sent: "Signal Received",
      send_button: "Send",
      how_it_works: "Security Overview",
      instruction_desc: "Your request is sent instantly to the owner. Please keep this window open for the reply.",
      status_camera_error: "Sensor access required",
      status_permission_denied: "Access denied",
      status_transmitting: "Transmitting...",
      status_sent: "Signal Received",
      status_error: "Connection failure. Retry.",
      status_rate_limited: "Quiet period active. Please wait.",
      status_offline: "No connection detected.",
      reply_inbound: "Live Response",
      reply_waiting: "Waiting for owner...",
      visitor_memo: "Note for owner (optional)",
      door_point: "Location",
      detecting: "Analyzing",
      point: "Entry",
      send: "Send",
      location_permission: "Geo-tag (optional)",
      location_granted: "Location attached",
      location_denied: "Location private",
      retry: "Retry",
      close: "Dismiss",
      cancel: "Abort",
      confirm: "Authorize",
      ok: "Understood",
      owner_title: "Owner Dashboard",
      owner_login: "Access Terminal",
      owner_logout: "Secure Sign Out",
      email: "Identifier",
      password: "Security Key",
      owner_signin_title: "System Access",
      owner_signin_subtitle: "Authorized Personnel Only",
      owner_signin_error: "Invalid Credentials",
      owner_signin_loading: "Authenticating...",
      sign_in: "Authorize",
      sign_up: "Create System",
      owner_signup_subtitle: "Initialize secure vault",
      no_account: "New System?",
      create_one: "Register",
      have_account: "Existing User?",
      sign_out: "Sign Out",
      dashboard: "Console",
      activity_log: "Event Log",
      point_factory: "Token Generator",
      qr_generate: "Generate Token",
      qr_download: "Save Asset",
      qr_placeholder: "Entry Label (e.g. Front Gate)",
      point_identifier: "Label",
      settings: "Configuration",
      security: "Protocol",
      analytics: "Traffic",
      rings_today: "Signals Today",
      rings_this_week: "Signals Week",
      avg_response: "Latency",
      total_rings: "Cumulative",
      pending: "Active",
      ack: "ACK",
      acknowledged: "Acknowledged",
      coming: "En Route",
      secure_reply: "Response",
      reply_prompt: "Enter response:",
      reply_sent: "Signal Dispatched",
      reply_error: "Dispatch Failed",
      no_rings: "Scanning for signals...",
      no_rings_found: "Null set",
      search_rings: "Filter...",
      all: "All Records",
      waiting: "Queued",
      responded: "Resolved",
      export_csv: "Export Data",
      mark_all_read: "Mark Seen",
      delete: "Purge",
      delete_confirm: "Confirm deletion?",
      deleted: "Record purged",
      delete_error: "Purge failed",
      dark_mode: "Obsidian",
      light_mode: "Opal",
      sound_enabled: "Audio",
      vibration: "Haptics",
      push_enabled: "Remote Alerts",
      auto_logout: "Idle Timeout",
      save_settings: "Commit Changes",
      save: "Commit",
      settings_saved: "Config Updated",
      settings_error: "Update Failed",
      audit_log: "Audit",
      audit_action: "Action",
      audit_time: "Timestamp",
      audit_user: "Operator",
      audit_details: "Metadata",
      no_audit_entries: "Empty Log",
      door_management: "Nodes",
      add_door: "Add Node",
      edit_door: "Modify",
      delete_door: "Remove",
      door_name: "Node Name",
      door_description: "Context",
      door_active: "Enabled",
      door_saved: "Node updated",
      door_deleted: "Node removed",
      offline_title: "Offline",
      offline_message: "Network lost. Retrying...",
      offline_cached_rings: "Local cache active.",
      offline_retry: "Re-sync",
      session_timeout: "IDLE",
      session_expired: "Session Revoked",
      timeout_warning: "Revocation in {seconds}s",
      stay_active: "Maintain Session",
      loading: "Processing...",
      error_generic: "System Fault",
      error_occurred: "Exception",
      error_network: "Network Fault",
      error_storage: "Disk Fault",
      error_auth: "Auth Fault",
      welcome_back: "Welcome",
      new_ring_alert: "Signal at {door}",
      anonymous_visitor: "Visitor",
      just_now: "Now",
      language_toggle: "Locale",
      language: "Locale",
      notification_sound: "Audio",
      generate: "CREATE",
      archive_png: "EXPORT PNG",
      add_door_btn: "New Node",
      description: "Metadata",
      signal_inbound: "Signal Inbound",
      signal_dispatched: "Response Sent",
      custom_reply: "Compose:",
      invalid_credentials: "Faulty Credentials",
      vault_setup: "Setup",
      vault_setup_desc: "Configure Supabase in config.js",
      next: "More",
      edit: "Modify",
      saved: "Committed",
      confirm_delete: "Confirm Purge?",
      monitoring: "Scanning..."
    },
    de: {
      app_name: "QR Türklingel",
      guest_title: "Smarte QR Türklingel",
      ring_button: "Klingeln",
      ring_button_sending: "Senden...",
      ring_button_sent: "Signal gesendet!",
      send_button: "Senden",
      how_it_works: "So funktioniert es",
      instruction_desc: "Ihr Signal wird sofort an den Eigentümer gesendet. Bitte bleiben Sie auf dieser Seite für die Antwort.",
      status_camera_error: "Kamerazugriff erforderlich",
      status_permission_denied: "Kamera-Erlaubnis verweigert",
      status_transmitting: "Signal wird übertragen...",
      status_sent: "Signal von Zentrale empfangen",
      status_error: "Übertragungsfehler. Bitte versuchen Sie es erneut.",
      status_rate_limited: "Bitte warten Sie vor dem nächsten Klingeln",
      status_offline: "Sie sind offline. Bitte verbinden, um zu klingeln.",
      reply_inbound: "Signal unterwegs",
      reply_waiting: "Bitte warten...",
      visitor_memo: "Besuchernotiz (optional)...",
      door_point: "Punkt",
      detecting: "Erkenne",
      point: "Punkt",
      send: "Senden",
      location_permission: "Standort teilen (optional)",
      location_granted: "Standort erfasst",
      location_denied: "Standort nicht geteilt",
      retry: "Wiederholen",
      close: "Schließen",
      cancel: "Abbrechen",
      confirm: "Bestätigen",
      ok: "OK",
      owner_title: "QR Türklingel Dashboard",
      owner_login: "Anmelden",
      owner_logout: "Abmelden",
      email: "E-Mail",
      password: "Passwort",
      owner_signin_title: "Eigentümer-Zugang",
      owner_signin_subtitle: "Anmelden zum Verwalten",
      owner_signin_error: "Ungültige E-Mail oder Passwort",
      owner_signin_loading: "Anmeldung...",
      sign_in: "Anmelden",
      sign_up: "Vault Erstellen",
      owner_signup_subtitle: "Erstellen Sie Ihren sicheren Vault",
      no_account: "Noch kein Konto?",
      create_one: "Konto erstellen",
      have_account: "Bereits ein Konto?",
      sign_out: "Abmelden",
      dashboard: "Dashboard",
      activity_log: "Aktivitätsprotokoll",
      point_factory: "QR-Generator",
      qr_generate: "QR Erzeugen",
      qr_download: "PNG Herunterladen",
      qr_placeholder: "Punkt-Name (z.B. Penthouse)",
      point_identifier: "Punkt-Name (z.B. Penthouse)",
      settings: "Einstellungen",
      security: "Sicherheit",
      analytics: "Analytik",
      rings_today: "Klingel Heute",
      rings_this_week: "Klingel Diese Woche",
      avg_response: "Ø Antwortzeit",
      total_rings: "Gesamt Klingel",
      pending: "Ausstehend",
      ack: "BESTÄTIGT",
      acknowledged: "Bestätigt.",
      coming: "KOMME",
      secure_reply: "EIGENE ANTWORT",
      reply_prompt: "Antwort eingeben:",
      reply_sent: "Antwort gesendet",
      reply_error: "Antwort fehlgeschlagen",
      no_rings: "Überwachung aktiv...",
      no_rings_found: "Keine Klingeln gefunden",
      search_rings: "Klingeln suchen...",
      all: "Alle",
      waiting: "Wartend",
      responded: "Beantwortet",
      export_csv: "CSV Exportieren",
      mark_all_read: "Alle als gelesen",
      delete: "Löschen",
      delete_confirm: "Möchten Sie diese Klingel wirklich löschen?",
      deleted: "Erfolgreich gelöscht",
      delete_error: "Löschen fehlgeschlagen",
      dark_mode: "Dunkelmodus",
      light_mode: "Hellmodus",
      sound_enabled: "Ton",
      vibration: "Vibration",
      push_enabled: "Push-Benachrichtigungen",
      auto_logout: "Auto-Abmeldung (Min)",
      save_settings: "Einstellungen Speichern",
      save: "Speichern",
      settings_saved: "Einstellungen gespeichert",
      settings_error: "Einstellungen speichern fehlgeschlagen",
      audit_log: "Prüfprotokoll",
      audit_action: "Aktion",
      audit_time: "Zeit",
      audit_user: "Benutzer",
      audit_details: "Details",
      no_audit_entries: "Noch keine Prüfprotokoll-Einträge",
      door_management: "Tür-Verwaltung",
      add_door: "Tür Hinzufügen",
      edit_door: "Bearbeiten",
      delete_door: "Löschen",
      door_name: "Tür-Name",
      door_description: "Beschreibung",
      door_active: "Aktiv",
      door_saved: "Tür-Punkt gespeichert",
      door_deleted: "Tür-Punkt gelöscht",
      offline_title: "Sie sind Offline",
      offline_message: "Verbindung verloren. Einige Funktionen sind möglicherweise nicht verfügbar.",
      offline_cached_rings: "Zwischengespeicherte Klingeln werden bei Online-Verbindung synchronisiert.",
      offline_retry: "Verbindung Wiederholen",
      session_timeout: "Sitzung läuft bald ab",
      session_expired: "Sitzung abgelaufen. Bitte melden Sie sich erneut an.",
      timeout_warning: "Sie werden in {seconds} Sekunden wegen Inaktivität abgemeldet.",
      stay_active: "Aktiv bleiben",
      loading: "Laden...",
      error_generic: "Ein unerwarteter Fehler ist aufgetreten",
      error_occurred: "Ein Fehler ist aufgetreten",
      error_network: "Netzwerkfehler. Bitte überprüfen Sie Ihre Verbindung.",
      error_storage: "Speicherfehler. Bitte versuchen Sie es erneut.",
      error_auth: "Authentifizierungsfehler. Bitte melden Sie sich erneut an.",
      welcome_back: "Willkommen zurück",
      new_ring_alert: "Neuer Besucher an {door}",
      anonymous_visitor: "Anonymer Besucher",
      just_now: "Gerade eben",
      language_toggle: "Sprache wechseln",
      language: "Sprache",
      notification_sound: "Ton",
      generate: "ERZEUGEN",
      archive_png: "PNG SPEICHERN",
      add_door_btn: "Tür Hinzufügen",
      description: "Beschreibung (optional)",
      signal_inbound: "Signal unterwegs",
      signal_dispatched: "Signal gesendet",
      custom_reply: "Eigene Antwort:",
      invalid_credentials: "Ungültige E-Mail oder Passwort",
      vault_setup: "System-Einrichtung",
      vault_setup_desc: "Bitte konfigurieren Sie Ihre Supabase-Zugangsdaten in config.js.",
      next: "Mehr Laden",
      edit: "Bearbeiten",
      saved: "Erfolgreich gespeichert",
      confirm_delete: "Sind Sie sicher?",
      monitoring: "Überwachung aktiv..."
    }
  },

  init: function() {
    var saved = Utils.storage.get("lang");
    if (!saved) {
      var browserLang = navigator.language || "en";
      var code = browserLang.split("-")[0].toLowerCase();
      saved = this.translations[code] ? code : "en";
      Utils.storage.set("lang", saved);
    }
    this.currentLang = saved;
    Utils.setLanguage(saved);
    this.apply();
    this.setupObserver();
  },

  setupObserver: function() {
    if (this.observer || typeof MutationObserver === "undefined" || !document.body) return;
    var self = this;
    this.observer = new MutationObserver(function() {
      if (self._isApplying || self._queuedApply) return;
      self._queuedApply = true;
      Promise.resolve().then(function() {
        self._queuedApply = false;
        self.apply();
      });
    });
    this.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-i18n", "data-i18n-placeholder"] });
  },

  t: function(key, params) {
    params = params || {};
    var lang = this.currentLang;
    var str = (this.translations[lang] && this.translations[lang][key]) || (this.translations.en && this.translations.en[key]) || key;
    Object.keys(params).forEach(function(k) {
      str = str.replace(new RegExp("\\{" + k + "\\}", "g"), params[k]);
    });
    return str;
  },

  setLang: function(lang) {
    if (!this.translations[lang]) lang = "en";
    this.currentLang = lang;
    Utils.setLanguage(lang);
    Utils.storage.set("lang", lang);
    this.apply();
  },

  apply: function() {
    if (this._isApplying) return;
    this._isApplying = true;
    var self = this;
    try {
      document.querySelectorAll("[data-i18n]").forEach(function(el) {
        var key = el.getAttribute("data-i18n");
        var translated = self.t(key);
        if (el.textContent !== translated) {
          el.textContent = translated;
        }
      });
      document.querySelectorAll("[data-i18n-placeholder]").forEach(function(el) {
        var key = el.getAttribute("data-i18n-placeholder");
        var translated = self.t(key);
        if (el.placeholder !== translated) {
          el.placeholder = translated;
        }
      });
    } finally {
      this._isApplying = false;
    }
  }
};
