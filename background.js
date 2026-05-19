const WORKFLOW_STORAGE_KEY = 'magnificWorkflowState';
const MAX_RECOVERY_ATTEMPTS = 5;
const RECOVERY_RELOAD_DELAY_MS = 3000;
let restoreStarted = false;

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
  refImageNum: null
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
      refImageNum: message.refImageNum || null
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
        const err = chrome.runtime.lastError; // ignore error
      });
    }
    updateStatus('Workflow stopped.', true);
  } else if (message.action === 'trigger_browser_download') {
    chrome.downloads.download({
      url: message.url,
      filename: message.filename
    }, (downloadId) => {
      if (chrome.runtime.lastError || !downloadId) {
        sendResponse({
          success: false,
          error: chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Download did not start'
        });
        return;
      }

      sendResponse({ success: true, downloadId });
    });
    return true;
  } else if (message.action === 'keep_alive_ping') {
    // This message just keeps the service worker from suspending
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

  // Skip empty rows (e.g. if E5/F5/G5 was empty)
  if (!prompt || prompt.trim() === '') {
    workflowState.currentIndex++;
    workflowState.retryCount = 0;
    persistWorkflowState();
    processNextPrompt(); // go to next immediately
    return;
  }

  updateStatus(`Processing prompt ${workflowState.colLetter}${visualPromptNumber}...`);

  // Wait a bit before starting to ensure UI is ready
  setTimeout(() => {
    if (!workflowState.active) return;
    chrome.tabs.sendMessage(workflowState.tabId, { 
      action: 'execute_step', 
      prompt: prompt, 
      promptNumber: visualPromptNumber,
      refImageNum: workflowState.refImageNum,
      isFirstPrompt: workflowState.currentIndex === 0
    }, (response) => {
      if (chrome.runtime.lastError) {
        recoverFromError(`No page response: ${chrome.runtime.lastError.message || 'Unknown error'}`);
        return;
      }
      
      if (response && response.success === false && response.error === 'Already executing') {
        // Just let the executing one finish and send step_completed
        return;
      }
      
      // We rely on 'step_completed' message for advancing to prevent double execution.
    });
  }, 2000);
}

function recoverFromError(errorMessage) {
  if (!workflowState.active) return;

  workflowState.retryCount = (workflowState.retryCount || 0) + 1;
  const visualPromptNumber = workflowState.currentIndex + workflowState.startIndexOffset + 1;

  if (workflowState.retryCount > MAX_RECOVERY_ATTEMPTS) {
    updateStatus(`Stopped after ${MAX_RECOVERY_ATTEMPTS} attempts on ${workflowState.colLetter}${visualPromptNumber}: ${errorMessage}`, true);
    return;
  }

  updateStatus(`Issue on ${workflowState.colLetter}${visualPromptNumber}. Retrying prompt... (${workflowState.retryCount}/${MAX_RECOVERY_ATTEMPTS})`);
  persistWorkflowState();

  setTimeout(processNextPrompt, 5000);
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
