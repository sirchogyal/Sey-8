 const DB_NAME = "AnyNotesHistoryDB";
  const DB_VERSION = 4; // Increased version for offline edits store
  const STORE_NAME = "version_snapshots";
  const OFFLINE_STORE_NAME = "offline_edits";
  const PAGE_SIZE = 5;
  const DEBOUNCE_DELAY_MS = 3000; // 3 seconds pause before saving snapshot
  
  let db = null;
  let versionDebounceTimer = null;
  let lastSnapshotContent = ""; // Avoid duplicate snapshot if content unchanged
  
  // IndexedDB setup with offline edits store
  function openIndexedDB() {
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
          store.createIndex("fileId_timestamp", ["fileId", "timestamp"], { unique: false });
        }
        // Create offline edits store for pending sync operations
        if (!dbRef.objectStoreNames.contains(OFFLINE_STORE_NAME)) {
          const offlineStore = dbRef.createObjectStore(OFFLINE_STORE_NAME, { keyPath: "id", autoIncrement: true });
          offlineStore.createIndex("fileId", "fileId", { unique: false });
          offlineStore.createIndex("timestamp", "timestamp", { unique: false });
          offlineStore.createIndex("synced", "synced", { unique: false });
        }
      };
    });
  }
  
  // Save snapshot only after debounce (called when user stops typing)
  async function saveDebouncedSnapshot(fileId, content, timestamp, driveRevisionId = null) {
    if (!db) await openIndexedDB();
    if (!fileId) return;
    
    // Skip if content didn't change since last snapshot
    if (content === lastSnapshotContent && lastSnapshotContent !== "") return;
    
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const snapshot = {
      fileId: fileId,
      content: content,
      timestamp: timestamp,
      driveRevisionId: driveRevisionId,
      preview: content.substring(0, 120).replace(/\n/g, ' ')
    };
    store.add(snapshot);
    transaction.oncomplete = () => {
      lastSnapshotContent = content;
      // Keep only latest 150 snapshots per file to save space
      pruneOldSnapshots(fileId, 150);
    };
  }
  
  async function pruneOldSnapshots(fileId, keepCount = 150) {
    const total = await getSnapshotCount(fileId);
    if (total <= keepCount) return;
    const toDelete = total - keepCount;
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index("fileId_timestamp");
    const range = IDBKeyRange.bound([fileId, 0], [fileId, Date.now()]);
    const request = index.openCursor(range, "next");
    let deleted = 0;
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor && deleted < toDelete) {
        store.delete(cursor.primaryKey);
        deleted++;
        cursor.continue();
      }
    };
  }
  
  async function getSnapshotCount(fileId) {
    if (!db) await openIndexedDB();
    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index("fileId");
      const countRequest = index.count(fileId);
      countRequest.onsuccess = () => resolve(countRequest.result);
      countRequest.onerror = () => resolve(0);
    });
  }
  
  async function getSnapshotsPaginated(fileId, offset, limit) {
    if (!db) await openIndexedDB();
    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index("fileId_timestamp");
      const range = IDBKeyRange.bound([fileId, 0], [fileId, Date.now()]);
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
            results.push(cursor.value);
            collected++;
            cursor.continue();
          }
        } else {
          resolve(results);
        }
      };
      request.onerror = () => resolve([]);
    });
  }
  
  // ==================== OFFLINE EDITS MANAGEMENT ====================
  async function saveOfflineEdit(fileId, content, timestamp, driveRevisionId = null) {
    if (!db) await openIndexedDB();
    const transaction = db.transaction([OFFLINE_STORE_NAME], "readwrite");
    const store = transaction.objectStore(OFFLINE_STORE_NAME);
    const edit = {
      fileId: fileId,
      content: content,
      timestamp: timestamp,
      driveRevisionId: driveRevisionId,
      synced: false,
      preview: content.substring(0, 120).replace(/\n/g, ' ')
    };
    return new Promise((resolve, reject) => {
      const request = store.add(edit);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  
  async function getPendingOfflineEdits(fileId) {
    if (!db) await openIndexedDB();
    return new Promise((resolve) => {
      const transaction = db.transaction([OFFLINE_STORE_NAME], "readonly");
      const store = transaction.objectStore(OFFLINE_STORE_NAME);
      const index = store.index("fileId");
      const range = IDBKeyRange.only(fileId);
      const request = index.openCursor(range);
      let edits = [];
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          if (!cursor.value.synced) {
            edits.push(cursor.value);
          }
          cursor.continue();
        } else {
          // Sort by timestamp
          edits.sort((a, b) => a.timestamp - b.timestamp);
          resolve(edits);
        }
      };
      request.onerror = () => resolve([]);
    });
  }
  
  async function markOfflineEditSynced(editId) {
    if (!db) await openIndexedDB();
    const transaction = db.transaction([OFFLINE_STORE_NAME], "readwrite");
    const store = transaction.objectStore(OFFLINE_STORE_NAME);
    return new Promise((resolve, reject) => {
      const getRequest = store.get(editId);
      getRequest.onsuccess = () => {
        const edit = getRequest.result;
        if (edit) {
          edit.synced = true;
          const putRequest = store.put(edit);
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          resolve();
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }
  
  async function clearSyncedOfflineEdits(fileId) {
    if (!db) await openIndexedDB();
    const transaction = db.transaction([OFFLINE_STORE_NAME], "readwrite");
    const store = transaction.objectStore(OFFLINE_STORE_NAME);
    const index = store.index("fileId");
    const range = IDBKeyRange.only(fileId);
    const request = index.openCursor(range);
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        if (cursor.value.synced) {
          store.delete(cursor.primaryKey);
        }
        cursor.continue();
      }
    };
  }
  
  // Upload offline edit as a version snapshot (preserve in history but don't overwrite current)
  async function uploadOfflineEditAsSnapshot(fileId, content, timestamp, originalRevisionId) {
    try {
      // Save as a version snapshot in IndexedDB
      await saveDebouncedSnapshot(fileId, content, timestamp, originalRevisionId);
      
      // Also try to save to Google Drive as a separate version file if possible
      if (accessToken) {
        try {
          const snapshotFileName = `_version_${timestamp}_${fileId}.txt`;
          const form = new FormData();
          form.append("metadata", new Blob([JSON.stringify({ 
            name: snapshotFileName,
            parents: [] // Save in root
          })], { type: "application/json" }));
          form.append("file", new Blob([content], { type: "text/plain" }));
          await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
            method: "POST",
            body: form
          });
        } catch(e) {
          console.log("Could not save snapshot to Drive:", e);
        }
      }
      
      return true;
    } catch(e) {
      console.error("Failed to save offline edit as snapshot:", e);
      return false;
    }
  }
  
  // ========== PLAIN-TEXT PASTE HANDLER ==========
  function setupPlainTextPaste() {
    editor.addEventListener("paste", (e) => {
      e.preventDefault();
      // Get plain text from clipboard
      const text = (e.clipboardData || window.clipboardData).getData("text/plain");
      // Insert plain text at cursor position
      const selection = window.getSelection();
      if (!selection.rangeCount) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const textNode = document.createTextNode(text);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.setEndAfter(textNode);
      selection.removeAllRanges();
      selection.addRange(range);
      // Trigger input event for auto-save & sync
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  
  // ========== REAL-TIME SYNC + AUTH (preserved) ==========
  const EMOJI = { warning: "⚠️", check: "✅", pencil: "📝", folder: "📂", floppy: "💾", trash: "🗑️", download: "⬇️", door: "🚪", ready: "✨", sync: "🔄", offline: "📴" };
  
  const editor = document.getElementById("editor");
  const statusDiv = document.getElementById("status");
  const userBox = document.getElementById("userBox");
  const loginBtnTop = document.getElementById("loginBtnTop");
  const dropdownMenu = document.getElementById("dropdownMenu");
  const profileSection = document.getElementById("profileSection");
  
  let accessToken = null, tokenExpiryTime = 0, refreshPromise = null, currentUser = null;
  let currentFileId = null, currentFileName = null, currentFileRevision = null;
  let allAppFiles = [], autoSaveTimer = null, isSaving = false, lastSavedContent = "";
  let isApplyingRemoteUpdate = false, syncPollingInterval = null, broadcastChannel = null;
  let lastBroadcastContent = "";
  let isOffline = false;
  
  // Zoom
  let currentZoom = 100;
  const DEFAULT_FONT_SIZE = 15;
  function zoomIn() { if (currentZoom < 200) { currentZoom += 10; editor.style.fontSize = (DEFAULT_FONT_SIZE * currentZoom / 100) + "px"; showTemporaryStatus("Zoom: " + currentZoom + "%"); } }
  function zoomOut() { if (currentZoom > 100) { currentZoom -= 10; editor.style.fontSize = (DEFAULT_FONT_SIZE * currentZoom / 100) + "px"; showTemporaryStatus("Zoom: " + currentZoom + "%"); } else showTemporaryStatus("Default"); }
  document.getElementById("zoomInBtn")?.addEventListener("click", zoomIn);
  document.getElementById("zoomOutBtn")?.addEventListener("click", zoomOut);
  
let statusTimeout = null;

function showTemporaryStatus(msg, isError = false) {
  if (statusTimeout) clearTimeout(statusTimeout);

  statusDiv.innerHTML = msg;

  // reset to normal first
  statusDiv.classList.remove("error");

  // apply error style only if needed
  if (isError) {
    statusDiv.classList.add("error");
  }

  statusTimeout = setTimeout(() => updatePermanentStatus(), 2800);
}


  function updatePermanentStatus() {
    if (statusTimeout) clearTimeout(statusTimeout);
    if (!accessToken) statusDiv.innerHTML = EMOJI.warning + " Not signed in";
    else if (isOffline) statusDiv.innerHTML = EMOJI.offline + " Offline mode - edits will sync when online";
    else if (currentFileId) statusDiv.innerHTML = EMOJI.check + " " + (currentFileName?.replace("_AnyNotes.txt","") || "note");
    else if (editor.innerText.trim() && editor.innerText !== "Start writing your notes...") statusDiv.innerHTML = EMOJI.pencil + " Click Save to secure";
    else statusDiv.innerHTML = EMOJI.ready + " Ready";
  }
  
  // Token & Auth (simplified but robust)
  async function refreshAccessTokenSilently() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        const p = new Promise((res,rej)=>{ const c=google.accounts.oauth2.initTokenClient({client_id:"306125547800-cckr01g764von4q13sfese5if8o1de41.apps.googleusercontent.com",scope:"https://www.googleapis.com/auth/drive.file",prompt:"",callback:r=>r.access_token?res(r.access_token):rej()}); c.requestAccessToken(); });
        const nt = await p;
        accessToken = nt;
        tokenExpiryTime = Date.now() + 3600000;
        localStorage.setItem("drive_token", accessToken);
        localStorage.setItem("drive_token_expiry", tokenExpiryTime.toString());
        // After refreshing token, try to sync pending offline edits
        if (currentFileId) {
          await syncPendingOfflineEdits(currentFileId);
        }
        return true;
      } catch(e) { return false; }
      finally { refreshPromise = null; }
    })();
    return refreshPromise;
  }
  async function ensureValidToken() { if(!accessToken) return false; if(Date.now()>=tokenExpiryTime-60000){ const r=await refreshAccessTokenSilently(); if(!r){ logoutAndClearAuth("Session expired"); return false; } } return true; }
  async function driveFetch(url, options={}, retry=true){ 
    if(!accessToken) throw new Error("No token"); 
    await ensureValidToken(); 
    let opts={...options, headers:{...(options.headers||{}), Authorization:"Bearer "+accessToken}}; 
    let res;
    try {
      res=await fetch(url,opts);
    } catch(e) {
      // Network error - go offline
      isOffline = true;
      updatePermanentStatus();
      throw new Error("Network error - offline mode");
    }
    if(res.status===401 && retry){ 
      const r=await refreshAccessTokenSilently(); 
      if(r&&accessToken){ 
        opts.headers.Authorization="Bearer "+accessToken; 
        res=await fetch(url,opts); 
        if(res.status===401){ 
          logoutAndClearAuth("Auth expired"); 
          throw new Error("401"); 
        } 
        return res; 
      } else { 
        logoutAndClearAuth("Session expired"); 
        throw new Error("Refresh failed"); 
      } 
    }
    // If successful, we're online
    if (res && res.ok && isOffline) {
      isOffline = false;
      updatePermanentStatus();
      // Sync pending edits when back online
      if (currentFileId) {
        setTimeout(() => syncPendingOfflineEdits(currentFileId), 1000);
      }
    }
    return res; 
  }
  function logoutAndClearAuth(msg){ if(msg)showTemporaryStatus(msg,true); if(syncPollingInterval)clearInterval(syncPollingInterval); if(broadcastChannel)broadcastChannel.close(); accessToken=null; tokenExpiryTime=0; currentUser=null; localStorage.removeItem("drive_token"); localStorage.removeItem("drive_token_expiry"); localStorage.removeItem("user"); currentFileId=null; currentFileName=null; updateUIBasedOnLoginState(); updatePermanentStatus(); updateSaveNewButtonState(); }
  function updateUIBasedOnLoginState(){ if(accessToken&&currentUser){ userBox.style.display="flex"; loginBtnTop.style.display="none"; document.getElementById("userPic").src=currentUser.picture; document.getElementById("userPic").style.display="block"; document.getElementById("userName").innerText=currentUser.name||"User"; } else if(accessToken&&!currentUser){ userBox.style.display="flex"; loginBtnTop.style.display="none"; document.getElementById("userName").innerText="Loading..."; } else { userBox.style.display="none"; loginBtnTop.style.display="block"; } }
  async function fetchUserProfile(){ if(!accessToken)return null; const res=await driveFetch("https://www.googleapis.com/oauth2/v3/userinfo",{},false); if(!res.ok)return null; const u=await res.json(); currentUser={name:u.name.split(" ")[0],picture:u.picture}; localStorage.setItem("user",JSON.stringify(currentUser)); updateUIBasedOnLoginState(); return currentUser; }
  function handleLoginClick(){ const hasLocalUnsaved=(editor.innerText.trim()&&editor.innerText!=="Start writing your notes..."&&!currentFileId); if(hasLocalUnsaved&&!confirm("Current unsaved data will be cleared. Continue?")) return; const tc=google.accounts.oauth2.initTokenClient({client_id:"306125547800-cckr01g764von4q13sfese5if8o1de41.apps.googleusercontent.com",scope:"https://www.googleapis.com/auth/drive.file",callback:async(resp)=>{ if(!resp.access_token){showTemporaryStatus("Login failed",true);return;} accessToken=resp.access_token; tokenExpiryTime=Date.now()+3600000; localStorage.setItem("drive_token",accessToken); localStorage.setItem("drive_token_expiry",tokenExpiryTime.toString()); await fetchUserProfile(); updateUIBasedOnLoginState(); await loadAllAppFiles(); await loadGlobalState(); startRealTimeSync(); updatePermanentStatus(); updateSaveNewButtonState(); showTemporaryStatus("Signed in"); }}); tc.requestAccessToken(); }
  
  // Sync pending offline edits when coming back online
  async function syncPendingOfflineEdits(fileId) {
    if (!accessToken || !fileId) return;
    
    try {
      const pendingEdits = await getPendingOfflineEdits(fileId);
      if (pendingEdits.length === 0) return;
      
      showTemporaryStatus(`Syncing ${pendingEdits.length} offline edits...`);
      
      // Check current cloud version
      let cloudRevision = null;
      let cloudContent = null;
      try {
        const revInfo = await getCurrentRevision(fileId);
        if (revInfo) cloudRevision = revInfo.revision;
        cloudContent = await fetchLatestContent(fileId);
      } catch(e) {
        // If can't fetch cloud version, don't sync
        console.error("Cannot fetch cloud version:", e);
        return;
      }
      
      // For each pending edit (from oldest to newest)
      for (const edit of pendingEdits) {
        // Check if this edit is newer than cloud version
        // Since we can't compare revision IDs directly, we check if cloud content is different
        // from the edit content. If cloud has changed, we save as snapshot instead.
        
        if (cloudContent !== edit.content) {
          // Cloud version is different - likely newer
          // Save this offline edit as a version snapshot instead of overwriting
          await uploadOfflineEditAsSnapshot(fileId, edit.content, edit.timestamp, edit.driveRevisionId);
          showTemporaryStatus(`Offline version saved to history`, false);
        } else {
          // Content matches, no need to do anything
        }
        
        // Mark as synced
        await markOfflineEditSynced(edit.id);
      }
      
      // Clear synced edits
      await clearSyncedOfflineEdits(fileId);
      
      showTemporaryStatus(`Synced ${pendingEdits.length} offline edits to version history`);
      
      // Refresh version history UI if open
      if (historyOverlay.style.display === "flex") {
        await renderVersionHistory(true);
      }
      
    } catch(e) {
      console.error("Failed to sync offline edits:", e);
      showTemporaryStatus("Failed to sync some offline edits", true);
    }
  }
  
  // Real-time sync with offline detection
  async function getCurrentRevision(fileId){ 
    try{ 
      const res=await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=revision,modifiedTime`,{}); 
      if(!res.ok)return null; 
      const data=await res.json(); 
      return {revision:data.revision||data.modifiedTime}; 
    }catch(e){
      isOffline = true;
      updatePermanentStatus();
      return null;
    } 
  }
  async function fetchLatestContent(fileId){ 
    const res=await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,{}); 
    if(!res.ok)throw new Error(); 
    return await res.text(); 
  }
  async function applyRemoteUpdate(newContent,newRevision,source){ 
    if(isApplyingRemoteUpdate||!currentFileId)return;
    
    // Check if content is different
    if(newContent === editor.innerText) return;
    
    // Check if we have pending offline edits for this file
    const pendingEdits = await getPendingOfflineEdits(currentFileId);
    
    if (pendingEdits.length > 0) {
      // We have pending offline edits - cloud has newer version
      // Save current unsynced content as snapshot before applying cloud update
      const currentContent = editor.innerText;
      const currentTimestamp = Date.now();
      
      showTemporaryStatus(`Cloud has newer version - saving local edits to history`, false);
      
      // Save current local edits as version snapshot
      await uploadOfflineEditAsSnapshot(currentFileId, currentContent, currentTimestamp, currentFileRevision);
      
      // Mark pending edits as synced (they're now in history)
      for (const edit of pendingEdits) {
        await markOfflineEditSynced(edit.id);
      }
      await clearSyncedOfflineEdits(currentFileId);
    }
    
    isApplyingRemoteUpdate=true; 
    try{ 
      editor.innerText=newContent; 
      updateLastSavedContent(); 
      currentFileRevision=newRevision; 
      lastSnapshotContent = newContent; // Reset snapshot cache
      showTemporaryStatus(`Synced from ${source}`); 
    }finally{ 
      isApplyingRemoteUpdate=false; 
    } 
  }
  async function pollForChanges(){ 
    if(!accessToken||!currentFileId||isSaving||isApplyingRemoteUpdate)return; 
    try{ 
      const revInfo=await getCurrentRevision(currentFileId); 
      if(revInfo && revInfo.revision!==currentFileRevision){ 
        const newContent=await fetchLatestContent(currentFileId); 
        await applyRemoteUpdate(newContent,revInfo.revision,"cloud"); 
      }
      // If we're online, try to sync pending edits
      if (!isOffline && currentFileId) {
        await syncPendingOfflineEdits(currentFileId);
      }
    }catch(e){
      // Network error - already handled in driveFetch
      if (!isOffline) {
        isOffline = true;
        updatePermanentStatus();
      }
    } 
  }
  function broadcastLocalChange(content,revision){ if(!broadcastChannel||!currentFileId)return; broadcastChannel.postMessage({type:"SYNC_UPDATE",fileId:currentFileId,content:content,revision:revision}); }
  function setupBroadcastChannel(){ if(broadcastChannel)broadcastChannel.close(); broadcastChannel=new BroadcastChannel("anynotes_sync"); broadcastChannel.onmessage=async(e)=>{ const{type,fileId,content,revision}=e.data; if(type==="SYNC_UPDATE"&&fileId===currentFileId&&!isApplyingRemoteUpdate&&!isSaving&&content!==editor.innerText){ await applyRemoteUpdate(content,revision,"tab"); setTimeout(()=>pushToDriveIfNeeded(content),500); } }; }
  async function pushToDriveIfNeeded(content){ 
    if(!accessToken||!currentFileId||isSaving) return;
    
    // If offline, save as pending edit
    if (isOffline) {
      await saveOfflineEdit(currentFileId, content, Date.now(), currentFileRevision);
      showTemporaryStatus("Offline: Edit saved locally", false);
      return;
    }
    
    isSaving=true; 
    try{ 
      await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${currentFileId}?uploadType=media`,{method:"PATCH",headers:{"Content-Type":"text/plain"},body:content}); 
      const revInfo=await getCurrentRevision(currentFileId); 
      if(revInfo)currentFileRevision=revInfo.revision; 
      updateLastSavedContent(); 
      
      // Clear any pending edits since we successfully synced
      const pendingEdits = await getPendingOfflineEdits(currentFileId);
      if (pendingEdits.length > 0) {
        for (const edit of pendingEdits) {
          await markOfflineEditSynced(edit.id);
        }
        await clearSyncedOfflineEdits(currentFileId);
      }
    } catch(e){
      // Save as offline edit if push fails
      if (isOffline || e.message.includes("offline") || e.message.includes("Network")) {
        await saveOfflineEdit(currentFileId, content, Date.now(), currentFileRevision);
        showTemporaryStatus("Offline: Edit saved locally", false);
      } else {
        showTemporaryStatus("Failed to save", true);
      }
    } finally{ 
      isSaving=false; 
    } 
  }
  function startRealTimeSync(){ if(syncPollingInterval)clearInterval(syncPollingInterval); setupBroadcastChannel(); syncPollingInterval=setInterval(()=>pollForChanges(),2500); }
  
  // Editor with debounced snapshot and plain-text paste
  function setupDebouncedVersionHistory() {
    editor.addEventListener("input", async () => {
      const newContent = editor.innerText;
      localStorage.setItem("localNote_backup", newContent);
      await triggerAutoSave();
      updatePermanentStatus();
      
      // Broadcast to other tabs
      if (currentFileId && !isApplyingRemoteUpdate && newContent !== lastBroadcastContent) {
        lastBroadcastContent = newContent;
        broadcastLocalChange(newContent, currentFileRevision);
      }
      
      // Reset debounce timer for version snapshot
      if (versionDebounceTimer) clearTimeout(versionDebounceTimer);
      versionDebounceTimer = setTimeout(async () => {
        if (currentFileId && !isApplyingRemoteUpdate) {
          const content = editor.innerText;
          const lastSnapshot = lastSnapshotContent;
          if (content !== lastSnapshot) {
            await saveDebouncedSnapshot(currentFileId, content, Date.now(), currentFileRevision);
            // Optional: subtle indication that version was saved
            showTemporaryStatus("📸 Version saved", false);
            setTimeout(() => updatePermanentStatus(), 1500);
          }
        }
      }, DEBOUNCE_DELAY_MS);
    });
  }
  
  // ========== NEW BUTTON LOGIC & SAVE BUTTON TRANSFORMATION ==========
  const saveNewBtn = document.getElementById("saveNewBtn");
  
  // Check if user has ever saved a file (has at least one note in Drive)
  function hasUserEverSaved() {
    return allAppFiles && allAppFiles.length > 0;
  }
  
  // Update button appearance and behavior based on whether user has saved before
  function updateSaveNewButtonState() {
    if (!saveNewBtn) return;
    // Only signed-in users with at least one saved file should see "New" button
    if (accessToken && hasUserEverSaved()) {
      saveNewBtn.textContent = "📄 New";
      saveNewBtn.classList.add("new-btn");
      saveNewBtn.classList.remove("save-btn");
    } else {
      saveNewBtn.textContent = "💾 Save";
      saveNewBtn.classList.add("save-btn");
      saveNewBtn.classList.remove("new-btn");
    }
  }
  
  // Core save function (creates or updates a file)
  async function performSaveFile(fileName, isNewFile = false) {
    if (!accessToken) { alert("Sign in required"); return false; }
    const cleanName = fileName.trim().replace(/[<>:"/\\|?*]/g,'');
    if (!cleanName) return false;
    const fullFileName = cleanName + "_AnyNotes.txt";
    await ensureValidToken();
    const existing = allAppFiles.find(f => f.name === fullFileName);
    let savedFileId = null;
    let savedFileName = null;
    
    try {
      if (existing && !isNewFile) {
        // Overwrite existing file
        await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media`, {
          method: "PATCH",
          headers: { "Content-Type": "text/plain" },
          body: editor.innerText
        });
        savedFileId = existing.id;
        savedFileName = fullFileName;
        currentFileId = savedFileId;
        currentFileName = savedFileName;
      } else {
        // Create new file (always empty for New button)
        const form = new FormData();
        form.append("metadata", new Blob([JSON.stringify({ name: fullFileName })], { type: "application/json" }));
        const fileContent = isNewFile ? "" : editor.innerText;
        form.append("file", new Blob([fileContent], { type: "text/plain" }));
        const res = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
          method: "POST",
          body: form
        });
        if (!res.ok) throw new Error("Upload failed");
        const data = await res.json();
        savedFileId = data.id;
        savedFileName = fullFileName;
        currentFileId = savedFileId;
        currentFileName = savedFileName;
        if (isNewFile) {
          // Clear editor for new empty file
          editor.innerText = "";
          updateLastSavedContent();
        }
      }
      
      const revInfo = await getCurrentRevision(currentFileId);
      if (revInfo) currentFileRevision = revInfo.revision;
      updateLastSavedContent();
      await saveGlobalState();
      await loadAllAppFiles(); // Refresh file list
      broadcastLocalChange(editor.innerText, currentFileRevision);
      await saveDebouncedSnapshot(currentFileId, editor.innerText, Date.now(), currentFileRevision);
      
      // Sync any pending offline edits for this file
      await syncPendingOfflineEdits(currentFileId);
      
      showTemporaryStatus(isNewFile ? "New file created" : "Saved");
      updatePermanentStatus();
      updateSaveNewButtonState(); // Update button after saving
      return true;
    } catch (e) {
      // If offline or network error, save as pending edit
      if (e.message.includes("offline") || e.message.includes("Network") || e.message.includes("fetch")) {
        if (currentFileId) {
          await saveOfflineEdit(currentFileId, editor.innerText, Date.now(), currentFileRevision);
          showTemporaryStatus("Saved offline - will sync when online", false);
          return true;
        }
      }
      showTemporaryStatus("Save failed", true);
      console.error(e);
      return false;
    }
  }
  
  // Legacy saveFile replaced with new unified logic
  async function saveFile() {
    if (!accessToken) { alert("Sign in required"); return; }
    let name = prompt("Enter your file name:", currentFileName?.replace("_AnyNotes.txt","") || "MyNote");
    if (!name) return;
    await performSaveFile(name, false);
  }
  
  // New file creation: creates empty file without modifying previous file
  async function createNewFile() {
    if (!accessToken) { alert("Sign in required"); return; }
    let name = prompt("Enter file name:", "myNewNote");
    if (!name) return;
    const success = await performSaveFile(name, true);
    if (success) {
      showTemporaryStatus(`New file "${name}" created`);
    }
  }
  
  // Button click handler: decides between Save and New based on state
  function onSaveNewClick() {
    if (!accessToken) {
      alert("Please sign in first");
      return;
    }
    // If user has saved at least once, treat as "New" button
    if (hasUserEverSaved()) {
      createNewFile();
    } else {
      saveFile();
    }
  }
  
  // Override openFileById to ensure button state updates after opening file
  const originalOpenFileById = window.openFileById;
  async function openFileById(id) {
    if (!accessToken) return;
    try {
      const content = await fetchLatestContent(id);
      editor.innerText = content;
      updateLastSavedContent();
      const metaRes = await driveFetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=name`, {});
      const meta = await metaRes.json();
      currentFileId = id;
      currentFileName = meta.name;
      const revInfo = await getCurrentRevision(id);
      if (revInfo) currentFileRevision = revInfo.revision;
      localStorage.setItem("currentFileId", currentFileId);
      await saveGlobalState();
      broadcastLocalChange(editor.innerText, currentFileRevision);
      lastSnapshotContent = ""; // reset snapshot cache on file open
      
      // Check for pending offline edits for this file
      const pendingEdits = await getPendingOfflineEdits(currentFileId);
      if (pendingEdits.length > 0 && !isOffline) {
        showTemporaryStatus(`Found ${pendingEdits.length} offline edits - syncing...`, false);
        await syncPendingOfflineEdits(currentFileId);
      } else if (pendingEdits.length > 0 && isOffline) {
        showTemporaryStatus(`⚠️ ${pendingEdits.length} offline edits pending`, false);
      }
      
      showTemporaryStatus("Opened");
      updatePermanentStatus();
      updateSaveNewButtonState(); // Update button after loading file
    } catch(e) { 
      showTemporaryStatus("Open failed", true); 
    }
  }
  window.openFileById = openFileById;
  
  // Override deleteFile to update button state after deletion
  async function deleteFile() {
    if (!accessToken) return;
    await loadAllAppFiles();
    if (allAppFiles.length === 0) { alert("No files"); return; }
    let list = allAppFiles.map((f,i) => (i+1)+". "+f.name.replace("_AnyNotes.txt",""));
    let input = prompt(list.join("\n")+"\n\nEnter number to delete:");
    let idx = parseInt(input)-1;
    if (isNaN(idx) || idx < 0 || idx >= allAppFiles.length) return;
    let selected = allAppFiles[idx];
    if (!confirm(`Delete "${selected.name.replace("_AnyNotes.txt","")}"?`)) return;
    await driveFetch(`https://www.googleapis.com/drive/v3/files/${selected.id}`, { method: "DELETE" });
    showTemporaryStatus("Deleted");
    if (currentFileId === selected.id) {
      editor.innerText = "Start writing your notes...";
      currentFileId = null;
      currentFileName = null;
      lastSavedContent = "";
      localStorage.removeItem("currentFileId");
      await saveGlobalState();
    }
    await loadAllAppFiles();
    updatePermanentStatus();
    updateSaveNewButtonState(); // Update button after file deletion
  }
  window.deleteFile = deleteFile;
  
  // Override loadAllAppFiles to update button state after file list changes
  async function loadAllAppFiles() {
    if (!accessToken) return [];
    try {
      const q = encodeURIComponent("name contains '_AnyNotes.txt' and trashed=false");
      const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {});
      const data = await res.json();
      allAppFiles = data.files || [];
      updateSaveNewButtonState();
      return allAppFiles;
    } catch(e) {
      allAppFiles = [];
      updateSaveNewButtonState();
      return [];
    }
  }
  window.loadAllAppFiles = loadAllAppFiles;
  
  // Override logout to reset button state
  function logout() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    stopRealTimeSync();
    localStorage.clear();
    location.reload();
  }
  window.logout = logout;
  
  // Modified auto-save to handle offline
  async function triggerAutoSave() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(async () => {
      if (accessToken && currentFileId && !isSaving && contentChangedSinceLastSave()) {
        if (isOffline) {
          // Save as offline edit
          await saveOfflineEdit(currentFileId, editor.innerText, Date.now(), currentFileRevision);
          showTemporaryStatus("Offline: Auto-saved locally", false);
          updateLastSavedContent();
        } else {
          isSaving = true;
          try {
            await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${currentFileId}?uploadType=media`, {
              method: "PATCH",
              headers: { "Content-Type": "text/plain" },
              body: editor.innerText
            });
            const revInfo = await getCurrentRevision(currentFileId);
            if (revInfo) currentFileRevision = revInfo.revision;
            updateLastSavedContent();
            broadcastLocalChange(editor.innerText, currentFileRevision);
            showTemporaryStatus("Auto-saved");
          } catch(e) {
            // Save as offline edit if auto-save fails
            if (e.message.includes("offline") || e.message.includes("Network")) {
              await saveOfflineEdit(currentFileId, editor.innerText, Date.now(), currentFileRevision);
              showTemporaryStatus("Offline: Auto-saved locally", false);
              updateLastSavedContent();
            }
          }
          finally { isSaving = false; }
        }
      }
    }, 2000);
  }
  function contentChangedSinceLastSave() { return editor.innerText !== lastSavedContent; }
  function updateLastSavedContent() { lastSavedContent = editor.innerText; }
  async function openFile() {
    if (!accessToken) { alert("Sign in"); return; }
    await loadAllAppFiles();
    if (allAppFiles.length === 0) { alert("No notes"); return; }
    let list = allAppFiles.map((f,i) => (i+1)+". "+f.name.replace("_AnyNotes.txt",""));
    let input = prompt(EMOJI.folder+" Your notes:\n\n"+list.join("\n")+"\n\nEnter number:");
    let idx = parseInt(input)-1;
    if (isNaN(idx) || idx < 0 || idx >= allAppFiles.length) return;
    await openFileById(allAppFiles[idx].id);
  }
  function downloadFile() {
    let ext = prompt("Extension", ".txt");
    if (!ext) return;
    if (!ext.startsWith(".")) ext = "." + ext;
    const rid = Math.random().toString(36).substring(2,8);
    const blob = new Blob([editor.innerText], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "AnyNotes_"+rid+ext;
    a.click();
    URL.revokeObjectURL(a.href);
    showTemporaryStatus("Downloaded");
  }
  async function saveGlobalState() {
    if (!accessToken) return;
    const state = { lastFileId: currentFileId, lastFileName: currentFileName, version: "6.0" };
    localStorage.setItem("app_state_backup", JSON.stringify(state));
    const stateFileName = "AnyNotes_LastState.json";
    const q = encodeURIComponent(`name='${stateFileName}' and trashed=false`);
    const search = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, {});
    const data = await search.json();
    if (data.files && data.files.length) {
      await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${data.files[0].id}?uploadType=media`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state)
      });
    } else if (currentFileId) {
      const form = new FormData();
      form.append("metadata", new Blob([JSON.stringify({ name: stateFileName })], { type: "application/json" }));
      form.append("file", new Blob([JSON.stringify(state)], { type: "application/json" }));
      await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", { method: "POST", body: form });
    }
  }
  async function loadGlobalState() {
    if (!accessToken) return;
    await loadAllAppFiles();
    const stateFileName = "AnyNotes_LastState.json";
    const q = encodeURIComponent(`name='${stateFileName}' and trashed=false`);
    const search = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, {});
    const data = await search.json();
    if (data.files && data.files.length) {
      const stateRes = await driveFetch(`https://www.googleapis.com/drive/v3/files/${data.files[0].id}?alt=media`, {});
      if (stateRes.ok) {
        const state = await stateRes.json();
        if (state.lastFileId && allAppFiles.find(f => f.id === state.lastFileId)) {
          await openFileById(state.lastFileId);
          return;
        }
      }
    }
    const backup = localStorage.getItem("app_state_backup");
    if (backup) {
      const state = JSON.parse(backup);
      if (state.lastFileId && allAppFiles.find(f => f.id === state.lastFileId)) {
        await openFileById(state.lastFileId);
        return;
      }
    }
    const localBackup = localStorage.getItem("localNote_backup");
    if (localBackup && localBackup !== "Start writing your notes..." && editor.innerText.trim() === "Start writing your notes...") {
      editor.innerText = localBackup;
      updateLastSavedContent();
    }
    updatePermanentStatus();
  }
  async function tryRestoreSession() {
    const saved = localStorage.getItem("drive_token");
    const exp = localStorage.getItem("drive_token_expiry");
    if (saved && exp && Date.now() < parseInt(exp) - 60000) {
      accessToken = saved;
      tokenExpiryTime = parseInt(exp);
      const user = await fetchUserProfile();
      if (user) {
        updateUIBasedOnLoginState();
        await loadAllAppFiles();
        await loadGlobalState();
        startRealTimeSync();
        // Check for any pending offline edits after session restore
        if (currentFileId) {
          setTimeout(() => syncPendingOfflineEdits(currentFileId), 2000);
        }
        return true;
      } else {
        logoutAndClearAuth("Expired");
        return false;
      }
    }
    return false;
  }
  function stopRealTimeSync() {
    if (syncPollingInterval) clearInterval(syncPollingInterval);
    if (broadcastChannel) broadcastChannel.close();
  }
  
  // History UI
  let currentOffset = 0;
  let totalSnapshots = 0;
  let isLoadingMore = false;
  async function renderVersionHistory(resetOffset = true) {
    if (!currentFileId) { document.getElementById("historyList").innerHTML = '<div class="history-empty">Open or save a note to see version history</div>'; document.getElementById("versionCount").innerText = ""; return; }
    if (resetOffset) currentOffset = 0;
    totalSnapshots = await getSnapshotCount(currentFileId);
    
    // Also check for pending offline edits
    const pendingEdits = await getPendingOfflineEdits(currentFileId);
    const pendingCount = pendingEdits.filter(e => !e.synced).length;
    
    document.getElementById("versionCount").innerText = `(${totalSnapshots} versions${pendingCount > 0 ? ` + ${pendingCount} pending` : ""})`;
    const snapshots = await getSnapshotsPaginated(currentFileId, currentOffset, PAGE_SIZE);
    const historyList = document.getElementById("historyList");
    if (resetOffset) historyList.innerHTML = "";
    
    // Show pending offline edits info
    if (pendingCount > 0 && resetOffset) {
      const pendingDiv = document.createElement("div");
      pendingDiv.className = "history-item";
      pendingDiv.style.background = "#fef3c7";
      pendingDiv.style.borderColor = "#f59e0b";
      pendingDiv.innerHTML = `<div class="history-timestamp">📱 OFFLINE EDITS (${pendingCount})</div>
                              <div class="history-preview">These edits were made offline and will sync when you reconnect</div>
                              <button class="restore-btn" id="forceSyncBtn">🔄 Sync Now</button>`;
      const syncBtn = pendingDiv.querySelector("#forceSyncBtn");
      syncBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await syncPendingOfflineEdits(currentFileId);
        await renderVersionHistory(true);
      });
      historyList.appendChild(pendingDiv);
    }
    
    if (snapshots.length === 0 && currentOffset === 0 && pendingCount === 0) { 
      historyList.innerHTML = '<div class="history-empty">No versions yet. Stop typing for 3 seconds to save a version.</div>'; 
      return; 
    }
    for (const snap of snapshots) {
      const date = new Date(snap.timestamp);
      const formatted = date.toLocaleString();
      const preview = snap.preview || snap.content.substring(0, 100).replace(/\n/g, ' ');
      const div = document.createElement("div");
      div.className = "history-item";
      div.innerHTML = `<div class="history-timestamp">📅 ${formatted}</div><div class="history-preview">${escapeHtml(preview)}</div><button class="restore-btn" data-content="${escapeHtmlAttr(snap.content)}">↻ Restore</button>`;
      const restoreBtn = div.querySelector(".restore-btn");
      restoreBtn.addEventListener("click", async (e) => { e.stopPropagation(); const originalContent = restoreBtn.getAttribute("data-content"); if (confirm(`Restore version from ${formatted}?`)) await restoreFromLocalSnapshot(originalContent); });
      historyList.appendChild(div);
    }
    if (currentOffset + PAGE_SIZE < totalSnapshots) {
      const loadMoreDiv = document.createElement("div");
      loadMoreDiv.className = "load-more-btn";
      loadMoreDiv.innerHTML = "📜 See more versions...";
      loadMoreDiv.onclick = async () => { if (isLoadingMore) return; isLoadingMore = true; currentOffset += PAGE_SIZE; await renderVersionHistory(false); isLoadingMore = false; };
      historyList.appendChild(loadMoreDiv);
    }
  }
  async function restoreFromLocalSnapshot(content) {
    if (!currentFileId) return;
    isApplyingRemoteUpdate = true;
    try {
      editor.innerText = content;
      updateLastSavedContent();
      if (accessToken && currentFileId && !isOffline) {
        await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${currentFileId}?uploadType=media`, {
          method: "PATCH",
          headers: { "Content-Type": "text/plain" },
          body: content
        });
        const revInfo = await getCurrentRevision(currentFileId);
        if (revInfo) currentFileRevision = revInfo.revision;
      } else if (accessToken && currentFileId && isOffline) {
        // Save as offline edit if offline
        await saveOfflineEdit(currentFileId, content, Date.now(), currentFileRevision);
        showTemporaryStatus("Restored offline - will sync when online", false);
      }
      broadcastLocalChange(content, currentFileRevision);
      showTemporaryStatus("Restored");
      document.getElementById("historyOverlay").style.display = "none";
    } catch(e) { showTemporaryStatus("Restore failed", true); }
    finally { isApplyingRemoteUpdate = false; }
  }
  function escapeHtml(str) { return str.replace(/[&<>]/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[m])); }
  function escapeHtmlAttr(str) { return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  
  const historyBtn = document.getElementById("historyBtn");
  const historyOverlay = document.getElementById("historyOverlay");
  const closeHistoryBtn = document.getElementById("closeHistoryBtn");
  historyBtn.addEventListener("click", async () => { if (!currentFileId) { showTemporaryStatus("Open or save a note first", true); return; } await renderVersionHistory(true); historyOverlay.style.display = "flex"; });
  closeHistoryBtn.addEventListener("click", () => { historyOverlay.style.display = "none"; });
  historyOverlay.addEventListener("click", (e) => { if (e.target === historyOverlay) historyOverlay.style.display = "none"; });
  
  // Initialize
  window.onload = async () => {
    await openIndexedDB();
    setupPlainTextPaste();
    setupDebouncedVersionHistory();
    
    // Attach event listeners to original buttons
    document.getElementById("saveNewBtn").addEventListener("click", onSaveNewClick);
    document.getElementById("openBtn").addEventListener("click", () => openFile());
    document.getElementById("deleteBtn").addEventListener("click", () => deleteFile());
    document.getElementById("downloadBtn").addEventListener("click", downloadFile);
    document.getElementById("logoutBtn").addEventListener("click", logout);
    loginBtnTop.addEventListener("click", handleLoginClick);
    userBox.addEventListener("click", (e) => { e.stopPropagation(); dropdownMenu.classList.toggle("show"); });
    document.addEventListener("click", (e) => { if (!profileSection.contains(e.target)) dropdownMenu.classList.remove("show"); });
    
    const localBackup = localStorage.getItem("localNote_backup");
    if (localBackup && localBackup !== "Start writing your notes...") { editor.innerText = localBackup; updateLastSavedContent(); }
    const restored = await tryRestoreSession();
    if (!restored) {
      updateUIBasedOnLoginState();
      updatePermanentStatus();
      google.accounts.id.initialize({ client_id: "306125547800-cckr01g764von4q13sfese5if8o1de41.apps.googleusercontent.com", callback: () => {} });
      google.accounts.id.prompt();
    }
    
    // Detect online/offline status
    window.addEventListener('online', async () => {
      isOffline = false;
      updatePermanentStatus();
      showTemporaryStatus("Back online - syncing...", false);
      if (currentFileId) {
        await syncPendingOfflineEdits(currentFileId);
        await pollForChanges();
      }
    });
    window.addEventListener('offline', () => {
      isOffline = true;
      updatePermanentStatus();
      showTemporaryStatus("You are offline - edits will be saved locally", false);
    });
  };
  
  // Copy plain text:
document.getElementById('editor').addEventListener('copy', function(e) {
  const text = window.getSelection().toString();
  e.clipboardData.setData('text/plain', text);
  e.preventDefault();
});
