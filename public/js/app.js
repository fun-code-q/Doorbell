const App = {
  supabase: null,
  rings: [],
  doorPoints: [],
  auditEntries: [],
  houses: [],
  settings: null,
  currentHouseId: null,
  currentFilter: "all",
  currentDoorFilter: "all",
  searchQuery: "",
  pageSize: 10,
  ringChannel: null,
  isLoading: false,
  soundEnabled: true,
  vibrationEnabled: true,
  unreadCount: 0,
  ringTimestamps: [],
  FLOOD_THRESHOLD: 5,
  FLOOD_WINDOW: 60000,
  initialized: false,
  eventListenersBound: false,
  onlineStatusHandlersBound: false,
  lastGeneratedDoorPoint: null,

  init: async function() {
    if (this.initialized) return;
    this.initialized = true;
    I18n.init();
    if (!CONFIG.hasSupabaseConfig || !CONFIG.hasSupabaseConfig()) {
      var setupOverlay = document.getElementById("setup-overlay");
      if (setupOverlay) setupOverlay.classList.add("visible");
      return;
    }
    this.supabase = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY || CONFIG.SUPABASE_KEY);
    await Auth.init(this.supabase);
    this.registerServiceWorker();
    this.setupOnlineOfflineHandler();
    this.setupTheme();
    this.setupEventListeners();
    this.requestNotificationPermission();
    if (Auth.isAuthenticated()) await this.loadDashboard();
  },

  registerServiceWorker: function() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(function(err) {
        console.warn("Service Worker registration failed:", err);
      });
    }
  },

  setupOnlineOfflineHandler: function() {
    if (this.onlineStatusHandlersBound) return;
    this.onlineStatusHandlersBound = true;
    var banner = document.getElementById("offline-banner");
    function updateStatus() {
      if (banner) banner.classList.toggle("visible", !navigator.onLine);
    }
    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);
    updateStatus();
  },

  setupTheme: function() {
    var savedTheme = Utils.storage.get("theme", "dark");
    document.documentElement.setAttribute("data-theme", savedTheme);
  },

  toggleTheme: function() {
    var current = document.documentElement.getAttribute("data-theme");
    var next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    Utils.storage.set("theme", next);
  },

  ensureHouseContext: async function() {
    var ensureResult = await this.supabase.rpc("ensure_owner_house");
    if (ensureResult.error) throw ensureResult.error;
    await this.loadHouses();
    if (!this.houses.length) throw new Error("No houses available for this account");
    var saved = Utils.storage.get("active_house_id");
    var exists = this.houses.some(function(h) { return h.id === saved; });
    this.currentHouseId = exists ? saved : this.houses[0].id;
    Utils.storage.set("active_house_id", this.currentHouseId);
    this.renderHouseSwitcher();
  },

  loadHouses: async function() {
    var result = await this.supabase
      .from("houses")
      .select("id,name,is_active,created_at")
      .order("created_at", { ascending: true });
    if (result.error) throw result.error;
    this.houses = (result.data || []).filter(function(h) { return h.is_active !== false; });
  },

  renderHouseSwitcher: function() {
    var switcher = document.getElementById("house-switcher");
    if (!switcher) return;
    switcher.innerHTML = "";
    this.houses.forEach(function(house) {
      var option = document.createElement("option");
      option.value = house.id;
      option.textContent = house.name;
      switcher.appendChild(option);
    });
    if (this.currentHouseId) switcher.value = this.currentHouseId;
  },

  changeHouse: async function(houseId) {
    if (!houseId || houseId === this.currentHouseId) return;
    this.currentHouseId = houseId;
    Utils.storage.set("active_house_id", houseId);
    await this.loadRings();
    await this.loadDoorPoints();
    await this.loadAuditLog();
    this.updateStats();
    this.populateDoorFilter();
    this.setupRealtimeSubscription();
  },

  createHouse: async function(name) {
    var trimmed = (name || "").trim();
    if (!trimmed) return;
    var result = await this.supabase.rpc("create_house", { p_name: trimmed });
    if (result.error) throw result.error;
    await this.loadHouses();
    var created = null;
    if (Array.isArray(result.data)) created = result.data[0] || null;
    else created = result.data || null;
    this.currentHouseId = (created && created.id) ? created.id : this.houses[0].id;
    Utils.storage.set("active_house_id", this.currentHouseId);
    this.renderHouseSwitcher();
    await this.loadRings();
    await this.loadDoorPoints();
    await this.loadAuditLog();
    this.updateStats();
    this.populateDoorFilter();
    this.setupRealtimeSubscription();
  },

  addHouseMember: async function(email, role) {
    if (!this.currentHouseId) {
      Utils.showToast("Select a house first", "warning");
      return;
    }
    var cleanEmail = (email || "").trim();
    var cleanRole = (role || "manager").trim().toLowerCase();
    if (!cleanEmail) return;
    var result = await this.supabase.rpc("add_house_member_by_email", {
      p_house_id: this.currentHouseId,
      p_email: cleanEmail,
      p_role: cleanRole
    });
    if (result.error) throw result.error;
  },

  loadDashboard: async function() {
    if (!this.supabase || this.isLoading) return;
    this.isLoading = true;
    try {
      await this.ensureHouseContext();
      await Promise.all([this.loadRings(), this.loadDoorPoints(), this.loadSettings(), this.loadAuditLog()]);
      this.updateStats();
      this.populateDoorFilter();
      this.setupRealtimeSubscription();
    } catch (err) {
      console.error("Dashboard load error:", err);
      Utils.showToast(err.message || I18n.t("error_generic"), "error");
    } finally {
      this.isLoading = false;
    }
  },

  loadRings: async function() {
    if (!this.currentHouseId) return;
    var result = await this.supabase
      .from("doorbell_rings")
      .select("*")
      .eq("house_id", this.currentHouseId)
      .order("created_at", { ascending: false })
      .limit(this.pageSize);
    if (result.error) throw result.error;
    this.rings = result.data || [];
    this.unreadCount = this.rings.filter(function(r) { return !r.owner_reply || r.owner_reply === ""; }).length;
    this.updateNotifBadge();
    this.renderRings();
  },

  loadMoreRings: async function() {
    if (!this.currentHouseId) return;
    var offset = this.rings.length;
    var result = await this.supabase
      .from("doorbell_rings")
      .select("*")
      .eq("house_id", this.currentHouseId)
      .order("created_at", { ascending: false })
      .range(offset, offset + this.pageSize - 1);
    if (result.error) throw result.error;
    if (result.data && result.data.length) {
      this.rings.push.apply(this.rings, result.data);
      this.renderRings();
    }
  },

  renderRings: function() {
    var feed = document.getElementById("feed-list");
    if (!feed) return;
    var self = this;
    var filtered = this.rings.slice();
    if (this.currentFilter !== "all") {
      filtered = filtered.filter(function(r) {
        if (self.currentFilter === "waiting") return !r.owner_reply || r.owner_reply === "";
        if (self.currentFilter === "responded") return !!(r.owner_reply && r.owner_reply !== "");
        return true;
      });
    }
    if (this.currentDoorFilter !== "all") {
      filtered = filtered.filter(function(r) { return r.door_location === self.currentDoorFilter; });
    }
    if (this.searchQuery) {
      var q = this.searchQuery.toLowerCase();
      filtered = filtered.filter(function(r) {
        return (r.door_location || "").toLowerCase().indexOf(q) !== -1 || (r.guest_message || "").toLowerCase().indexOf(q) !== -1;
      });
    }
    if (!filtered.length) {
      feed.innerHTML = '<p class="text-center text-muted" style="padding:3rem;">' + Utils.sanitize(I18n.t("no_rings_found")) + "</p>";
      return;
    }
    feed.innerHTML = "";
    filtered.forEach(function(ring) { feed.appendChild(self.createRingCard(ring)); });
  },

  createRingCard: function(ring) {
    var self = this;
    var card = document.createElement("div");
    card.className = "ring-card" + ((!ring.owner_reply || ring.owner_reply === "") ? " unread" : "");
    card.setAttribute("data-ring-id", ring.id);

    // Photo Display
    if (ring.photo_url) {
      var photoContainer = document.createElement("div");
      photoContainer.className = "ring-image-container";
      
      var img = document.createElement("img");
      img.className = "ring-image";
      img.alt = "Visitor photo";
      img.loading = "lazy";
      
      if (ring.photo_encrypted) {
        this.decryptAndShowImage(ring.photo_url, img);
      } else {
        this.getSignedUrl(ring.photo_url).then(function(url) {
          if (url) img.src = url;
        });
      }
      
      photoContainer.appendChild(img);
      card.appendChild(photoContainer);
    }

    var content = document.createElement("div");
    content.className = "ring-content";
    content.style.padding = "1.5rem";

    var header = document.createElement("div");
    header.className = "ring-header";
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.marginBottom = "1rem";

    var time = document.createElement("div");
    time.className = "ring-time";
    time.textContent = Utils.formatRelative(ring.created_at);

    header.appendChild(time);
    content.appendChild(header);

    if (ring.guest_message) {
      var msgBubble = document.createElement("div");
      msgBubble.className = "message-bubble";
      msgBubble.style.marginTop = "0";
      var msgLabel = document.createElement("div");
      msgLabel.className = "message-bubble-label";
      msgLabel.textContent = ring.guest_message_encrypted ? "Encrypted Message" : "Visitor Message";
      var msgText = document.createElement("div");
      msgText.className = "message-bubble-text";
      if (ring.guest_message_encrypted) {
        msgText.textContent = "[Click to decrypt]";
        msgText.style.cursor = "pointer";
        msgText.style.color = "#f59e0b";
        (function(encText, el) {
          msgText.addEventListener("click", function() { self.decryptAndShowMessage(encText, el); });
        })(ring.guest_message, msgText);
      } else {
        msgText.textContent = ring.guest_message;
      }
      msgBubble.appendChild(msgLabel);
      msgBubble.appendChild(msgText);
      content.appendChild(msgBubble);
    } else {
      var simpleMsg = document.createElement("div");
      simpleMsg.style.color = "var(--text-muted)";
      simpleMsg.style.fontSize = "0.9rem";
      simpleMsg.textContent = "Signal received (no message)";
      content.appendChild(simpleMsg);
    }

    card.appendChild(content);

    var actions = document.createElement("div");
    actions.className = "ring-actions";

    if (!ring.owner_reply || ring.owner_reply === "") {
      var ackBtn = document.createElement("button");
      ackBtn.className = "btn btn-secondary btn-sm";
      ackBtn.textContent = I18n.t("ack");
      (function(id) { ackBtn.addEventListener("click", function() { self.sendReply(id, I18n.t("acknowledged")); }); })(ring.id);
      actions.appendChild(ackBtn);

      var comingBtn = document.createElement("button");
      comingBtn.className = "btn btn-secondary btn-sm";
      comingBtn.textContent = I18n.t("coming");
      (function(id) { comingBtn.addEventListener("click", function() { self.sendReply(id, I18n.t("coming")); }); })(ring.id);
      actions.appendChild(comingBtn);

      var customBtn = document.createElement("button");
      customBtn.className = "btn btn-primary btn-sm";
      customBtn.textContent = I18n.t("secure_reply");
      (function(id) { customBtn.addEventListener("click", function() { self.promptCustomReply(id); }); })(ring.id);
      actions.appendChild(customBtn);
    } else {
      var replyDiv = document.createElement("div");
      replyDiv.className = "ring-reply";
      var label = document.createElement("div");
      label.className = "ring-reply-label";
      label.textContent = I18n.t("signal_inbound");
      var text = document.createElement("div");
      text.className = "ring-reply-text";
      text.textContent = ring.owner_reply;
      replyDiv.appendChild(label);
      replyDiv.appendChild(text);
      card.appendChild(replyDiv);
    }

    var deleteBtn = document.createElement("button");
    deleteBtn.className = "btn btn-danger btn-sm";
    deleteBtn.textContent = I18n.t("delete");
    (function(id) { deleteBtn.addEventListener("click", function() { self.deleteRing(id); }); })(ring.id);
    actions.appendChild(deleteBtn);

    card.appendChild(actions);
    return card;
  },

  getSignedUrl: function(filePath) {
    return this.supabase.storage.from("guest_photos").createSignedUrl(filePath, 3600).then(function(result) {
      return (result.data && result.data.signedUrl) ? result.data.signedUrl : null;
    });
  },

  decryptAndShowImage: function(filePath, imgEl) {
    if (!Crypto.isSupported()) { Utils.showToast("Web Crypto not supported", "error"); return; }
    imgEl.style.opacity = "0.3";
    imgEl.alt = "Decrypting...";
    this.supabase.storage.from("guest_photos").download(filePath).then(function(result) {
      if (result.error) throw result.error;
      return Crypto.decryptBlob(result.data, CONFIG.ENCRYPTION_PASSPHRASE);
    }).then(function(decryptedBlob) {
      imgEl.src = URL.createObjectURL(decryptedBlob);
      imgEl.style.opacity = "1";
      imgEl.alt = "Decrypted visitor photo";
    }).catch(function(err) {
      console.error("Image decryption failed:", err);
      imgEl.alt = "Decryption failed";
      Utils.showToast("Failed to decrypt image", "error");
    });
  },

  decryptAndShowMessage: function(encryptedText, el) {
    if (!Crypto.isSupported()) { Utils.showToast("Web Crypto not supported", "error"); return; }
    el.textContent = "Decrypting...";
    Crypto.decryptText(encryptedText, CONFIG.ENCRYPTION_PASSPHRASE).then(function(plaintext) {
      el.textContent = plaintext;
      el.style.color = "";
      el.style.cursor = "";
    }).catch(function(err) {
      console.error("Message decryption failed:", err);
      el.textContent = "Decryption failed";
      el.style.color = "#ef4444";
      Utils.showToast("Failed to decrypt message", "error");
    });
  },

  sendReply: async function(ringId, message) {
    try {
      var result = await this.supabase
        .from("doorbell_rings")
        .update({ owner_reply: message, status: "responded", replied_at: new Date().toISOString() })
        .eq("id", ringId)
        .eq("house_id", this.currentHouseId);
      if (result.error) throw result.error;
      Utils.showToast(I18n.t("signal_dispatched"), "success");
      Utils.vibrate([50, 50, 50]);
      await this.loadRings();
      this.updateStats();
    } catch (err) {
      console.error("Reply error:", err);
      Utils.showToast(I18n.t("error_occurred"), "error");
    }
  },

  promptCustomReply: function(ringId) {
    var msg = prompt(I18n.t("custom_reply"));
    if (msg && msg.trim()) this.sendReply(ringId, msg.trim());
  },

  deleteRing: async function(ringId) {
    if (!confirm(I18n.t("confirm_delete"))) return;
    try {
      var result = await this.supabase.from("doorbell_rings").delete().eq("id", ringId).eq("house_id", this.currentHouseId);
      if (result.error) throw result.error;
      Utils.showToast(I18n.t("deleted"), "success");
      await this.loadRings();
      this.updateStats();
    } catch (err) {
      console.error("Delete error:", err);
      Utils.showToast(I18n.t("error_occurred"), "error");
    }
  },

  updateNotifBadge: function() {
    var badge = document.getElementById("notif-badge");
    var count = document.getElementById("notif-count");
    if (!badge || !count) return;
    if (this.unreadCount > 0) {
      badge.style.display = "inline-flex";
      count.textContent = this.unreadCount > 99 ? "99+" : String(this.unreadCount);
    } else {
      badge.style.display = "none";
    }
  },

  updateStats: function() {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var todayStr = today.toISOString();
    var todayRings = this.rings.filter(function(r) { return r.created_at >= todayStr; });
    var pendingRings = this.rings.filter(function(r) { return !r.owner_reply || r.owner_reply === ""; });
    var repliedRings = this.rings.filter(function(r) { return r.replied_at && r.created_at; });

    var todayEl = document.getElementById("stat-today");
    var pendingEl = document.getElementById("stat-pending");
    var totalEl = document.getElementById("stat-total");
    var avgEl = document.getElementById("stat-avg");
    if (todayEl) todayEl.textContent = todayRings.length;
    if (pendingEl) pendingEl.textContent = pendingRings.length;
    if (totalEl) totalEl.textContent = this.rings.length;

    if (repliedRings.length > 0 && avgEl) {
      var totalMs = 0;
      repliedRings.forEach(function(r) {
        totalMs += new Date(r.replied_at).getTime() - new Date(r.created_at).getTime();
      });
      var avgMins = Math.round((totalMs / repliedRings.length) / 60000);
      avgEl.textContent = avgMins < 1 ? "<1m" : avgMins + "m";
    } else if (avgEl) {
      avgEl.textContent = "-";
    }
  },
  populateDoorFilter: function() {
    var select = document.getElementById("filter-door");
    if (!select) return;
    var doors = {};
    this.rings.forEach(function(r) { if (r.door_location) doors[r.door_location] = true; });
    select.innerHTML = '<option value="all">All Doors</option>';
    Object.keys(doors).sort().forEach(function(door) {
      var opt = document.createElement("option");
      opt.value = door;
      opt.textContent = door;
      select.appendChild(opt);
    });
  },

  detectFlood: function() {
    var now = Date.now();
    this.ringTimestamps.push(now);
    var cutoff = now - this.FLOOD_WINDOW;
    this.ringTimestamps = this.ringTimestamps.filter(function(ts) { return ts > cutoff; });
    var floodWarning = document.getElementById("flood-warning");
    if (floodWarning) floodWarning.style.display = this.ringTimestamps.length >= this.FLOOD_THRESHOLD ? "block" : "none";
  },

  setupRealtimeSubscription: function() {
    var self = this;
    if (!this.currentHouseId) return;
    if (this.ringChannel) this.supabase.removeChannel(this.ringChannel);
    this.ringChannel = this.supabase
      .channel("doorbell_rings_realtime_" + this.currentHouseId)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "doorbell_rings", filter: "house_id=eq." + this.currentHouseId }, function(payload) {
        self.rings.unshift(payload.new);
        self.unreadCount++;
        self.updateNotifBadge();
        self.updateStats();
        self.populateDoorFilter();
        self.detectFlood();
        self.renderRings();
        self.playNotificationSound(payload.new);
        Utils.showToast(I18n.t("new_ring_alert", { door: payload.new.door_location }), "info");
        Utils.vibrate([100, 50, 100]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "doorbell_rings", filter: "house_id=eq." + this.currentHouseId }, async function() {
        try {
          await self.loadRings();
          self.updateStats();
        } catch (err) {
          console.warn("Realtime refresh failed:", err);
        }
      })
      .subscribe();
  },

  requestNotificationPermission: function() {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  },

  playNotificationSound: function(ringData) {
    if (!this.soundEnabled) return;
    try {
      var audio = new Audio("https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3");
      audio.volume = 0.5;
      audio.play().catch(function() {});
    } catch (_e) {}

    // Native Notification for Standalone APK
    if ("Notification" in window && Notification.permission === "granted") {
      var title = "QR Doorbell: " + (ringData ? ringData.door_location : "New Ring");
      var options = {
        body: ringData && ringData.guest_message_encrypted ? "Visitor left an encrypted message" : (ringData && ringData.guest_message ? ringData.guest_message : "Someone is at the door"),
        icon: "icons/icon-192x192.png",
        vibrate: [200, 100, 200],
        tag: "doorbell-ring",
        renotify: true
      };
      new Notification(title, options);
    }
  },

  loadDoorPoints: async function() {
    if (!this.currentHouseId) return;
    var result = await this.supabase.from("door_points").select("*").eq("house_id", this.currentHouseId).order("name", { ascending: true });
    if (result.error) throw result.error;
    this.doorPoints = result.data || [];
    this.renderDoorPoints();
  },

  renderDoorPoints: function() {
    var container = document.getElementById("door-points-list");
    if (!container) return;
    container.innerHTML = "";
    var self = this;
    this.doorPoints.forEach(function(dp) {
      var item = document.createElement("div");
      item.className = "settings-item";

      var info = document.createElement("div");
      var name = document.createElement("div");
      name.className = "settings-item-label";
      name.textContent = dp.name + (dp.is_active ? "" : " (Inactive)");
      var desc = document.createElement("div");
      desc.className = "settings-item-description";
      desc.textContent = (dp.description || "") + "  Token: " + dp.qr_token.slice(0, 10) + "...";
      info.appendChild(name);
      info.appendChild(desc);

      var actions = document.createElement("div");
      actions.style.display = "flex";
      actions.style.gap = "0.5rem";
      actions.style.flexWrap = "wrap";

      function btn(label, cls, onClick) {
        var b = document.createElement("button");
        b.className = cls;
        b.textContent = label;
        b.addEventListener("click", onClick);
        return b;
      }

      actions.appendChild(btn("QR", "btn btn-secondary btn-sm", function() { self.generateQRCodeForDoorPoint(dp); }));
      actions.appendChild(btn("Link", "btn btn-secondary btn-sm", function() {
        Utils.copyToClipboard(self.getGuestUrl(dp)).then(function() {
          Utils.showToast("Door link copied", "success");
        }).catch(function() {
          Utils.showToast("Failed to copy link", "error");
        });
      }));
      actions.appendChild(btn(dp.is_active ? "Deactivate" : "Activate", dp.is_active ? "btn btn-danger btn-sm" : "btn btn-primary btn-sm", function() {
        self.setDoorPointActive(dp.id, !dp.is_active);
      }));
      actions.appendChild(btn(I18n.t("edit"), "btn btn-secondary btn-sm", function() { self.editDoorPoint(dp); }));
      actions.appendChild(btn(I18n.t("delete"), "btn btn-danger btn-sm", function() { self.deleteDoorPoint(dp.id); }));

      item.appendChild(info);
      item.appendChild(actions);
      container.appendChild(item);
    });
  },

  addDoorPoint: async function(name, description) {
    if (!this.currentHouseId) { Utils.showToast("Select a house first", "warning"); return; }
    var cleanName = (name || "").trim();
    if (!cleanName) return;
    try {
      var result = await this.supabase.from("door_points").insert([{ house_id: this.currentHouseId, name: cleanName, description: (description || "").trim() || null }]).select().single();
      if (result.error) throw result.error;
      Utils.showToast(I18n.t("saved"), "success");
      await this.loadDoorPoints();
      if (result.data) this.generateQRCodeForDoorPoint(result.data);
    } catch (err) {
      console.error("Add door error:", err);
      Utils.showToast(err.message || I18n.t("error_occurred"), "error");
    }
  },

  setDoorPointActive: async function(id, isActive) {
    try {
      var result = await this.supabase.from("door_points").update({ is_active: !!isActive }).eq("id", id).eq("house_id", this.currentHouseId);
      if (result.error) throw result.error;
      Utils.showToast(isActive ? "Door activated" : "Door deactivated", "success");
      await this.loadDoorPoints();
    } catch (err) {
      console.error("Toggle door active error:", err);
      Utils.showToast(err.message || I18n.t("error_occurred"), "error");
    }
  },

  deleteDoorPoint: async function(id) {
    if (!confirm(I18n.t("confirm_delete"))) return;
    try {
      var result = await this.supabase.from("door_points").delete().eq("id", id).eq("house_id", this.currentHouseId);
      if (result.error) throw result.error;
      Utils.showToast(I18n.t("deleted"), "success");
      await this.loadDoorPoints();
    } catch (err) {
      console.error("Delete door error:", err);
      Utils.showToast(I18n.t("error_occurred"), "error");
    }
  },

  editDoorPoint: function(dp) {
    var self = this;
    var newName = prompt(I18n.t("door_name"), dp.name);
    if (!newName || !newName.trim() || newName.trim() === dp.name) return;
    this.supabase.from("door_points").update({ name: newName.trim() }).eq("id", dp.id).eq("house_id", this.currentHouseId).then(function(result) {
      if (result.error) throw result.error;
      Utils.showToast(I18n.t("saved"), "success");
      self.loadDoorPoints();
    }).catch(function(err) {
      Utils.showToast(err.message || I18n.t("error_occurred"), "error");
    });
  },

  getGuestUrl: function(doorPoint) {
    return window.location.origin + "/index.html?t=" + encodeURIComponent(doorPoint.qr_token);
  },

  generateQRCodeForDoorPoint: function(doorPoint) {
    var canvas = document.getElementById("canvas-qr");
    if (!canvas || !window.QRCode || !doorPoint || !doorPoint.qr_token) return;
    var url = this.getGuestUrl(doorPoint);
    var self = this;
    QRCode.toCanvas(canvas, url, { width: 280, margin: 2, color: { dark: "#000000", light: "#ffffff" } }, function(err) {
      if (err) {
        console.error("QR generation error:", err);
        Utils.showToast("QR generation failed", "error");
        return;
      }
      self.lastGeneratedDoorPoint = doorPoint;
      var qrOut = document.getElementById("qr-out");
      if (qrOut) qrOut.classList.add("visible");
      Utils.showToast("QR ready for " + doorPoint.name, "success");
    });
  },

  generateQRCodeByName: function(doorName) {
    var name = (doorName || "").trim().toLowerCase();
    if (!name) return;
    var found = this.doorPoints.find(function(dp) { return dp.name.toLowerCase() === name; });
    if (!found) {
      Utils.showToast("Door not found in selected house", "warning");
      return;
    }
    this.generateQRCodeForDoorPoint(found);
  },

  downloadQRCode: function() {
    var canvas = document.getElementById("canvas-qr");
    if (!canvas) return;
    var fileBase = this.lastGeneratedDoorPoint ? this.lastGeneratedDoorPoint.name : "door";
    var a = document.createElement("a");
    a.download = "QR_" + fileBase.replace(/[^a-z0-9]/gi, "_") + ".png";
    a.href = canvas.toDataURL("image/png");
    a.click();
  },

  exportRingsCSV: function() {
    if (!this.rings.length) return;
    var data = this.rings.map(function(r) {
      return {
        ID: r.id,
        Time: Utils.formatDate(r.created_at),
        House: r.house_id,
        Location: r.door_location,
        Message: r.guest_message || "",
        Reply: r.owner_reply || "",
        Status: r.status || "waiting"
      };
    });
    Utils.downloadCSV(data, "doorbell_rings_" + new Date().toISOString().split("T")[0] + ".csv");
  },
  loadSettings: async function() {
    var user = Auth.getUser();
    if (!user || !user.id) return;
    var result = await this.supabase.from("owner_settings").select("*").eq("user_id", user.id).single();
    if (result.error && result.error.code !== "PGRST116") throw result.error;
    this.settings = result.data || {
      sound_enabled: true,
      vibration_enabled: true,
      push_enabled: true,
      language: "en",
      dark_mode: true,
      auto_logout_minutes: 15,
      active_house_id: this.currentHouseId
    };
    this.soundEnabled = this.settings.sound_enabled;
    this.vibrationEnabled = this.settings.vibration_enabled;
    this.renderSettings();
  },

  renderSettings: function() {
    var s = this.settings;
    if (!s) return;
    var soundToggle = document.getElementById("setting-sound");
    if (soundToggle) soundToggle.checked = s.sound_enabled;
    var vibToggle = document.getElementById("setting-vibration");
    if (vibToggle) vibToggle.checked = s.vibration_enabled;
    var pushToggle = document.getElementById("setting-push");
    if (pushToggle) pushToggle.checked = s.push_enabled;
    var langSelect = document.getElementById("setting-language");
    if (langSelect) langSelect.value = s.language || "en";
    var logoutInput = document.getElementById("setting-auto-logout");
    if (logoutInput) logoutInput.value = s.auto_logout_minutes || 15;
  },

  saveSettings: async function() {
    var user = Auth.getUser();
    if (!user || !user.id) return;
    var soundEnabled = document.getElementById("setting-sound") ? document.getElementById("setting-sound").checked : true;
    var vibrationEnabled = document.getElementById("setting-vibration") ? document.getElementById("setting-vibration").checked : true;
    var pushEnabled = document.getElementById("setting-push") ? document.getElementById("setting-push").checked : true;
    var selectedLanguage = document.getElementById("setting-language") ? document.getElementById("setting-language").value : (I18n.currentLang || "en");
    if (selectedLanguage !== "de" && selectedLanguage !== "en") selectedLanguage = "en";
    var autoLogoutRaw = document.getElementById("setting-auto-logout") ? parseInt(document.getElementById("setting-auto-logout").value || "15", 10) : 15;
    var autoLogoutMinutes = Number.isFinite(autoLogoutRaw) ? Math.min(Math.max(autoLogoutRaw, 1), 120) : 15;
    var autoLogoutInput = document.getElementById("setting-auto-logout");
    if (autoLogoutInput) autoLogoutInput.value = autoLogoutMinutes;
    var settingsData = {
      user_id: user.id,
      sound_enabled: soundEnabled,
      vibration_enabled: vibrationEnabled,
      push_enabled: pushEnabled,
      language: selectedLanguage,
      auto_logout_minutes: autoLogoutMinutes,
      active_house_id: this.currentHouseId
    };

    try {
      if (this.settings && this.settings.id) {
        var updateResult = await this.supabase.from("owner_settings").update(settingsData).eq("id", this.settings.id);
        if (updateResult.error) throw updateResult.error;
      } else {
        var insertResult = await this.supabase.from("owner_settings").insert([settingsData]);
        if (insertResult.error) throw insertResult.error;
      }
      Utils.storage.set("auto_logout_minutes", autoLogoutMinutes);
      this.soundEnabled = soundEnabled;
      this.vibrationEnabled = vibrationEnabled;
      if (I18n.currentLang !== selectedLanguage) {
        I18n.setLang(selectedLanguage);
        var enBtn = document.getElementById("lang-en");
        var deBtn = document.getElementById("lang-de");
        if (enBtn && deBtn) {
          enBtn.classList.toggle("active", selectedLanguage === "en");
          deBtn.classList.toggle("active", selectedLanguage === "de");
        }
      }
      Utils.showToast(I18n.t("saved"), "success");
      await this.loadSettings();
    } catch (err) {
      console.error("Save settings error:", err);
      Utils.showToast(err.message || I18n.t("error_occurred"), "error");
    }
  },

  loadAuditLog: async function() {
    if (!this.currentHouseId) return;
    var result = await this.supabase.from("audit_log").select("*").eq("house_id", this.currentHouseId).order("created_at", { ascending: false }).limit(50);
    if (result.error) {
      console.warn("Audit log load error:", result.error);
      return;
    }
    this.auditEntries = result.data || [];
    this.renderAuditLog();
  },

  renderAuditLog: function() {
    var container = document.getElementById("audit-list");
    if (!container) return;
    if (!this.auditEntries.length) {
      container.innerHTML = '<p class="text-center text-muted" style="padding:3rem;" data-i18n="no_audit_entries">' + I18n.t("no_audit_entries") + "</p>";
      return;
    }
    container.innerHTML = "";
    this.auditEntries.forEach(function(entry) {
      var div = document.createElement("div");
      div.className = "audit-entry";
      var actionSpan = document.createElement("span");
      actionSpan.className = "audit-action";
      actionSpan.textContent = entry.action;
      var timeSpan = document.createElement("span");
      timeSpan.className = "audit-time";
      timeSpan.textContent = " " + Utils.formatDate(entry.created_at);
      var tableSpan = document.createElement("span");
      tableSpan.className = "audit-time";
      tableSpan.textContent = " on " + (entry.table_name || "unknown");
      div.appendChild(actionSpan);
      div.appendChild(timeSpan);
      div.appendChild(tableSpan);
      container.appendChild(div);
    });
  },

  setupEventListeners: function() {
    if (this.eventListenersBound) return;
    this.eventListenersBound = true;
    var self = this;

    document.addEventListener("click", function(e) {
      var target = e.target.closest("[data-action]");
      if (!target) return;
      var action = target.getAttribute("data-action");
      Utils.vibrate([30]);

      switch (action) {
        case "sign-out":
          Auth.signOut();
          break;
        case "toggle-theme":
          self.toggleTheme();
          break;
        case "toggle-lang": {
          var nextLang = I18n.currentLang === "en" ? "de" : "en";
          I18n.setLang(nextLang);
          var nextBtn = document.getElementById("lang-" + nextLang);
          var prevBtn = document.getElementById("lang-" + (nextLang === "en" ? "de" : "en"));
          if (nextBtn) nextBtn.classList.add("active");
          if (prevBtn) prevBtn.classList.remove("active");
          break;
        }
        case "add-house": {
          var houseName = prompt("New house name");
          if (houseName && houseName.trim()) {
            self.createHouse(houseName.trim()).then(function() {
              Utils.showToast("House added", "success");
            }).catch(function(err) {
              Utils.showToast(err.message || I18n.t("error_occurred"), "error");
            });
          }
          break;
        }
        case "generate-qr": {
          var doorName = document.getElementById("door-in") ? document.getElementById("door-in").value.trim() : "";
          if (doorName) self.generateQRCodeByName(doorName);
          break;
        }
        case "download-qr":
          self.downloadQRCode();
          break;
        case "export-csv":
          self.exportRingsCSV();
          break;
        case "save-settings":
          self.saveSettings();
          break;
        case "add-door": {
          var nameInput = document.getElementById("new-door-name");
          var descInput = document.getElementById("new-door-desc");
          if (nameInput && nameInput.value.trim()) {
            self.addDoorPoint(nameInput.value.trim(), descInput ? descInput.value : "");
            nameInput.value = "";
            if (descInput) descInput.value = "";
          }
          break;
        }
        case "add-member": {
          var emailInput = document.getElementById("member-email");
          var roleInput = document.getElementById("member-role");
          var email = emailInput ? emailInput.value.trim() : "";
          var role = roleInput ? roleInput.value : "manager";
          if (!email) break;
          self.addHouseMember(email, role).then(function() {
            Utils.showToast("Member added to house", "success");
            if (emailInput) emailInput.value = "";
          }).catch(function(err) {
            Utils.showToast(err.message || I18n.t("error_occurred"), "error");
          });
          break;
        }
        case "load-more":
          self.loadMoreRings();
          break;
        case "retry-connection":
          window.location.reload();
          break;
        case "mark-all-read":
          self.unreadCount = 0;
          document.querySelectorAll(".ring-card.unread").forEach(function(card) {
            card.classList.remove("unread");
          });
          self.updateNotifBadge();
          break;
      }
    });

    document.addEventListener("input", Utils.debounce(function(e) {
      if (e.target.id === "search-rings") {
        self.searchQuery = e.target.value;
        self.renderRings();
      }
    }, 300));

    document.addEventListener("change", function(e) {
      if (e.target.id === "filter-rings") {
        self.currentFilter = e.target.value;
        self.renderRings();
      }
      if (e.target.id === "filter-door") {
        self.currentDoorFilter = e.target.value;
        self.renderRings();
      }
      if (e.target.id === "house-switcher") {
        self.changeHouse(e.target.value);
      }
    });

    var loginForm = document.getElementById("login-form");
    if (loginForm) {
      loginForm.addEventListener("submit", function(e) {
        e.preventDefault();
        var email = document.getElementById("login-email") ? document.getElementById("login-email").value.trim() : "";
        var password = document.getElementById("login-password") ? document.getElementById("login-password").value : "";
        if (!email || !password) return;

        Utils.showLoading("Signing in...");
        Auth.signIn(email, password).then(function(result) {
          if (result.success) {
            Utils.showToast("Welcome back!", "success");
            self.loadDashboard();
          } else {
            Utils.showToast("Invalid credentials", "error");
          }
        }).catch(function(err) {
          console.error("Login error:", err);
          Utils.showToast("Sign in failed", "error");
        }).finally(function() {
          Utils.hideLoading();
        });
      });
    }

    var signupForm = document.getElementById("signup-form");
    if (signupForm) {
      signupForm.addEventListener("submit", function(e) {
        e.preventDefault();
        var email = document.getElementById("signup-email") ? document.getElementById("signup-email").value.trim() : "";
        var password = document.getElementById("signup-password") ? document.getElementById("signup-password").value : "";
        if (!email || !password) return;

        Utils.showLoading("Creating vault...");
        Auth.signUp(email, password).then(function(result) {
          if (result.success) {
            Utils.showToast("Vault created! Please check your email and sign in.", "success", 0);
            document.getElementById("signup-view").style.display = "none";
            document.getElementById("login-view").style.display = "block";
          } else {
            Utils.showToast(result.error || "Sign up failed", "error");
          }
        }).catch(function(err) {
          console.error("Signup error:", err);
          Utils.showToast("Account creation failed", "error");
        }).finally(function() {
          Utils.hideLoading();
        });
      });
    }

    var goToSignup = document.getElementById("go-to-signup");
    if (goToSignup) {
      goToSignup.addEventListener("click", function(e) {
        e.preventDefault();
        document.getElementById("login-view").style.display = "none";
        document.getElementById("signup-view").style.display = "block";
        if (typeof I18n !== "undefined" && I18n.apply) I18n.apply();
      });
    }

    var goToLogin = document.getElementById("go-to-login");
    if (goToLogin) {
      goToLogin.addEventListener("click", function(e) {
        e.preventDefault();
        document.getElementById("signup-view").style.display = "none";
        document.getElementById("login-view").style.display = "block";
        if (typeof I18n !== "undefined" && I18n.apply) I18n.apply();
      });
    }

    document.addEventListener("keydown", function(e) {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case "k":
            e.preventDefault();
            var searchInput = document.getElementById("search-rings");
            if (searchInput) searchInput.focus();
            break;
          case "e":
            e.preventDefault();
            self.exportRingsCSV();
            break;
          case "d":
            e.preventDefault();
            self.toggleTheme();
            break;
        }
      }
    });
  }
};

document.addEventListener("DOMContentLoaded", function() {
  App.init();
});
