(() => {
  // --- 這行以下貼你的原本腳本（原樣貼上即可） ---
  const firebaseConfig = {
    apiKey: "AIzaSyBs9sWJ2WHIuTmU0Jw7U_120uMManBES1E",
    authDomain: "kjreminder-24d74.firebaseapp.com",
    projectId: "kjreminder-24d74",
    storageBucket: "kjreminder-24d74.firebasestorage.app",
    messagingSenderId: "176371952161",
    appId: "1:176371952161:web:948121be209cd2e4181160",
    databaseURL:
      "https://kjreminder-24d74-default-rtdb.asia-southeast1.firebasedatabase.app/",
  };
  firebase.initializeApp(firebaseConfig);
  let auth = firebase.auth();
  let db = firebase.database();

  /* ===== 狀態 ===== */
  let roomPath = ""; // rooms/{user}-{pass}
  let memos = []; // 進行中的備忘
  let categories = []; // 分類
  let categoriesLoaded = false;
  let selectedMemoId = null;
  let memosRef = null,
    categoriesRef = null;
  let sectionSortable = null;
  let isEditing = false; // 是否在編輯分類模式（給長按行為判斷）
  let memoSortables = []; // 備忘條拖拉（跨分類用）

  let memoMonthFilter = "all"; // 'all' | 'recent5' | '11407'（ROC 年月）
  let memoView = "active"; // 'active' | 'removed'
  let memoMonthFilterActive = "all";
  let memoMonthFilterRemoved = "all";
  let pendingCategoryMode = "active"; // 'active' | 'removed'
  let __gd_userGesture = false;

  (function () {
    try {
      var d = document,
        root = d.documentElement;

      // 1) 動態注入：開機時隱藏 App 與登入頁
      if (!d.getElementById("boot-guard-style")) {
        var s = d.createElement("style");
        s.id = "boot-guard-style";
        s.textContent =
          "html.booting .container{display:none!important}" +
          "html.booting #loginPage{display:none!important}";
        d.head.appendChild(s);
      }
      root.classList.add("booting"); // 先蓋住畫面

      // 2) 快切寬限（可選）：若前頁設了 fast_switch=1 就拉長到 800ms
      var fast = sessionStorage.getItem("fast_switch") === "1";
      sessionStorage.removeItem("fast_switch");
      var graceMs = fast ? 800 : 400;

      var released = false;
      function releaseOnce() {
        if (released) return;
        released = true;
        root.classList.remove("booting"); // 掀布，讓你原本的邏輯決定顯示哪一頁
      }

      // 3) 等 Firebase Auth 就緒後，綁一次性觀察者；第一個事件就放行
      function whenAuthReady(cb) {
        if (window.firebase && firebase.auth) return cb(firebase.auth());
        var t = setInterval(function () {
          if (window.firebase && firebase.auth) {
            clearInterval(t);
            cb(firebase.auth());
          }
        }, 30);
        setTimeout(function () {
          clearInterval(t);
        }, 5000); // 安全上限
      }

      var fallback = setTimeout(releaseOnce, graceMs); // 還原太慢 → 顯示登入頁

      whenAuthReady(function (auth) {
        var off = auth.onAuthStateChanged(function () {
          try {
            off && off();
          } catch (_) {}
          clearTimeout(fallback);
          releaseOnce(); // 一拿到使用者（或確定沒使用者）就揭布
        });
      });
    } catch (_) {}
  })();

  //快取
  const v = Date.now(); // 每次刷新都帶入唯一值，避開快取
  document
    .querySelectorAll('link[rel="icon"], link[rel="manifest"]')
    .forEach((el) => {
      if (el.href) {
        el.href += (el.href.includes("?") ? "&" : "?") + "v=" + v;
      }
    });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/service-worker.js?v=" + v)
      .then((reg) => console.log("SW 註冊成功", reg.scope))
      .catch((err) => console.log("SW 註冊失敗", err));
  }

  function applyViewAffordances() {
    const fab = document.querySelector(".fab");
    const menu = document.getElementById("menu");
    const appEl = document.getElementById("app");

    // 切視圖用 class，控制 X 顯示與 FAB 反灰
    appEl?.classList.toggle("view-removed", memoView === "removed");

    if (memoView === "removed") {
      fab?.classList.add("fab-disabled"); // 反灰＋不可點
      menu?.classList.remove("show");
      fab?.classList.remove("open");
    } else {
      fab?.classList.remove("fab-disabled");
    }
  }

  function buildMemoMonthMenu() {
    const menu = document.getElementById("memoMonthMenu");
    if (!menu) return;
    menu.innerHTML = "";

    const isRemovedView = memoView === "removed";
    const list = (memos || []).filter((m) =>
      isRemovedView ? !!m.removedAt : !m.removedAt
    );

    const getFilter = () =>
      isRemovedView ? memoMonthFilterRemoved : memoMonthFilterActive;
    const setFilter = (val) => {
      if (isRemovedView) memoMonthFilterRemoved = val;
      else memoMonthFilterActive = val;
      try {
        localStorage.setItem(
          isRemovedView ? "memo_filter_removed" : "memo_filter_active",
          val
        );
      } catch (_) {}
      renderAll();
    };

    const mkBtn = (label, value) => {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.style.cssText =
        "display:block;border:0;background:#fff;padding:6px 10px;border-radius:6px;cursor:pointer;width:100%;text-align:left;" +
        (getFilter() === value ? "font-weight:700;" : "");
      btn.onclick = () => {
        setFilter(value);
        menu.style.display = "none";
      };
      return btn;
    };

    menu.appendChild(mkBtn("全部", "all"));
    menu.appendChild(mkBtn("近5日", "recent5"));
    menu.appendChild(mkBtn("近30日", "recent30"));
    menu.appendChild(mkBtn("重要 ❗", "important"));

    const monthSet = new Set();
    list.forEach((m) => {
      const ts = getMemoRefTime(m);
      const ym = toRocYMFromTs(ts);
      if (ym !== "無") monthSet.add(ym);
    });

    if (monthSet.size === 0) {
      const empty = document.createElement("div");
      empty.textContent = "無更多月份";
      empty.style.cssText = "padding:6px 8px; color:#666;";
      menu.appendChild(empty);
      return;
    }
    Array.from(monthSet)
      .sort((a, b) => b.localeCompare(a))
      .forEach((ym) => menu.appendChild(mkBtn(ym, ym)));
  }

  /* ===== 小工具 ===== */

  function openModal(id) {
    document.getElementById(id).style.display = "flex";
    if (id === "moreModal") {
      const a = document.getElementById("viewActiveToggle");
      const r = document.getElementById("viewRemovedToggle");
      if (a && r) {
        a.checked = memoView === "active";
        r.checked = memoView === "removed";
      }
    }
  }

  document
    .getElementById("viewActiveToggle")
    ?.addEventListener("change", (e) => {
      const other = document.getElementById("viewRemovedToggle");
      if (e.target.checked) {
        if (other) other.checked = false;
        setMemoView("active");
      } else if (other && !other.checked) e.target.checked = true;
    });
  document
    .getElementById("viewRemovedToggle")
    ?.addEventListener("change", (e) => {
      const other = document.getElementById("viewActiveToggle");
      if (e.target.checked) {
        if (other) other.checked = false;
        setMemoView("removed");
      } else if (other && !other.checked) e.target.checked = true;
    });

  document.addEventListener("DOMContentLoaded", () => {
    try {
      memoView = localStorage.getItem("memo_view") || "active";
      memoMonthFilterActive =
        localStorage.getItem("memo_filter_active") || "all";
      memoMonthFilterRemoved =
        localStorage.getItem("memo_filter_removed") || "all";
    } catch (_) {}
    applyViewAffordances();
    renderSections();
  });

  function closeModal(id) {
    document.getElementById(id).style.display = "none";
  }

  function setMemoView(view) {
    memoView = view;
    try {
      localStorage.setItem("memo_view", view);
    } catch (_) {}
    applyViewAffordances();
    renderSections();
    renderAll();
  }

  function openMemoModal(prefSectionId) {
    updateSectionOptions();
    if (prefSectionId) {
      const sel = document.getElementById("memoSection");
      const opt = sel?.querySelector(`option[value="${prefSectionId}"]`);
      if (opt) sel.value = prefSectionId;
    }
    closeFabMenu(); // 關掉＋選單
    openModal("memoModal");
  }

  function toggleMenu() {
    if (memoView === "removed") return;
    const m = document.getElementById("menu");
    const fab = document.querySelector(".fab");
    const willShow = !m.classList.contains("show");
    m.classList.toggle("show", willShow);
    fab?.classList.toggle("open", willShow);
  }

  document.addEventListener("click", (e) => {
    const menu = document.getElementById("menu");
    if (!menu || !menu.classList.contains("show")) return;
    const fab = document.querySelector(".fab");
    const inside = menu.contains(e.target);
    const onFab = fab && fab.contains(e.target);
    if (!inside && !onFab) closeFabMenu(); // ← 同步關 & 還原「＋」
  });

  async function doLogout() {
    // 1) 停監聽
    try {
      memosRef?.off();
      memosRef = null;
    } catch {}
    try {
      categoriesRef?.off();
      categoriesRef = null;
    } catch {}

    // （可選）若你有 onAuthStateChanged 的退訂函式，就呼叫它
    try {
      window.__authUnsub?.();
      window.__authUnsub = null;
    } catch {}

    // 2) 清本機狀態
    memos = [];
    categories = [];
    selectedMemoId = null;
    roomPath = "";

    // 3) **把所有可能的自動登入 key 都清掉（含 session/local、_session 變種）**
    try {
      const KEYS = [
        "todo_room_info",
        "todo_room_info_session",
        // 若兩個 App 曾用不同命名，這裡也順手清
        "todo_room_info_session", // 保險重覆一遍沒關係
        "fast_switch",
      ];
      KEYS.forEach((k) => {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
      });
    } catch {}

    // 4) 設一個「剛登出」的旗標，避免 bfcache/自動登入誤觸
    try {
      sessionStorage.setItem("just_logged_out", "1");
    } catch {}

    // 5) 登出 Firebase（切成 NONE 避免殘留）
    try {
      await auth.setPersistence(firebase.auth.Auth.Persistence.NONE);
    } catch {}
    try {
      await auth.signOut();
    } catch {}

    // 6) 徹底重置 Firebase app（避免 watchdog 之類殘留再登入）
    try {
      await firebase.app().delete();
    } catch {}

    // 7) 關彈窗 & 導回登入頁
    try {
      closeModal("logoutModal");
      closeModal("moreModal");
    } catch {}
    location.replace("index.html");
  }

  /* ===== Firebase 綁定 ===== */
  function bindFirebase() {
    unbindFirebase();
    memosRef = db.ref(`${roomPath}/memos`);
    categoriesRef = db.ref(`${roomPath}/memoCategories`);

    memosRef.on("value", (snap) => {
      const data = snap.val() || {};
      memos = Object.values(data);
      renderAll();
    });

    categoriesRef.on("value", (snap) => {
      const cloud = snap.val();
      if (cloud === null) {
        categories = [];
        saveCategories();
      } else if (Array.isArray(cloud)) {
        categories = cloud.slice();
      } else if (cloud && typeof cloud === "object") {
        categories = Object.values(cloud);
      } else {
        categories = [];
      }
      categoriesLoaded = true;
      renderSections(categories);
      renderAll();
    });
  }
  function unbindFirebase() {
    try {
      memosRef && memosRef.off();
      categoriesRef && categoriesRef.off();
    } catch (_) {}
  }
  function saveMemos() {
    const obj = {};
    memos.forEach((m) => (obj[m.id] = m));
    db.ref(`${roomPath}/memos`).set(obj);
  }
  function saveCategories() {
    db.ref(`${roomPath}/memoCategories`).set(categories);
  }

  /* ===== UI：今日徽章 ===== */
  (function () {
    const el = document.getElementById("today-badge");
    const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
    function draw() {
      const now = new Date();
      el.textContent = `${now.getMonth() + 1}/${now.getDate()}（${
        WEEK[now.getDay()]
      }）`;
    }
    draw();
    const t = new Date();
    const mid = new Date(t);
    mid.setHours(24, 0, 0, 0);
    setTimeout(() => {
      draw();
      setInterval(draw, 24 * 3600 * 1000);
    }, mid - t);
  })();

  /* ===== 分類區 ===== */
  function renderSections() {
    const wrap = document.getElementById("section-container");
    if (!wrap) return;

    // 上方 🗂️ + 篩選選單容器
    wrap.innerHTML = `
    <div id="memoMore" style="text-align:right; margin:0.25rem 0; position:relative;">
      <button id="memoMoreBtn"
              style="border:0; background:#eee; padding:6px 10px; border-radius:8px; cursor:pointer;">
        🗂️
      </button>
      <div id="memoMonthMenu"
           style="display:none; position:absolute; right:0; background:#fff; border:1px solid #ddd;
                  border-radius:8px; box-shadow:0 4px 10px rgba(0,0,0,.08); padding:6px; z-index:50;">
      </div>
    </div>
  `;

    // 取出要顯示的分類清單
    // 取出要顯示的分類清單
    let names = [];
    if (memoView === "active") {
      names = (categories || []).slice();
    } else {
      // removed：只顯示「有被移除備忘」的分類（統一用原始分類名）
      const set = new Set();
      (memos || []).forEach((m) => {
        if (m.removedAt) set.add(stripRemovedSuffix(m.section));
      });
      names = Array.from(set);
    }

    // 畫出各分類的區塊
    names.forEach((name) => {
      if (memoView === "removed") {
        const displayName = getRemovedSectionLabel(name); // 顯示用(可能帶後綴)
        const sec = document.createElement("div");
        sec.className = "section";
        sec.id = name; // ← id 永遠用「原始分類名」
        sec.innerHTML = `
      <div class="section-title">
        <span class="section-name">${displayName}</span>
        <button class="delete-btn" title="刪除此分類">✕</button>
      </div>
    `;
        // 右上角 X：清掉該分類底下所有「已移除」備忘（不管舊資料是否帶(已移除)後綴）
        sec.querySelector(".delete-btn").onclick = () =>
          confirmDeleteCategory(name, "removed");
        wrap.appendChild(sec);
      } else {
        // active 視圖維持原樣
        const sec = document.createElement("div");
        sec.className = "section" + (isEditing ? " edit-mode" : "");
        sec.id = name;
        sec.innerHTML = `<div class="section-title">${name}</div>`;
        wrap.appendChild(sec);
      }
    });

    // 🗂️ 按鈕
    document.getElementById("memoMoreBtn")?.addEventListener("click", () => {
      const menu = document.getElementById("memoMonthMenu");
      if (!menu) return;
      menu.style.display = menu.style.display === "block" ? "none" : "block";
    });

    // 依目前 memos 重建月份清單（你的 buildMemoMonthMenu 內已會參照 memoView/memoMonthFilter）
    buildMemoMonthMenu();

    // 編輯模式與拖拉（在「已移除」禁止）
    if (memoView === "active") {
      updateSectionOptions();
      if (isEditing) {
        applyEditModeUI(); // 加上把手、✎、✕ 等
      } else {
        initSectionSortable?.();
      }
    } else {
      updateSectionOptions(); // 下拉仍可看，但唯讀
    }

    // ✅ 底部「完成編輯」按鈕只在「當前」且編輯中顯示
    const exitBtn = document.getElementById("exitEditBtn");
    if (exitBtn)
      exitBtn.style.display =
        memoView === "active" && isEditing ? "block" : "none";
  }

  function updateSectionOptions() {
    const optsHTML = (categories || [])
      .map((c) => `<option value="${c}">${c}</option>`)
      .join("");

    // 新增備忘用的下拉
    const s1 = document.getElementById("memoSection");
    if (s1) {
      const prev = s1.value;
      if (s1.__optsHTML !== optsHTML) {
        s1.innerHTML = optsHTML;
        s1.__optsHTML = optsHTML;
      }
      // 還原原本選取（存在才還原）
      if (prev && Array.from(s1.options).some((o) => o.value === prev)) {
        s1.value = prev;
      }
    }

    // 詳情視窗的下拉（重點：要維持目前 memo 的分類）
    const s2 = document.getElementById("detailSection");
    if (s2) {
      const prev = s2.value;
      if (s2.__optsHTML !== optsHTML) {
        s2.innerHTML = optsHTML;
        s2.__optsHTML = optsHTML;
      }

      // 以目前選中的 memo 為準
      let want = prev;
      try {
        const m = (Array.isArray(memos) ? memos : []).find(
          (x) => x.id === selectedMemoId
        );
        if (m && m.section) want = m.section;
      } catch (_) {}

      if (want && Array.from(s2.options).some((o) => o.value === want)) {
        s2.value = want;
      }
      // 否則讓瀏覽器維持現況，不強制跳第一個
    }
  }
  function initSectionSortable() {
    const el = document.getElementById("section-container");
    if (!el) return;
    if (sectionSortable && sectionSortable.destroy) sectionSortable.destroy();
    sectionSortable = new Sortable(el, {
      animation: 150,
      handle: ".drag-handle",
      draggable: ".section",
      ghostClass: "dragging",
      onEnd: () => {
        categories = Array.from(
          document.querySelectorAll("#section-container .section")
        ).map((sec) => sec.id);
        saveCategories();
      },
    });
  }

  function destroyMemoSortables() {
    memoSortables.forEach((s) => {
      try {
        s.destroy();
      } catch (_) {}
    });
    memoSortables = [];
  }

  // ★ 依目前 DOM 的實際位置，回填每張備忘的分類與排序序號(order)
  function commitMemoPositionsFromDOM() {
    let changed = false;
    document.querySelectorAll("#section-container .section").forEach((sec) => {
      const secId = sec.id;
      const tasks = sec.querySelectorAll(".task");
      tasks.forEach((t, idx) => {
        const id = t.dataset.id;
        if (!id) return;
        const m = (memos || []).find((x) => x.id === id);
        if (!m) return;

        let updated = false;
        // 分類變更
        if (m.section !== secId) {
          m.section = secId;
          updated = true;
        }
        // 排序序號（每 10 遞增，方便未來插入）
        const ord = (idx + 1) * 10;
        if (m.order !== ord) {
          m.order = ord;
          updated = true;
        }
        if (updated) {
          m.updatedAt = Date.now();
          changed = true;
        }
      });
    });
    if (changed) saveMemos(); // 寫回雲端
  }

  function initMemoSortables() {
    destroyMemoSortables();
    if (!(memoView === "active" && isEditing)) return;

    // 每個分類區塊都是一個可投遞的清單
    document.querySelectorAll("#section-container .section").forEach((sec) => {
      const s = new Sortable(sec, {
        animation: 150,
        handle: ".memo-drag", // 只允許抓把手拖
        draggable: ".task", // 拖的是備忘條
        group: "memos", // 跨容器移動
        ghostClass: "dragging",
        onAdd: (evt) => {
          const el = evt.item;
          const id = el?.dataset?.id;
          const targetSection = evt.to?.id; // 目標分類名 = section 的 id
          if (!id || !targetSection) return;
          const m = memos.find((x) => x.id === id);
          if (m && m.section !== targetSection) {
            m.section = targetSection;
            m.updatedAt = Date.now();
          }
          commitMemoPositionsFromDOM();
        },
        onUpdate: () => {
          commitMemoPositionsFromDOM();

          // 目前未儲存排序順序，保持現狀即可
        },
      });
      memoSortables.push(s);
    });
  }

  /* ===== 分類：新增/編輯/刪除/更名 ===== */
  function openCategoryModal() {
    closeFabMenu(); // 關掉＋選單
    document.getElementById("newCategoryName").value = "";
    openModal("categoryModal");
  }
  function addCategory() {
    const name = document.getElementById("newCategoryName").value.trim();
    if (!name) return;
    if (categories.includes(name)) return alert("此分類已存在");
    categories.push(name);
    saveCategories();
    renderSections(categories);
    memoMonthFilter = "all";
    renderAll();
    closeModal("categoryModal");
  }
  let pendingRenameId = null;
  let pendingCategoryId = null;

  function enterEditMode() {
    if (memoView === "removed") {
      return;
    }
    isEditing = true;
    document.getElementById("app")?.classList.add("editing");
    closeFabMenu(); // 關掉＋選單

    // 每個區塊套上編輯配件
    document.querySelectorAll(".section").forEach((sec) => {
      sec.classList.add("edit-mode");

      const bar = sec.querySelector(".section-title");
      const name = sec.id;

      // 重畫標題列：☰ 名稱 ✎（X 交給 CSS 放右上角）
      bar.innerHTML = `
                <span class="drag-handle">☰</span>
                <span class="section-name">${name}</span>
                <button class="rename-btn" title="重命名">✎</button>
                <button class="delete-btn" title="刪除此分類">✕</button>
              `;

      bar.querySelector(".rename-btn").onclick = () => {
        pendingRenameId = sec.id;
        document.getElementById("renameInput").value = sec.id;
        openModal("renameModal");
      };
      bar.querySelector(".delete-btn").onclick = () =>
        confirmDeleteCategory(sec.id);
    });

    // 重新啟用拖拉
    initSectionSortable();
    initMemoSortables(); // 啟用備忘條拖拉（跨分類）

    memoMonthFilter = "all";

    renderAll();

    // 顯示底部 ✅ 鈕
    const exitBtn = document.getElementById("exitEditBtn");
    if (exitBtn) exitBtn.style.display = "block";
  }

  function exitEditMode() {
    commitMemoPositionsFromDOM();
    isEditing = false;
    document.getElementById("app")?.classList.remove("editing");

    // 還原標題列成只有名稱
    document.querySelectorAll(".section").forEach((sec) => {
      sec.classList.remove("edit-mode");
      const bar = sec.querySelector(".section-title");
      bar.textContent = sec.id;
    });

    // 關閉底部 ✅ 鈕
    const exitBtn = document.getElementById("exitEditBtn");
    if (exitBtn) exitBtn.style.display = "none";

    // 保險：銷毀並重建拖拉
    if (sectionSortable && sectionSortable.destroy) {
      sectionSortable.destroy();
      sectionSortable = null;
    }
    initSectionSortable();
    destroyMemoSortables(); // 關閉備忘條拖拉
    renderAll();

    // 更新下拉
    updateSectionOptions();
  }

  function confirmDeleteCategory(id, mode = "active") {
    pendingCategoryId = id;
    pendingCategoryMode = mode; // 記住是在哪個視圖操作的
    openModal("confirmCategoryModal");
  }
  function deleteCategoryConfirmed() {
    if (!pendingCategoryId) {
      closeModal("confirmCategoryModal");
      return;
    }

    const id = pendingCategoryId;
    const mode = pendingCategoryMode || "active";

    if (mode === "removed") {
      // 把這個分類在「已移除」中的所有備忘都清掉
      const base = stripRemovedSuffix(id);
      memos = (memos || []).filter(
        (m) => !(m.removedAt && stripRemovedSuffix(m.section) === base)
      );
      saveMemos();

      renderSections();
      renderAll();

      pendingCategoryId = null;
      pendingCategoryMode = "active";
      closeModal("confirmCategoryModal");
      return;
    }

    // === 修正點（active 分支）===
    // 1) 準備備用分類（盡量用現有第一個非本分類的；沒有就用「其它」，也順手建立）

    // 3) 從「當前」的分類清單移除該分類
    categories = categories.filter((c) => c !== id);

    // 4) 存檔與重畫
    saveMemos();
    saveCategories();
    renderSections();
    renderAll();

    pendingCategoryId = null;
    pendingCategoryMode = "active";
    closeModal("confirmCategoryModal");
  }

  function closeFabMenu() {
    const m = document.getElementById("menu");
    const fab = document.querySelector(".fab");
    m?.classList.remove("show");
    fab?.classList.remove("open");
  }

  function confirmRename() {
    const oldId = pendingRenameId;
    const newName = document.getElementById("renameInput").value.trim();
    if (!newName || document.getElementById(newName))
      return alert("名稱不可為空或已存在！");
    memos.forEach((m) => {
      if (m.section === oldId) m.section = newName;
    });
    categories = categories.map((c) => (c === oldId ? newName : c));
    saveMemos();
    saveCategories();
    renderSections(categories);
    renderAll();
    pendingRenameId = null;
    closeModal("renameModal");
  }

  /* ===== Memo CRUD ===== */
  function memoCardHTML(m) {
    const showHandle = memoView === "active" && isEditing;
    const handle = showHandle ? '<span class="memo-drag">☰</span>' : "";
    return `
    <div class="swipe-bar left"><span class="label">🗑 移除</span></div>
    <div class="task-content">
      <div class="task-title">${handle}${m.important ? "❗ " : ""}${
      m.title || ""
    }</div>
    </div>
  `;
  }

  function renderAll() {
    // 清空每個分類的 memo 卡
    document.querySelectorAll("#section-container .section").forEach((sec) => {
      sec.querySelectorAll(".task").forEach((t) => t.remove());
    });

    const isRemoved = memoView === "removed";
    const filterVal = isRemoved
      ? memoMonthFilterRemoved
      : memoMonthFilterActive;

    // 只取當前視圖需要的資料
    const source = (Array.isArray(memos) ? memos : []).filter((m) =>
      isRemoved ? !!m.removedAt : !m.removedAt
    );

    // 篩選（月份 / 重要 + 搜尋：只比對標題/內容）
    const filtered = source.filter((m) => {
      const passMonth = (() => {
        if (filterVal === "all") return true;
        if (filterVal === "important") return !!m.important;
        const ts = getMemoRefTime(m);
        if (!ts) return false;
        if (filterVal === "recent5") return (Date.now() - ts) / 86400000 <= 5;
        if (filterVal === "recent30") return (Date.now() - ts) / 86400000 <= 30;
        return toRocYMFromTs(ts) === filterVal;
      })();
      if (!passMonth) return false;

      // ★ 只檢索標題＋內容
      return memoMatchesSearch(m);
    });

    // ★ 依「分類 + order」排序；order 不在時用 createdAt/updatedAt 作後備，讓順序可重現
    filtered.sort((a, b) => {
      const secA = isRemoved
        ? stripRemovedSuffix(a.section || "")
        : a.section || "";
      const secB = isRemoved
        ? stripRemovedSuffix(b.section || "")
        : b.section || "";
      const sc = secA.localeCompare(secB);
      if (sc !== 0) return sc;

      const ao =
        typeof a.order === "number" ? a.order : a.createdAt || a.updatedAt || 0;
      const bo =
        typeof b.order === "number" ? b.order : b.createdAt || b.updatedAt || 0;
      if (ao !== bo) return ao - bo;

      // 最後用 updatedAt 當 tie-breaker，避免不穩定
      return (a.updatedAt || 0) - (b.updatedAt || 0);
    });

    // 建立 DOM（在「已移除」視圖，section 的 id 是原始分類名）
    filtered.forEach((m) => {
      const el = document.createElement("div");
      el.className = "task" + (isRemoved ? " removed" : "");
      el.dataset.id = m.id;
      el.innerHTML = memoCardHTML(m);

      const secId = isRemoved ? stripRemovedSuffix(m.section) : m.section;
      let sec = document.getElementById(secId);

      // 找不到就丟到第一個 section，避免 throw（極少見的防呆）
      if (!sec) sec = document.querySelector("#section-container .section");
      sec?.appendChild(el);
    });

    // 非編輯時才綁 swipe（避免與拖拉衝突）
    if (!isEditing) bindSwipeToTasks?.();

    updateSectionOptions?.();

    // === 依篩選顯示/隱藏空分類（搜尋中也視為一種篩選）===
    const searchActive = (() => {
      try {
        // 若有預先 tokenize 的陣列就用它；否則讀輸入框
        if (Array.isArray(window.searchTokens) && window.searchTokens.length)
          return true;
        const q = (
          document.getElementById("taskSearchInput")?.value || ""
        ).trim();
        return q.length > 0;
      } catch (_) {
        return false;
      }
    })();

    if (filterVal === "all" && !searchActive) {
      document
        .querySelectorAll("#section-container .section")
        .forEach((sec) => {
          sec.style.display = "";
        });
    } else {
      hideEmptySectionsAfterFilter();
    }

    // 只在「當前」＋ 編輯中啟用拖拉
    if (isEditing && memoView === "active") initMemoSortables();

    // 依目前檢視重建月份選單
    buildMemoMonthMenu();
  }

  function getMemoRefTime(m) {
    return m?.updatedAt || m?.createdAt || null;
  }
  function toRocYMFromTs(ts) {
    if (!ts) return "無";
    const d = new Date(ts);
    if (isNaN(d)) return "無";
    const yy = d.getFullYear() - 1911;
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${yy}${mm}`;
  }

  function hideEmptySectionsAfterFilter() {
    document.querySelectorAll("#section-container .section").forEach((sec) => {
      const hasVisible = Array.from(sec.querySelectorAll(".task")).some(
        (el) => getComputedStyle(el).display !== "none"
      );
      sec.style.display = hasVisible ? "" : "none";
    });
  }

  function hideEmptySections() {
    document.querySelectorAll("#section-container .section").forEach((sec) => {
      const has = sec.querySelector(".task");
      sec.style.display = has ? "" : "";
    });
  }

  function addMemo() {
    const section = document.getElementById("memoSection").value;
    const title = document.getElementById("memoTitle").value.trim();
    const content = document.getElementById("memoContent").value;
    const important = document.getElementById("memoImportant").checked;
    if (!title) return;

    const id = "memo-" + Date.now();
    const now = Date.now();
    const memo = {
      id,
      section,
      title,
      content,
      important,
      createdAt: now,
      updatedAt: now,
      order: Date.now(),
    };

    memos.push(memo);
    saveMemos();
    renderAll();
    document.getElementById("memoTitle").value = "";
    document.getElementById("memoContent").value = "";
    document.getElementById("memoImportant").checked = false;
    closeModal("memoModal");
  }

  function openDetail(id) {
    selectedMemoId = id;
    const m = memos.find((x) => x.id === id);
    if (!m) return;

    document.getElementById("detailSection").value = m.section;
    document.getElementById("detailTitle").value = m.title;
    document.getElementById("detailContent").value = m.content || "";
    document.getElementById("detailImportant").checked = !!m.important;

    const lbl = document.getElementById("detailLastUpdate");
    lbl.textContent = m.updatedAt
      ? "更新：" + formatRocDateTime(m.updatedAt)
      : "";

    resetDetailPanels();

    const isRemoved = memoView === "removed";
    // 標籤文案
    const labels = document.querySelectorAll("#detailForm label");
    if (labels[0])
      labels[0].textContent = isRemoved ? "分類（已移除）" : "備忘分類";

    // 欄位唯讀/禁用
    document.getElementById("detailSection").disabled = isRemoved;
    document.getElementById("detailTitle").readOnly = isRemoved;
    document.getElementById("detailContent").readOnly = isRemoved;
    document.getElementById("detailImportant").disabled = isRemoved;

    // 儲存鈕 → 我知道了！
    const saveBtn = document.querySelector("#detailForm .btn-half.btn-save");
    if (saveBtn) {
      if (isRemoved) {
        saveBtn.textContent = "我知道了！";
        saveBtn.onclick = () => {
          closeModal("detailModal");
        };
      } else {
        saveBtn.textContent = "💾 儲存";
        saveBtn.onclick = saveMemo;
      }
    }

    document.getElementById("detailModal").style.display = "flex";
  // ← 防 Android ghost click：剛開 350ms 內吞掉任何點擊/指標事件
  (function guardFirstClicks() {
    const modal = document.getElementById("detailModal");
    if (!modal) return;
    const killer = (e) => { e.stopImmediatePropagation(); e.stopPropagation(); e.preventDefault(); };
    const types = ["pointerdown","pointerup","mousedown","mouseup","click"];
    types.forEach(t => modal.addEventListener(t, killer, true));
    setTimeout(() => types.forEach(t => modal.removeEventListener(t, killer, true)), 350);
  })();

    try {
      ensureDriveButtonsInlineUI(m);
    } catch (_) {}
  }

  function saveMemo() {
    if (!selectedMemoId) return;
    const m = memos.find((x) => x.id === selectedMemoId);
    if (!m) return;

    m.section = document.getElementById("detailSection").value;
    m.title = document.getElementById("detailTitle").value;
    m.content = document.getElementById("detailContent").value;
    m.important = document.getElementById("detailImportant").checked;
    m.updatedAt = Date.now();

    saveMemos();
    renderAll();
    closeModal("detailModal");
  }

  function confirmDelete() {
    const title = document.querySelector("#confirmModal h3");
    if (title) {
      title.textContent =
        memoView === "removed"
          ? "確定要永久刪除此則備忘？"
          : "確定要移到「已移除」？";
    }
    openModal("confirmModal");
  }

  function deleteMemo() {
    if (!selectedMemoId) return;
    const idx = memos.findIndex((x) => x.id === selectedMemoId);
    if (idx < 0) return;

    if (memoView === "removed") {
      // 永久刪除
      memos.splice(idx, 1);
    } else {
      // 軟刪除 → 丟到「已移除」
      const m = memos[idx];
      m.removedAt = Date.now();
      m.updatedAt = m.updatedAt || Date.now();
    }

    saveMemos();
    renderAll();
    closeModal("confirmModal");
    closeModal("detailModal");
  }

  /* ===== Swipe（只保留左滑刪除；右滑完成禁用） ===== */
  function bindSwipeToTasks() {
    document.querySelectorAll(".task").forEach((task) => {
      if (task.dataset.swipeBound === "1") return;
      task.dataset.swipeBound = "1";
      task.onclick = null;

      const barL = task.querySelector(".swipe-bar.left");
      const labL = barL?.querySelector(".label");

      let sx = 0,
        sy = 0,
        dx = 0,
        dy = 0,
        width = 0,
        isDown = false,
        activeId = null,
        mode = "pending";
      const H_START = 16,
        V_CANCEL = 10,
        DOMINANCE = 1.3,
        BOUND = 0.75,
        MAX_TILT = 3;

      task.addEventListener("pointerdown", onDown);
      task.addEventListener("pointermove", onMove);
      task.addEventListener("pointerup", onUp);
      task.addEventListener("pointercancel", onCancel);
      task.addEventListener("lostpointercapture", onCancel);

      // 吞 click，自己判定「點一下」
      task.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
        },
        true
      );

      function onDown(e) {
        if (e.target.closest("button,input,select,textarea")) return;
        isDown = true;
        activeId = e.pointerId;
        sx = e.clientX;
        sy = e.clientY;
        dx = dy = 0;
        width = task.offsetWidth || 1;
        mode = "pending";
        task.style.transition = "none";
        try {
          task.setPointerCapture(e.pointerId);
        } catch (_) {}
      }
      function onMove(e) {
        if (!isDown || e.pointerId !== activeId) return;
        if (mode === "scroll") return;
        dx = e.clientX - sx;
        dy = e.clientY - sy;
        // 垂直為主 → 捲動
        if (mode === "pending") {
          const adx = Math.abs(dx),
            ady = Math.abs(dy);
          if (ady > V_CANCEL && ady > adx * 1.2) {
            mode = "scroll";
            resetBars();
            task.style.transform = "";
            return;
          }
          if (adx < H_START) return;
          if (adx > ady * DOMINANCE) {
            mode = "swipe";
          } else {
            mode = "scroll";
            return;
          }
        }
        if (mode !== "swipe") return;

        // 只處理左滑（刪除）
        const adx = Math.abs(dx);
        const pct = Math.min(1, adx / width);
        const tilt = (dx / width) * MAX_TILT;
        task.style.transform = `translateX(${Math.round(
          dx
        )}px) rotate(${tilt}deg)`;
        if (dx < 0) {
          barL.style.width = pct * 100 + "%";
          labL.style.opacity = Math.min(1, pct * 1.2);
          labL.style.transform = `translateX(${pct > 0.05 ? 0 : 6}px)`;
        } else {
          resetBars(); // 右滑不啟用
        }
      }
      function onUp(e) {
        finish(false);
      }
      function onCancel(e) {
        finish(true);
      }
      function finish(cancel) {
        const tapLike =
          Math.abs(dx) < 4 && Math.abs(dy) < 4 && mode !== "scroll";
        const wasSwipe = mode === "swipe";
        mode = "pending";
        isDown = false;
        activeId = null;
        task.style.transition = "transform .18s";
        task.style.transform = "";
        resetBars();

        if (!wasSwipe && !cancel && tapLike) {
          openDetail(task.dataset.id);
          cleanup();
          return;
        }

        if (!wasSwipe || cancel) {
          cleanup();
          return;
        }
        const passed = Math.abs(dx) >= width * BOUND;
        if (passed && dx < 0) {
          selectedMemoId = task.dataset.id;
          setTimeout(() => confirmDelete(), 10);
        }
        cleanup();
      }
      function cleanup() {
        dx = dy = 0;
        try {
          task.releasePointerCapture?.(activeId);
        } catch (_) {}
      }
      function resetBars() {
        if (barL) {
          barL.style.width = "0%";
          labL.style.opacity = 0;
          labL.style.transform = "translateX(6px)";
        }
      }
    });
  }

  /* ===== 展開閱讀面板（undo/redo/copy） ===== */
  let __expandedFieldId = null,
    __viewerHistory = [],
    __viewerRedoStack = [];
  function toggleDetailExpand(fieldId, title) {
    const form = document.getElementById("detailForm");
    const viewer = document.getElementById("detailViewer");
    const vTitle = document.getElementById("viewerTitle");
    const vBody = document.getElementById("viewerBody");

    // 先移除舊監聽（原程式碼保留）
    if (__expandedFieldId) {
      const prev = document.getElementById(__expandedFieldId);
      if (prev?.__viewerSync) {
        prev.removeEventListener("input", prev.__viewerSync);
        prev.__viewerSync = null;
      }
      if (vBody?.__formSync) {
        vBody.removeEventListener("input", vBody.__formSync);
        vBody.__formSync = null;
      }
      if (vBody?.__histHandler) {
        vBody.removeEventListener("input", vBody.__histHandler);
        vBody.__histHandler = null;
      }
    }

    // ★ 強化：只有在 viewer 目前是打開狀態時，才把同一鍵當作「收合」
    const isViewerOpen = viewer.classList.contains("show");
    const willCollapse =
      isViewerOpen &&
      __expandedFieldId &&
      (!fieldId || fieldId === __expandedFieldId);
    if (willCollapse) {
      form.classList.remove("hide");
      viewer.classList.remove("show");
      __expandedFieldId = null;
      return;
    }

    const src = document.getElementById(fieldId);
    vTitle.textContent = title || "";
    vBody.value = src ? src.value || "" : "";
    viewer.classList.add("show");
    form.classList.add("hide");
    __expandedFieldId = fieldId;

    if (src) {
      src.__viewerSync = () => {
        vBody.value = src.value || "";
      };
      src.addEventListener("input", src.__viewerSync);

      vBody.__formSync = () => {
        src.value = vBody.value || "";
      };
      vBody.addEventListener("input", vBody.__formSync);
    }

    __viewerHistory = [vBody.value || ""];
    __viewerRedoStack = [];
    if (vBody.__histHandler)
      vBody.removeEventListener("input", vBody.__histHandler);
    let timer = null;
    vBody.__histHandler = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        pushViewerHistory(vBody.value || "");
      }, 180);
    };
    vBody.addEventListener("input", vBody.__histHandler);
  }

  function resetDetailPanels() {
    const form = document.getElementById("detailForm"),
      viewer = document.getElementById("detailViewer");
    const vBody = document.getElementById("viewerBody");
    if (vBody?.__histHandler) {
      vBody.removeEventListener("input", vBody.__histHandler);
      vBody.__histHandler = null;
    }
    __viewerHistory = [];
    __viewerRedoStack = [];
    __expandedFieldId = null; // ★ 加這行：避免下一次點擊被誤判為「收合」
    viewer?.classList.remove("show");
    form?.classList.remove("hide");
  }

  function pushViewerHistory(v) {
    if (
      !__viewerHistory.length ||
      __viewerHistory[__viewerHistory.length - 1] !== v
    ) {
      __viewerHistory.push(v);
      if (__viewerHistory.length > 100) __viewerHistory.shift();
    }
    __viewerRedoStack = [];
  }
  function viewerUndo() {
    const v = document.getElementById("viewerBody");
    if (__viewerHistory.length <= 1) return;
    const cur = __viewerHistory.pop();
    __viewerRedoStack.push(cur);
    v.value = __viewerHistory[__viewerHistory.length - 1];
    if (v.__formSync) v.__formSync();
  }
  function viewerRedo() {
    const v = document.getElementById("viewerBody");
    if (!__viewerRedoStack.length) return;
    const redo = __viewerRedoStack.pop();
    v.value = redo;
    if (v.__formSync) v.__formSync();
    pushViewerHistory(v.value);
  }
  function viewerCopy() {
    const t = document.getElementById("viewerBody").value || "";
    if (!t) return alert("沒有可複製的內容");
    (navigator.clipboard?.writeText(t) || Promise.reject())
      .then(() => alert("已複製內容"))
      .catch(() => {
        try {
          const ta = document.createElement("textarea");
          ta.value = t;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          alert("已複製內容");
        } catch (_) {
          alert("複製失敗");
        }
      });
  }

  /* ===== 調色盤 ===== */
  function setAppBgColor(color) {
    const body = document.body;
    if (color === "metal") {
      body.classList.add("bg-metal");
      document.documentElement.style.setProperty("--app-bg", "#ececec");
    } else {
      body.classList.remove("bg-metal");
      document.documentElement.style.setProperty("--app-bg", color);
    }
    try {
      localStorage.setItem("app_bg_fixed", color);
    } catch (_) {}
  }
  function applySavedBgColor() {
    try {
      const saved = localStorage.getItem("app_bg_fixed");
      if (saved) setAppBgColor(saved);
    } catch (_) {}
  }
  applySavedBgColor();

  document
    .getElementById("openPaletteBtn")
    .addEventListener("click", () => openModal("paletteModal"));
  let pendingColor = null;
  document.addEventListener("click", (e) => {
    const tile = e.target.closest(".palette-choice");
    if (!tile) return;
    const wrap = document.getElementById("paletteModal");
    wrap
      .querySelectorAll(".palette-choice")
      .forEach((t) => t.classList.remove("selected"));
    tile.classList.add("selected");
    pendingColor = tile.dataset.color;
  });
  document.getElementById("paletteConfirmBtn").addEventListener("click", () => {
    if (pendingColor) setAppBgColor(pendingColor);
    closeModal("paletteModal");
  });

  // 新增：讓「取消」關閉調色盤（並順手清空選取狀態）
  document.getElementById("paletteCancelBtn").addEventListener("click", () => {
    pendingColor = null;
    document
      .querySelectorAll("#paletteModal .palette-choice")
      .forEach((el) => el.classList.remove("selected"));
    closeModal("paletteModal");
  });

  /* ===== 互動補強 ===== */
  // 點背景關閉 modal
  // 點背景關閉 modal（※ detailModal 例外：點背景不關）
  document.addEventListener("click", (e) => {
    const modal = e.target.closest(".modal");
    if (!modal) return;
    if (getComputedStyle(modal).display === "none") return;

    // 「備忘內容」視窗不啟用背景點擊關閉
    if (modal.id === "detailModal") return;

    const content = modal.querySelector(".modal-content");
    if (!content || !content.contains(e.target)) closeModal(modal.id);
  });

  // Esc 關閉
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal").forEach((m) => {
        if (getComputedStyle(m).display !== "none") closeModal(m.id);
      });
      closeFabMenu(); // ← 新增：若 menu 展開也一併收
    }
  });

  /* ===== 其他 ===== */
  function formatRocDateTime(ts) {
    if (!ts && ts !== 0) return "";
    const d = new Date(ts);
    if (isNaN(d)) return "";
    const y = d.getFullYear() - 1911,
      m = d.getMonth() + 1,
      dd = d.getDate();
    const hh = String(d.getHours()).padStart(2, "0"),
      mm = String(d.getMinutes()).padStart(2, "0");
    return `${y}/${m}/${dd} ${hh}:${mm}`;
  }

  /* ===== 初始資料 ===== */
  document.addEventListener("DOMContentLoaded", () => {
    try {
      memoView = localStorage.getItem("memo_view") || "active";
      memoMonthFilterActive =
        localStorage.getItem("memo_filter_active") || "all";
      memoMonthFilterRemoved =
        localStorage.getItem("memo_filter_removed") || "all";
    } catch (_) {}
    // 預設先畫空容器，等雲端回來再畫
    renderSections(categories);
  });

  function openLogoutModal() {
    openModal("logoutModal");
  }

  function showView(view) {
    const login = document.getElementById("loginPage");
    const app = document.getElementById("app");
    const load = document.getElementById("loadingScreen");

    login.style.display = view === "login" ? "flex" : "none";
    app.style.display = view === "app" ? "block" : "none";
    load.style.display = view === "loading" ? "flex" : "none";
  }

  // ===== Section 空白處：長按新增備忘（不阻擋捲動）＋ 輕點彈跳 =====
  (function enableCleanLongPressNewMemo() {
    const PRESS_MS = 900; // 長按門檻
    const MOVE_TOL = 10; // 位移門檻
    const PRESS_VISUAL_DELAY = 100; // 視覺壓下延遲

    const container = document.getElementById("section-container");
    if (!container) return;

    let timer = null,
      visualTimer = null;
    let startX = 0,
      startY = 0;
    let moved = false,
      longPressed = false;
    let pressSection = null;

    function isEligibleTarget(e) {
      if (memoView === "removed") return false;

      if (isEditing) return false; // 編輯分類時停用
      const sec = e.target.closest(".section"); // 必須點在分類區塊裡
      if (!sec) return false;
      if (e.target.closest(".task")) return false; // 不是點在卡片上
      if (e.target.closest(".drag-handle")) return false; // 不是把手
      return sec;
    }

    function clearTimers() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (visualTimer) {
        clearTimeout(visualTimer);
        visualTimer = null;
      }
    }

    function removePressVisual() {
      if (pressSection) pressSection.classList.remove("__pressed");
    }

    function pointerDown(e) {
      const sec = isEligibleTarget(e);
      if (!sec) return;

      pressSection = sec;
      longPressed = false;
      moved = false;

      const p = e.touches ? e.touches[0] : e;
      startX = p.clientX;
      startY = p.clientY;

      clearTimers();

      // 視覺壓下（稍微延遲，避免一開始就縮小）
      visualTimer = setTimeout(() => {
        pressSection && pressSection.classList.add("__pressed");
      }, PRESS_VISUAL_DELAY);

      // 長按計時：到時觸發新增備忘並預選該分類
      timer = setTimeout(() => {
        longPressed = true;
        removePressVisual();
        clearTimers();
        openMemoModal(pressSection?.id);
      }, PRESS_MS);
    }

    function pointerMove(e) {
      if (!timer && !visualTimer) return;
      const p = e.touches ? e.touches[0] : e;
      const dx = Math.abs(p.clientX - startX);
      const dy = Math.abs(p.clientY - startY);

      // 移動太多或明顯垂直捲動 → 取消長按
      const verticalIntent = dy > dx + 2;
      if (dx > MOVE_TOL || dy > MOVE_TOL || verticalIntent) {
        moved = true;
        clearTimers();
        removePressVisual();
      }
    }

    function pointerUpOrCancel(e) {
      const wasLong = longPressed;
      clearTimers();

      // 短按且沒移動 → 小彈跳回饋
      if (pressSection && !wasLong && !moved) {
        const stillOk = isEligibleTarget(e) === pressSection;
        if (stillOk) {
          pressSection.classList.add("__bump");
          setTimeout(
            () => pressSection && pressSection.classList.remove("__bump"),
            200
          );
        }
      }
      removePressVisual();
      pressSection = null;
      moved = false;
      longPressed = false;
    }

    // 綁定（滑鼠 + 觸控）；觸控設為 passive 讓捲動順暢
    container.addEventListener("mousedown", pointerDown);
    container.addEventListener("mousemove", pointerMove);
    document.addEventListener("mouseup", pointerUpOrCancel);

    container.addEventListener("touchstart", pointerDown, {
      passive: true,
    });
    container.addEventListener("touchmove", pointerMove, { passive: true });
    container.addEventListener("touchend", pointerUpOrCancel, {
      passive: true,
    });
    container.addEventListener("touchcancel", pointerUpOrCancel, {
      passive: true,
    });
  })();

  function show(el) {
    if (el) el.style.display = "flex";
  }
  function hide(el) {
    if (el) el.style.display = "none";
  }

  let BOOT_GRACE_UNTIL = 0;
  let offAuth = null;

  function attachAuthObserver() {
    if (offAuth)
      try {
        offAuth();
      } catch (_) {}
    offAuth = auth.onAuthStateChanged((user) => {
      const now = performance.now();

      // 🚫 啟動寬限期內，拿到 null 先忽略（避免先切到登入頁）
      if (!user && now < BOOT_GRACE_UNTIL) return;

      const app = document.getElementById("app");
      const overlay = document.getElementById("autologin-overlay");

      if (user) {
        roomPath = hydrateRoomPath();
        bindFirebase();
        if (app) app.style.display = "block";
        if (overlay) overlay.style.display = "none";
        document.documentElement.classList.add("show-app");
        document.documentElement.classList.remove("show-login");
      } else {
        // 超過寬限還是沒有使用者 → 才真的顯示登入頁
        document.documentElement.classList.add("show-login");
        document.documentElement.classList.remove("show-app");
        if (overlay) overlay.style.display = "none";
      }
    });
  }

  async function bootFromTask() {
    const overlay = document.getElementById("autologin-overlay");
    const app = document.getElementById("app");

    // 設定寬限（支援 fast_switch）
    const fast = sessionStorage.getItem("fast_switch") === "1";
    sessionStorage.removeItem("fast_switch");
    const graceMs = fast ? 800 : 400;
    BOOT_GRACE_UNTIL = performance.now() + graceMs;

    attachAuthObserver();

    try {
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    } catch (_) {}

    // 快速路徑：session 已還原
    if (auth.currentUser && auth.currentUser.uid) {
      roomPath = hydrateRoomPath();
      bindFirebase();
      if (app) app.style.display = "block";
      if (overlay) overlay.style.display = "none";
      return;
    }

    // 過了寬限還沒有使用者 → 只開 overlay，不進登入頁（登入頁交給觀察者在超時後切）
    setTimeout(() => {
      if (!auth.currentUser && overlay) overlay.style.display = "flex";
    }, graceMs);
  }

  document.addEventListener("DOMContentLoaded", bootFromTask);

  function sanitizeKey(s) {
    return String(s).replace(/[.#$/\[\]\/]/g, "_");
  }

  function hydrateRoomPath() {
    const u = auth?.currentUser || null;
    return u && u.uid ? `rooms/${u.uid}` : null; // 與 MyTask 一致
  }

  async function logout() {
    try {
      localStorage.removeItem("todo_room_info");
    } catch (_) {}
    try {
      await auth.signOut();
    } catch (_) {}
    window.location.href = "index.html";
  }
  // --- 看門狗（只有真的在嘗試登入時才會啟動） ---
  let __loginPending = false;
  let __autoLoginWD = null;

  function startAutoLoginWatchdog(ms = 8000) {
    stopAutoLoginWatchdog();
    __loginPending = true;
    __autoLoginWD = setTimeout(() => {
      if (!__loginPending) return;
      console.warn("[auto] login watchdog fired");
      runAutoLoginRescue(); // 可選：見下
    }, ms);
  }
  function stopAutoLoginWatchdog() {
    __loginPending = false;
    if (__autoLoginWD) {
      clearTimeout(__autoLoginWD);
      __autoLoginWD = null;
    }
  }

  let __authUnsub = null;
  function attachAuthObserver() {
    try {
      __authUnsub?.();
    } catch {}
    __authUnsub = auth.onAuthStateChanged((user) => {
      const overlay = document.getElementById("autologin-overlay");
      const app = document.getElementById("app");

      if (user && user.uid) {
        roomPath = hydrateRoomPath();
        bindFirebase(); // 綁定 memos / memoCategories
        app.style.display = "block"; // 顯示 App
        if (overlay) overlay.style.display = "none";
      } else {
        unbindFirebase(); // 清掉監聽
        app.style.display = "none"; // 先不導回登入，只顯示遮罩等待 Session 還原
        if (overlay) overlay.style.display = "flex";
      }
    });
  }

  // ---（可選）救援：硬重置 Firebase 並重新登入匿名 ---
  async function runAutoLoginRescue() {
    try {
      console.warn("[auto] rescue: hard reset firebase");
      unbindFirebase();
      try {
        await firebase.app().delete();
      } catch (_) {}
      firebase.initializeApp(firebaseConfig);
      auth = firebase.auth();
      db = firebase.database();
      attachAuthObserver(); // 重新綁觀察者

      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      await auth.signInAnonymously();
    } catch (e) {
      console.error("[auto] rescue failed", e);
      alert("登入逾時，請重新整理或稍後再試");
      document.getElementById("autologin-overlay").style.display = "none";
    } finally {
      stopAutoLoginWatchdog();
    }
  }

  // === 讓編輯模式在 re-render 後持續套用 ===
  function applyEditModeUI() {
    if (!isEditing || memoView !== "active") return;

    document.querySelectorAll(".section").forEach((sec) => {
      sec.classList.add("edit-mode");
      const bar = sec.querySelector(".section-title");
      const name = sec.id;
      bar.innerHTML = `
      <span class="drag-handle">☰</span>
      <span class="section-name">${name}</span>
      <button class="rename-btn" title="重命名">✎</button>
      <button class="delete-btn" title="刪除此分類">✕</button>
    `;

      bar.querySelector(".rename-btn").onclick = () => {
        pendingRenameId = sec.id;
        document.getElementById("renameInput").value = sec.id;
        openModal("renameModal");
      };
      bar.querySelector(".delete-btn").onclick = () =>
        confirmDeleteCategory(sec.id);
    });

    // 只在編輯時啟用拖拉
    initSectionSortable?.();
    initMemoSortables();

    // 底部的 ✅ 要持續顯示
    const exitBtn = document.getElementById("exitEditBtn");
    if (exitBtn) exitBtn.style.display = "block";
  }

  // 已移除檢視中的分類顯示：當前仍存在 → 原名；當前已刪 → 加 (已移除)
  function getRemovedSectionLabel(name) {
    const alive = (categories || []).includes(name);
    return alive ? name : `${name}(已移除)`;
  }

  const REMOVED_SUFFIX = "(已移除)";

  function stripRemovedSuffix(name = "") {
    return name.endsWith(REMOVED_SUFFIX)
      ? name.slice(0, -REMOVED_SUFFIX.length)
      : name;
  }

  function getRemovedSectionLabel(name) {
    // name 可能已經帶了(已移除)，先還原成原名後再決定顯示
    const base = stripRemovedSuffix(name);
    const alive = (categories || []).includes(base);
    return alive ? base : `${base}${REMOVED_SUFFIX}`;
  }

  /* ===== Google Drive × MyMemo（單檔全包；參考你 MyTask 版本）===== */
  /* ✅ 你的 Google OAuth Client ID（沿用你提供的） */
  const GOOGLE_CLIENT_ID =
    "735593435771-otisn8depskof8vmvp6sp5sl9n3t5e25.apps.googleusercontent.com";

  /* 權限：僅限本 App 建立/讀取 + 讀取檔名 */
  const GD_SCOPES = [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/drive.metadata.readonly",
  ].join(" ");

  /* --- 內部狀態 --- */
  let __gapiReady = false;
  let __gisReady = false;
  let __tokenClient = null;

  /* ✅ 第一次授權後要自動補跑一次的旗標 & 預備視窗 */
  const GD_POST_OPEN_KEY = "gdrive_post_open_memo";
  let __gd_prewin = null;

  const POST_OPEN_TTL = 15000; // 15秒有效視窗

  const postOpen = {
    set() {
      try {
        sessionStorage.setItem(GD_POST_OPEN_KEY, String(Date.now()));
      } catch {}
    },
    isFresh() {
      try {
        const t = +sessionStorage.getItem(GD_POST_OPEN_KEY) || 0;
        return t && Date.now() - t < POST_OPEN_TTL;
      } catch {
        return false;
      }
    },
    clear() {
      try {
        sessionStorage.removeItem(GD_POST_OPEN_KEY);
      } catch {}
    },
  };

  /* 判斷 iOS PWA（供開 App 深連結時使用） */
  const isIOSPWA = (() => {
    try {
      const ua = navigator.userAgent || "";
      const isiOS =
        /iPad|iPhone|iPod/.test(ua) ||
        (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
      const standalone = !!(
        window.matchMedia?.("(display-mode: standalone)")?.matches ||
        navigator.standalone
      );
      return isiOS && standalone;
    } catch {
      return false;
    }
  })();

  /* ---- 動態載入 Google SDK（單檔統包）---- */
  function addScriptOnce(src, id) {
    return new Promise((res, rej) => {
      if (id && document.getElementById(id)) return res();
      const s = document.createElement("script");
      if (id) s.id = id;
      s.src = src;
      s.async = true;
      s.defer = true;
      s.onload = () => res();
      s.onerror = () => rej(new Error("load fail: " + src));
      document.head.appendChild(s);
    });
  }

  async function loadGapiOnce() {
    if (__gapiReady && __gisReady && __tokenClient) return;

    if (!window.google?.accounts?.oauth2) {
      await addScriptOnce(
        "https://accounts.google.com/gsi/client",
        "gsi_client_js"
      );
    }
    if (!window.gapi) {
      await addScriptOnce("https://apis.google.com/js/api.js", "gapi_js");
    }

    await new Promise((r) => gapi.load("client", r));
    await gapi.client.init({});
    // ✅ 改用 discovery doc，Safari 穩定很多
    await gapi.client.load(
      "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"
    );
    __gapiReady = true;

    __tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GD_SCOPES,
      callback: () => {},
      // ✅ 先關掉，避免 Safari / iOS 無聲失敗
      // use_fedcm_for_prompt: true,
    });
    __gisReady = true;
  }

  /* ---- OAuth / Token ---- */
  // 取代你現有的 ensureDriveAuth()
  // 取代你現有的 ensureDriveAuth（其餘不動）
  async function ensureDriveAuth() {
    await loadGapiOnce();

    // 若 token 仍有效，直接通過
    const skew = 10 * 60 * 1000; // 10 分鐘緩衝
    const exp = +localStorage.getItem("gdrive_token_exp") || 0;
    const tok = gapi?.client?.getToken?.();
    if (tok?.access_token && Date.now() + skew < exp) return true;

    // 沒有手勢 & 也不是首次授權的補跑 → 絕不彈窗
    const canPrompt =
      __gd_userGesture || localStorage.getItem(GD_POST_OPEN_KEY) === "1";
    if (!canPrompt) return false;

    const alreadyConsented =
      localStorage.getItem("gdrive_consent_done") === "1";

    // 要求/更新 access token（必要時才 prompt）
    const resp = await new Promise((resolve, reject) => {
      __tokenClient.callback = (r) => {
        if (r?.access_token) return resolve(r);
        reject(r?.error || "授權失敗");
      };
      try {
        __tokenClient.requestAccessToken({
          prompt: alreadyConsented ? "" : "consent",
        });
      } catch (e) {
        if (alreadyConsented) {
          try {
            __tokenClient.requestAccessToken({ prompt: "consent" });
          } catch (e2) {
            reject(e2);
          }
        } else {
          reject(e);
        }
      }
    });

    // 記錄 token 與到期
    gapi.client.setToken({ access_token: resp.access_token });
    const ttl = resp.expires_in ? resp.expires_in * 1000 : 60 * 60 * 1000;
    localStorage.setItem("gdrive_token_exp", String(Date.now() + ttl - skew));
    localStorage.setItem("gdrive_consent_done", "1");

    // 首次授權的「自動補開資料夾」流程
    if (localStorage.getItem(GD_POST_OPEN_KEY) === "1") {
      setTimeout(async () => {
        try {
          const m = getCurrentDetailMemo();
          if (m) {
            const id = await ensureExistingOrRecreateFolder(m);
            updateDriveButtonState(m);
            openDriveFolderMobileFirst(id, null, __gd_prewin);
          }
        } finally {
          postOpen.clear();
          __gd_prewin = null;
        }
      }, 0);
    }

    return true;
  }

  /* ---- 外觀：按鈕高亮（有資料夾時） ---- */
  function ensureDriveGlowCss() {
    if (document.getElementById("driveGlowCss")) return;
    const css = `
    .btn-gdrive { margin-left:.35rem;padding:.4rem .6rem;border:1px solid #ddd;background:#f9f9f9;border-radius:6px;cursor:pointer; }
    .btn-gdrive.has-folder { background:#FFD54F; border-color:#FFC107; box-shadow:0 0 .6rem rgba(255,193,7,.6); animation:drive-glow 1.2s ease-in-out infinite alternate; }
    @keyframes drive-glow { from { box-shadow:0 0 .35rem rgba(255,193,7,.45);} to { box-shadow:0 0 1rem rgba(255,193,7,.95);} }
  `;
    const st = document.createElement("style");
    st.id = "driveGlowCss";
    st.textContent = css;
    document.head.appendChild(st);
  }
  function updateDriveButtonState(memoObj) {
    const btn = document.getElementById("gdriveBtn");
    if (!btn) return;
    const hasId = !!(
      memoObj &&
      (memoObj.driveFolderId || memoObj.gdriveFolderId)
    );
    btn.classList.toggle("has-folder", hasId);
  }

  /* ---- Drive：資料夾工具 ---- */
  function escapeForQuery(s) {
    return String(s).replace(/['\\]/g, "\\$&");
  }

  async function findOrCreateFolderByName(name, parentId /* or 'root' */) {
    const q = [
      `name = '${escapeForQuery(name)}'`,
      `mimeType = 'application/vnd.google-apps.folder'`,
      `'${parentId}' in parents`,
      "trashed = false",
    ].join(" and ");

    const list = await gapi.client.drive.files.list({
      q,
      fields: "files(id,name)",
      pageSize: 1,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });

    if (list?.result?.files?.length) return list.result.files[0].id;

    const created = await gapi.client.drive.files.create({
      resource: {
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      },
      fields: "id",
      supportsAllDrives: true,
    });
    return created.result.id;
  }

  async function ensureFolderPath(segments) {
    let parent = "root";
    for (const seg of segments)
      parent = await findOrCreateFolderByName(seg, parent);
    return parent; // 末端 id
  }

  /* ---- 開啟資料夾（行動裝置優先呼叫 App） ---- */
  function openDriveFolderWeb(id, preWin) {
    const webUrl = `https://drive.google.com/drive/folders/${id}`;
    const ua = (navigator.userAgent || "").toLowerCase();
    const isAndroid = /android/.test(ua);
    const isIOS =
      /iphone|ipad|ipod/.test(ua) ||
      ((navigator.userAgent || "").includes("Macintosh") &&
        navigator.maxTouchPoints > 1);

    const iosSchemeUrl = `googledrive://${webUrl}`;
    const androidIntentUrl =
      `intent://drive.google.com/drive/folders/${id}` +
      `#Intent;scheme=https;package=com.google.android.apps.docs;end`;

    const usePreWin = (url) => {
      try {
        if (preWin && !preWin.closed) {
          preWin.location.href = url;
          setTimeout(() => {
            try {
              preWin.close();
            } catch (_) {}
          }, 1500);
          return true;
        }
      } catch (_) {}
      return false;
    };

    if (isAndroid) {
      if (!usePreWin(androidIntentUrl)) window.location.href = androidIntentUrl;
      return;
    }
    if (isIOS) {
      if (isIOSPWA) {
        // iOS PWA：直接用頂層導向呼叫 App，避免留下空白分頁
        try {
          window.location.href = iosSchemeUrl;
        } catch (_) {}
        return;
      }
      // iOS Safari（非 PWA）：維持預備分頁邏輯
      if (!usePreWin(iosSchemeUrl)) window.location.href = iosSchemeUrl;
      return;
    }
    // 桌機 → 開網頁
    try {
      window.open(webUrl, "_blank")?.focus?.();
    } catch (_) {
      window.location.href = webUrl;
    }
  }
  /* ---- 取得目前「備忘詳情」對應的 Memo 物件 ---- */
  function getCurrentDetailMemo() {
    if (typeof selectedMemoId !== "undefined" && selectedMemoId) {
      return (
        (Array.isArray(memos) ? memos : []).find(
          (m) => m.id === selectedMemoId
        ) || null
      );
    }
    return null;
  }

  /* ---- 主流程：建立或開啟資料夾（MyMemo / 分類 / 標題） ---- */
  async function openOrCreateDriveFolderForCurrentMemo() {
    const m = getCurrentDetailMemo();
    if (!m) return;

    await ensureDriveAuth();

    const segs = [
      ROOT_APP_FOLDER,
      m.section || "未分類",
      (m.title || "未命名").slice(0, 100),
    ];
    const folderId = await ensureFolderPath(segs);

    // 記住 ID 並存雲
    m.driveFolderId = folderId;
    try {
      window.saveMemos?.();
    } catch (_) {}

    updateDriveButtonState(m);
    openDriveFolderWeb(folderId, __gd_prewin);
  }

  /* 若已有 ID，驗證存在；不存在則重建路徑 */
  async function ensureExistingOrRecreateFolder(m) {
    const token = await getDriveAccessToken();
    const { id: myMemoRootId, accountTag } = await ensureMyMemoRoot(token);

    // 有 id 先驗
    const knownId = m.gdriveFolderId || m.driveFolderId;
    if (knownId) {
      try {
        const meta = await driveFilesGet(knownId, token, "id,trashed");
        if (meta && !meta.trashed) return knownId;
      } catch {
        /* fallthrough */
      }
      m.gdriveFolderId = null;
      m.driveFolderId = null;
      try {
        window.saveMemos?.();
      } catch {}
    }

    // 先找
    let folderId = await findExistingMemoFolder(
      token,
      myMemoRootId,
      m,
      accountTag
    );

    // 找不到才建
    if (!folderId) {
      const name = buildMemoFolderName(m);
      const created = await driveCreateFolder(
        name,
        token,
        {
          product: PRODUCT_NAME,
          level: "memo",
          appAccount: accountTag,
          memoId: m.id,
          section: m.section || "",
        },
        myMemoRootId
      );
      folderId = created.id;
    }

    m.gdriveFolderId = folderId;
    m.driveFolderId = folderId;
    try {
      window.saveMemos?.();
    } catch {}
    return folderId;
  }

  /* 僅開啟（若沒記錄就轉主流程建立） */
  function openCurrentMemoDriveFolder() {
    const m = getCurrentDetailMemo();
    if (!m) return;
    const fid = m.driveFolderId || m.gdriveFolderId; // ← 兩個都支援
    if (fid) openDriveFolderWeb(fid);
    else openOrCreateDriveFolderForCurrentMemo();
  }

  /* ---- 在詳情「重要」右邊插入按鈕 ---- */
  function ensureDriveButtonsInlineUI(memoObj) {
    ensureDriveGlowCss();
    // 找到 詳情 的那一排（分類下拉 + 重要）
    const row = document.querySelector("#detailForm .inline-row");
    if (!row) return;

    if (!row.querySelector("#gdriveBtn")) {
      const btn = document.createElement("button");
      btn.id = "gdriveBtn";
      btn.type = "button";
      btn.title = "建立/開啟此備忘的雲端資料夾";
      btn.style.cssText =
        "width:30px;height:30px;aspect-ratio:1/1;padding:0;" +
        "border:1px solid #ddd;border-radius:6px;" +
        "background:#f9f9f9 url('https://cdn.jsdelivr.net/gh/a355226/kj-reminder@main/drive.png') no-repeat center/18px 18px;" +
        "display:inline-flex;align-items:center;justify-content:center;" +
        "appearance:none;-webkit-appearance:none;line-height:0;box-sizing:border-box;cursor:pointer;";
      btn.className = "btn-gdrive";
      row.appendChild(btn);
    }
    updateDriveButtonState(memoObj);
  }

  /* ---- 點擊行為（含第一次授權的預備視窗） ---- */
  async function onDriveButtonClickMemo() {
    const m = getCurrentDetailMemo();
    if (!m) return;

    try {
      __gd_userGesture = true; // 保留
      try {
        syncEditsIntoMemo?.(m);
      } catch (_) {}
      await openOrCreateDriveFolderForCurrentMemo(__gd_prewin);
      // ← 直接走 token+fetch 流派（和 MyTask 一樣）
    } catch (e) {
      const msg = e?.result?.error?.message || e?.message || String(e);
      alert("Google 雲端硬碟動作失敗：" + msg);
      console.error("Drive error:", e);
    } finally {
      __gd_userGesture = false;
    }
  }

  /* ---- 暖機：載入 SDK，pageshow 回補，首次授權後自動開啟 ---- */
  (function driveWarmup() {
    const kickoff = () => {
      loadGapiOnce().catch((e) => console.warn("Drive warmup failed:", e));
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", kickoff, {
        once: true,
      });
    } else {
      kickoff();
    }

    window.addEventListener(
      "pageshow",
      () => {
        if (!__gapiReady || !__gisReady || !__tokenClient) {
          loadGapiOnce().catch(() => {});
        }
        if (postOpen.isFresh()) {
          (async () => {
            try {
              await ensureDriveAuth();
              const m = getCurrentDetailMemo();
              if (m) {
                const id = await ensureExistingOrRecreateFolder(m);
                updateDriveButtonState(m);
                openDriveFolderMobileFirst(id, null, __gd_prewin);
              }
            } finally {
              postOpen.clear();
              __gd_prewin = null;
            }
          })().catch(() => {});
        }
      },
      { once: true }
    );
  })();

  // ---- 取代原本的 hookOpenDetailForMemo（延一幀插入）----
  (function hookOpenDetailForMemo() {
    const original = window.openDetail;
    window.openDetail = function (id) {
      original?.call(this, id);
      // 等詳情 DOM 真正 render 完再插入按鈕
      requestAnimationFrame(() => {
        try {
          ensureDriveButtonsInlineUI(getCurrentDetailMemo());
        } catch (_) {}
      });
    };
  })();

  // ---- 全域事件委派：不靠 btn.onclick，避免被重繪吃掉 ----
  document.addEventListener(
    "click",
    (e) => {
      const btn = e.target.closest("#gdriveBtn");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      // 明確呼叫，任何時機都吃得到
      (async () => {
        try {
          await onDriveButtonClickMemo();
        } catch (err) {
          const msg =
            err?.result?.error?.message || err?.message || String(err);
          alert("Google 雲端硬碟動作失敗：" + msg);
          console.error("Drive error:", err);
        }
      })();
    },
    false
  );

  // === Google Drive (最小：drive.file) ===
  const GOOGLE_OAUTH_CLIENT_ID =
    "735593435771-otisn8depskof8vmvp6sp5sl9n3t5e25.apps.googleusercontent.com"; // ← 換成你的
  let __driveAccessToken = null;

  async function getDriveAccessToken() {
    if (!window.google?.accounts?.oauth2) {
      throw new Error("Google 登入模組尚未載入");
    }
    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_OAUTH_CLIENT_ID,
        scope: "https://www.googleapis.com/auth/drive.file",
        prompt: "", // 曾同意就不跳
        callback: (resp) => {
          if (resp?.access_token) {
            __driveAccessToken = resp.access_token;
            resolve(__driveAccessToken);
          } else reject(new Error("無法取得存取權"));
        },
      });
      client.requestAccessToken();
    });
  }

  // 只對「已知 id」讀取必要欄位（不列清單）
  async function driveFilesGet(
    fileId,
    token,
    fields = "id,trashed,webViewLink"
  ) {
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId
      )}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`,
      { headers: { Authorization: "Bearer " + token } }
    );
    if (r.status === 404) throw new Error("not_found");
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  // 建立資料夾（名稱自訂；可帶 appProperties）
  // 建立資料夾（名稱自訂；可帶 appProperties；✅ 支援 parentId）
  async function driveCreateFolder(
    name,
    token,
    appProps = {},
    parentId = "root"
  ) {
    const meta = {
      name,
      mimeType: "application/vnd.google-apps.folder",
      appProperties: Object.assign({ app: PRODUCT_APP }, appProps),
      parents: parentId ? [parentId] : ["root"],
    };
    const r = await fetch(
      "https://www.googleapis.com/drive/v3/files?fields=id,webViewLink&supportsAllDrives=true",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(meta),
      }
    );
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  // 任務資料夾命名（你可以按喜好調）
  function buildMemoFolderName(memo) {
    const parts = [];
    if (memo.section) parts.push(`[${memo.section}]`);
    if (memo.title) parts.push(memo.title);
    if (memo.date) parts.push(memo.date);
    return parts.filter(Boolean).join(" ");
  }

  /* ✅ 新增：行動裝置優先開 Google Drive App，桌機走網頁 */
  function openDriveFolderMobileFirst(folderId, webLink, preWin) {
    const webUrl =
      webLink || `https://drive.google.com/drive/folders/${folderId}`;
    const ua = (navigator.userAgent || "").toLowerCase();
    const isAndroid = /android/.test(ua);
    const isIOS =
      /iphone|ipad|ipod/.test(ua) ||
      ((navigator.userAgent || "").includes("Macintosh") &&
        navigator.maxTouchPoints > 1);

    const iosSchemeUrl = `googledrive://${webUrl}`;
    const androidIntentUrl =
      `intent://drive.google.com/drive/folders/${folderId}` +
      `#Intent;scheme=https;package=com.google.android.apps.docs;end`;

    const usePreWin = (url) => {
      try {
        if (preWin && !preWin.closed) {
          preWin.location.href = url;
          setTimeout(() => {
            try {
              preWin.close();
            } catch (_) {}
          }, 1500);
          return true;
        }
      } catch (_) {}
      return false;
    };

    if (isAndroid) {
      if (!usePreWin(androidIntentUrl)) window.location.href = androidIntentUrl;
      return;
    }
    if (isIOS) {
      // PWA 直接換到 scheme，避免殘留空白分頁
      const isPWA = !!(
        window.matchMedia?.("(display-mode: standalone)")?.matches ||
        navigator.standalone
      );
      if (isPWA) {
        try {
          window.location.href = iosSchemeUrl;
        } catch (_) {}
        return;
      }
      if (!usePreWin(iosSchemeUrl)) window.location.href = iosSchemeUrl;
      return;
    }

    // 桌機：開新分頁
    try {
      window.open(webUrl, "_blank")?.focus?.();
    } catch (_) {
      window.location.href = webUrl;
    }
  }

  // 核心：開啟或建立（若被刪/丟垃圾桶 → 重建）
  // 用「token + fetch」流派，和 MyTask 完全同款；不再用 ensureFolderPath / files.list
  // ✅ 與 MyTask 同步：統一用 folderId / webLink，最後只開一次，並支援 preWin
  async function openOrCreateDriveFolderForCurrentMemo(preWin) {
    const m = getCurrentDetailMemo();
    if (!m) return;

    const token = await getDriveAccessToken();
    const { id: myMemoRootId, accountTag } = await ensureMyMemoRoot(token);

    let folderId = null;
    let webLink = null;

    // 1) 有舊 ID → 驗證可用就直接開
    const knownId = m.gdriveFolderId || m.driveFolderId;
    if (knownId) {
      try {
        const meta = await driveFilesGet(
          knownId,
          token,
          "id,trashed,webViewLink"
        );
        if (meta && !meta.trashed) {
          folderId = meta.id;
          webLink =
            meta.webViewLink ||
            `https://drive.google.com/drive/folders/${meta.id}`;
        }
      } catch (_) {
        // 404/權限 → 當作不存在
      }
    }

    // 2) 沒有/失效 → 精準找（appProperties）
    if (!folderId) {
      folderId = await findExistingMemoFolder(
        token,
        myMemoRootId,
        m,
        accountTag
      );
    }

    // 3) 仍沒有 → 建立
    if (!folderId) {
      const name = buildMemoFolderName(m);
      const created = await driveCreateFolder(
        name,
        token,
        {
          product: PRODUCT_NAME,
          level: "memo",
          appAccount: accountTag,
          memoId: m.id,
          section: m.section || "",
        },
        myMemoRootId
      );
      folderId = created.id;
      webLink =
        created.webViewLink ||
        `https://drive.google.com/drive/folders/${created.id}`;
    }

    // 4) 回寫（兩個欄位都寫，維持舊版相容）
    m.gdriveFolderId = folderId;
    m.driveFolderId = folderId;
    try {
      window.saveMemos?.();
    } catch (_) {}

    // 5) 最後只開一次（手機優先 App；桌機新分頁）
    openDriveFolderMobileFirst(folderId, webLink, preWin ?? __gd_prewin);
  }

  // 讓詳情畫面出現一顆 GDrive 按鈕（只在非唯讀時顯示）
  // 讓詳情畫面出現一顆 GDrive 按鈕（只在非唯讀時顯示）—樣式/擺放對齊 2.
  function ensureDriveButtonsInlineUI(memoObj) {
    ensureDriveGlowCss(); // 可重用
    const row = document.querySelector("#detailForm .inline-row");
    if (!row) return;

    let btn = row.querySelector("#gdriveBtn");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "gdriveBtn";
      btn.type = "button";
      btn.title = "建立/開啟此備忘的雲端資料夾";
      btn.setAttribute("aria-label", "Google 雲端硬碟");
      btn.style.cssText =
        "width:30px;height:30px;aspect-ratio:1/1;padding:0;" +
        "border:1px solid #ddd;border-radius:6px;" +
        "background:#f9f9f9 url('https://cdn.jsdelivr.net/gh/a355226/kj-reminder@main/drive.png') no-repeat center/18px 18px;" +
        "display:inline-flex;align-items:center;justify-content:center;" +
        "appearance:none;-webkit-appearance:none;line-height:0;box-sizing:border-box;cursor:pointer;";
      btn.className = "btn-gdrive";
      row.appendChild(btn);
    }

    updateDriveButtonState(memoObj);
  }

  // === 唯一性標記 ===
  const PRODUCT_APP = "kjreminder";
  const PRODUCT_NAME = "MyMemo";

  function getAppAccountLabel() {
    // 1) 先從已解析好的 roomPath 擷取 username：rooms/{username}-{password}
    if (typeof roomPath === "string" && roomPath.startsWith("rooms/")) {
      const m = roomPath.match(/^rooms\/([^-\s]+)-/);
      if (m && m[1]) return m[1];
    }

    // 2) 退而求其次：從本機儲存的登入資訊還原 username
    try {
      const saved =
        sessionStorage.getItem("todo_room_info") ||
        localStorage.getItem("todo_room_info") ||
        sessionStorage.getItem("todo_room_info_session") ||
        localStorage.getItem("todo_room_info_session");
      if (saved) {
        const obj = JSON.parse(saved);
        if (obj?.username) return obj.username;
      }
    } catch {}

    // 3) 再退：若 Firebase 有 email（非匿名），也可當帳號標籤
    try {
      const email =
        typeof auth !== "undefined" && auth?.currentUser?.email
          ? auth.currentUser.email
          : null;
      if (email) return email;
    } catch {}

    // 4) 最後才用你原本的備用來源
    return (
      window.memoOwnerTag ||
      window.currentUserEmail ||
      window.user?.email ||
      localStorage.getItem("app_login_email") ||
      "user"
    );
  }

  function sanitizeForName(s) {
    // 移除雲端硬碟不允許的字元，避免名字無效
    return (
      String(s)
        .replace(/[\\/:*?"<>|[\]\n\r]/g, "")
        .trim()
        .slice(0, 40) || "user"
    );
  }
  function buildRootFolderName(accountTag) {
    return `MyMemo(${sanitizeForName(accountTag)})`;
  }

  async function findExistingRootByAccount(token, accountTag) {
    const name = buildRootFolderName(accountTag);
    const q = [
      `name = '${escapeForQuery(name)}'`,
      `mimeType = 'application/vnd.google-apps.folder'`,
      `'root' in parents`,
      "trashed = false",
      `appProperties has { key='app' and value='${PRODUCT_APP}' }`,
      `appProperties has { key='product' and value='${PRODUCT_NAME}' }`,
      `appProperties has { key='appAccount' and value='${escapeForQuery(
        accountTag
      )}' }`,
    ].join(" and ");

    const resp = await gapi.client.drive.files.list({
      q,
      fields: "files(id,name)",
      pageSize: 1,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    return resp?.result?.files?.[0]?.id || null;
  }

  async function ensureMyMemoRoot(token) {
    const accountTag = sanitizeForName(getAppAccountLabel());
    const LS_KEY = `gdrive_mymemo_root_id_${accountTag}`;

    // 先用本機快取
    let id = localStorage.getItem(LS_KEY) || null;
    if (id) {
      try {
        const meta = await driveFilesGet(id, token, "id,trashed");
        if (!meta || meta.trashed) id = null;
      } catch {
        id = null;
      }
    }

    // 再用 Drive 側精準查找
    if (!id) id = await findExistingRootByAccount(token, accountTag);

    // 都沒有 → 建立（名稱帶入帳號）
    if (!id) {
      const created = await driveCreateFolder(
        buildRootFolderName(accountTag),
        token,
        { product: PRODUCT_NAME, level: "root", appAccount: accountTag },
        "root"
      );
      id = created.id;
    }

    try {
      localStorage.setItem(LS_KEY, id);
    } catch {}
    return { id, accountTag };
  }

  async function findExistingMemoFolder(token, rootId, memo, accountTag) {
    const q = [
      `mimeType = 'application/vnd.google-apps.folder'`,
      `'${rootId}' in parents`,
      "trashed = false",
      `appProperties has { key='app' and value='${PRODUCT_APP}' }`,
      `appProperties has { key='product' and value='${PRODUCT_NAME}' }`,
      `appProperties has { key='level' and value='memo' }`,
      `appProperties has { key='appAccount' and value='${escapeForQuery(
        accountTag
      )}' }`,
      `appProperties has { key='memoId' and value='${escapeForQuery(
        memo.id
      )}' }`,
    ].join(" and ");

    const resp = await gapi.client.drive.files.list({
      q,
      fields: "files(id,name)",
      pageSize: 1,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    return resp?.result?.files?.[0]?.id || null;
  }

  //--------------------------------------------------驗證用

  Object.assign(window, {
    onDriveButtonClickMemo,
    openCurrentMemoDriveFolder,
    openOrCreateDriveFolderForCurrentMemo,
    ensureDriveButtonsInlineUI,
  });

  /* ===== Search 狀態與工具 ===== */
  let searchQuery = "";
  let searchTokens = [];

  function setSearchQuery(q = "") {
    searchQuery = (q || "").trim();
    searchTokens = searchQuery
      ? searchQuery.toLowerCase().split(/\s+/).filter(Boolean)
      : [];
    renderAll();
  }

  // 只比對「標題 + 內容」
  function memoMatchesSearch(m) {
    if (!searchTokens.length) return true;
    const hay = ((m.title || "") + " " + (m.content || "")).toLowerCase();
    return searchTokens.every((tok) => hay.includes(tok));
  }

  // 安全轉義 + 高亮
  function escHTML(s = "") {
    return String(s).replace(
      /[&<>"']/g,
      (ch) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[ch])
    );
  }
  function hiHTML(s = "", tokens) {
    if (!tokens?.length) return escHTML(s);
    let out = escHTML(s);
    tokens.forEach((t) => {
      if (!t) return;
      const re = new RegExp(
        `(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
        "gi"
      );
      out = out.replace(re, '<span class="hl">$1</span>');
    });
    return out;
  }
  function makeSnippet(text = "", tokens, max = 80) {
    const raw = text || "";
    if (!tokens?.length)
      return raw.length > max ? raw.slice(0, max - 1) + "…" : raw;
    const lower = raw.toLowerCase();
    let pos = -1;
    for (const t of tokens) {
      const i = lower.indexOf(t);
      if (i >= 0) {
        pos = i;
        break;
      }
    }
    if (pos < 0) return raw.length > max ? raw.slice(0, max - 1) + "…" : raw;
    const start = Math.max(0, pos - Math.floor(max / 2));
    const end = Math.min(raw.length, start + max);
    const slice =
      (start > 0 ? "…" : "") +
      raw.slice(start, end) +
      (end < raw.length ? "…" : "");
    return slice;
  }

  document.addEventListener("DOMContentLoaded", () => {
    // 綁定 moreModal 搜尋欄
    let __searchDebounce = null;
    function bindModalSearch() {
      const box = document.getElementById("taskSearchInput");
      const clear = document.getElementById("taskSearchClear");
      if (!box || box.__bound) return;
      box.__bound = true;

      const syncClear = () => {
        if (clear) clear.style.visibility = box.value ? "visible" : "hidden";
      };

      // 初始
      box.value = searchQuery;
      syncClear();

      box.addEventListener("input", (e) => {
        clearTimeout(__searchDebounce);
        __searchDebounce = setTimeout(() => {
          setSearchQuery(e.target.value);
          syncClear();
        });
      });

      // Esc 清除
      box.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          box.value = "";
          setSearchQuery("");
          syncClear();
        }
      });

      // 右側 X
      clear?.addEventListener("click", () => {
        box.value = "";
        setSearchQuery("");
        syncClear();
        box.focus();
      });
    }

    // 打開 moreModal 時，同步搜尋欄位與按鈕狀態
    const _openModal = window.openModal;
    window.openModal = function (id) {
      _openModal.call(this, id);
      if (id === "moreModal") {
        // 你的檢視切換保持不變，這裡只處理搜尋欄
        const box = document.getElementById("taskSearchInput");
        const clear = document.getElementById("taskSearchClear");
        if (box) {
          bindModalSearch();
          box.value = searchQuery;
          if (clear) clear.style.visibility = box.value ? "visible" : "hidden";
          setTimeout(() => box.focus(), 0);
        }
      }
    };
  });

  // === 快速切換提示（MyMemo → MyTask 不要閃登入頁） ===
  (function setupFastSwitchHint() {
    function mark() {
      try {
        const now = String(Date.now());
        // 同步寫兩邊，並帶上時間戳，與舊版、MyTask 完全相容
        sessionStorage.setItem("fast_switch", "1");
        sessionStorage.setItem("fast_switch_at", now);
        localStorage.setItem("fast_switch", "1");
        localStorage.setItem("fast_switch_at", now);
      } catch {}
    }

    // 點去 MyTask（/mytask 或 /task 都吃）就標記
    document.addEventListener(
      "click",
      (e) => {
        const a = e.target.closest("a[href]");
        if (!a) return;
        const href = a.getAttribute("href") || "";
        if (/(^|\/)(mytask|task)(\.html)?([?#].*)?$/i.test(href)) mark();
      },
      true
    );

    // 程式導頁保險（登出時會設 just_logged_out，不要誤標記）
    window.addEventListener("beforeunload", () => {
      try {
        if (!sessionStorage.getItem("just_logged_out")) mark();
      } catch {}
    });

    // 若你有用 JS 手動切頁，可主動呼叫
    window.markFastSwitchForNextPage = mark;
  })();

  /* ===== 將 HTML inline 會呼叫到的函式掛到 window（全域） ===== */
  const __exports = {
    // Modal / Menu
    openModal,
    closeModal,
    toggleMenu,
    closeFabMenu, // 雖然目前沒有 inline 呼叫，但給外界可用

    // Memo：新增／詳情／刪除
    openMemoModal,
    addMemo,
    saveMemo,
    confirmDelete,
    deleteMemo,

    // 詳情的展開閱讀器工具
    toggleDetailExpand,
    viewerUndo,
    viewerRedo,
    viewerCopy,

    // 分類：新增／編輯模式／重命名／刪除
    openCategoryModal,
    addCategory,
    enterEditMode,
    exitEditMode,
    confirmRename,
    deleteCategoryConfirmed,

    // 登出
    openLogoutModal,
    doLogout,
  };

  // 掛上去
  Object.entries(__exports).forEach(([k, v]) => (window[k] = v));

  // openDetail：保留既有 hook（若有），否則才匯出本體；同時把真本體備份出去
  window.__realOpenDetail = openDetail;
  window.openDetail ??= openDetail;

  // --- 這行以上 ---
})();

// 小保險：確保在 DOM 準備好後再跑需要抓節點的流程（可留可不留）
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {});
} else {
  // DOM 已就緒
}
