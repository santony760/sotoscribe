/*
 * Copyright [2025] [Antony Soto]
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// SotoScribe - Screenshot Module
// Handles screenshot capture in the background script

// Capture a screenshot of the active tab
async function captureScreenshot() {
  try {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Capture the visible area of the tab
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    
    return dataUrl;
  } catch (error) {
    console.error('Error capturing screenshot:', error);
    return null;
  }
}

// Add listener to the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'captureScreenshot') {
    captureScreenshot().then(screenshot => {
      sendResponse({ screenshot });
    });
    
    return true; // Required for async response
  }
});

// Export the function for use in other modules
export { captureScreenshot };