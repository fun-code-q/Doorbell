/* global supabase, CONFIG, I18n, Utils, Auth, window, document */
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
      navigator.serviceWorker.register("sw.js").catch(function(err) {
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
    this.syncStatusFilterPills();
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
    var unresolved = !ring.owner_reply || ring.owner_reply === "";
    card.className = "ring-card" + (unresolved ? " unread" : "");
    card.setAttribute("data-ring-id", ring.id);


    var content = document.createElement("div");
    content.className = "ring-content";

    var header = document.createElement("div");
    header.className = "ring-header";

    var headerLeft = document.createElement("div");
    headerLeft.className = "ring-header-left";

    var locationBtn = document.createElement("button");
    locationBtn.className = "location-trigger";
    locationBtn.type = "button";
    locationBtn.textContent = ring.door_location || "Unknown";
    locationBtn.title = ring.door_location || "Unknown";
    (function(locationName) {
      locationBtn.addEventListener("click", function() {
        self.showLocationDetails(locationName);
      });
    })(ring.door_location);
    headerLeft.appendChild(locationBtn);

    var deleteBtn = document.createElement("button");
    deleteBtn.className = "ring-delete-btn";
    deleteBtn.type = "button";
    deleteBtn.textContent = "\ud83d\uddd1";
    deleteBtn.setAttribute("aria-label", I18n.t("delete"));
    (function(id) {
      deleteBtn.addEventListener("click", function() {
        self.deleteRing(id);
      });
    })(ring.id);
    headerLeft.appendChild(deleteBtn);

    var time = document.createElement("div");
    time.className = "ring-time";
    time.textContent = Utils.formatDate(ring.created_at);

    header.appendChild(headerLeft);
    header.appendChild(time);
    content.appendChild(header);

    if (ring.guest_message) {
      var msgBubble = document.createElement("div");
      msgBubble.className = "message-bubble";
      var msgLabel = document.createElement("div");
      msgLabel.className = "message-bubble-label";
      msgLabel.textContent = "Visitor Message";
      var msgText = document.createElement("div");
      msgText.className = "message-bubble-text";
      msgText.textContent = ring.guest_message;
      msgBubble.appendChild(msgLabel);
      msgBubble.appendChild(msgText);
      content.appendChild(msgBubble);
    } else {
      var simpleMsg = document.createElement("div");
      simpleMsg.className = "message-bubble-text";
      simpleMsg.textContent = "Signal received (no message)";
      content.appendChild(simpleMsg);
    }

    card.appendChild(content);

    // --- Threaded Chat History (Professional Obsidian Look) ---
    if (ring.chat_history && ring.chat_history.length > 0) {
      var historyDiv = document.createElement("div");
      historyDiv.className = "ring-chat-history";

      ring.chat_history.forEach(function(msg) {
        var bubble = document.createElement("div");
        // Reuse same logic as guest: Amber for guest messages, Surface/Border for owner
        bubble.className = "mini-chat-bubble " + (msg.role === "guest" ? "guest" : "owner");

        var text = document.createElement("div");
        text.className = "bubble-text";
        text.textContent = msg.text;
        bubble.appendChild(text);

        if (msg.time) {
          var timeSpan = document.createElement("div");
          timeSpan.className = "bubble-time";
          timeSpan.textContent = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          bubble.appendChild(timeSpan);
        }

        historyDiv.appendChild(bubble);
      });
      card.appendChild(historyDiv);
    }


    var actions = document.createElement("div");
    actions.className = "ring-actions";

    if (unresolved) {
      var ackBtn = document.createElement("button");
      ackBtn.className = "btn btn-secondary btn-sm";
      ackBtn.textContent = I18n.t("ack");
      (function(id) {
        ackBtn.addEventListener("click", function() {
          self.sendReply(id, I18n.t("acknowledged"));
        });
      })(ring.id);
      actions.appendChild(ackBtn);

      var comingBtn = document.createElement("button");
      comingBtn.className = "btn btn-secondary btn-sm";
      comingBtn.textContent = I18n.t("coming");
      (function(id) {
        comingBtn.addEventListener("click", function() {
          self.sendReply(id, I18n.t("coming"));
        });
      })(ring.id);
      actions.appendChild(comingBtn);

      var customBtn = document.createElement("button");
      customBtn.className = "btn btn-primary btn-sm";
      customBtn.textContent = I18n.t("secure_reply");
      (function(id) {
        customBtn.addEventListener("click", function() {
          self.promptCustomReply(id);
        });
      })(ring.id);
      actions.appendChild(customBtn);

      card.appendChild(actions);
    } else {
      var replyBox = document.createElement("div");
      replyBox.className = "ring-reply";
      var replyLabel = document.createElement("div");
      replyLabel.className = "ring-reply-label";
      replyLabel.textContent = I18n.t("signal_inbound");
      var replyText = document.createElement("div");
      replyText.className = "ring-reply-text";
      replyText.textContent = ring.owner_reply || "";
      replyBox.appendChild(replyLabel);
      replyBox.appendChild(replyText);
      card.appendChild(replyBox);
    }

    return card;
  },

  sendReply: async function(ringId, message) {
    try {
      var result = await this.supabase.rpc("append_ring_message", {
        p_ring_id: ringId,
        p_role: "owner",
        p_message: message
      });
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
    var msg = window.prompt(I18n.t("custom_reply"));

    if (msg && msg.trim()) this.sendReply(ringId, msg.trim());
  },

  showLocationDetails: function(locationName) {
    var normalized = (locationName || "").trim().toLowerCase();
    var matched = this.doorPoints.find(function(dp) {
      return (dp.name || "").trim().toLowerCase() === normalized;
    });
    var safeName = (locationName || "Unknown").trim() || "Unknown";
    var description = matched && matched.description ? matched.description.trim() : "";
    if (!description) description = I18n.t("no_description");
    window.alert("Location Details\n\nName: " + safeName + "\nDescription: " + description);

  },

  deleteRing: async function(ringId) {
    if (!window.confirm(I18n.t("confirm_delete"))) return;

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
    var missed = this.rings.filter(function(r) {
      return !r.owner_reply || r.owner_reply === "";
    }).length;
    var answered = this.rings.filter(function(r) {
      return !!(r.owner_reply && r.owner_reply !== "");
    }).length;
    var totalDoors = this.doorPoints.length;
    var pausedDoors = this.doorPoints.filter(function(dp) {
      return !dp.is_active;
    }).length;

    var missedEl = document.getElementById("stat-missed");
    var answeredEl = document.getElementById("stat-answered");
    var doorsEl = document.getElementById("stat-doors");
    var pausedEl = document.getElementById("stat-paused");

    if (missedEl) missedEl.textContent = String(missed);
    if (answeredEl) answeredEl.textContent = String(answered);
    if (doorsEl) doorsEl.textContent = String(totalDoors);
    if (pausedEl) pausedEl.textContent = String(pausedDoors);
  },

  syncStatusFilterPills: function() {
    var self = this;
    document.querySelectorAll("#status-filter-pills .filter-pill").forEach(function(btn) {
      var value = btn.getAttribute("data-status-filter") || "all";
      btn.classList.toggle("active", value === self.currentFilter);
    });
    var statusSelect = document.getElementById("filter-rings");
    if (statusSelect) statusSelect.value = this.currentFilter;
  },

  populateDoorFilter: function() {
    var select = document.getElementById("filter-door");
    if (!select) return;
    var pillRow = document.getElementById("door-filter-pills");
    var doors = {};
    this.rings.forEach(function(r) {
      if (r.door_location) doors[r.door_location] = true;
    });
    var doorList = Object.keys(doors).sort();

    if (this.currentDoorFilter !== "all" && doorList.indexOf(this.currentDoorFilter) === -1) {
      this.currentDoorFilter = "all";
    }

    select.innerHTML = '<option value="all">' + I18n.t("all_doors") + "</option>";
    doorList.forEach(function(door) {
      var opt = document.createElement("option");
      opt.value = door;
      opt.textContent = door;
      select.appendChild(opt);
    });
    select.value = this.currentDoorFilter;

    if (!pillRow) return;
    pillRow.innerHTML = "";
    if (doorList.length <= 1) {
      pillRow.style.display = "none";
      return;
    }

    var self = this;
    pillRow.style.display = "flex";
    function addDoorPill(value, label) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-pill";
      btn.setAttribute("data-door-filter", value);
      btn.textContent = label;
      if (self.currentDoorFilter === value) btn.classList.add("active");
      pillRow.appendChild(btn);
    }

    addDoorPill("all", I18n.t("all_doors"));
    doorList.forEach(function(door) {
      addDoorPill(door, door);
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
      var title = "QR Doorbell: " + (ringData ? ringData.door_location : I18n.t("new_ring_fallback"));
      var options = {
        body: ringData && ringData.guest_message ? ringData.guest_message : I18n.t("someone_at_door"),
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
    this.updateStats();
    this.populateDoorFilter();
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
          Utils.showToast(I18n.t("door_link_copied"), "success");
        }).catch(function() {
          Utils.showToast(I18n.t("failed_copy_link"), "error");
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
      Utils.showToast(isActive ? I18n.t("door_activated") : I18n.t("door_deactivated"), "success");
      await this.loadDoorPoints();
    } catch (err) {
      console.error("Toggle door active error:", err);
      Utils.showToast(err.message || I18n.t("error_occurred"), "error");
    }
  },

  deleteDoorPoint: async function(id) {
    if (!window.confirm(I18n.t("confirm_delete"))) return;

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
    var newName = window.prompt(I18n.t("door_name"), dp.name);

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
    var url = new URL("index.html", window.location.href);
    url.searchParams.set("t", doorPoint.qr_token);
    return url.toString();
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
      var statusPill = e.target.closest("[data-status-filter]");
      if (statusPill) {
        self.currentFilter = statusPill.getAttribute("data-status-filter") || "all";
        self.syncStatusFilterPills();
        self.renderRings();
        return;
      }

      var doorPill = e.target.closest("[data-door-filter]");
      if (doorPill) {
        self.currentDoorFilter = doorPill.getAttribute("data-door-filter") || "all";
        var doorSelect = document.getElementById("filter-door");
        if (doorSelect) doorSelect.value = self.currentDoorFilter;
        self.populateDoorFilter();
        self.renderRings();
        return;
      }

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
          var houseName = window.prompt(I18n.t("add_house_prompt"));

          if (houseName && houseName.trim()) {
            self.createHouse(houseName.trim()).then(function() {
              Utils.showToast(I18n.t("house_added"), "success");
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
        self.syncStatusFilterPills();
        self.renderRings();
      }
      if (e.target.id === "filter-door") {
        self.currentDoorFilter = e.target.value;
        self.populateDoorFilter();
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

        Utils.showLoading(I18n.t("owner_signin_loading"));
        Auth.signIn(email, password).then(function(result) {
          if (result.success) {
            Utils.showToast(I18n.t("owner_signin_success"), "success");
            self.loadDashboard();
          } else {
            Utils.showToast(result.error || I18n.t("owner_signin_error"), "error");
          }
        }).catch(function(err) {
          console.error("Login error:", err);
          Utils.showToast(I18n.t("owner_signin_failed"), "error");
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

        Utils.showLoading(I18n.t("owner_signup_loading"));
        Auth.signUp(email, password).then(function(result) {
          if (result.success) {
            Utils.showToast(I18n.t("owner_signup_success"), "success", 0);
            document.getElementById("signup-view").style.display = "none";
            document.getElementById("login-view").style.display = "block";
          } else {
            Utils.showToast(result.error || I18n.t("owner_signup_error"), "error");
          }
        }).catch(function(err) {
          console.error("Signup error:", err);
          Utils.showToast(I18n.t("owner_signup_error"), "error");
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
      var active = document.activeElement;
      var isEditable = !!active && (
        active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.tagName === "SELECT" ||
        active.isContentEditable
      );
      if (isEditable || e.altKey) return;
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
