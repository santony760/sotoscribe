// SotoScribe - Background Service Worker
// Handles state management and messaging without persistence

// In-memory storage only - will be cleared when browser closes
let captureState = {
  isCapturing: false,
  sessionId: null,
  steps: []
};

// Initialize fresh state
function resetState() {
  captureState = {
    isCapturing: false,
    sessionId: null,
    steps: []
  };
}

// Check if a URL is a restricted browser system URL
function isRestrictedUrl(url) {
  return url && (
    url.startsWith('chrome://') || 
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('devtools://') ||
    url.startsWith('view-source:') ||
    url.startsWith('file://')
  );
}

// Start a new capture session
async function startCapture() {
  console.log("Starting capture session");
  if (captureState.isCapturing) return;
  
  resetState();
  captureState.isCapturing = true;
  captureState.sessionId = Date.now().toString();
  
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  console.log("Current tab:", tab.id, tab.url);
  
  // Check if the tab is on a restricted URL
  if (isRestrictedUrl(tab.url)) {
    console.log("Cannot capture on restricted URL:", tab.url);
    await chrome.action.setBadgeText({ text: "ERR" });
    await chrome.action.setBadgeBackgroundColor({ color: "#E53935" });
    
    // We'll still mark as capturing but won't try to inject scripts
    // This allows capture to start when user navigates to a supported page
    return;
  }
  
  // Inject session indicator
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: injectSessionIndicator
    });
    console.log("Session indicator injected");
  } catch (error) {
    console.error("Error injecting session indicator:", error);
  }
  
  // Notify content script
  try {
    await chrome.tabs.sendMessage(tab.id, {
      action: "startCapture",
      sessionId: captureState.sessionId
    });
    console.log("Start message sent to content script");
  } catch (error) {
    console.error("Error sending start message to content script:", error);
    // This is often expected on initial load, content script might not be ready yet
  }
  
  // Update UI
  await chrome.action.setBadgeText({ text: "REC" });
  await chrome.action.setBadgeBackgroundColor({ color: "#00B3A4" });
  console.log("Capture session started successfully");
}

// Stop the current capture session
async function stopCapture() {
  console.log("Stopping capture session");
  if (!captureState.isCapturing) return;
  
  captureState.isCapturing = false;
  
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  // Only attempt to execute scripts if the tab is not on a restricted URL
  if (!isRestrictedUrl(tab.url)) {
    // Remove session indicator
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: removeSessionIndicator
      });
      console.log("Session indicator removed");
    } catch (error) {
      console.error("Error removing session indicator:", error);
    }
    
    // Notify content script
    try {
      await chrome.tabs.sendMessage(tab.id, { action: "stopCapture" });
      console.log("Stop message sent to content script");
    } catch (error) {
      console.error("Error sending stop message to content script:", error);
    }
  }
  
  // Update UI
  await chrome.action.setBadgeText({ text: "" });
  
  // Open editor if we have steps
  console.log("Steps captured:", captureState.steps.length);
  if (captureState.steps.length > 0) {
    await openEditor();
  } else {
    console.log("No steps to edit");
  }
}

// Client-side function to inject session indicator
function injectSessionIndicator() {
  if (document.getElementById('sotoscribe-indicator')) return;
  
  const indicator = document.createElement('div');
  indicator.id = 'sotoscribe-indicator';
  indicator.textContent = 'Recording';
  indicator.style.position = 'fixed';
  indicator.style.top = '10px';
  indicator.style.right = '10px';
  indicator.style.backgroundColor = '#00B3A4';
  indicator.style.color = 'white';
  indicator.style.padding = '5px 10px';
  indicator.style.borderRadius = '4px';
  indicator.style.zIndex = '999999';
  indicator.style.fontFamily = 'Arial, sans-serif';
  indicator.style.fontSize = '12px';
  
  document.body.appendChild(indicator);
}

// Client-side function to remove session indicator
function removeSessionIndicator() {
  const indicator = document.getElementById('sotoscribe-indicator');
  if (indicator) {
    indicator.remove();
  }
}

// Open the editor with current steps
async function openEditor() {
  console.log("Opening editor tab");
  try {
    // Create a new tab with the editor
    const tab = await chrome.tabs.create({
      url: chrome.runtime.getURL('editor.html')
    });
    
    console.log("Editor tab created:", tab.id);
    
    // Store the editor tab ID temporarily
    captureState.editorTabId = tab.id;
  } catch (error) {
    console.error("Error opening editor:", error);
  }
}

// Capture a screenshot of the active tab
async function captureTabScreenshot() {
  try {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Check if the tab is on a restricted URL
    if (isRestrictedUrl(tab.url)) {
      console.log("Cannot capture screenshot of restricted URL:", tab.url);
      // Return a placeholder image or null
      return null;
    }
    
    // Capture the visible area of the tab
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    
    return dataUrl;
  } catch (error) {
    console.error('Error capturing screenshot:', error);
    return null;
  }
}

// Listen for tab URL changes to detect when we move to/from restricted pages
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only process if we're in capture mode and URL has changed
  if (captureState.isCapturing && changeInfo.url) {
    const isRestricted = isRestrictedUrl(changeInfo.url);
    
    if (isRestricted) {
      console.log("Tab navigated to restricted URL:", changeInfo.url);
      chrome.action.setBadgeText({ text: "WAIT" });
      chrome.action.setBadgeBackgroundColor({ color: "#FFA000" });
    } else {
      console.log("Tab navigated to supported URL:", changeInfo.url);
      chrome.action.setBadgeText({ text: "REC" });
      chrome.action.setBadgeBackgroundColor({ color: "#00B3A4" });
      
      // Try to re-establish content script connection after a delay
      // This gives the content script time to load
      setTimeout(() => {
        if (captureState.isCapturing) {
          try {
            chrome.tabs.sendMessage(tabId, {
              action: "startCapture",
              sessionId: captureState.sessionId
            });
          } catch (error) {
            console.error("Error reconnecting to content script:", error);
          }
        }
      }, 500);
    }
  }
});

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background received message:", message.action);
  
  switch (message.action) {
    case "startCapture":
      startCapture().then(() => {
        sendResponse({ success: true });
      }).catch(error => {
        console.error("Error starting capture:", error);
        sendResponse({ success: false, error: error.message });
      });
      break;
      
    case "stopCapture":
      stopCapture().then(() => {
        sendResponse({ success: true });
      }).catch(error => {
        console.error("Error stopping capture:", error);
        sendResponse({ success: false, error: error.message });
      });
      break;
      
    case "getState":
      sendResponse({ 
        isCapturing: captureState.isCapturing,
        stepsCount: captureState.steps.length
      });
      break;
      
    case "addStep":
      if (captureState.isCapturing) {
        console.log("Adding step:", message.data.type);
        captureState.steps.push(message.data);
        sendResponse({ success: true, stepCount: captureState.steps.length });
      } else {
        console.log("Rejecting step: not in capture mode");
        sendResponse({ success: false, error: "Not in capture mode" });
      }
      break;
      
    case "getSteps":
      // This will be called by the editor page to get the steps
      console.log("Editor requesting steps, sending:", captureState.steps.length);
      sendResponse({ steps: captureState.steps });
      break;
      
    case "clearSteps":
      // Clear after export
      console.log("Clearing steps");
      resetState();
      sendResponse({ success: true });
      break;
      
    case "captureScreenshot":
      captureTabScreenshot().then(screenshot => {
        sendResponse({ screenshot });
      });
      break;
  }
  
  return true; // Required for async response
});

// Handle tab closures for the editor tab
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === captureState.editorTabId) {
    // Editor was closed, clean up data
    console.log("Editor tab closed, cleaning up data");
    resetState();
  }
});

// Initial setup
console.log("SotoScribe background script initialized");
resetState();