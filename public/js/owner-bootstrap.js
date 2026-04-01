/* ============================================================
   QR Doorbell - Owner Page Bootstrap
   ============================================================ */

(function() {
  if (!CONFIG.hasSupabaseConfig || !CONFIG.hasSupabaseConfig()) {
    var setupOverlay = document.getElementById("setup-overlay");
    if (setupOverlay) setupOverlay.classList.add("visible");
    return;
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(function() {});
  }

  I18n.init();

  document.querySelectorAll(".tab-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      var tab = this.getAttribute("data-tab");
      document.querySelectorAll(".tab-btn").forEach(function(tabBtn) {
        tabBtn.classList.remove("active");
        tabBtn.setAttribute("aria-selected", "false");
      });
      document.querySelectorAll(".tab-content").forEach(function(content) {
        content.classList.remove("active");
      });
      this.classList.add("active");
      this.setAttribute("aria-selected", "true");
      var tabContent = document.getElementById("tab-" + tab);
      if (tabContent) tabContent.classList.add("active");
    });
  });

  var savedLang = Utils.storage.get("lang");
  if (savedLang) {
    I18n.setLang(savedLang);
    var activeBtn = document.getElementById("lang-" + savedLang);
    var inactiveBtn = document.getElementById("lang-" + (savedLang === "en" ? "de" : "en"));
    if (activeBtn) activeBtn.classList.add("active");
    if (inactiveBtn) inactiveBtn.classList.remove("active");
  }

  App.init();
})();
