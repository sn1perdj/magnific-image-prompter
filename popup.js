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
  const refImageNumInput = document.getElementById('refImageNum');
  const statusBox = document.getElementById('status');

  function saveInputs() {
    chrome.storage.local.set({
      savedStartFrom: startFromInput.value,
      savedSinglePrompt: singlePromptInput.value,
      savedRefImageNum: refImageNumInput.value,
      savedActiveTab: activeTab
    });
  }

  const TAB_COLUMNS = {
    character: { index: 0, letter: 'E' },
    location: { index: 0, letter: 'F' },
    image: { index: 0, letter: 'G' }
  };

  let activeTab = 'character';
  const tabButtons = document.querySelectorAll('.tab');
  const refImageSection = document.getElementById('refImageSection');
  
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.getAttribute('data-tab');
      
      if (activeTab === 'image') {
        if (refImageSection) refImageSection.style.display = 'block';
      } else {
        if (refImageSection) refImageSection.style.display = 'none';
      }
      saveInputs();
    });
  });

  let currentSheetLink = '';

  // Load saved link and inputs
  chrome.storage.local.get([
    'magnificSheetLink', 
    'savedStartFrom', 
    'savedSinglePrompt', 
    'savedRefImageNum', 
    'savedActiveTab'
  ], (result) => {
    if (result.magnificSheetLink) {
      currentSheetLink = result.magnificSheetLink;
      sheetLinkInput.value = currentSheetLink;
    }
    
    if (result.savedStartFrom !== undefined) startFromInput.value = result.savedStartFrom;
    if (result.savedSinglePrompt !== undefined) singlePromptInput.value = result.savedSinglePrompt;
    if (result.savedRefImageNum !== undefined) refImageNumInput.value = result.savedRefImageNum;
    
    if (result.savedActiveTab) {
      const btnToActivate = document.querySelector(`.tab[data-tab="${result.savedActiveTab}"]`);
      if (btnToActivate) btnToActivate.click();
    }
  });

  // Restore UI state
  chrome.runtime.sendMessage({ action: 'get_state' }, (state) => {
    if (state && state.active) {
      startBtn.style.display = 'none';
      stopBtn.style.display = 'block';
      stopBtn.disabled = false;
      statusBox.textContent = state.status;
      
      let runningTab = 'character';
      if (state.colLetter === 'F') runningTab = 'location';
      if (state.colLetter === 'G') runningTab = 'image';
      
      tabButtons.forEach(b => b.classList.remove('active'));
      const activeBtn = document.querySelector(`.tab[data-tab="${runningTab}"]`);
      if (activeBtn) activeBtn.classList.add('active');
      activeTab = runningTab;
      
      if (activeTab === 'image') {
        if (refImageSection) refImageSection.style.display = 'block';
      } else {
        if (refImageSection) refImageSection.style.display = 'none';
      }
    } else if (state && state.status) {
      statusBox.textContent = state.status;
    }
  });

  // Clear the other input when one is clicked to prevent conflicting logic
  startFromInput.addEventListener('input', () => {
    if (startFromInput.value) singlePromptInput.value = '';
    saveInputs();
  });
  singlePromptInput.addEventListener('input', () => {
    if (singlePromptInput.value) startFromInput.value = '';
    saveInputs();
  });
  refImageNumInput.addEventListener('input', saveInputs);

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
      
      // Extract gid (Sheet tab ID) if present
      const gidMatch = currentSheetLink.match(/[#&?]gid=([0-9]+)/);
      if (gidMatch) {
        csvUrl.searchParams.set('gid', gidMatch[1]);
      }
      
      const response = await fetch(csvUrl.toString());
      if (!response.ok) throw new Error('Failed to fetch sheet. Is it public?');
      
      const csvText = await response.text();

      // The request above fetches only the selected sheet column, so parse column 0.
      const prompts = parseCsvColumn(csvText, selectedColumn.index); 
      
      if (prompts.length === 0) {
        throw new Error(`No prompts found in Column ${colLetter}`);
      }

      const singlePromptVal = parseInt(singlePromptInput.value, 10);
      const startFromVal = parseInt(startFromInput.value, 10);
      
      let promptsToProcess = prompts;
      let startIndex = 0;

      if (!isNaN(startFromVal) && startFromVal > 0) {
        // Run starting from this prompt (e.g. 15 means E15/F15/G15, which is index 14)
        startIndex = startFromVal - 1;
        promptsToProcess = prompts.slice(startIndex);
      } else if (!isNaN(singlePromptVal) && singlePromptVal > 0) {
        // Run ONLY this single prompt (e.g. 69 means E69/F69/G69, which is index 68)
        startIndex = singlePromptVal - 1;
        promptsToProcess = prompts.slice(startIndex, startIndex + 1);
      }

      statusBox.textContent = `Starting... (${promptsToProcess.length} prompts)`;
      startBtn.style.display = 'none';
      stopBtn.style.display = 'block';
      stopBtn.disabled = false;

      const refImageVal = parseInt(document.getElementById('refImageNum').value, 10);
      const refImageNum = isNaN(refImageVal) ? null : refImageVal;

      chrome.runtime.sendMessage({
        action: 'start_workflow',
        prompts: promptsToProcess,
        startIndexOffset: startIndex, // To show correct prompt # in UI
        baseUrl: 'https://www.magnific.com/app/ai-image-generator#from_element=mainmenu&from_view=pinned_tool',
        colLetter: colLetter,
        refImageNum: refImageNum
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

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

// Basic CSV parser to handle quotes
function parseCsvColumn(csvText, colIndex) {
  const rows = [];
  let currentRow = [];
  let currentCell = '';
  let insideQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"' && insideQuotes && nextChar === '"') {
      currentCell += '"';
      i++;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === ',' && !insideQuotes) {
      currentRow.push(currentCell);
      currentCell = '';
    } else if ((char === '\n' || char === '\r') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
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

  // Extract column, return empty string if cell is empty so indices match row numbers
  return rows.map(row => row[colIndex] ? row[colIndex].trim() : '');
}
