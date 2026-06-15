/* global supabase, CONFIG, I18n, Utils, Crypto, turnstile */
/* eslint no-var:0 */

/**
 * Guest-side controller for the QR Doorbell PWA.
 *
 * What changed in v3:
 *   * Rings go through the verify-ring Edge Function. Turnstile + origin
 *     allow-list + server-side rate limit + geofence all live server-side.
 *   * Messages can be end-to-end encrypted with libsodium crypto_box_seal
 *     to the owner's published Curve25519 public key. Plaintext is the
 *     fallback for doors without a published key.
 *   * Per-ring guest_secret persists in sessionStorage so follow-up chat
 *     messages can't be appended by a stranger who scraped the qr_token.
 *   * Reads use get_guest_ring_reply_by_secret(p_ring_id, p_guest_secret)
 *     and Realtime is disabled for anon (server-side RLS forbids it).
 */
(function () {
  "use strict";

  // ---- DOM ---------------------------------------------------------------
  var ringBtn         = document.getElementById("ring-btn");
  var messageInput    = document.getElementById("message");
  var replyPanel      = document.getElementById("reply-panel");
  var replyBtn        = document.getElementById("reply-btn");
  var locationName    = document.getElementById("location-name");
  var offlineIndicator = document.getElementById("offline-indicator");
  var timestampDisplay = document.getElementById("timestamp-view");
  var charCounter     = document.getElementById("char-counter");
  var actionBar       = document.getElementById("action-bar");
  var statusError     = document.getElementById("status-error");
  var errorTextEl     = document.getElementById("error-text");
  var statusSuccess   = document.getElementById("status-success");
  var ringContainer   = document.getElementById("ring-container");
  var ringBtnText     = document.getElementById("ring-btn-text");
  var messageToggle   = document.getElementById("message-toggle");
  var messageDrawer   = document.getElementById("message-drawer");
  var infoTrigger     = document.getElementById("info-trigger");
  var secureModal     = document.getElementById("secure-modal");
  var modalClose      = document.getElementById("modal-close");
  var modalCloseReply = document.getElementById("modal-close-reply");

  var MSG_MAX_LENGTH = 500;
  var REPLY_POLL_MS  = 2500;

  var qrToken = Utils.getQueryParam("t");
  var ringStorageKey = qrToken ? "qrdb_ring::" + qrToken : null;

  // Tear down legacy/token-agnostic state so threads don't bleed across doors.
  if (window.sessionStorage.getItem("active_ring_id")) {
    window.sessionStorage.removeItem("active_ring_id");
  }

  // State -----------------------------------------------------------------
  var supabaseClient = null;
  var resolvedDoor   = null;        // { door_point_id, door_name, house_id, latitude, longitude, geofence_radius_m, owner_public_keys, encryption_algorithm }
  var currentRing    = restoreSession();  // { id, secret }
  var replyPollTimer = null;
  var turnstileId    = null;
  // Visitor-token cookie persists across rings via localStorage. Per-door.
  var visitorTokenStorageKey = qrToken ? "qrdb_visitor::" + qrToken : null;
  // Optional image attachment selected by the user (base64 + mime + bytes).
  var pendingAttachment = null;

  I18n.init();
  attachStaticListeners();

  if (!CONFIG.hasSupabaseConfig() || !CONFIG.hasVerifyEndpoint()) {
    Utils.showToast("System Not Configured", "error", 0);
    if (ringBtn) ringBtn.disabled = true;
    return;
  }

  supabaseClient = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  if (ringBtn) ringBtn.disabled = true;

  resolveTokenAndBootstrap();
  bindOnlineHandlers();

  // ---- Session helpers ---------------------------------------------------
  function restoreSession() {
    if (!ringStorageKey) return null;
    try {
      var raw = window.sessionStorage.getItem(ringStorageKey);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }
  function saveSession(ring) {
    if (!ringStorageKey || !ring || !ring.id || !ring.secret) return;
    window.sessionStorage.setItem(
      ringStorageKey,
      JSON.stringify({ id: ring.id, secret: ring.secret })
    );
  }
  function clearSession() {
    currentRing = null;
    if (ringStorageKey) window.sessionStorage.removeItem(ringStorageKey);
  }

  // ---- Voice-message recording (Batch P #5) ------------------------------
  // We record up to 15 seconds of microphone audio, encode as webm/opus
  // (the browser's native container), and reuse the same pendingAttachment
  // slot as the photo path. Server whitelists audio/webm.
  var REC_MAX_MS = 15_000;
  var mediaRecorder = null;
  var recordedChunks = [];
  function bindVoiceRecorder() {
    var btn   = document.getElementById("record-voice");
    var label = document.getElementById("record-label");
    if (!btn || !label) return;

    btn.addEventListener("click", async function () {
      if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        return;
      }
      if (typeof window.MediaRecorder === "undefined" || !navigator.mediaDevices) {
        Utils.showToast("Voice recording not supported on this browser", "error");
        return;
      }
      try {
        var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recordedChunks = [];
        mediaRecorder = new window.MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
        mediaRecorder.ondataavailable = function (e) {
          if (e.data && e.data.size > 0) recordedChunks.push(e.data);
        };
        mediaRecorder.onstop = function () {
          stream.getTracks().forEach(function (t) { t.stop(); });
          var blob = new Blob(recordedChunks, { type: "audio/webm" });
          if (blob.size > ATTACH_MAX_BYTES) {
            Utils.showToast("Recording too long (over 5 MB)", "error");
            label.textContent = "🎤 Record voice (optional)";
            return;
          }
          var reader = new FileReader();
          reader.onload = function () {
            var base64 = String(reader.result).split(",")[1] || "";
            pendingAttachment = {
              base64: base64,
              mime:   "audio/webm",
              size:   blob.size,
            };
            label.textContent = "🎤 Voice recorded (" + Math.round(blob.size / 1024) + " KB) ✓";
          };
          reader.readAsDataURL(blob);
        };
        mediaRecorder.start();
        label.textContent = "● Recording… (tap to stop, max 15s)";
        setTimeout(function () {
          if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
        }, REC_MAX_MS);
      } catch (e) {
        Utils.showToast("Microphone permission denied", "error");
      }
    });
  }

  // ---- Attachment handling -----------------------------------------------
  var ATTACH_MAX_BYTES = 5 * 1024 * 1024;
  function attachListener() {
    var input = document.getElementById("attach-input");
    var label = document.getElementById("attach-label");
    if (!input || !label) return;
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (!file) { pendingAttachment = null; label.textContent = "Attach photo (optional)"; return; }
      if (file.size > ATTACH_MAX_BYTES) {
        Utils.showToast("Photo too large (max 5 MB)", "error");
        input.value = "";
        return;
      }
      if (["image/jpeg","image/png","image/webp"].indexOf(file.type) === -1) {
        Utils.showToast("Unsupported photo format", "error");
        input.value = "";
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var dataUrl = reader.result;
        var base64 = String(dataUrl).split(",")[1] || "";
        pendingAttachment = { base64: base64, mime: file.type, size: file.size };
        label.textContent = file.name + " ✓";
      };
      reader.onerror = function () {
        Utils.showToast("Could not read photo", "error");
        pendingAttachment = null;
      };
      reader.readAsDataURL(file);
    });
  }

  // ---- Static UI listeners ----------------------------------------------
  function attachStaticListeners() {
    attachListener();
    bindVoiceRecorder();
    if (messageInput) {
      messageInput.addEventListener("input", function () {
        var len = messageInput.value.length;
        charCounter.textContent = len + " / " + MSG_MAX_LENGTH;
        charCounter.classList.toggle("error", len > MSG_MAX_LENGTH * 0.9);
      });
    }
    if (modalCloseReply) {
      modalCloseReply.addEventListener("click", function () {
        if (replyPanel) replyPanel.classList.remove("visible");
      });
    }
    if (messageToggle && messageDrawer) {
      messageToggle.addEventListener("click", function () {
        var visible = messageDrawer.classList.contains("visible");
        setInputAreaVisible(!visible);
        Utils.vibrate([10]);
      });
      if (replyBtn) {
        replyBtn.addEventListener("click", function () {
          if (replyPanel) replyPanel.classList.remove("visible");
          setInputAreaVisible(true);
          if (messageInput) {
            messageInput.value = "";
            setTimeout(function () { messageInput.focus(); }, 300);
          }
          Utils.vibrate([20, 10]);
        });
      }
    }
    if (infoTrigger && secureModal) {
      infoTrigger.addEventListener("click", function () { secureModal.classList.add("visible"); });
    }
    if (modalClose) {
      modalClose.addEventListener("click", function () { secureModal.classList.remove("visible"); });
    }
    if (ringBtn) ringBtn.addEventListener("click", onRingClick);
    document.querySelectorAll('[data-action="retry-capture"]').forEach(function (el) {
      el.addEventListener("click", function () {
        clearSession();
        stopReplyPolling();
        setInputAreaVisible(false);
        resetUi();
        if (statusError) statusError.classList.remove("visible");
        if (actionBar) actionBar.style.display = "flex";
        resolveTokenAndBootstrap();
      });
    });
  }

  // ---- UI helpers --------------------------------------------------------
  function setInvalidState(msg) {
    if (errorTextEl) errorTextEl.textContent = msg || "Invalid Token";
    if (actionBar) actionBar.style.display = "none";
    if (statusError) statusError.classList.add("visible");
    ringBtn.disabled = true;
    stopReplyPolling();
    clearSession();
  }
  function resetUi() {
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
    if (ringBtnText) {
      ringBtnText.setAttribute("data-i18n", show ? "send_button" : "ring_button");
    }
    I18n.apply();
  }

  // ---- Token resolve -----------------------------------------------------
  async function resolveTokenAndBootstrap() {
    if (!qrToken || !/^[A-Za-z0-9_-]{8,128}$/.test(qrToken)) {
      setInvalidState("Token Missing");
      return;
    }
    try {
      var res = await supabaseClient.rpc("resolve_qr_token", { p_qr_token: qrToken });
      if (res.error) throw res.error;
      var data = Array.isArray(res.data) ? res.data[0] : res.data;
      if (!data || !data.door_point_id) {
        setInvalidState("Invalid Point");
        return;
      }
      resolvedDoor = data;
      if (locationName && data.door_name) locationName.textContent = data.door_name;
      ringBtn.disabled = false;
      if (currentRing && currentRing.id) startReplyPolling(currentRing);
    } catch (err) {
      console.error(err);
      setInvalidState("System Unavailable");
    }
  }

  // ---- Geofence helper ---------------------------------------------------
  function captureLocation() {
    if (!CONFIG.FEATURE_FLAGS.gpsLocation) return Promise.resolve(null);
    if (!resolvedDoor || resolvedDoor.latitude == null || resolvedDoor.longitude == null) {
      // Door has no geofence: server will skip the check too.
      return Promise.resolve(null);
    }
    if (!navigator.geolocation) {
      Utils.showToast("Location not supported by browser", "error");
      return Promise.resolve(null);
    }
    return new Promise(function (resolve) {
      var timeout = setTimeout(function () { resolve({ error: "timeout" }); }, 8000);
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          clearTimeout(timeout);
          resolve({
            latitude:   pos.coords.latitude,
            longitude:  pos.coords.longitude,
            accuracy_m: pos.coords.accuracy,
          });
        },
        function (err) {
          clearTimeout(timeout);
          resolve({ error: err && err.message ? err.message : "denied" });
        },
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 8000 }
      );
    });
  }

  // ---- Turnstile ---------------------------------------------------------
  function getTurnstileToken() {
    if (!CONFIG.hasTurnstile()) return Promise.resolve("");
    if (typeof window.turnstile === "undefined") {
      // The widget script may still be loading; wait briefly.
      return new Promise(function (resolve) {
        var tries = 0;
        var iv = setInterval(function () {
          tries++;
          if (typeof window.turnstile !== "undefined") {
            clearInterval(iv);
            renderAndExecute(resolve);
          } else if (tries > 30) {
            clearInterval(iv);
            resolve("");
          }
        }, 200);
      });
    }
    return new Promise(function (resolve) { renderAndExecute(resolve); });
  }
  function renderAndExecute(resolve) {
    var holder = document.getElementById("turnstile-holder");
    if (!holder) {
      holder = document.createElement("div");
      holder.id = "turnstile-holder";
      holder.style.display = "none";
      document.body.appendChild(holder);
    }
    if (turnstileId === null) {
      turnstileId = window.turnstile.render(holder, {
        sitekey:    CONFIG.TURNSTILE_SITE_KEY,
        size:       "invisible",
        callback:   function (token) { resolve(token); },
        "error-callback":   function () { resolve(""); },
        "timeout-callback": function () { resolve(""); },
      });
    } else {
      window.turnstile.reset(turnstileId);
      window.turnstile.execute(turnstileId);
    }
    window.turnstile.execute(turnstileId);
  }

  // ---- Ring submission ---------------------------------------------------
  async function onRingClick() {
    if (!resolvedDoor) return;
    if (!navigator.onLine) { Utils.showToast("Offline", "error"); return; }

    var msg = messageInput ? messageInput.value.trim() : null;
    var hideLoading = Utils.showLoading(currentRing ? I18n.t("loading") : I18n.t("status_transmitting"));
    Utils.vibrate([20, 40, 20]);

    try {
      if (currentRing && currentRing.id && currentRing.secret) {
        await appendFollowup(msg);
      } else {
        startRinging();
        await createFirstRing(msg);
      }
      hideLoading();
      if (statusSuccess) {
        statusSuccess.classList.add("visible");
        setTimeout(function () { statusSuccess.classList.remove("visible"); }, 3000);
      }
      Utils.vibrate([50, 100]);
      if (messageInput) messageInput.value = "";
      setInputAreaVisible(false);
      if (timestampDisplay) {
        timestampDisplay.textContent = new Date().toLocaleTimeString();
        timestampDisplay.style.display = "block";
      }
      if (currentRing) startReplyPolling(currentRing);
    } catch (err) {
      console.error("ring submit:", err);
      hideLoading();
      var status = (err && err.status) || 0;
      var code   = (err && err.code) || "";
      var lower  = (err && err.message ? String(err.message) : "").toLowerCase();

      // Prefer the structured Postgres ERRCODE when present (P0001..P0008).
      // Fall back to HTTP-status mapping for legacy / network errors.
      function pickKey() {
        switch (code) {
          case "P0001": return "err_invalid_qr";
          case "P0002": return "err_rate_limit";
          case "P0003": return "err_location_needed";
          case "P0004": return "err_outside_area";
          case "P0005": return "err_message_too_long";
          case "P0006": return "err_door_dnd";
          case "P0007": return "err_global_cap";
          case "P0008": return "err_auto_dnd";
        }
        if (status === 404 || lower.indexOf("invalid or inactive") !== -1) return "err_invalid_qr";
        if (status === 423) return "err_door_dnd";
        if (status === 429 || lower.indexOf("rate limit") !== -1 || lower.indexOf("too many") !== -1) return "err_rate_limit";
        if (status === 422 || lower.indexOf("geofence") !== -1 || lower.indexOf("location") !== -1 || lower.indexOf("area") !== -1) return "err_outside_area";
        if (status === 413) return "err_message_too_long";
        if (status === 403 || lower.indexOf("captcha") !== -1) return "err_captcha";
        return "err_generic";
      }
      var key = pickKey();
      Utils.showToast(I18n.t(key), "error", key === "err_invalid_qr" ? 0 : undefined);

      if (key === "err_invalid_qr") {
        clearSession();
        if (ringBtn) ringBtn.disabled = true;
      } else if (currentRing && (lower.indexOf("forbidden") !== -1 || lower.indexOf("not found") !== -1)) {
        clearSession();
        stopReplyPolling();
      }
      if (!currentRing) resetUi();
    }
  }

  async function createFirstRing(plaintextMsg) {
    var loc = await captureLocation();
    if (loc && loc.error) {
      // Hard requirement: geofenced door + denied location = fail closed.
      Utils.showToast(
        loc.error === "denied"
          ? "Please allow location to ring this door"
          : "Couldn't get your location",
        "error"
      );
      throw new Error("location_unavailable");
    }
    var turnstileToken = await getTurnstileToken();

    // Multi-recipient encryption (Batch A #1): encrypt once per active
    // owner public key so every owner device can decrypt locally.
    var ciphertexts = null;
    var encrypted   = false;
    var pubs = Array.isArray(resolvedDoor.owner_public_keys)
        ? resolvedDoor.owner_public_keys
        : (resolvedDoor.owner_public_key ? [resolvedDoor.owner_public_key] : []);
    if (plaintextMsg && CONFIG.FEATURE_FLAGS.e2eEncryption && pubs.length && window.Crypto) {
      ciphertexts = await window.Crypto.sealForMany(plaintextMsg, pubs);
      encrypted = Array.isArray(ciphertexts) && ciphertexts.length > 0;
    }

    // Batch H #19: encrypt the optional image attachment (if any) once per
    // recipient public key, mirroring the message encryption pattern.
    var attachmentField = null;
    if (pendingAttachment && pubs.length && window.Crypto && CONFIG.FEATURE_FLAGS.e2eEncryption) {
      var attCiphertexts = await window.Crypto.sealForMany(pendingAttachment.base64, pubs);
      if (Array.isArray(attCiphertexts) && attCiphertexts.length > 0) {
        attachmentField = {
          ciphertexts: attCiphertexts,
          mime_type:   pendingAttachment.mime,
          size_bytes:  pendingAttachment.size,
        };
      }
    }

    // Batch H #20: present the visitor token if we have one cached.
    var visitorToken = visitorTokenStorageKey
      ? (window.localStorage.getItem(visitorTokenStorageKey) || null)
      : null;

    var payload = {
      qr_token:          qrToken,
      turnstile_token:   turnstileToken,
      message:           encrypted ? ciphertexts[0] : (plaintextMsg || null),
      message_encrypted: encrypted,
      ciphertexts:       encrypted ? ciphertexts : null,
      attachment:        attachmentField,
      visitor_token:     visitorToken,
      idempotency_key:   window.Crypto.randomToken(),
      latitude:          loc ? loc.latitude  : null,
      longitude:         loc ? loc.longitude : null,
      accuracy_m:        loc ? loc.accuracy_m : null,
    };

    var res = await fetch(CONFIG.VERIFY_RING_URL, {
      method:  "POST",
      mode:    "cors",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) {
      var body = await res.json().catch(function () { return {}; });
      var err = new Error(body.error || "ring_failed");
      err.status = res.status;
      err.code = body.code || "";
      throw err;
    }
    var data = await res.json();
    currentRing = { id: data.ring_id, secret: data.guest_secret };
    saveSession(currentRing);
    // Persist the returned visitor token for the next ring at this QR.
    if (visitorTokenStorageKey && typeof data.visitor_token === "string" && data.visitor_token.length > 0) {
      try { window.localStorage.setItem(visitorTokenStorageKey, data.visitor_token); } catch (_) {}
    }
    pendingAttachment = null;
  }

  async function appendFollowup(plaintextMsg) {
    // For follow-up messages we keep a single ciphertext (first recipient)
    // because append_ring_message stores one string per chat entry. Owner
    // devices that aren't the first recipient see the placeholder; this
    // is an acceptable degradation since multi-device E2E mostly matters
    // for the original urgent ring rather than every follow-up message.
    var ciphertext = null;
    var encrypted  = false;
    var firstPub = (resolvedDoor && resolvedDoor.owner_public_keys && resolvedDoor.owner_public_keys[0])
        || (resolvedDoor && resolvedDoor.owner_public_key)
        || null;
    if (plaintextMsg && CONFIG.FEATURE_FLAGS.e2eEncryption && firstPub && window.Crypto) {
      ciphertext = await window.Crypto.sealToBase64(plaintextMsg, firstPub);
      encrypted = !!ciphertext;
    }
    var res = await supabaseClient.rpc("append_ring_message", {
      p_ring_id:      currentRing.id,
      p_role:         "guest",
      p_message:      encrypted ? ciphertext : (plaintextMsg || "Follow-up signal"),
      p_guest_secret: currentRing.secret,
      p_encrypted:    encrypted,
    });
    if (res.error) throw res.error;
  }

  // ---- Reply polling (no anon Realtime) ---------------------------------
  async function pollOnce() {
    if (!currentRing) return;
    try {
      var res = await supabaseClient.rpc("get_guest_ring_reply_by_secret", {
        p_ring_id:      currentRing.id,
        p_guest_secret: currentRing.secret,
      });
      if (res.error) throw res.error;
      var row = Array.isArray(res.data) ? res.data[0] : res.data;
      if (!row) return;
      if ((row.owner_reply && row.owner_reply.trim() !== "") || (row.chat_history && row.chat_history.length)) {
        renderReply(row.owner_reply, row.chat_history);
      }
      if (row.status === "dismissed" || row.status === "responded") {
        stopReplyPolling();
        clearSession();
        resetUi();
      }
    } catch (_) {
      // Transient failure: keep polling quietly.
    }
  }

  function startReplyPolling() {
    stopReplyPolling();
    pollOnce();
    replyPollTimer = setInterval(pollOnce, REPLY_POLL_MS);
  }
  function stopReplyPolling() {
    if (replyPollTimer) clearInterval(replyPollTimer);
    replyPollTimer = null;
  }
  window.addEventListener("beforeunload", stopReplyPolling);

  // ---- Chat render -------------------------------------------------------
  function renderReply(_replyText, history) {
    if (!history || !history.length) return;
    if (replyPanel) replyPanel.classList.add("visible");
    var chatMessages = document.getElementById("chat-messages");
    if (!chatMessages) return;
    chatMessages.replaceChildren();
    history.forEach(function (m) {
      var bubble = document.createElement("div");
      bubble.className = "chat-bubble " + (m.role === "guest" ? "chat-bubble-guest" : "chat-bubble-owner");
      var text = document.createElement("div");
      // Text-only render; never innerHTML.
      text.textContent = m.encrypted && m.role === "guest"
        ? "🔒 (encrypted message)"
        : (m.text || "");
      bubble.appendChild(text);
      if (m.time) {
        var t = document.createElement("span");
        t.className = "chat-time";
        t.textContent = new Date(m.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        bubble.appendChild(t);
      }
      chatMessages.appendChild(bubble);
    });
    chatMessages.scrollTop = chatMessages.scrollHeight;
    Utils.vibrate([100, 50, 100]);
  }

  // ---- Online indicator --------------------------------------------------
  function bindOnlineHandlers() {
    function update() {
      if (offlineIndicator) offlineIndicator.classList.toggle("visible", !navigator.onLine);
    }
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();
  }
})();
