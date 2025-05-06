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
// SotoScribe - Background Service Worker
// Handles state management and messaging without persistence

// In-memory storage only - will be cleared when browser closes
let captureState = {
  isCapturing: false,
  sessionId: null,
  steps: [],
  readyTabs: {}, // Track tabs with ready content scripts
  captureInterval: null // For screenshot interval tracking
};

// Rate limiting for screenshot capture
let lastScreenshotTime = 0;
const SCREENSHOT_THROTTLE_MS = 1000; // Minimum 1 second between screenshots
let pendingScreenshotRequests = [];

// Initialize fresh state
function resetState() {
  // Clear any existing intervals
  if (captureState.captureInterval) {
    clearInterval(captureState.captureInterval);
  }
  
  captureState = {
    isCapturing: false,
    sessionId: null,
    steps: [],
    readyTabs: {}, // Preserve ready tabs information
    captureInterval: null
  };
}

// Check if a URL is a restricted browser system URL
function isRestrictedUrl(url) {
  // If it's your Salesforce instance, explicitly allow it
  if (url && url.includes('icertis.lightning.force.com')) {
    return false; // Not restricted - allow this domain
  }
  
  // Otherwise check against standard restricted URLs
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

// Check if a URL is from a tracking or analytics domain
function isTrackingDomain(url) {
  try {
    if (!url) return false;
    
    const urlObj = new URL(url);
    const domain = urlObj.hostname.toLowerCase();
    
    // Explicit blacklist
    const blacklistedDomains = [
      'doubleclick.net',
      'googletagmanager.com', 
      'snapchat.com',
      'google-analytics.com',
      'facebook.com/tr',
      'quantserve.com',
      'adnxs.com',
      'adsrvr.org',
      'scorecardresearch.com',
      'pixel.tapad.com',
      'insight.adsrvr.org'
    ];
    
    // Check for explicit matches
    if (blacklistedDomains.some(blocked => domain.includes(blocked))) {
      return true;
    }
    
    // Check for telltale patterns
    const trackingPatterns = [
      'analytics', 
      'tracker', 
      'pixel', 
      'tag', 
      'metrics', 
      'beacon',
      'telemetry',
      'collect',
      'stats'
    ];
    
    if (trackingPatterns.some(pattern => domain.includes(pattern))) {
      return true;
    }
    
    // Check pathname for tracking patterns
    const path = urlObj.pathname.toLowerCase();
    const trackingPaths = [
      '/track',
      '/pixel',
      '/collect',
      '/analytics',
      '/beacon',
      '/hit',
      '/event',
      '/log'
    ];
    
    if (trackingPaths.some(pattern => path.includes(pattern))) {
      return true;
    }
    
    return false;
  } catch (error) {
    console.error("Error checking tracking domain:", error);
    return false; // Default to not tracking on error
  }
}

// Check if URL is a Salesforce Lightning URL
function isSalesforceUrl(url) {
  return url && url.includes('lightning.force.com');
}

// Format URL for display
function formatUrl(url) {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    const path = urlObj.pathname;
    const query = urlObj.search;
    
    // Return formatted URL with path and query parameters
    return `${domain}${path}${query ? query.substring(0, 30) + (query.length > 30 ? '...' : '') : ''}`;
  } catch (e) {
    return url;
  }
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
  
  // Check if this is a tracking domain (don't start capture on tracking pages)
  if (isTrackingDomain(tab.url)) {
    console.log("Cannot start capture on tracking domain:", tab.url);
    await chrome.action.setBadgeText({ text: "WAIT" });
    await chrome.action.setBadgeBackgroundColor({ color: "#FFA000" });
    
    // Still mark as capturing, but don't inject scripts yet
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
  
  // Check if this is a Salesforce page
  const isSalesforce = isSalesforceUrl(tab.url);
  
  // Notify content script - with retry mechanism
  let retryAttempt = 0;
  const maxRetries = 3;
  
  async function tryConnectToContentScript() {
    try {
      console.log(`Connection attempt ${retryAttempt + 1} to content script`);
      
      // Check if we know this tab has a content script ready
      const isContentScriptReady = captureState.readyTabs && captureState.readyTabs[tab.id];
      
      chrome.tabs.sendMessage(tab.id, {
        action: "startCapture",
        sessionId: captureState.sessionId,
        isSalesforce: isSalesforce // Tell content script if this is Salesforce
      }, response => {
        if (chrome.runtime.lastError) {
          console.warn("Content script connection error:", chrome.runtime.lastError);
          
          // If we've tried enough times, use fallback approach for Salesforce
          if (retryAttempt >= maxRetries) {
            console.log("Max retries reached, using fallback approach");
            if (isSalesforce) {
              startScreenshotBasedCapture(tab.id);
            }
          } else {
            // Try again after delay
            retryAttempt++;
            setTimeout(tryConnectToContentScript, 1000);
          }
        } else {
          console.log("Start message sent to content script successfully");
          
          // For Salesforce, also start screenshot-based capture as a backup
          if (isSalesforce) {
            console.log("Also starting screenshot capture for Salesforce");
            startScreenshotBasedCapture(tab.id);
          }
        }
      });
    } catch (error) {
      console.error("Error sending message to content script:", error);
      
      // Fall back to screenshot approach for Salesforce
      if (isSalesforce) {
        startScreenshotBasedCapture(tab.id);
      }
    }
  }
  
  // Try to connect to content script
  tryConnectToContentScript();
  
  // Update UI
  await chrome.action.setBadgeText({ text: "REC" });
  await chrome.action.setBadgeBackgroundColor({ color: "#00B3A4" });
  console.log("Capture session started successfully");
}

// Start screenshot-based capture mode (primarily for Salesforce)
function startScreenshotBasedCapture(tabId) {
  console.log("Starting screenshot-based capture mode");
  
  let lastUrl = null;
  let lastScreenshotData = null;
  
  // Set up interval for periodic screenshots
  const screenshotInterval = setInterval(async () => {
    if (!captureState.isCapturing) {
      clearInterval(screenshotInterval);
      return;
    }
    
    try {
      // Get current tab info
      const tab = await chrome.tabs.get(tabId);
      
      // Check if tab still exists
      if (!tab) {
        console.log("Tab no longer exists, stopping screenshot capture");
        clearInterval(screenshotInterval);
        return;
      }
      
      // Capture screenshot
      const screenshot = await captureTabScreenshot();
      
      // Skip if no screenshot (might be on restricted page)
      if (!screenshot) return;
      
      // Detect URL changes
      if (tab.url !== lastUrl) {
        console.log("URL change detected:", tab.url);
        
        // Skip tracking domains
        if (isTrackingDomain(tab.url)) {
          console.log("Skipping tracking domain:", tab.url);
          lastUrl = tab.url; // Update lastUrl to avoid capturing it again
          return;
        }
        
        lastUrl = tab.url;
        
        // Add navigation step
        captureState.steps.push({
          type: 'navigate',
          url: tab.url,
          title: tab.title,
          timestamp: Date.now(),
          instruction: `Navigate to **${tab.title}** (${formatUrl(tab.url)})`,
          screenshot
        });
      } 
      // Only add screenshot step if it looks different from the last one
      // Skip identical screenshots to avoid bloat
      else if (!lastScreenshotData || screenshot !== lastScreenshotData) {
        lastScreenshotData = screenshot;
        
        // Add a screen state step
        captureState.steps.push({
          type: 'screen_state',
          url: tab.url,
          title: tab.title,
          timestamp: Date.now(),
          instruction: `View of ${tab.title}`,
          screenshot
        });
      }
    } catch (error) {
      console.error("Error in screenshot capture:", error);
    }
  }, 1500); // Every 1.5 seconds - similar to commercial tools
  
  // Store the interval for cleanup
  captureState.captureInterval = screenshotInterval;
}

// Stop the current capture session
async function stopCapture() {
  console.log("Stopping capture session");
  if (!captureState.isCapturing) return;
  
  captureState.isCapturing = false;
  
  // Clear any running capture intervals
  if (captureState.captureInterval) {
    clearInterval(captureState.captureInterval);
    captureState.captureInterval = null;
  }
  
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
      await chrome.tabs.sendMessage(tab.id, { action: "stopCapture" }, response => {
        // Handle potential error, but proceed regardless
        if (chrome.runtime.lastError) {
          console.warn("Warning when stopping content script:", chrome.runtime.lastError);
        } else {
          console.log("Stop message sent to content script");
        }
      });
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

// Process screenshot queue
function processScreenshotQueue() {
  if (pendingScreenshotRequests.length === 0) return;
  
  const now = Date.now();
  if (now - lastScreenshotTime < SCREENSHOT_THROTTLE_MS) {
    // Not enough time has passed, check again later
    setTimeout(processScreenshotQueue, 100);
    return;
  }
  
  // Process next request
  const nextRequest = pendingScreenshotRequests.shift();
  lastScreenshotTime = now;
  
  captureTabScreenshotImpl().then(screenshot => {
    nextRequest.resolve(screenshot);
    
    // Process next request if any
    if (pendingScreenshotRequests.length > 0) {
      setTimeout(processScreenshotQueue, SCREENSHOT_THROTTLE_MS);
    }
  }).catch(error => {
    nextRequest.reject(error);
    
    // Process next request if any, even after error
    if (pendingScreenshotRequests.length > 0) {
      setTimeout(processScreenshotQueue, SCREENSHOT_THROTTLE_MS);
    }
  });
}

// Implementation of screenshot capture
async function captureTabScreenshotImpl() {
  // Get the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  // Check if the tab is on a restricted URL
  if (isRestrictedUrl(tab.url)) {
    console.log("Cannot capture screenshot of restricted URL:", tab.url);
    // Return a placeholder image or null
    return null;
  }
  
  // Check if this is a tracking domain
  if (isTrackingDomain(tab.url)) {
    console.log("Skipping screenshot of tracking domain:", tab.url);
    return null;
  }
  
  // Capture the visible area of the tab
  return await chrome.tabs.captureVisibleTab(null, { format: 'png' });
}

// Throttled screenshot capture (public API)
async function captureTabScreenshot() {
  return new Promise((resolve, reject) => {
    // Add request to queue
    pendingScreenshotRequests.push({ resolve, reject });
    
    // Start processing if not already started
    if (pendingScreenshotRequests.length === 1) {
      processScreenshotQueue();
    }
  });
}

// Listen for tab URL changes to detect when we move to/from restricted pages
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only process if we're in capture mode and URL has changed
  if (captureState.isCapturing && changeInfo.url) {
    const isRestricted = isRestrictedUrl(changeInfo.url);
    const isTracking = isTrackingDomain(changeInfo.url);
    
    if (isRestricted) {
      console.log("Tab navigated to restricted URL:", changeInfo.url);
      chrome.action.setBadgeText({ text: "WAIT" });
      chrome.action.setBadgeBackgroundColor({ color: "#FFA000" });
    } else if (isTracking) {
      console.log("Tab navigated to tracking domain:", changeInfo.url);
      chrome.action.setBadgeText({ text: "WAIT" });
      chrome.action.setBadgeBackgroundColor({ color: "#FFA000" });
    } else {
      console.log("Tab navigated to supported URL:", changeInfo.url);
      chrome.action.setBadgeText({ text: "REC" });
      chrome.action.setBadgeBackgroundColor({ color: "#00B3A4" });
      
      // Check if this is Salesforce
      const isSalesforce = isSalesforceUrl(changeInfo.url);
      
      // Try to re-establish content script connection after a delay
      // This gives the content script time to load
      setTimeout(() => {
        if (captureState.isCapturing) {
          try {
            chrome.tabs.sendMessage(tabId, {
              action: "startCapture",
              sessionId: captureState.sessionId,
              isSalesforce: isSalesforce
            }, response => {
              if (chrome.runtime.lastError) {
                console.warn("Content script reconnection warning:", chrome.runtime.lastError.message);
                // If Salesforce, use screenshot approach
                if (isSalesforce) {
                  startScreenshotBasedCapture(tabId);
                }
              } else {
                console.log("Successfully reconnected to content script");
              }
            });
          } catch (error) {
            console.error("Error reconnecting to content script:", error);
          }
        }
      }, 1000); // Increased from 500ms to 1000ms
    }
  }
});

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background received message:", message.action);
  
  switch (message.action) {
    case "contentScriptLoaded":
      console.log("Content script loaded on:", message.url);
      // Store which tabs have content scripts ready
      if (sender.tab) {
        captureState.readyTabs[sender.tab.id] = true;
      }
      sendResponse({ acknowledged: true });
      break;
      
    case "contentScriptReady":
      console.log("Content script ready on:", message.url);
      // If we're capturing and this tab just got ready, send the start message
      if (captureState.isCapturing && sender.tab && 
          sender.tab.active) {
        chrome.tabs.sendMessage(sender.tab.id, {
          action: "startCapture",
          sessionId: captureState.sessionId,
          isSalesforce: isSalesforceUrl(message.url)
        }, response => {
          if (chrome.runtime.lastError) {
            console.warn("Warning sending start to ready script:", chrome.runtime.lastError);
          }
        });
      }
      sendResponse({ acknowledged: true });
      break;
      
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
        
        // Skip steps from tracking domains
        if (message.data.url && isTrackingDomain(message.data.url)) {
          console.log("Skipping step from tracking domain:", message.data.url);
          sendResponse({ success: false, error: "Tracking domain" });
          break;
        }
        
        // Check for duplicate steps (within a short timeframe and with same type)
        const isDuplicate = captureState.steps.some(step => 
          step.type === message.data.type && 
          step.url === message.data.url && 
          Math.abs(step.timestamp - message.data.timestamp) < 1000
        );
        
        if (isDuplicate) {
          console.log("Skipping duplicate step");
          sendResponse({ success: false, error: "Duplicate step" });
          break;
        }
        
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
      }).catch(error => {
        console.error("Error capturing screenshot:", error);
        sendResponse({ error: error.message });
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
  
  // Also remove from readyTabs if it exists
  if (captureState.readyTabs && captureState.readyTabs[tabId]) {
    delete captureState.readyTabs[tabId];
  }
});

// Initial setup
console.log("SotoScribe background script initialized");
resetState();
