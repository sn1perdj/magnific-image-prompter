document.addEventListener('DOMContentLoaded', () => {
  const REFERENCE_IMAGE_DB_NAME = 'magnificAutomatorDb';
  const REFERENCE_IMAGE_STORE = 'referenceImages';
  const SAVED_REFERENCE_IMAGES_KEY = 'saved-images';
  const SAVED_CHARACTER_REFERENCES_KEY = 'saved-character-images';
  const SAVED_LOCATION_REFERENCES_KEY = 'saved-location-images';
  const ACTIVE_WORKFLOW_IMAGES_KEY = 'active-workflow-images';
  const MAX_REFERENCE_IMAGE_EDGE = 1600;
  const MAX_REFERENCE_THUMB_EDGE = 240;
  const REFERENCE_IMAGE_QUALITY = 0.82;
  const MAX_RENDERED_IMAGES_PER_SECTION = 40;

  const mainView = document.getElementById('mainView');
  const settingsView = document.getElementById('settingsView');

  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const backBtn = document.getElementById('backBtn');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');

  const sheetLinkInput = document.getElementById('sheetLink');
  const startFromInput = document.getElementById('startFrom');
  const singlePromptInput = document.getElementById('singlePrompt');
  const locationRefNumInput = document.getElementById('locationRefNum');
  const addCharacterImagesBtn = document.getElementById('addCharacterImagesBtn');
  const characterUploadInput = document.getElementById('characterUploadInput');
  const importCharacterSheetBtn = document.getElementById('importCharacterSheetBtn');
  const characterImportTagList = document.getElementById('characterImportTagList');
  const imageCharacterSection = document.getElementById('imageCharacterSection');

  const addLocationImagesBtn = document.getElementById('addLocationImagesBtn');
  const locationUploadInput = document.getElementById('locationUploadInput');
  const importLocationSheetBtn = document.getElementById('importLocationSheetBtn');
  const locationImportTagList = document.getElementById('locationImportTagList');
  const imageLocationSection = document.getElementById('imageLocationSection');

  const subTabButtons = document.querySelectorAll('.sub-tab');

  const clearLocationsBtn = document.getElementById('clearLocationsBtn');
  const clearCharactersBtn = document.getElementById('clearCharactersBtn');
  const clearImportCharactersBtn = document.getElementById('clearImportCharactersBtn');
  const clearImportLocationsBtn = document.getElementById('clearImportLocationsBtn');

  const statusBox = document.getElementById('status');

  const TAB_COLUMNS = {
    character: { index: 0, letter: 'E' },
    location: { index: 0, letter: 'F' },
    image: { index: 0, letter: 'G' }
  };

  const tabButtons = document.querySelectorAll('.tab:not(.sub-tab)');
  const locationRefSection = document.getElementById('locationRefSection');
  const imageManagerSection = document.getElementById('imageManagerSection');
  const locationManagerSection = document.getElementById('locationManagerSection');
  const locationTagList = document.getElementById('locationTagList');
  const characterManagerSection = document.getElementById('characterManagerSection');
  const characterTagList = document.getElementById('characterTagList');

  let activeTab = 'character';
  let currentSheetLink = '';
  let uploadedReferenceImages = [];
  let capturedCharacterReferences = [];
  let capturedLocationReferences = [];

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
    const db = await openReferenceImageDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(REFERENCE_IMAGE_STORE, 'readwrite');
      const store = transaction.objectStore(REFERENCE_IMAGE_STORE);
      store.put(images, ACTIVE_WORKFLOW_IMAGES_KEY);

      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onabort = () => reject(transaction.error || new Error('Failed to persist workflow images'));
      transaction.onerror = () => reject(transaction.error || new Error('Failed to persist workflow images'));
    });
  }

  async function loadReferenceImagesFromDb() {
    const db = await openReferenceImageDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(REFERENCE_IMAGE_STORE, 'readonly');
      const store = transaction.objectStore(REFERENCE_IMAGE_STORE);
      const request = store.get(SAVED_REFERENCE_IMAGES_KEY);

      request.onsuccess = () => {
        resolve(Array.isArray(request.result) ? request.result : []);
      };
      request.onerror = () => reject(request.error || new Error('Failed to load saved reference images'));
      transaction.oncomplete = () => db.close();
      transaction.onabort = () => reject(transaction.error || new Error('Failed to load saved reference images'));
    });
  }

  async function saveReferenceImagesToDb(images) {
    const db = await openReferenceImageDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(REFERENCE_IMAGE_STORE, 'readwrite');
      const store = transaction.objectStore(REFERENCE_IMAGE_STORE);
      store.put(images, SAVED_REFERENCE_IMAGES_KEY);

      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onabort = () => reject(transaction.error || new Error('Failed to save reference images'));
      transaction.onerror = () => reject(transaction.error || new Error('Failed to save reference images'));
    });
  }

  async function loadCharacterReferencesFromDb() {
    const db = await openReferenceImageDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(REFERENCE_IMAGE_STORE, 'readonly');
      const store = transaction.objectStore(REFERENCE_IMAGE_STORE);
      const request = store.get(SAVED_CHARACTER_REFERENCES_KEY);

      request.onsuccess = () => {
        resolve(Array.isArray(request.result) ? request.result : []);
      };
      request.onerror = () => reject(request.error || new Error('Failed to load saved character references'));
      transaction.oncomplete = () => db.close();
      transaction.onabort = () => reject(transaction.error || new Error('Failed to load saved character references'));
    });
  }

  async function saveCharacterReferencesToDb(images) {
    const db = await openReferenceImageDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(REFERENCE_IMAGE_STORE, 'readwrite');
      const store = transaction.objectStore(REFERENCE_IMAGE_STORE);
      store.put(images, SAVED_CHARACTER_REFERENCES_KEY);

      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onabort = () => reject(transaction.error || new Error('Failed to save character references'));
      transaction.onerror = () => reject(transaction.error || new Error('Failed to save character references'));
    });
  }

  async function loadLocationReferencesFromDb() {
    const db = await openReferenceImageDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(REFERENCE_IMAGE_STORE, 'readonly');
      const store = transaction.objectStore(REFERENCE_IMAGE_STORE);
      const request = store.get(SAVED_LOCATION_REFERENCES_KEY);

      request.onsuccess = () => {
        resolve(Array.isArray(request.result) ? request.result : []);
      };
      request.onerror = () => reject(request.error || new Error('Failed to load saved location references'));
      transaction.oncomplete = () => db.close();
      transaction.onabort = () => reject(transaction.error || new Error('Failed to load saved location references'));
    });
  }

  async function saveLocationReferencesToDb(images) {
    const db = await openReferenceImageDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(REFERENCE_IMAGE_STORE, 'readwrite');
      const store = transaction.objectStore(REFERENCE_IMAGE_STORE);
      store.put(images, SAVED_LOCATION_REFERENCES_KEY);

      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onabort = () => reject(transaction.error || new Error('Failed to save location references'));
      transaction.onerror = () => reject(transaction.error || new Error('Failed to save location references'));
    });
  }

  async function saveInputs() {
    await Promise.all([
      new Promise((resolve, reject) => {
        chrome.storage.local.set({
          savedStartFrom: startFromInput.value,
          savedSinglePrompt: singlePromptInput.value,
          savedLocationRefNum: locationRefNumInput.value,
          savedActiveTab: activeTab,
          savedActiveSubTab: document.querySelector('.sub-tab.active')?.getAttribute('data-subtab') || 'image-character'
        }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          resolve();
        });
      }),
      saveReferenceImagesToDb(uploadedReferenceImages),
      saveCharacterReferencesToDb(capturedCharacterReferences),
      saveLocationReferencesToDb(capturedLocationReferences)
    ]);
  }

  function setActiveTab(tabName) {
    activeTab = tabName;
    tabButtons.forEach((button) => {
      button.classList.toggle('active', button.getAttribute('data-tab') === tabName);
    });

    const isImageTab = tabName === 'image';
    const isCharacterTab = tabName === 'character';
    const isLocationTab = tabName === 'location';
    
    locationRefSection.style.display = isLocationTab ? 'flex' : 'none';
    locationManagerSection.style.display = isLocationTab ? 'flex' : 'none';
    
    imageManagerSection.style.display = isImageTab ? 'flex' : 'none';
    characterManagerSection.style.display = isCharacterTab ? 'flex' : 'none';
  }

  function normalizeTag(value, fallbackTag) {
    let normalized = (value || '').trim().toLowerCase();

    if (!normalized) {
      return fallbackTag;
    }

    normalized = normalized.replace(/\s+/g, '');
    normalized = normalized.replace(/^@+/, '');
    normalized = normalized.replace(/[^a-z0-9_-]/g, '');

    if (!normalized) {
      return fallbackTag;
    }

    return `@${normalized}`;
  }

  function extractReferenceNameFromPromptText(type, promptText, fallbackName = '') {
    const rawPrompt = String(promptText || '').trim();
    if (!rawPrompt) {
      return fallbackName;
    }

    if (type === 'character') {
      const characterMatch = rawPrompt.match(/([A-Z][a-zA-Z0-9\s.\'-]+ \([^)]+\))/);
      if (characterMatch) {
        return characterMatch[1].trim();
      }
    }

    const simplifiedPrompt = rawPrompt
      .replace(/@\w+\s+as\s+/gi, '')
      .replace(/@\w+/gi, '')
      .trim();

    if (type === 'location') {
      const bracketMatch = simplifiedPrompt.match(/^\[([^\]]+)\]/);
      if (bracketMatch) {
        return bracketMatch[1].trim();
      }

      const leadingLocationMatch = simplifiedPrompt.match(/^([^:;([|]{3,80}?)(?:\s*(?:\(|\[|:|;|,)|$)/);
      if (leadingLocationMatch) {
        return leadingLocationMatch[1].trim();
      }
    }

    const extractedName = simplifiedPrompt
      .split(/[:;]/)[0]
      .replace(/\s*\([^)]*\)\s*$/, '')
      .replace(/^\[|\]$/g, '')
      .trim();

    return extractedName || fallbackName;
  }

  function getNextDefaultTag() {
    const usedTags = new Set(
      uploadedReferenceImages.map((image) => normalizeTag(image.tag, '@img1'))
    );

    let candidateNumber = 1;
    while (usedTags.has(`@img${candidateNumber}`)) {
      candidateNumber += 1;
    }

    return `@img${candidateNumber}`;
  }

  function getNextCharacterTag() {
    const usedTags = new Set(
      capturedCharacterReferences.map((image) => normalizeTag(image.tag, '@img1'))
    );

    let candidateNumber = 1;
    while (usedTags.has(`@img${candidateNumber}`)) {
      candidateNumber += 1;
    }

    return `@img${candidateNumber}`;
  }

  function getNextLocationTag() {
    const usedTags = new Set(
      capturedLocationReferences.map((image) => normalizeTag(image.tag, '@img1'))
    );

    let candidateNumber = 1;
    while (usedTags.has(`@img${candidateNumber}`)) {
      candidateNumber += 1;
    }

    return `@img${candidateNumber}`;
  }

  function renderCharacterReferences() {
    characterTagList.innerHTML = '';

    if (capturedCharacterReferences.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'image-tag-empty';
      emptyState.textContent = 'No character references auto-captured yet.';
      characterTagList.appendChild(emptyState);
      return;
    }

    capturedCharacterReferences.forEach((image, index) => {
      const item = document.createElement('div');
      item.className = 'image-tag-item';

      const thumb = document.createElement('img');
      thumb.className = 'image-thumb';
      thumb.src = image.thumbDataUrl || image.dataUrl;
      thumb.alt = image.tag;

      const meta = document.createElement('div');
      meta.className = 'image-tag-meta';

      const nameLabel = document.createElement('div');
      nameLabel.className = 'image-name';
      nameLabel.textContent = image.name;
      nameLabel.style.fontWeight = '500';

      meta.appendChild(nameLabel);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-image-btn';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        capturedCharacterReferences.splice(index, 1);
        renderCharacterReferences();
        void saveInputs();
      });

      item.appendChild(thumb);
      item.appendChild(meta);
      item.appendChild(removeBtn);
      characterTagList.appendChild(item);
    });
  }

  function renderLocationReferences() {
    locationTagList.innerHTML = '';

    if (capturedLocationReferences.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'image-tag-empty';
      emptyState.textContent = 'No location references auto-captured yet.';
      locationTagList.appendChild(emptyState);
      return;
    }

    capturedLocationReferences.forEach((image, index) => {
      const item = document.createElement('div');
      item.className = 'image-tag-item';

      const thumb = document.createElement('img');
      thumb.className = 'image-thumb';
      thumb.src = image.thumbDataUrl || image.dataUrl;
      thumb.alt = image.tag;

      const meta = document.createElement('div');
      meta.className = 'image-tag-meta';

      const nameLabel = document.createElement('div');
      nameLabel.className = 'image-name';
      nameLabel.textContent = image.name;
      nameLabel.style.fontWeight = '500';

      meta.appendChild(nameLabel);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-image-btn';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        capturedLocationReferences.splice(index, 1);
        renderLocationReferences();
        void saveInputs();
      });

      item.appendChild(thumb);
      item.appendChild(meta);
      item.appendChild(removeBtn);
      locationTagList.appendChild(item);
    });
  }

  function renderUploadedImages() {
    const characterImages = uploadedReferenceImages.filter(img => img.type === 'character' || !img.type);
    const locationImages = uploadedReferenceImages.filter(img => img.type === 'location');

    renderSubTagList(characterImportTagList, characterImages, 'character');
    renderSubTagList(locationImportTagList, locationImages, 'location');
  }

  function renderSubTagList(container, images, type) {
    container.innerHTML = '';
    if (images.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'image-tag-empty';
      emptyState.textContent = `No ${type} references added yet.`;
      container.appendChild(emptyState);
      return;
    }

    if (images.length > MAX_RENDERED_IMAGES_PER_SECTION) {
      const notice = document.createElement('div');
      notice.className = 'image-tag-empty';
      notice.textContent = `Showing first ${MAX_RENDERED_IMAGES_PER_SECTION} of ${images.length} ${type} references to keep the popup responsive.`;
      container.appendChild(notice);
    }

    images.slice(0, MAX_RENDERED_IMAGES_PER_SECTION).forEach((image) => {
      const index = uploadedReferenceImages.indexOf(image);
      const item = document.createElement('div');
      item.className = 'image-tag-item';

      const thumb = document.createElement('img');
      thumb.className = 'image-thumb';
      thumb.src = image.thumbDataUrl || image.dataUrl;
      thumb.alt = image.tag;

      const meta = document.createElement('div');
      meta.className = 'image-tag-meta';

      const imageName = document.createElement('div');
      imageName.className = 'image-name';
      imageName.textContent = image.name || `Reference ${index + 1}`;
      imageName.style.fontWeight = '500';

      meta.appendChild(imageName);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-image-btn';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        uploadedReferenceImages.splice(index, 1);
        renderUploadedImages();
        void saveInputs();
      });

      item.appendChild(thumb);
      item.appendChild(meta);
      item.appendChild(removeBtn);
      container.appendChild(item);
    });
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
      reader.readAsDataURL(file);
    });
  }

  function loadImageElement(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to decode image'));
      image.src = src;
    });
  }

  function scaleDimensions(width, height, maxEdge) {
    if (!width || !height || Math.max(width, height) <= maxEdge) {
      return { width, height };
    }

    const ratio = maxEdge / Math.max(width, height);
    return {
      width: Math.max(1, Math.round(width * ratio)),
      height: Math.max(1, Math.round(height * ratio))
    };
  }

  function renderImageToDataUrl(image, maxEdge) {
    const { width, height } = scaleDimensions(image.naturalWidth || image.width, image.naturalHeight || image.height, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d', { alpha: false });
    context.drawImage(image, 0, 0, width, height);

    return canvas.toDataURL('image/jpeg', REFERENCE_IMAGE_QUALITY);
  }

  async function optimizeImageFile(file) {
    const originalDataUrl = await fileToDataUrl(file);

    try {
      const image = await loadImageElement(originalDataUrl);
      return {
        dataUrl: renderImageToDataUrl(image, MAX_REFERENCE_IMAGE_EDGE),
        thumbDataUrl: renderImageToDataUrl(image, MAX_REFERENCE_THUMB_EDGE)
      };
    } catch (error) {
      console.warn(`Falling back to original image for ${file.name}:`, error);
      return {
        dataUrl: originalDataUrl,
        thumbDataUrl: originalDataUrl
      };
    }
  }

  async function handleImageFiles(fileList, type) {
    const files = Array.from(fileList || []);
    if (files.length === 0) {
      return;
    }

    for (const file of files) {
      statusBox.textContent = `Optimizing ${file.name}...`;
      const optimizedImage = await optimizeImageFile(file);
      uploadedReferenceImages.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        tag: getNextDefaultTag(),
        name: file.name,
        type: type,
        dataUrl: optimizedImage.dataUrl,
        thumbDataUrl: optimizedImage.thumbDataUrl
      });
    }

    renderUploadedImages();
    await saveInputs();
    statusBox.textContent = `Added ${files.length} ${type} reference image${files.length === 1 ? '' : 's'}.`;
  }

  function buildUploadedReferencePayload() {
    if (activeTab === 'character') {
      return capturedCharacterReferences.map((image, index) => ({
        id: image.id,
        tag: normalizeTag(image.tag, `@img${index + 1}`),
        name: image.name,
        dataUrl: image.dataUrl
      }));
    } else if (activeTab === 'location') {
      return capturedLocationReferences.map((image, index) => ({
        id: image.id,
        tag: normalizeTag(image.tag, `@img${index + 1}`),
        name: image.name,
        dataUrl: image.dataUrl
      }));
    } else {
      return uploadedReferenceImages.map((image, index) => ({
        id: image.id,
        tag: normalizeTag(image.tag, `@img${index + 1}`),
        name: image.name,
        dataUrl: image.dataUrl,
        thumbDataUrl: image.thumbDataUrl,
        type: image.type
      }));
    }
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      setActiveTab(btn.getAttribute('data-tab'));
      void saveInputs();
    });
  });

  function setActiveSubTab(tabName) {
    subTabButtons.forEach((button) => {
      button.classList.toggle('active', button.getAttribute('data-subtab') === tabName);
    });
    
    imageCharacterSection.style.display = tabName === 'image-character' ? 'block' : 'none';
    imageLocationSection.style.display = tabName === 'image-location' ? 'block' : 'none';
  }

  subTabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      setActiveSubTab(btn.getAttribute('data-subtab'));
      void saveInputs();
    });
  });

  addCharacterImagesBtn.addEventListener('click', () => characterUploadInput.click());
  characterUploadInput.addEventListener('change', async () => {
    try {
      await handleImageFiles(characterUploadInput.files, 'character');
    } finally {
      characterUploadInput.value = '';
    }
  });

  addLocationImagesBtn.addEventListener('click', () => locationUploadInput.click());
  locationUploadInput.addEventListener('change', async () => {
    try {
      await handleImageFiles(locationUploadInput.files, 'location');
    } finally {
      locationUploadInput.value = '';
    }
  });

  importCharacterSheetBtn.addEventListener('click', () => importAndRenameFromSheet('character'));
  importLocationSheetBtn.addEventListener('click', () => importAndRenameFromSheet('location'));

  clearLocationsBtn.addEventListener('click', () => {
    capturedLocationReferences = [];
    renderLocationReferences();
    void saveInputs();
  });

  clearCharactersBtn.addEventListener('click', () => {
    capturedCharacterReferences = [];
    renderCharacterReferences();
    void saveInputs();
  });

  clearImportCharactersBtn.addEventListener('click', () => {
    uploadedReferenceImages = uploadedReferenceImages.filter(img => img.type !== 'character' && img.type !== undefined);
    renderUploadedImages();
    void saveInputs();
  });

  clearImportLocationsBtn.addEventListener('click', () => {
    uploadedReferenceImages = uploadedReferenceImages.filter(img => img.type !== 'location');
    renderUploadedImages();
    void saveInputs();
  });

  async function importAndRenameFromSheet(type) {
    const targetImages = uploadedReferenceImages.filter(img => (type === 'character' ? (img.type === 'character' || !img.type) : img.type === 'location'));
    if (targetImages.length === 0) {
      alert(`No ${type} images to rename.`);
      return;
    }
    
    const colLetter = type === 'character' ? 'E' : 'F';
    const sheetLink = currentSheetLink || sheetLinkInput.value.trim();
    if (!sheetLink || !sheetLink.includes('/d/')) {
      alert('Please configure a valid Google Sheet link in settings first.');
      return;
    }

    statusBox.textContent = `Fetching Column ${colLetter} for renaming...`;
    
    try {
      const sheetIdMatch = sheetLink.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (!sheetIdMatch) throw new Error('Could not extract Sheet ID');
      const sheetId = sheetIdMatch[1];

      const csvUrl = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq`);
      csvUrl.searchParams.set('tqx', 'out:csv');
      csvUrl.searchParams.set('range', `${colLetter}:${colLetter}`);

      const gidMatch = sheetLink.match(/[#&?]gid=([0-9]+)/);
      if (gidMatch) {
        csvUrl.searchParams.set('gid', gidMatch[1]);
      }

      const response = await fetch(csvUrl.toString());
      if (!response.ok) throw new Error('Failed to fetch sheet.');

      const csvText = await response.text();
      const prompts = parseCsvColumn(csvText, 0);

      let renamedCount = 0;
      targetImages.forEach((img) => {
         const numMatch = img.name.match(/^(\d+)/);
         if (numMatch) {
           const num = parseInt(numMatch[1], 10);
           const rowIndex = num - 1;
           if (prompts[rowIndex]) {
             const extractedName = extractReferenceNameFromPromptText(type, prompts[rowIndex], img.name);
             
             if (extractedName) {
               img.name = extractedName;
               renamedCount++;
             }
           }
         }
      });
      
      renderUploadedImages();
      await saveInputs();
      statusBox.textContent = `Renamed ${renamedCount} images from Column ${colLetter}.`;
    } catch (err) {
      alert(`Error importing from sheet: ${err.message}`);
      statusBox.textContent = 'Ready';
    }
  }

  Promise.all([
    new Promise((resolve, reject) => {
      chrome.storage.local.get([
        'magnificSheetLink',
        'savedStartFrom',
        'savedSinglePrompt',
        'savedLocationRefNum',
        'savedActiveTab',
        'savedActiveSubTab',
        'savedUploadedReferenceImages'
      ], (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(result);
      });
    }),
    loadReferenceImagesFromDb().catch(() => []),
    loadCharacterReferencesFromDb().catch(() => []),
    loadLocationReferencesFromDb().catch(() => [])
  ]).then(async ([result, savedImagesFromDb, savedCharacterRefsFromDb, savedLocationRefsFromDb]) => {
    if (result.magnificSheetLink) {
      currentSheetLink = result.magnificSheetLink;
      sheetLinkInput.value = currentSheetLink;
    }

    if (result.savedStartFrom !== undefined) startFromInput.value = result.savedStartFrom;
    if (result.savedSinglePrompt !== undefined) singlePromptInput.value = result.savedSinglePrompt;
    if (result.savedLocationRefNum !== undefined) locationRefNumInput.value = result.savedLocationRefNum;

    const legacySavedImages = Array.isArray(result.savedUploadedReferenceImages)
      ? result.savedUploadedReferenceImages
      : [];
    const sourceImages = savedImagesFromDb.length ? savedImagesFromDb : legacySavedImages;

    if (sourceImages.length) {
      uploadedReferenceImages = sourceImages.map((image, index) => ({
        ...image,
        tag: normalizeTag(image.tag, `@img${index + 1}`)
      }));
    }

    if (!savedImagesFromDb.length && legacySavedImages.length) {
      await saveReferenceImagesToDb(uploadedReferenceImages);
      chrome.storage.local.remove('savedUploadedReferenceImages');
    }

    if (savedCharacterRefsFromDb.length) {
      capturedCharacterReferences = savedCharacterRefsFromDb;
    }

    if (savedLocationRefsFromDb.length) {
      capturedLocationReferences = savedLocationRefsFromDb;
    }

    renderUploadedImages();
    renderCharacterReferences();
    renderLocationReferences();
    setActiveTab(result.savedActiveTab || 'character');
    setActiveSubTab(result.savedActiveSubTab || 'image-character');
    mainView.classList.add('loaded');
  }).catch((error) => {
    console.error('Failed to restore popup state:', error);
    renderUploadedImages();
    renderCharacterReferences();
    renderLocationReferences();
    setActiveTab('character');
    setActiveSubTab('image-character');
    mainView.classList.add('loaded');
  });

  chrome.runtime.sendMessage({ action: 'get_state' }, (state) => {
    if (state && state.active) {
      startBtn.style.display = 'none';
      stopBtn.style.display = 'block';
      stopBtn.disabled = false;
      statusBox.textContent = state.status;
    } else if (state && state.status) {
      statusBox.textContent = state.status;
    }
  });

  startFromInput.addEventListener('input', () => {
    if (startFromInput.value) singlePromptInput.value = '';
    void saveInputs();
  });

  singlePromptInput.addEventListener('input', () => {
    if (singlePromptInput.value) startFromInput.value = '';
    void saveInputs();
  });

  locationRefNumInput.addEventListener('input', () => {
    void saveInputs();
  });

  settingsBtn.addEventListener('click', () => {
    mainView.style.display = 'none';
    settingsView.style.display = 'block';
  });

  const goBack = () => {
    settingsView.style.display = 'none';
    mainView.style.display = 'block';
  };

  backBtn.addEventListener('click', goBack);

  saveSettingsBtn.addEventListener('click', () => {
    currentSheetLink = sheetLinkInput.value.trim();
    chrome.storage.local.set({ magnificSheetLink: currentSheetLink });
    goBack();
  });

  startBtn.addEventListener('click', async () => {
    if (!currentSheetLink || !currentSheetLink.includes('/d/')) {
      statusBox.textContent = 'Please configure a valid Google Sheet link in settings.';
      return;
    }

    const selectedColumn = TAB_COLUMNS[activeTab] || TAB_COLUMNS.character;
    const colLetter = selectedColumn.letter;

    statusBox.textContent = `Fetching Column ${colLetter}...`;
    startBtn.disabled = true;

    try {
      const sheetIdMatch = currentSheetLink.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (!sheetIdMatch) throw new Error('Could not extract Sheet ID');
      const sheetId = sheetIdMatch[1];

      const csvUrl = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq`);
      csvUrl.searchParams.set('tqx', 'out:csv');
      csvUrl.searchParams.set('range', `${colLetter}:${colLetter}`);

      const gidMatch = currentSheetLink.match(/[#&?]gid=([0-9]+)/);
      if (gidMatch) {
        csvUrl.searchParams.set('gid', gidMatch[1]);
      }

      const response = await fetch(csvUrl.toString());
      if (!response.ok) throw new Error('Failed to fetch sheet. Is it public?');

      const csvText = await response.text();
      const prompts = parseCsvColumn(csvText, selectedColumn.index);

      if (prompts.length === 0) {
        throw new Error(`No prompts found in Column ${colLetter}`);
      }

      const singlePromptVal = parseInt(singlePromptInput.value, 10);
      const startFromVal = parseInt(startFromInput.value, 10);

      let promptsToProcess = prompts;
      let startIndex = 0;

      if (!Number.isNaN(startFromVal) && startFromVal > 0) {
        startIndex = startFromVal - 1;
        promptsToProcess = prompts.slice(startIndex);
      } else if (!Number.isNaN(singlePromptVal) && singlePromptVal > 0) {
        startIndex = singlePromptVal - 1;
        promptsToProcess = prompts.slice(startIndex, startIndex + 1);
      }

      statusBox.textContent = `Starting... (${promptsToProcess.length} prompts)`;
      startBtn.style.display = 'none';
      stopBtn.style.display = 'block';
      stopBtn.disabled = false;

      const locationRefVal = parseInt(locationRefNumInput.value, 10);
      const locationRefNum = Number.isNaN(locationRefVal) ? null : locationRefVal;

      await persistActiveWorkflowImages(buildUploadedReferencePayload());

      chrome.runtime.sendMessage({
        action: 'start_workflow',
        prompts: promptsToProcess,
        startIndexOffset: startIndex,
        baseUrl: 'https://www.magnific.com/app/ai-image-generator#from_element=mainmenu&from_view=pinned_tool',
        colLetter,
        locationRefNum
      });
    } catch (err) {
      statusBox.textContent = err.message;
      startBtn.disabled = false;
    }
  });

  stopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'stop_workflow' });
    statusBox.textContent = 'Stopping...';
    stopBtn.disabled = true;
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'update_status') {
      statusBox.textContent = message.status;
      if (message.done) {
        startBtn.style.display = 'block';
        startBtn.disabled = false;
        stopBtn.style.display = 'none';
        stopBtn.disabled = false;
      }
    } else if (message.action === 'character_reference_added') {
      const { name, dataUrl } = message;
      const exists = capturedCharacterReferences.find(c => c.name && c.name.toLowerCase() === name.toLowerCase());
      if (!exists) {
        const tag = getNextCharacterTag();
        capturedCharacterReferences.push({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          tag,
          name,
          dataUrl
        });
        renderCharacterReferences();
        saveCharacterReferencesToDb(capturedCharacterReferences).catch(console.error);
      }
    } else if (message.action === 'location_reference_added') {
      const { name, dataUrl } = message;
      const exists = capturedLocationReferences.find(c => c.name && c.name.toLowerCase() === name.toLowerCase());
      if (!exists) {
        const tag = getNextLocationTag();
        capturedLocationReferences.push({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          tag,
          name,
          dataUrl
        });
        renderLocationReferences();
        saveLocationReferencesToDb(capturedLocationReferences).catch(console.error);
      }
    }
  });
});

function parseCsvColumn(csvText, colIndex) {
  const rows = [];
  let currentRow = [];
  let currentCell = '';
  let insideQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"' && insideQuotes && nextChar === '"') {
      currentCell += '"';
      i += 1;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === ',' && !insideQuotes) {
      currentRow.push(currentCell);
      currentCell = '';
    } else if ((char === '\n' || char === '\r') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') i += 1;
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += char;
    }
  }

  if (currentCell !== '' || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows.map((row) => (row[colIndex] ? row[colIndex].trim() : ''));
}
