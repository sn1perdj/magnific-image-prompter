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
    sendResponse({ ok: true, isExecuting });
    return;
  }

  if (message.action === 'execute_step') {
    if (isExecuting) {
      sendResponse({ success: false, error: 'Already executing' });
      return true;
    }

    isExecuting = true;
    currentStepAborted = false;

    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      chrome.runtime.sendMessage({ action: 'keep_alive_ping' }).catch(() => {});
    }, 10000);

    executeWorkflowStep(
      message.prompt,
      message.promptNumber,
      Array.isArray(message.uploadedReferenceImages) ? message.uploadedReferenceImages : [],
      message.locationRefNum || null
    )
      .then(() => {
        isExecuting = false;
        clearInterval(pingInterval);
        sendResponse({ success: true });
        chrome.runtime.sendMessage({ action: 'step_completed', success: true });
      })
      .catch((err) => {
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

    return true;
  }
});

async function executeWorkflowStep(promptText, promptNumber, uploadedReferenceImages, locationRefNum) {
  const promptInputSelector = 'div[contenteditable="true"].dynamic-prompt';
  const clearBtnSelector = 'button[data-cy="clear-prompt-button"]';
  const generateBtnSelector = 'button[data-cy="generate-button"]';
  const loadingSelector = '[data-cy="thumbnail-loading"]';
  const imageSelector = 'img.feed-image-loaded';
  const feedItemSelector = 'div[data-cy="main-feed-item"]';

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
  const initialCloseBtn = document.querySelector('button[aria-label="Close"], button[aria-label="close"]');
  if (initialCloseBtn) initialCloseBtn.click();
  await sleep(500);

  const promptTags = extractPromptTags(promptText);
  const assignedPromptTags = await syncReferenceImagesForPrompt(
    promptTags,
    uploadedReferenceImages,
    locationRefNum,
    promptNumber,
    promptInputSelector
  );
  const finalPromptText = remapPromptTags(promptText, assignedPromptTags);

  if (currentStepAborted) throw new Error('Aborted by user');
  const clearBtn = document.querySelector(clearBtnSelector);
  if (clearBtn && !clearBtn.disabled) {
    clearBtn.click();
    await sleep(500);
  }

  if (currentStepAborted) throw new Error('Aborted by user');
  const promptInput = document.querySelector(promptInputSelector);
  if (!promptInput) throw new Error('Prompt input not found');

  promptInput.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);
  document.execCommand('insertText', false, finalPromptText);

  await sleep(1000);

  const previousFirstItem = document.querySelector(feedItemSelector);
  const previousItemId = previousFirstItem ? previousFirstItem.getAttribute('data-item') : null;

  if (currentStepAborted) throw new Error('Aborted by user');
  const generateBtn = document.querySelector(generateBtnSelector);
  if (!generateBtn) throw new Error('Generate button not found');
  generateBtn.click();

  let thumbnailImg = null;
  let newFeedElement = null;

  for (let i = 0; i < 3600; i += 1) {
    if (currentStepAborted) throw new Error('Aborted by user');

    const currentFirstItem = document.querySelector(feedItemSelector);
    if (currentFirstItem) {
      const currentId = currentFirstItem.getAttribute('data-item');
      if (currentId && currentId !== previousItemId) {
        const img = currentFirstItem.querySelector('img.feed-image-loaded, img.feed-image-reveal');

        let isActuallyLoading = false;
        const loadingEl = currentFirstItem.querySelector(loadingSelector);
        if (loadingEl) {
          const style = window.getComputedStyle(loadingEl);
          if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
            isActuallyLoading = true;
          }
        }

        if (img && !isActuallyLoading) {
          thumbnailImg = img;
          newFeedElement = currentFirstItem;
          break;
        }
      }
    }

    await sleep(1000);
  }

  if (!thumbnailImg || !newFeedElement) {
    throw new Error('Timeout waiting for the generated image to finish and appear');
  }

  const simulateClick = (element) => {
    const mouseEventInit = { bubbles: true, cancelable: true, view: window };
    element.dispatchEvent(new MouseEvent('mousedown', mouseEventInit));
    element.dispatchEvent(new MouseEvent('mouseup', mouseEventInit));
    element.click();
  };

  const clickableContainer = newFeedElement.querySelector('[data-cy="image-creation-feed-item"]') || newFeedElement;
  simulateClick(clickableContainer);
  await sleep(2500);

  let exportBtn = null;
  for (let i = 0; i < 15; i += 1) {
    if (currentStepAborted) throw new Error('Aborted by user');
    exportBtn = document.querySelector('button[data-cy="download-button-export"], #export-button');
    if (exportBtn) break;
    await sleep(500);
  }

  if (!exportBtn) {
    throw new Error('Could not find the export button in the full viewer');
  }

  const prepareResponse = await sendRuntimeMessage({
    action: 'prepare_download',
    filename: `${promptNumber}.png`
  });

  if (!prepareResponse || !prepareResponse.success) {
    throw new Error('Failed to prepare download interception');
  }

  exportBtn.click();
  await sleep(1500);

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
  const closeBtn = document.querySelector('button[aria-label="Close"], button[aria-label="close"]');
  if (closeBtn) closeBtn.click();

  await sleep(2500);
}

function extractPromptTags(promptText) {
  const matches = promptText.match(/@[a-z0-9_-]+/gi) || [];
  const orderedTags = [];
  const seen = new Set();

  for (const match of matches) {
    const normalizedTag = normalizeTag(match);
    if (!seen.has(normalizedTag)) {
      seen.add(normalizedTag);
      orderedTags.push(normalizedTag);
    }
  }

  return orderedTags;
}

function normalizeTag(tag) {
  return String(tag || '').trim().toLowerCase();
}

function remapPromptTags(promptText, assignedPromptTags) {
  if (!assignedPromptTags || assignedPromptTags.size === 0) {
    return promptText;
  }

  return promptText.replace(/@[a-z0-9_-]+/gi, (match) => {
    const normalizedTag = normalizeTag(match);
    return assignedPromptTags.get(normalizedTag) || match;
  });
}

async function syncReferenceImagesForPrompt(promptTags, uploadedReferenceImages, locationRefNum, promptNumber, promptInputSelector) {
  await clearAllReferenceImages();

  const assignedPromptTags = new Map();

  if (!promptTags.length) {
    return assignedPromptTags;
  }

  const uploadedReferenceMap = new Map();
  for (const image of uploadedReferenceImages) {
    if (!image || !image.tag || !image.dataUrl) continue;
    uploadedReferenceMap.set(normalizeTag(image.tag), image);
  }

  const locationRefTag = locationRefNum ? normalizeTag(`@img${locationRefNum}`) : null;

  for (const promptTag of promptTags) {
    if (currentStepAborted) throw new Error('Aborted by user');

    if (locationRefTag && promptTag === locationRefTag) {
      if (promptNumber > 1) {
        const latestGeneratedImageSrc = getLatestGeneratedImageSrc();
        if (latestGeneratedImageSrc) {
          const assignedTag = await addReferenceImageFromUrl(
            latestGeneratedImageSrc,
            `${promptTag}.jpg`,
            promptInputSelector
          );
          if (assignedTag) {
            assignedPromptTags.set(promptTag, assignedTag);
          }
        }
      }
      continue;
    }

    const matchedReference = uploadedReferenceMap.get(promptTag);
    if (matchedReference) {
      const assignedTag = await addReferenceImageFromUrl(
        matchedReference.dataUrl,
        `${promptTag}.png`,
        promptInputSelector
      );
      if (assignedTag) {
        assignedPromptTags.set(promptTag, assignedTag);
      }
    }
  }

  return assignedPromptTags;
}

function getLatestGeneratedImageSrc() {
  const images = document.querySelectorAll('img.feed-image-loaded, img.feed-image-reveal');
  if (!images.length) {
    return null;
  }

  return images[0].src || null;
}

async function clearAllReferenceImages() {
  for (let pass = 0; pass < 10; pass += 1) {
    const cards = Array.from(document.querySelectorAll('[data-cy="reference-image-card"]'));
    if (cards.length === 0) {
      return;
    }

    let removedAny = false;
    for (const card of cards) {
      const closeBtn = card.querySelector('button');
      if (closeBtn) {
        closeBtn.click();
        removedAny = true;
        await sleep(300);
      }
    }

    if (!removedAny) {
      return;
    }

    await sleep(500);
  }
}

function getReferenceTarget(promptInputSelector) {
  return document.querySelector('div[data-cy="reference-add-button"]') || document.querySelector(promptInputSelector);
}

async function addReferenceImageFromUrl(imageUrl, fileName, promptInputSelector) {
  try {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    return await addReferenceImageFromBlob(blob, fileName, promptInputSelector);
  } catch (err) {
    console.error('Failed to add reference image:', err);
    return null;
  }
}

async function addReferenceImageFromBlob(blob, fileName, promptInputSelector) {
  const targetElement = getReferenceTarget(promptInputSelector);
  if (!targetElement) {
    throw new Error('Reference target not found');
  }

  const existingCards = Array.from(document.querySelectorAll('[data-cy="reference-image-card"]'));
  const existingCardCount = existingCards.length;

  const file = new File([blob], fileName, { type: blob.type || 'image/png' });
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);

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
      dataTransfer,
      bubbles: true,
      cancelable: true
    });
    targetElement.dispatchEvent(dragEnterEvent);

    const dragOverEvent = new DragEvent('dragover', {
      dataTransfer,
      bubbles: true,
      cancelable: true
    });
    targetElement.dispatchEvent(dragOverEvent);

    const dropEvent = new DragEvent('drop', {
      dataTransfer,
      bubbles: true,
      cancelable: true
    });
    targetElement.dispatchEvent(dropEvent);
  }

  await sleep(2000);

  return await waitForAssignedReferenceTag(existingCardCount);
}

async function waitForAssignedReferenceTag(previousCardCount) {
  for (let i = 0; i < 20; i += 1) {
    const cards = Array.from(document.querySelectorAll('[data-cy="reference-image-card"]'));
    if (cards.length > previousCardCount) {
      const newCard = cards[cards.length - 1];
      const extractedTag = extractReferenceTagFromCard(newCard);
      if (extractedTag) {
        return extractedTag;
      }

      return `@img${cards.length}`;
    }

    await sleep(300);
  }

  const cards = Array.from(document.querySelectorAll('[data-cy="reference-image-card"]'));
  if (cards.length > previousCardCount) {
    const newCard = cards[cards.length - 1];
    return extractReferenceTagFromCard(newCard) || `@img${cards.length}`;
  }

  return null;
}

function extractReferenceTagFromCard(card) {
  if (!card) {
    return null;
  }

  const ariaLabelMatch = normalizeTag(card.getAttribute('aria-label')).match(/@img\d+/i);
  if (ariaLabelMatch) {
    return normalizeTag(ariaLabelMatch[0]);
  }

  const textMatch = normalizeTag(card.textContent).match(/@img\d+/i);
  if (textMatch) {
    return normalizeTag(textMatch[0]);
  }

  const datasetValues = Object.values(card.dataset || {}).join(' ');
  const datasetMatch = normalizeTag(datasetValues).match(/@img\d+/i);
  if (datasetMatch) {
    return normalizeTag(datasetMatch[0]);
  }

  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
