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
  var replyTime = document.getElementById("reply-timestamp");
  var locationName = document.getElementById("location-name");
  var offlineIndicator = document.getElementById("offline-indicator");
  var timestampDisplay = document.getElementById("timestamp-display");
  var charCounter = document.getElementById("char-counter");
  var encryptionIndicator = document.getElementById("encryption-indicator");
  
  var actionBar = document.getElementById("action-bar");
  var inlineError = document.getElementById("inline-error");
  var inlineErrorText = document.getElementById("error-text");
  var inlineSuccess = document.getElementById("inline-success");
  var ringContainer = document.getElementById("ring-container");
  var ringBtnText = document.getElementById("ring-btn-text");

  var ringSent = false;
  var supabaseClient = null;
  var qrToken = Utils.getQueryParam("t");
  var resolvedDoor = null;
  var ringResetTimer = null;
  var replyPollTimer = null;
  var replyPollCount = 0;
  var RING_ACTIVE_MS = 15000;
  var REPLY_POLL_INTERVAL_MS = 2000;
  var REPLY_POLL_MAX = 300;
  var encryptionReady = !!(
    CONFIG.FEATURE_FLAGS &&
    CONFIG.FEATURE_FLAGS.encryption &&
    Crypto.isSupported() &&
    CONFIG.ENCRYPTION_PASSPHRASE &&
    !/^REPLACE_WITH_/i.test(String(CONFIG.ENCRYPTION_PASSPHRASE).trim())
  );

  I18n.init();

   if (!CONFIG.hasSupabaseConfig || typeof CONFIG.hasSupabaseConfig !== 'function' || !CONFIG.hasSupabaseConfig()) {
     ringBtn.disabled = true;
     Utils.showToast("System is not configured. Please contact the owner.", "error", 0);
     return;
   }

  supabaseClient = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY || CONFIG.SUPABASE_KEY);

  ringBtn.disabled = true;

  if (encryptionReady) {
    encryptionIndicator.style.display = "inline-flex";
  }

  function setInvalidQrState(message) {
    if (inlineErrorText) inlineErrorText.textContent = message || "Missing QR token";
    if (actionBar) actionBar.style.display = "none";
    if (inlineError) inlineError.classList.add("visible");
    ringBtn.disabled = true;
  }

  function resetRingUiState() {
    if (ringResetTimer) {
      clearTimeout(ringResetTimer);
      ringResetTimer = null;
    }
    ringSent = false;
    if (ringContainer) ringContainer.classList.remove("is-ringing");
    if (ringBtnText) {
      ringBtnText.setAttribute("data-i18n", "ring_button");
      I18n.apply();
    }
    if (resolvedDoor && actionBar && actionBar.style.display !== "none") {
      ringBtn.disabled = false;
    }
  }

  function beginRingUiState() {
    ringSent = true;
    ringBtn.disabled = true;
    if (ringContainer) ringContainer.classList.add("is-ringing");
    if (ringBtnText) {
      ringBtnText.setAttribute("data-i18n", "ring_button_sending");
      I18n.apply();
    }
    if (inlineSuccess) inlineSuccess.classList.remove("visible");
  }

  function scheduleRingUiReset() {
    if (ringResetTimer) clearTimeout(ringResetTimer);
    ringResetTimer = setTimeout(function() {
      resetRingUiState();
    }, RING_ACTIVE_MS);
  }

  function stopReplyWatcher() {
    if (replyPollTimer) {
      clearInterval(replyPollTimer);
      replyPollTimer = null;
    }
    replyPollCount = 0;
  }

  function showOwnerReply(reply) {
    if (!reply) return;
    replyDrawer.classList.add("visible");
    replyText.textContent = reply;
    if (replyTime) {
      replyTime.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    Utils.vibrate([100, 50, 100, 50, 100]);
    playResponseChime();
  }

  async function pollReplyByToken(ringId) {
    if (!ringId || !qrToken) return { terminal: false };
    var replyResult = await supabaseClient.rpc("get_guest_ring_reply_by_token", {
      p_ring_id: ringId,
      p_qr_token: qrToken
    });
    if (replyResult.error) {
      if (replyResult.error.code !== "PGRST301") {
        console.warn("Reply polling error:", replyResult.error);
      }
      return { terminal: false };
    }
    var row = Array.isArray(replyResult.data) ? replyResult.data[0] : replyResult.data;
    if (row && row.owner_reply && String(row.owner_reply).trim() !== "") {
      showOwnerReply(String(row.owner_reply).trim());
      return { terminal: true };
    }
    if (row && row.status) {
      var status = String(row.status).toLowerCase();
      if (status === "dismissed" || status === "acknowledged" || status === "responded") {
        return { terminal: true };
      }
    }
    return { terminal: false };
  }

  function startReplyWatcher(ringId) {
    stopReplyWatcher();
    pollReplyByToken(ringId).then(function(result) {
      if (result && result.terminal) {
        stopReplyWatcher();
        resetRingUiState();
      }
    }).catch(function(err) {
      console.warn("Initial reply poll failed:", err);
    });

    replyPollTimer = setInterval(function() {
      replyPollCount += 1;
      if (replyPollCount > REPLY_POLL_MAX) {
        stopReplyWatcher();
        return;
      }
      pollReplyByToken(ringId)
        .then(function(result) {
          if (result && result.terminal) {
            stopReplyWatcher();
            resetRingUiState();
          }
        })
        .catch(function(err) {
          console.warn("Reply poll tick failed:", err);
        });
    }, REPLY_POLL_INTERVAL_MS);
  }

   async function resolveQrToken() {
     if (!qrToken) {
       setInvalidQrState("Missing QR token");
       return;
     }
     try {
       var resolved = await supabaseClient.rpc("resolve_qr_token", { p_qr_token: qrToken });
       if (resolved.error) throw resolved.error;
       
       // Validate response structure
       if (!resolved.data) {
         throw new Error("No data returned from resolve_qr_token");
       }
       
       var row = null;
       if (Array.isArray(resolved.data)) {
         if (resolved.data.length === 0) {
           throw new Error("Empty data array returned from resolve_qr_token");
         }
         row = resolved.data[0] || null;
       } else {
         row = resolved.data || null;
       }
       
       if (!row) {
         throw new Error("Invalid data structure returned from resolve_qr_token");
       }
       
       if (!row.door_point_id) {
         setInvalidQrState("This QR code is invalid or inactive.");
         return;
       }
       resolvedDoor = row;
       if (locationName && resolvedDoor.door_location) {
         locationName.textContent = resolvedDoor.door_location;
       }
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
     // Remove HTML tags
     text = text.replace(/<[^>]*>/g, "");
     
     // Remove/escape potential XSS vectors
     text = text.replace(/javascript:/gi, "");
     text = text.replace(/data:/gi, "");
     text = text.replace(/vbscript:/gi, "");
     text = text.replace(/on\w+\s*=/gi, "");
     
     // Remove URLs as per security policy
     text = text.replace(URL_PATTERN, "[link removed]");
     
     // Remove suspicious patterns
     for (var i = 0; i < SUSPICIOUS_PATTERNS.length; i++) {
       text = text.replace(SUSPICIOUS_PATTERNS[i], "");
     }
     
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
      messageInput.style.borderColor = "var(--error)";
    } else {
      messageInput.style.borderColor = "";
    }
  });

  ringBtn.addEventListener("click", async function() {
    if (ringSent || !resolvedDoor) return;
    if (!Utils.isOnline()) {
      Utils.showToast(I18n.t("status_offline"), "warning");
      return;
    }
    beginRingUiState();
    const hideLoading = Utils.showLoading(I18n.t("ringing"));


    // Haptic Feedback for Guest
    Utils.vibrate([10, 30, 10]);

    try {
      var messageText = messageInput.value ? messageInput.value.trim() : null;
      var messageEncrypted = false;
      if (messageText) {
        messageText = sanitizeInput(messageText);
        if (encryptionReady) {
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
         p_user_agent_hash: userAgentHash
       });
       if (insertResult.error) throw insertResult.error;
       
       // Validate response structure
       if (!insertResult.data) {
         throw new Error("No data returned from create_doorbell_ring_by_token");
       }
       
       var ringData = Array.isArray(insertResult.data) ? insertResult.data[0] : insertResult.data;
       if (!ringData) {
         throw new Error("Invalid data structure returned from create_doorbell_ring_by_token");
       }
       
       if (!ringData.id) {
         throw new Error("Failed to create doorbell ring - no ID returned");
       }

      
      // UI Feedback: Success
      hideLoading();
      playGuestChime();

      if (inlineSuccess) {
        inlineSuccess.classList.add("visible");
        setTimeout(function() {
          inlineSuccess.classList.remove("visible");
        }, 3000);
      }

      Utils.showToast(I18n.t("ring_button_sent"), "success", 3500, { position: "top-left" });
      Utils.vibrate([50, 50, 100]);
      scheduleRingUiReset();

      var liveRepliesEnabled = !!(CONFIG.FEATURE_FLAGS && CONFIG.FEATURE_FLAGS.guestLiveReplies);
      if (liveRepliesEnabled) {
        startReplyWatcher(ringData.id);
      }

      timestampDisplay.textContent = Utils.formatDate(new Date());
     } catch (err) {
       hideLoading();
       resetRingUiState();
       console.error("Ring error:", err);
       Utils.showToast(err.message || I18n.t("error_generic"), "error");
      }
  });

  // Dropdown Toggle Logic
  var toggleBtn = document.getElementById("message-toggle-btn");
  var drawer = document.getElementById("message-drawer");

  if (toggleBtn && drawer) {
    toggleBtn.addEventListener("click", function() {
      var isVisible = drawer.classList.contains("visible");
      drawer.classList.toggle("visible", !isVisible);
      toggleBtn.classList.toggle("active", !isVisible);
      toggleBtn.textContent = isVisible ? "+" : "x";
      
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
      stopReplyWatcher();
      resetRingUiState();
      if (inlineError) inlineError.classList.remove("visible");
      if (actionBar) actionBar.style.display = "flex";
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

  window.addEventListener("beforeunload", function() {
    stopReplyWatcher();
    resetRingUiState();
  });

  setInterval(function() {
    if (timestampDisplay.textContent) {
      timestampDisplay.textContent = Utils.formatDate(new Date());
    }
  }, 60000);

})();
