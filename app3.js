// public/app.js
(() => {
  // --- 這行以下貼你的原本腳本（原樣貼上即可） ---
  // PASTE HERE ↓↓↓
  // === Firebase 設定（請換成你自己的專案設定） ===
  const firebaseConfig = {
    apiKey: "AIzaSyBdjOF1TmU213ehRhRRzE6FCf8iyNe8WAg",
    authDomain: "calendar-3b939.firebaseapp.com",
    databaseURL:
      "https://calendar-3b939-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "calendar-3b939",
    storageBucket: "calendar-3b939.firebasestorage.app",
    messagingSenderId: "240245031166",
    appId: "1:240245031166:web:f7c4b802ae576d173fe5af",
  };

  let fbDb = null;
  let fbAuthReady = false;

  function ensureFirebase() {
    if (!window.firebase) return;
    if (fbDb) return;

    if (!firebaseConfig || firebaseConfig.apiKey === "YOUR_API_KEY") {
      console.warn("尚未設定 firebaseConfig，雲端儲存功能停用。");
      return;
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    fbDb = firebase.database();

    if (firebase.auth) {
      firebase
        .auth()
        .signInAnonymously()
        .then(() => {
          fbAuthReady = true;
        })
        .catch((err) => {
          console.error("Firebase 匿名登入失敗：", err);
        });
    }
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
  // ===== 小工具 =====
  const fmt2 = (n) => String(n).padStart(2, "0");
  const toHhmm = (m) => `${fmt2(Math.floor(m / 60))}:${fmt2(m % 60)}`;
  const parseHhmm = (s) => {
    const [h, mm] = s.split(":").map((x) => parseInt(x, 10));
    return h * 60 + mm;
  };

  // === 機構色盤與工具（放在小工具後面） ===

  // === 價格對照表（僅統計表內有的項目） ===
  const PRICE_MAP = {
    BA01: 260,
    BA02: 195,
    BA03: 35,
    BA04: 130,
    "BA05-1": 310,
    BA07: 325,
    BA08: 500,
    BA09: 2200,
    BA09a: 2500,
    BA10: 155,
    BA11: 195,
    BA12: 130,
    BA13: 195,
    BA14: 685,
    "BA15-1": 195,
    "BA15-2": 195,
    "BA16-1": 130,
    "BA16-2": 130,
    BA17a: 75,
    BA17b: 65,
    BA17c: 50,
    BA17d1: 50,
    BA17d2: 50,
    BA17e: 50,
    BA18: 200,
    BA20: 175,
    BA22: 130,
    BA23: 200,
    BA24: 220,
  };

  // 目前的機構篩選（"全部" 或某機構名）
  let currentOrgFilter = "全部";

  const ORG_PALETTE = [
    "#FFB3B8", // 1 淺紅
    "#FFC9A6", // 2 淺橘
    "#FFE79A", // 3 淺黃
    "#D7F59A", // 4 萊姆
    "#B6E3A8", // 5 淺綠
    "#A8E8E0", // 6 淺青綠(薄荷青)
    "#A7E8FF", // 7 淺青(天青)
    "#BBD5FF", // 8 淺藍
    "#D3C6FF", // 9 淺靛/薰衣草
    "#FFD1F0", // 10 淺洋紅/粉紫
  ];

  const orgColorMap = new Map();
  function colorForOrg(name) {
    if (!name) return "#e5e7eb";
    if (!orgColorMap.has(name)) {
      const idx = orgColorMap.size % ORG_PALETTE.length;
      orgColorMap.set(name, ORG_PALETTE[idx]);
    }
    return orgColorMap.get(name);
  }

  // 依「當月所有機構（排序後）」重置顏色，讓每次都從 ORG_PALETTE[0] 開始
  function resetOrgColors(monKey) {
    try {
      orgColorMap.clear();
    } catch (_) {
      // 若不是 Map 可忽略
    }
    const names =
      typeof uniqOrgsForMonth === "function"
        ? uniqOrgsForMonth(monKey) // 已排序好的清單
        : [];

    // 依序指派顏色（超過 10 個就循環）
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      orgColorMap.set(name, ORG_PALETTE[i % ORG_PALETTE.length]);
    }
  }

  function parseTimeRange(str) {
    if (!str) return null;
    const m = String(str).match(/(\d{1,2}:\d{2})\s*[~\-]\s*(\d{1,2}:\d{2})/);
    if (!m) return null;
    const start = parseHhmm(m[1]);
    const end = parseHhmm(m[2]);
    return { start, end };
  }
  function parseRocOrAdDate(token) {
    const m = String(token).match(/(\d{3,4})\/(\d{1,2})\/(\d{1,2})/);
    if (!m) return null;
    let y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const d = parseInt(m[3], 10);
    if (y < 1911) y += 1911; // 民國 ➜ 西元
    return new Date(y, mo, d);
  }
  function getCodeBeforeBracket(item) {
    if (!item) return "";
    const i = item.indexOf("[");
    return (i > 0 ? item.slice(0, i) : item).trim();
  }

  // 合併連續/重疊的時段，同時彙整該時段的項目數量
  // 合併連續/重疊的時段，同時彙整該時段的項目數量與機構
  function buildSegments(rows) {
    // rows: [{start,end, code, qty, org, staff}]
    const sorted = [...rows].sort((a, b) => a.start - b.start || a.end - b.end);
    const segs = [];
    for (const r of sorted) {
      if (!segs.length) {
        const orgs = new Map();
        if (r.org) orgs.set(r.org, 1);
        const staffs = new Map();
        if (r.staff) staffs.set(r.staff, 1);
        segs.push({
          start: r.start,
          end: r.end,
          items: new Map([[r.code, r.qty]]),
          orgs,
          staffs,
        });
        continue;
      }
      const last = segs[segs.length - 1];
      if (r.start <= last.end) {
        // 重疊或銜接
        last.end = Math.max(last.end, r.end);
        last.items.set(r.code, (last.items.get(r.code) || 0) + (r.qty || 0));
        if (r.org) last.orgs.set(r.org, (last.orgs.get(r.org) || 0) + 1);
        if (r.staff)
          last.staffs.set(r.staff, (last.staffs.get(r.staff) || 0) + 1);
      } else {
        const orgs = new Map();
        if (r.org) orgs.set(r.org, 1);
        const staffs = new Map();
        if (r.staff) staffs.set(r.staff, 1);
        segs.push({
          start: r.start,
          end: r.end,
          items: new Map([[r.code, r.qty]]),
          orgs,
          staffs,
        });
      }
    }
    return segs;
  }
  function buildDurationLabelByMinutes(startMin, endMin) {
    if (typeof startMin !== "number" || typeof endMin !== "number") return "";
    // 若結束時間小於開始，視為跨日
    if (endMin < startMin) endMin += 24 * 60;

    const diff = endMin - startMin;
    if (diff <= 0) return "";

    const h = Math.floor(diff / 60);
    const m = diff % 60;

    let text = "";
    if (h > 0) text += h + "h";
    if (m > 0) text += m + "m";

    return text ? "(" + text + ")" : "";
  }

  function buildDurationLabelByText(timeText) {
    // 支援格式：HH:MM~HH:MM 或 HH:MM ~ HH:MM
    const m = timeText.match(
      /(\d{1,2}):(\d{2})\s*[~～\-–]\s*(\d{1,2}):(\d{2})/
    );
    if (!m) return "";

    const sh = parseInt(m[1], 10);
    const sm = parseInt(m[2], 10);
    const eh = parseInt(m[3], 10);
    const em = parseInt(m[4], 10);

    let start = sh * 60 + sm;
    let end = eh * 60 + em;

    // 若結束時間小於開始時間，視為跨日
    if (end < start) {
      end += 24 * 60;
    }

    const diff = end - start;
    if (diff <= 0) return "";

    const h = Math.floor(diff / 60);
    const mm = diff % 60;
    const parts = [];
    if (h > 0) parts.push(h + "h");
    if (mm > 0) parts.push(mm + "m");

    return parts.length ? "(" + parts.join("") + ")" : "";
  }

  // 解析貼上內容 ➜ 結構化 { 'YYYY-MM': { 'YYYY-MM-DD': [rows...] } }
  function parsePastedText(raw) {
    const monthBuckets = new Map(); // key: YYYY-MM -> Map(dateStr -> rows)
    const monthsRows = new Map(); // YYYY-MM -> [{date, code, qty, org}]

    let rowCount = 0;
    const lines = String(raw).replace(/\r\n?/g, "\n").split("\n");

    for (const line of lines) {
      if (!line || !/(\d{3,4})\/(\d{1,2})\/(\d{1,2})/.test(line)) continue; // 必須含日期
      const cells = line.split(/\t+/g).map((s) => s.trim());
      // 找到日期欄位位置
      let dIdx = cells.findIndex((c) =>
        /(\d{3,4})\/(\d{1,2})\/(\d{1,2})/.test(c)
      );
      if (dIdx === -1) continue;
      const date = parseRocOrAdDate(cells[dIdx]);
      if (!date) continue;
      const y = date.getFullYear(),
        m = date.getMonth() + 1,
        d = date.getDate();
      const yymm = `${y}-${fmt2(m)}`;
      const ymd = `${y}-${fmt2(m)}-${fmt2(d)}`;

      const item = cells[dIdx + 1] || "";
      const code = getCodeBeforeBracket(item);
      const qty = parseInt(cells[dIdx + 3] || "0", 10) || 0; // 服務數量
      const tr =
        cells[dIdx + 4] ||
        cells.find((c) => /\d{1,2}:\d{2}\s*[~\-]\s*\d{1,2}:\d{2}/.test(c)) ||
        "";
      const org = (cells[dIdx + 5] || "").trim(); // 讀取「長照機構」
      let staff = (cells[dIdx + 6] || "").trim();
      // Fallback：若沒抓到，嘗試找像是人名的內容（2–6 個中英文字、純字串）
      if (!staff) {
        const cand = cells.find((c) => /^[A-Za-z\u4E00-\u9FFF]{2,6}$/.test(c));
        staff = cand || "";
      }

      const range = parseTimeRange(String(tr).replace(/\[[^\]]*\]/g, ""));
      if (!range || !code || qty <= 0) continue;

      if (!monthBuckets.has(yymm)) monthBuckets.set(yymm, new Map());
      const dayMap = monthBuckets.get(yymm);
      if (!dayMap.has(ymd)) dayMap.set(ymd, []);
      dayMap.get(ymd).push({
        start: range.start,
        end: range.end,
        code,
        qty,
        org,
        staff,
      });
      if (!monthsRows.has(yymm)) monthsRows.set(yymm, []);
      monthsRows.get(yymm).push({ date: ymd, code, qty, org, staff });

      rowCount++;
    }

    // 將每天的 rows 轉成 segments（合併時段+彙整項目）
    const result = new Map(); // YYYY-MM -> Map(ymd -> segments[])
    for (const [mon, dayMap] of monthBuckets) {
      const segMap = new Map();
      for (const [ymd, rows] of dayMap) {
        const segs = buildSegments(rows);
        segMap.set(ymd, segs);
      }
      result.set(mon, segMap);
    }

    return { months: result, rowCount, monthsRows };
  }

  // 建立指定月份的月曆（Mon-first）
  function renderCalendar(monKey, data) {
    const grid = document.getElementById("grid");
    grid.innerHTML = "";

    const [Y, M] = monKey.split("-").map(Number);
    const first = new Date(Y, M - 1, 1);
    const last = new Date(Y, M, 0);
    const daysInMonth = last.getDate();

    // Monday-first 偏移：將 JS 的 0(日)~6(六) 轉為 1~7（Mon=1)，算前置空格
    const jsDow = first.getDay(); // 0=Sun,1=Mon,...
    const lead = jsDow === 0 ? 6 : jsDow - 1; // 0(日)→6格；1(一)→0格

    // 取得該月的資料 map
    const dayMap = data.months.get(monKey) || new Map();

    // 前置空白
    for (let i = 0; i < lead; i++)
      grid.appendChild(document.createElement("div"));

    for (let day = 1; day <= daysInMonth; day++) {
      const ymd = `${Y}-${fmt2(M)}-${fmt2(day)}`;
      const cell = document.createElement("div");
      cell.className = "cell";

      const dateEl = document.createElement("div");
      dateEl.className = "date";
      dateEl.textContent = String(day);
      cell.appendChild(dateEl);

      const segs = dayMap.get(ymd) || [];
      const vis =
        currentOrgFilter === "全部"
          ? segs
          : segs.filter((s) => s.orgs && s.orgs.has(currentOrgFilter));
      if (vis.length) {
        cell.classList.add("has-data");
        const mark = document.createElement("div");
        mark.className = "mark";
        cell.appendChild(mark);
        for (const seg of vis) {
          const segEl = document.createElement("div");
          segEl.className = "seg";
          const time = `${toHhmm(seg.start)}–${toHhmm(seg.end)}`;
          const durationLabel = buildDurationLabelByMinutes(seg.start, seg.end);

          const timeEl = document.createElement("div");
          timeEl.className = "time";
          timeEl.textContent = time + (durationLabel || "");

          // 在時間右邊加色點，hover 顯示該段班的機構
          (function () {
            const entries = seg.orgs ? Array.from(seg.orgs.entries()) : [];
            if (!entries.length) return;
            // 以出現次數最多的機構決定顏色
            entries.sort((a, b) => b[1] - a[1]);
            const top = entries[0];
            const dot = document.createElement("span");
            let title = "";
            if (entries.length) {
              title += "機構：" + entries.map((e) => e[0]).join("、");
            }
            const staffs = seg.staffs ? Array.from(seg.staffs.entries()) : [];
            if (staffs.length) {
              staffs.sort((a, b) => b[1] - a[1]);
              title +=
                (title ? "\n" : "") +
                "服務人員：" +
                staffs.map((e) => e[0]).join("、");
            }
            dot.title = title || " ";

            dot.style.cssText =
              "display:inline-block;width:10px;height:10px;border-radius:50%;margin-left:6px;vertical-align:-1.05px;border:1px solid rgba(0,0,0,.12);background:" +
              colorForOrg(top && top[0]) +
              ";";

            timeEl.appendChild(dot);
          })();

          const itemsEl = document.createElement("div");
          itemsEl.className = "items";
          for (const [code, qty] of seg.items.entries()) {
            const chip = document.createElement("span");
            chip.className = "chip";
            chip.textContent = `${code}*${qty}`;
            itemsEl.appendChild(chip);
          }

          segEl.appendChild(timeEl);
          segEl.appendChild(itemsEl);
          cell.appendChild(segEl);
        }
      }
      grid.appendChild(cell);
    }
  }

  // 計算「目前篩選條件」下的有資料天數
  function countDaysWithData(monKey, data) {
    const dayMap = data.months.get(monKey) || new Map();

    // 未篩選＝全部：可直接用天數 Map 的大小
    if (currentOrgFilter === "全部") return dayMap.size;

    let days = 0;
    for (const segs of dayMap.values()) {
      if (Array.isArray(segs) && segs.length) {
        const hasThisOrg = segs.some(
          (seg) => seg?.orgs && seg.orgs.has(currentOrgFilter)
        );
        if (hasThisOrg) days++;
      }
    }
    return days;
  }

  function updateMetaBadge(monKey, data) {
    const badge = document.getElementById("metaBadge");
    if (!monKey) {
      badge.textContent = "尚未載入資料";
      return;
    }
    const cntDays = countDaysWithData(monKey, data);

    const note =
      currentOrgFilter && currentOrgFilter !== "全部"
        ? ` · 篩選：${currentOrgFilter}`
        : "";
    badge.textContent = `${monKey} · 有服務天數：${cntDays} 天${note}`;
  }

  // === 使用者登入 / 雲端儲存工具 ===

  function makeUserKey(account, password) {
    const a = (account || "").trim().toLowerCase();
    const p = (password || "").trim();
    if (!a || !p) return null;
    // 用 encodeURIComponent 把帳號+密碼壓成安全字串
    const raw = encodeURIComponent(a + "|" + p);
    return raw.replace(/%/g, "_");
  }

  function calendarsRef() {
    if (!fbDb || !currentUserKey) return null;
    return fbDb.ref("ltcCalendars").child(currentUserKey).child("entries");
  }

  function updateLoginUI() {
    if (loginBtn) {
      if (currentUserKey) {
        loginBtn.title = `已登入：${
          currentUserAccount || ""
        }（點此切換使用者）`;
      } else {
        loginBtn.title = "登入 / 建立我的帳號";
      }
    }
    if (recordsBtn) {
      if (currentUserKey) {
        recordsBtn.disabled = false;
      } else {
        recordsBtn.disabled = true;
      }
    }
  }

  function openLoginDialog(nextAction) {
    pendingAction = nextAction || null;
    if (!loginDlg) return;

    if (currentUserAccount) {
      loginAccount.value = currentUserAccount;
    } else {
      loginAccount.value = "";
    }
    loginPassword.value = "";

    if (loginAuto) {
      // 有存在 localStorage 就勾選，沒有就不勾
      try {
        const raw = localStorage.getItem("ltcCalendarUser");
        loginAuto.checked = !!raw;
      } catch {
        loginAuto.checked = false;
      }
    }

    if (logoutBtn) {
      logoutBtn.disabled = !currentUserKey; // 未登入就不能登出
    }

    loginDlg.showModal();
  }

  function logoutUser() {
    currentUserKey = null;
    currentUserAccount = null;
    try {
      localStorage.removeItem("ltcCalendarUser");
    } catch (e) {
      console.warn("移除 localStorage 使用者資訊失敗：", e);
    }
    updateLoginUI();
    alert("已登出。");
  }

  function handleLoginSubmit() {
    const acc = loginAccount.value.trim();
    const pwd = loginPassword.value.trim();
    if (!acc || !pwd) {
      alert("請輸入帳號與密碼");
      return;
    }
    ensureFirebase();
    if (!fbDb) {
      alert("目前尚未設定 Firebase，請先在程式中填入 firebaseConfig。");
      return;
    }

    const key = makeUserKey(acc, pwd);
    if (!key) {
      alert("帳號或密碼格式有誤");
      return;
    }

    currentUserKey = key;
    currentUserAccount = acc;

    const auto = loginAuto ? !!loginAuto.checked : true;

    try {
      if (auto) {
        localStorage.setItem(
          USER_STORAGE_KEY,
          JSON.stringify({ key, account: acc })
        );
      } else {
        localStorage.removeItem(USER_STORAGE_KEY);
      }
    } catch (e) {
      console.warn("處理 localStorage 自動登入設定失敗：", e);
    }

    updateLoginUI();
    loginDlg.close();

    if (pendingAction === "save") {
      pendingAction = null;
      saveCurrentCalendarToCloud();
    } else if (pendingAction === "records") {
      pendingAction = null;
      openRecordsDialog();
    }
  }

  const USER_STORAGE_KEY = "ltcCalendarUser";

  function restoreUserFromLocal() {
    try {
      const raw = localStorage.getItem(USER_STORAGE_KEY);
      if (!raw) return;

      const obj = JSON.parse(raw);
      if (!obj || !obj.key) return;

      currentUserKey = obj.key;
      currentUserAccount = obj.account || "";

      // 有還原使用者，就順便啟動 Firebase（匿名登入）
      ensureFirebase();
    } catch (e) {
      console.warn("讀取 localStorage 使用者資訊失敗：", e);
    }
  }

  function saveCurrentCalendarToCloud() {
    if (!currentMonthKey || !parsedData || !parsedData.rowCount) {
      alert("目前尚未產生任何月曆，請先貼上服務紀錄。");
      return;
    }
    if (!lastRawText) {
      alert("找不到原始貼上內容，請重新貼上一次後再儲存。");
      return;
    }
    ensureFirebase();
    if (!fbDb) {
      alert("目前尚未設定 Firebase，請先在程式中填入 firebaseConfig。");
      return;
    }
    if (!currentUserKey) {
      openLoginDialog("save");
      return;
    }

    const defaultLabel = `${currentMonthKey} 服務月曆`;
    const labelInput = prompt(
      "請為這份服務月曆取名（例如：2025-11 王小明）",
      defaultLabel
    );
    if (!labelInput) return;
    const label = labelInput.trim();
    if (!label) {
      alert("名稱不可為空白。");
      return;
    }

    const ref = calendarsRef();
    if (!ref) {
      alert("找不到雲端儲存路徑，請稍後再試。");
      return;
    }

    const days = countDaysWithData(currentMonthKey, parsedData);
    const basePayload = {
      label,
      monthKey: currentMonthKey,
      raw: lastRawText,
      rowCount: parsedData.rowCount || 0,
      daysWithData: days,
      updatedAt: Date.now(),
    };

    // 先找有沒有同名的
    ref
      .orderByChild("label")
      .equalTo(label)
      .once("value")
      .then((snap) => {
        let existingId = null;
        let existingVal = null;
        snap.forEach((child) => {
          if (!existingId) {
            existingId = child.key;
            existingVal = child.val() || null;
          }
        });

        if (existingId) {
          // 有同名 → 問要不要覆蓋
          const ok = confirm(`名稱「${label}」已存在，是否要覆蓋原有的紀錄？`);
          if (!ok) return;

          const payload = {
            ...(existingVal || {}),
            ...basePayload,
            createdAt: existingVal?.createdAt || Date.now(),
          };

          return ref.child(existingId).set(payload);
        } else {
          // 沒同名 → 新增
          const now = Date.now();
          const payload = {
            ...basePayload,
            createdAt: now,
          };
          const newRef = ref.push();
          return newRef.set(payload);
        }
      })
      .then((res) => {
        if (!res) return; // 使用者按「取消覆蓋」的情況
        alert("已儲存到雲端「我的服務月曆」。");
      })
      .catch((err) => {
        console.error("儲存到 Firebase 失敗：", err);
        alert("儲存失敗，請稍後再試。");
      });
  }

  function openRecordsDialog() {
    if (!recordsDlg) return;
    if (!currentUserKey) {
      openLoginDialog("records");
      return;
    }
    ensureFirebase();
    if (!fbDb) {
      alert("目前尚未設定 Firebase，請先在程式中填入 firebaseConfig。");
      return;
    }

    recordsDlg.showModal();
    loadRecordsList();
  }

  function loadRecordsList() {
    if (!recordsList) return;
    const ref = calendarsRef();
    if (!ref) {
      recordsList.textContent = "尚未登入，無法讀取雲端月曆。";
      return;
    }

    recordsList.innerHTML =
      '<div style="font-size:12px;color:#94a3b8;">讀取中...</div>';

    ref
      .orderByChild("updatedAt")
      .once("value")
      .then((snap) => {
        const entries = [];
        snap.forEach((child) => {
          const val = child.val() || {};
          entries.push({
            id: child.key,
            label: val.label || "(未命名)",
            monthKey: val.monthKey || "",
            rowCount: val.rowCount || 0,
            daysWithData: val.daysWithData || 0,
            updatedAt: val.updatedAt || 0,
            note: val.note || "", // ⭐ 帶出註記
          });
        });

        // 更新快取，給「註記」對話框使用
        recordsCache = entries
          .slice()
          .sort((a, b) => b.updatedAt - a.updatedAt);

        if (!recordsCache.length) {
          recordsList.innerHTML =
            '<div style="font-size:12px;color:#94a3b8;">尚未儲存月曆，請點選左方[儲存圖示]建立。</div>';
          return;
        }

        recordsList.innerHTML = "";
        for (const rec of recordsCache) {
          const row = document.createElement("div");
          row.className = "record-row";
          row.dataset.id = rec.id;

          const main = document.createElement("div");
          main.className = "record-main";

          const title = document.createElement("div");
          title.className = "record-title";
          title.textContent = rec.label;
          main.appendChild(title);

          const meta = document.createElement("div");
          meta.className = "record-meta";

          const ym = rec.monthKey || "未指定月份";
          const baseMeta = `${ym} · ${rec.daysWithData} 天 · ${rec.rowCount} 筆`;
          meta.dataset.base = baseMeta; // ⭐ 之後更新註記用
          meta.textContent = baseMeta + (rec.note ? "（已有註記）" : ""); // 有註記就加上提示
          main.appendChild(meta);

          const actions = document.createElement("div");
          actions.className = "record-actions";

          // [載入]
          const btnLoad = document.createElement("button");
          btnLoad.className = "primary";
          btnLoad.textContent = "載入";
          btnLoad.dataset.act = "load";
          actions.appendChild(btnLoad);

          // ⭐ 新增：[註記]（黃色）
          const btnNote = document.createElement("button");
          btnNote.className = "note-btn";
          btnNote.textContent = "註記";
          btnNote.dataset.act = "note";
          actions.appendChild(btnNote);

          // [改名]
          const btnRename = document.createElement("button");
          btnRename.className = "ghost";
          btnRename.textContent = "改名";
          btnRename.dataset.act = "rename";
          actions.appendChild(btnRename);

          // [刪除]
          const btnDelete = document.createElement("button");
          btnDelete.className = "ghost";
          btnDelete.textContent = "刪除";
          btnDelete.dataset.act = "delete";
          actions.appendChild(btnDelete);

          row.appendChild(main);
          row.appendChild(actions);
          recordsList.appendChild(row);
        }
      })
      .catch((err) => {
        console.error("讀取雲端月曆失敗：", err);
        recordsList.innerHTML =
          '<div style="font-size:12px;color:#f97373;">讀取失敗，請稍後再試。</div>';
      });
  }

  function loadRecordById(id) {
    const ref = calendarsRef();
    if (!ref) return;
    ref
      .child(id)
      .once("value")
      .then((snap) => {
        const val = snap.val();
        if (!val || !val.raw) {
          alert("這筆紀錄沒有可載入的內容。");
          return;
        }
        const raw = String(val.raw);
        const data = parsePastedText(raw);
        if (!data.rowCount) {
          alert("無法從這筆紀錄解析出有效資料。");
          return;
        }

        parsedData = data;
        lastRawText = raw;
        currentOrgFilter = "全部";

        const months = [...parsedData.months.keys()].sort();
        monthSelect.innerHTML = months
          .map((m) => `<option value="${m}">${m}</option>`)
          .join("");
        if (months.length > 1) {
          monthSelect.style.display = "inline-block";
        } else {
          monthSelect.style.display = "none";
        }

        const prefer = val.monthKey;
        if (prefer && parsedData.months.has(prefer)) {
          currentMonthKey = prefer;
        } else {
          currentMonthKey = months[0];
        }
        monthSelect.value = currentMonthKey;

        resetOrgColors(currentMonthKey);
        renderCalendar(currentMonthKey, parsedData);
        updateMetaBadge(currentMonthKey, parsedData);

        recordsDlg.close();
      })
      .catch((err) => {
        console.error("載入紀錄失敗：", err);
        alert("載入失敗，請稍後再試。");
      });
  }

  function renameRecordById(id, currentLabel) {
    const ref = calendarsRef();
    if (!ref) return;
    const newName = prompt("請輸入新的名稱：", currentLabel || "");
    if (!newName) return;

    ref
      .child(id)
      .update({ label: newName.trim(), updatedAt: Date.now() })
      .then(() => {
        loadRecordsList();
      })
      .catch((err) => {
        console.error("改名失敗：", err);
        alert("改名失敗，請稍後再試。");
      });
  }

  function deleteRecordById(id) {
    if (!confirm("確定要刪除這筆月曆紀錄嗎？此動作無法復原。")) return;
    const ref = calendarsRef();
    if (!ref) return;
    ref
      .child(id)
      .remove()
      .then(() => {
        loadRecordsList();
      })
      .catch((err) => {
        console.error("刪除失敗：", err);
        alert("刪除失敗，請稍後再試。");
      });
  }

  // UI 綁定
  const pasteBtn = document.getElementById("pasteBtn");
  const clearBtn = document.getElementById("clearBtn");
  const dlg = document.getElementById("pasteDlg");
  const rawInput = document.getElementById("rawInput");
  const monthSelect = document.getElementById("monthSelect");
  // ==== 篩選 / 統計 UI ====
  const filterBtn = document.getElementById("filterBtn");
  const statsBtn = document.getElementById("statsBtn");
  const filterDlg = document.getElementById("filterDlg");
  const filterBox = document.getElementById("filterOptions");
  const applyFilter = document.getElementById("applyFilter");
  const cancelFilter = document.getElementById("cancelFilter");
  const statsDlg = document.getElementById("statsDlg");
  const statsContent = document.getElementById("statsContent");
  const closeStats = document.getElementById("closeStats");

  // === 登入 / 雲端儲存 UI ===
  const saveBtn = document.getElementById("saveBtn");
  const recordsBtn = document.getElementById("recordsBtn");
  const loginBtn = document.getElementById("loginBtn");

  const loginDlg = document.getElementById("loginDlg");
  const loginAccount = document.getElementById("loginAccount");
  const loginPassword = document.getElementById("loginPassword");
  const loginAuto = document.getElementById("loginAuto"); // ⭐ 新增
  const cancelLogin = document.getElementById("cancelLogin");
  const submitLogin = document.getElementById("submitLogin");
  const logoutBtn = document.getElementById("logoutBtn"); // ⭐ 新增

  const recordsDlg = document.getElementById("recordsDlg");
  const recordsList = document.getElementById("recordsList");
  const closeRecords = document.getElementById("closeRecords");
  // 註記 dialog
  const noteDlg = document.getElementById("noteDlg");
  const noteInput = document.getElementById("noteInput");
  const cancelNote = document.getElementById("cancelNote");
  const saveNoteBtn = document.getElementById("saveNote");

  function openRecordsDlg() {
    const dlg = document.getElementById("recordsDlg");
    dlg.showModal();

    // ✅ iOS 防自動放大：確保沒有任何 input 取得焦點
    setTimeout(() => {
      if (
        document.activeElement &&
        typeof document.activeElement.blur === "function"
      ) {
        document.activeElement.blur();
      }
    }, 0);
  }

  // 取得某月份的所有機構（來自原始列）
  function uniqOrgsForMonth(monKey) {
    const rows = parsedData.monthsRows?.get(monKey) || [];
    const s = new Set();
    for (const r of rows) if (r.org) s.add(r.org);
    return Array.from(s).sort();
  }

  // 開啟篩選面板
  function openFilterUI() {
    const orgs = uniqOrgsForMonth(currentMonthKey);
    const opts = ["全部", ...orgs];
    filterBox.innerHTML = opts
      .map(
        (o) => `
      <label style="display:block;margin:6px 0">
        <input type="radio" name="orgFilter" value="${o}" ${
          currentOrgFilter === o ? "checked" : ""
        }>
        ${o}
      </label>
    `
      )
      .join("");
    filterDlg.showModal();
  }

  applyFilter.addEventListener("click", () => {
    const v =
      document.querySelector('input[name="orgFilter"]:checked')?.value ||
      "全部";
    currentOrgFilter = v;
    filterDlg.close();
    if (currentMonthKey) {
      renderCalendar(currentMonthKey, parsedData);
      updateMetaBadge(currentMonthKey, parsedData);
    }
  });
  cancelFilter.addEventListener("click", () => filterDlg.close());
  filterBtn.addEventListener("click", openFilterUI);

  // 開啟統計（以目前月份為範圍）
  // 開啟統計（以目前月份為範圍）
  function openStatsUI() {
    if (!currentMonthKey) {
      alert("請先貼上資料");
      return;
    }
    const rows = parsedData.monthsRows?.get(currentMonthKey) || [];
    const byOrg = new Map(); // org -> Map(code -> {qty, amount})
    const otherCodes = new Map(); // ★ 新增：非 PRICE_MAP 代碼彙總（GA09、CB04 等）

    for (const r of rows) {
      if (!r.code) continue;
      const price = PRICE_MAP[r.code];

      if (price) {
        // === 原本邏輯：PRICE_MAP 內的項目（目前都是 BA 碼） ===
        const org = r.org || "（未填機構）";
        if (!byOrg.has(org)) byOrg.set(org, new Map());
        const m = byOrg.get(org);
        const newQty = (m.get(r.code)?.qty || 0) + (r.qty || 0);
        m.set(r.code, { qty: newQty, amount: newQty * price });
      } else {
        // ★ 新增：不是 PRICE_MAP 的代碼 → 統一累計「組數」，不用算錢
        const newQty = (otherCodes.get(r.code) || 0) + (r.qty || 0);
        otherCodes.set(r.code, newQty);
      }
    }

    // 如果什麼都沒有，就顯示沒有可統計項目
    if (!byOrg.size && !otherCodes.size) {
      statsContent.textContent = "（本月無可統計項目）";
      statsDlg.showModal();
      return;
    }

    let out = "";

    // ① 先輸出 BA（或之後你加進 PRICE_MAP 的項目）統計
    if (byOrg.size) {
      for (const org of [...byOrg.keys()].sort()) {
        const m = byOrg.get(org);
        let total = 0;
        const lines = [];
        for (const code of [...m.keys()].sort()) {
          const { qty, amount } = m.get(code);
          total += amount;
          lines.push(`${code}*${qty}，${amount.toLocaleString("zh-TW")}`);
        }
        out += `${org}：\n${lines.join("\n")}\n合計：${total.toLocaleString(
          "zh-TW"
        )}\n------------------------\n`;
      }
      // 去掉最後一條多餘分隔線
      out = out.replace(/\n------------------------\n$/, "");
    } else {
      // 沒有任何 BA / PRICE_MAP 內項目時，補一句說明
      out += "（本月無可計價 BA 項目）";
    }

    // ② 再輸出「除了 BA 之外」的其他代碼 + 總組數
    if (otherCodes.size) {
      if (out) out += "\n------------------------\n";
      out += "其他項目使用情形：\n";
      for (const code of [...otherCodes.keys()].sort()) {
        const qty = otherCodes.get(code);
        out += `${code}*${qty}\n`;
      }
      // 移除最後一個多餘換行
      out = out.replace(/\n$/, "");
    }

    statsContent.textContent = out;
    statsDlg.showModal();
  }

  statsBtn.addEventListener("click", openStatsUI);
  closeStats.addEventListener("click", () => statsDlg.close());

  // 新增這兩行
  const clearRawBtn = document.getElementById("clearRaw");
  if (clearRawBtn)
    clearRawBtn.addEventListener("click", () => {
      rawInput.value = "";
      rawInput.focus();
    });

  let parsedData = { months: new Map(), rowCount: 0 };
  let currentMonthKey = null;
  // === 使用者登入 / 雲端儲存狀態 ===
  let currentUserKey = null;
  let currentUserAccount = null;
  let pendingAction = null; // "save" 或 "records"

  // === 我的服務月曆：快取清單 + 註記中使用的 id ===
  let recordsCache = []; // [{ id,label,monthKey,daysWithData,rowCount,updatedAt,note }]
  let currentNoteRecordId = null; // 正在編輯註記的那一筆 id

  pasteBtn.addEventListener("click", () => {
    rawInput.value = "";
    dlg.showModal();
  });
  document
    .getElementById("cancelPaste")
    .addEventListener("click", () => dlg.close());
  document.getElementById("fillSample").addEventListener("click", () => {
    rawInput.value = [
      "\t1\t114/08/30\tBA15-1[家務協助(自用)]\t補助\t1\t12:50~13:20[30分]\t—\t—\t—\t—",
      "\t2\t114/08/30\tBA13[陪同外出]\t補助\t1\t12:20~12:50[30分]\t—\t—\t—\t—",
      "\t3\t114/08/29\tBA02[基本日常照顧]\t補助\t1\t10:03~10:33[30分]\t—\t—\t—\t—",
      "\t4\t114/08/29\tBA20[陪伴服務]\t補助\t1\t10:33~11:03[30分]\t—\t—\t—\t—",
      "\t5\t114/08/29\tBA15-1[家務協助(自用)]\t補助\t1\t11:03~11:33[30分]\t—\t—\t—\t—",
    ].join("\n");
  });

  document.getElementById("confirmPaste").addEventListener("click", () => {
    const raw = rawInput.value.trim();
    if (!raw) {
      alert("請先貼上資料");
      return;
    }
    const data = parsePastedText(raw);
    if (!data.rowCount) {
      alert(
        "沒有解析到有效資料，請確認貼上的欄位含有：服務日期 / 服務項目 / 服務數量 / 服務區間起訖"
      );
      return;
    }

    parsedData = data;
    // 如果有多個月份，提供下拉選擇
    lastRawText = raw; // ★ 記住這次貼上的原始內容
    currentOrgFilter = "全部"; // 重新貼資料就重置篩選
    const months = [...parsedData.months.keys()].sort();
    monthSelect.innerHTML = months
      .map((m) => `<option value="${m}">${m}</option>`)
      .join("");
    if (months.length > 1) {
      monthSelect.style.display = "inline-block";
    } else {
      monthSelect.style.display = "none";
    }

    currentMonthKey = months[0];
    monthSelect.value = currentMonthKey;
    resetOrgColors(currentMonthKey);
    renderCalendar(currentMonthKey, parsedData);
    updateMetaBadge(currentMonthKey, parsedData);
    dlg.close();
  });

  monthSelect.addEventListener("change", (e) => {
    currentMonthKey = e.target.value;
    resetOrgColors(currentMonthKey);
    renderCalendar(currentMonthKey, parsedData);
    updateMetaBadge(currentMonthKey, parsedData);
  });

  clearBtn.addEventListener("click", () => {
    parsedData = { months: new Map(), rowCount: 0 };
    currentMonthKey = null;
    lastRawText = "";
    document.getElementById("grid").innerHTML = "";
    document.getElementById("metaBadge").textContent = "尚未載入資料";
    monthSelect.style.display = "none";
    orgColorMap.clear();
  });

  // 初始渲染空月曆：呈現本月結構（方便一開始就有格子）
  (function initEmpty() {
    const now = new Date();
    const key = `${now.getFullYear()}-${fmt2(now.getMonth() + 1)}`;
    const fake = { months: new Map([[key, new Map()]]), rowCount: 0 };
    renderCalendar(key, fake);
  })();

  /* ===== 匯出：打開對話框 ===== */
  const exportBtn = document.getElementById("exportBtn");
  const exportDlg = document.getElementById("exportDlg");
  const exportName = document.getElementById("exportName");
  const optCalendar = document.getElementById("optCalendar");
  const optStats = document.getElementById("optStats");
  document
    .getElementById("cancelExport")
    ?.addEventListener("click", () => exportDlg.close());
  exportBtn?.addEventListener("click", () => {
    if (!currentMonthKey) {
      alert("請先貼上資料");
      return;
    }
    exportName.value = ""; // 預設清空
    optCalendar.checked = true; // 預設全選
    optStats.checked = true;
    exportDlg.showModal();
  });

  /* ===== 工具：重用你的統計邏輯，轉成可列印結構 ===== */
  function buildStatsForMonth(monKey, data, filterOrg = "全部") {
    const rows = data.monthsRows?.get(monKey) || [];
    const byOrg = new Map(); // org -> Map(code -> {qty, amount})

    for (const r of rows) {
      // ★ 這行：若有指定單位，就只計算該單位
      if (filterOrg && filterOrg !== "全部" && r.org !== filterOrg) continue;

      const price = PRICE_MAP[r.code];
      if (!price) continue;
      const org = r.org || "（未填機構）";
      if (!byOrg.has(org)) byOrg.set(org, new Map());
      const m = byOrg.get(org);
      const newQty = (m.get(r.code)?.qty || 0) + (r.qty || 0);
      m.set(r.code, { qty: newQty, amount: newQty * price });
    }
    return byOrg;
  }

  /* ===== 工具：依目前篩選條件組 meta 文字（沿用你畫面上的規則） ===== */
  function getCurrentMetaText(monKey, data) {
    const days = countDaysWithData(monKey, data);
    const note =
      currentOrgFilter && currentOrgFilter !== "全部"
        ? ` · 篩選：${currentOrgFilter}`
        : "";
    return `${monKey} · 有服務天數：${days} 天${note}`;
  }

  /* ===== 產生「列印專用月曆」：不動你原本畫面 ===== */
  function renderPrintCalendar(monKey, data) {
    const wrap = document.createElement("div");
    wrap.className = "print-cal";

    // 星期列
    const head = document.createElement("div");
    head.className = "print-dow";
    head.innerHTML = `<div>一</div><div>二</div><div>三</div><div>四</div><div>五</div>
                      <div style="color:#a61e4d">六</div><div style="color:#a61e4d">日</div>`;
    wrap.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "print-grid";
    wrap.appendChild(grid);

    const [Y, M] = monKey.split("-").map(Number);
    const first = new Date(Y, M - 1, 1);
    const last = new Date(Y, M, 0);
    const daysInMonth = last.getDate();
    const jsDow = first.getDay(); // 0=Sun
    const lead = jsDow === 0 ? 6 : jsDow - 1;

    const dayMap = data.months.get(monKey) || new Map();

    for (let i = 0; i < lead; i++)
      grid.appendChild(document.createElement("div"));

    for (let day = 1; day <= daysInMonth; day++) {
      const ymd = `${Y}-${String(M).padStart(2, "0")}-${String(day).padStart(
        2,
        "0"
      )}`;
      const cell = document.createElement("div");
      cell.className = "print-cell";

      const d = document.createElement("div");
      d.className = "print-date";
      d.textContent = String(day);
      cell.appendChild(d);

      const segs = dayMap.get(ymd) || [];
      const vis =
        currentOrgFilter === "全部"
          ? segs
          : segs.filter((s) => s.orgs && s.orgs.has(currentOrgFilter));

      if (vis.length) {
        for (const seg of vis) {
          const segEl = document.createElement("div");
          segEl.className = "print-seg";

          const timeText = `${toHhmm(seg.start)}–${toHhmm(seg.end)}`;
          const durationLabel = buildDurationLabelByMinutes(seg.start, seg.end);

          const timeEl = document.createElement("div");
          timeEl.className = "print-time";
          timeEl.textContent = timeText + (durationLabel || "");

          // 色點（取出現最多的機構）
          const entries = seg.orgs ? Array.from(seg.orgs.entries()) : [];
          if (entries.length) {
            entries.sort((a, b) => b[1] - a[1]);
            const dot = document.createElement("span");
            dot.className = "print-dot";
            dot.style.background = colorForOrg(entries[0][0]);
            timeEl.appendChild(dot);
          }

          const itemsEl = document.createElement("div");
          itemsEl.className = "print-items";
          const list = [...seg.items.entries()].sort((a, b) =>
            a[0].localeCompare(b[0])
          );
          for (const [code, qty] of list) {
            const chip = document.createElement("span");
            chip.className = "print-chip";
            chip.textContent = `${code}*${qty}`;
            itemsEl.appendChild(chip);
          }

          segEl.appendChild(timeEl);
          segEl.appendChild(itemsEl);
          cell.appendChild(segEl);
        }
      }

      grid.appendChild(cell);
    }

    return wrap;
  }

  /* ===== 產生「列印專用統計」 ===== */
  function renderPrintStats(byOrgMap) {
    const root = document.createElement("div");
    root.className = "print-stats";

    const orgs = [...byOrgMap.keys()].sort();
    for (const org of orgs) {
      const card = document.createElement("div");
      card.className = "stat-card";

      const title = document.createElement("div");
      title.className = "stat-title";
      title.textContent = org;
      card.appendChild(title);

      const tbl = document.createElement("table");
      tbl.className = "stat-table";
      tbl.innerHTML = `<thead>
        <tr><th>項目代碼</th><th>數量</th><th>小計</th></tr>
      </thead><tbody></tbody>`;
      const tbody = tbl.querySelector("tbody");

      let total = 0;
      const m = byOrgMap.get(org);
      for (const code of [...m.keys()].sort()) {
        const { qty, amount } = m.get(code);
        total += amount;
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${code}</td><td>${qty}</td><td>${amount.toLocaleString(
          "zh-TW"
        )}</td>`;
        tbody.appendChild(tr);
      }
      card.appendChild(tbl);

      const totalEl = document.createElement("div");
      totalEl.className = "stat-total";
      totalEl.textContent = `合計：${total.toLocaleString("zh-TW")}`;
      card.appendChild(totalEl);

      root.appendChild(card);
    }

    return root;
  }

  /* ===== 組裝整份列印文件並呼叫瀏覽器 PDF ===== */
  document.getElementById("doExport")?.addEventListener("click", () => {
    const name = exportName.value.trim();
    const needCal = !!optCalendar.checked;
    const needStats = !!optStats.checked;

    if (!needCal && !needStats) {
      alert("請至少勾選一個匯出內容");
      return;
    }

    exportDlg.close();

    // 建立列印根節點（不影響原畫面）
    const root = document.createElement("div");
    root.className = "print-only print-root";

    // 頭部（標題 + 當月 Meta + 個案姓名）
    const head = document.createElement("div");
    head.className = "print-head";

    const left = document.createElement("div");
    left.innerHTML =
      `<div class="print-title">長照服務紀錄彙整</div>` +
      (name ? `<div class="print-patient">個案：${name}</div>` : "");
    head.appendChild(left);

    const right = document.createElement("div");
    right.className = "print-meta";
    right.textContent = getCurrentMetaText(currentMonthKey, parsedData);
    head.appendChild(right);

    root.appendChild(head);

    // 內容：月曆 + 統計（依勾選）
    if (needCal) {
      root.appendChild(renderPrintCalendar(currentMonthKey, parsedData));
    }
    if (needStats) {
      const byOrg = buildStatsForMonth(
        currentMonthKey,
        parsedData,
        currentOrgFilter
      );

      if (byOrg.size) {
        root.appendChild(renderPrintStats(byOrg));
      } else {
        const none = document.createElement("div");
        none.style.cssText = "margin-top:8px;color:#94a3b8;";
        none.textContent = "（本月無可計價項目）";
        root.appendChild(none);
      }
    }

    document.body.appendChild(root);

    // 觸發列印（使用瀏覽器的「另存為 PDF」）
    window.print();

    // 列印對話框關閉後，清理節點（部分瀏覽器需要延遲一下）
    setTimeout(() => {
      try {
        root.remove();
      } catch (e) {}
    }, 500);
  });

  // === 我的服務月曆：清單搜尋 ===
  function filterRecordsList(query) {
    const list = document.getElementById("recordsList");
    if (!list) return;

    const rows = list.querySelectorAll(".record-row");
    const q = (query || "").trim().toLowerCase();
    let visibleCount = 0;

    rows.forEach((row) => {
      // 用整張卡片的文字當成搜尋來源：月份、姓名、天數、筆數……都會被搜到
      const text = row.textContent.toLowerCase();
      const matched = !q || text.includes(q);

      row.style.display = matched ? "" : "none";
      if (matched) visibleCount++;
    });

    const emptyHint = document.getElementById("recordsEmpty");
    if (emptyHint) {
      // 有輸入且 0 筆 => 顯示「查無結果」
      // 沒輸入且 0 筆 => 也可以顯示（看你習慣），這裡一併當作顯示
      emptyHint.style.display = visibleCount === 0 ? "block" : "none";
    }
  }

  // 每次打字就即時篩選
  function setupRecordsSearch() {
    const input = document.getElementById("recordsSearch");
    if (!input) return;

    input.addEventListener("input", () => {
      filterRecordsList(input.value);
    });
  }

  // ✅ 在初始化時呼叫一次（放在你原本的 init / DOMContentLoaded 那區）
  document.addEventListener("DOMContentLoaded", () => {
    setupRecordsSearch();
  });

  // ===== 從網址 #data=... 自動載入並產生月曆（給右鍵 / 擴充功能用） =====
  (function initFromHash() {
    if (!location.hash.startsWith("#data=")) return;

    try {
      const encoded = location.hash.slice(6); // 拿掉 "#data="
      const raw = decodeURIComponent(encoded || "");
      let text = (raw || "").trim();
      if (!text) return;

      // 如果已經是正常「貼上的一坨」(有 tab 或換行)，直接丟進原本 parser
      let normalized = text;

      // 如果完全沒有 tab，但看起來是「1 114/10/30 BA02...  2 114/10/30 ...」這種串，
      // 幫你依「編號 + 日期」切成多列，再用 tab 串回去，讓 parsePastedText 可以吃。
      if (!/\t/.test(text) && /(\d{3,4})\/(\d{1,2})\/(\d{1,2})/.test(text)) {
        const tokens = text.split(/\s+/).filter(Boolean);
        const rows = [];
        let current = [];

        for (let i = 0; i < tokens.length; i++) {
          const t = tokens[i];
          const next = tokens[i + 1] || "";

          // 偵測「新的一列」開頭：數字 + 日期
          if (
            current.length > 0 &&
            /^\d+$/.test(t) &&
            /^(\d{3,4})\/(\d{1,2})\/(\d{1,2})$/.test(next)
          ) {
            rows.push(current.join("\t"));
            current = [t]; // 這個編號當下一列的開頭
          } else {
            current.push(t);
          }
        }
        if (current.length) {
          rows.push(current.join("\t"));
        }

        normalized = rows.join("\n");
        // console.log("normalized from hash:\n", normalized);
      }

      const data = parsePastedText(normalized);
      if (!data.rowCount) {
        console.warn("從 #data 解析不到有效資料");
        return;
      }

      lastRawText = normalized; // ★ 也記住這份來源文字
      // == 以下完全比照你 confirmPaste 那段 ==

      parsedData = data;
      currentOrgFilter = "全部";

      const months = [...parsedData.months.keys()].sort();
      monthSelect.innerHTML = months
        .map((m) => `<option value="${m}">${m}</option>`)
        .join("");

      if (months.length > 1) {
        monthSelect.style.display = "inline-block";
      } else {
        monthSelect.style.display = "none";
      }

      currentMonthKey = months[0];
      monthSelect.value = currentMonthKey;

      resetOrgColors(currentMonthKey);
      renderCalendar(currentMonthKey, parsedData);
      updateMetaBadge(currentMonthKey, parsedData);

      // 清掉 #data，避免重整又跑一次
      history.replaceState(null, "", location.pathname + location.search);
    } catch (e) {
      console.error("解析 #data 失敗：", e);
    }
  })();
  // === 登入 / 儲存 / 我的月曆事件綁定 ===

  loginBtn?.addEventListener("click", () => {
    openLoginDialog(null);
  });
  cancelLogin?.addEventListener("click", () => {
    loginDlg.close();
  });
  submitLogin?.addEventListener("click", () => {
    handleLoginSubmit();
  });

  saveBtn?.addEventListener("click", () => {
    saveCurrentCalendarToCloud();
  });

  recordsBtn?.addEventListener("click", () => {
    openRecordsDialog();
  });

  closeRecords?.addEventListener("click", () => {
    recordsDlg.close();
  });

  logoutBtn?.addEventListener("click", () => {
    if (!currentUserKey) {
      alert("目前尚未登入。");
      return;
    }
    if (confirm("確定要登出嗎？這台裝置將不再自動登入。")) {
      logoutUser();
      loginDlg.close();
    }
  });

  recordsList?.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const act = btn.dataset.act;
    const row = btn.closest(".record-row");
    if (!row) return;
    const id = row.dataset.id;
    if (!id) return;

    if (act === "load") {
      loadRecordById(id);
    } else if (act === "rename") {
      const labelEl = row.querySelector(".record-title");
      const currentLabel = labelEl ? labelEl.textContent : "";
      renameRecordById(id, currentLabel);
    } else if (act === "delete") {
      deleteRecordById(id);
    } else if (act === "note") {
      // ⭐ 開啟註記 dialog
      currentNoteRecordId = id;
      const rec = recordsCache.find((r) => r.id === id);
      noteInput.value = rec?.note || "";
      noteDlg.showModal();
      setTimeout(() => noteInput.focus(), 10);
    }
  });

  // ⭐ 註記 dialog：取消
  cancelNote?.addEventListener("click", () => {
    currentNoteRecordId = null;
    noteDlg.close();
  });

  // ⭐ 註記 dialog：儲存
  saveNoteBtn?.addEventListener("click", () => {
    if (!currentNoteRecordId) {
      noteDlg.close();
      return;
    }
    const text = noteInput.value.trim();
    const ref = calendarsRef();
    if (!ref) {
      alert("找不到雲端儲存路徑，請稍後再試。");
      return;
    }

    ref
      .child(currentNoteRecordId)
      .update({ note: text })
      .then(() => {
        // 更新快取
        const rec = recordsCache.find((r) => r.id === currentNoteRecordId);
        if (rec) rec.note = text;

        // 更新畫面上的「已有註記」顯示
        const row = recordsList?.querySelector(
          `.record-row[data-id="${currentNoteRecordId}"]`
        );
        if (row) {
          const metaEl = row.querySelector(".record-meta");
          if (metaEl) {
            const base = metaEl.dataset.base || metaEl.textContent || "";
            metaEl.textContent = base + (text ? "（已有註記）" : "");
          }
        }

        noteDlg.close();
        currentNoteRecordId = null;
      })
      .catch((err) => {
        console.error("儲存註記失敗：", err);
        alert("儲存註記失敗，請稍後再試。");
      });
  });

  // 確保登入狀態初始 UI
  restoreUserFromLocal();
  updateLoginUI();

  // --- 這行以上 ---
})();

// 小保險：確保在 DOM 準備好後再跑需要抓節點的流程（可留可不留）
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {});
} else {
  // DOM 已就緒
}
