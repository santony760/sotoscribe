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

// In-memory state variables
let isCapturing = false;
let sessionId = null;
let lastActionElement = null;
let highlightOverlay = null;
let pageNavigations = [];

// Initialize event listeners
function setupListeners() {
  console.log("Setting up event listeners");
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
}

// Remove all event listeners
function removeListeners() {
  console.log("Removing event listeners");
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('keydown', handleKeyDown, true);
  document.removeEventListener('input', handleInput, true);
  document.removeEventListener('submit', handleFormSubmit, true);
  
  // Restore original pushState if we modified it
  if (window._originalPushState) {
    window.history.pushState = window._originalPushState;
  }
  
  window.removeEventListener('popstate', handleUrlChange);
}

// Handle URL changes (for SPAs)
async function handleUrlChange() {
  if (!isCapturing) return;
  
  const currentUrl = window.location.href;
  
  // Check if this is a new URL
  if (pageNavigations.includes(currentUrl)) return;
  
  console.log("URL change detected:", currentUrl);
  pageNavigations.push(currentUrl);
  
  // Capture screenshot
  const screenshot = await captureScreenshot();
  
  // Create step data for page navigation
  const stepData = {
    type: 'navigate',
    url: currentUrl,
    title: document.title,
    timestamp: Date.now(),
    instruction: `Navigate to **${document.title}** (${formatUrl(currentUrl)})`,
    screenshot
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
  console.log("Click event captured");
  
  // Get the clicked element
  const element = event.target;
  lastActionElement = element;
  
  // Determine the element description
  const elementInfo = getElementInfo(element);
  console.log("Element info:", elementInfo);
  
  // Capture the screenshot with the element highlighted
  highlightElement(element);
  console.log("Requesting screenshot");
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
}

// Handle form submission
async function handleFormSubmit(event) {
  if (!isCapturing) return;
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
}

// Handle keydown events
async function handleKeyDown(event) {
  if (!isCapturing) return;
  
  // Only capture keyboard shortcuts (with modifier keys)
  if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) {
    console.log("Keyboard shortcut captured");
    
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
}

// Handle input events
async function handleInput(event) {
  if (!isCapturing) return;
  console.log("Input event captured");
  
  // Get the input element
  const element = event.target;
  lastActionElement = element;
  
  // Don't capture every keystroke, use debounce pattern
  if (element._inputTimeout) {
    clearTimeout(element._inputTimeout);
  }
  
  element._inputTimeout = setTimeout(async () => {
    console.log("Input debounce triggered, capturing step");
    
    // Determine the element description
    const elementInfo = getElementInfo(element);
    
    // Get the actual input value
    const actualValue = element.value || element.innerText || '';
    
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
    
    delete element._inputTimeout;
  }, 1000); // Wait 1 second after typing stops
}

// Check if a field contains sensitive information
function isSensitiveField(element) {
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
}

// Get masked value for sensitive fields
function getMaskedValue(element) {
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
}

// Extract useful information about an element
function getElementInfo(element) {
  if (!element) return { tagName: 'unknown' };
  
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
  
  // Determine the most descriptive name for the element
  const elementName = 
    label ||
    ariaLabel ||
    ariaText ||
    element.getAttribute('placeholder') || 
    element.getAttribute('name') ||
    element.getAttribute('title') ||
    element.value || 
    (textContent && textContent.length < 30 ? textContent : '') ||
    (element.id ? '#' + element.id : '') ||
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
    path
  };
}

// Get a CSS selector path to the element
function getElementPath(element, maxDepth = 3) {
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
}

// Create a keyboard shortcut string (e.g., "Ctrl + C")
function generateKeyboardShortcut(event) {
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
}

// Generate a click instruction
function generateClickInstruction(elementInfo) {
  let instructionText = '';
  
  // Get additional details for better description
  const elementText = elementInfo.elementName || 'element';
  const elementType = elementInfo.tagName || 'element';
  const elementRole = elementInfo.role || '';
  
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
}

// Generate an input instruction
function generateInputInstruction(elementInfo, isSensitive, actualValue) {
  let fieldName = elementInfo.label || 
                  elementInfo.ariaLabel ||
                  elementInfo.attributes.placeholder || 
                  elementInfo.attributes.name ||
                  elementInfo.attributes.id ||
                  'this field';
  
  if (isSensitive) {
    return `Enter sensitive information in the **${fieldName}** field`;
  } else {
    // Truncate very long values
    const displayValue = actualValue.length > 30 ? 
                          actualValue.substring(0, 30) + '...' : 
                          actualValue;
    
    return `Type "${displayValue}" in the **${fieldName}** field`;
  }
}

// Highlight an element with a distinctive overlay
function highlightElement(element) {
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
}

// Remove the highlight overlay
function removeHighlight() {
  if (highlightOverlay && highlightOverlay.parentNode) {
    highlightOverlay.parentNode.removeChild(highlightOverlay);
  }
  highlightOverlay = null;
}

// Capture a screenshot of the current page
async function captureScreenshot() {
  return new Promise((resolve) => {
    // We can't directly capture screenshots from content scripts,
    // so we send a message to the background script to do it
    console.log("Requesting screenshot from background script");
    chrome.runtime.sendMessage({ action: 'captureScreenshot' }, (response) => {
      if (response && response.screenshot) {
        console.log("Screenshot received successfully");
        resolve(response.screenshot);
      } else {
        console.error("Failed to get screenshot from background", response);
        // Fallback: if we can't get a screenshot from the background,
        // we'll just resolve with a placeholder
        resolve(null);
      }
    });
  });
}

// Message listener for commands from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Content script received message:", message.action);
  
  if (message.action === 'startCapture') {
    isCapturing = true;
    sessionId = message.sessionId;
    pageNavigations = [window.location.href]; // Reset navigation history
    setupListeners();
    
    // Capture initial page load as a step
    setTimeout(async () => {
      console.log("Capturing initial page load step");
      const screenshot = await captureScreenshot();
      
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
    }, 500);
    
    sendResponse({ success: true });
  } else if (message.action === 'stopCapture') {
    isCapturing = false;
    sessionId = null;
    removeListeners();
    removeHighlight();
    sendResponse({ success: true });
  }
  
  return true; // Required for async response
});

// Initialize the extension
function initialize() {
  console.log("Initializing content script");
  // Check if we're already in capture mode (in case of page refresh)
  chrome.runtime.sendMessage({ action: 'getState' }, (response) => {
    if (response && response.isCapturing) {
      console.log("Already in capture mode, setting up listeners");
      isCapturing = true;
      setupListeners();
      
      // Add current URL to navigation history
      pageNavigations = [window.location.href];
    } else {
      console.log("Not in capture mode");
    }
  });
}

// Start the extension
initialize();
