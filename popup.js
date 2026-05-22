document.addEventListener('DOMContentLoaded', () => {
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
  const addImageBtn = document.getElementById('addImageBtn');
  const imageUploadInput = document.getElementById('imageUploadInput');
  const imageTagList = document.getElementById('imageTagList');
  const statusBox = document.getElementById('status');

  const TAB_COLUMNS = {
    character: { index: 0, letter: 'E' },
    location: { index: 0, letter: 'F' },
    image: { index: 0, letter: 'G' }
  };

  let activeTab = 'character';
  let currentSheetLink = '';
  let uploadedReferenceImages = [];

  const tabButtons = document.querySelectorAll('.tab');
  const locationRefSection = document.getElementById('locationRefSection');
  const imageManagerSection = document.getElementById('imageManagerSection');

  function saveInputs() {
    chrome.storage.local.set({
      savedStartFrom: startFromInput.value,
      savedSinglePrompt: singlePromptInput.value,
      savedLocationRefNum: locationRefNumInput.value,
      savedActiveTab: activeTab,
      savedUploadedReferenceImages: uploadedReferenceImages
    });
  }

  function setActiveTab(tabName) {
    activeTab = tabName;
    tabButtons.forEach((button) => {
      button.classList.toggle('active', button.getAttribute('data-tab') === tabName);
    });

    const isImageTab = tabName === 'image';
    locationRefSection.style.display = isImageTab ? 'flex' : 'none';
    imageManagerSection.style.display = isImageTab ? 'flex' : 'none';
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

  function renderUploadedImages() {
    imageTagList.innerHTML = '';

    if (uploadedReferenceImages.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'image-tag-empty';
      emptyState.textContent = 'No reference images added yet.';
      imageTagList.appendChild(emptyState);
      return;
    }

    uploadedReferenceImages.forEach((image, index) => {
      const item = document.createElement('div');
      item.className = 'image-tag-item';

      const thumb = document.createElement('img');
      thumb.className = 'image-thumb';
      thumb.src = image.dataUrl;
      thumb.alt = image.tag;

      const meta = document.createElement('div');
      meta.className = 'image-tag-meta';

      const tagInput = document.createElement('input');
      tagInput.type = 'text';
      tagInput.className = 'input-field tag-input';
      tagInput.value = image.tag;
      tagInput.placeholder = '@img1';
      tagInput.addEventListener('change', () => {
        const fallbackTag = `@img${index + 1}`;
        uploadedReferenceImages[index].tag = normalizeTag(tagInput.value, fallbackTag);
        renderUploadedImages();
        saveInputs();
      });
      tagInput.addEventListener('blur', () => {
        const fallbackTag = `@img${index + 1}`;
        uploadedReferenceImages[index].tag = normalizeTag(tagInput.value, fallbackTag);
        renderUploadedImages();
        saveInputs();
      });

      const imageName = document.createElement('div');
      imageName.className = 'image-name';
      imageName.textContent = image.name || `Reference ${index + 1}`;

      meta.appendChild(tagInput);
      meta.appendChild(imageName);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-image-btn';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        uploadedReferenceImages.splice(index, 1);
        renderUploadedImages();
        saveInputs();
      });

      item.appendChild(thumb);
      item.appendChild(meta);
      item.appendChild(removeBtn);
      imageTagList.appendChild(item);
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

  async function handleImageFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) {
      return;
    }

    for (const file of files) {
      const dataUrl = await fileToDataUrl(file);
      uploadedReferenceImages.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        tag: getNextDefaultTag(),
        name: file.name,
        dataUrl
      });
    }

    renderUploadedImages();
    saveInputs();
  }

  function buildUploadedReferencePayload() {
    return uploadedReferenceImages.map((image, index) => ({
      id: image.id,
      tag: normalizeTag(image.tag, `@img${index + 1}`),
      name: image.name,
      dataUrl: image.dataUrl
    }));
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      setActiveTab(btn.getAttribute('data-tab'));
      saveInputs();
    });
  });

  addImageBtn.addEventListener('click', () => imageUploadInput.click());
  imageUploadInput.addEventListener('change', async () => {
    try {
      await handleImageFiles(imageUploadInput.files);
    } finally {
      imageUploadInput.value = '';
    }
  });

  chrome.storage.local.get([
    'magnificSheetLink',
    'savedStartFrom',
    'savedSinglePrompt',
    'savedLocationRefNum',
    'savedActiveTab',
    'savedUploadedReferenceImages'
  ], (result) => {
    if (result.magnificSheetLink) {
      currentSheetLink = result.magnificSheetLink;
      sheetLinkInput.value = currentSheetLink;
    }

    if (result.savedStartFrom !== undefined) startFromInput.value = result.savedStartFrom;
    if (result.savedSinglePrompt !== undefined) singlePromptInput.value = result.savedSinglePrompt;
    if (result.savedLocationRefNum !== undefined) locationRefNumInput.value = result.savedLocationRefNum;
    if (Array.isArray(result.savedUploadedReferenceImages)) {
      uploadedReferenceImages = result.savedUploadedReferenceImages.map((image, index) => ({
        ...image,
        tag: normalizeTag(image.tag, `@img${index + 1}`)
      }));
    }

    renderUploadedImages();
    setActiveTab(result.savedActiveTab || 'character');
  });

  chrome.runtime.sendMessage({ action: 'get_state' }, (state) => {
    if (state && state.active) {
      startBtn.style.display = 'none';
      stopBtn.style.display = 'block';
      stopBtn.disabled = false;
      statusBox.textContent = state.status;

      let runningTab = 'character';
      if (state.colLetter === 'F') runningTab = 'location';
      if (state.colLetter === 'G') runningTab = 'image';
      setActiveTab(runningTab);
    } else if (state && state.status) {
      statusBox.textContent = state.status;
    }
  });

  startFromInput.addEventListener('input', () => {
    if (startFromInput.value) singlePromptInput.value = '';
    saveInputs();
  });

  singlePromptInput.addEventListener('input', () => {
    if (singlePromptInput.value) startFromInput.value = '';
    saveInputs();
  });

  locationRefNumInput.addEventListener('input', saveInputs);

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

      chrome.runtime.sendMessage({
        action: 'start_workflow',
        prompts: promptsToProcess,
        startIndexOffset: startIndex,
        baseUrl: 'https://www.magnific.com/app/ai-image-generator#from_element=mainmenu&from_view=pinned_tool',
        colLetter,
        locationRefNum,
        uploadedReferenceImages: buildUploadedReferencePayload()
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
