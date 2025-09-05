// === Google Drive (最小：drive.file) ===
const GOOGLE_OAUTH_CLIENT_ID = "735593435771-otisn8depskof8vmvp6sp5sl9n3t5e25.apps.googleusercontent.com"; // ← 換成你的
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
async function driveFilesGet(fileId, token, fields = "id,trashed,webViewLink") {
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`,
    { headers: { Authorization: "Bearer " + token } }
  );
  if (r.status === 404) throw new Error("not_found");
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// 建立資料夾（名稱自訂；可帶 appProperties）
async function driveCreateFolder(name, token, appProps = {}) {
  const meta = {
    name,
    mimeType: "application/vnd.google-apps.folder",
    appProperties: Object.assign({ app: "kjreminder" }, appProps),
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
function buildTaskFolderName(task) {
  const parts = [];
  if (task.section) parts.push(`[${task.section}]`);
  if (task.title) parts.push(task.title);
  if (task.date) parts.push(task.date);
  return parts.filter(Boolean).join(" ");
}

// 核心：開啟或建立（若被刪/丟垃圾桶 → 重建）
async function openOrCreateDriveFolderForTask(task) {
  if (!task) return;
  const token = await getDriveAccessToken();

  if (task.gdriveFolderId) {
    try {
      const meta = await driveFilesGet(task.gdriveFolderId, token, "id,trashed,webViewLink");
      if (!meta.trashed) {
        const link = meta.webViewLink || `https://drive.google.com/drive/folders/${task.gdriveFolderId}`;
        window.open(link, "_blank");
        return;
      }
      // 被丟垃圾桶 → 視為不存在，往下重建
    } catch (e) {
      // 404 / 其他錯誤 → 視為不存在，往下重建
    }
  }

  // ======= 唯一改動：先確保 MyTask 根資料夾，然後把任務資料夾建在裡面 =======
  let myTaskRootId = null;
  try {
    myTaskRootId = localStorage.getItem("gdrive_mytask_root_id") || null;
    if (myTaskRootId) {
      // 驗證是否仍存在且未被丟到垃圾桶
      const rootMeta = await driveFilesGet(myTaskRootId, token, "id,trashed");
      if (!rootMeta || rootMeta.trashed) myTaskRootId = null;
    }
  } catch (_) {
    myTaskRootId = null;
  }

  if (!myTaskRootId) {
    // 建立 MyTask 根資料夾（在使用者的雲端硬碟根目錄下）
    const rootResp = await fetch(
      "https://www.googleapis.com/drive/v3/files?fields=id,webViewLink&supportsAllDrives=true",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "MyTask",
          mimeType: "application/vnd.google-apps.folder",
          parents: ["root"],
          appProperties: { app: "kjreminder", level: "root" },
        }),
      }
    );
    if (!rootResp.ok) throw new Error(await rootResp.text());
    const root = await rootResp.json();
    myTaskRootId = root.id;
    try { localStorage.setItem("gdrive_mytask_root_id", myTaskRootId); } catch (_) {}
  }

  // 第一次或不存在 → 建立「任務資料夾」到 MyTask 下面
  const name = buildTaskFolderName(task);
  const createdResp = await fetch(
    "https://www.googleapis.com/drive/v3/files?fields=id,webViewLink&supportsAllDrives=true",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [myTaskRootId],
        appProperties: { app: "kjreminder", taskId: task.id, level: "task" },
      }),
    }
  );
  if (!createdResp.ok) throw new Error(await createdResp.text());
  const created = await createdResp.json();
  // ======= 唯一改動結束 =======

  task.gdriveFolderId = created.id;
  task.updatedAt = Date.now();
  try { if (typeof saveTasksToFirebase === "function") saveTasksToFirebase(); } catch (_) {}

  // 開啟
  const link = created.webViewLink || `https://drive.google.com/drive/folders/${created.id}`;
  window.open(link, "_blank");
}

// 讓詳情畫面出現一顆 GDrive 按鈕（只在非唯讀時顯示）
function ensureDriveButtonsInlineUI(task) {
  const dateEl = document.getElementById("detailDate");
  const modal = document.getElementById("detailModal");
  if (!dateEl || !modal) return;
  const isReadonly = modal.classList.contains("readonly");

  // 你的 ensureDetailInlineUI 會把 dateEl 包在 .inline-row 裡
  const row = dateEl.closest(".inline-row") || dateEl.parentElement;
  if (!row) return;

  let btn = row.querySelector("#gdriveBtn");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "gdriveBtn";
    btn.type = "button";
    btn.title = "開啟/建立此任務的 Google 雲端硬碟資料夾";
    btn.setAttribute("aria-label", "Google 雲端硬碟");
    btn.style.cssText =
      "width:30px;height:30px;padding:0;border:1px solid #ddd;" +
      "background:#f9f9f9 url('https://cdn.jsdelivr.net/gh/a355226/kj-reminder@main/drive.png')" +
      " no-repeat center/18px 18px;border-radius:6px;cursor:pointer;margin-left:6px;";
    row.appendChild(btn);
  }
  btn.style.display = isReadonly ? "none" : ""; // 完成視圖（唯讀）時隱藏
  btn.onclick = async () => {
    try {
      __gd_userGesture = true; // 你原本的旗標，沿用
      // 詳情面板值可能比 task 物件新，先把表單回寫一次
      try { syncEditsIntoTask?.(task); } catch (_) {}
      await openOrCreateDriveFolderForTask(task);
    } catch (e) {
      alert("Google Drive 動作失敗：" + (e?.message || e));
    } finally {
      __gd_userGesture = false;
    }
  };
}
