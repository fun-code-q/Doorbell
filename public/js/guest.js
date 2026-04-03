(function() {
  "use strict";

  var MSG_MAX_LENGTH = 500;
  
  // Element Selectors (Updated for Professional UI)
  var ringBtn = document.getElementById("ring-btn");
  var messageInput = document.getElementById("message");
  var replyPanel = document.getElementById("reply-panel");
  var replyText = document.getElementById("reply-text");
  var replyTime = document.getElementById("reply-timestamp");
  var locationName = document.getElementById("location-name");
  var offlineIndicator = document.getElementById("offline-indicator");
  var timestampDisplay = document.getElementById("timestamp-view");
  var charCounter = document.getElementById("char-counter");
  var encryptionIndicator = document.getElementById("encryption-indicator");
  
  var actionBar = document.getElementById("action-bar");
  var statusError = document.getElementById("status-error");
  var errorTextEl = document.getElementById("error-text");
  var statusSuccess = document.getElementById("status-success");
  var ringContainer = document.getElementById("ring-container");
  var ringBtnText = document.getElementById("ring-btn-text");
  
  var messageToggle = document.getElementById("message-toggle");
  var messageDrawer = document.getElementById("message-drawer");
  var infoTrigger = document.getElementById("info-trigger");
  var secureModal = document.getElementById("secure-modal");
  var modalClose = document.getElementById("modal-close");

  var ringSent = false;
  var supabaseClient = null;
  var qrToken = Utils.getQueryParam("t");
  var resolvedDoor = null;
  var ringResetTimer = null;
  var replySubscription = null;
  var RING_ACTIVE_MS = 15000;

  I18n.init();

  if (!CONFIG.hasSupabaseConfig || !CONFIG.hasSupabaseConfig()) {
    ringBtn.disabled = true;
    Utils.showToast("System Not Configured", "error", 0);
    return;
  }

  supabaseClient = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY || CONFIG.SUPABASE_KEY);

  ringBtn.disabled = true;

  var encryptionReady = !!(
    CONFIG.FEATURE_FLAGS &&
    CONFIG.FEATURE_FLAGS.encryption &&
    Crypto.isSupported() &&
    CONFIG.ENCRYPTION_PASSPHRASE &&
    !/^REPLACE_WITH_/i.test(String(CONFIG.ENCRYPTION_PASSPHRASE).trim())
  );

  if (encryptionReady) {
    encryptionIndicator.style.display = "inline-flex";
  }

  function setInvalidState(msg) {
    if (errorTextEl) errorTextEl.textContent = msg || "Invalid Token";
    if (actionBar) actionBar.style.display = "none";
    if (statusError) statusError.classList.add("visible");
    ringBtn.disabled = true;
  }

  function resetUi() {
    if (ringResetTimer) { clearTimeout(ringResetTimer); ringResetTimer = null; }
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

  function startRinging() {
    ringSent = true;
    ringBtn.disabled = true;
    if (ringContainer) ringContainer.classList.add("is-ringing");
    if (ringBtnText) {
      ringBtnText.setAttribute("data-i18n", "ring_button_sending");
      I18n.apply();
    }
    if (statusSuccess) statusSuccess.classList.remove("visible");
  }

  function showReply(reply) {
    if (!reply) return;
    replyPanel.classList.add("visible");
    replyText.textContent = reply;
    if (replyTime) {
      replyTime.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    Utils.vibrate([100, 50, 100]);
    playResponseChime();
  }

  function stopReplySubscription() {
    if (replySubscription) {
      supabaseClient.removeChannel(replySubscription);
      replySubscription = null;
    }
  }

  function startReplySubscription(ringId) {
    stopReplySubscription();
    
    // Subscribe to specific ring changes
    replySubscription = supabaseClient
      .channel('public:doorbell_rings:id=eq.' + ringId)
      .on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'doorbell_rings', 
        filter: 'id=eq.' + ringId 
      }, function(payload) {
        var row = payload.new;
        if (row && row.owner_reply && String(row.owner_reply).trim() !== "") {
          showReply(String(row.owner_reply).trim());
          stopReplySubscription();
          resetUi();
        } else if (row && (row.status === 'dismissed' || row.status === 'responded')) {
          stopReplySubscription();
          resetUi();
        }
      })
      .subscribe();
  }

  async function resolve() {
    if (!qrToken) { setInvalidState("Token Missing"); return; }
    try {
      var res = await supabaseClient.rpc("resolve_qr_token", { p_qr_token: qrToken });
      if (res.error) throw res.error;
      var data = Array.isArray(res.data) ? res.data[0] : res.data;
      if (!data || !data.door_point_id) { setInvalidState("Invalid Point"); return; }
      resolvedDoor = data;
      if (locationName && data.door_name) { locationName.textContent = data.door_name; }
      ringBtn.disabled = false;
    } catch (err) {
      console.error(err);
      setInvalidState("System Unavailable");
    }
  }
  resolve();

  function updateOffline() {
    offlineIndicator.classList.toggle("visible", !navigator.onLine);
    var connectionDot = document.getElementById("status-dot");
    if (connectionDot) connectionDot.classList.toggle("online", navigator.onLine);
  }
  window.addEventListener("online", updateOffline);
  window.addEventListener("offline", updateOffline);
  updateOffline();

  messageInput.addEventListener("input", function() {
    var len = messageInput.value.length;
    charCounter.textContent = len + " / " + MSG_MAX_LENGTH;
    charCounter.classList.toggle("error", len > MSG_MAX_LENGTH * 0.9);
  });

  ringBtn.addEventListener("click", async function() {
    if (ringSent || !resolvedDoor) return;
    if (!navigator.onLine) { Utils.showToast("Offline", "error"); return; }
    
    startRinging();
    const hideLoading = Utils.showLoading(I18n.t("status_transmitting"));
    Utils.vibrate([20, 40, 20]);

    try {
      var msg = messageInput.value ? messageInput.value.trim() : null;
      var encrypted = false;
      if (msg && encryptionReady) {
        try {
          msg = await Crypto.encryptText(msg, CONFIG.ENCRYPTION_PASSPHRASE);
          encrypted = true;
        } catch (e) { console.warn("Encryption failed", e); }
      }

      var hash = null;
      try { hash = await Crypto.hashString(navigator.userAgent || "anon"); } catch (e) {}

      var res = await supabaseClient.rpc("create_doorbell_ring_by_token", {
        p_qr_token: qrToken,
        p_guest_message: msg,
        p_guest_message_encrypted: encrypted,
        p_user_agent_hash: hash
      });
      if (res.error) throw res.error;
      var ring = Array.isArray(res.data) ? res.data[0] : res.data;
      
      hideLoading();
      playGuestChime();
      if (statusSuccess) {
        statusSuccess.classList.add("visible");
        setTimeout(() => statusSuccess.classList.remove("visible"), 3000);
      }
      
      Utils.vibrate([50, 100]);
      ringResetTimer = setTimeout(resetUi, RING_ACTIVE_MS);
      
      var liveReplies = !!(CONFIG.FEATURE_FLAGS && CONFIG.FEATURE_FLAGS.guestLiveReplies);
      if (liveReplies) startReplySubscription(ring.id);
      
      if (timestampDisplay) timestampDisplay.textContent = new Date().toLocaleTimeString();
    } catch (err) {
      hideLoading();
      resetUi();
      Utils.showToast("Transmission Failed", "error");
    }
  });

  if (messageToggle && messageDrawer) {
    messageToggle.addEventListener("click", function() {
      var visible = messageDrawer.classList.toggle("visible");
      messageToggle.classList.toggle("active", visible);
      messageToggle.textContent = visible ? "×" : "+";
      ringBtnText.setAttribute("data-i18n", visible ? "send_button" : "ring_button");
      I18n.apply();
      Utils.vibrate([10]);
    });
  }

  if (infoTrigger && secureModal) {
    infoTrigger.addEventListener("click", () => secureModal.classList.add("visible"));
  }
  if (modalClose) {
    modalClose.addEventListener("click", () => secureModal.classList.remove("visible"));
  }

  function playGuestChime() { try { new Audio("https://assets.mixkit.co/active_storage/sfx/2567/2567-preview.mp3").play(); } catch (e) {} }
  function playResponseChime() { try { new Audio("https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3").play(); } catch (e) {} }

  document.querySelectorAll('[data-action="retry-capture"]').forEach(el => {
    el.addEventListener("click", () => {
      stopReplySubscription();
      resetUi();
      statusError.classList.remove("visible");
      actionBar.style.display = "flex";
      resolve();
    });
  });

  window.addEventListener("beforeunload", stopReplySubscription);
})();

