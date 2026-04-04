/* ============================================================
   QR Doorbell - Utility Functions
   ============================================================ */

const Utils = {
  /* --- XSS Protection --- */
  sanitize: function(str) {
    if (!str) return "";
    var div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
  },

  escapeHTML: function(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
  },

  /* --- Date/Time --- */
  formatDate: function(date, locale) {
    var lang = locale || Utils.storage.get("lang") || "en";
    var d = new Date(date);
    if (isNaN(d.getTime())) return "Invalid date";
    return d.toLocaleString(lang === "de" ? "de-DE" : "en-US", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  },

  formatRelative: function(date) {
    var now = new Date();
    var d = new Date(date);
    var diffMs = now - d;
    var diffMins = Math.floor(diffMs / 60000);
    var diffHours = Math.floor(diffMs / 3600000);
    var diffDays = Math.floor(diffMs / 86400000);
    var lang = Utils.storage.get("lang") || "en";
    if (lang === "de") {
      if (diffMins < 1) return "Gerade eben";
      if (diffMins < 60) return "Vor " + diffMins + " Min.";
      if (diffHours < 24) return "Vor " + diffHours + " Std.";
      return "Vor " + diffDays + " Tag" + (diffDays > 1 ? "en" : "");
    }
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return diffMins + "m ago";
    if (diffHours < 24) return diffHours + "h ago";
    return diffDays + "d ago";
  },



  /* --- Toast Notifications --- */
  showToast: function(message, type, duration, options) {
    type = type || "info";
    duration = duration || 4000;
    options = options || {};
    var position = typeof options === "string" ? options : (options.position || "top-right");
    var isTopLeft = position === "top-left";
    var containerId = isTopLeft ? "toast-container-top-left" : "toast-container";
    var container = document.getElementById(containerId);
    if (!container) {
      container = document.createElement("div");
      container.id = containerId;
      container.className = "toast-container" + (isTopLeft ? " toast-container--top-left" : "");
      container.setAttribute("aria-live", "polite");
      container.setAttribute("aria-atomic", "true");
      document.body.appendChild(container);
    }
    var allowedTypes = { success: true, error: true, warning: true, info: true };
    if (!allowedTypes[type]) type = "info";
    var toast = document.createElement("div");
    toast.className = "toast toast-" + type;
    toast.setAttribute("role", "alert");
    var icon = type === "success" ? "+" : type === "error" ? "!" : type === "warning" ? "!" : "i";
    toast.innerHTML =
      '<span class="toast-icon" aria-hidden="true">' + icon + '</span>' +
      '<div class="toast-content"><div class="toast-message">' + Utils.sanitize(message) + "</div></div>" +
      '<button class="toast-close" aria-label="Close notification">&times;</button>';
    container.appendChild(toast);
    var closeBtn = toast.querySelector(".toast-close");
    var dismiss = function() {
      toast.classList.add("removing");
      setTimeout(function() { toast.remove(); }, 300);
    };
    closeBtn.addEventListener("click", dismiss);
    if (duration > 0) setTimeout(dismiss, duration);
    return dismiss;
  },

  /* --- Loading Overlay --- */
  showLoading: function(message) {
    var overlay = document.createElement("div");
    overlay.className = "loading-overlay";
    overlay.innerHTML =
      '<div class="loading-content"><div class="spinner spinner-lg" aria-hidden="true"></div>' +
      (message ? "<p>" + Utils.sanitize(message) + "</p>" : "") +
      "</div>";
    document.body.appendChild(overlay);
    return function() { overlay.remove(); };
  },

  hideLoading: function() {
    var els = document.querySelectorAll(".loading-overlay");
    for (var i = 0; i < els.length; i++) els[i].remove();
  },

  /* --- LocalStorage Wrapper --- */
  storage: {
    get: function(key, fallback) {
      try {
        var val = localStorage.getItem(key);
        return val !== null ? JSON.parse(val) : (fallback !== undefined ? fallback : null);
      } catch (e) {
        return fallback !== undefined ? fallback : null;
      }
    },
    set: function(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        return false;
      }
    },
    remove: function(key) {
      try { localStorage.removeItem(key); } catch (e) {}
    }
  },

  /* --- Language Helpers --- */
  getLanguage: function() {
    try {
      return localStorage.getItem("qr-doorbell-lang") || (typeof CONFIG !== "undefined" ? CONFIG.DEFAULT_LANGUAGE : "en") || "en";
    } catch (e) {
      return "en";
    }
  },

  setLanguage: function(lang) {
    try { localStorage.setItem("qr-doorbell-lang", lang); } catch (e) {}
    document.documentElement.lang = lang;
  },

  /* --- Debounce/Throttle --- */
  debounce: function(fn, delay) {
    delay = delay || 300;
    var timer;
    return function() {
      var args = arguments;
      var ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function() { fn.apply(ctx, args); }, delay);
    };
  },

  throttle: function(fn, limit) {
    limit = limit || 100;
    var inThrottle = false;
    return function() {
      var args = arguments;
      var ctx = this;
      if (!inThrottle) {
        fn.apply(ctx, args);
        inThrottle = true;
        setTimeout(function() { inThrottle = false; }, limit);
      }
    };
  },

  /* --- UUID --- */
  generateUUID: function() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  },

  /* --- Haptic Feedback --- */
  vibrate: function(pattern) {
    pattern = pattern || [50];
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (e) {}
    }
  },

  /* --- Online/Offline --- */
  isOnline: function() {
    return navigator.onLine;
  },

  /* --- Query Params --- */
  getQueryParam: function(param) {
    return new URLSearchParams(window.location.search).get(param);
  },

  /* --- Browser Fingerprint Hash (lightweight, non-PII) --- */
  getBrowserHash: function() {
    try {
      var parts = [
        navigator.userAgent || "",
        navigator.language || "",
        navigator.platform || "",
        String(screen && screen.width ? screen.width : ""),
        String(screen && screen.height ? screen.height : ""),
        String(new Date().getTimezoneOffset())
      ].join("|");

      // Simple deterministic 32-bit hash -> hex string
      var h = 0;
      for (var i = 0; i < parts.length; i++) {
        h = ((h << 5) - h) + parts.charCodeAt(i);
        h |= 0;
      }
      return "ua_" + (h >>> 0).toString(16);
    } catch (_e) {
      return "ua_unknown";
    }
  },

  /* --- Error Boundary --- */
  wrapErrorBoundary: function(fn, fallback) {
    return function() {
      var args = arguments;
      try {
        var result = fn.apply(this, args);
        if (result && typeof result.catch === "function") {
          return result.catch(function(err) {
            console.error("Async error:", err);
            if (typeof fallback === "function") fallback(err);
          });
        }
        return result;
      } catch (err) {
        console.error("Sync error:", err);
        if (typeof fallback === "function") fallback(err);
      }
    };
  },

  /* --- Service Worker --- */
  registerServiceWorker: function() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(function(err) {
        console.warn("Service Worker registration failed:", err);
      });
    }
  },

  /* --- Notification Permission --- */
  requestNotificationPermission: function() {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  },

  /* --- Clipboard --- */
  copyToClipboard: function(text) {
    if (navigator.clipboard) {
      return navigator.clipboard.writeText(text);
    }
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return Promise.resolve();
  },

  /* --- File Download --- */
  downloadFile: function(content, filename, mimeType) {
    mimeType = mimeType || "text/plain";
    var blob = new Blob([content], { type: mimeType });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  /* --- CSV Export --- */
  exportToCSV: function(data, filename) {
    filename = filename || "export.csv";
    if (!data || !data.length) return;
    var headers = Object.keys(data[0]);
    var rows = data.map(function(row) {
      return headers.map(function(h) {
        return '"' + String(row[h] !== undefined && row[h] !== null ? row[h] : "").replace(/"/g, '""') + '"';
      }).join(",");
    });
    var csv = [headers.join(",")].concat(rows).join("\n");
    Utils.downloadFile(csv, filename, "text/csv");
  },

  /* --- Download CSV alias --- */
  downloadCSV: function(data, filename) {
    Utils.exportToCSV(data, filename);
  }
};
