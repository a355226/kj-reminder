(() => {
  // --- 這行以下貼你的原本腳本（原樣貼上即可） ---
  document.addEventListener(
    "keydown",
    function (e) {
      if (e.key !== "Enter") return;

      // 如果焦點在 textarea，直接 return（允許換行）
      if (e.target.tagName === "TEXTAREA") return;

      const openModals = Array.from(document.querySelectorAll(".modal")).filter(
        (m) => getComputedStyle(m).display !== "none"
      );
      if (openModals.length === 0) return;

      e.preventDefault();
      e.stopPropagation();

      // 可選：如果你想 Enter = 點「確認」：
      // const top = openModals[openModals.length - 1];
      // top.querySelector('.confirm-btn')?.click();
    },
    true
  ); // 用捕獲階段，優先攔住

  let importantOnly = false; // ❗ 最後一層篩選（預設關）
  let isEditing = false; // 目前是否在編輯分類模式
  // ✅ 分類在這裡維護（有順序）
  let categoriesLoaded = false; // 分類是否已從雲端載入
  let categories = [];
  let sectionSortable = null; // 存住 Sortable 實例
  let categoriesRef = null;
  // ✅ 重新畫出所有分類區塊（依照 categories 順序）

  // 放在全域
  let dbUnsubscribers = [];

  function detachDbListeners() {
    try {
      dbUnsubscribers.forEach((off) => off && off());
    } catch (_) {}
    dbUnsubscribers = [];
  }

  function resetAppState() {
    // 清 JS 狀態
    tasks = [];
    completedTasks = [];
    categories = [];
    categoriesLoaded = false;
    selectedTaskId = null;

    // 清 UI
    const box = document.getElementById("section-container");
    if (box) box.innerHTML = "";

    // 下拉選單也清乾淨
    updateSectionOptions && updateSectionOptions();
  }

  // 綁 RTDB 時用這個包一下，方便之後 off()
  function bindValue(ref, callback) {
    ref.on("value", callback);
    dbUnsubscribers.push(() => ref.off("value", callback));
  }

  function refreshCurrentView() {
    if (statusFilter === "done") {
      buildDoneMonthMenu();
      renderCompletedTasks();
    } else {
      showOngoing();
    }
  }
  // ✅ 只存分類（不要再從 tasks 推回去）
  document.addEventListener("change", function (e) {
    if (e.target && e.target.id === "importantOnly") {
      importantOnly = !!e.target.checked;
      // 關掉時：完全回到原本視圖（保持你原邏輯）
      // 打開時：先跑完原本視圖 → 再套❗最後一層
      if (!importantOnly) {
        refreshCurrentView();
      } else {
        applyImportantFilter(); // 對「現有可見結果」做最後一層篩選
      }
    }
  });

  function saveCategoriesToFirebase() {
    if (!roomPath || !categoriesLoaded) return;
    return db.ref(`${roomPath}/categories`).set(categories);
  }
  // === Firebase 初始化（放在這支 <script> 的最上面）===
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
  const auth = firebase.auth();
  const db = firebase.database();

  // 建議：明確指定持久性（iOS/Safari 比較不會怪）
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
  // 檢查是否在主畫面 / PWA 獨立模式
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone;

  // 等網路起來
  function waitOnline() {
    if (navigator.onLine) return Promise.resolve();
    return new Promise((res) =>
      window.addEventListener("online", res, { once: true })
    );
  }

  // 測試 IndexedDB 是否可用（iOS PWA 冷啟有時會炸）
  function testIndexedDB() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open("kjreminder-idb-test", 1);
        req.onsuccess = () => {
          try {
            req.result.close();
          } catch (_) {}
          resolve(true);
        };
        req.onerror = () => resolve(false);
        req.onblocked = () => resolve(false);
      } catch (_) {
        resolve(false);
      }
    });
  }

  // PWA 啟動時，稍等一下讓存儲與網路就緒，並選擇安全的持久性
  async function pwaAuthWarmup() {
    // 先等 DOM 妥當
    await new Promise((r) => setTimeout(r, 120));

    // 等網路
    await waitOnline();

    // iOS PWA 冷啟：IndexedDB 常常 0.x 秒內不可用，稍等一點再測
    await new Promise((r) => setTimeout(r, 120));

    const idbOK = await testIndexedDB();

    try {
      if (idbOK) {
        // 正常用 LOCAL（能記住登入）
        await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      } else {
        // 退而求其次：不持久（本次開啟有效，避免卡在持久層）
        await auth.setPersistence(firebase.auth.Auth.Persistence.NONE);
      }
    } catch (_) {
      // 就算 setPersistence 失敗也別擋流程
    }
  }

  // 你的一鍵開機（如果你已經做了 bootAuth/ensureSignedIn，就在裡面呼叫 pwaAuthWarmup）
  async function bootAuth() {
    if (bootAuth.__busy) return;
    bootAuth.__busy = true;
    setLoginBusy(true);

    // 先把顯示狀態清掉，避免閃爍
    document.documentElement.classList.remove("show-login", "show-app");

    // PWA 先熱身（網路/儲存就緒 & 設定持久性）
    if (isStandalone) {
      await pwaAuthWarmup();
    } else {
      try {
        await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      } catch (_) {}
    }

    // 讀 sessionStorage 或 localStorage，算出 roomPath
    hydrateRoomPath();

    if (!roomPath) {
      // 沒憑證：停在登入頁，並確保沒有殘留登入狀態
      try {
        if (auth.currentUser) await auth.signOut();
      } catch (_) {}
      document.documentElement.classList.add("show-login");
      detachDbListeners();
      resetAppState();
      setLoginBusy(false);
      bootAuth.__busy = false;
      return;
    }

    // 有憑證：乾淨登入 + 超時備援
    try {
      try {
        if (auth.currentUser) await auth.signOut();
      } catch (_) {}

      const timeout = new Promise((_, rej) =>
        setTimeout(() => rej(new Error("timeout")), 7000)
      );
      await Promise.race([auth.signInAnonymously(), timeout]);

      // 成功 → 顯示主畫面
      document.documentElement.classList.add("show-app");
      loadTasksFromFirebase();
      updateSectionOptions();
    } catch (e) {
      // 失敗 → 停在登入頁
      try {
        if (auth.currentUser) await auth.signOut();
      } catch (_) {}
      document.documentElement.classList.add("show-login");
    } finally {
      setLoginBusy(false);
      bootAuth.__busy = false;
    }
  }

  // 事件：開頁、回前景、聚焦時都補呼叫一次

  // ===== 共用的「確保登入」流程（有重試/超時保護）=====
  const AUTH_TIMEOUT_MS = 6000;
  let authBusy = false;
  let authTimer = null;

  async function ensureSignedIn() {
    if (authBusy) return;
    authBusy = true;
    setLoginBusy(true);

    // 讀憑證（要把回傳值接到全域）
    roomPath = hydrateRoomPath();

    // 沒有任何帳密 → 顯示登入頁（但不要 signOut！）
    if (!roomPath) {
      authBusy = false;
      setLoginBusy(false);
      document.documentElement.classList.remove("show-app");
      document.documentElement.classList.add("show-login");
      return;
    }

    // 有帳密 → 自動登入（只有「尚未登入」才登入，不要先登出）
    showAutoLoginOverlay();
    startAutoLoginWatchdog();
    try {
      if (!auth.currentUser) {
        await auth.signInAnonymously();
      }
      // 這裡不切畫面，交給 onAuthStateChanged
    } catch (e) {
      alert("自動登入失敗：" + (e?.message || e));
      hideAutoLoginOverlay();
    } finally {
      authBusy = false;
      setLoginBusy(false);
    }
  }

  let roomPath = ""; // ← 放這裡！全檔只出現一次
  let tasksRef = null;
  let completedRef = null; // 之後你有做 completedTasks 即可用到

  const DEFAULT_CATEGORIES = [
    "照顧服務",
    "專業服務",
    "交通接送",
    "喘息服務",
    "輔具申請",
    "其它",
  ];

  // 小工具：把不合法字元換掉（Firebase 路徑不能有 . # $ [ ] /）
  function sanitizeKey(s) {
    return String(s).replace(/[.#$/\[\]\/]/g, "_");
  }

  // 1) 全域狀態（放在你的全域變數區）
  let dayMode = "work"; // 'work' 工作天(預設) / 'calendar' 日曆天
  let tasks = [];
  let selectedTaskId = null;

  (function () {
    // ------ utils ------
    const pad2 = (n) => String(n).padStart(2, "0");
    const ymd = (d) =>
      `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const parseISO = (s) => {
      const d = new Date(s);
      d.setHours(0, 0, 0, 0);
      return d;
    };
    const today0 = () => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d;
    };
    const addDays = (d, n) => {
      const x = new Date(d);
      x.setDate(x.getDate() + n);
      return x;
    };
    const jsDowTo1234567 = (dow) => (dow === 0 ? 7 : dow);
    const mDays = (y, m) => new Date(y, m + 1, 0).getDate();
    const uniqSorted = (arr) => Array.from(new Set(arr)).sort();
    const isValidISO = (s) =>
      !!s && !isNaN(new Date(s).getTime()) && /^\d{4}-\d{2}-\d{2}$/.test(s);
    const deepcopy = (obj) => JSON.parse(JSON.stringify(obj || null));
    const setText = (id, txt) => {
      const el = document.getElementById(id);
      if (el) el.textContent = txt || "";
    };

    // ------ state ------
    const TARGET_DETAIL = "detail";
    const TARGET_CREATE = "create";
    let currentTarget = null;
    let createDraft = null; // 新增用排程草稿

    // ------ helpers ------

    // ===== A) 日期 vs 排程：互斥 + 即時摘要更新 + 精準 log =====
    // （把這段貼進你原本的 recurrence IIFE 內）

    // 兩個旗標：使用者是否在「詳情/新增」手動改過日期
    let manualDateEditedDetail = false;
    let manualDateEditedCreate = false;

    // 綁定日期輸入與排程的互斥規則
    function wireDateVsRecurrenceInterlock(target) {
      const id = target === TARGET_DETAIL ? "detailDate" : "taskDate";
      const sumId =
        target === TARGET_DETAIL
          ? "recurrenceSummary"
          : "recurrenceSummaryCreate";
      const el = document.getElementById(id);
      if (!el || el.__wired) return;

      const onManual = () => {
        if (target === TARGET_DETAIL) {
          manualDateEditedDetail = true;
          const t = curTask?.();
          if (t && t.recurrence) {
            delete t.recurrence; // 直接取消所有排程
            setText(sumId, "");
            console.warn("[recurrence/detail] 手動改日期 → 取消排程", {
              taskId: t.id,
              date: el.value,
            });
          } else {
            console.log("[recurrence/detail] 手動改日期（本來就沒有排程）", {
              date: el.value,
            });
          }
        } else {
          manualDateEditedCreate = true;
          if (createDraft) {
            createDraft = null; // 新增視窗：清掉草稿排程
            setText(sumId, "");
            console.warn("[recurrence/create] 手動改日期 → 取消排程草稿", {
              date: el.value,
            });
          } else {
            console.log(
              "[recurrence/create] 手動改日期（本來就沒有排程草稿）",
              { date: el.value }
            );
          }
        }
      };

      el.addEventListener("input", onManual);
      el.addEventListener("change", onManual);
      el.__wired = true;
    }

    // 覆寫套用排程的總入口：先清手動旗標，再委派
    const __origApplyRecurrence = applyRecurrence;
    applyRecurrence = function (rec) {
      if (currentTarget === TARGET_DETAIL) {
        manualDateEditedDetail = false; // 使用者選了排程 → 以排程為準
        console.info("[recurrence/detail] 套用排程", rec);
      } else {
        manualDateEditedCreate = false;
        console.info("[recurrence/create] 套用排程", rec);
      }
      return __origApplyRecurrence(rec);
    };

    // 把旗標暴露出去，給外層 saveTask/addTask 使用
    if (!window.__recurrenceCoreEx) {
      window.__recurrenceCoreEx = {
        manualDetailDateEdit: () => manualDateEditedDetail,
        manualCreateDateEdit: () => manualDateEditedCreate,
        clearManualDetailDateEdit: () => {
          manualDateEditedDetail = false;
        },
        clearManualCreateDateEdit: () => {
          manualDateEditedCreate = false;
        },
      };
    }
    function summaryFromRecurrence(rec) {
      if (!rec || !rec.type) return "";
      if (rec.type === "weekly") {
        const arr = (rec.days || []).slice().sort((a, b) => a - b);
        return arr.length
          ? `每週排程：${arr.join("、")}`
          : "（每週：尚未選擇）";
      }
      if (rec.type === "monthly") {
        const arr = (rec.monthdays || []).slice().sort((a, b) => a - b);
        return arr.length
          ? `每月排程：${arr.join("、")}號`
          : "（每月：尚未選擇）";
      }
      if (rec.type === "custom") {
        const arr = (rec.dates || [])
          .filter(isValidISO)
          .map(parseISO)
          .sort((a, b) => a - b);
        if (!arr.length) return "（自訂：尚未選擇）";
        const parts = [];
        let curY = null,
          buf = [];
        for (const d of arr) {
          const R = d.getFullYear() - 1911,
            md = `${d.getMonth() + 1}/${d.getDate()}`;
          if (curY === null) {
            curY = R;
            buf.push(`${R}/${md}`);
          } else if (R === curY) {
            buf.push(md);
          } else {
            parts.push(buf.join("、"));
            curY = R;
            buf = [`${R}/${md}`];
          }
        }
        if (buf.length) parts.push(buf.join("、"));
        return `自訂排程：${parts.join("；")}`;
      }
      return "";
    }

    function computeNext(rec, fromDate) {
      if (!rec || !rec.type) return null;
      const base = new Date(fromDate);
      base.setHours(0, 0, 0, 0);
      if (rec.type === "weekly") {
        const set = new Set(rec.days || []);
        if (!set.size) return null;
        for (let i = 0; i < 14; i++) {
          const d = addDays(base, i);
          if (set.has(jsDowTo1234567(d.getDay()))) return d;
        }
        return null;
      }
      if (rec.type === "monthly") {
        const arr = (rec.monthdays || [])
          .slice()
          .sort((a, b) => a - b)
          .filter((x) => x >= 1 && x <= 31);
        if (!arr.length) return null;
        let y = base.getFullYear(),
          m = base.getMonth();
        for (let k = 0; k < 48; k++) {
          const days = mDays(y, m);
          for (const dd of arr) {
            if (dd > days) continue;
            const cand = new Date(y, m, dd);
            cand.setHours(0, 0, 0, 0);
            if (cand >= base) return cand;
          }
          if (m === 11) {
            m = 0;
            y++;
          } else m++;
        }
        return null;
      }
      if (rec.type === "custom") {
        const arr = (rec.dates || [])
          .filter(isValidISO)
          .map(parseISO)
          .sort((a, b) => a - b);
        for (const d of arr) {
          if (d >= base) return d;
        }
        return null;
      }
      return null;
    }
    function matches(d, rec) {
      if (!rec || !rec.type || !d) return false;
      if (rec.type === "weekly")
        return (rec.days || []).includes(jsDowTo1234567(d.getDay()));
      if (rec.type === "monthly")
        return (rec.monthdays || []).includes(d.getDate());
      if (rec.type === "custom") return (rec.dates || []).includes(ymd(d));
      return false;
    }

    // ------ inline UI (detail/create) ------
    function ensureDetailInlineUI() {
      const dateEl = document.getElementById("detailDate");
      if (!dateEl) return;
      if (dateEl.parentElement.querySelector("#recurrenceBtn")) return;

      const labels = Array.from(
        document.querySelectorAll("#detailForm label")
      ).filter((l) => l.textContent.trim().startsWith("預定完成日"));
      if (labels[0]) {
        labels[0].innerHTML = `<span>預定完成日</span><span id="recurrenceSummary" style="font-size:.85rem;color:#666;margin-left:.5rem;"></span>`;
      }

      // 建 row，但讓日期保持全寬（不要加 .half）
      const row = document.createElement("div");
      row.className = "inline-row";
      dateEl.classList.remove("half"); // 保險：移除可能存在的 .half
      dateEl.parentElement.insertBefore(row, dateEl);
      row.appendChild(dateEl);

      // 建立按鈕，但直接隱藏（保留節點，其他程式仍可取得到 #recurrenceBtn）
      const btn = document.createElement("button");
      btn.id = "recurrenceBtn";
      btn.type = "button";
      btn.title = "定期排程";
      btn.textContent = "🗓️";
      btn.style.cssText =
        "padding:.4rem .6rem;border:1px solid #ddd;background:#f9f9f9;border-radius:6px;cursor:pointer;";
      btn.onclick = () => openRecurrenceModal(TARGET_DETAIL);
      row.appendChild(btn);

      // 讓 📅 從版面消失，但不影響邏輯或其他程式碼的存取
      btn.style.display = "none";
      btn.tabIndex = -1;
      btn.setAttribute("aria-hidden", "true");

      // 互斥監聽照常綁
      wireDateVsRecurrenceInterlock(TARGET_DETAIL);
    }

    function ensureCreateInlineUI() {
      const dateEl = document.getElementById("taskDate");
      if (!dateEl) return;
      if (dateEl.parentElement.querySelector("#recurrenceBtnCreate")) return;

      const labels = Array.from(
        document.querySelectorAll("#taskModal .modal-content label")
      ).filter((l) => l.textContent.trim().startsWith("預定完成日"));
      if (labels[0]) {
        labels[0].innerHTML = `<span>預定完成日</span><span id="recurrenceSummaryCreate" style="font-size:.85rem;color:#666;margin-left:.5rem;"></span>`;
      }

      const row = document.createElement("div");
      row.className = "inline-row";
      dateEl.classList.add("half");
      dateEl.parentElement.insertBefore(row, dateEl);
      row.appendChild(dateEl);

      const btn = document.createElement("button");
      btn.id = "recurrenceBtnCreate";
      btn.type = "button";
      btn.title = "定期排程";
      btn.textContent = "🗓️ 排程";
      btn.style.cssText =
        "padding:.4rem .6rem;border:1px solid #ddd;background:#f9f9f9;border-radius:6px;cursor:pointer;";
      btn.onclick = () => openRecurrenceModal(TARGET_CREATE);
      row.appendChild(btn);
      wireDateVsRecurrenceInterlock(TARGET_CREATE);
    }

    // ------ modal skins ------
    function injectRecCSS() {
      /* 已在 <style> 放了，不重複注入 */
    }
    function ensureModal(id, title, inner) {
      let m = document.getElementById(id);
      if (!m) {
        m = document.createElement("div");
        m.className = "modal";
        m.id = id;
        m.innerHTML = `<div class="modal-content">
        <button class="close-btn" onclick="closeModal('${id}')">✕</button>
        <h3>${title}</h3><div class="rec-body">${inner || ""}</div>
      </div>`;
        document.body.appendChild(m);
      }
      return m;
    }
    function openRecurrenceModal(target) {
      currentTarget = target || TARGET_DETAIL;
      injectRecCSS();
      const m = ensureModal(
        "recurrenceModal",
        "定期排程",
        `
      <div class="rec-mode-grid">
        <button class="rec-bigbtn" id="recModeWeekly">每週</button>
        <button class="rec-bigbtn" id="recModeMonthly">每月</button>
        <button class="rec-bigbtn" id="recModeCustom">自訂</button>
      </div>`
      );
      m.style.display = "flex";
      document.getElementById("recModeWeekly").onclick = () => {
        closeModal("recurrenceModal");
        openWeekly();
      };
      document.getElementById("recModeMonthly").onclick = () => {
        closeModal("recurrenceModal");
        openMonthly();
      };
      document.getElementById("recModeCustom").onclick = () => {
        closeModal("recurrenceModal");
        openCustom();
      };
    }

    // ------ apply (detail/create) ------
    function curTask() {
      if (!window.selectedTaskId) return null;
      return (
        (Array.isArray(window.tasks) ? window.tasks : []).find(
          (t) => t.id === window.selectedTaskId
        ) || null
      );
    }
    function applyRecurrence(rec) {
      if (currentTarget === TARGET_CREATE) return applyCreate(rec);
      return applyDetail(rec);
    }
    function applyDetail(rec) {
      const t = curTask();
      if (!t) return;
      t.recurrence = deepcopy(rec);
      t.updatedAt = Date.now();

      const base = today0();
      // 有設定排程：一律以排程算「下一次」，忽略原本的預定完成日
      if (rec && rec.type) {
        const next = computeNext(rec, base);
        if (next) {
          const iso = ymd(next);
          const dateEl = document.getElementById("detailDate");
          if (dateEl) dateEl.value = iso;
          t.date = iso;
        }
      }

      setText("recurrenceSummary", summaryFromRecurrence(t.recurrence));
      try {
        if (typeof saveTasksToFirebase === "function") saveTasksToFirebase();
        const lbl = document.getElementById("detailLastUpdate");
        if (lbl && typeof formatRocDateTime === "function")
          lbl.textContent = "更新：" + formatRocDateTime(t.updatedAt);
      } catch (_) {}
    }

    function applyCreate(rec) {
      createDraft = deepcopy(rec);

      const base = today0();
      // 有設定排程：一律以排程算「下一次」，忽略目前輸入的日期
      if (rec && rec.type) {
        const next = computeNext(rec, base);
        const dateEl = document.getElementById("taskDate");
        if (next && dateEl) dateEl.value = ymd(next);
      }

      setText("recurrenceSummaryCreate", summaryFromRecurrence(createDraft));
    }

    // ------ pickers ------
    function currentRec() {
      if (currentTarget === TARGET_CREATE) return createDraft || null;
      const t = curTask();
      return t && t.recurrence ? t.recurrence : null;
    }
    function openWeekly() {
      const curr = currentRec();
      const sel = new Set(
        curr && curr.type === "weekly" ? curr.days || [] : []
      );
      const m = ensureModal(
        "recWeekly",
        "每週",
        `
      <div class="rec-chiprow" id="recWeekRow"></div>
      <div class="rec-footer">
        <button class="btn-light" onclick="closeModal('recWeekly')">取消</button>
        <button class="btn-primary" id="recWeekOk">確認</button>
      </div>`
      );
      const row = m.querySelector("#recWeekRow");
      row.innerHTML = "";
      [
        ["一", 1],
        ["二", 2],
        ["三", 3],
        ["四", 4],
        ["五", 5],
        ["六", 6],
        ["日", 7],
      ].forEach(([txt, v]) => {
        const b = document.createElement("button");
        b.className = "rec-chip" + (sel.has(v) ? " selected" : "");
        b.textContent = txt;
        b.onclick = () => {
          sel.has(v) ? sel.delete(v) : sel.add(v);
          b.classList.toggle("selected");
        };
        row.appendChild(b);
      });
      m.style.display = "flex";
      m.querySelector("#recWeekOk").onclick = () => {
        applyRecurrence({
          type: "weekly",
          days: Array.from(sel).sort((a, b) => a - b),
        });
        closeModal("recWeekly");
      };
    }
    function openMonthly() {
      const curr = currentRec();
      const sel = new Set(
        curr && curr.type === "monthly" ? curr.monthdays || [] : []
      );
      const m = ensureModal(
        "recMonthly",
        "每月",
        `
      <div class="rec-chiprow" id="recMonRow"></div>
      <div class="rec-footer">
        <button class="btn-light" onclick="closeModal('recMonthly')">取消</button>
        <button class="btn-primary" id="recMonOk">確認</button>
      </div>`
      );
      const row = m.querySelector("#recMonRow");
      row.innerHTML = "";
      for (let i = 1; i <= 31; i++) {
        const b = document.createElement("button");
        b.className = "rec-chip" + (sel.has(i) ? " selected" : "");
        b.textContent = i;
        b.onclick = () => {
          sel.has(i) ? sel.delete(i) : sel.add(i);
          b.classList.toggle("selected");
        };
        row.appendChild(b);
      }
      m.style.display = "flex";
      m.querySelector("#recMonOk").onclick = () => {
        applyRecurrence({
          type: "monthly",
          monthdays: Array.from(sel).sort((a, b) => a - b),
        });
        closeModal("recMonthly");
      };
    }
    function openCustom() {
      const curr = currentRec();
      const selected = new Set(
        curr && curr.type === "custom" ? curr.dates || [] : []
      );
      const now = today0();
      let y = now.getFullYear(),
        m = now.getMonth();
      const M = ensureModal(
        "recCustom",
        "自訂",
        `
      <div class="rec-cal-head">
        <div class="rec-nav">
          <button id="recPrev">&lt;</button>
          <button id="recToday">今</button>
          <button id="recNext">&gt;</button>
        </div>
        <div id="recYM"></div>
      </div>
      <div class="rec-cal-grid" id="recCalNames"></div>
      <div class="rec-cal-grid" id="recCalGrid"></div>
      <div class="rec-footer">
        <button class="btn-light" onclick="closeModal('recCustom')">取消</button>
        <button class="btn-primary" id="recCusOk">確認</button>
      </div>`
      );
      M.querySelector("#recCalNames").innerHTML = [
        "一",
        "二",
        "三",
        "四",
        "五",
        "六",
        "日",
      ]
        .map((n) => `<div class="rec-dayname">${n}</div>`)
        .join("");
      function draw() {
        M.querySelector("#recYM").textContent = `${y} 年 ${m + 1} 月`;
        const grid = M.querySelector("#recCalGrid");
        grid.innerHTML = "";
        let lead = jsDowTo1234567(new Date(y, m, 1).getDay()) - 1;
        if (lead < 0) lead += 7;
        const days = mDays(y, m);
        for (let i = 0; i < lead; i++)
          grid.appendChild(document.createElement("div"));
        for (let d = 1; d <= days; d++) {
          const cell = document.createElement("button");
          cell.className = "rec-date";
          cell.textContent = d;
          const iso = `${y}-${pad2(m + 1)}-${pad2(d)}`;
          if (selected.has(iso)) cell.classList.add("selected");
          cell.onclick = () => {
            if (selected.has(iso)) {
              selected.delete(iso);
              cell.classList.remove("selected");
            } else {
              selected.add(iso);
              cell.classList.add("selected");
            }
          };
          grid.appendChild(cell);
        }
      }
      M.querySelector("#recPrev").onclick = () => {
        if (m === 0) {
          m = 11;
          y--;
        } else m--;
        draw();
      };
      M.querySelector("#recNext").onclick = () => {
        if (m === 11) {
          m = 0;
          y++;
        } else m++;
        draw();
      };
      M.querySelector("#recToday").onclick = () => {
        const n = today0();
        y = n.getFullYear();
        m = n.getMonth();
        draw();
      };
      M.style.display = "flex";
      draw();
      M.querySelector("#recCusOk").onclick = () => {
        applyRecurrence({
          type: "custom",
          dates: uniqSorted(Array.from(selected)).filter(isValidISO),
        });
        closeModal("recCustom");
      };
    }

    // ------ self-heal + next spawn ------
    function healEmptyDates() {
      const list = Array.isArray(window.tasks) ? window.tasks : [];
      const base = today0();
      let changed = false;
      for (const t of list) {
        if (t && t.recurrence && (!t.date || !isValidISO(t.date))) {
          const next = computeNext(t.recurrence, base);
          if (next) {
            t.date = ymd(next);
            t.updatedAt = Date.now();
            changed = true;
          }
        }
      }
      if (changed && typeof saveTasksToFirebase === "function")
        saveTasksToFirebase();
    }
    function spawnNextIfNeeded(template, completedAt) {
      if (!template || !template.recurrence || !template.recurrence.type)
        return;

      // 今天 00:00
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // 本次被「消耗」的發生日期（以預定完成日為主）
      let occISO = null;
      if (
        template.date &&
        /^\d{4}-\d{2}-\d{2}$/.test(template.date) &&
        !isNaN(new Date(template.date).getTime())
      ) {
        occISO = template.date;
      }

      // 從「本次預定日 + 1」開始找；若沒有預定日，就用完成時間 +1
      const from = new Date(
        occISO ? new Date(occISO).getTime() : completedAt || Date.now()
      );
      from.setHours(0, 0, 0, 0);
      from.setDate(from.getDate() + 1);

      // 複製一份 recurrence（避免直接改到原物件）
      const nextRec = deepcopy(template.recurrence) || {};

      // 自訂日期：把「剛完成的那一天」移除，避免再被算到
      if (nextRec.type === "custom" && occISO) {
        nextRec.dates = Array.isArray(nextRec.dates)
          ? nextRec.dates.filter((d) => d !== occISO)
          : [];
      }

      // 先找一次
      let next = null;
      try {
        next = computeNext(nextRec, from);
      } catch (e) {
        console.error("[recurrence] computeNext 失敗：", e);
        return;
      }

      // ★ 你新增的條件：若找到的 next 仍「早於今天」，就一路跳過到 >= 今天
      while (next && next < today) {
        const bump = new Date(next);
        bump.setDate(bump.getDate() + 1);
        next = computeNext(nextRec, bump);
      }
      if (!next) return;

      const now = Date.now();
      const t = {
        id: `task-${now}`,
        section: template.section,
        title: template.title,
        content: template.content,
        date: ymd(next), // ← 已確保 >= 今天的下一次
        note: template.note,
        important: !!template.important,
        createdAt: now,
        updatedAt: now,
        recurrence: nextRec,
      };

      // 小保險：避免同分類/同標題/同日期重複
      try {
        if (
          Array.isArray(window.tasks) &&
          window.tasks.some(
            (x) =>
              x.section === t.section &&
              x.title === t.title &&
              x.date === t.date
          )
        ) {
          return;
        }
      } catch (_) {}

      // 若會被目前濾鏡藏住 → 切回進行中並清濾鏡（缺函式就用 fallback）
      let willBeHidden = false;
      try {
        if (typeof isTaskVisibleUnderCurrentFilters === "function") {
          willBeHidden = !isTaskVisibleUnderCurrentFilters(t);
        }
      } catch (_) {}
      if (willBeHidden) {
        try {
          if (typeof ensureOngoingVisible === "function") {
            ensureOngoingVisible();
          } else {
            statusFilter = "ongoing";
            filterDay = "default";
            importantOnly = false;
            if (typeof showOngoing === "function") showOngoing();
          }
        } catch (_) {
          statusFilter = "ongoing";
          filterDay = "default";
          importantOnly = false;
          if (typeof showOngoing === "function") showOngoing();
        }
      }

      // 推進資料 & 畫面 & 儲存
      try {
        (Array.isArray(window.tasks) ? window.tasks : tasks).push(t);

        const days =
          typeof getRemainingDays === "function"
            ? getRemainingDays(t.date)
            : null;
        const bg =
          typeof getColorByDays === "function"
            ? getColorByDays(days)
            : "#e6f9f0";
        const disp = days == null ? "無" : days;

        const el = document.createElement("div");
        el.className = "task";
        el.dataset.id = t.id;
        el.style.backgroundColor = bg;
        if (typeof taskCardHTML === "function")
          el.innerHTML = taskCardHTML(t, disp);
        applyIconsToCard(el, t);

        const sec = document.getElementById(t.section);
        if (sec) sec.appendChild(el);
        if (typeof sortTasks === "function") sortTasks(t.section);
        if (typeof bindSwipeToTasks === "function") bindSwipeToTasks();
        if (typeof applyDayFilter === "function") applyDayFilter();
        if (typeof saveTasksToFirebase === "function") saveTasksToFirebase();
        if (typeof showOngoing === "function") showOngoing();
      } catch (e) {
        console.error("[recurrence] 渲染/儲存新卡失敗：", e);
      }
    }

    // ------ 對外：給主程式用的小鉤子 ------
    window.__recurrenceCore = {
      ensureDetailInlineUI,
      ensureCreateInlineUI,
      summaryFromRecurrence,
      computeNext,
      matches,
      healEmptyDates,
      spawnNextIfNeeded,
      get createDraft() {
        return createDraft;
      },
      set createDraft(v) {
        createDraft = v;
      },
      applyDetail,
      applyCreate,
      TARGET_DETAIL,
      TARGET_CREATE,
    };
  })();

  function hydrateRoomPath() {
    let saved = null;

    // 先讀 sessionStorage（同分頁切換最常用）
    try {
      saved =
        sessionStorage.getItem("todo_room_info") ||
        sessionStorage.getItem("todo_room_info_session");
    } catch (_) {}

    // 沒有再讀 localStorage（勾了自動登入的情況）
    if (!saved) {
      try {
        saved =
          localStorage.getItem("todo_room_info") ||
          localStorage.getItem("todo_room_info_session");
      } catch (_) {}
    }

    if (!saved) return null;

    try {
      const { username, password } = JSON.parse(saved);
      if (!username || !password) return null;
      return `rooms/${sanitizeKey(username)}-${sanitizeKey(password)}`;
    } catch (_) {
      return null;
    }
  }

  function getViewerBody() {
    return document.getElementById("viewerBody");
  }
  function getExpandedSource() {
    // 目前展開的是哪個欄位（detailContent 或 detailNote）
    return window.__expandedFieldId
      ? document.getElementById(window.__expandedFieldId)
      : null;
  }

  // 放在 getViewerBody / getExpandedSource 附近
  function flushViewerSync() {
    try {
      const vBody =
        typeof getViewerBody === "function" ? getViewerBody() : null;
      const src =
        typeof getExpandedSource === "function" ? getExpandedSource() : null;
      if (vBody && src) {
        src.value = vBody.value || "";
        src.dispatchEvent(new Event("input", { bubbles: true }));
      }
    } catch (_) {}
  }

  function updateViewerToolbar() {
    const undoBtn = document.querySelector(
      '.viewer-toolbar .vt-btn[onclick="viewerUndo()"]'
    );
    const redoBtn = document.querySelector(
      '.viewer-toolbar .vt-btn[onclick="viewerRedo()"]'
    );
    if (undoBtn) undoBtn.disabled = __viewerHistory.length <= 1; // 只有一個初始狀態時不可還原
    if (redoBtn) redoBtn.disabled = __viewerRedoStack.length === 0;
  }

  function pushViewerHistory(nextValue) {
    // 連續相同不入堆，最多保留 100 筆
    if (
      __viewerHistory.length === 0 ||
      __viewerHistory[__viewerHistory.length - 1] !== nextValue
    ) {
      __viewerHistory.push(nextValue);
      if (__viewerHistory.length > 100) __viewerHistory.shift();
    }
    // 一旦有輸入，redo 清空
    __viewerRedoStack = [];
    updateViewerToolbar();
  }

  function viewerUndo() {
    const vBody = getViewerBody();
    if (!vBody || __viewerHistory.length <= 1) return;
    const cur = __viewerHistory.pop(); // 當前 -> 進 redo
    __viewerRedoStack.push(cur);
    const prev = __viewerHistory[__viewerHistory.length - 1];
    vBody.value = prev;

    // 同步回表單欄位
    if (vBody.__formSync) vBody.__formSync();
    updateViewerToolbar();
  }

  function viewerRedo() {
    const vBody = getViewerBody();
    if (!vBody || __viewerRedoStack.length === 0) return;
    const redoVal = __viewerRedoStack.pop();
    vBody.value = redoVal;
    if (vBody.__formSync) vBody.__formSync();

    // redo 後也算新狀態
    pushViewerHistory(vBody.value);
    updateViewerToolbar();
  }

  function viewerCopy() {
    const vBody = getViewerBody();
    const text = vBody ? vBody.value || "" : "";
    if (!text) {
      alert("沒有可複製的內容");
      return;
    }
    // 優先用 Clipboard API，失敗則退回選取複製
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        alert("已複製內容");
      })
      .catch(() => {
        try {
          const t = document.createElement("textarea");
          t.value = text;
          document.body.appendChild(t);
          t.select();
          document.execCommand("copy");
          document.body.removeChild(t);
          alert("已複製內容");
        } catch (_) {
          alert("複製失敗");
        }
      });
  }

  function openModal(prefSectionId) {
    updateSectionOptions(); // ★ 先同步選項
    if (prefSectionId) {
      const sel = document.getElementById("taskSection");
      if (sel) {
        // 有對應選項就預選；沒有就維持原狀
        const opt = sel.querySelector(`option[value="${prefSectionId}"]`);
        if (opt) sel.value = prefSectionId;
      }
    }
    document.getElementById("taskModal").style.display = "flex";
    if (window.__recurrenceCore) {
      const { ensureCreateInlineUI } = window.__recurrenceCore;
      window.__recurrenceCore.createDraft = null;
      ensureCreateInlineUI();
      const sumEl = document.getElementById("recurrenceSummaryCreate");
      if (sumEl) sumEl.textContent = "";
    }
    closeFabMenu();
  }

  function closeModal(id) {
    // 關掉詳情視窗時，解綁即時同步（加保險）
    if (id === "detailModal" && typeof unbindDetailLiveSync === "function") {
      unbindDetailLiveSync();
      resetDetailPanels();
    }
    document.getElementById(id).style.display = "none";
  }

  //剩餘天數邏輯
  // 2) 取代你目前的 getRemainingDays（支援兩種模式）
  function getRemainingDays(dateStr) {
    if (!dateStr) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr);
    target.setHours(0, 0, 0, 0);

    if (dayMode === "calendar") {
      const ms = target.getTime() - today.getTime();
      return Math.round(ms / 86400000); // 今天=0、明天=1、昨天=-1
    }

    // 工作天：排除六日；今天=0；未來/過去都以工作天計
    if (target.getTime() === today.getTime()) return 0;

    const forward = target > today;
    const start = new Date(forward ? today : target);
    const end = new Date(forward ? target : today);

    let count = 0;

    // 從「起始日的下一天」開始算，直到 end（包含 end）
    const cur = new Date(start);
    cur.setDate(cur.getDate() + 1);

    while (cur <= end) {
      const d = cur.getDay();
      if (d !== 0 && d !== 6) count++; // 只算週一～週五
      cur.setDate(cur.getDate() + 1);
    }
    return forward ? count : -count;
  }

  function getColorByDays(days) {
    if (days == null) return "var(--green-light)";
    if (days >= 6) return "var(--green-light)";
    if (days >= 4) return "#ffeaea";
    if (days >= 2) return "#ffb3b3";
    return "#ff8080";
  }

  function addTask() {
    // 先看是否有 Recurrence 草稿，必要時把日期校正到「下一個」規則日（預先幫使用者補合理日期）
    try {
      if (window.__recurrenceCore && window.__recurrenceCore.createDraft) {
        const { createDraft, computeNext, matches } = window.__recurrenceCore;
        const dateEl = document.getElementById("taskDate");
        const base = new Date();
        base.setHours(0, 0, 0, 0);
        const curISO = dateEl && dateEl.value ? dateEl.value : "";
        const cur = curISO ? new Date(curISO) : null;
        if (!curISO || isNaN(cur) || !matches(cur, createDraft) || cur < base) {
          const next = computeNext(createDraft, base);
          if (next && dateEl) {
            const iso = `${next.getFullYear()}-${String(
              next.getMonth() + 1
            ).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
            dateEl.value = iso;
          }
        }
      }
    } catch (_) {}

    const section = document.getElementById("taskSection").value;
    const title = document.getElementById("taskTitle").value;
    const content = document.getElementById("taskContent").value;
    const date = document.getElementById("taskDate").value;
    const note = document.getElementById("taskNote").value;
    if (!title) {
      console.warn("[addTask] 未輸入標題，取消新增");
      return;
    }

    const importantEl = document.getElementById("taskImportant");
    const important = importantEl ? importantEl.checked : false;

    const id = `task-${Date.now()}`;
    const now = Date.now();
    const task = {
      id,
      section,
      title,
      content,
      date,
      note,
      important,
      createdAt: now,
      updatedAt: now,
    };

    // ===== 互斥規則：手動日期 vs 排程草稿（含精準 log）=====
    (function applyRecurrenceDraftWithMutex() {
      try {
        const rc = window.__recurrenceCore;
        const rce = window.__recurrenceCoreEx;

        // 使用者在「新增視窗」手動改過日期 → 不套用排程草稿
        if (rce?.manualCreateDateEdit?.()) {
          console.warn("[addTask] 手動日期優先 → 不套用排程草稿", {
            date: task.date,
          });
          const sumEl = document.getElementById("recurrenceSummaryCreate");
          if (sumEl) sumEl.textContent = "";
          rce.clearManualCreateDateEdit?.();
          return;
        }

        // 沒手動改日期且有草稿 → 套用排程，並把日期改成「下一次」
        if (rc && rc.createDraft) {
          task.recurrence = JSON.parse(JSON.stringify(rc.createDraft));
          console.info("[addTask] 已套用排程草稿", {
            recurrence: task.recurrence,
          });
          const base = new Date();
          base.setHours(0, 0, 0, 0);
          const next = rc.computeNext?.(task.recurrence, base);
          if (next) {
            const iso = `${next.getFullYear()}-${String(
              next.getMonth() + 1
            ).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
            console.info("[addTask] 以排程為準 → 改寫日期", {
              dateFrom: task.date,
              dateTo: iso,
            });
            task.date = iso;
          } else {
            console.warn(
              "[addTask] createDraft 存在但算不出下一次，保留目前日期",
              { date: task.date, rec: task.recurrence }
            );
          }
        }
      } catch (e) {
        console.error("[addTask] 套用排程草稿失敗", e);
      }
    })();

    tasks.push(task);

    const days = getRemainingDays(task.date); // ← 用「最後決定」的日期
    const bg = getColorByDays(days);
    const displayDays = days == null ? "無" : days;

    const el = document.createElement("div");
    el.className = "task";
    el.dataset.id = id;
    el.style.backgroundColor = bg;
    el.innerHTML = taskCardHTML(task, displayDays);
    applyIconsToCard(el, task);
    document.getElementById(section).appendChild(el);
    sortTasks(section);

    console.log("[addTask] 已新增並渲染", {
      id: task.id,
      section: task.section,
      date: task.date,
      important: task.important,
      recurrence: task.recurrence || null,
    });

    closeModal("taskModal");

    // 清空表單
    document.getElementById("taskTitle").value = "";
    document.getElementById("taskContent").value = "";
    document.getElementById("taskDate").value = "";
    document.getElementById("taskNote").value = "";
    if (importantEl) importantEl.checked = false;

    // 新任務成立後才清草稿
    if (window.__recurrenceCore) window.__recurrenceCore.createDraft = null;

    applyDayFilter();
    saveTasksToFirebase();
    bindSwipeToTasks();
  }

  // 強制提交目前正在輸入（收合輸入法、觸發 compositionend / blur）
  function commitActiveInput() {
    const ae = document.activeElement;
    if (!ae) return;
    const tag = ae.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      try {
        ae.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (_) {}
      try {
        ae.blur();
      } catch (_) {}
    }
  }

  //排序邏輯用
  function sortTasks(section) {
    const container = document.getElementById(section);
    const tasksInSection = Array.from(container.querySelectorAll(".task"));

    tasksInSection.sort((a, b) => {
      const taskA = tasks.find((t) => t.id === a.dataset.id);
      const taskB = tasks.find((t) => t.id === b.dataset.id);

      const daysA = getRemainingDays(taskA.date);
      const daysB = getRemainingDays(taskB.date);

      // 空日期視為最大天數（排序到最下面）
      const safeDaysA = daysA == null ? Infinity : daysA;
      const safeDaysB = daysB == null ? Infinity : daysB;

      return safeDaysA - safeDaysB;
    });

    // 清空後依排序結果重新加入
    tasksInSection.forEach((taskEl) => container.appendChild(taskEl));
  }

  function openDetail(id) {
    if (isEditing) return; // ← 編輯分類時不開詳情
    selectedTaskId = id;
    const task = tasks.find((t) => t.id === id);
    if (!task) return;

    resetDetailPanels();
    document.getElementById("detailSection").value = task.section;
    document.getElementById("detailTitle").value = task.title;
    document.getElementById("detailContent").value = task.content;
    document.getElementById("detailDate").value = task.date;
    document.getElementById("detailNote").value = task.note;

    document.getElementById("detailModal").style.display = "flex";
    setDetailReadonly(false);
    document.getElementById("detailImportant").checked = !!task.important;
    // 進行中：顯示最後儲存；若沒儲存過就顯示建立時間
    {
      const last = task.updatedAt || task.createdAt || null;
      const lbl = document.getElementById("detailLastUpdate");
      if (lbl) lbl.textContent = last ? "更新：" + formatRocDateTime(last) : "";
    }

    if (window.__resetSlideComplete) window.__resetSlideComplete();
    // Recurrence：插入內嵌按鈕與摘要、必要時校正日期
    if (window.__recurrenceCore) {
      const { ensureDetailInlineUI, summaryFromRecurrence, computeNext } =
        window.__recurrenceCore;
      ensureDetailInlineUI();
      const t = task; // 你前面就有 const task = ...
      if (t && t.recurrence) {
        const base = new Date();
        base.setHours(0, 0, 0, 0);
        const curISO =
          document.getElementById("detailDate")?.value || t.date || "";
        const cur = curISO ? new Date(curISO) : null;
        if (!curISO || isNaN(cur) || cur < base) {
          const next = computeNext(t.recurrence, base);
          if (next) {
            const iso = `${next.getFullYear()}-${String(
              next.getMonth() + 1
            ).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
            const de = document.getElementById("detailDate");
            if (de) de.value = iso;
            t.date = iso;
            t.updatedAt = Date.now();
          }
        }
      }
      const sum = t ? summaryFromRecurrence(t.recurrence) : "";
      const elSum = document.getElementById("recurrenceSummary");
      if (elSum) elSum.textContent = sum || "";
    }
    // ⬇⬇⬇ 新增這行：詳情一開就即時同步
    bindDetailLiveSync(task);
  }

  function syncEditsIntoTask(task) {
    if (task.id !== selectedTaskId) return task;

    // ★ 只有詳情視窗打開時才同步輸入值，避免把空字串覆蓋掉
    if (!isModalOpen("detailModal")) return task;

    const secEl = document.getElementById("detailSection");
    const ttlEl = document.getElementById("detailTitle");
    const ctnEl = document.getElementById("detailContent");
    const dateEl = document.getElementById("detailDate");
    const noteEl = document.getElementById("detailNote");
    const impEl = document.getElementById("detailImportant");

    if (secEl) task.section = secEl.value;
    if (ttlEl) task.title = ttlEl.value;
    if (ctnEl) task.content = ctnEl.value;
    if (dateEl) task.date = dateEl.value;
    if (noteEl) task.note = noteEl.value;
    if (impEl) task.important = !!impEl.checked;

    return task;
  }

  //儲存功能
  function saveTask() {
    if (!selectedTaskId) return;

    const task = tasks.find((t) => t.id === selectedTaskId);
    if (!task) return;

    // 先收集表單值
    task.section = document.getElementById("detailSection").value;
    task.title = document.getElementById("detailTitle").value;
    task.content = document.getElementById("detailContent").value;
    task.date = document.getElementById("detailDate").value;
    task.note = document.getElementById("detailNote").value;
    task.important = document.getElementById("detailImportant").checked;
    task.updatedAt = Date.now();

    const _lbl = document.getElementById("detailLastUpdate");
    if (_lbl) _lbl.textContent = "更新：" + formatRocDateTime(task.updatedAt);

    try {
      const rc = window.__recurrenceCore;
      const rce = window.__recurrenceCoreEx;

      // 使用者剛在詳情中「手動改了日期」→ 取消排程（維持你的互斥規則）
      if (rce?.manualDetailDateEdit?.()) {
        if (task.recurrence) {
          console.warn("[saveTask] 手動日期優先 → 取消原排程", {
            id: task.id,
            date: task.date,
            oldRecurrence: task.recurrence,
          });
        }
        delete task.recurrence;
        const sumEl = document.getElementById("recurrenceSummary");
        if (sumEl) sumEl.textContent = "";
        rce.clearManualDetailDateEdit?.();
      }

      // 有排程 & 沒手動改日期：僅在需要時才自動糾正日期
      else if (task.recurrence?.type && rc?.computeNext) {
        const base = new Date();
        base.setHours(0, 0, 0, 0);
        const dateEl = document.getElementById("detailDate");

        const curISO = dateEl?.value || task.date || "";
        const curDate =
          curISO && /^\d{4}-\d{2}-\d{2}$/.test(curISO)
            ? new Date(curISO)
            : null;
        const isValid = !!curDate && !isNaN(curDate);
        const isPast = isValid ? curDate < base : true;
        const matches =
          isValid && rc?.matches ? rc.matches(curDate, task.recurrence) : false;

        // 只有「日期無效 / 早於今天 / 不符合規則」才改為下一次
        if (!isValid || isPast || !matches) {
          const next = rc.computeNext(task.recurrence, base);
          if (next) {
            const iso = `${next.getFullYear()}-${String(
              next.getMonth() + 1
            ).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
            console.info("[saveTask] 日期不合理 → 依排程改為下一次", {
              id: task.id,
              dateFrom: task.date,
              dateTo: iso,
              recurrence: task.recurrence,
            });
            task.date = iso;
            if (dateEl) dateEl.value = iso; // 同步畫面
          } else {
            console.warn("[saveTask] 有排程但算不出下一次，保留既有日期", {
              id: task.id,
              date: task.date,
              recurrence: task.recurrence,
            });
          }
        } else {
          // 合理且符合規則 → 保留使用者既有日期（不跳回/不重置）
          task.date = curISO;
        }

        // 更新排程摘要顯示
        const sum = rc?.summaryFromRecurrence?.(task.recurrence) || "";
        const sumEl = document.getElementById("recurrenceSummary");
        if (sumEl) sumEl.textContent = sum;
      }
    } catch (e) {
      console.error("[saveTask] 排程/日期互斥規則處理失敗", e);
    }

    // 重新渲染該卡片
    const oldEl = document.querySelector(`[data-id='${task.id}']`);
    if (oldEl) oldEl.remove();

    const days = getRemainingDays(task.date);
    const bg = getColorByDays(days);
    const displayDays = days == null ? "無" : days;

    const el = document.createElement("div");
    el.className = "task";
    el.dataset.id = task.id;
    el.style.backgroundColor = bg;
    el.innerHTML = taskCardHTML(task, displayDays);
    applyIconsToCard(el, task);

    document.getElementById(task.section).appendChild(el);
    sortTasks(task.section);
    bindSwipeToTasks();

    closeModal("detailModal");
    applyDayFilter();
    saveTasksToFirebase();
  }

  function isModalOpen(id) {
    const m = document.getElementById(id);
    return m && getComputedStyle(m).display !== "none";
  }
  //移除功能
  function confirmDelete() {
    document.getElementById("confirmModal").style.display = "flex";
  }

  function deleteTask() {
    if (!selectedTaskId) return;

    const el = document.querySelector(`[data-id='${selectedTaskId}']`);
    if (el) el.remove();

    tasks = tasks.filter((t) => t.id !== selectedTaskId);

    closeModal("confirmModal");
    closeModal("detailModal");
    saveTasksToFirebase(); // ← 加這行
  }
  //新增分類功能
  function openCategoryModal() {
    document.getElementById("newCategoryName").value = "";
    document.getElementById("categoryModal").style.display = "flex";
    closeFabMenu(); // ✅ 自動關閉選單
  }

  function addCategory() {
    const name = document.getElementById("newCategoryName").value.trim();
    if (!name) return;
    if (categories.includes(name)) {
      alert("此分類已存在！");
      return;
    }

    // ✅ 更新陣列、存雲、重畫
    categories.push(name);
    saveCategoriesToFirebase();
    renderSections(categories);
    refreshCurrentView();
    closeModal("categoryModal");
  }

  //防雙擊
  let lastTouchTime = 0;
  document.addEventListener(
    "touchend",
    function (event) {
      const now = new Date().getTime();
      if (now - lastTouchTime <= 300) {
        event.preventDefault(); // 阻止第二次點擊導致放大
      }
      lastTouchTime = now;
    },
    false
  );

  //編輯分類功能

  let pendingRenameId = null;

  let __savedFilters = null;

  function enterEditMode() {
    isEditing = true;
    // 暫存目前濾鏡
    __savedFilters = { filterDay, importantOnly, statusFilter };
    // 編輯時強制顯示進行中視圖 & 關所有濾鏡
    statusFilter = "ongoing";
    filterDay = "default";
    importantOnly = false;

    showOngoing();
    closeFabMenu(); // 重畫（全部分類會露出）
    decorateSectionsForEdit(); // 你原本的
  }
  // 刪除分類彈窗
  function confirmDeleteCategory(id) {
    const category = document.getElementById(id);
    if (!category) return;

    // 建立確認視窗
    const confirmBox = document.createElement("div");
    confirmBox.className = "modal";
    confirmBox.style.display = "flex";
    confirmBox.innerHTML = `
    <div class="modal-content">
      <h3 style="text-align:center;">是否確認刪除此分類？</br>(所有任務(含已完成)將一併刪除)</h3>
      <div class="confirm-buttons" style="display:flex;gap:.75rem;margin-top:1rem;">
        <button class="confirm-btn btn-half btn-del">確認</button>
        <button class="cancel-btn btn-half btn-save">取消</button>
      </div>
    </div>
  `;

    // 綁定按鈕事件
    confirmBox.querySelector(".confirm-btn").onclick = () => {
      // 1) 刪除該分類底下的所有任務（進行中 + 已完成）
      const delInSection = (arr) => arr.filter((t) => t.section !== id);
      tasks = delInSection(tasks);
      completedTasks = delInSection(completedTasks);

      // 2) 移除分類本身
      categories = categories.filter((c) => c !== id);

      // 3) 存檔（雲端/Firebase）
      saveTasksToFirebase(); // 你原本的儲存函式
      saveCategoriesToFirebase(); // 你原本的儲存函式

      // 4) 重畫 UI
      renderSections(categories);
      if (statusFilter === "done") {
        renderCompletedTasks();
      } else {
        showOngoing();
      }

      // 5) 關閉確認視窗
      confirmBox.remove();

      // 6) 從所有 select 中移除這個分類選項（避免殘留）
      const selects = [
        document.getElementById("taskSection"),
        document.getElementById("detailSection"),
      ];
      selects.forEach((select) => {
        if (!select) return;
        const option = select.querySelector(`option[value="${id}"]`);
        if (option) option.remove();
      });
    };

    confirmBox.querySelector(".cancel-btn").onclick = () => {
      confirmBox.remove();
    };

    document.body.appendChild(confirmBox);
  }

  //確認完成編輯
  function exitEditMode() {
    isEditing = false;

    // 收掉編輯配件
    document.querySelectorAll(".section").forEach((section) => {
      section.classList.remove("edit-mode");
      const titleBar = section.querySelector(".section-title");
      if (titleBar) titleBar.textContent = section.id; // 只留名稱
    });

    const exitBtn = document.getElementById("exitEditBtn");
    if (exitBtn) exitBtn.style.display = "none";

    // 乾淨銷毀拖拉
    if (sectionSortable && sectionSortable.destroy) {
      sectionSortable.destroy();
      sectionSortable = null;
    }

    // ✅ 無論如何都要還原濾鏡與重畫
    if (__savedFilters) {
      statusFilter = __savedFilters.statusFilter;
      filterDay = __savedFilters.filterDay;
      importantOnly = __savedFilters.importantOnly;
      __savedFilters = null;
    }

    refreshCurrentView(); // 依目前頁籤重畫（這步也會做空白隱藏）
    initSectionSortable(); // 非編輯模式下不會有把手，拖不動，OK
    updateSectionOptions();
  }

  //手機拖拉
  function initSectionSortable() {
    const el = document.getElementById("section-container");
    if (!el) return;

    // 先銷毀舊的，避免多次初始化衝突
    if (sectionSortable && sectionSortable.destroy) {
      sectionSortable.destroy();
    }

    sectionSortable = new Sortable(el, {
      animation: 150,
      handle: ".drag-handle",
      draggable: ".section",
      ghostClass: "dragging",

      // ⬇️ 立刻拖：取消長按延遲與門檻
      forceFallback: true,
      fallbackOnBody: true,
      delay: 0, // 立刻開始
      delayOnTouchOnly: false, // 不需要長按邏輯
      touchStartThreshold: 0, // 觸碰就拖

      onEnd: () => {
        categories = Array.from(
          document.querySelectorAll("#section-container .section")
        ).map((sec) => sec.id);
        saveCategoriesToFirebase();
      },
    });
  }
  function openRenameModal(sectionId) {
    pendingRenameId = sectionId;
    document.getElementById("renameInput").value = sectionId;
    document.getElementById("renameModal").style.display = "flex";
  }

  function confirmRename() {
    const oldId = pendingRenameId;
    const newName = document.getElementById("renameInput").value.trim();
    if (!newName || document.getElementById(newName)) {
      alert("名稱不可為空或已存在！");
      return;
    }

    // 進行中任務：改 section
    tasks.forEach((t) => {
      if (t.section === oldId) t.section = newName;
    });

    // 已完成任務：也要改 section
    completedTasks.forEach((t) => {
      if (t.section === oldId) t.section = newName;
    });

    // ✅ 把 categories 陣列裡的舊名換新名
    categories = categories.map((c) => (c === oldId ? newName : c));
    saveCategoriesToFirebase(); // 存分類
    saveTasksToFirebase(); // 存任務

    // ✅ 重畫 + 依當前頁籤刷新
    renderSections(categories);
    if (statusFilter === "done") {
      renderCompletedTasks();
    } else {
      showOngoing();
    }

    closeModal("renameModal");
    pendingRenameId = null;
  }

  //新增分類
  function updateSectionOptions() {
    const sections = document.querySelectorAll(".section");
    const options = Array.from(sections)
      .map((section) => {
        const id = section.id;
        return `<option value="${id}">${id}</option>`;
      })
      .join("");

    document.getElementById("taskSection").innerHTML = options;
    document.getElementById("detailSection").innerHTML = options;
  }

  //更多功能-篩選剩餘日
  let filterDay = "default"; // 預設：顯示所有分類(含空白)

  document.addEventListener("change", function (e) {
    if (e.target.matches('.filter-days input[type="radio"]')) {
      filterDay = e.target.value; // 直接切換
      applyDayFilter();
    }
  });

  function applyDayFilter() {
    const isDefault = filterDay === "default";

    // 先決定每張任務卡是否顯示（原本那段保留）
    document.querySelectorAll(".task").forEach((taskEl) => {
      const task = tasks.find((t) => t.id === taskEl.dataset.id);
      if (!task) return;
      let show = true;
      if (!isDefault && filterDay !== "all") {
        const days = getRemainingDays(task.date);
        const v = parseInt(filterDay, 10);
        show = days !== null && days <= v;
      }
      taskEl.style.display = show ? "" : "none";
    });

    // 分類顯示策略
    if (statusFilter === "done" || !isDefault) {
      hideEmptySectionsAfterFilter(); // 1/3/5/不限/已完成 → 隱藏空分類
    } else {
      // 預設 → 顯示全部分類
      document
        .querySelectorAll("#section-container .section")
        .forEach((sec) => (sec.style.display = ""));
    }
  }

  function openModalById(id) {
    document.getElementById(id).style.display = "flex";
  }

  //歷史紀錄
  // ====== 新增的全域狀態 ======
  let completedTasks = []; // 歸檔的完成任務
  let statusFilter = "ongoing"; // 進行中 / 已完成
  let completedMonthFilter = "recent15"; // recent15 或 '11407' 這種月份

  // 單選：任務狀態（即時切換）
  document.addEventListener("change", function (e) {
    if (e.target.matches('.filter-status input[type="radio"]')) {
      statusFilter = e.target.value; // 'ongoing' or 'done'
      if (statusFilter === "done") {
        // 禁用右下＋按鈕
        const fab = document.querySelector(".fab");
        if (fab) {
          fab.style.pointerEvents = "none"; // 不可點
          fab.style.opacity = "0.5"; // 變淡
        }

        completedMonthFilter = "recent15";
        buildDoneMonthMenu();
        document.getElementById("doneMore").style.display = "block";
        renderCompletedTasks();
      } else {
        // 恢復右下＋按鈕
        const fab = document.querySelector(".fab");
        if (fab) {
          fab.style.pointerEvents = "auto"; // 可點
          fab.style.opacity = "1"; // 還原
        }

        document.getElementById("doneMore").style.display = "none";
        showOngoing();
      }
    }
  });
  // 3) 監聽「天數設定」切換（在你的 document.addEventListener 區塊加這段）
  document.addEventListener("change", function (e) {
    if (e.target.matches('.filter-mode input[type="radio"]')) {
      dayMode = e.target.value; // 'work' or 'calendar'
      if (statusFilter === "done") {
        renderCompletedTasks(); // 完成視圖不吃天數，但保持一致刷新
      } else {
        showOngoing(); // 重新計算天數/顏色/排序並套用篩選
      }
    }
  });

  // 完成按鈕：改為歸檔（覆蓋你的 completeTask）
  function completeTask(id) {
    // 盡量收掉輸入法（OK：不分視圖都可做）
    commitActiveInput();

    const targetId = id || selectedTaskId;
    if (!targetId) return;

    const idx = tasks.findIndex((t) => t.id === targetId);
    if (idx === -1) return;

    const t = tasks[idx];

    // 只有當詳情視窗開著 & 正在編輯同一筆任務時，才從表單回寫
    const shouldHarvest =
      isModalOpen("detailModal") && selectedTaskId === targetId;

    if (shouldHarvest) {
      // 若有展開閱讀層，先把內容回灌到表單欄位
      flushViewerSync();

      // 回寫目前詳情表單的值（抓到欄位就寫，不開視窗時不執行）
      (function harvestDetailFormIntoTask(task) {
        const secEl = document.getElementById("detailSection");
        const ttlEl = document.getElementById("detailTitle");
        const ctnEl = document.getElementById("detailContent");
        const dateEl = document.getElementById("detailDate");
        const noteEl = document.getElementById("detailNote");
        const impEl = document.getElementById("detailImportant");

        if (secEl) task.section = secEl.value;
        if (ttlEl) task.title = ttlEl.value;
        if (ctnEl) task.content = ctnEl.value;
        if (dateEl) task.date = dateEl.value;
        if (noteEl) task.note = noteEl.value;
        if (impEl) task.important = !!impEl.checked;

        task.updatedAt = Date.now();
      })(t);
    }
    // ❗詳情未開/不同筆時，不回寫，避免把空白標題覆蓋掉

    const finished = { ...t, completedAt: Date.now() };

    // 從進行中移除 DOM + 陣列
    const el = document.querySelector(`[data-id='${targetId}']`);
    if (el) el.remove();
    tasks.splice(idx, 1);

    // 關詳情（若有開）
    closeModal("detailModal");

    // 推進已完成並存雲
    completedTasks.push(finished);
    saveTasksToFirebase();

    // 若是排程任務，產生下一筆（會沿用正確的 title/內容等）
    try {
      if (window.__recurrenceCore) {
        window.__recurrenceCore.spawnNextIfNeeded(t, finished.completedAt);
      }
    } catch (_) {}

    // 完成動畫
    const checkmark = document.getElementById("check-success");
    checkmark.classList.add("show");
    setTimeout(() => checkmark.classList.remove("show"), 1500);

    // 依目前頁籤刷新
    if (statusFilter === "done") {
      buildDoneMonthMenu();
      renderCompletedTasks();
    } else {
      applyDayFilter();
    }
  }

  // ====== 渲染邏輯 ======
  function clearAllSections() {
    document.querySelectorAll(".section").forEach((sec) => {
      // 保留 section-title，清掉任務卡
      Array.from(sec.querySelectorAll(".task")).forEach((t) => t.remove());
    });
  }

  function showOngoing() {
    if (window.__recurrenceCore) window.__recurrenceCore.healEmptyDates();

    clearAllSections();
    // 把任務裡用到的分類補進 categories（避免有任務但沒有分類）
    // 把任務裡用到的分類補進 categories（避免有任務但沒有分類）
    const needed = Array.from(
      new Set(tasks.map((t) => t.section).filter(Boolean))
    );

    if (categoriesLoaded) {
      const merged = Array.from(new Set([...(categories || []), ...needed]));
      if (merged.length !== (categories || []).length) {
        categories = merged;
        saveCategoriesToFirebase && saveCategoriesToFirebase();
      }
      renderSections && renderSections(categories);
    }
    // 分類尚未載入完成時，不渲染、不合併，等雲端資料到再畫

    // 重新把進行中 tasks 依 section 渲染
    tasks.forEach((t) => {
      const days = getRemainingDays(t.date);
      const bg = getColorByDays(days);
      const displayDays = days == null ? "無" : days;

      const el = document.createElement("div");
      el.className = "task";
      el.dataset.id = t.id;
      el.style.backgroundColor = bg;
      el.innerHTML = taskCardHTML(t, displayDays);
      applyIconsToCard(el, t);

      const sec = document.getElementById(t.section);
      if (sec) sec.appendChild(el);
    });

    // 依你原本邏輯排序
    const sections = new Set(tasks.map((t) => t.section));
    sections.forEach(sortTasks);

    // 進行中也要套用你目前的「剩餘天數」篩選
    applyDayFilter();
    bindSwipeToTasks();
    applyImportantFilter(); // ✅ 最後一層
  }

  // 轉民國年月（回傳如 "11407"）
  function toRocYM(input) {
    // 允許傳進來是字串或 Date
    const d = input instanceof Date ? input : new Date(input);

    // 沒填日期 or 無效日期 → 直接歸到「無」
    if (!input || isNaN(d.getTime())) return "無";

    const yy = d.getFullYear() - 1911;
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${yy}${mm}`;
  }

  // 生成月份清單（僅列出 >15 天的月份，且有資料的）
  function buildDoneMonthMenu() {
    const menu = document.getElementById("doneMonthMenu");
    if (!menu) return;
    menu.innerHTML = "";

    // 置頂：近5日
    const recentBtn = document.createElement("button");
    recentBtn.textContent = "近5日";
    recentBtn.style.cssText =
      "display:block;border:0;background:#fff;padding:6px 10px;border-radius:6px;cursor:pointer;width:100%;text-align:left;font-weight:600;";
    recentBtn.onclick = () => {
      completedMonthFilter = "recent15";
      menu.style.display = "none";
      renderCompletedTasks();
    };
    menu.appendChild(recentBtn);

    const monthSet = new Set();

    completedTasks.forEach((t) => {
      const d = new Date(t.date); // ← 改用預定完成日期
      const rocYM = toRocYM(d);
      console.log("Adding month:", rocYM); // 調試，檢查每個任務的年月是否正確
      monthSet.add(rocYM);
    });

    if (monthSet.size === 0) {
      const empty = document.createElement("div");
      empty.textContent = "無更多月份";
      menu.appendChild(empty);
      return;
    }

    // 將月份按字母排序並生成按鈕
    Array.from(monthSet)
      .sort((a, b) => b.localeCompare(a))
      .forEach((ym) => {
        const btn = document.createElement("button");
        btn.textContent = ym;
        btn.style.cssText =
          "display:block;border:0;background:#fff;padding:6px 10px;border-radius:6px;cursor:pointer;width:100%;text-align:left;";
        btn.onclick = () => {
          completedMonthFilter = ym;
          menu.style.display = "none";
          renderCompletedTasks();
        };
        menu.appendChild(btn);
      });
  }

  // 點「更多…」展開月份清單
  document.getElementById("doneMoreBtn")?.addEventListener("click", () => {
    const menu = document.getElementById("doneMonthMenu");
    if (!menu) return;
    menu.style.display =
      menu.style.display === "none" || menu.style.display === ""
        ? "block"
        : "none";
  });

  // 渲染已完成（預設顯示 15 日內；點月份則顯示該月份）
  function renderCompletedTasks() {
    clearAllSections();
    // 把已完成任務用到的分類也補回 categories
    // 把已完成任務用到的分類也補回 categories
    const needFromDone = Array.from(
      new Set(completedTasks.map((t) => t.section).filter(Boolean))
    );
    const merged2 = Array.from(
      new Set([...(categories || []), ...needFromDone])
    );

    if (merged2.length !== (categories || []).length) {
      categories = merged2;
      if (categoriesLoaded) {
        // ★★★ 分類載好後才允許存雲端
        saveCategoriesToFirebase();
      }
      renderSections(categories);
    }

    const now = new Date();
    const list = completedTasks.filter((t) => {
      const d = new Date(t.date); // ← 改用預定完成日期
      const rocYM = toRocYM(d); // 轉換為 ROC 年月

      console.log(
        "Task completedAt:",
        t.completedAt,
        "Converted to ROC YM:",
        rocYM
      ); // 調試，確認每個任務的時間戳與轉換結果

      if (completedMonthFilter === "recent15") {
        const completedDate = new Date(t.completedAt); // ← 用實際完成日期
        const diff = Math.floor(
          (Date.now() - completedDate.getTime()) / 86400000
        );
        return diff <= 5; // 只顯示最近 5 天完成的任務
      } else {
        return rocYM === completedMonthFilter; // 月份歸類用預定完成日期
      }
    });

    list.forEach((t) => {
      const el = document.createElement("div");
      el.className = "task";
      el.dataset.id = t.id;
      el.style.backgroundColor = "var(--green-light)"; // 完成用淡綠色背景
      const prefix = getTaskIconsPrefix(t);
      el.innerHTML = `
      <div class="task-content">
        <div class="task-title">✅ ${prefix}${t.title}</div>
      </div>
      <div class="task-days">完</div>
    `;
      el.onclick = () => openCompletedDetail(t.id);

      const sec = document.getElementById(t.section);
      if (sec) sec.appendChild(el);
    });
    hideEmptySectionsAfterFilter(); // ← 新增：完成視圖也隱藏空白分類
    applyImportantFilter(); // ✅ 最後一層
  }

  //已完成視窗細節
  function setDetailReadonly(ro) {
    const modal = document.getElementById("detailModal");
    if (modal) modal.classList.toggle("readonly", !!ro);
    [
      "detailSection",
      "detailTitle",
      "detailContent",
      "detailDate",
      "detailNote",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = ro;
    });

    const saveBtn = document.querySelector("#detailModal .save-btn-half");
    const delBtn = document.querySelector("#detailModal .delete-btn-half");
    const completeBtn = Array.from(
      document.querySelectorAll("#detailModal button")
    ).find((b) => b.textContent.includes("已完成"));

    if (ro) {
      if (saveBtn) {
        saveBtn.textContent = "我了解了！";
        saveBtn.onclick = () => closeModal("detailModal");
      }
      if (delBtn) {
        delBtn.onclick = confirmDeleteCompleted;
      } // ← 改叫「確認刪除(完成)」

      if (completeBtn) completeBtn.style.display = "none";
    } else {
      if (saveBtn) {
        saveBtn.textContent = "💾 儲存";
        saveBtn.onclick = saveTask;
      }
      if (delBtn) {
        delBtn.onclick = confirmDelete;
      }
      if (completeBtn) completeBtn.style.display = "";
    }

    // ★ 新增：鎖住/解鎖「重要」checkbox
    const importantEl = document.getElementById("detailImportant");
    if (importantEl) importantEl.disabled = ro;

    const btn = document.getElementById("recurrenceBtn");
    if (btn) btn.disabled = !!ro;
  }

  let selectedCompletedId = null;
  function openCompletedDetail(id) {
    if (isEditing) return; // ← 編輯分類時不開詳情
    resetDetailPanels();

    selectedCompletedId = id;
    const t = completedTasks.find((x) => x.id === id);
    if (!t) return;

    // 填值
    document.getElementById("detailSection").value = t.section;
    document.getElementById("detailTitle").value = t.title;
    document.getElementById("detailContent").value = t.content || "";
    document.getElementById("detailDate").value = t.date || "";
    document.getElementById("detailNote").value = t.note || "";
    {
      const lbl = document.getElementById("detailLastUpdate");
      if (lbl)
        lbl.textContent = t.completedAt
          ? "更新：" + formatRocDateTime(t.completedAt)
          : "";
    }

    setDetailReadonly(true);
    document.getElementById("detailModal").style.display = "flex";
  }

  function deleteCompleted() {
    if (!selectedCompletedId) return;
    const idx = completedTasks.findIndex((x) => x.id === selectedCompletedId);
    if (idx >= 0) completedTasks.splice(idx, 1);
    closeModal("detailModal");
    renderCompletedTasks();
  }

  function confirmDeleteCompleted() {
    const modal = document.getElementById("confirmModal");
    const confirmBtn = modal.querySelector(".confirm-btn");

    const oldHandler = confirmBtn.onclick; // 暫存原本（進行中刪除）的 handler
    confirmBtn.onclick = () => {
      // 暫時改成刪「已完成」
      deleteCompletedConfirmed();
      confirmBtn.onclick = oldHandler; // 刪完還原
    };

    modal.style.display = "flex";
  }

  function deleteCompletedConfirmed() {
    if (!selectedCompletedId) return;
    const idx = completedTasks.findIndex((x) => x.id === selectedCompletedId);
    if (idx >= 0) completedTasks.splice(idx, 1);

    // ✅ 這行一定要
    saveTasksToFirebase();

    closeModal("confirmModal");
    closeModal("detailModal");
    renderCompletedTasks();
  }
  //登入

  let loggingIn = false;

  function setLoginBusy(busy) {
    const btn = document.getElementById("login-btn");
    if (!btn) return;
    btn.disabled = busy;
    btn.textContent = busy ? "登入中…" : "登入";
  }

  auth.onAuthStateChanged(async (user) => {
    try {
      if (authTimer) {
        clearTimeout(authTimer);
        authTimer = null;
      }

      // 一進來就把 roomPath 接好（很關鍵）
      roomPath = hydrateRoomPath();

      document.documentElement.classList.remove("show-login", "show-app");

      if (user && roomPath) {
        document.documentElement.classList.add("show-app");

        // 清掉任何內聯 display，避免閃爍
        const lp = document.getElementById("loginPage");
        const app = document.querySelector(".container");
        if (lp) lp.style.display = "";
        if (app) app.style.display = "";

        loadTasksFromFirebase();
        updateSectionOptions();
      } else {
        // ⚠️ 不要在這裡 signOut()！只切畫面回登入即可
        document.documentElement.classList.add("show-login");
      }
    } catch (e) {
      console.error("onAuthStateChanged 錯誤：", e);
      alert("畫面初始化失敗：" + (e?.message || e));
      // 退回登入頁
      document.documentElement.classList.remove("show-app");
      document.documentElement.classList.add("show-login");
    } finally {
      hideAutoLoginOverlay();
      stopAutoLoginWatchdog();
      setLoginBusy(false);
      loggingIn = false;
    }
  });

  document
    .getElementById("login-btn")
    .addEventListener("click", async function () {
      if (loggingIn) return; // 防止重複點
      const username = document.getElementById("login-username").value.trim();
      const password = document.getElementById("login-password").value.trim();
      const autoLogin = document.getElementById("auto-login").checked;

      // 本次工作階段一定保存，讓不勾自動登入也能在本分頁 & 其他站內頁面使用
      sessionStorage.setItem(
        "todo_room_info_session",
        JSON.stringify({ username, password })
      );

      roomPath = `rooms/${sanitizeKey(username)}-${sanitizeKey(password)}`;

      // 只有勾選自動登入時，才長期保存到 localStorage
      if (autoLogin) {
        localStorage.setItem(
          "todo_room_info",
          JSON.stringify({ username, password })
        );
      } else {
        localStorage.removeItem("todo_room_info");
      }

      loggingIn = true;
      setLoginBusy(true);

      try {
        // 先登出舊的匿名使用者（加在這裡！）
        if (auth.currentUser) {
          await auth.signOut();
        }
        // 設一個 8 秒的保護時間，避免卡死
        const loginPromise = auth.signInAnonymously();
        await Promise.race([
          loginPromise,
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error("登入逾時，請重試")), 8000)
          ),
        ]);
        // 不在這裡切畫面，等 onAuthStateChanged 自動切
      } catch (e) {
        loggingIn = false;
        setLoginBusy(false);
        alert("登入失敗：" + (e && e.message ? e.message : e));
      }
    });

  // 從雲端載資料
  loadTasksFromFirebase();

  // === 自動登入（有記錄房間就直接進） ===
  // ✅ 最簡單的「一定會自動登入」版本

  // === 自動登入（統一走 ensureSignedIn） ===
  document.addEventListener("DOMContentLoaded", ensureSignedIn);
  window.addEventListener("pageshow", ensureSignedIn);
  // === 從雲端載入（先做進行中 tasks；completed 之後再接）===
  function loadTasksFromFirebase() {
    if (!roomPath || !auth.currentUser) return;

    // 1) 先取消舊監聽（包含 categoriesRef，避免殘留跨帳戶回呼）
    if (tasksRef) {
      try {
        tasksRef.off();
      } catch (_) {}
      tasksRef = null;
    }
    if (completedRef) {
      try {
        completedRef.off();
      } catch (_) {}
      completedRef = null;
    }
    if (categoriesRef) {
      try {
        categoriesRef.off();
      } catch (_) {}
      categoriesRef = null;
    }

    // 2) 切到新房前，清空本地狀態與 UI，避免 A → B 殘留
    categoriesLoaded = false;
    tasks = [];
    completedTasks = [];
    categories = [];
    const sc = document.getElementById("section-container");
    if (sc) sc.innerHTML = "";
    updateSectionOptions && updateSectionOptions();

    // 3) 綁定新房的資料節點（注意：這裡使用全域 categoriesRef）
    tasksRef = db.ref(`${roomPath}/tasks`);
    completedRef = db.ref(`${roomPath}/completedTasks`);
    categoriesRef = db.ref(`${roomPath}/categories`);

    // 4) 任務（先只接資料，不渲染；等分類載入完成後再畫）
    tasksRef.on("value", (snap) => {
      const data = snap.val() || {};
      tasks = Array.isArray(data) ? data.filter(Boolean) : Object.values(data);
      if (categoriesLoaded) showOngoing && showOngoing();
    });

    // 5) 已完成（同上，等分類載入完成）
    completedRef.on("value", (snap) => {
      const data = snap.val() || {};
      completedTasks = Array.isArray(data)
        ? data.filter(Boolean)
        : Object.values(data);
      if (!categoriesLoaded) return;
      if (statusFilter === "done") {
        renderCompletedTasks && renderCompletedTasks();
      }
    });

    // 6) 載入分類名稱（**分類是渲染的開關**）
    categoriesRef.on("value", (snap) => {
      const cloud = snap.val();

      // 用房間專屬 key，避免跨帳互相影響
      const welcomeKey = roomPath
        ? `welcome_shown_${roomPath}`
        : "welcome_shown";

      if (cloud === null) {
        // 第一次登入此房：不自動補預設，保持空清單
        categories = [];

        // 首次顯示歡迎窗（只對此房顯示一次）
        if (!localStorage.getItem(welcomeKey)) {
          const w = document.getElementById("welcomeModal");
          if (w) w.style.display = "flex";
          localStorage.setItem(welcomeKey, "1");
        }

        // 直接在雲端建立空陣列，之後就不會再收到 null
        try {
          categoriesRef.set([]);
        } catch (_) {}
      } else if (Array.isArray(cloud)) {
        categories = cloud.slice();
      } else if (cloud && typeof cloud === "object") {
        categories = Object.values(cloud);
      } else {
        categories = [];
      }

      // 標記分類已就緒 → 之後的渲染才允許進行
      categoriesLoaded = true;

      // 先畫分類，再依狀態畫內容
      renderSections && renderSections(categories);
      updateSectionOptions && updateSectionOptions();

      if (statusFilter === "done") {
        renderCompletedTasks && renderCompletedTasks();
      } else {
        showOngoing && showOngoing();
      }
    });
  }

  // === 寫回雲端（先寫 tasks；completed 之後再接）===
  function saveTasksToFirebase() {
    const obj = {};
    tasks.forEach((t) => (obj[t.id] = t));

    const doneObj = {};
    completedTasks.forEach((t) => (doneObj[t.id] = t));

    // 儲存任務資料
    db.ref(`${roomPath}/tasks`).set(obj);
    db.ref(`${roomPath}/completedTasks`).set(doneObj);

    // 儲存分類資料
  }

  //登出

  function openLogoutModal() {
    document.getElementById("logoutModal").style.display = "flex";
  }

  async function doLogout() {
    // 關閉 DB 監聽
    try {
      if (tasksRef) {
        tasksRef.off();
        tasksRef = null;
      }
      if (completedRef) {
        completedRef.off();
        completedRef = null;
      }
    } catch (e) {
      console.warn(e);
    }

    // 清空本機資料
    tasks = [];
    completedTasks = [];
    selectedTaskId = null;
    clearAllSections();

    // 清掉自動登入與房間
    localStorage.removeItem("todo_room_info");
    roomPath = "";

    // 嘗試登出（若沒開 Auth 也沒關係）
    try {
      if (firebase.auth) await auth.signOut();
    } catch (e) {
      /* 忽略 */
    }

    // 切回登入頁
    document.documentElement.classList.remove("show-app");
    document.documentElement.classList.add("show-login");

    closeModal("logoutModal");
    closeModal("moreModal"); // 關掉「⋯」選單
  }

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

  function getTitleWithFlag(t) {
    return (t.important ? "❗ " : "") + (t.title || "");
  }

  // 轉民國 yyyy/m/d HH:mm（小時與分鐘補0）
  function formatRocDateTime(ts) {
    if (!ts && ts !== 0) return ""; // 空字串＝不顯示
    const d = new Date(ts);
    if (isNaN(d)) return "";
    const y = d.getFullYear() - 1911;
    const m = d.getMonth() + 1; // 不補0
    const dd = d.getDate(); // 不補0
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${y}/${m}/${dd} ${hh}:${mm}`;
  }

  function renderSections(list) {
    const wrap = document.getElementById("section-container");
    // 先重建 doneMore（固定在最上面）
    wrap.innerHTML = `
    <div id="doneMore" style="display:none; text-align:right; margin:0.25rem 0;">
      <button id="doneMoreBtn" style="border:0; background:#eee; padding:6px 10px; border-radius:8px; cursor:pointer;">🗂️</button>
      <div id="doneMonthMenu" style="display:none; position:absolute; right:16px; background:#fff; border:1px solid #ddd; border-radius:8px; box-shadow:0 4px 10px rgba(0,0,0,.08); padding:6px; z-index:50;"></div>
    </div>
  `;

    // 依 categories 畫出各分類
    list.forEach((name) => {
      const sec = document.createElement("div");
      sec.className = "section";
      sec.id = name;
      sec.innerHTML = `<div class="section-title">${name}</div>`;
      wrap.appendChild(sec);
    });

    updateSectionOptions();
    initSectionSortable(); // 你已有的函式

    // 重新掛「更多…」按鈕的事件（因為 innerHTML 會清掉舊的事件）
    const btn = document.getElementById("doneMoreBtn");
    if (btn)
      btn.onclick = () => {
        const menu = document.getElementById("doneMonthMenu");
        if (menu)
          menu.style.display =
            menu.style.display === "block" ? "none" : "block";
      };

    // ✅ 如果還在編輯模式，重畫後馬上套回編輯配件
    if (isEditing) {
      decorateSectionsForEdit();
    }
  }

  function decorateSectionsForEdit() {
    const sections = document.querySelectorAll(".section");
    sections.forEach((section) => {
      section.classList.add("edit-mode");

      const titleBar = section.querySelector(".section-title");
      const currentName = section.id;

      // 先清乾淨避免重複疊
      titleBar.innerHTML = "";

      // 拖拉把手
      const drag = document.createElement("span");
      drag.className = "drag-handle";
      drag.innerHTML = "☰";
      titleBar.appendChild(drag);

      // 名稱
      const nameSpan = document.createElement("span");
      nameSpan.className = "section-name";
      nameSpan.style.marginLeft = "0.5rem";
      nameSpan.textContent = currentName;
      titleBar.appendChild(nameSpan);

      // 重命名（✎）
      const renameBtn = document.createElement("button");
      renameBtn.className = "rename-btn";
      renameBtn.innerHTML = "✎";
      renameBtn.onclick = () => openRenameModal(section.id);
      titleBar.appendChild(renameBtn);

      // 刪除（✕）
      const delBtn = document.createElement("button");
      delBtn.className = "delete-btn";
      delBtn.innerHTML = "✕";
      delBtn.onclick = () => confirmDeleteCategory(section.id);
      titleBar.appendChild(delBtn);
    });

    // 重新掛拖拉
    initSectionSortable();

    // 顯示底部「完成編輯」按鈕
    const exitBtn = document.getElementById("exitEditBtn");
    if (exitBtn) exitBtn.style.display = "block";
  }

  // ===== 滑動完成：立即可用 =====
  (function initSlideToComplete() {
    const track =
      document.getElementById("slideComplete")?.querySelector(".slide-track") ||
      (function () {
        // 如果還沒渲染 detailModal 就先等一下
        document.addEventListener("DOMContentLoaded", initSlideToComplete);
        return null;
      })();
    if (!track) return;

    const handle = document.getElementById("slideHandle");
    const fill = document.getElementById("slideFill");

    let dragging = false;
    let startX = 0;
    let startLeft = 0;

    function maxLeft() {
      // 可滑動範圍（容器寬 - 把手寬 - 兩側邊距 3px*2）
      const W = track.clientWidth;
      const hw = handle.clientWidth;
      return Math.max(0, W - hw - 6);
    }

    function setLeft(px) {
      const lim = maxLeft();
      const x = Math.max(0, Math.min(px, lim));
      handle.style.transform = `translateX(${x}px)`;
      const percent = Math.round((x / lim) * 100);
      fill.style.width = `${percent}%`;
      return percent;
    }

    function pointerDown(e) {
      dragging = true;
      const p = e.touches ? e.touches[0] : e;
      startX = p.clientX;
      // 解析目前 translateX
      const cur = handle.style.transform.match(/translateX\(([-\d.]+)px\)/);
      startLeft = cur ? parseFloat(cur[1]) : 0;
      e.preventDefault();
    }

    function pointerMove(e) {
      if (!dragging) return;
      const p = e.touches ? e.touches[0] : e;
      const dx = p.clientX - startX;
      setLeft(startLeft + dx);
      e.preventDefault();
    }

    function pointerUp() {
      if (!dragging) return;
      dragging = false;
      const lim = maxLeft();
      // 讀目前 translateX
      const cur = handle.style.transform.match(/translateX\(([-\d.]+)px\)/);
      const x = cur ? parseFloat(cur[1]) : 0;
      const percent = lim === 0 ? 0 : x / lim;

      // 到 90% 以上視為完成
      if (percent >= 0.9) {
        track.classList.add("done");
        setLeft(lim);
        // 稍等一下讓動畫有感覺
        setTimeout(() => {
          // 呼叫你現有的完成流程
          completeTask();
          // 重置外觀（下次再打開 modal 時是初始狀態）
          resetSlider();
        }, 200);
      } else {
        // 回彈
        handle.style.transition = "transform .25s ease";
        fill.style.transition = "width .25s ease";
        setLeft(0);
        setTimeout(() => {
          handle.style.transition = "";
          fill.style.transition = "width .25s ease"; // 保留 fill 的小過渡
        }, 260);
      }
    }

    function resetSlider() {
      track.classList.remove("done");
      handle.style.transition = "transform .2s ease";
      fill.style.transition = "width .25s ease";
      setLeft(0);
      setTimeout(() => {
        handle.style.transition = "";
      }, 220);
    }

    // 對外暴露，讓 openDetail 時可以重置
    window.__resetSlideComplete = resetSlider;

    // 綁定事件（滑鼠 + 觸控）
    handle.addEventListener("mousedown", pointerDown);
    document.addEventListener("mousemove", pointerMove);
    document.addEventListener("mouseup", pointerUp);

    handle.addEventListener("touchstart", pointerDown, { passive: false });
    document.addEventListener("touchmove", pointerMove, { passive: false });
    document.addEventListener("touchend", pointerUp);
  })();

  function closeFabMenu() {
    const m = document.getElementById("menu");
    const fab = document.querySelector(".fab");
    if (!m) return;
    m.classList.remove("show");
    if (fab) fab.classList.remove("open");
  }

  function toggleMenu() {
    const m = document.getElementById("menu");
    const fab = document.querySelector(".fab");
    if (!m || !fab) return;
    const willOpen = !m.classList.contains("show");
    m.classList.toggle("show", willOpen);
    fab.classList.toggle("open", willOpen);
  }

  // 🔻 全域點擊：點到 menu 以外，就自動關
  document.addEventListener("click", function (e) {
    const menu = document.getElementById("menu");
    if (!menu || !menu.classList.contains("show")) return;

    const fab = document.querySelector(".fab");
    const clickInsideMenu = menu.contains(e.target);
    const clickOnFab = fab && fab.contains(e.target);

    if (!clickInsideMenu && !clickOnFab) {
      closeFabMenu();
    }
  });

  // （可選但推薦）觸控更靈敏：手機先關
  document.addEventListener(
    "touchstart",
    function (e) {
      const menu = document.getElementById("menu");
      if (!menu || menu.style.display !== "flex") return;

      const fab = document.querySelector(".fab");
      const touchInsideMenu = menu.contains(e.target);
      const touchOnFab = fab && fab.contains(e.target);

      if (!touchInsideMenu && !touchOnFab) {
        closeFabMenu();
      }
    },
    { passive: true }
  );

  // （可選）按 ESC 關
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeFabMenu();
  });

  // ✅ 事件委派：點到任何開著的 modal 的「背景區」就關閉
  document.addEventListener(
    "click",
    function (e) {
      // 只處理點在 .modal 範圍內的事件
      const modal = e.target.closest(".modal");
      if (!modal) return;

      // 只關「有開著」的 modal（display !== 'none'）
      if (getComputedStyle(modal).display === "none") return;

      const content = modal.querySelector(".modal-content");
      // 點到內容框外（=背景遮罩）才關
      if (!content || !content.contains(e.target)) {
        closeModal(modal.id);
      }
    },
    { passive: true }
  );

  // （可選）按 Esc 關掉目前所有開著的 modal
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    document.querySelectorAll(".modal").forEach((m) => {
      if (getComputedStyle(m).display !== "none") closeModal(m.id);
    });
  });

  function hideEmptySectionsAfterFilter() {
    if (isEditing) {
      // 編輯時全部顯示，避免排序歪掉
      document
        .querySelectorAll("#section-container .section")
        .forEach((sec) => (sec.style.display = ""));
      return;
    }
    // ↓ 原本的隱藏邏輯保留
    const sections = document.querySelectorAll("#section-container .section");
    sections.forEach((sec) => {
      const hasVisibleTask = Array.from(sec.querySelectorAll(".task")).some(
        (el) => getComputedStyle(el).display !== "none"
      );
      sec.style.display = hasVisibleTask ? "" : "none";
    });
  }

  let __autoLoginShownAt = 0;

  function showAutoLoginOverlay() {
    const el = document.getElementById("autologin-overlay");
    if (!el) return;

    // 等兩個 frame，確保瀏覽器真的先把 overlay 畫出來
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        __autoLoginShownAt = performance.now();
        el.classList.add("show");
        el.setAttribute("aria-hidden", "false");

        // 強制一次 reflow，避免同幀被合併
        // （有些瀏覽器在極快切換時需要）
        void el.offsetHeight;
      });
    });
  }

  function hideAutoLoginOverlay() {
    const el = document.getElementById("autologin-overlay");
    if (!el) return;

    const minStay = 600; // 至少顯示 600ms，比 300ms 再明顯一些
    const elapsed = performance.now() - __autoLoginShownAt;
    const delay = Math.max(0, minStay - elapsed);

    setTimeout(() => {
      el.classList.remove("show");
      el.setAttribute("aria-hidden", "true");
    }, delay);
  }

  // ===== 自動登入看門狗：超時自救 =====
  let autoLoginWD = null;

  function startAutoLoginWatchdog() {
    stopAutoLoginWatchdog();
    autoLoginWD = setTimeout(runAutoLoginRescue, 2000); // 8 秒還沒好就救援
  }

  function stopAutoLoginWatchdog() {
    if (autoLoginWD) {
      clearTimeout(autoLoginWD);
      autoLoginWD = null;
    }
  }

  async function runAutoLoginRescue() {
    try {
      // === Soft retry（溫和重試）===
      await waitOnline();
      try {
        if (auth.currentUser) await auth.signOut();
      } catch (_) {}
      try {
        // 依當下環境安全設定持久性
        const idbOK = await testIndexedDB();
        const mode =
          isStandalone && idbOK
            ? firebase.auth.Auth.Persistence.LOCAL
            : firebase.auth.Auth.Persistence.NONE;
        await auth.setPersistence(mode);
      } catch (_) {}
      // 5 秒保護超時
      await Promise.race([
        auth.signInAnonymously(),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error("soft-timeout")), 5000)
        ),
      ]);
      return; // 成功就交給 onAuthStateChanged 後續切畫面
    } catch (_e1) {
      // 繼續下面 Hard reset
    }

    try {
      // === Hard reset（強制重開 Firebase App）===
      try {
        if (auth.currentUser) await auth.signOut();
      } catch (_) {}
      try {
        await firebase.app().delete();
      } catch (_) {}
      // 重新初始化
      firebase.initializeApp(firebaseConfig);
      window.auth = firebase.auth();
      window.db = firebase.database();

      try {
        const idbOK = await testIndexedDB();
        const mode =
          isStandalone && idbOK
            ? firebase.auth.Auth.Persistence.LOCAL
            : firebase.auth.Auth.Persistence.NONE;
        await auth.setPersistence(mode);
      } catch (_) {}

      await Promise.race([
        auth.signInAnonymously(),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error("hard-timeout")), 5000)
        ),
      ]);
      return;
    } catch (_e2) {
      // === 最終保底：給使用者手動登入 ===
      hideAutoLoginOverlay();
      document.documentElement.classList.remove("show-app");
      document.documentElement.classList.add("show-login");
      alert("自動登入逾時，請手動登入一次（已自動重設連線）。");
    }
  }

  // ===== Section 空白處：長按新增（不阻擋捲動）＋ 輕點彈跳 =====
  (function enableCleanLongPressNewTask() {
    const PRESS_MS = 900; // 長按門檻（可調 700~1000）
    const MOVE_TOL = 10; // 位移門檻（px）
    const PRESS_VISUAL_DELAY = 100; // 視覺壓下延遲，避免一滑就縮

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
      if (isEditing) return false;
      if (statusFilter === "done") return false;
      const sec = e.target.closest(".section");
      if (!sec) return false;
      if (e.target.closest(".task")) return false;
      if (e.target.closest(".drag-handle")) return false;
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

      // 不要 preventDefault，讓瀏覽器自然判斷要不要捲動
      pressSection = sec;
      longPressed = false;
      moved = false;

      const p = e.touches ? e.touches[0] : e;
      startX = p.clientX;
      startY = p.clientY;

      clearTimers();

      // 視覺壓下：延遲一點，避免一開始就縮而造成「卡」的錯覺
      visualTimer = setTimeout(() => {
        pressSection && pressSection.classList.add("__pressed");
      }, PRESS_VISUAL_DELAY);

      // 長按計時
      timer = setTimeout(() => {
        longPressed = true;
        removePressVisual();
        clearTimers();
        if (!isEditing && statusFilter !== "done") {
          try {
            closeFabMenu();
          } catch (_) {}
          openModal(pressSection?.id); // ★ 把被長按的 section 預選進去
        }
      }, PRESS_MS);
    }

    function pointerMove(e) {
      if (!timer && !visualTimer) return;

      const p = e.touches ? e.touches[0] : e;
      const dx = Math.abs(p.clientX - startX);
      const dy = Math.abs(p.clientY - startY);

      // 只要移動超過門檻，或明顯是「垂直滑動」→ 取消長按，讓捲動為主
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
      // 若短按且沒移動太多 → 小彈跳
      if (pressSection && !wasLong && !moved) {
        // 按到的還是同一個 section 才回饋
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

    // 不再攔 contextmenu；若你真的要完全關，可保留下一行
    // container.addEventListener('contextmenu', e => { if (isEligibleTarget(e)) e.preventDefault(); });

    // 綁定（滑鼠 + 觸控），觸控監聽改為 passive:true 以提升捲動順暢
    container.addEventListener("mousedown", pointerDown);
    container.addEventListener("mousemove", pointerMove);
    document.addEventListener("mouseup", pointerUpOrCancel);

    container.addEventListener("touchstart", pointerDown, { passive: true });
    container.addEventListener("touchmove", pointerMove, { passive: true });
    container.addEventListener("touchend", pointerUpOrCancel, {
      passive: true,
    });
    container.addEventListener("touchcancel", pointerUpOrCancel, {
      passive: true,
    });
  })();

  function taskCardHTML(task, displayDays) {
    return `
    <div class="swipe-bar right"><span class="label">✅ 已完成</span></div>
    <div class="swipe-bar left"><span class="label">🗑 移除</span></div>
    <div class="task-content">
      <div class="task-title">${getTitleWithFlag(task)}</div>
    </div>
    <div class="task-days">${displayDays}</div>
  `;
  }

  const V_SLOPE = 1.2;

  function bindSwipeToTasks() {
    if (statusFilter === "done") return;

    const BOUND = 0.75,
      H_START = 16,
      V_CANCEL = 10,
      DOMINANCE = 1.3,
      MAX_TILT = 3;

    document.querySelectorAll(".task").forEach((task) => {
      if (task.dataset.swipeBound === "1") return;
      task.dataset.swipeBound = "1";

      // 不用 click 開詳情，保險起見也清掉
      task.onclick = null;

      const barR = task.querySelector(".swipe-bar.right"); // ✅ 已完成
      const barL = task.querySelector(".swipe-bar.left"); // 🗑 移除
      const labR = barR?.querySelector(".label");
      const labL = barL?.querySelector(".label");

      let startX = 0,
        startY = 0,
        dx = 0,
        dy = 0,
        width = 0;
      let mode = "pending"; // 'pending' | 'swipe' | 'scroll'
      let isDown = false;
      let activePid = null;

      task.addEventListener("pointerdown", onDown);
      task.addEventListener("pointermove", onMove);
      task.addEventListener("pointerup", onUp);
      task.addEventListener("pointercancel", onCancel);
      task.addEventListener("lostpointercapture", onCancel);

      // 同時，把任何 click 都吞掉（我們不用 click 了）
      task.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
        },
        true
      );

      function onDown(e) {
        if (statusFilter === "done" || isEditing) return; // ← 編輯分類不啟動滑動
        if (e.target.closest("button, input, select, textarea")) return;

        isDown = true;
        activePid = e.pointerId;
        startX = e.clientX;
        startY = e.clientY;
        dx = dy = 0;
        width = task.offsetWidth || 1;
        mode = "pending";
        task.style.transition = "none";
        try {
          task.setPointerCapture(e.pointerId);
        } catch (_) {}
      }

      function onMove(e) {
        if (!isDown || e.pointerId !== activePid) return;
        if (mode === "scroll") return;

        dx = e.clientX - startX;
        dy = e.clientY - startY;

        // 明顯垂直 → 當捲動
        // 只在「尚未決定」狀態才允許被判定成捲動；一旦進入 swipe 就不被縱向打斷
        if (mode === "pending") {
          const adx = Math.abs(dx),
            ady = Math.abs(dy);
          // 縱向位移超過門檻，且斜率看起來比較像在垂直捲動，才切成 scroll
          if (ady > V_CANCEL && ady > adx * V_SLOPE) {
            mode = "scroll";
            resetBars();
            task.style.transform = "";
            return;
          }
        }

        if (mode === "pending") {
          // 還沒達到水平啟動距離
          if (Math.abs(dx) < H_START) return;

          // 水平優勢才進入 swipe
          if (Math.abs(dx) > Math.abs(dy) * DOMINANCE) {
            mode = "swipe";
          } else {
            mode = "scroll";
            return;
          }
        }

        if (mode !== "swipe") return;

        const adx = Math.abs(dx);
        const pct = Math.min(1, adx / width);
        const tilt = (dx / width) * MAX_TILT;
        task.style.transform = `translateX(${Math.round(
          dx
        )}px) rotate(${tilt}deg)`;

        if (dx > 0) {
          if (barR) barR.style.width = pct * 100 + "%";
          if (barL) barL.style.width = "0%";
          if (labR) {
            labR.style.opacity = Math.min(1, pct * 1.2);
            labR.style.transform = `translateX(${pct > 0.05 ? 0 : -6}px)`;
          }
          if (labL) {
            labL.style.opacity = 0;
            labL.style.transform = "translateX(6px)";
          }
        } else if (dx < 0) {
          if (barL) barL.style.width = pct * 100 + "%";
          if (barR) barR.style.width = "0%";
          if (labL) {
            labL.style.opacity = Math.min(1, pct * 1.2);
            labL.style.transform = `translateX(${pct > 0.05 ? 0 : 6}px)`;
          }
          if (labR) {
            labR.style.opacity = 0;
            labR.style.transform = "translateX(-6px)";
          }
        } else {
          resetBars();
        }
      }

      function onUp(e) {
        finish(e, false);
      }
      function onCancel(e) {
        finish(e, true);
      }

      function finish(e, cancel) {
        const wasSwipe = mode === "swipe";
        const tapLike =
          Math.abs(dx) < 4 && Math.abs(dy) < 4 && mode !== "scroll";

        mode = "pending";
        isDown = false;
        activePid = null;

        task.style.transition = "transform .18s ease";
        task.style.transform = "";
        resetBars();

        // 1) 真正的「點一下」才開詳情（完全不用 click）
        if (!wasSwipe && !cancel && tapLike) {
          const id = task.dataset.id;
          if (id) openDetail(id);
          cleanup();
          return;
        }

        // 2) 有滑動才進入這段
        if (!wasSwipe || cancel) {
          cleanup();
          return;
        }

        const adx = Math.abs(dx);
        const passed = adx >= width * BOUND;
        const toRight = dx > 0;

        if (passed) {
          const id = task.dataset.id;
          selectedTaskId = id; // 保留（詳情模式用得到）
          setTimeout(() => {
            if (toRight) completeTask(id);
            else deleteTask();
          }, 10);
        }
        cleanup();
      }

      function cleanup() {
        dx = dy = 0;
        try {
          task.releasePointerCapture?.(activePid);
        } catch (_) {}
      }

      function resetBars() {
        if (barR) {
          barR.style.width = "0%";
          if (labR) {
            labR.style.opacity = 0;
            labR.style.transform = "translateX(-6px)";
          }
        }
        if (barL) {
          barL.style.width = "0%";
          if (labL) {
            labL.style.opacity = 0;
            labL.style.transform = "translateX(6px)";
          }
        }
      }
    });
  }

  (function mountTodayBadge() {
    const el = document.getElementById("today-badge");
    if (!el) return;

    const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

    function fmtToday() {
      const now = new Date();
      const m = String(now.getMonth() + 1);
      const d = String(now.getDate());
      const w = WEEK[now.getDay()];
      // 極簡、不突兀：8/11（週一）
      return `${m}/${d}（${w}）`;
    }

    function render() {
      el.textContent = fmtToday();
    }

    function scheduleMidnightTick() {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      setTimeout(() => {
        render();
        scheduleMidnightTick();
      }, midnight - now);
    }

    render();
    scheduleMidnightTick();
  })();

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

  document.addEventListener("DOMContentLoaded", applySavedBgColor);

  document.addEventListener("click", function (e) {
    if (e.target.classList.contains("color-btn")) {
      const color = e.target.dataset.color;
      setAppBgColor(color);
    }
  });

  let __expandedFieldId = null;

  function toggleDetailExpand(fieldId, title) {
    const form = document.getElementById("detailForm");
    const viewer = document.getElementById("detailViewer");
    const vTitle = document.getElementById("viewerTitle");
    const vBody = document.getElementById("viewerBody");

    // 先移除舊監聽
    if (__expandedFieldId) {
      const prev = document.getElementById(__expandedFieldId);
      if (prev && prev.__viewerSync) {
        prev.removeEventListener("input", prev.__viewerSync);
        vBody.removeEventListener("input", vBody.__formSync);
        prev.__viewerSync = null;
        vBody.__formSync = null;
      }
    }

    // 若已展開，再呼叫 = 縮小
    const willCollapse =
      __expandedFieldId && (!fieldId || fieldId === __expandedFieldId);
    if (willCollapse) {
      form.classList.remove("hide");
      viewer.classList.remove("show");
      __expandedFieldId = null;
      return;
    }

    // 展開並填入內容
    const src = document.getElementById(fieldId);
    vTitle.textContent = title || "";
    vBody.value = src ? src.value || "" : "";
    viewer.classList.add("show");
    form.classList.add("hide");
    __expandedFieldId = fieldId;

    // 雙向同步
    if (src) {
      // 表單 -> 閱讀編輯器
      src.__viewerSync = () => {
        vBody.value = src.value || "";
      };
      src.addEventListener("input", src.__viewerSync);

      // 閱讀編輯器 -> 表單
      vBody.__formSync = () => {
        src.value = vBody.value || "";
      };
      vBody.addEventListener("input", vBody.__formSync);
    }
    // ★ 新增（歷程）：初始化 undo/redo 堆疊，並監聽輸入推入歷程
    __viewerHistory = [vBody.value || ""];
    __viewerRedoStack = [];
    updateViewerToolbar();

    // 去抖：避免每個 key 都 push（這裡用簡易版）
    if (vBody.__histHandler)
      vBody.removeEventListener("input", vBody.__histHandler);
    let __histTimer = null;
    vBody.__histHandler = () => {
      clearTimeout(__histTimer);
      __histTimer = setTimeout(() => pushViewerHistory(vBody.value || ""), 180);
    };
    vBody.addEventListener("input", vBody.__histHandler);
  }

  // === 安全 no-op，避免呼叫時炸掉 ===
  function bindDetailLiveSync(/* task */) {
    /* no-op: 先不做即時同步 */
  }
  function unbindDetailLiveSync() {
    /* no-op */
  }

  function resetDetailPanels() {
    const form = document.getElementById("detailForm");
    const viewer = document.getElementById("detailViewer");
    const vTitle = document.getElementById("viewerTitle");
    const vBody = document.getElementById("viewerBody");

    // 解除先前展開狀態的雙向同步監聽
    if (window.__expandedFieldId) {
      const prev = document.getElementById(__expandedFieldId);
      if (prev && prev.__viewerSync) {
        prev.removeEventListener("input", prev.__viewerSync);
        prev.__viewerSync = null;
      }
      if (vBody && vBody.__formSync) {
        vBody.removeEventListener("input", vBody.__formSync);
        vBody.__formSync = null;
      }
    }

    // ★★★ 新增：把閱讀視圖的「歷程監聽」與堆疊一併清掉，並刷新工具列按鈕狀態
    if (vBody && vBody.__histHandler) {
      vBody.removeEventListener("input", vBody.__histHandler);
      vBody.__histHandler = null;
    }
    // 這兩個若沒宣告過，請見下方「小補充」
    __viewerHistory = [];
    __viewerRedoStack = [];
    updateViewerToolbar?.();

    // 關閉閱讀視圖、恢復表單
    viewer?.classList.remove("show");
    form?.classList.remove("hide");

    // 清空閱讀面板內容，避免殘留上一次的文字
    if (vTitle) vTitle.textContent = "";
    if (vBody) vBody.value = "";

    // 清掉展開中的欄位記錄
    window.__expandedFieldId = null;

    // 滑桿也回到初始（避免上次停在 done 狀態）
    if (window.__resetSlideComplete) window.__resetSlideComplete();
  }
  // —— 調色盤互動 —— //
  let pendingColor = null;

  function openPaletteModal() {
    // 開啟前先清選取、並依目前設定預選
    const modal = document.getElementById("paletteModal");
    const tiles = modal.querySelectorAll(".palette-choice");
    tiles.forEach((t) => t.classList.remove("selected"));

    // 讀已儲存顏色（與你 setAppBgColor 同步）
    let cur = null;
    try {
      cur = localStorage.getItem("app_bg_fixed") || null;
    } catch (_) {}
    // 金屬模式以 'metal' 存，其他為色碼；找得到就預選
    if (cur) {
      const pre = Array.from(tiles).find((t) => t.dataset.color === cur);
      if (pre) {
        pre.classList.add("selected");
        pendingColor = cur;
      } else {
        pendingColor = cur;
      }
    } else {
      pendingColor = null;
    }

    modal.style.display = "flex";
  }

  // 打開調色盤
  document.getElementById("openPaletteBtn")?.addEventListener("click", () => {
    openPaletteModal();
  });

  // 點色塊：只切換選取，不立即套用
  document.addEventListener("click", function (e) {
    const btn = e.target.closest(".palette-choice");
    if (!btn) return;

    // 互斥選取
    const wrap = document.getElementById("paletteModal");
    wrap
      .querySelectorAll(".palette-choice")
      .forEach((t) => t.classList.remove("selected"));
    btn.classList.add("selected");
    pendingColor = btn.dataset.color || null;
  });

  // 確認：這時才套用顏色（復用你現成的 setAppBgColor）
  document
    .getElementById("paletteConfirmBtn")
    ?.addEventListener("click", () => {
      if (pendingColor) {
        setAppBgColor(pendingColor); // 你的函式已會同步記到 localStorage
      }
      closeModal("paletteModal");
    });

  // 用事件委派來綁（不怕元素還沒在 DOM 裡）
  document.addEventListener("click", function (e) {
    // 打開調色盤
    if (e.target.id === "openPaletteBtn") {
      openPaletteModal();
    }

    // 確認選色
    if (e.target.id === "paletteConfirmBtn") {
      if (pendingColor) setAppBgColor(pendingColor);
      closeModal("paletteModal");
    }
  });
  function applyImportantFilter() {
    // 只在開啟時作用；關閉時一律由 refreshCurrentView 還原
    if (!importantOnly) return;

    // 逐張任務卡，看對應資料是不是 important
    document.querySelectorAll("#section-container .task").forEach((el) => {
      const id = el.dataset.id;
      // 先在進行中找，找不到再到完成清單找
      let t = tasks.find((x) => x.id === id);
      if (!t) t = completedTasks.find((x) => x.id === id);

      const isImportant = !!(t && t.important);
      // 只保留重要；非重要就隱藏（不動原本排序/顏色/天數）
      el.style.display = isImportant ? "" : "none";
    });

    // 套完最後一層後，把空分類藏起來（沿用你既有的規則）
    hideEmptySectionsAfterFilter();
  }

  // 判斷在目前的濾鏡/頁籤下，這張卡是否會被顯示
  function isTaskVisibleUnderCurrentFilters(t) {
    // 在「已完成」頁籤永遠不會顯示進行中卡
    if (statusFilter === "done") return false;

    // 重要篩選
    if (importantOnly && !t.important) return false;

    // 剩餘日篩選：default/all 都視為不篩
    if (filterDay !== "default" && filterDay !== "all") {
      const days = getRemainingDays(t.date);
      const v = parseInt(filterDay, 10);
      if (days == null || days > v) return false;
    }
    return true;
  }

  // 需要的話，把畫面切回「進行中」並清掉濾鏡，讓新卡看得到
  function ensureOngoingVisible() {
    if (statusFilter === "done") {
      statusFilter = "ongoing";
      const dm = document.getElementById("doneMore");
      if (dm) dm.style.display = "none";
    }
    // 關掉「只看重要」
    const chk = document.getElementById("importantOnly");
    if (chk) chk.checked = false;
    importantOnly = false;

    // 清「剩餘日」濾鏡
    filterDay = "default";
  }

  // === 圖示前綴（❗️ / 📅）統一處理 ===
  function getTaskIconsPrefix(t) {
    let p = "";
    if (t?.important) p += "❗️";
    if (t?.recurrence && t.recurrence.type) p += "🗓️\u202F"; // 小空格（窄不換行）
    return p;
  }

  // 把卡片內的標題改成「[圖示][標題]」
  function applyIconsToCard(el, t) {
    const titleEl = el?.querySelector?.(".task-title");
    if (!titleEl) return;
    // 直接覆寫 textContent，避免舊的 ❗️ 重複
    titleEl.textContent = `${getTaskIconsPrefix(t)}${t.title || ""}`;
  }
  // === 將需要被 HTML inline 呼叫的函式掛到 window（置於檔案最後）===
  Object.assign(window, {
    openModal,
    closeModal,
    openModalById,
    toggleMenu,
    closeFabMenu,
    openCategoryModal,
    addCategory,
    enterEditMode,
    exitEditMode,
    confirmDeleteCategory,
    openRenameModal,
    confirmRename,
    addTask,
    openDetail,
    saveTask,
    confirmDelete,
    deleteTask,
    completeTask,
    openCompletedDetail,
    confirmDeleteCompleted,
    deleteCompletedConfirmed,
    openLogoutModal,
    doLogout,
  });

  // --- 這行以上 ---
})();

// 小保險：確保在 DOM 準備好後再跑需要抓節點的流程（可留可不留）
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {});
} else {
  // DOM 已就緒
}
