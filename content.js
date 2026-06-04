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
  await reportProgress('syncing references');

  const promptTags = extractPromptTags(promptText);
  const assignedPromptTags = await syncReferenceImagesForPrompt(
    promptTags,
    uploadedReferenceImages,
    locationRefNum,
    promptNumber,
    promptInputSelector
  );
  let finalPromptText = remapPromptTags(promptText, assignedPromptTags);

  try {
    finalPromptText = await enrichPromptWithNamedReferences(finalPromptText, uploadedReferenceImages, promptInputSelector);
  } catch (error) {
    console.warn('Skipping named reference enrichment for this prompt:', error);
  }


  if (currentStepAborted) throw new Error('Aborted by user');
  const clearBtn = document.querySelector(clearBtnSelector);
  if (clearBtn && !clearBtn.disabled) {
    clearBtn.click();
    await sleep(500);
  }

  if (currentStepAborted) throw new Error('Aborted by user');
  const promptInput = await waitForPromptInput(promptInputSelector, 15000, 250);
  if (!promptInput) throw new Error('Prompt input not found');

  await reportProgress('writing prompt');
  await setPromptEditorText(promptInput, finalPromptText);

  await sleep(1000);

  const promptTextAfterInsert = getPromptEditorText(promptInput);
  if (!promptTextAfterInsert || promptTextAfterInsert.length < Math.min(10, finalPromptText.length)) {
    throw new Error('Prompt text was not inserted into Magnific');
  }

  const previousFirstItem = document.querySelector(feedItemSelector);
  const previousItemId = previousFirstItem ? previousFirstItem.getAttribute('data-item') : null;

  if (currentStepAborted) throw new Error('Aborted by user');
  await reportProgress('waiting for generate button');
  const generateBtn = await waitForEnabledElement(generateBtnSelector, 15000, 250);
  if (!generateBtn) throw new Error('Generate button not found');
  if (isElementDisabled(generateBtn)) {
    throw new Error('Generate button is disabled after prompt insertion');
  }

  await reportProgress('starting generation');
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
  await reportProgress('opening result');
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
    filename: `${promptNumber}.png`,
    promptNumber
  });

  if (!prepareResponse || !prepareResponse.success) {
    throw new Error('Failed to prepare download interception');
  }

  await reportProgress('downloading image');
  exportBtn.click();
  const downloadResponse = await waitForDownloadCompletion();
  if (!downloadResponse || !downloadResponse.success) {
    throw new Error(downloadResponse && downloadResponse.error ? downloadResponse.error : 'Download did not complete');
  }

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
    if (!image || !image.tag) continue;
    uploadedReferenceMap.set(normalizeTag(image.tag), image);
  }

  for (const promptTag of promptTags) {
    if (currentStepAborted) throw new Error('Aborted by user');

    const matchedReference = uploadedReferenceMap.get(promptTag);
    if (matchedReference) {
      const assignedTag = await addReferenceImageFromReference(
        matchedReference,
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

async function enrichPromptWithNamedReferences(promptText, uploadedReferenceImages, promptInputSelector) {
  const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sortedReferences = [...uploadedReferenceImages]
    .filter((img) => img && img.id && img.name && img.name.length >= 2)
    .sort((a, b) => b.name.length - a.name.length);

  if (!sortedReferences.length) {
    return promptText;
  }

  const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\band\b/g, ' ').replace(/\s+/g, ' ').trim();
  const getWords = (str) => new Set(str.split(' ').filter(Boolean));
  const getOverlap = (s1, s2) => {
    const w1 = getWords(s1);
    const w2 = getWords(s2);
    let count = 0;
    for (const w of w1) {
      if (w2.has(w)) count += 1;
    }
    return count;
  };

  let enrichedPromptText = promptText;
  const promptNorm = normalize(enrichedPromptText);
  const matches = enrichedPromptText.match(/([A-Z][a-zA-Z0-9\s.\'-]+ \([^)]+\))/g) || [];
  const matchedStringsToRefs = new Map();

  for (const matchText of matches) {
    const matchNorm = normalize(matchText);
    let bestRef = null;
    let bestScore = -1;

    for (const ref of sortedReferences) {
      const refNorm = normalize(ref.name);
      const overlap = getOverlap(matchNorm, refNorm);
      const refWordCount = getWords(refNorm).size || 1;

      let score = overlap;
      if (matchNorm === refNorm || matchNorm.includes(refNorm) || refNorm.includes(matchNorm)) {
        score += 100;
      }

      const baseNameMatch = refNorm.match(/^([a-z0-9]+)/);
      const baseName = baseNameMatch ? baseNameMatch[1] : refNorm.split(' ')[0];

      if (matchNorm.includes(baseName) && (overlap / refWordCount >= 0.5) && score > bestScore) {
        bestScore = score;
        bestRef = ref;
      }
    }

    if (bestRef) {
      matchedStringsToRefs.set(matchText, bestRef);
    }
  }

  for (const ref of sortedReferences) {
    if (Array.from(matchedStringsToRefs.values()).includes(ref)) {
      continue;
    }

    const refNorm = normalize(ref.name);
    if (promptNorm.includes(refNorm)) {
      matchedStringsToRefs.set(ref.name, ref);
    }
  }

  for (const [exactString, ref] of matchedStringsToRefs.entries()) {
    const regex = new RegExp(`(?<!as\\s+)(${escapeRegExp(exactString)})`, 'gi');
    let isReplaced = false;
    const nextPromptText = enrichedPromptText.replace(regex, (matchedText) => {
      isReplaced = true;
      return `[TEMP_TAG] as ${matchedText}`;
    });

    if (!isReplaced) {
      continue;
    }

    const assignedTag = await addReferenceImageFromReference(
      ref,
      `${ref.name.substring(0, 30).replace(/[^a-zA-Z0-9_-]/g, '')}.png`,
      promptInputSelector
    );

    if (assignedTag) {
      enrichedPromptText = nextPromptText.replace(/\[TEMP_TAG\]/g, assignedTag);
    }
  }

  return enrichedPromptText;
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

function waitForDownloadCompletion() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error('Timed out waiting for download completion'));
    }, 120000);

    chrome.runtime.sendMessage({ action: 'wait_for_download' }, (response) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);

      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(response);
    });
  });
}

async function waitForEnabledElement(selector, timeoutMs, pollMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (currentStepAborted) {
      throw new Error('Aborted by user');
    }

    const element = document.querySelector(selector);
    if (element && !isElementDisabled(element)) {
      return element;
    }

    await sleep(pollMs);
  }

  return document.querySelector(selector);
}

async function waitForPromptInput(primarySelector, timeoutMs, pollMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (currentStepAborted) {
      throw new Error('Aborted by user');
    }

    const promptInput = findPromptInput(primarySelector);
    if (promptInput) {
      return promptInput;
    }

    await sleep(pollMs);
  }

  return findPromptInput(primarySelector);
}

function findPromptInput(primarySelector) {
  const selectors = [
    primarySelector,
    '[data-cy="prompt-editor"] [contenteditable="true"]',
    '[data-cy="prompt-input"] [contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][data-lexical-editor="true"]',
    'div[contenteditable="true"]'
  ];

  let bestMatch = null;
  let bestScore = -1;

  for (const selector of selectors) {
    const candidates = Array.from(document.querySelectorAll(selector));
    for (const candidate of candidates) {
      const score = scorePromptInput(candidate);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = candidate;
      }
    }
  }

  return bestScore >= 20 ? bestMatch : null;
}

function scorePromptInput(element) {
  if (!element || isElementDisabled(element)) {
    return -1;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width < 40 || rect.height < 20) {
    return -1;
  }

  const style = window.getComputedStyle(element);
  if (!style || style.visibility === 'hidden' || style.display === 'none') {
    return -1;
  }

  let score = 20;

  const text = [
    element.getAttribute('aria-label') || '',
    element.getAttribute('data-placeholder') || '',
    element.getAttribute('placeholder') || ''
  ].join(' ').toLowerCase();

  if (text.includes('prompt')) {
    score += 80;
  }

  if (element.classList.contains('dynamic-prompt')) {
    score += 100;
  }

  if (element.getAttribute('role') === 'textbox') {
    score += 20;
  }

  if (element.getAttribute('data-lexical-editor') === 'true') {
    score += 20;
  }

  if (document.querySelector('button[data-cy="generate-button"]')) {
    score += 10;
  }

  score += Math.min(30, Math.round((rect.width * rect.height) / 10000));

  return score;
}

function isElementDisabled(element) {
  if (!element) {
    return true;
  }

  return Boolean(
    element.disabled ||
    element.getAttribute('aria-disabled') === 'true' ||
    element.matches('[disabled], [aria-disabled="true"]')
  );
}

async function resolveReferenceImage(referenceImage) {
  if (!referenceImage) {
    return null;
  }

  if (referenceImage.dataUrl) {
    return referenceImage;
  }

  const imageId = String(referenceImage.id || '').trim();
  if (!imageId) {
    return null;
  }

  const response = await sendRuntimeMessage({
    action: 'get_reference_image_data',
    imageId
  });

  if (!response || !response.success || !response.image || !response.image.dataUrl) {
    throw new Error(response && response.error ? response.error : 'Failed to resolve reference image');
  }

  return response.image;
}

function getPromptEditorText(promptInput) {
  if (!promptInput) {
    return '';
  }

  return String(
    promptInput.innerText ||
    promptInput.textContent ||
    promptInput.getAttribute('value') ||
    ''
  ).trim();
}

async function setPromptEditorText(promptInput, text) {
  const value = String(text || '');

  promptInput.focus();

  if (document.execCommand) {
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    document.execCommand('insertText', false, value);
  }

  if (getPromptEditorText(promptInput) === value) {
    dispatchPromptInputEvents(promptInput);
    return;
  }

  promptInput.innerHTML = '';
  promptInput.textContent = value;
  dispatchPromptInputEvents(promptInput);

  await sleep(100);

  if (getPromptEditorText(promptInput) === value) {
    return;
  }

  promptInput.innerHTML = '';
  const textNode = document.createTextNode(value);
  promptInput.appendChild(textNode);
  dispatchPromptInputEvents(promptInput);
}

function dispatchPromptInputEvents(promptInput) {
  promptInput.dispatchEvent(new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    data: promptInput.textContent || '',
    inputType: 'insertText'
  }));

  promptInput.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    cancelable: true,
    data: promptInput.textContent || '',
    inputType: 'insertText'
  }));

  promptInput.dispatchEvent(new Event('change', {
    bubbles: true
  }));
}

async function reportProgress(stage) {
  try {
    await sendRuntimeMessage({ action: 'progress_update', stage });
  } catch (error) {
    console.debug('Progress update failed:', error);
  }
}

async function addReferenceImageFromReference(referenceImage, fileName, promptInputSelector) {
  const resolvedReference = await resolveReferenceImage(referenceImage);
  if (!resolvedReference || !resolvedReference.dataUrl) {
    return null;
  }

  return addReferenceImageFromUrl(resolvedReference.dataUrl, fileName, promptInputSelector);
}
