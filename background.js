const WORKFLOW_STORAGE_KEY = 'magnificWorkflowState';
const MAX_RECOVERY_ATTEMPTS = 5;
const REFERENCE_IMAGE_DB_NAME = 'magnificAutomatorDb';
const REFERENCE_IMAGE_STORE = 'referenceImages';
const ACTIVE_WORKFLOW_IMAGES_KEY = 'active-workflow-images';
const SAVED_CHARACTER_REFERENCES_KEY = 'saved-character-images';
const SAVED_LOCATION_REFERENCES_KEY = 'saved-location-images';
let restoreStarted = false;
let pendingDownload = null;
const imageCache = new Map();

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (pendingDownload && pendingDownload.expectedFilename) {
    pendingDownload.downloadId = item.id;
    pendingDownload.suggestedFilename = pendingDownload.expectedFilename;
    suggest({
      filename: pendingDownload.expectedFilename,
      conflictAction: 'overwrite'
    });
  } else {
    suggest();
  }
});

chrome.downloads.onChanged.addListener((delta) => {
  if (!pendingDownload || delta.id !== pendingDownload.downloadId) {
    return;
  }

  if (delta.error && delta.error.current) {
    failPendingDownload(`Download failed: ${delta.error.current}`);
    return;
  }

  if (delta.state && delta.state.current === 'complete') {
    finalizePendingDownload(delta.id);
  }
});

let workflowState = {
  active: false,
  prompts: [],
  currentIndex: 0,
  startIndexOffset: 0,
  baseUrl: '',
  colLetter: 'E',
  tabId: null,
  status: 'Ready',
  retryCount: 0,
  locationRefNum: null
};

restoreWorkflowState();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'get_state') {
    sendResponse(workflowState);
    return true;
  }
  
  if (message.action === 'start_workflow') {
    workflowState = {
      active: true,
      prompts: message.prompts,
      currentIndex: 0,
      startIndexOffset: message.startIndexOffset || 0,
      baseUrl: message.baseUrl,
      colLetter: message.colLetter || 'E',
      tabId: null,
      status: `Starting Column ${message.colLetter || 'E'}...`,
      retryCount: 0,
      locationRefNum: message.locationRefNum || null
    };
    persistWorkflowState();

    chrome.tabs.query({ url: "*://*.magnific.com/*" }, (tabs) => {
      if (tabs.length > 0) {
        workflowState.tabId = tabs[0].id;
        persistWorkflowState();
        chrome.tabs.update(workflowState.tabId, { url: workflowState.baseUrl }, () => {
          waitForTabLoad(workflowState.tabId, processNextPrompt);
        });
      } else {
        chrome.tabs.create({ url: workflowState.baseUrl }, (tab) => {
          workflowState.tabId = tab.id;
          persistWorkflowState();
          waitForTabLoad(workflowState.tabId, processNextPrompt);
        });
      }
    });
  } else if (message.action === 'stop_workflow') {
    workflowState.active = false;
    persistWorkflowState();
    if (workflowState.tabId) {
      chrome.tabs.sendMessage(workflowState.tabId, { action: 'abort_step' }, () => {
        chrome.runtime.lastError;
      });
    }
    updateStatus('Workflow stopped.', true);
  } else if (message.action === 'prepare_download') {
    preparePendingDownload(message.filename, message.promptNumber)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (message.action === 'wait_for_download') {
    if (!pendingDownload) {
      sendResponse({ success: false, error: 'No pending download to wait for' });
      return true;
    }

    if (pendingDownload.result) {
      const result = pendingDownload.result;
      cleanupPendingDownload();
      sendResponse(result);
      return true;
    }

    pendingDownload.waiters.push(sendResponse);
    return true;
  } else if (message.action === 'keep_alive_ping') {
    sendResponse({ ok: true });
    return true;
  } else if (message.action === 'step_completed') {
    if (message.aborted || !workflowState.active) {
      return true;
    }
    if (message.success) {
      workflowState.currentIndex++;
      workflowState.retryCount = 0;
      persistWorkflowState();
      setTimeout(processNextPrompt, 2000);
    } else {
      recoverFromError(message.error || 'Unknown error');
    }
    return true;
  } else if (message.action === 'progress_update') {
    if (!workflowState.active) {
      sendResponse({ ok: true });
      return true;
    }

    const visualPromptNumber = workflowState.currentIndex + workflowState.startIndexOffset + 1;
    const stage = String(message.stage || '').trim();
    const suffix = stage ? `: ${stage}` : '';
    updateStatus(`Processing prompt ${workflowState.colLetter}${visualPromptNumber}${suffix}`);
    sendResponse({ ok: true });
    return true;
  } else if (message.action === 'get_reference_image_data') {
    loadActiveWorkflowImages()
      .then((images) => {
        const imageId = String(message.imageId || '').trim();
        const image = images.find((entry) => String(entry.id || '').trim() === imageId);
        if (!image || !image.dataUrl) {
          sendResponse({ success: false, error: 'Reference image not found' });
          return;
        }

        sendResponse({
          success: true,
          image: {
            id: image.id,
            tag: image.tag,
            name: image.name,
            dataUrl: image.dataUrl,
            thumbDataUrl: image.thumbDataUrl
          }
        });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message || 'Failed to load reference image' });
      });
    return true;
  } else if (message.action === 'character_reference_added' || message.action === 'location_reference_added') {
    if (!message.forwardedByBackground) {
      chrome.runtime.sendMessage({ ...message, forwardedByBackground: true }).catch(() => {});
    }

    persistAutoCapturedReference(message).catch(console.error);
    sendResponse({ ok: true });
    return true;
  }
});

function processNextPrompt() {
  if (!workflowState.active) return;
  if (workflowState.currentIndex >= workflowState.prompts.length) {
    updateStatus('All prompts processed successfully!', true);
    return;
  }

  const prompt = workflowState.prompts[workflowState.currentIndex];
  const visualPromptNumber = workflowState.currentIndex + workflowState.startIndexOffset + 1;

  if (!prompt || prompt.trim() === '') {
    workflowState.currentIndex++;
    workflowState.retryCount = 0;
    persistWorkflowState();
    processNextPrompt();
    return;
  }

  updateStatus(`Processing prompt ${workflowState.colLetter}${visualPromptNumber}...`);

  setTimeout(async () => {
    if (!workflowState.active) return;

    let uploadedReferenceImages = [];
    try {
      uploadedReferenceImages = await loadActiveWorkflowImages();
    } catch (error) {
      console.error('Failed to load workflow reference images:', error);
    }

    let matchedImages = [];
    if (uploadedReferenceImages && uploadedReferenceImages.length > 0) {
      const locTag = workflowState.locationRefNum ? `@img${workflowState.locationRefNum}` : null;
      
      matchedImages = uploadedReferenceImages.filter(img => {
        if (!img.name || img.name.length < 2) return false;
        if (locTag && img.tag === locTag) return true;
        const firstWord = img.name.trim().split(/[\s(]/)[0].toLowerCase();
        return prompt.toLowerCase().includes(firstWord);
      });
    }

    const matchedImageRefs = matchedImages.map((img) => ({
      id: img.id,
      tag: img.tag,
      name: img.name
    }));

      chrome.tabs.sendMessage(workflowState.tabId, {
        action: 'execute_step',
        prompt: prompt,
        promptNumber: visualPromptNumber,
        locationRefNum: workflowState.locationRefNum,
        workflowType: workflowState.colLetter === 'E' ? 'character' : (workflowState.colLetter === 'F' ? 'location' : 'image'),
        uploadedReferenceImages: matchedImageRefs      }, (response) => {
      if (chrome.runtime.lastError) {
        const msg = chrome.runtime.lastError.message;
        if (msg && msg.includes('Receiving end does not exist')) {
          recoverFromError(`Tab dead: ${msg}`);
        }
        return;
      }

      if (response && response.success === false && response.error === 'Already executing') {
        return;
      }
    });
  }, 2000);
}

function recoverFromError(errorMessage) {
  if (!workflowState.active) return;

  const visualPromptNumber = workflowState.currentIndex + workflowState.startIndexOffset + 1;
  updateStatus(`Error on ${workflowState.colLetter}${visualPromptNumber}: ${errorMessage}. Workflow halted.`, true);
  workflowState.active = false;
  persistWorkflowState();
}

function reloadWorkflowTab(callback) {
  const reloadCurrentTab = () => {
    chrome.tabs.reload(workflowState.tabId, undefined, () => {
      if (chrome.runtime.lastError) {
        chrome.tabs.create({ url: workflowState.baseUrl }, (tab) => {
          workflowState.tabId = tab.id;
          persistWorkflowState();
          waitForTabLoad(workflowState.tabId, callback);
        });
        return;
      }
      waitForTabLoad(workflowState.tabId, callback);
    });
  };

  if (workflowState.tabId) {
    reloadCurrentTab();
    return;
  }

  chrome.tabs.query({ url: "*://*.magnific.com/*" }, (tabs) => {
    if (tabs.length > 0) {
      workflowState.tabId = tabs[0].id;
      persistWorkflowState();
      reloadCurrentTab();
    } else {
      chrome.tabs.create({ url: workflowState.baseUrl }, (tab) => {
        workflowState.tabId = tab.id;
        persistWorkflowState();
        waitForTabLoad(workflowState.tabId, callback);
      });
    }
  });
}

function ensureWorkflowRunning() {
  if (restoreStarted || !workflowState.active || !workflowState.baseUrl) return;
  restoreStarted = true;
  
  if (workflowState.tabId) {
    chrome.tabs.sendMessage(workflowState.tabId, { action: 'ping' }, (response) => {
      if (chrome.runtime.lastError || !response) {
        reloadWorkflowTab(() => {
          restoreStarted = false;
          processNextPrompt();
        });
      } else {
        restoreStarted = false;
        if (!response.isExecuting) {
          processNextPrompt();
        }
      }
    });
  } else {
    reloadWorkflowTab(() => {
      restoreStarted = false;
      processNextPrompt();
    });
  }
}

function restoreWorkflowState() {
  chrome.storage.local.get([WORKFLOW_STORAGE_KEY], (result) => {
    const savedState = result[WORKFLOW_STORAGE_KEY];
    if (!savedState || !savedState.active) return;

    workflowState = {
      ...workflowState,
      ...savedState,
      status: savedState.status || 'Restoring workflow...',
      retryCount: savedState.retryCount || 0
    };
    ensureWorkflowRunning();
  });
}

function persistWorkflowState() {
  chrome.storage.local.set({ [WORKFLOW_STORAGE_KEY]: workflowState });
}

function preparePendingDownload(filename, promptNumber) {
  if (!filename) {
    return Promise.reject(new Error('Download filename is required'));
  }

  if (pendingDownload) {
    return Promise.reject(new Error('Another download is already pending'));
  }

  pendingDownload = {
    expectedFilename: filename,
    expectedPromptNumber: String(promptNumber || '').trim(),
    downloadId: null,
    suggestedFilename: null,
    result: null,
    waiters: [],
    timeoutId: setTimeout(() => {
      failPendingDownload(`Timed out waiting for download ${filename}`);
    }, 120000)
  };

  return Promise.resolve();
}

function failPendingDownload(errorMessage) {
  if (!pendingDownload) {
    return;
  }

  pendingDownload.result = { success: false, error: errorMessage };
  const waiters = pendingDownload.waiters.splice(0, pendingDownload.waiters.length);
  for (const respond of waiters) {
    respond(pendingDownload.result);
  }

  if (waiters.length > 0) {
    cleanupPendingDownload();
  }
}

function cleanupPendingDownload() {
  if (!pendingDownload) {
    return;
  }

  if (pendingDownload.timeoutId) {
    clearTimeout(pendingDownload.timeoutId);
  }

  pendingDownload = null;
}

function finalizePendingDownload(downloadId) {
  chrome.downloads.search({ id: downloadId }, (items) => {
    if (chrome.runtime.lastError) {
      failPendingDownload(chrome.runtime.lastError.message || 'Failed to inspect completed download');
      return;
    }

    const item = Array.isArray(items) ? items[0] : null;
    if (!item) {
      failPendingDownload('Completed download could not be found');
      return;
    }

    const actualFilename = getBasename(item.filename || item.finalUrl || '');
    const expectedFilename = pendingDownload ? getBasename(pendingDownload.expectedFilename) : '';
    const expectedPromptNumber = pendingDownload ? pendingDownload.expectedPromptNumber : '';

    if (actualFilename !== expectedFilename) {
      console.warn(
        `Download completed with original filename "${actualFilename}" instead of expected "${expectedFilename}" for prompt ${expectedPromptNumber}.`
      );
    }

    pendingDownload.result = {
      success: true,
      filename: expectedFilename || actualFilename,
      actualFilename,
      promptNumber: expectedPromptNumber,
      renamed: actualFilename === expectedFilename
    };
    const waiters = pendingDownload.waiters.splice(0, pendingDownload.waiters.length);
    for (const respond of waiters) {
      respond(pendingDownload.result);
    }

    if (waiters.length > 0) {
      cleanupPendingDownload();
    }
  });
}

function getBasename(filePath) {
  return String(filePath || '').split(/[\\/]/).pop() || '';
}

function updateStatus(status, done = false) {
  workflowState.status = status;
  if (done) workflowState.active = false;
  persistWorkflowState();
  chrome.runtime.sendMessage({ action: 'update_status', status, done });
}

function waitForTabLoad(tabId, callback) {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      reloadWorkflowTab(callback);
      return;
    }

    if (tab.status === 'complete') {
      callback();
    } else {
      const listener = (updatedTabId, info) => {
        if (updatedTabId === tabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          callback();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    }
  });
}

function openReferenceImageDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(REFERENCE_IMAGE_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(REFERENCE_IMAGE_STORE)) {
        db.createObjectStore(REFERENCE_IMAGE_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open image database'));
  });
}

async function persistActiveWorkflowImages(images) {
  return persistStoredImages(ACTIVE_WORKFLOW_IMAGES_KEY, images, 'Failed to persist workflow images');
}

async function loadActiveWorkflowImages() {
  return loadStoredImages(ACTIVE_WORKFLOW_IMAGES_KEY, 'Failed to load workflow images');
}

async function persistStoredImages(storageKey, images, errorMessage) {
  const db = await openReferenceImageDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(REFERENCE_IMAGE_STORE, 'readwrite');
    const store = transaction.objectStore(REFERENCE_IMAGE_STORE);
    store.put(images, storageKey);

    transaction.oncomplete = () => {
      imageCache.set(storageKey, Array.isArray(images) ? images : []);
      db.close();
      resolve();
    };
    transaction.onabort = () => reject(transaction.error || new Error(errorMessage));
    transaction.onerror = () => reject(transaction.error || new Error(errorMessage));
  });
}

async function loadStoredImages(storageKey, errorMessage) {
  if (imageCache.has(storageKey)) {
    return imageCache.get(storageKey);
  }

  const db = await openReferenceImageDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(REFERENCE_IMAGE_STORE, 'readonly');
    const store = transaction.objectStore(REFERENCE_IMAGE_STORE);
    const request = store.get(storageKey);

    request.onsuccess = () => {
      const images = Array.isArray(request.result) ? request.result : [];
      imageCache.set(storageKey, images);
      resolve(images);
    };
    request.onerror = () => reject(request.error || new Error(errorMessage));
    transaction.oncomplete = () => db.close();
    transaction.onabort = () => reject(transaction.error || new Error(errorMessage));
  });
}

async function persistAutoCapturedReference(message) {
  const name = String(message.name || '').trim();
  const dataUrl = String(message.dataUrl || '').trim();
  const action = message.action;

  if (!name || !dataUrl || (action !== 'character_reference_added' && action !== 'location_reference_added')) {
    return;
  }

  const targetKey = action === 'character_reference_added'
    ? SAVED_CHARACTER_REFERENCES_KEY
    : SAVED_LOCATION_REFERENCES_KEY;

  const [currentImages, savedImages] = await Promise.all([
    loadStoredImages(ACTIVE_WORKFLOW_IMAGES_KEY, 'Failed to load workflow images'),
    loadStoredImages(targetKey, 'Failed to load saved auto-captured references')
  ]);

  const existingWorkflowImage = currentImages.find((img) => img.name && img.name.toLowerCase() === name.toLowerCase());
  const referenceId = existingWorkflowImage
    ? existingWorkflowImage.id
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  if (!existingWorkflowImage) {
    const usedTags = new Set(currentImages.map((img) => String(img.tag || '').trim().toLowerCase()));
    let candidateNumber = 1;
    while (usedTags.has(`@img${candidateNumber}`)) {
      candidateNumber++;
    }

    currentImages.push({
      id: referenceId,
      tag: `@img${candidateNumber}`,
      name,
      dataUrl
    });
  }

  const savedExists = savedImages.find((img) => img.name && img.name.toLowerCase() === name.toLowerCase());
  if (!savedExists) {
    const nextTag = `@img${savedImages.length + 1}`;
    savedImages.push({
      id: referenceId,
      tag: nextTag,
      name,
      dataUrl
    });
  }

  await Promise.all([
    persistStoredImages(ACTIVE_WORKFLOW_IMAGES_KEY, currentImages, 'Failed to persist workflow images'),
    persistStoredImages(targetKey, savedImages, 'Failed to persist saved auto-captured references')
  ]);
}
