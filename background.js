let workflowState = {
  active: false,
  prompts: [],
  currentIndex: 0,
  baseUrl: '',
  tabId: null
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'start_workflow') {
    workflowState = {
      active: true,
      prompts: message.prompts,
      currentIndex: 0,
      startIndexOffset: message.startIndexOffset || 0,
      baseUrl: message.baseUrl,
      tabId: null
    };

    chrome.tabs.query({ url: "*://*.magnific.com/*" }, (tabs) => {
      if (tabs.length > 0) {
        workflowState.tabId = tabs[0].id;
        chrome.tabs.update(workflowState.tabId, { url: workflowState.baseUrl });
        waitForTabLoad(workflowState.tabId, processNextPrompt);
      } else {
        chrome.tabs.create({ url: workflowState.baseUrl }, (tab) => {
          workflowState.tabId = tab.id;
          waitForTabLoad(workflowState.tabId, processNextPrompt);
        });
      }
    });
  } else if (message.action === 'stop_workflow') {
    workflowState.active = false;
    updateStatus('Workflow stopped.', true);
  } else if (message.action === 'trigger_browser_download') {
    chrome.downloads.download({
      url: message.url,
      filename: message.filename
    });
  }
});

function processNextPrompt() {
  if (!workflowState.active) return;
  if (workflowState.currentIndex >= workflowState.prompts.length) {
    updateStatus('All prompts processed successfully!', true);
    workflowState.active = false;
    return;
  }

  const prompt = workflowState.prompts[workflowState.currentIndex];
  const visualPromptNumber = workflowState.currentIndex + workflowState.startIndexOffset + 1;

  // Skip empty rows (e.g. if G5 was empty)
  if (!prompt || prompt.trim() === '') {
    workflowState.currentIndex++;
    processNextPrompt(); // go to next immediately
    return;
  }

  updateStatus(`Processing prompt G${visualPromptNumber}...`);

  // Wait a bit before starting to ensure UI is ready
  setTimeout(() => {
    if (!workflowState.active) return;
    chrome.tabs.sendMessage(workflowState.tabId, { action: 'execute_step', prompt: prompt, promptNumber: visualPromptNumber }, (response) => {
      if (response && response.success) {
        workflowState.currentIndex++;
        // Short pause before the next prompt
        setTimeout(processNextPrompt, 2000);
      } else {
        updateStatus(`Error on prompt G${visualPromptNumber}: ${response ? response.error : 'No response'}`, true);
        workflowState.active = false;
      }
    });
  }, 2000);
}

function updateStatus(status, done = false) {
  chrome.runtime.sendMessage({ action: 'update_status', status, done });
}

function waitForTabLoad(tabId, callback) {
  chrome.tabs.get(tabId, (tab) => {
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
