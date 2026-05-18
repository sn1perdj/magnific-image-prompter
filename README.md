# Magnific Automator (Chrome Extension)

A powerful, custom Chrome extension designed to fully automate the prompt generation and image downloading workflow on Magnific AI.

## Features
- **Google Sheets Integration**: Automatically fetches prompts from the selected sheet column: Character = E, Location = F, Image = G.
- **Fully Automated Pipeline**: Clears the input, pastes the prompt, clicks generate, waits for the generation to complete, and automatically downloads the image.
- **Auto Recovery**: If Magnific or the extension hits an error, it hard reloads the page and resumes from the prompt it was processing.
- **Smart Image Renaming**: Names the downloaded image exactly according to the row number (e.g., Prompt E15/F15/G15 saves as `15.jpg`).
- **Precision Controls**: 
  - **Start From #**: Begin the generation loop from a specific prompt number instead of the beginning.
  - **Run Single #**: Run one specific prompt, download it, and stop.
  - **Stop Button**: Halt the entire workflow safely at any time.
- **Professional UI**: A sleek, dark-mode glassmorphism interface built with modern web standards.

## Installation
1. Download or clone this repository to a folder on your computer.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **"Developer mode"** in the top right corner.
4. Click **"Load unpacked"** in the top left corner.
5. Select the folder containing this extension (`magnific _plugin`).
6. The extension is now installed! Pin it to your Chrome toolbar for easy access.

## Google Sheet Setup
1. Create a Google Sheet and place your prompts in the matching columns: **Column E** for Character, **Column F** for Location, and **Column G** for Image.
   - *Note: E1/F1/G1 is treated as Prompt 1, E15/F15/G15 as Prompt 15. The script handles empty rows perfectly, so feel free to leave spaces.*
2. Click the **"Share"** button in Google Sheets.
3. Under "General Access", change it to **"Anyone with the link"**. (The extension needs this to read the data in the background).
4. Copy the link. (If you have multiple tabs, make sure you are looking at the correct tab before copying the link!).

## How to Use
1. Open the **Magnific AI Image Generator** page: `https://www.magnific.com/app/ai-image-generator`
2. Click the Magnific Automator extension icon in your Chrome toolbar.
3. Click the **Settings (⚙️)** icon in the top right.
4. Paste your Google Sheet link and click **"Save & Back"**.
5. Optionally fill out the "Start From" or "Single Prompt" fields.
6. Click **"Start Processing"**. 

If Magnific fails, the page disconnects, or a download does not start, the extension will hard reload the page and retry the current prompt. Completed prompts are not repeated; if prompt 19 finished successfully, recovery continues from prompt 20.

*Note: The very first time the extension attempts to download an image automatically, Chrome might show a popup asking for permission to "Download multiple files". Make sure to click **Allow** so the extension can operate seamlessly in the background.*
