(function() {
  // ==================== DATABASE SETUP ====================
  const DB_NAME = "AnyNotesHistoryDB_V2";
  const DB_VERSION = 1;
  const STORE_NAME = "versions";
  const PAGE_SIZE = 10;
  
  let db = null;
  let currentFileId = null;
  let currentFileName = null;
  let currentFileRevision = null;
  let accessToken = null;
  let tokenExpiry = 0;
  let currentUser = null;
  let allFiles = [];
  let isSaving = false;
  let lastContent = "";
  let autoSaveTimer = null;
  let isOffline = false;
  let syncInterval = null;
  let currentZoom = 100;
  const BASE_FONT = 15;
  
  // Local storage for unsigned users
  let localUnsavedContent = "";
  let localUnsavedVersions = [];
  let pendingFileName = null;
  let isAwaitingSignIn = false;
  
  // DOM elements
  const editor = document.getElementById("editor");
  const statusDiv = document.getElementById("status");
  const userBox = document.getElementById("userBox");
  const loginBtn = document.getElementById("loginBtnTop");
  const historyOverlay = document.getElementById("historyOverlay");
  const historyList = document.getElementById("historyList");
  const versionSpan = document.getElementById("versionCount");
  const historyBtn = document.getElementById("historyBtn");
  const closeHistoryBtn = document.getElementById("closeHistoryBtn");
  const globalDropdown = document.getElementById("globalDropdown");
  const logoutBtn = document.getElementById("logoutBtn");
  const saveNewBtn = document.getElementById("saveNewBtn");
  const openBtn = document.getElementById("openBtn");
  const deleteBtn = document.getElementById("deleteBtn");
  const downloadBtn = document.getElementById("downloadBtn");
  const zoomInBtn = document.getElementById("zoomInBtn");
  const zoomOutBtn = document.getElementById("zoomOutBtn");
  const userPic = document.getElementById("userPic");
  const userNameSpan = document.getElementById("userName");
  
  // ==================== RECENT FILES TRACKING ====================
  function updateRecentFiles(fileId) {
    let recentFiles = JSON.parse(localStorage.getItem("recentFiles") || "[]");
    recentFiles = [fileId, ...recentFiles.filter(fid => fid !== fileId)];
    if (recentFiles.length > 20) recentFiles.pop();
    localStorage.setItem("recentFiles", JSON.stringify(recentFiles));
  }
  
  function getRecentFiles() {
    return JSON.parse(localStorage.getItem("recentFiles") || "[]");
  }
  
  // ==================== LOCAL STORAGE FOR UNSIGNED USERS ====================
  function saveLocalContent(content) {
    if (!isValidContent(content)) return;
    localUnsavedContent = content;
    localStorage.setItem("localUnsavedContent", localUnsavedContent);
  }
  
  function saveLocalVersion(content, timestamp) {
    if (!isValidContent(content)) return;
    localUnsavedVersions.unshift({
      id: Date.now(),
      content: content,
      timestamp: timestamp,
      preview: getPreview(content, 100)
    });
    if (localUnsavedVersions.length > 150) localUnsavedVersions.pop();
    localStorage.setItem("localUnsavedVersions", JSON.stringify(localUnsavedVersions));
  }
  
  function loadLocalData() {
    const savedContent = localStorage.getItem("localUnsavedContent");
    if (savedContent && isValidContent(savedContent)) {
      editor.value = savedContent;
      localUnsavedContent = savedContent;
      lastContent = savedContent;
    }
    const savedVersions = localStorage.getItem("localUnsavedVersions");
    if (savedVersions) {
      try {
        localUnsavedVersions = JSON.parse(savedVersions);
      } catch(e) {}
    }
  }
  
  function clearLocalData() {
    localUnsavedContent = "";
    localUnsavedVersions = [];
    localStorage.removeItem("localUnsavedContent");
    localStorage.removeItem("localUnsavedVersions");
  }
  
  // ==================== UTILITIES ====================
  function showStatus(msg, isError = false) {
    statusDiv.textContent = msg;
    statusDiv.style.background = isError ? "rgba(220, 38, 38, 0.9)" : "rgba(0, 0, 0, 0.75)";
    setTimeout(() => {
      if (statusDiv.textContent === msg) {
        if (!accessToken && !isAwaitingSignIn) {
          if (editor.value.trim() && editor.value !== "Start writing your notes...") {
            statusDiv.textContent = "📝 Local draft - Sign in to save to cloud";
          } else {
            statusDiv.textContent = "✨ Ready";
          }
        } else if (!accessToken && isAwaitingSignIn) {
          statusDiv.textContent = "⚠️ Sign in to save your work";
        } else if (isOffline) {
          statusDiv.textContent = "📴 Offline mode - edits will sync when online";
        } else if (currentFileId) {
          statusDiv.textContent = `✅ ${currentFileName?.replace("_AnyNotes.txt", "") || "note"}`;
        } else if (editor.value.trim() && editor.value !== "Start writing your notes...") {
          statusDiv.textContent = "📝 Click Save to secure";
        } else {
          statusDiv.textContent = "✨ Ready";
        }
        statusDiv.style.background = "rgba(0, 0, 0, 0.75)";
      }
    }, 2500);
  }
  
  function isValidContent(content) {
    return content && content.trim().length > 0 && content !== "Start writing your notes...";
  }
  
  function getPreview(content, maxLen = 80) {
    if (!content) return "(empty)";
    let preview = content.replace(/\n/g, ' ').trim();
    if (preview.length === 0) return "(empty)";
    if (preview.length > maxLen) preview = preview.substring(0, maxLen - 3) + "...";
    return preview;
  }
  
  // ==================== INDEXEDDB ====================
  function initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        db = request.result;
        resolve(db);
      };
      request.onupgradeneeded = (event) => {
        const dbRef = event.target.result;
        if (!dbRef.objectStoreNames.contains(STORE_NAME)) {
          const store = dbRef.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
          store.createIndex("fileId", "fileId", { unique: false });
          store.createIndex("timestamp", "timestamp", { unique: false });
        }
      };
    });
  }
  
  async function saveVersion(fileId, content, timestamp) {
    if (!db || !fileId || !isValidContent(content)) return false;
    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      store.add({
        fileId: fileId,
        content: content,
        timestamp: timestamp,
        preview: getPreview(content, 100)
      });
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
    });
  }
  
  async function getVersions(fileId, offset, limit) {
    if (!db || !fileId) return [];
    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index("fileId");
      const range = IDBKeyRange.only(fileId);
      const request = index.openCursor(range, "prev");
      let results = [];
      let skipped = 0;
      let collected = 0;
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && collected < limit) {
          if (skipped < offset) {
            skipped++;
            cursor.continue();
          } else {
            const val = cursor.value;
            if (isValidContent(val.content)) {
              if (!val.preview || val.preview === "") {
                val.preview = getPreview(val.content, 100);
              }
              results.push(val);
              collected++;
            }
            cursor.continue();
          }
        } else {
          resolve(results);
        }
      };
      request.onerror = () => resolve([]);
    });
  }
  
  async function getVersionCount(fileId) {
    if (!db || !fileId) return 0;
    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index("fileId");
      const request = index.count(fileId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(0);
    });
  }
  
  // ==================== GOOGLE DRIVE API ====================
  async function refreshToken() {
    return new Promise((resolve) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: "306125547800-cckr01g764von4q13sfese5if8o1de41.apps.googleusercontent.com",
        scope: "https://www.googleapis.com/auth/drive.file",
        callback: (resp) => resolve(resp.access_token)
      });
      client.requestAccessToken();
    });
  }
  
  async function ensureToken() {
    if (!accessToken) return false;
    if (Date.now() >= tokenExpiry - 60000) {
      const newToken = await refreshToken();
      if (newToken) {
        accessToken = newToken;
        tokenExpiry = Date.now() + 3600000;
        localStorage.setItem("drive_token", accessToken);
        localStorage.setItem("drive_token_expiry", tokenExpiry.toString());
        return true;
      }
      return false;
    }
    return true;
  }
  
  async function driveFetch(url, options = {}) {
    if (!accessToken) throw new Error("No token");
    await ensureToken();
    const opts = {
      ...options,
      headers: {
        ...(options.headers || {}),
        "Authorization": "Bearer " + accessToken
      }
    };
    try {
      const res = await fetch(url, opts);
      if (res.status === 401) {
        const newToken = await refreshToken();
        if (newToken) {
          accessToken = newToken;
          tokenExpiry = Date.now() + 3600000;
          opts.headers.Authorization = "Bearer " + accessToken;
          return fetch(url, opts);
        }
      }
      return res;
    } catch (e) {
      isOffline = true;
      throw e;
    }
  }
  
  async function loadUserFiles() {
    if (!accessToken) return [];
    try {
      const q = encodeURIComponent("name contains '_AnyNotes.txt' and trashed=false");
      const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
      const data = await res.json();
      allFiles = data.files || [];
      return allFiles;
    } catch (e) {
      allFiles = [];
      return [];
    }
  }
  
  async function getFileContent(fileId) {
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    return await res.text();
  }
  
  async function updateFileContent(fileId, content) {
    await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": "text/plain" },
      body: content
    });
    const revRes = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=revision`);
    const revData = await revRes.json();
    return revData.revision;
  }
  
  async function createFile(name, content) {
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify({ name: name + "_AnyNotes.txt" })], { type: "application/json" }));
    form.append("file", new Blob([content || ""], { type: "text/plain" }));
    const res = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
      method: "POST",
      body: form
    });
    const data = await res.json();
    return data.id;
  }
  
  async function deleteFileReq(fileId) {
    await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, { method: "DELETE" });
  }
  
  async function saveCurrentState() {
    if (!currentFileId) return;
    localStorage.setItem("lastFileId", currentFileId);
    updateRecentFiles(currentFileId);
    try {
      const q = encodeURIComponent("name='AnyNotes_LastState.json' and trashed=false");
      const search = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`);
      const data = await search.json();
      const form = new FormData();
      form.append("metadata", new Blob([JSON.stringify({ name: "AnyNotes_LastState.json" })], { type: "application/json" }));
      form.append("file", new Blob([JSON.stringify({ lastFileId: currentFileId })], { type: "application/json" }));
      
      if (data.files && data.files.length) {
        await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${data.files[0].id}?uploadType=media`, {
          method: "PATCH",
          body: form
        });
      } else {
        await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
          method: "POST",
          body: form
        });
      }
    } catch (e) {}
  }
  
  async function loadLastState() {
    await loadUserFiles();
    const savedId = localStorage.getItem("lastFileId");
    if (savedId && allFiles.find(f => f.id === savedId)) {
      await openFile(savedId);
      return;
    }
    const recentFiles = getRecentFiles();
    for (const recentId of recentFiles) {
      if (allFiles.find(f => f.id === recentId)) {
        await openFile(recentId);
        return;
      }
    }
    if (allFiles.length > 0) {
      await openFile(allFiles[0].id);
      return;
    }
    const backup = localStorage.getItem("localNote_backup");
    if (backup && isValidContent(backup)) {
      editor.value = backup;
      lastContent = backup;
    }
    loadLocalData();
  }
  
  // ==================== TRANSFER LOCAL DATA TO CLOUD ====================
  async function transferLocalDataToCloud(fileName) {
    if (!accessToken) return false;
    const cleanName = fileName.replace(/[<>:"/\\|?*]/g, '');
    if (!cleanName) return false;
    
    const fullFileName = cleanName + "_AnyNotes.txt";
    const contentToSave = localUnsavedContent || editor.value;
    
    try {
      const newId = await createFile(cleanName, contentToSave);
      currentFileId = newId;
      currentFileName = fullFileName;
      lastContent = contentToSave;
      
      for (const version of localUnsavedVersions) {
        await saveVersion(currentFileId, version.content, version.timestamp);
      }
      await saveVersion(currentFileId, contentToSave, Date.now());
      await saveCurrentState();
      
      clearLocalData();
      updateRecentFiles(currentFileId);
      showStatus(`✅ File "${cleanName}" saved to cloud`);
      return true;
    } catch (e) {
      showStatus("❌ Failed to save to cloud", true);
      return false;
    }
  }
  
  // ==================== FILE OPERATIONS ====================
async function openFile(fileId) { 
  try { 
    const content = await getFileContent(fileId);
    editor.value = content;
    lastContent = content;
    currentFileId = fileId;
    const metaRes = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,revision`);
    const meta = await metaRes.json();
    currentFileName = meta.name;
    currentFileRevision = meta.revision;
    localStorage.setItem("lastFileId", fileId);
    updateRecentFiles(fileId);
    await saveCurrentState();
    let name = currentFileName ? currentFileName.replace("_AnyNotes.txt", "") : "";
    showStatus(name ? `✅ Opened file successfully: ${name}` : "✅ Opened file successfully");
  } catch (e) { 
    showStatus("❌ Failed to open file", true);
  } 
}
  
  async function saveFile(isNew = false) {
    if (!accessToken) {
      alert("Please sign in first");
      return false;
    }
    
    let name = prompt("File name:", currentFileName?.replace("_AnyNotes.txt", "") || "MyNote");
    if (!name) return false;
    
    const cleanName = name.replace(/[<>:"/\\|?*]/g, '');
    const fullName = cleanName + "_AnyNotes.txt";
    const existing = allFiles.find(f => f.name === fullName);
    
    try {
      if (existing && !isNew) {
        currentFileRevision = await updateFileContent(existing.id, editor.value);
        currentFileId = existing.id;
        currentFileName = existing.name;
        lastContent = editor.value;
        await saveVersion(currentFileId, editor.value, Date.now());
        showStatus("✅ Saved");
      } else {
        const newId = await createFile(cleanName, editor.value);
        currentFileId = newId;
        currentFileName = fullName;
        lastContent = editor.value;
        await saveVersion(currentFileId, editor.value, Date.now());
        showStatus("✅ Created");
      }
      await saveCurrentState();
      await loadUserFiles();
      updateRecentFiles(currentFileId);
      return true;
    } catch (e) {
      if (e.message.includes("Network")) {
        showStatus("📴 Offline: Will sync when online", false);
        return true;
      }
      showStatus("❌ Save failed", true);
      return false;
    }
  }
  
  async function handleSave() {
    if (!accessToken) {
      alert("Sign in required");
      return;
    }
    await saveFile(false);
  }
  
  async function handleNew() {
    if (!accessToken) {
      alert("Sign in required");
      return;
    }
    await saveFile(true);
  }
  
  async function handleOpen() {
    if (!accessToken) {
      alert("Sign in required");
      return;
    }
    await loadUserFiles();
    if (allFiles.length === 0) {
      alert("No notes found. Create one first.");
      return;
    }
    let list = allFiles.map((f, i) => `${i+1}. ${f.name.replace("_AnyNotes.txt", "")}`);
    let input = prompt("Your notes:\n\n" + list.join("\n") + "\n\nEnter number:");
    let idx = parseInt(input) - 1;
    if (idx >= 0 && idx < allFiles.length) {
      await openFile(allFiles[idx].id);
    }
  }
  
  async function handleDelete() {
    if (!accessToken) {
      alert("Sign in required to delete files");
      return;
    }
    await loadUserFiles();
    if (allFiles.length === 0) {
      alert("No notes to delete");
      return;
    }
    let list = allFiles.map((f, i) => `${i+1}. ${f.name.replace("_AnyNotes.txt", "")}`);
    let input = prompt("Select note to delete:\n\n" + list.join("\n") + "\n\nEnter number:");
    let idx = parseInt(input) - 1;
    if (idx >= 0 && idx < allFiles.length) {
      if (confirm(`Delete "${allFiles[idx].name.replace("_AnyNotes.txt", "")}"?`)) {
        const deletedFileId = allFiles[idx].id;
        const wasCurrentFile = (currentFileId === deletedFileId);
        
        await deleteFileReq(deletedFileId);
        showStatus("🗑️ Deleted");
        await loadUserFiles();
        
        if (wasCurrentFile && allFiles.length > 0) {
          const recentFiles = getRecentFiles();
          let nextFileId = null;
          for (const recentId of recentFiles) {
            if (allFiles.find(f => f.id === recentId) && recentId !== deletedFileId) {
              nextFileId = recentId;
              break;
            }
          }
          if (!nextFileId && allFiles.length > 0) {
            nextFileId = allFiles[0].id;
          }
          if (nextFileId) {
            await openFile(nextFileId);
          } else {
            editor.value = "";
            currentFileId = null;
            currentFileName = null;
            lastContent = "";
            localStorage.removeItem("lastFileId");
          }
        } else if (wasCurrentFile) {
          editor.value = "";
          currentFileId = null;
          currentFileName = null;
          lastContent = "";
          localStorage.removeItem("lastFileId");
        }
      }
    }
  }
  
  function handleDownload() {
    const blob = new Blob([editor.value], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `AnyNotes_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    showStatus("⬇️ Downloaded");
  }
  
  // ==================== AUTO SAVE ====================
  async function autoSave() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(async () => {
      const currentContent = editor.value;
      if (!isValidContent(currentContent)) return;
      
      if (!accessToken) {
        saveLocalContent(currentContent);
        saveLocalVersion(currentContent, Date.now());
        lastContent = currentContent;
        showStatus("📝 Draft saved locally", false);
      } else if (accessToken && currentFileId && !isSaving && editor.value !== lastContent) {
        isSaving = true;
        try {
          if (!isOffline) {
            currentFileRevision = await updateFileContent(currentFileId, editor.value);
            await saveVersion(currentFileId, editor.value, Date.now());
            lastContent = editor.value;
            showStatus("💾 Auto-saved");
          }
        } catch (e) {
          if (e.message.includes("Network")) {
            showStatus("📴 Offline - saved locally", false);
            lastContent = editor.value;
          }
        } finally {
          isSaving = false;
        }
      } else if (accessToken && !currentFileId) {
        saveLocalContent(currentContent);
        saveLocalVersion(currentContent, Date.now());
        lastContent = currentContent;
      }
    }, 3000);
  }
  
  // ==================== VERSION HISTORY UI ====================
  let versionOffset = 0;
  let versionTotal = 0;
  
  async function renderHistory(reset = true) {
    if (!historyList) return;
    
    if (!accessToken) {
      if (localUnsavedVersions.length > 0) {
        if (versionSpan) versionSpan.textContent = `(${localUnsavedVersions.length} local drafts)`;
        if (reset) historyList.innerHTML = "";
        const start = reset ? 0 : versionOffset;
        const versionsToShow = localUnsavedVersions.slice(start, start + PAGE_SIZE);
        for (const v of versionsToShow) {
          const date = new Date(v.timestamp);
          const div = document.createElement("div");
          div.className = "history-item";
          div.innerHTML = `
            <div class="history-timestamp">📅 ${date.toLocaleString()} (Local Draft)</div>
            <div class="history-preview">${escapeHtml(v.preview)}</div>
            <button class="restore-btn" data-content="${escapeAttr(v.content)}">↻ Restore</button>
          `;
          div.querySelector(".restore-btn").addEventListener("click", async (e) => {
            e.stopPropagation();
            const content = e.target.getAttribute("data-content");
            if (content && confirm("Restore this local version?")) {
              editor.value = content;
              lastContent = content;
              saveLocalContent(content);
              showStatus("🕒 Local version restored");
              if (historyOverlay) historyOverlay.classList.remove("show");
            }
          });
          historyList.appendChild(div);
        }
        if (start + PAGE_SIZE < localUnsavedVersions.length) {
          const loadMore = document.createElement("div");
          loadMore.className = "load-more-btn";
          loadMore.textContent = "📜 Load more...";
          loadMore.onclick = async () => {
            versionOffset += PAGE_SIZE;
            await renderHistory(false);
          };
          historyList.appendChild(loadMore);
        }
      } else {
        historyList.innerHTML = '<div class="history-empty">Sign in to save versions to cloud, or type to save locally</div>';
        if (versionSpan) versionSpan.textContent = "";
      }
      return;
    }
    
    if (!currentFileId) {
      historyList.innerHTML = '<div class="history-empty">Open or save a note to see version history</div>';
      if (versionSpan) versionSpan.textContent = "";
      return;
    }
    
    if (reset) versionOffset = 0;
    versionTotal = await getVersionCount(currentFileId);
    const versions = await getVersions(currentFileId, versionOffset, PAGE_SIZE);
    
    if (versionSpan) versionSpan.textContent = `(${versionTotal})`;
    if (reset) historyList.innerHTML = "";
    
    if (versions.length === 0 && versionOffset === 0) {
      historyList.innerHTML = '<div class="history-empty">No versions yet. Keep typing to save versions.</div>';
      return;
    }
    
    for (const v of versions) {
      const date = new Date(v.timestamp);
      const previewText = v.preview || getPreview(v.content, 100);
      const div = document.createElement("div");
      div.className = "history-item";
      div.innerHTML = `
        <div class="history-timestamp">📅 ${date.toLocaleString()}</div>
        <div class="history-preview">${escapeHtml(previewText)}</div>
        <button class="restore-btn" data-content="${escapeAttr(v.content)}">↻ Restore</button>
      `;
      div.querySelector(".restore-btn").addEventListener("click", async (e) => {
        e.stopPropagation();
        const content = e.target.getAttribute("data-content");
        if (content && confirm("Restore this version?")) {
          editor.value = content;
          lastContent = content;
          if (accessToken && currentFileId && !isOffline) {
            await updateFileContent(currentFileId, content);
            await saveVersion(currentFileId, content, Date.now());
          }
          showStatus("🕒 Restored");
          if (historyOverlay) historyOverlay.classList.remove("show");
        }
      });
      historyList.appendChild(div);
    }
    
    if (versionOffset + PAGE_SIZE < versionTotal) {
      const loadMore = document.createElement("div");
      loadMore.className = "load-more-btn";
      loadMore.textContent = "📜 Load more...";
      loadMore.onclick = async () => {
        versionOffset += PAGE_SIZE;
        await renderHistory(false);
      };
      historyList.appendChild(loadMore);
    }
  }
  
  function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
  }
  
  function escapeAttr(str) {
    if (!str) return "";
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  
  // ==================== ZOOM ====================
  function zoomIn() {
    if (currentZoom < 200) {
      currentZoom += 10;
      editor.style.fontSize = (BASE_FONT * currentZoom / 100) + "px";
      showStatus(`Zoom: ${currentZoom}%`);
    }
  }
  
  function zoomOut() {
    if (currentZoom > 100) {
      currentZoom -= 10;
      editor.style.fontSize = (BASE_FONT * currentZoom / 100) + "px";
      showStatus(`Zoom: ${currentZoom}%`);
    }
  }
  
  // ==================== LOGIN / LOGOUT ====================
  function updateLoginUI() {
    if (accessToken && currentUser) {
      userBox.style.display = "flex";
      loginBtn.style.display = "none";
      if (userPic) {
        userPic.src = currentUser.picture;
        userPic.style.display = "block";
      }
      if (userNameSpan) userNameSpan.textContent = currentUser.name || "User";
    } else {
      userBox.style.display = "none";
      loginBtn.style.display = "block";
    }
  }
  
  async function handleLogin() {
    const hasLocalContent = isValidContent(editor.value) || localUnsavedVersions.length > 0;
    
    if (hasLocalContent) {
      pendingFileName = prompt("You have unsaved notes. Enter a file name to save them:", "MyNotes");
      if (!pendingFileName) {
        showStatus("Sign in cancelled", true);
        return;
      }
      isAwaitingSignIn = true;
      showStatus("⚠️ Signing in...");
    } else {
      pendingFileName = null;
    }
    
    const token = await refreshToken();
    if (token) {
      accessToken = token;
      tokenExpiry = Date.now() + 3600000;
      localStorage.setItem("drive_token", accessToken);
      localStorage.setItem("drive_token_expiry", tokenExpiry.toString());
      
      const userRes = await driveFetch("https://www.googleapis.com/oauth2/v3/userinfo");
      const userData = await userRes.json();
      currentUser = {
        name: userData.name.split(" ")[0],
        picture: userData.picture
      };
      localStorage.setItem("user", JSON.stringify(currentUser));
      updateLoginUI();
      
      if (pendingFileName) {
        await transferLocalDataToCloud(pendingFileName);
        pendingFileName = null;
      }
      
      await loadUserFiles();
      await loadLastState();
      isAwaitingSignIn = false;
      
      if (syncInterval) clearInterval(syncInterval);
      syncInterval = setInterval(async () => {
        if (accessToken && currentFileId && !isSaving && !isOffline) {
          try {
            const revRes = await driveFetch(`https://www.googleapis.com/drive/v3/files/${currentFileId}?fields=revision`);
            const revData = await revRes.json();
            if (revData.revision !== currentFileRevision) {
              const newContent = await getFileContent(currentFileId);
              if (newContent !== editor.value && isValidContent(newContent)) {
                editor.value = newContent;
                lastContent = newContent;
                currentFileRevision = revData.revision;
                showStatus("🔄 Synced from cloud");
              }
            }
          } catch (e) {}
        }
      }, 5000);
      
      showStatus("✅ Signed in");
    }
  }
  
  function logout() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    if (syncInterval) clearInterval(syncInterval);
    localStorage.clear();
    location.reload();
  }
  
  // ==================== EVENT LISTENERS ====================
  if (saveNewBtn) {
    saveNewBtn.addEventListener("click", () => {
      if (!accessToken) alert("Sign in first");
      else if (allFiles.length > 0) handleNew();
      else handleSave();
    });
  }
  if (openBtn) openBtn.addEventListener("click", handleOpen);
  if (deleteBtn) deleteBtn.addEventListener("click", handleDelete);
  if (downloadBtn) downloadBtn.addEventListener("click", handleDownload);
  if (zoomInBtn) zoomInBtn.addEventListener("click", zoomIn);
  if (zoomOutBtn) zoomOutBtn.addEventListener("click", zoomOut);
  if (loginBtn) loginBtn.addEventListener("click", handleLogin);
  if (logoutBtn) logoutBtn.addEventListener("click", logout);
  
  if (historyBtn) {
    historyBtn.addEventListener("click", async () => {
      await renderHistory(true);
      if (historyOverlay) historyOverlay.classList.add("show");
    });
  }
  if (closeHistoryBtn) {
    closeHistoryBtn.addEventListener("click", () => {
      if (historyOverlay) historyOverlay.classList.remove("show");
    });
  }
  if (historyOverlay) {
    historyOverlay.addEventListener("click", (e) => {
      if (e.target === historyOverlay) historyOverlay.classList.remove("show");
    });
  }
  
  if (userBox) {
    userBox.addEventListener("click", (e) => {
      e.stopPropagation();
      if (globalDropdown) {
        const rect = userBox.getBoundingClientRect();
        globalDropdown.style.top = (rect.bottom + 5) + "px";
        globalDropdown.style.right = (window.innerWidth - rect.right) + "px";
        globalDropdown.style.left = "auto";
        globalDropdown.classList.toggle("show");
      }
    });
  }
  
  document.addEventListener("click", () => {
    if (globalDropdown) globalDropdown.classList.remove("show");
  });
  
  if (editor) {
    editor.addEventListener("input", async () => {
      localStorage.setItem("localNote_backup", editor.value);
      if (!accessToken) {
        saveLocalContent(editor.value);
      }
      await autoSave();
    });
  }
  
  window.addEventListener("online", async () => {
    isOffline = false;
    showStatus("🌐 Back online");
    if (currentFileId && editor.value !== lastContent && isValidContent(editor.value)) {
      try {
        await updateFileContent(currentFileId, editor.value);
        await saveVersion(currentFileId, editor.value, Date.now());
        lastContent = editor.value;
        showStatus("🔄 Synced");
      } catch (e) {}
    } else if (!accessToken && isValidContent(editor.value)) {
      saveLocalContent(editor.value);
      showStatus("📝 Local draft saved");
    }
  });
  
  window.addEventListener("offline", () => {
    isOffline = true;
    showStatus("📴 Offline mode - edits saved locally");
    if (!accessToken && isValidContent(editor.value)) {
      saveLocalContent(editor.value);
      saveLocalVersion(editor.value, Date.now());
    }
  });
  
  // ==================== INITIALIZATION ====================
  (async function init() {
    await initDB();
    loadLocalData();
    
    const savedToken = localStorage.getItem("drive_token");
    const savedExpiry = localStorage.getItem("drive_token_expiry");
    if (savedToken && savedExpiry && Date.now() < parseInt(savedExpiry)) {
      accessToken = savedToken;
      tokenExpiry = parseInt(savedExpiry);
      const savedUser = localStorage.getItem("user");
      if (savedUser) {
        currentUser = JSON.parse(savedUser);
        updateLoginUI();
        await loadUserFiles();
        await loadLastState();
      }
    }
    
    const backup = localStorage.getItem("localNote_backup");
    if (backup && isValidContent(backup) && (!editor.value || editor.value === "")) {
      editor.value = backup;
      lastContent = backup;
    }
    
    updateLoginUI();
    showStatus("✨ Ready");
    
    google.accounts.id.initialize({
      client_id: "306125547800-cckr01g764von4q13sfese5if8o1de41.apps.googleusercontent.com",
      callback: () => {}
    });
    google.accounts.id.prompt();
  })();
})();
