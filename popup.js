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
  const statusBox = document.getElementById('status');

  let currentSheetLink = '';

  // Load saved link
  chrome.storage.local.get(['magnificSheetLink'], (result) => {
    if (result.magnificSheetLink) {
      currentSheetLink = result.magnificSheetLink;
      sheetLinkInput.value = currentSheetLink;
    }
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

    statusBox.textContent = 'Fetching Google Sheet...';
    startBtn.disabled = true;

    try {
      const sheetIdMatch = currentSheetLink.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (!sheetIdMatch) throw new Error('Could not extract Sheet ID');
      const sheetId = sheetIdMatch[1];
      
      let csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
      
      // Extract gid (Sheet tab ID) if present
      const gidMatch = currentSheetLink.match(/[#&?]gid=([0-9]+)/);
      if (gidMatch) {
        csvUrl += `&gid=${gidMatch[1]}`;
      }
      
      const response = await fetch(csvUrl);
      if (!response.ok) throw new Error('Failed to fetch sheet. Is it public?');
      
      const csvText = await response.text();
      // Returns an array where index 0 is G1, index 1 is G2, etc. Preserves empty rows.
      const prompts = parseCsvColumn(csvText, 6); 
      
      if (prompts.length === 0) {
        throw new Error('No prompts found in Column G');
      }

      const singlePromptVal = parseInt(singlePromptInput.value, 10);
      const startFromVal = parseInt(startFromInput.value, 10);
      
      let promptsToProcess = prompts;
      let startIndex = 0;

      if (!isNaN(singlePromptVal) && singlePromptVal > 0) {
        // Run ONLY this single prompt (e.g. 69 means G69, which is index 68)
        startIndex = singlePromptVal - 1;
        promptsToProcess = prompts.slice(startIndex, startIndex + 1);
      } else if (!isNaN(startFromVal) && startFromVal > 0) {
        // Run starting from this prompt (e.g. 15 means G15, which is index 14)
        startIndex = startFromVal - 1;
        promptsToProcess = prompts.slice(startIndex);
      }

      statusBox.textContent = `Starting... (${promptsToProcess.length} prompts)`;
      startBtn.style.display = 'none';
      stopBtn.style.display = 'block';
      stopBtn.disabled = false;

      chrome.runtime.sendMessage({
        action: 'start_workflow',
        prompts: promptsToProcess,
        startIndexOffset: startIndex, // To show correct prompt # in UI
        baseUrl: 'https://www.magnific.com/app/ai-image-generator#from_element=mainmenu&from_view=pinned_tool'
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

  // Extract column G, return empty string if cell is empty so indices match row numbers
  return rows.map(row => row[colIndex] ? row[colIndex].trim() : '');
}
