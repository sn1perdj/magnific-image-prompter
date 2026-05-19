let currentStepAborted = false;
let pingInterval;
let isExecuting = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'abort_step') {
    currentStepAborted = true;
    sendResponse({ ok: true });
    return;
  }
  if (message.action === 'ping') {
    sendResponse({ ok: true, isExecuting: isExecuting });
    return;
  }

  if (message.action === 'execute_step') {
    if (isExecuting) {
      sendResponse({ success: false, error: 'Already executing' });
      return true;
    }
    isExecuting = true;
    currentStepAborted = false;
    
    // Keep service worker alive
    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      chrome.runtime.sendMessage({ action: 'keep_alive_ping' }).catch(() => {});
    }, 10000);

    executeWorkflowStep(message.prompt, message.promptNumber, message.refImageNum, message.isFirstPrompt)
      .then(() => {
        isExecuting = false;
        clearInterval(pingInterval);
        sendResponse({ success: true });
        chrome.runtime.sendMessage({ action: 'step_completed', success: true });
      })
      .catch(err => {
        isExecuting = false;
        clearInterval(pingInterval);
        if (err.message === 'Aborted by user') {
          sendResponse({ success: false, error: 'Aborted by user', aborted: true });
          chrome.runtime.sendMessage({ action: 'step_completed', success: false, aborted: true });
        } else {
          console.error('Error executing step:', err);
          sendResponse({ success: false, error: err.toString() });
          chrome.runtime.sendMessage({ action: 'step_completed', success: false, error: err.toString() });
        }
      });
    return true; // Keep channel open for async response
  }
});

async function executeWorkflowStep(promptText, promptNumber, refImageNum, isFirstPrompt) {
  // 1. SELECTORS
  const promptInputSelector = 'div[contenteditable="true"].dynamic-prompt'; 
  const clearBtnSelector = 'button[data-cy="clear-prompt-button"]';
  const generateBtnSelector = 'button[data-cy="generate-button"]'; 
  const loadingSelector = '[data-cy="thumbnail-loading"]'; 
  const imageSelector = 'img.feed-image-loaded'; 
  
  // 1.5. HANDLE REFERENCE IMAGE FOR FIRST PROMPT OF THIS RUN
  if (refImageNum && isFirstPrompt) {
    if (promptNumber === 1) {
      await clearReferenceImage(refImageNum);
    } else {
      // If starting from a later prompt (e.g., G16), try to grab the last generated image from the page
      const images = document.querySelectorAll(imageSelector);
      if (images.length > 0) {
        const latestImgSrc = images[0].src;
        const dropZone = document.querySelector('div[data-cy="reference-add-button"]');
        const targetElement = dropZone || document.querySelector(promptInputSelector);
        await replaceReferenceImage(latestImgSrc, refImageNum, targetElement);
      } else {
        await clearReferenceImage(refImageNum);
      }
    }
  }

  // 2. CLEAR PROMPT
  if (currentStepAborted) throw new Error('Aborted by user');
  const clearBtn = document.querySelector(clearBtnSelector);
  if (clearBtn && !clearBtn.disabled) {
    clearBtn.click();
    await sleep(500);
  }

  // 3. PASTE PROMPT
  if (currentStepAborted) throw new Error('Aborted by user');
  const promptInput = document.querySelector(promptInputSelector);
  if (!promptInput) throw new Error('Prompt input not found');

  promptInput.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);
  document.execCommand('insertText', false, promptText);

  await sleep(1000); // Wait for React to update

  // 4. CLICK GENERATE
  if (currentStepAborted) throw new Error('Aborted by user');
  const generateBtn = document.querySelector(generateBtnSelector);
  if (!generateBtn) throw new Error('Generate button not found');
  generateBtn.click();

  // Wait for the loading state to APPEAR first (so we don't accidentally skip the wait)
  try {
    await waitForElementToAppear(loadingSelector, 20000);
  } catch (err) {
    console.warn('Loading state did not appear within 20 seconds, assuming it generated instantly or failed.');
  }

  // 5. WAIT FOR GENERATION
  if (currentStepAborted) throw new Error('Aborted by user');
  await waitForElementToDisappear(loadingSelector, 600000); // Wait up to 10 mins
  
  if (currentStepAborted) throw new Error('Aborted by user');
  await sleep(3000); // Wait for the image to fully render in DOM

  // 6. DOWNLOAD WITH CUSTOM NAME
  if (currentStepAborted) throw new Error('Aborted by user');
  // We extract the image URL directly so we have full control over the saved filename
  const images = document.querySelectorAll(imageSelector);
  let latestImgSrc = null;
  if (images.length > 0) {
    const latestImg = images[0];
    latestImgSrc = latestImg.src;
    
    // Ensure filename ends in .jpg or .png (depending on the source if you want, but defaulting to .jpg works for most AI gens)
    const downloadResponse = await sendRuntimeMessage({
      action: 'trigger_browser_download',
      url: latestImgSrc,
      filename: `${promptNumber}.jpg`
    });

    if (!downloadResponse || !downloadResponse.success) {
      throw new Error(downloadResponse && downloadResponse.error ? downloadResponse.error : 'Download failed to start');
    }
  } else {
    throw new Error('Could not find the generated image to download');
  }

  // 7. REPLACE REFERENCE IMAGE IF SPECIFIED
  if (refImageNum && latestImgSrc) {
    const dropZone = document.querySelector('div[data-cy="reference-add-button"]');
    const targetElement = dropZone || document.querySelector(promptInputSelector);
    await replaceReferenceImage(latestImgSrc, refImageNum, targetElement);
  }

  await sleep(1500);
}

// Helper Functions
async function clearReferenceImage(refImageNum) {
  const refImageAlt = `@img${refImageNum}`;
  const refImages = document.querySelectorAll('div[data-cy="reference-image-card"] img');
  for (let img of refImages) {
    const alt = img.getAttribute('alt');
    if (alt && (alt === refImageAlt || alt.startsWith(refImageAlt + '.'))) {
      const card = img.closest('[data-cy="reference-image-card"]');
      if (card) {
        const closeBtn = card.querySelector('button'); 
        if (closeBtn) {
          closeBtn.click();
          await sleep(500);
        }
      }
    }
  }
}

async function replaceReferenceImage(imageUrl, refImageNum, targetElement) {
  // 1. Clear existing reference image with this name
  await clearReferenceImage(refImageNum);

  // 2. Fetch the newly generated image and paste it
  try {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const file = new File([blob], `@img${refImageNum}.jpg`, { type: blob.type || 'image/jpeg' });
    
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    
    if (targetElement) {
      if (targetElement.focus) targetElement.focus();
      
      const isDropZone = targetElement.getAttribute('data-cy') === 'reference-add-button';
      
      if (!isDropZone) {
        const pasteEvent = new ClipboardEvent('paste', {
          clipboardData: dataTransfer,
          bubbles: true,
          cancelable: true
        });
        targetElement.dispatchEvent(pasteEvent);
      } else {
        const dragEnterEvent = new DragEvent('dragenter', {
          dataTransfer: dataTransfer,
          bubbles: true,
          cancelable: true
        });
        targetElement.dispatchEvent(dragEnterEvent);
        
        const dragOverEvent = new DragEvent('dragover', {
          dataTransfer: dataTransfer,
          bubbles: true,
          cancelable: true
        });
        targetElement.dispatchEvent(dragOverEvent);
        
        const dropEvent = new DragEvent('drop', {
          dataTransfer: dataTransfer,
          bubbles: true,
          cancelable: true
        });
        targetElement.dispatchEvent(dropEvent);
      }
      
      await sleep(2000); // Wait for upload
    }
  } catch (err) {
    console.error('Failed to replace reference image:', err);
  }
}

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
    if (currentStepAborted) throw new Error('Aborted by user');
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
    if (currentStepAborted) throw new Error('Aborted by user');
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
