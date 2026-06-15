// QR Doorbell - Authentication Module
// Supabase Auth with session management and inactivity timeout

const Auth = {
  supabase: null,
  session: null,
  inactivityTimer: null,
  timeoutWarningTimer: null,
  initialized: false,
  restorePromise: null,
  activityHandler: null,
  activityEvents: ["mousedown", "keydown", "scroll", "touchstart", "mousemove"],
  pendingSignOutReason: null,

  init(supabaseClient) {
    if (supabaseClient) this.supabase = supabaseClient;
    if (!this.supabase) return Promise.resolve(null);
    if (this.initialized) {
      return this.restorePromise || Promise.resolve(this.session);
    }
    this.initialized = true;
    this.setupAuthListener();
    this.setupInactivityTracking();
    this.restorePromise = this.restoreSession().finally(() => {
      this.restorePromise = null;
    });
    return this.restorePromise;
  },

  async restoreSession() {
    try {
      const { data, error } = await this.supabase.auth.getSession();
      if (error) throw error;
      if (data?.session) {
        this.session = data.session;
        this.onSignIn(data.session);
      }
    } catch (e) {
      console.warn("Session restore failed", e);
    }
    return this.session;
  },

  setupAuthListener() {
    this.supabase.auth.onAuthStateChange((event, session) => {
      this.session = session;
      if (event === "SIGNED_IN") {
        this.resetInactivityTimer();
        this.onSignIn(session);
      } else if (event === "SIGNED_OUT") {
        this.clearInactivityTimer();
        this.onSignOut(this.pendingSignOutReason || "expired");
        this.pendingSignOutReason = null;
      } else if (event === "TOKEN_REFRESHED") {
        this.resetInactivityTimer();
      }
    });
  },

  async signIn(email, password) {
    try {
      const { data, error } = await this.supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password
      });
      if (error) throw error;
      this.session = data.session;
      this.resetInactivityTimer();
      return { success: true, user: data.user, session: data.session };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  async signUp(email, password) {
    try {
      const { data, error } = await this.supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password
      });
      if (error) throw error;
      return { success: true, user: data.user };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  async signOut(reason) {
    try {
      if (!this.supabase) return { success: true };
      this.pendingSignOutReason = reason || "manual";
      const { error } = await this.supabase.auth.signOut();
      if (error) throw error;
      this.session = null;
      this.clearInactivityTimer();
      return { success: true };
    } catch (error) {
      this.pendingSignOutReason = null;
      return { success: false, error: error.message };
    }
  },

  isAuthenticated() {
    return !!this.session;
  },

  getUser() {
    return this.session?.user || null;
  },

  getAccessToken() {
    return this.session?.access_token || null;
  },

  getOwnerUrl() {
    return new URL("owner.html", window.location.href).toString();
  },

  setupInactivityTracking() {
    if (this.activityHandler) return;
    this.activityHandler = () => this.resetInactivityTimer();
    this.activityEvents.forEach((e) => document.addEventListener(e, this.activityHandler, { passive: true }));
  },

  resetInactivityTimer() {
    this.clearInactivityTimer();
    const storedMinutes = parseInt(Utils.storage.get("auto_logout_minutes"), 10);
    const defaultMinutes = Math.round((CONFIG.INACTIVITY_TIMEOUT || 900000) / 60000) || 15;
    const timeoutMinutes = Number.isFinite(storedMinutes) ? Math.min(Math.max(storedMinutes, 1), 120) : defaultMinutes;
    const timeout = timeoutMinutes * 60 * 1000;
    const configuredWarning = CONFIG.SESSION_TIMEOUT_WARNING || 60000;
    const warning = timeout > 1000 ? Math.min(configuredWarning, timeout - 1000) : 0;
    if (this.isAuthenticated()) {
      if (warning > 0) {
        this.timeoutWarningTimer = setTimeout(() => {
          this.showTimeoutWarning();
        }, timeout - warning);
      }
      this.inactivityTimer = setTimeout(async () => {
        await this.signOut("timeout");
        window.location.href = this.getOwnerUrl();
      }, timeout);
    }
  },

  clearInactivityTimer() {
    if (this.inactivityTimer) { clearTimeout(this.inactivityTimer); this.inactivityTimer = null; }
    if (this.timeoutWarningTimer) { clearTimeout(this.timeoutWarningTimer); this.timeoutWarningTimer = null; }
    this.hideTimeoutWarning();
  },

  showTimeoutWarning() {
    let warning = document.querySelector(".timeout-warning");
    if (warning) return;
    warning = document.createElement("div");
    warning.className = "timeout-warning";
    warning.setAttribute("role", "alert");
    const warningSeconds = Math.max(1, Math.round((CONFIG.SESSION_TIMEOUT_WARNING || 60000) / 1000));
    const msg = document.createElement("span");
    msg.textContent = I18n ? I18n.t("timeout_warning", { seconds: warningSeconds }) : "Your session will expire soon.";
    const btn = document.createElement("button");
    btn.className = "btn btn-primary btn-sm";
    btn.textContent = I18n ? I18n.t("stay_active") : "Stay Active";
    btn.addEventListener("click", () => { this.resetInactivityTimer(); });
    warning.appendChild(msg);
    warning.appendChild(btn);
    document.body.appendChild(warning);
  },

  hideTimeoutWarning() {
    const warning = document.querySelector(".timeout-warning");
    if (warning) warning.remove();
  },

  onSignIn(session) {
    if (!session || !session.user) return;
    Utils.storage.set("auth_session", {
      user_id: session.user.id,
      email: session.user.email,
      signed_in_at: session.user.created_at
    });
    const overlay = document.getElementById("auth-overlay");
    if (overlay) overlay.classList.add("hidden");
    const mainView = document.getElementById("main-view");
    if (mainView) {
      mainView.classList.remove("hidden");
      mainView.classList.add("visible");
    }
    const statusDot = document.getElementById("status-dot");
    if (statusDot) statusDot.classList.add("online");
  },

  onSignOut(reason) {
    Utils.storage.remove("auth_session");
    const overlay = document.getElementById("auth-overlay");
    if (overlay) overlay.classList.remove("hidden");
    const mainView = document.getElementById("main-view");
    if (mainView) {
      mainView.classList.remove("visible");
      mainView.classList.add("hidden");
    }
    const statusDot = document.getElementById("status-dot");
    if (statusDot) statusDot.classList.remove("online");
    if (reason !== "manual" && typeof Utils !== "undefined" && typeof Utils.showToast === "function") {
      Utils.showToast(I18n ? I18n.t("session_expired") : "Session expired", "warning");
    }
  },

  requireAuth(redirectUrl = "owner.html") {
    if (!this.isAuthenticated()) {
      window.location.href = redirectUrl;
      return false;
    }
    return true;
  }
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = Auth;
}
