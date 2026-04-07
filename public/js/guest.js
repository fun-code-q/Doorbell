(function() {
  "use strict";

  var MSG_MAX_LENGTH = 500;
  
  // Element Selectors (Updated for Professional UI)
  var ringBtn = document.getElementById("ring-btn");
  var messageInput = document.getElementById("message");
  var replyPanel = document.getElementById("reply-panel");
  var replyBtn = document.getElementById("reply-btn");
  var locationName = document.getElementById("location-name");
  var offlineIndicator = document.getElementById("offline-indicator");
  var timestampDisplay = document.getElementById("timestamp-view");

  var charCounter = document.getElementById("char-counter");
  
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
  var qrToken = Utils.getQueryParam("t");
  var activeRingStorageKey = qrToken ? "active_ring_id::" + qrToken : null;
  var msgIconHtml = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="msg-svg"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';

  // Remove legacy token-agnostic key so threads cannot bleed across door tokens.
  if (window.sessionStorage.getItem("active_ring_id")) {
    window.sessionStorage.removeItem("active_ring_id");
  }
  var currentRingId = activeRingStorageKey ? window.sessionStorage.getItem(activeRingStorageKey) : null;
  var supabaseClient = null;
  var resolvedDoor = null;
  var ringResetTimer = null;
  var replySubscription = null;
  var replyPollTimer = null;
  var REPLY_POLL_MS = 2000;


  I18n.init();



  var modalCloseReply = document.getElementById("modal-close-reply");
  if (modalCloseReply) {
    modalCloseReply.addEventListener("click", function() {
      replyPanel.classList.remove("visible");
    });
  }

  // UI-only listeners (Attach before config check to keep UI interactive)

  if (messageInput) {
    messageInput.addEventListener("input", function() {
      var len = messageInput.value.length;
      charCounter.textContent = len + " / " + MSG_MAX_LENGTH;
      charCounter.classList.toggle("error", len > MSG_MAX_LENGTH * 0.9);
    });
  }

  if (messageToggle && messageDrawer) {
    messageToggle.addEventListener("click", function() {
      var currentlyVisible = messageDrawer.classList.contains("visible");
      setInputAreaVisible(!currentlyVisible);
      Utils.vibrate([10]);
    });

    if (replyBtn) {
      replyBtn.addEventListener("click", function() {
        if (replyPanel) replyPanel.classList.remove("visible");
        setInputAreaVisible(true);
        if (messageInput) {
          messageInput.value = "";
          setTimeout(function() { messageInput.focus(); }, 300);
        }
        Utils.vibrate([20, 10]);
      });
    }
  }

  if (infoTrigger && secureModal) {
    infoTrigger.addEventListener("click", () => secureModal.classList.add("visible"));
  }
  if (modalClose) {
    modalClose.addEventListener("click", () => secureModal.classList.remove("visible"));
  }

  if (!CONFIG.hasSupabaseConfig || !CONFIG.hasSupabaseConfig()) {
    if (ringBtn) ringBtn.disabled = true;
    Utils.showToast("System Not Configured", "error", 0);
    return;
  }


  supabaseClient = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY || CONFIG.SUPABASE_KEY);

  ringBtn.disabled = true;

  function setInvalidState(msg) {
    if (errorTextEl) errorTextEl.textContent = msg || "Invalid Token";
    if (actionBar) actionBar.style.display = "none";
    if (statusError) statusError.classList.add("visible");
    ringBtn.disabled = true;
    stopReplyWatchers();
    clearActiveRingSession();
  }

  function resetUi() {
    if (ringResetTimer) { clearTimeout(ringResetTimer); ringResetTimer = null; }
    if (ringContainer) ringContainer.classList.remove("is-ringing");
    if (ringBtnText) {
      ringBtnText.setAttribute("data-i18n", "ring_button");
      I18n.apply();
    }
    if (resolvedDoor && actionBar && actionBar.style.display !== "none") {
      ringBtn.disabled = false;
    }
  }

  function rememberActiveRingSession(ringId) {
    if (!activeRingStorageKey || !ringId) return;
    currentRingId = ringId;
    window.sessionStorage.setItem(activeRingStorageKey, ringId);
  }

  function clearActiveRingSession() {
    currentRingId = null;
    if (activeRingStorageKey) {
      window.sessionStorage.removeItem(activeRingStorageKey);
    }
  }

  function startRinging() {
    ringBtn.disabled = true;
    if (ringContainer) ringContainer.classList.add("is-ringing");
    if (ringBtnText) {
      ringBtnText.setAttribute("data-i18n", "ring_button_sending");
      I18n.apply();
    }
    if (statusSuccess) statusSuccess.classList.remove("visible");
  }

  function setInputAreaVisible(show) {
    if (!messageDrawer || !messageToggle) return;
    messageDrawer.classList.toggle("visible", show);
    messageToggle.classList.toggle("active", show);
    if (show) {
      messageToggle.textContent = "X";
      if (ringBtnText) ringBtnText.setAttribute("data-i18n", currentRingId ? "send" : "send_button");
    } else {
      messageToggle.innerHTML = msgIconHtml;
      if (ringBtnText) ringBtnText.setAttribute("data-i18n", "ring_button");
    }
    I18n.apply();
  }

  function showReply(reply, history) {
    if (!history || !history.length) return;
    
    // The history exists, so we ensure the top panel is active
    if (replyPanel) replyPanel.classList.add("visible");

    // Render chat thread inside the panel
    renderChatThread(history);

    Utils.vibrate([100, 50, 100]);
    if (reply) playResponseChime();
  }


  function renderChatThread(history) {
    var chatMessages = document.getElementById("chat-messages");
    if (!chatMessages) return;

    chatMessages.innerHTML = "";


    history.forEach(function(msg) {
      var bubble = document.createElement("div");
      bubble.className = "chat-bubble " + (msg.role === "guest" ? "chat-bubble-guest" : "chat-bubble-owner");
      
      var text = document.createElement("div");
      text.textContent = msg.text;
      bubble.appendChild(text);

      if (msg.time) {
        var time = document.createElement("span");
        time.className = "chat-time";
        time.textContent = new Date(msg.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        bubble.appendChild(time);
      }

      chatMessages.appendChild(bubble);
    });

    // Auto scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function stopReplySubscription() {
    if (replySubscription) {
      supabaseClient.removeChannel(replySubscription);
      replySubscription = null;
    }
  }

  function stopReplyPolling() {
    if (replyPollTimer) {
      clearInterval(replyPollTimer);
      replyPollTimer = null;
    }
  }

  function stopReplyWatchers() {
    stopReplySubscription();
    stopReplyPolling();
  }

  async function pollRingReplyOnce(ringId) {
    if (!ringId || !qrToken) return;
    try {
      var res = await supabaseClient.rpc("get_guest_ring_reply_by_token", {
        p_ring_id: ringId,
        p_qr_token: qrToken
      });
      if (res.error) throw res.error;

      var row = Array.isArray(res.data) ? res.data[0] : res.data;
      if (!row) return;

      if (row.owner_reply && String(row.owner_reply).trim() !== "") {
        showReply(String(row.owner_reply).trim(), row.chat_history);
      } else if (row.chat_history && row.chat_history.length > 0) {
        showReply(null, row.chat_history);
      }


      if (row.status === "dismissed" || row.status === "responded") {
        stopReplyWatchers();
        clearActiveRingSession();
        resetUi();
      }
    } catch (err) {
      // Keep polling quietly; occasional network hiccups should not break UX.
    }
  }

  function startReplyPolling(ringId) {
    stopReplyPolling();
    pollRingReplyOnce(ringId);
    replyPollTimer = setInterval(function() {
      pollRingReplyOnce(ringId);
    }, REPLY_POLL_MS);
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
        if (row) {
          showReply(row.owner_reply, row.chat_history);
          if (row.status === 'dismissed' || row.status === 'responded') {
            stopReplyWatchers();
            clearActiveRingSession();
            resetUi();
          }
        }

      })
      .subscribe(function(status) {
        if (status === "SUBSCRIBED") {
          console.log("Guest: Realtime subscription active.");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          // Realtime can be blocked for anon clients; polling keeps live replies reliable.
          console.warn("Guest: Realtime failed, falling back to polling.");
          startReplyPolling(ringId);
        }
      });
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
      if (currentRingId) {
        startReplySubscription(currentRingId);
        startReplyPolling(currentRingId);
      }
    } catch (err) {
      console.error(err);
      setInvalidState("System Unavailable");
    }
  }
  resolve();

  function updateOffline() {
    if (offlineIndicator) offlineIndicator.classList.toggle("visible", !navigator.onLine);
  }
  window.addEventListener("online", updateOffline);
  window.addEventListener("offline", updateOffline);
  updateOffline();



  function playGuestChime() { try { new Audio("https://assets.mixkit.co/active_storage/sfx/2567/2567-preview.mp3").play(); } catch (e) {} }
  function playResponseChime() { try { new Audio("https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3").play(); } catch (e) {} }

  if (ringBtn) {
    ringBtn.addEventListener("click", async function() {
      if (!resolvedDoor) return;
      if (!navigator.onLine) { Utils.showToast("Offline", "error"); return; }
      
      const msg = messageInput ? messageInput.value.trim() : null;
      const hideLoading = Utils.showLoading(currentRingId ? I18n.t("loading") : I18n.t("status_transmitting"));
      Utils.vibrate([20, 40, 20]);

      try {
        var res;
        if (currentRingId) {
          // APPEND to existing conversation
          res = await supabaseClient.rpc("append_ring_message", {
            p_ring_id: currentRingId,
            p_role: "guest",
            p_message: msg || "Follow-up signal",
            p_qr_token: qrToken
          });
        } else {
          // CREATE new ring
          startRinging();
          res = await supabaseClient.rpc("create_doorbell_ring_by_token", {
            p_qr_token: qrToken,
            p_guest_message: msg,
            p_guest_message_encrypted: false,
            p_user_agent_hash: Utils.getBrowserHash()
          });
        }

        if (res.error) throw res.error;
        var ring = Array.isArray(res.data) ? res.data[0] : res.data;
        
        hideLoading();
        playGuestChime();
        
        if (!currentRingId && ring && ring.id) {
          rememberActiveRingSession(ring.id);
          startReplySubscription(currentRingId);
          startReplyPolling(currentRingId);
        }

        if (statusSuccess) {
          statusSuccess.classList.add("visible");
          setTimeout(() => statusSuccess.classList.remove("visible"), 3000);
        }
        
        Utils.vibrate([50, 100]);
        if (messageInput) messageInput.value = "";
        if (typeof setInputAreaVisible === "function") setInputAreaVisible(false);

        if (timestampDisplay) timestampDisplay.textContent = new Date().toLocaleTimeString();
        if (timestampDisplay) timestampDisplay.style.display = "block";
        if (currentRingId) {
          // Refresh chat thread immediately after guest sends
          pollRingReplyOnce(currentRingId);
        }
      } catch (err) {
        console.error("Signal error:", err);
        hideLoading();
        var errMsg = (err && err.message ? String(err.message) : "").toLowerCase();
        if (currentRingId && (errMsg.indexOf("ring not found") !== -1 || errMsg.indexOf("token mismatch") !== -1 || errMsg.indexOf("access denied") !== -1)) {
          clearActiveRingSession();
          stopReplyWatchers();
        }
        if (!currentRingId) resetUi();
        Utils.showToast("Transmission Failed", "error");
      }
    });

  }

  document.querySelectorAll('[data-action="retry-capture"]').forEach(el => {
    el.addEventListener("click", () => {
      stopReplyWatchers();
      clearActiveRingSession();
      setInputAreaVisible(false);
      resetUi();
      statusError.classList.remove("visible");
      actionBar.style.display = "flex";
      resolve();
    });
  });

  window.addEventListener("beforeunload", stopReplyWatchers);
})();

