chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'execute_step') {
    executeWorkflowStep(message.prompt, message.promptNumber)
      .then(() => sendResponse({ success: true }))
      .catch(err => {
        console.error('Error executing step:', err);
        sendResponse({ success: false, error: err.toString() });
      });
    return true; // Keep channel open for async response
  }
});

async function executeWorkflowStep(promptText, promptNumber) {
  // 1. SELECTORS
  const promptInputSelector = 'div[contenteditable="true"].dynamic-prompt'; 
  const clearBtnSelector = 'button[data-cy="clear-prompt-button"]';
  const generateBtnSelector = 'button[data-cy="generate-button"]'; 
  const loadingSelector = '[data-cy="thumbnail-loading"]'; 
  const imageSelector = 'img.feed-image-loaded'; 
  
  // 2. CLEAR PROMPT
  const clearBtn = document.querySelector(clearBtnSelector);
  if (clearBtn && !clearBtn.disabled) {
    clearBtn.click();
    await sleep(500);
  }

  // 3. PASTE PROMPT
  const promptInput = document.querySelector(promptInputSelector);
  if (!promptInput) throw new Error('Prompt input not found');

  promptInput.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);
  document.execCommand('insertText', false, promptText);

  await sleep(1000); // Wait for React to update

  // 4. CLICK GENERATE
  const generateBtn = document.querySelector(generateBtnSelector);
  if (!generateBtn) throw new Error('Generate button not found');
  generateBtn.click();

  // Wait for the loading state to APPEAR first (so we don't accidentally skip the wait)
  try {
    await waitForElementToAppear(loadingSelector, 10000);
  } catch (err) {
    console.warn('Loading state did not appear within 10 seconds, assuming it generated instantly or failed.');
  }

  // 5. WAIT FOR GENERATION
  await waitForElementToDisappear(loadingSelector, 180000); // Wait up to 3 mins
  
  await sleep(3000); // Wait for the image to fully render in DOM

  // 6. DOWNLOAD WITH CUSTOM NAME
  // We extract the image URL directly so we have full control over the saved filename
  const images = document.querySelectorAll(imageSelector);
  if (images.length > 0) {
    const latestImg = images[0];
    
    // Ensure filename ends in .jpg or .png (depending on the source if you want, but defaulting to .jpg works for most AI gens)
    const downloadResponse = await sendRuntimeMessage({
      action: 'trigger_browser_download',
      url: latestImg.src,
      filename: `${promptNumber}.jpg`
    });

    if (!downloadResponse || !downloadResponse.success) {
      throw new Error(downloadResponse && downloadResponse.error ? downloadResponse.error : 'Download failed to start');
    }
  } else {
    throw new Error('Could not find the generated image to download');
  }

  await sleep(1500);
}

// Helper Functions
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(response);
    });
  });
}

async function waitForElementToAppear(selector, timeoutMs) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const el = document.querySelector(selector);
    if (el) {
      const style = window.getComputedStyle(el);
      if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
        return true;
      }
    }
    await sleep(500); // Check every 500ms
  }
  throw new Error(`Timeout waiting for ${selector} to appear`);
}

async function waitForElementToDisappear(selector, timeoutMs) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    const el = document.querySelector(selector);
    if (!el) {
      return true; // Disappeared
    }
    // Check if it's visible or hidden by CSS
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return true;
    }
    await sleep(2000); // Check every 2 seconds
  }
  throw new Error(`Timeout waiting for ${selector} to disappear`);
}
