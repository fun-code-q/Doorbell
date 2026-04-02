/* ============================================================
   QR Doorbell - Guest Page Bootstrap
   ============================================================ */

(function() {
  "use strict";

  var MSG_MAX_LENGTH = 500;
  var URL_PATTERN = /(https?:\/\/|www\.|ftp\.|[a-zA-Z0-9-]+\.[a-zA-Z]{2,})/gi;
  var SUSPICIOUS_PATTERNS = [/<script/i, /javascript:/i, /on\w+\s*=/i, /eval\(/i, /document\.cookie/i, /window\.location/i];

  var ringBtn = document.getElementById("ring-btn");
  var messageInput = document.getElementById("message");
  var replyDrawer = document.getElementById("reply-drawer");
  var replyText = document.getElementById("reply-text");
  var offlineIndicator = document.getElementById("offline-indicator");
  var timestampDisplay = document.getElementById("timestamp-display");
  var charCounter = document.getElementById("char-counter");
  var scamWarning = document.getElementById("scam-warning");
  var encryptionIndicator = document.getElementById("encryption-indicator");
  
  var actionBar = document.getElementById("action-bar");
  var inlineError = document.getElementById("inline-error");
  var inlineErrorText = document.getElementById("error-text");
  var inlineSuccess = document.getElementById("inline-success");

  var ringSent = false;
  var lastRingTime = 0;
  var supabaseClient = null;
  var qrToken = Utils.getQueryParam("t");
  var resolvedDoor = null;

  I18n.init();

  if (!CONFIG.hasSupabaseConfig || !CONFIG.hasSupabaseConfig()) {
    ringBtn.disabled = true;
    Utils.showToast("System is not configured. Please contact the owner.", "error", 0);
    return;
  }

  supabaseClient = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY || CONFIG.SUPABASE_KEY);

  ringBtn.disabled = true;

  if (CONFIG.FEATURE_FLAGS.encryption && Crypto.isSupported()) {
    encryptionIndicator.style.display = "inline-flex";
  }

  function setInvalidQrState(message) {
    if (inlineErrorText) inlineErrorText.textContent = message || "Missing QR token";
    if (actionBar) actionBar.style.display = "none";
    if (inlineError) inlineError.classList.add("visible");
    ringBtn.disabled = true;
  }

  async function resolveQrToken() {
    if (!qrToken) {
      setInvalidQrState("Missing QR token");
      return;
    }
    try {
      var resolved = await supabaseClient.rpc("resolve_qr_token", { p_qr_token: qrToken });
      if (resolved.error) throw resolved.error;
      var row = null;
      if (Array.isArray(resolved.data)) row = resolved.data[0] || null;
      else row = resolved.data || null;
      if (!row || !row.door_point_id) {
        setInvalidQrState("This QR code is invalid or inactive.");
        return;
      }
      resolvedDoor = row;
      ringBtn.disabled = false;
    } catch (err) {
      console.error("QR resolve failed:", err);
      setInvalidQrState("This QR code is invalid or inactive.");
    }
  }
  resolveQrToken();

  Utils.registerServiceWorker();

  function updateOffline() {
    offlineIndicator.classList.toggle("visible", !navigator.onLine);
  }
  window.addEventListener("online", updateOffline);
  window.addEventListener("offline", updateOffline);
  updateOffline();

  function containsLinks(text) {
    URL_PATTERN.lastIndex = 0;
    return URL_PATTERN.test(text);
  }

  function containsSuspicious(text) {
    for (var i = 0; i < SUSPICIOUS_PATTERNS.length; i++) {
      if (SUSPICIOUS_PATTERNS[i].test(text)) return true;
    }
    return false;
  }

  function sanitizeInput(text) {
    text = text.replace(URL_PATTERN, "[link removed]");
    text = text.replace(/<[^>]*>/g, "");
    return text.trim();
  }

  messageInput.addEventListener("input", function() {
    var val = messageInput.value;
    var len = val.length;

    charCounter.textContent = len + " / " + MSG_MAX_LENGTH;
    charCounter.className = "char-counter";
    if (len > MSG_MAX_LENGTH * 0.9) charCounter.classList.add("error");
    else if (len > MSG_MAX_LENGTH * 0.7) charCounter.classList.add("warning");

    if (containsLinks(val) || containsSuspicious(val)) {
      scamWarning.classList.add("visible");
      messageInput.style.borderColor = "var(--warning)";
    } else {
      scamWarning.classList.remove("visible");
      messageInput.style.borderColor = "";
    }
  });

  ringBtn.addEventListener("click", async function() {
    if (ringSent || !resolvedDoor) return;
    if (!Utils.isOnline()) {
      Utils.showToast(I18n.t("status_offline"), "warning");
      return;
    }

    var now = Date.now();
    if (now - lastRingTime < CONFIG.RATE_LIMIT_WINDOW) {
      Utils.vibrate([100, 50, 100]);
      Utils.showToast(I18n.t("status_rate_limited"), "warning");
      return;
    }

    ringSent = true;
    lastRingTime = now;
    ringBtn.disabled = true;
    
    // UI Feedback: Start Ringing Animation
    var ringContainer = document.getElementById("ring-container");
    if (ringContainer) ringContainer.classList.add("is-ringing");
    const hideLoading = Utils.showLoading(I18n.t("ringing"));


    // Haptic Feedback for Guest
    Utils.vibrate([10, 30, 10]);

    try {
      var messageText = messageInput.value ? messageInput.value.trim() : null;
      var messageEncrypted = false;
      if (messageText) {
        messageText = sanitizeInput(messageText);
        if (CONFIG.FEATURE_FLAGS.encryption && Crypto.isSupported()) {
          try {
            messageText = await Crypto.encryptText(messageText, CONFIG.ENCRYPTION_PASSPHRASE);
            messageEncrypted = true;
          } catch (encErr) {
            console.warn("Message encryption failed, sending sanitized plaintext:", encErr);
          }
        }
      }

      var userAgentHash = null;
      try {
        userAgentHash = await Crypto.hashString((navigator.userAgent || "unknown").slice(0, 512));
      } catch (hashErr) {
        console.warn("Unable to hash user agent fingerprint:", hashErr);
      }



      var insertResult = await supabaseClient.rpc("create_doorbell_ring_by_token", {
        p_qr_token: qrToken,
        p_guest_message: messageText,
        p_guest_message_encrypted: messageEncrypted,
        p_photo_url: null,
        p_photo_encrypted: false,
        p_user_agent_hash: userAgentHash
      });
      if (insertResult.error) throw insertResult.error;
      var ringData = Array.isArray(insertResult.data) ? insertResult.data[0] : insertResult.data;
      if (!ringData || !ringData.id) throw new Error("Failed to create doorbell ring");

      /* ntfy removal — standalone APK uses Supabase Realtime now */
      
      // UI Feedback: Success Chime & Stop Animation
      hideLoading();
      if (ringContainer) ringContainer.classList.remove("is-ringing");
      playGuestChime();
      
      if (actionBar) actionBar.style.display = "none";
      if (inlineSuccess) inlineSuccess.classList.add("visible");
      Utils.vibrate([50, 50, 100]);


      supabaseClient
        .channel("reply_" + ringData.id)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "doorbell_rings",
            filter: "id=eq." + ringData.id
          },
          function(payload) {
            if (payload.new.owner_reply) {
              replyDrawer.style.display = "block";
              replyText.textContent = payload.new.owner_reply;
              Utils.vibrate([100, 50, 100, 50, 100]);
              playResponseChime();
            }
          }
        )
        .subscribe();

      timestampDisplay.textContent = Utils.formatDate(new Date());
    } catch (err) {
      hideLoading();
      if (ringContainer) ringContainer.classList.remove("is-ringing");
      console.error("Ring error:", err);
      setInvalidQrState(err.message || I18n.t("error_generic"));
      ringSent = false;
      resolvedDoor = null;
    }
  });

  // Dropdown Toggle Logic
  var toggleBtn = document.getElementById("message-toggle-btn");
  var drawer = document.getElementById("message-drawer");
  var ringBtnText = document.getElementById("ring-btn-text");

  if (toggleBtn && drawer) {
    toggleBtn.addEventListener("click", function() {
      var isVisible = drawer.classList.contains("visible");
      drawer.classList.toggle("visible", !isVisible);
      toggleBtn.classList.toggle("active", !isVisible);
      toggleBtn.textContent = isVisible ? "＋" : "×";
      
      if (!isVisible) {
        ringBtnText.setAttribute("data-i18n", "send_button");
      } else {
        ringBtnText.setAttribute("data-i18n", "ring_button");
      }
      I18n.apply();
      Utils.vibrate([10]);
    });
  }

  function playGuestChime() {
    try {
      var audio = new Audio("https://assets.mixkit.co/active_storage/sfx/2567/2567-preview.mp3");
      audio.volume = 0.4;
      audio.play().catch(function() {});
    } catch (_e) {}
  }

  function playResponseChime() {
    try {
      var audio = new Audio("https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3");
      audio.volume = 0.5;
      audio.play().catch(function() {});
    } catch (_e) {}
  }

  document.querySelectorAll('[data-action="retry-capture"]').forEach(function(el) {
    el.addEventListener("click", function() {
      if (inlineError) inlineError.classList.remove("visible");
      if (actionBar) actionBar.style.display = "flex";
      ringSent = false;
      resolvedDoor = null;
      ringBtn.disabled = true;
      resolveQrToken();
    });
  });

  // Instruction Modal Logic
  var infoTrigger = document.getElementById("info-modal-trigger");
  var infoModal = document.getElementById("instruction-modal");
  var closeModalBtn = document.getElementById("close-modal-btn");

  if (infoTrigger && infoModal) {
    infoTrigger.addEventListener("click", function() {
      infoModal.classList.add("visible");
      Utils.vibrate([20]);
    });
  }

  if (closeModalBtn && infoModal) {
    closeModalBtn.addEventListener("click", function() {
      infoModal.classList.remove("visible");
    });
    infoModal.addEventListener("click", function(e) {
      if (e.target === infoModal) infoModal.classList.remove("visible");
    });
  }

  setInterval(function() {
    if (timestampDisplay.textContent) {
      timestampDisplay.textContent = Utils.formatDate(new Date());
    }
  }, 60000);

})();
