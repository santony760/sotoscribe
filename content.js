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

// SotoScribe - Content Script
// Handles all DOM events and screenshot capturing

console.log("SotoScribe content script loaded");

// Immediately announce presence to background script
chrome.runtime.sendMessage({ 
  action: 'contentScriptLoaded', 
  url: window.location.href 
}, response => {
  if (chrome.runtime.lastError) {
    console.warn("Unable to announce load:", chrome.runtime.lastError);
  } else {
    console.log("Content script load announcement acknowledged");
  }
});

// In-memory state variables
let isCapturing = false;
let sessionId = null;
let lastActionElement = null;
let highlightOverlay = null;
let pageNavigations = [];
let isSalesforceMode = false; // Flag for Salesforce-specific behavior

// Throttle state for input events
let pendingScreenshots = new Map();
const SCREENSHOT_THROTTLE_MS = 1000; // Minimum 1 second between screenshots

// Check if we're in an iframe (to skip events in tracking pixels)
function isInIframe() {
  try {
    return window !== window.top;
  } catch (e) {
    return true; // If we can't access window.top, we're probably in an iframe
  }
}

// Track window focus state
let windowHasFocus = document.hasFocus();

// Update focus state
window.addEventListener('focus', () => {
  windowHasFocus = true;
});

window.addEventListener('blur', () => {
  windowHasFocus = false;
});

// Track last actions to prevent duplicates
let lastActionDetails = {
  type: null,
  elementPath: null,
  timestamp: 0,
  value: null
};

// Function to check if an action is a duplicate
function isDuplicateAction(type, element, details = {}) {
  const elementPath = element ? getElementPath(element) : null;
  
  // If it's the same type of action on the same element within 1 second
  if (lastActionDetails.type === type && 
      lastActionDetails.elementPath === elementPath &&
      Date.now() - lastActionDetails.timestamp < 1000) {
    
    // For inputs, check if value is the same
    if (type === 'input' && details.value !== undefined) {
      return details.value === lastActionDetails.value;
    }
    
    return true;
  }
  
  // Update last action
  lastActionDetails = {
    type,
    elementPath,
    timestamp: Date.now(),
    ...details
  };
  
  return false;
}

// Debounce variable for Salesforce UI changes
let salesforceUIChangeTimeout = null;

// Wait for DOM to be fully ready before announcing ready state
function waitForDocumentReady() {
  if (document.readyState === 'complete') {
    announceReady();
  } else {
    document.addEventListener('DOMContentLoaded', announceReady);
    // Also set a timeout as a fallback
    setTimeout(announceReady, 2000);
  }
}

// Announce to background script that content script is ready for commands
function announceReady() {
  console.log("Document ready, announcing content script ready state");
  
  // Try to detect if we're in Salesforce
  const isSalesforce = 
    window.location.href.includes('lightning.force.com') || 
    window.location.href.includes('salesforce.com') ||
    document.querySelector('.desktop, .oneApp, .slds-scope, .lightningContainer') !== null;
  
  chrome.runtime.sendMessage({ 
    action: 'contentScriptReady', 
    url: window.location.href,
    isSalesforce: isSalesforce
  }, response => {
    if (chrome.runtime.lastError) {
      console.warn("Unable to announce ready state:", chrome.runtime.lastError);
    } else {
      console.log("Content script ready state acknowledged");
    }
  });
}

// Initialize event listeners
function setupListeners() {
  console.log("Setting up event listeners");
  
  try {
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('input', handleInput, true);
    document.addEventListener('submit', handleFormSubmit, true);
    
    // Also track URL changes for SPAs
    if (window.history && window.history.pushState) {
      const originalPushState = window.history.pushState;
      window.history.pushState = function() {
        originalPushState.apply(this, arguments);
        handleUrlChange();
      };
      
      window.addEventListener('popstate', handleUrlChange);
    }
    
    // Special handling for Salesforce Lightning
    if (isSalesforceMode) {
      setupSalesforceObservers();
    }
    
    console.log("Event listeners setup complete");
  } catch (error) {
    console.error("Error setting up event listeners:", error);
  }
}

// Function to find elements within Shadow DOM
function querySelectorAllDeep(selector, root = document) {
  // Start with regular DOM elements
  let results = Array.from(root.querySelectorAll(selector));
  
  // Get all shadow roots and recursively search within them
  const shadowRoots = [];
  const collectShadowRoots = (node) => {
    if (node.shadowRoot) {
      shadowRoots.push(node.shadowRoot);
    }
    if (node.querySelectorAll) {
      Array.from(node.querySelectorAll('*')).forEach(collectShadowRoots);
    }
  };
  
  collectShadowRoots(root);
  
  // Search within each shadow root
  shadowRoots.forEach(shadowRoot => {
    results = results.concat(Array.from(shadowRoot.querySelectorAll(selector)));
    
    // Recursively search in nested shadow DOMs
    results = results.concat(querySelectorAllDeep(selector, shadowRoot));
  });
  
  return results;
}

// Helper function to get elements within shadow DOM
function getShadowElements(root, selector) {
  let elements = [];
  
  function traverse(node) {
    // Check if the node has a shadow root
    if (node.shadowRoot) {
      // Look for matching elements in this shadow root
      const shadowMatches = node.shadowRoot.querySelectorAll(selector);
      elements = elements.concat(Array.from(shadowMatches));
      
      // Traverse children of the shadow root
      Array.from(node.shadowRoot.children).forEach(traverse);
    }
    
    // Traverse regular DOM children
    if (node.children) {
      Array.from(node.children).forEach(traverse);
    }
  }
  
  traverse(root);
  return elements;
}

// Get Aura component ID for an element
function getAuraElementId(element) {
  // Check for data attribute
  if (element.getAttribute('data-aura-rendered-by')) {
    return element.getAttribute('data-aura-rendered-by');
  }
  
  // Try to find parent with aura ID
  let current = element;
  while (current && current !== document.body) {
    if (current.getAttribute('data-aura-rendered-by')) {
      return current.getAttribute('data-aura-rendered-by');
    }
    current = current.parentElement;
  }
  
  return null;
}

// Set up Salesforce-specific DOM observers
function setupSalesforceObservers() {
  console.log("Setting up enhanced Salesforce-specific observers");
  
  // Create observer for Lightning component changes
  const observer = new MutationObserver((mutations) => {
    // Skip processing if window doesn't have focus or not capturing
    if (!windowHasFocus || !isCapturing) {
      return;
    }
    
    let significantChanges = false;
    
    for (const mutation of mutations) {
      // Look for added nodes that might be components being rendered
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        // Look for meaningful changes like modal dialogs, popups, etc.
        const meaningfulChanges = Array.from(mutation.addedNodes).filter(node => {
          if (node.nodeType !== Node.ELEMENT_NODE) return false;
          
          // Skip tiny elements (often tracking pixels)
          if (node.getBoundingClientRect) {
            const rect = node.getBoundingClientRect();
            if (rect.width < 10 || rect.height < 10) {
              return false;
            }
          }
          
          // Check for LWC components
          if (node.tagName && node.tagName.includes('-')) {
            if (node.offsetHeight > 50) {
              return true;
            }
          }
          
          // Check for significant component types
          if (node.classList) {
            // High-importance UI components
            const significantClasses = [
              'modal-container',
              'slds-modal',
              'slds-form',
              'forceDetailPanelDesktop',
              'slds-panel',
              'slds-popover',
              'runtime_sales_activitiesActivityPanel',
              'forceListViewManagerGrid',
              'forceRecordLayout',
              'oneContent',
              'oneWorkspace'
            ];
            
            for (const cls of significantClasses) {
              if (node.classList.contains(cls) || node.querySelector(`.${cls}`)) {
                return true;
              }
            }
            
            // Look for common Salesforce Lightning patterns
            const lightningPattern = Array.from(node.classList).some(cls => 
              cls.startsWith('forcePage') || 
              cls.startsWith('force') || 
              cls.startsWith('lightning') || 
              cls.startsWith('slds-') ||
              cls.startsWith('uiPanel')
            );
            
            if (lightningPattern && node.offsetHeight > 50) {
              return true;
            }
          }
          
          // Check for known component attributes
          if (node.getAttribute('data-component-id') || 
              node.getAttribute('data-aura-rendered-by') ||
              node.getAttribute('lightning-component-id') ||
              node.querySelector('[data-component-id], [data-aura-rendered-by], [lightning-component-id]')) {
            
            // Make sure it's visible and substantial
            if (node.offsetHeight > 50 || node.offsetWidth > 100) {
              return true;
            }
          }
          
          return false;
        });
        
        if (meaningfulChanges.length > 0) {
          significantChanges = true;
          break;
        }
      }
    }
    
    if (significantChanges) {
      console.log("Detected significant Salesforce UI change");
      
      // Debounce UI changes to avoid capturing too many steps
      clearTimeout(salesforceUIChangeTimeout);
      salesforceUIChangeTimeout = setTimeout(() => {
        handleSalesforceUIChange();
      }, 500);
    }
  });
  
  // Start observing the document with the configured parameters
  observer.observe(document.body, { 
    childList: true, 
    subtree: true,
    attributes: true, 
    attributeFilter: ['class', 'style', 'data-component-id']
  });
  
  // Monitor for Lightning navigation events
  if (window.addEventListener) {
    window.addEventListener('lightning.navigation', () => {
      console.log("Lightning navigation event detected");
      setTimeout(handleUrlChange, 500);
    });
  }
}

// Handle Salesforce UI changes
async function handleSalesforceUIChange() {
  // Skip if not capturing or window doesn't have focus
  if (!isCapturing || !windowHasFocus) {
    return;
  }
  
  // Wait a moment for UI to settle
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Check for duplicate action (we don't want to capture multiple UI changes)
  if (isDuplicateAction('ui_change', null, { url: window.location.href })) {
    console.log("Ignoring duplicate UI change");
    return;
  }
  
  // Capture screenshot
  const screenshot = await captureScreenshot();
  if (!screenshot) {
    console.log("Failed to capture screenshot for UI change, skipping step");
    return;
  }
  
  // Create step data for UI change
  const stepData = {
    type: 'ui_change',
    url: window.location.href,
    title: document.title,
    timestamp: Date.now(),
    instruction: `Salesforce UI updated on **${document.title}**`,
    screenshot
  };
  
  // Send step to background script
  chrome.runtime.sendMessage({
    action: 'addStep',
    data: stepData
  }, response => {
    if (response && response.success) {
      console.log("Salesforce UI change step added successfully");
    } else {
      console.error("Failed to add Salesforce UI change step:", response);
    }
  });
}

// Remove all event listeners
function removeListeners() {
  console.log("Removing event listeners");
  
  try {
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('keydown', handleKeyDown, true);
    document.removeEventListener('input', handleInput, true);
    document.removeEventListener('submit', handleFormSubmit, true);
    
    // Restore original pushState if we modified it
    if (window._originalPushState) {
      window.history.pushState = window._originalPushState;
    }
    
    window.removeEventListener('popstate', handleUrlChange);
    
    console.log("Event listeners removed");
  } catch (error) {
    console.error("Error removing event listeners:", error);
  }
}

// Handle URL changes (for SPAs)
async function handleUrlChange() {
  if (!isCapturing) return;
  
  try {
    const currentUrl = window.location.href;
    
    // Skip tracking domains
    if (currentUrl.includes('analytics') || 
        currentUrl.includes('tracker') || 
        currentUrl.includes('pixel')) {
      console.log("Skipping tracking URL:", currentUrl);
      return;
    }
    
    // Check if this is a new URL
    if (pageNavigations.includes(currentUrl)) return;
    
    console.log("URL change detected:", currentUrl);
    pageNavigations.push(currentUrl);
    
    // Skip if within 500ms of another URL change (debounce)
    if (isDuplicateAction('navigate', null, { url: currentUrl })) {
      console.log("Ignoring rapid URL change");
      return;
    }
    
    // Wait a moment for page to render
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Capture screenshot
    const screenshot = await captureScreenshot();
    if (!screenshot) {
      console.log("Failed to capture screenshot for navigation, retrying...");
      await new Promise(resolve => setTimeout(resolve, 500));
      const retryScreenshot = await captureScreenshot();
      if (!retryScreenshot) {
        console.error("Failed to capture screenshot for navigation after retry");
        return;
      }
    }
    
    // Create step data for page navigation
    const stepData = {
      type: 'navigate',
      url: currentUrl,
      title: document.title,
      timestamp: Date.now(),
      instruction: `Navigate to **${document.title}** (${formatUrl(currentUrl)})`,
      screenshot: screenshot
    };
    
    // Send step to background script
    chrome.runtime.sendMessage({
      action: 'addStep',
      data: stepData
    }, response => {
      if (response && response.success) {
        console.log("Navigation step added successfully");
      } else {
        console.error("Failed to add navigation step:", response);
      }
    });
  } catch (error) {
    console.error("Error handling URL change:", error);
  }
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

// Handle click events
async function handleClick(event) {
  if (!isCapturing) return;
  
  try {
    // Skip if in iframe
    if (isInIframe()) {
      console.log("Ignoring click in iframe");
      return;
    }
    
    // Skip if window doesn't have focus
    if (!windowHasFocus) {
      console.log("Ignoring click while window doesn't have focus");
      return;
    }
    
    // Skip programmatically triggered clicks
    if (!event.isTrusted) {
      console.log("Ignoring non-user click event");
      return;
    }
    
    // Skip clicks on very small elements (often tracking pixels)
    const element = event.target;
    const rect = element.getBoundingClientRect();
    if (rect.width < 5 || rect.height < 5) {
      console.log("Ignoring click on tiny element");
      return;
    }
    
    // Check for duplicate clicks
    if (isDuplicateAction('click', element)) {
      console.log("Ignoring duplicate click action");
      return;
    }
    
    console.log("Click event captured");
    
    // Get the clicked element
    lastActionElement = element;
    
    // Determine the element description
    const elementInfo = getElementInfo(element);
    console.log("Element info:", elementInfo);
    
    // Capture the screenshot with the element highlighted and red dot at click position
    highlightElement(element, event.clientX, event.clientY);
    console.log("Requesting screenshot");
    // Short delay - optimized for performance
    await new Promise(resolve => setTimeout(resolve, 100));
    const screenshot = await captureScreenshot();
    removeHighlight();
    
    // Generate instruction
    const instruction = generateClickInstruction(elementInfo);
    
    // Get URL and context
    const pageUrl = window.location.href;
    const pageContext = {
      title: document.title,
      url: pageUrl,
      path: window.location.pathname,
      query: window.location.search
    };
    
    // Create step data
    const stepData = {
      type: 'click',
      url: pageUrl,
      title: document.title,
      timestamp: Date.now(),
      elementInfo,
      pageContext,
      instruction,
      screenshot
    };
    
    // Send step to background script
    console.log("Sending click step to background");
    chrome.runtime.sendMessage({
      action: 'addStep',
      data: stepData
    }, response => {
      if (response && response.success) {
        console.log("Step added successfully, total steps:", response.stepCount);
      } else {
        console.error("Failed to add step:", response);
      }
    });
  } catch (error) {
    console.error("Error handling click:", error);
  }
}

// Handle form submission
async function handleFormSubmit(event) {
  if (!isCapturing) return;
  
  try {
    // Skip if in iframe
    if (isInIframe()) {
      console.log("Ignoring form submission in iframe");
      return;
    }
    
    // Skip if window doesn't have focus
    if (!windowHasFocus) {
      console.log("Ignoring form submission while window doesn't have focus");
      return;
    }
    
    // Skip programmatically triggered form submissions
    if (!event.isTrusted) {
      console.log("Ignoring non-user form submission");
      return;
    }
    
    // Check for duplicate submission
    if (isDuplicateAction('form_submit', event.target)) {
      console.log("Ignoring duplicate form submission");
      return;
    }
    
    console.log("Form submission captured");
    
    // Get the form element
    const form = event.target;
    
    // Create a map of form values (with sensitive data masked)
    const formData = {};
    const formElements = form.elements;
    
    for (let i = 0; i < formElements.length; i++) {
      const element = formElements[i];
      
      // Skip buttons and elements without names
      if (!element.name || element.type === 'button' || element.type === 'submit') continue;
      
      // Mask sensitive data
      if (isSensitiveField(element)) {
        formData[element.name] = '[MASKED]';
      } else {
        formData[element.name] = element.value;
      }
    }
    
    // Capture screenshot
    const screenshot = await captureScreenshot();
    
    // Generate instruction
    const instruction = `Submit the **${form.id || form.name || 'form'}** form with the filled data`;
    
    // Create step data
    const stepData = {
      type: 'form_submit',
      url: window.location.href,
      title: document.title,
      timestamp: Date.now(),
      formData,
      instruction,
      screenshot
    };
    
    // Send step to background script
    chrome.runtime.sendMessage({
      action: 'addStep',
      data: stepData
    }, response => {
      if (response && response.success) {
        console.log("Form submission step added successfully");
      } else {
        console.error("Failed to add form submission step:", response);
      }
    });
  } catch (error) {
    console.error("Error handling form submission:", error);
  }
}

// Handle keydown events
async function handleKeyDown(event) {
  if (!isCapturing) return;
  
  try {
    // Skip if in iframe
    if (isInIframe()) {
      console.log("Ignoring keyboard event in iframe");
      return;
    }
    
    // Skip if window doesn't have focus
    if (!windowHasFocus) {
      console.log("Ignoring keyboard event while window doesn't have focus");
      return;
    }
    
    // Skip programmatically triggered key events
    if (!event.isTrusted) {
      console.log("Ignoring non-user keyboard event");
      return;
    }
    
    // Only capture keyboard shortcuts (with modifier keys)
    if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) {
      console.log("Keyboard shortcut captured");
      
      // Check for duplicate keyboard shortcut
      if (isDuplicateAction('keyboard', document.activeElement)) {
        console.log("Ignoring duplicate keyboard shortcut");
        return;
      }
      
      // Create a human-readable keyboard shortcut
      const shortcut = generateKeyboardShortcut(event);
      
      // Target element
      const targetElement = document.activeElement;
      const elementInfo = targetElement ? getElementInfo(targetElement) : null;
      
      // Capture screenshot
      console.log("Requesting screenshot for keyboard event");
      const screenshot = await captureScreenshot();
      
      // Generate instruction
      let instruction = `Press **${shortcut}**`;
      if (elementInfo && elementInfo.elementName) {
        instruction += ` while focused on the **${elementInfo.elementName}** element`;
      }
      
      // Create step data
      const stepData = {
        type: 'keyboard',
        url: window.location.href,
        title: document.title,
        timestamp: Date.now(),
        shortcut,
        targetElement: elementInfo,
        instruction,
        screenshot
      };
      
      // Send step to background script
      console.log("Sending keyboard step to background");
      chrome.runtime.sendMessage({
        action: 'addStep',
        data: stepData
      }, response => {
        if (response && response.success) {
          console.log("Keyboard step added successfully");
        } else {
          console.error("Failed to add keyboard step:", response);
        }
      });
    }
  } catch (error) {
    console.error("Error handling keyboard event:", error);
  }
}

// Handle input events with throttling
function handleInput(event) {
  if (!isCapturing) return;
  
  try {
    // Skip if in iframe
    if (isInIframe()) {
      console.log("Ignoring input in iframe");
      return;
    }
    
    // Skip if window doesn't have focus
    if (!windowHasFocus) {
      console.log("Ignoring input while window doesn't have focus");
      return;
    }
    
    // Skip programmatically triggered input events
    if (!event.isTrusted) {
      console.log("Ignoring non-user input event");
      return;
    }
    
    console.log("Input event captured");
    
    // Get the input element
    const element = event.target;
    lastActionElement = element;
    
    // Generate a unique ID for this element
    const elementId = element.id || element.name || `elem_${Math.random().toString(36).substr(2, 9)}`;
    
    // Clear any existing timeout for this element
    if (pendingScreenshots.has(elementId)) {
      clearTimeout(pendingScreenshots.get(elementId));
    }
    
    // Set a new timeout
    const timeoutId = setTimeout(async () => {
      console.log("Input debounce triggered, capturing step for", elementId);
      pendingScreenshots.delete(elementId);
      
      // Get actual input value
      const actualValue = element.value || element.innerText || '';
      
      // Check for duplicate input with same value
      if (isDuplicateAction('input', element, { value: actualValue })) {
        console.log("Ignoring duplicate input action");
        return;
      }
      
      // Determine the element description
      const elementInfo = getElementInfo(element);
      
      // Check if field contains sensitive data
      const isSensitive = isSensitiveField(element);
      
      // Create a masked value if needed
      const maskedValue = isSensitive ? getMaskedValue(element) : actualValue;
      
      // Highlight the element
      highlightElement(element);
      const screenshot = await captureScreenshot();
      removeHighlight();
      
      // Generate instruction with actual text for non-sensitive data
      const instruction = generateInputInstruction(elementInfo, isSensitive, actualValue);
      
      // Create step data
      const stepData = {
        type: 'input',
        url: window.location.href,
        title: document.title,
        timestamp: Date.now(),
        elementInfo,
        actualValue: isSensitive ? '[MASKED]' : actualValue,
        maskedValue,
        isSensitive,
        instruction,
        screenshot
      };
      
      // Send step to background script
      console.log("Sending input step to background");
      chrome.runtime.sendMessage({
        action: 'addStep',
        data: stepData
      }, response => {
        if (response && response.success) {
          console.log("Input step added successfully");
        } else {
          console.error("Failed to add input step:", response);
        }
      });
    }, 1000); // Wait 1 second after typing stops
    
    pendingScreenshots.set(elementId, timeoutId);
  } catch (error) {
    console.error("Error handling input:", error);
  }
}

// Check if a field contains sensitive information
function isSensitiveField(element) {
  try {
    // Check the element type
    if (element.type === 'password') return true;
    
    // Check element attributes
    const sensitiveAttributes = ['password', 'secret', 'token', 'key', 'auth', 
                              'ssn', 'social', 'creditcard', 'card', 'cvv', 'ccv', 
                              'secure', 'private'];
    
    // Check various properties for sensitive terms
    const checkProps = [
      element.name,
      element.id,
      element.placeholder,
      element.getAttribute('aria-label'),
      element.className
    ];
    
    // Look for sensitive terms in any properties
    for (const prop of checkProps) {
      if (!prop) continue;
      
      const lowerProp = prop.toLowerCase();
      if (sensitiveAttributes.some(term => lowerProp.includes(term))) {
        return true;
      }
    }
    
    // Check parent form field labels
    if (element.id) {
      const label = document.querySelector(`label[for="${element.id}"]`);
      if (label && label.textContent) {
        const labelText = label.textContent.toLowerCase();
        if (sensitiveAttributes.some(term => labelText.includes(term))) {
          return true;
        }
      }
    }
    
    // Check for email pattern
    if (element.value && element.value.match(/^[^@\s]+@[^@\s\.]+\.[^@\s]+$/)) {
      return true;
    }
    
    return false;
  } catch (error) {
    console.error("Error checking for sensitive field:", error);
    return false; // Default to not sensitive on error
  }
}

// Get masked value for sensitive fields
function getMaskedValue(element) {
  try {
    // Determine type of sensitive data
    if (element.type === 'password') {
      return '[PASSWORD]';
    }
    
    if (element.value && element.value.match(/^[^@\s]+@[^@\s\.]+\.[^@\s]+$/)) {
      return '[EMAIL]';
    }
    
    // Check for credit card pattern (simplified)
    if (element.value && element.value.match(/^\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}$/)) {
      return '[CREDIT CARD]';
    }
    
    // Default mask
    return '[SENSITIVE DATA]';
  } catch (error) {
    console.error("Error getting masked value:", error);
    return '[MASKED]'; // Default mask on error
  }
}

// Extract useful information about an element
function getElementInfo(element) {
  if (!element) return { tagName: 'unknown' };
  
  try {
    // Get element tag name
    const tagName = element.tagName ? element.tagName.toLowerCase() : 'unknown';
    
    // Get element attributes
    const attributes = {};
    if (element.attributes) {
      for (const attr of element.attributes) {
        attributes[attr.name] = attr.value;
      }
    }
    
    // Get element text content
    let textContent = element.textContent?.trim() || '';
    if (textContent.length > 50) {
      textContent = textContent.substring(0, 50) + '...';
    }
    
    // Get element label if available
    let label = '';
    if (element.id) {
      const labelElement = document.querySelector(`label[for="${element.id}"]`);
      if (labelElement) {
        label = labelElement.textContent.trim();
      }
    }
    
    // Get ARIA attributes which often contain better descriptions
    const ariaLabel = element.getAttribute('aria-label');
    const ariaLabelledBy = element.getAttribute('aria-labelledby');
    let ariaText = '';
    
    if (ariaLabelledBy) {
      const labelElement = document.getElementById(ariaLabelledBy);
      if (labelElement) {
        ariaText = labelElement.textContent.trim();
      }
    }
    
    // Salesforce-specific attributes
    let lightningInfo = {};
    if (isSalesforceMode) {
      // Look for Lightning-specific data
      lightningInfo = getSalesforceElementInfo(element);
    }
    
    // Determine the most descriptive name for the element
    const elementName = 
      label ||
      ariaLabel ||
      ariaText ||
      lightningInfo.label ||
      element.getAttribute('placeholder') || 
      element.getAttribute('name') ||
      element.getAttribute('title') ||
      element.value || 
      (textContent && textContent.length < 30 ? textContent : '') ||
      (element.id ? '#' + element.id : '') ||
      lightningInfo.componentType ||
      tagName;
    
    // Get element role
    const role = element.getAttribute('role') || '';
    
    // Get computed styles for better visibility
    const styles = window.getComputedStyle(element);
    const isVisible = styles.display !== 'none' && styles.visibility !== 'hidden' && styles.opacity !== '0';
    
    // Get element dimensions
    const rect = element.getBoundingClientRect();
    const dimensions = {
      width: rect.width,
      height: rect.height,
      top: rect.top + window.scrollY,
      left: rect.left + window.scrollX
    };
    
    // Get element path for more precise identification
    const path = getElementPath(element);
    
    return {
      tagName,
      attributes,
      textContent,
      elementName,
      label,
      ariaLabel,
      role,
      isVisible,
      dimensions,
      path,
      salesforce: lightningInfo
    };
  } catch (error) {
    console.error("Error getting element info:", error);
    return { 
      tagName: element.tagName?.toLowerCase() || 'unknown',
      error: 'Failed to get complete element info'
    };
  }
}

// Get Salesforce-specific element information
function getSalesforceElementInfo(element) {
  try {
    const info = {};
    
    // Look for Lightning component containers
    const lightningComponent = element.closest('[data-component-id], [data-aura-rendered-by], [lightning-component-id]');
    if (lightningComponent) {
      info.componentId = lightningComponent.getAttribute('data-component-id') || 
                        lightningComponent.getAttribute('data-aura-rendered-by') ||
                        lightningComponent.getAttribute('lightning-component-id');
      
      // Try to determine component type
      const componentType = 
        lightningComponent.getAttribute('data-component-type') ||
        lightningComponent.getAttribute('data-component-name') ||
        (lightningComponent.classList && Array.from(lightningComponent.classList)
          .find(cls => cls.startsWith('forcePage') || cls.startsWith('force') || cls.startsWith('lightning')));
      
      if (componentType) {
        info.componentType = componentType;
      }
    }
    
    // Look for SLDS classes which identify Salesforce components
    const sldsClasses = Array.from(element.classList || []).filter(cls => cls.startsWith('slds-'));
    if (sldsClasses.length > 0) {
      info.sldsClasses = sldsClasses;
      
      // Try to determine component type from SLDS classes
      if (sldsClasses.includes('slds-button')) {
        info.componentType = 'Button';
      } else if (sldsClasses.includes('slds-input')) {
        info.componentType = 'Input';
      } else if (sldsClasses.includes('slds-form-element')) {
        info.componentType = 'FormField';
      } else if (sldsClasses.includes('slds-modal')) {
        info.componentType = 'Modal';
      }
    }
    
    // Check for Salesforce field labels with improved shadow DOM handling
    const fieldLabel = element.closest('.slds-form-element');
    if (fieldLabel) {
      // Check in regular DOM first
      let labelElement = fieldLabel.querySelector('.slds-form-element__label');
      
      // If not found, try to look in shadow DOM
      if (!labelElement) {
        const shadowElements = getShadowElements(fieldLabel, '.slds-form-element__label');
        if (shadowElements.length > 0) {
          labelElement = shadowElements[0];
        }
      }
      
      if (labelElement) {
        info.label = labelElement.textContent.trim();
      }
    }
    
    // Handle Lightning Aura components
    if (window.$A && element.closest('.oneApp')) {
      try {
        // Try to get Aura component ID
        const auraId = getAuraElementId(element);
        if (auraId) {
          info.auraId = auraId;
        }
      } catch (e) {
        console.log("Error accessing Aura component:", e);
      }
    }
    
    return info;
  } catch (error) {
    console.error("Error getting Salesforce element info:", error);
    return {};
  }
}

// Get a CSS selector path to the element
function getElementPath(element, maxDepth = 3) {
  try {
    if (!element || element === document.body || element === document || element === window) {
      return '';
    }
    
    let path = '';
    let current = element;
    let depth = 0;
    
    while (current && current !== document.body && current !== document && depth < maxDepth) {
      let selector = current.tagName.toLowerCase();
      
      if (current.id) {
        selector += `#${current.id}`;
      } else if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/);
        if (classes.length > 0) {
          selector += `.${classes[0]}`;
        }
      }
      
      path = path ? `${selector} > ${path}` : selector;
      current = current.parentElement;
      depth++;
    }
    
    return path;
  } catch (error) {
    console.error("Error getting element path:", error);
    return 'unknown-path'; 
  }
}

// Create a keyboard shortcut string (e.g., "Ctrl + C")
function generateKeyboardShortcut(event) {
  try {
    const keys = [];
    
    if (event.ctrlKey) keys.push('Ctrl');
    if (event.shiftKey) keys.push('Shift');
    if (event.altKey) keys.push('Alt');
    if (event.metaKey) keys.push('Command');
    
    // Get the key name
    let keyName = event.key;
    if (keyName === ' ') keyName = 'Space';
    if (keyName.length === 1) keyName = keyName.toUpperCase();
    
    keys.push(keyName);
    
    return keys.join(' + ');
  } catch (error) {
    console.error("Error generating keyboard shortcut:", error);
    return 'Unknown Shortcut';
  }
}

// Generate a click instruction
function generateClickInstruction(elementInfo) {
  try {
    let instructionText = '';
    
    // Get additional details for better description
    const elementText = elementInfo.elementName || 'element';
    const elementType = elementInfo.tagName || 'element';
    const elementRole = elementInfo.role || '';
    
    // Salesforce-specific handling
    if (isSalesforceMode && elementInfo.salesforce && Object.keys(elementInfo.salesforce).length > 0) {
      if (elementInfo.salesforce.componentType === 'Button') {
        return `Click the **${elementText}** button`;
      } else if (elementInfo.salesforce.componentType && elementInfo.salesforce.label) {
        return `Click the **${elementInfo.salesforce.label}** ${elementInfo.salesforce.componentType.toLowerCase()}`;
      }
    }
    
    // Build a more detailed instruction based on element type
    if (elementInfo.tagName === 'button' || 
        elementInfo.tagName === 'a' || 
        elementRole === 'button') {
      instructionText = `Click the **${elementText}** button`;
    } else if (elementInfo.tagName === 'input' && elementInfo.attributes.type === 'checkbox') {
      const action = elementInfo.attributes.checked ? 'Check' : 'Uncheck';
      instructionText = `${action} the **${elementInfo.label || elementText}** checkbox`;
    } else if (elementInfo.tagName === 'input' && elementInfo.attributes.type === 'radio') {
      instructionText = `Select the **${elementInfo.label || elementText}** radio option`;
    } else if (elementInfo.tagName === 'select') {
      instructionText = `Open the **${elementInfo.label || elementText}** dropdown menu`;
    } else if (elementInfo.tagName === 'option') {
      instructionText = `Select **${elementText}** from the dropdown menu`;
    } else if (elementInfo.tagName === 'input' && elementInfo.attributes.type === 'submit') {
      instructionText = `Click the **${elementText}** submit button`;
    } else if (elementInfo.tagName === 'input' && elementInfo.attributes.type === 'file') {
      instructionText = `Click to upload a file to the **${elementInfo.label || elementText}** field`;
    } else if (elementInfo.tagName === 'img') {
      instructionText = `Click on the ${elementInfo.attributes.alt ? `**${elementInfo.attributes.alt}**` : '**image**'}`;
    } else if (elementInfo.tagName === 'li' || elementRole === 'listitem') {
      instructionText = `Click on the **${elementText}** list item`;
    } else if (elementInfo.tagName === 'td' || elementInfo.tagName === 'th') {
      instructionText = `Click on the **${elementText}** table cell`;
    } else if (elementRole === 'tab') {
      instructionText = `Click on the **${elementText}** tab`;
    } else if (elementRole === 'menuitem') {
      instructionText = `Click on the **${elementText}** menu item`;
    } else {
      // More detailed description for other elements
      const typeName = elementType === 'div' || elementType === 'span' ? 'element' : elementType;
      instructionText = `Click on the **${elementText}** ${typeName}`;
    }
    
    return instructionText;
  } catch (error) {
    console.error("Error generating click instruction:", error);
    return `Click on this element`;
  }
}

// Generate an input instruction
function generateInputInstruction(elementInfo, isSensitive, actualValue) {
  try {
    let fieldName = elementInfo.label || 
                   elementInfo.ariaLabel ||
                   elementInfo.attributes.placeholder || 
                   elementInfo.attributes.name ||
                   elementInfo.attributes.id ||
                   'this field';
                   
    // Use Salesforce label if available
    if (isSalesforceMode && elementInfo.salesforce && elementInfo.salesforce.label) {
      fieldName = elementInfo.salesforce.label;
    }
    
    if (isSensitive) {
      return `Enter sensitive information in the **${fieldName}** field`;
    } else {
      // Truncate very long values
      const displayValue = actualValue.length > 30 ? 
                           actualValue.substring(0, 30) + '...' : 
                           actualValue;
      
      return `Type "${displayValue}" in the **${fieldName}** field`;
    }
  } catch (error) {
    console.error("Error generating input instruction:", error);
    return isSensitive ? 
      "Enter sensitive information in this field" : 
      `Type text in this field`;
  }
}

// Highlight an element with a distinctive overlay and add a red dot at click position
function highlightElement(element, clickX, clickY) {
  try {
    if (!element) return;
    
    // Remove existing highlight if any
    removeHighlight();
    
    // Create overlay
    highlightOverlay = document.createElement('div');
    
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
    
    // Add a pulse animation for better visibility
    highlightOverlay.style.animation = 'sotoscribe-pulse 1s infinite';
    
    // Create and add the animation style if not already present
    if (!document.getElementById('sotoscribe-highlight-style')) {
      const style = document.createElement('style');
      style.id = 'sotoscribe-highlight-style';
      style.innerHTML = `
        @keyframes sotoscribe-pulse {
          0% { box-shadow: 0 0 0 0 rgba(0, 179, 164, 0.4); }
          70% { box-shadow: 0 0 0 10px rgba(0, 179, 164, 0); }
          100% { box-shadow: 0 0 0 0 rgba(0, 179, 164, 0); }
        }
      `;
      document.head.appendChild(style);
    }
    
    // Add to document
    document.body.appendChild(highlightOverlay);
    
    // Create a red dot at the click position
    if (clickX && clickY) {
      const redDot = document.createElement('div');
      redDot.id = 'sotoscribe-click-dot';
      redDot.style.position = 'absolute';
      redDot.style.left = clickX + window.scrollX + 'px';
      redDot.style.top = clickY + window.scrollY + 'px';
      redDot.style.width = '20px';
      redDot.style.height = '20px';
      redDot.style.backgroundColor = 'rgba(255, 0, 0, 0.2)'; // Very transparent red (0.2 alpha)
      redDot.style.boxShadow = '0 0 0 3px rgba(255, 0, 0, 0.4)'; // Slightly more visible outline
      redDot.style.borderRadius = '50%';
      redDot.style.transform = 'translate(-50%, -50%)';
      redDot.style.zIndex = '9999999';
      redDot.style.pointerEvents = 'none';
      
      // Add to document
      document.body.appendChild(redDot);
    }
  } catch (error) {
    console.error("Error highlighting element:", error);
  }
}

// Remove the highlight overlay and red dot
function removeHighlight() {
  try {
    if (highlightOverlay && highlightOverlay.parentNode) {
      highlightOverlay.parentNode.removeChild(highlightOverlay);
    }
    highlightOverlay = null;
    
    // Also remove red dot if present
    const redDot = document.getElementById('sotoscribe-click-dot');
    if (redDot && redDot.parentNode) {
      redDot.parentNode.removeChild(redDot);
    }
  } catch (error) {
    console.error("Error removing highlight:", error);
  }
}

// Capture a screenshot of the current page with improved error handling
async function captureScreenshot() {
  try {
    return new Promise((resolve) => {
      // Set timeout to avoid hanging
      const timeoutId = setTimeout(() => {
        console.warn("Screenshot capture timed out");
        resolve(null); // Resolve with null on timeout instead of rejecting
      }, 5000);
      
      // Try to get a screenshot up to 3 times
      let attempts = 0;
      const maxAttempts = 3;
      
      function attemptScreenshot() {
        attempts++;
        
        // Send request to background script
        chrome.runtime.sendMessage({ action: 'captureScreenshot' }, (response) => {
          if (chrome.runtime.lastError) {
            console.error("Screenshot error:", chrome.runtime.lastError);
            
            if (attempts < maxAttempts) {
              // Try again after a short delay
              setTimeout(attemptScreenshot, 300);
            } else {
              clearTimeout(timeoutId);
              console.error("Failed to capture screenshot after multiple attempts");
              resolve(null);
            }
            return;
          }
          
          clearTimeout(timeoutId);
          
          if (response && response.screenshot) {
            console.log("Screenshot received successfully");
            resolve(response.screenshot);
          } else {
            if (attempts < maxAttempts) {
              // Try again after a short delay
              setTimeout(attemptScreenshot, 300);
            } else {
              console.error("Failed to get screenshot from background", response);
              resolve(null);
            }
          }
        });
      }
      
      // Start the first attempt
      attemptScreenshot();
    });
  } catch (error) {
    console.error("Error capturing screenshot:", error);
    return null;
  }
}

// Message listener for commands from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Content script received message:", message.action);
  
  try {
    if (message.action === 'startCapture') {
      isCapturing = true;
      sessionId = message.sessionId;
      isSalesforceMode = message.isSalesforce === true;
      pageNavigations = [window.location.href]; // Reset navigation history
      
      console.log("Starting capture with mode:", isSalesforceMode ? "Salesforce" : "Standard");
      
      setupListeners();
      
      // Capture initial page load as a step after a short delay
      setTimeout(async () => {
        try {
          // Skip if in iframe
          if (isInIframe()) {
            console.log("Skipping initial capture in iframe");
            return;
          }
          
          console.log("Capturing initial page load step");
          const screenshot = await captureScreenshot();
          
          // Skip if screenshot capture failed
          if (!screenshot) {
            console.error("Failed to capture initial screenshot, skipping initial step");
            return;
          }
          
          // Get more detailed page info
          const pageInfo = {
            url: window.location.href,
            path: window.location.pathname,
            query: window.location.search,
            domain: window.location.hostname,
            title: document.title
          };
          
          // Create step data for page load
          const stepData = {
            type: 'navigate',
            url: window.location.href,
            title: document.title,
            timestamp: Date.now(),
            pageInfo,
            instruction: `Navigate to **${document.title}** (${formatUrl(window.location.href)})`,
            screenshot
          };
          
          // Send step to background script
          chrome.runtime.sendMessage({
            action: 'addStep',
            data: stepData
          }, response => {
            if (response && response.success) {
              console.log("Initial navigation step added successfully");
            } else {
              console.error("Failed to add initial navigation step:", response);
            }
          });
        } catch (error) {
          console.error("Error capturing initial page state:", error);
        }
      }, 1000); // Wait 1 second to allow page to fully load
      
      sendResponse({ success: true });
    } else if (message.action === 'stopCapture') {
      isCapturing = false;
      sessionId = null;
      isSalesforceMode = false;
      removeListeners();
      removeHighlight();
      
      // Clear any pending timeouts
      pendingScreenshots.forEach(timeoutId => clearTimeout(timeoutId));
      pendingScreenshots.clear();
      
      // Clear UI change timeout if any
      if (salesforceUIChangeTimeout) {
        clearTimeout(salesforceUIChangeTimeout);
        salesforceUIChangeTimeout = null;
      }
      
      sendResponse({ success: true });
    }
  } catch (error) {
    console.error("Error handling message:", error);
    sendResponse({ success: false, error: error.message });
  }
  
  return true; // Required for async response
});

// Start listening for document ready state
waitForDocumentReady();

// Initialize the extension
function initialize() {
  console.log("Initializing content script");
  // Check if we're already in capture mode (in case of page refresh)
  chrome.runtime.sendMessage({ action: 'getState' }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn("Error getting state:", chrome.runtime.lastError);
      return;
    }
    
    if (response && response.isCapturing) {
      console.log("Already in capture mode, setting up listeners");
      isCapturing = true;
      setupListeners();
      
      // Add current URL to navigation history
      pageNavigations = [window.location.href];
      
      // Check if we're on Salesforce
      isSalesforceMode = window.location.href.includes('lightning.force.com') || 
                        window.location.href.includes('salesforce.com');
    } else {
      console.log("Not in capture mode");
    }
  });
}

// Add to window load event to handle Lightning apps that load after initial page load
window.addEventListener('load', function() {
  // Check again for Salesforce after full page load
  if (document.querySelector('.desktop, .oneApp, .slds-scope, .lightningContainer')) {
    console.log("Salesforce application detected after full page load");
    isSalesforceMode = true;
    
    // Update listeners with Salesforce-specific handling
    if (isCapturing) {
      console.log("Re-initializing with Salesforce mode");
      removeListeners();
      setupListeners();
    }
  }
});

// Start the extension once document is ready
if (document.readyState === 'complete') {
  initialize();
} else {
  document.addEventListener('DOMContentLoaded', initialize);
}
