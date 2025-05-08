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

/**
 * SotoScribe Content Script
 * 
 * This is a resilient implementation with inline handlers to avoid
 * module import failures in complex web applications like Salesforce
 */

// Core state
let isCapturing = false;
let sessionId = null;
let windowHasFocus = document.hasFocus();
let pendingScreenshots = new Map();
let lastActionDetails = {};
let lastProcessedURL = null;
let pageNavigations = [];
let highlightOverlay = null;

// Check if we're in Salesforce
const isSalesforce = checkIfSalesforce();
console.log(`SotoScribe loaded (Salesforce: ${isSalesforce})`);

// Skip if in iframe
if (isInIframe()) {
  console.log("SotoScribe not running in iframe");
} else {
  initializeEventHandlers();
  announceContentScriptReady();
}

// Core functions
function isInIframe() {
  try {
    return window !== window.top;
  } catch (e) {
    return true;
  }
}

function checkIfSalesforce() {
  // URL-based detection
  const isSalesforceUrl = window.location.href.includes('lightning.force.com') || 
                         window.location.href.includes('salesforce.com') ||
                         window.location.href.includes('visualforce.com');
  
  // DOM-based detection
  const hasSalesforceDomElements = 
    document.querySelector('.desktop, .oneApp, .slds-scope, .lightningContainer, .forcePage') !== null;
  
  // Lightning framework detection
  const hasLightningFramework = typeof $A !== 'undefined' || typeof LightningComponentRegistry !== 'undefined';
  
  return isSalesforceUrl || hasSalesforceDomElements || hasLightningFramework;
}

function initializeEventHandlers() {
  // Focus tracking
  window.addEventListener('focus', () => { windowHasFocus = true; });
  window.addEventListener('blur', () => { windowHasFocus = false; });
  
  // Inject highlight styles
  injectHighlightStyles();
  
  // Set up message listener
  chrome.runtime.onMessage.addListener(handleMessage);
}

function announceContentScriptReady() {
  chrome.runtime.sendMessage({ 
    action: 'contentScriptReady', 
    url: window.location.href,
    isSalesforce: isSalesforce
  });
}

// Message handling
function handleMessage(message, sender, sendResponse) {
  console.log("Content script received message:", message.action);
  
  try {
    switch (message.action) {
      case 'startCapture':
        startCapture(message.sessionId);
        sendResponse({ success: true });
        break;
        
      case 'stopCapture':
        stopCapture();
        sendResponse({ success: true });
        break;
        
      case 'captureScreenshot':
        captureScreenshot(message.forceCapture || false)
          .then(screenshot => sendResponse({ screenshot }))
          .catch(error => sendResponse({ error: error.message }));
        return true; // Keep channel open
        
      default:
        sendResponse({ success: false, error: 'Unknown message' });
    }
  } catch (error) {
    console.error("Error handling message:", error);
    sendResponse({ success: false, error: error.message });
  }
  
  return true; // Required for async response
}

// Capture control
function startCapture(newSessionId) {
  console.log("Starting capture");
  isCapturing = true;
  sessionId = newSessionId;
  pageNavigations = [window.location.href];
  
  // Set up event listeners
  setupListeners();
  injectSessionIndicator();
  
  // Capture initial state after a short delay
  setTimeout(() => {
    captureInitialState().catch(err => {
      console.error("Error capturing initial state:", err);
    });
  }, 500);
}

function stopCapture() {
  console.log("Stopping capture");
  isCapturing = false;
  sessionId = null;
  
  // Clean up event listeners
  removeListeners();
  removeHighlight();
  removeSessionIndicator();
  
  // Clear any pending timeouts
  pendingScreenshots.forEach(timeoutId => clearTimeout(timeoutId));
  pendingScreenshots.clear();
}

// Event listeners
function setupListeners() {
  console.log("Setting up event listeners");
  
  try {
    // Use event delegation for better performance
    document.addEventListener('click', handleClick, true);
    document.addEventListener('input', handleInput, true);
    document.addEventListener('submit', handleFormSubmit, true);
    document.addEventListener('keydown', handleKeyDown, true);
    
    // Track URL changes
    if (window.history && window.history.pushState) {
      const originalPushState = window.history.pushState;
      window.history.pushState = function() {
        originalPushState.apply(this, arguments);
        handleUrlChange();
      };
      
      window.addEventListener('popstate', handleUrlChange);
    }
    
    // Salesforce-specific handling
    if (isSalesforce) {
      if (typeof $A !== 'undefined') {
        try {
          // Try to hook into Lightning navigation events
          monitorLightningNavigation();
        } catch (e) {
          console.error("Error setting up Lightning monitoring:", e);
        }
      }
      
      // Monitor URL changes regularly
      setInterval(checkUrlChange, 500);
    }
  } catch (error) {
    console.error("Error setting up event listeners:", error);
  }
}

function removeListeners() {
  console.log("Removing event listeners");
  
  try {
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('input', handleInput, true);
    document.removeEventListener('submit', handleFormSubmit, true);
    document.removeEventListener('keydown', handleKeyDown, true);
    
    // Clean up URL change tracking
    window.removeEventListener('popstate', handleUrlChange);
  } catch (error) {
    console.error("Error removing event listeners:", error);
  }
}

// Check for URL changes (for Salesforce)
function checkUrlChange() {
  if (!isCapturing || !windowHasFocus) return;
  
  const currentUrl = window.location.href;
  if (currentUrl !== lastProcessedURL) {
    console.log("URL change detected via polling:", currentUrl);
    lastProcessedURL = currentUrl;
    handleUrlChange();
  }
}

// Event handlers
async function handleClick(event) {
  if (!isCapturing || !windowHasFocus) return;
  
  try {
    // Skip if not trusted or is our own overlay
    if (!event.isTrusted || event.target.closest('[data-sotoscribe]')) {
      return;
    }
    
    // Skip tiny elements (tracking pixels)
    const element = event.target;
    const rect = element.getBoundingClientRect();
    if (rect.width < 5 || rect.height < 5) {
      return;
    }
    
    console.log("Click event captured");
    
    // Highlight the element with a red dot
    highlightElement(element, event.clientX, event.clientY);
    
    // Force capture screenshot
    const screenshot = await captureScreenshot(true);
    removeHighlight();
    
    if (!screenshot) {
      console.error("Failed to capture screenshot for click");
      return;
    }
    
    // Create step data
    const stepData = {
      type: 'click',
      url: window.location.href,
      title: document.title,
      timestamp: Date.now(),
      elementInfo: {
        tagName: element.tagName.toLowerCase(),
        textContent: element.textContent?.trim().substring(0, 50),
        elementName: element.id || element.name || element.textContent?.trim().substring(0, 30) || element.tagName.toLowerCase()
      },
      instruction: `Click on ${element.tagName.toLowerCase()}${element.id ? ' #' + element.id : ''}`,
      screenshot,
      salesforceMetadata: isSalesforce ? {
        isLightningComponent: isLightningElement(element),
        captureMethod: 'event_handler'
      } : undefined
    };
    
    // Send step to background
    chrome.runtime.sendMessage({
      action: 'addStep',
      data: stepData
    }).catch(err => console.error("Error sending click step:", err));
  } catch (error) {
    console.error("Error handling click:", error);
  }
}

function handleInput(event) {
  if (!isCapturing || !windowHasFocus) return;
  
  try {
    // Skip if not trusted or is our own overlay
    if (!event.isTrusted || event.target.closest('[data-sotoscribe]')) {
      return;
    }
    
    const element = event.target;
    
    // Generate a unique ID for this element
    const elementId = element.id || element.name || `elem_${Math.random().toString(36).substr(2, 9)}`;
    
    // Clear any existing timeout for this element
    if (pendingScreenshots.has(elementId)) {
      clearTimeout(pendingScreenshots.get(elementId));
    }
    
    // Debounce for longer in Salesforce
    const debounceTime = isSalesforce ? 1500 : 1000;
    
    // Set a new timeout
    const timeoutId = setTimeout(async () => {
      pendingScreenshots.delete(elementId);
      
      // Get input value
      const actualValue = element.value || element.innerText || '';
      
      // Highlight the element
      highlightElement(element);
      const screenshot = await captureScreenshot(true);
      removeHighlight();
      
      if (!screenshot) {
        console.error("Failed to capture screenshot for input");
        return;
      }
      
      // Create step data
      const stepData = {
        type: 'input',
        url: window.location.href,
        title: document.title,
        timestamp: Date.now(),
        elementInfo: {
          tagName: element.tagName.toLowerCase(),
          elementName: element.id || element.name || element.placeholder || 'field'
        },
        actualValue,
        instruction: `Type "${actualValue.length > 30 ? actualValue.substring(0, 30) + '...' : actualValue}" in the ${element.id || element.name || 'field'}`,
        screenshot,
        salesforceMetadata: isSalesforce ? {
          isLightningComponent: isLightningElement(element),
          captureMethod: 'event_handler'
        } : undefined
      };
      
      // Send step to background
      chrome.runtime.sendMessage({
        action: 'addStep',
        data: stepData
      }).catch(err => console.error("Error sending input step:", err));
    }, debounceTime);
    
    pendingScreenshots.set(elementId, timeoutId);
  } catch (error) {
    console.error("Error handling input:", error);
  }
}

async function handleFormSubmit(event) {
  if (!isCapturing || !windowHasFocus) return;
  
  try {
    // Skip if not trusted or is our own overlay
    if (!event.isTrusted || event.target.closest('[data-sotoscribe]')) {
      return;
    }
    
    const form = event.target;
    
    // Capture screenshot
    const screenshot = await captureScreenshot(true);
    
    if (!screenshot) {
      console.error("Failed to capture screenshot for form submission");
      return;
    }
    
    // Create step data
    const stepData = {
      type: 'form_submit',
      url: window.location.href,
      title: document.title,
      timestamp: Date.now(),
      instruction: `Submit the ${form.id || form.name || 'form'} form`,
      screenshot
    };
    
    // Send step to background
    chrome.runtime.sendMessage({
      action: 'addStep',
      data: stepData
    }).catch(err => console.error("Error sending form step:", err));
  } catch (error) {
    console.error("Error handling form submission:", error);
  }
}

function handleKeyDown(event) {
  if (!isCapturing || !windowHasFocus) return;
  
  try {
    // Skip if not trusted or is our own overlay
    if (!event.isTrusted || event.target.closest('[data-sotoscribe]')) {
      return;
    }
    
    // Only capture keyboard shortcuts
    if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) {
      // Create keyboard shortcut description
      const keys = [];
      if (event.ctrlKey) keys.push('Ctrl');
      if (event.shiftKey) keys.push('Shift');
      if (event.altKey) keys.push('Alt');
      if (event.metaKey) keys.push('Command');
      
      const keyName = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
      keys.push(keyName);
      
      const shortcut = keys.join(' + ');
      
      // Handle keyboard shortcut async
      captureKeyboardShortcut(shortcut).catch(err => console.error("Error capturing keyboard shortcut:", err));
    }
  } catch (error) {
    console.error("Error handling keyboard event:", error);
  }
}

async function captureKeyboardShortcut(shortcut) {
  // Capture screenshot
  const screenshot = await captureScreenshot(true);
  
  if (!screenshot) {
    console.error("Failed to capture screenshot for keyboard shortcut");
    return;
  }
  
  // Create step data
  const stepData = {
    type: 'keyboard',
    url: window.location.href,
    title: document.title,
    timestamp: Date.now(),
    shortcut,
    instruction: `Press ${shortcut}`,
    screenshot
  };
  
  // Send step to background
  chrome.runtime.sendMessage({
    action: 'addStep',
    data: stepData
  }).catch(err => console.error("Error sending keyboard step:", err));
}

async function handleUrlChange() {
  if (!isCapturing) return;
  
  try {
    const currentUrl = window.location.href;
    
    // Skip tracking domains
    if (currentUrl.includes('analytics') || 
        currentUrl.includes('tracker') || 
        currentUrl.includes('pixel')) {
      return;
    }
    
    // Check if this is a new URL
    if (pageNavigations.includes(currentUrl)) return;
    
    console.log("URL change detected:", currentUrl);
    pageNavigations.push(currentUrl);
    lastProcessedURL = currentUrl;
    
    // Wait for page to render
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // Capture screenshot
    const screenshot = await captureScreenshot(true);
    
    if (!screenshot) {
      console.error("Failed to capture screenshot for navigation");
      return;
    }
    
    // Create step data
    const stepData = {
      type: 'navigate',
      url: currentUrl,
      title: document.title,
      timestamp: Date.now(),
      instruction: `Navigate to ${document.title} (${currentUrl})`,
      screenshot,
      salesforceMetadata: isSalesforce ? {
        captureMethod: 'event_handler'
      } : undefined
    };
    
    // Send step to background
    chrome.runtime.sendMessage({
      action: 'addStep',
      data: stepData
    }).catch(err => console.error("Error sending navigation step:", err));
  } catch (error) {
    console.error("Error handling URL change:", error);
  }
}

async function captureInitialState() {
  if (!isCapturing) return;
  
  try {
    console.log("Capturing initial page state");
    
    // Capture screenshot
    const screenshot = await captureScreenshot(true);
    
    if (!screenshot) {
      console.error("Failed to capture initial screenshot");
      return;
    }
    
    // Create step data
    const stepData = {
      type: 'navigate',
      url: window.location.href,
      title: document.title,
      timestamp: Date.now(),
      instruction: `Navigate to ${document.title} (${window.location.href})`,
      screenshot
    };
    
    // Send step to background
    chrome.runtime.sendMessage({
      action: 'addStep',
      data: stepData
    }).catch(err => console.error("Error sending initial step:", err));
  } catch (error) {
    console.error("Error capturing initial state:", error);
  }
}

// Screenshot capturing
async function captureScreenshot(forceCapture = false) {
  try {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        console.warn("Screenshot capture timed out");
        resolve(null);
      }, 5000);
      
      chrome.runtime.sendMessage({ 
        action: 'captureScreenshot',
        forceCapture,
        isSalesforce
      }, (response) => {
        clearTimeout(timeoutId);
        
        if (chrome.runtime.lastError) {
          console.error("Screenshot error:", chrome.runtime.lastError);
          resolve(null);
          return;
        }
        
        if (response && response.screenshot) {
          resolve(response.screenshot);
        } else {
          console.error("Failed to get screenshot from background", response);
          resolve(null);
        }
      });
    });
  } catch (error) {
    console.error("Error capturing screenshot:", error);
    return null;
  }
}

// UI helpers
function injectHighlightStyles() {
  if (document.getElementById('sotoscribe-highlight-style')) return;
  
  const style = document.createElement('style');
  style.id = 'sotoscribe-highlight-style';
  style.setAttribute('data-sotoscribe', 'true');
  style.innerHTML = `
    @keyframes sotoscribe-pulse {
      0% { box-shadow: 0 0 0 0 rgba(0, 179, 164, 0.4); }
      70% { box-shadow: 0 0 0 10px rgba(0, 179, 164, 0); }
      100% { box-shadow: 0 0 0 0 rgba(0, 179, 164, 0); }
    }
  `;
  document.head.appendChild(style);
}

function highlightElement(element, clickX, clickY) {
  try {
    if (!element) return;
    
    // Remove existing highlight
    removeHighlight();
    
    // Create overlay
    highlightOverlay = document.createElement('div');
    highlightOverlay.setAttribute('data-sotoscribe', 'highlight');
    
    // Get element position
    const rect = element.getBoundingClientRect();
    
    // Style the overlay
    highlightOverlay.style.position = 'absolute';
    highlightOverlay.style.left = rect.left + window.scrollX + 'px';
    highlightOverlay.style.top = rect.top + window.scrollY + 'px';
    highlightOverlay.style.width = rect.width + 'px';
    highlightOverlay.style.height = rect.height + 'px';
    highlightOverlay.style.border = '3px solid #00B3A4';
    highlightOverlay.style.boxSizing = 'border-box';
    highlightOverlay.style.pointerEvents = 'none';
    highlightOverlay.style.zIndex = '999999';
    highlightOverlay.style.animation = 'sotoscribe-pulse 1s infinite';
    
    // Add to document
    document.body.appendChild(highlightOverlay);
    
    // Create a red dot at the click position
    if (clickX && clickY) {
      const redDot = document.createElement('div');
      redDot.id = 'sotoscribe-click-dot';
      redDot.setAttribute('data-sotoscribe', 'click-dot');
      redDot.style.position = 'absolute';
      redDot.style.left = clickX + window.scrollX + 'px';
      redDot.style.top = clickY + window.scrollY + 'px';
      redDot.style.width = '20px';
      redDot.style.height = '20px';
      redDot.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
      redDot.style.boxShadow = '0 0 0 3px rgba(255, 0, 0, 0.4)';
      redDot.style.borderRadius = '50%';
      redDot.style.transform = 'translate(-50%, -50%)';
      redDot.style.zIndex = '9999999';
      redDot.style.pointerEvents = 'none';
      
      document.body.appendChild(redDot);
    }
  } catch (error) {
    console.error("Error highlighting element:", error);
  }
}

function removeHighlight() {
  try {
    if (highlightOverlay && highlightOverlay.parentNode) {
      highlightOverlay.parentNode.removeChild(highlightOverlay);
    }
    highlightOverlay = null;
    
    const redDot = document.getElementById('sotoscribe-click-dot');
    if (redDot && redDot.parentNode) {
      redDot.parentNode.removeChild(redDot);
    }
  } catch (error) {
    console.error("Error removing highlight:", error);
  }
}

function injectSessionIndicator() {
  if (document.getElementById('sotoscribe-indicator')) return;
  
  const indicator = document.createElement('div');
  indicator.id = 'sotoscribe-indicator';
  indicator.setAttribute('data-sotoscribe', 'indicator');
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

function removeSessionIndicator() {
  const indicator = document.getElementById('sotoscribe-indicator');
  if (indicator) {
    indicator.remove();
  }
}

// Salesforce-specific helpers
function isLightningElement(element) {
  if (!element || !element.tagName) return false;
  
  // Custom elements contain hyphen
  if (element.tagName.includes('-')) {
    return true;
  }
  
  // Check for Lightning attributes
  if (element.hasAttribute('data-aura-rendered-by') || 
      element.hasAttribute('data-component-id') ||
      element.hasAttribute('lightning-component-id')) {
    return true;
  }
  
  // Check for Lightning classes
  if (element.classList && Array.from(element.classList).some(cls => 
      cls.startsWith('lightning') || cls.startsWith('slds-'))) {
    return true;
  }
  
  return false;
}

function monitorLightningNavigation() {
  if (typeof $A === 'undefined' || !$A.eventService) return;
  
  // Try to hook Lightning's navigation events
  const originalFireEvent = $A.eventService.fireEvent;
  
  $A.eventService.fireEvent = function(eventName, ...args) {
    // Call original function
    const result = originalFireEvent.apply(this, [eventName, ...args]);
    
    // Check for navigation events
    if (eventName && (
        eventName.includes('navigate') || 
        eventName.includes('pageReference') ||
        eventName.includes('routeChange'))) {
      
      console.log("Lightning navigation event detected:", eventName);
      setTimeout(handleUrlChange, 800);
    }
    
    return result;
  };
}