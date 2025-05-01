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