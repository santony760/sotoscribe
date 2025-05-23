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

// SotoScribe - Base Handler for Standard Websites
// Handles DOM events and screenshot capturing for non-Salesforce sites

import { isElementVisible, getElementPath } from './utils/dom-utils.js';
import { isSensitiveField, getMaskedValue } from './utils/sensitive-data.js';
import { getElementInfo, generateClickInstruction, generateInputInstruction, generateKeyboardShortcut } from './utils/element-info.js';

export class BaseHandler {
  constructor() {
    // State variables
    this.isCapturing = false;
    this.sessionId = null;
    this.lastActionElement = null;
    this.highlightOverlay = null;
    this.pageNavigations = [];
    this.isSalesforce = false;
    
    // Throttle state for input events
    this.pendingScreenshots = new Map();
    this.SCREENSHOT_THROTTLE_MS = 1000; // Minimum 1 second between screenshots
    
    // Track window focus state
    this.windowHasFocus = document.hasFocus();
    
    // Track last actions to prevent duplicates
    this.lastActionDetails = {
      type: null,
      elementPath: null,
      timestamp: 0,
      value: null
    };
    
    // Bind event handlers to preserve 'this' context
    this.handleClick = this.handleClick.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleInput = this.handleInput.bind(this);
    this.handleFormSubmit = this.handleFormSubmit.bind(this);
    this.handleUrlChange = this.handleUrlChange.bind(this);
    this.handleFocus = this.handleFocus.bind(this);
    this.handleBlur = this.handleBlur.bind(this);
    
    console.log("BaseHandler created for standard website");
  }
  
  // Initialize the handler
  async initialize() {
    // Setup focus/blur tracking
    window.addEventListener('focus', this.handleFocus);
    window.addEventListener('blur', this.handleBlur);
    
    // Add highlight styles
    this.injectHighlightStyles();
    
    return true;
  }
  
  // Start capturing
  startCapture(sessionId) {
    console.log("Starting capture with BaseHandler");
    this.isCapturing = true;
    this.sessionId = sessionId;
    this.pageNavigations = [window.location.href]; // Reset navigation history
    
    this.setupListeners();
    this.injectSessionIndicator();
  }
  
  // Stop capturing
  stopCapture() {
    console.log("Stopping capture with BaseHandler");
    this.isCapturing = false;
    this.sessionId = null;
    
    this.removeListeners();
    this.removeHighlight();
    this.removeSessionIndicator();
    
    // Clear any pending timeouts
    this.pendingScreenshots.forEach(timeoutId => clearTimeout(timeoutId));
    this.pendingScreenshots.clear();
  }
  
  // Handle messages from the router
  handleMessage(message, sendResponse) {
    // Handle specific messages if needed
    sendResponse({ success: true });
  }
  
  // Capture initial page state
  async captureInitialState() {
    if (!this.isCapturing) return;
    
    try {
      console.log("Capturing initial page load step");
      const screenshot = await this.captureScreenshot(true); // Force capture for initial state
      
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
        instruction: `Navigate to **${document.title}** (${this.formatUrl(window.location.href)})`,
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
  }
  
  // Initialize event listeners
  setupListeners() {
    console.log("Setting up event listeners");
    
    try {
      document.addEventListener('click', this.handleClick, true);
      document.addEventListener('keydown', this.handleKeyDown, true);
      document.addEventListener('input', this.handleInput, true);
      document.addEventListener('submit', this.handleFormSubmit, true);
      
      // Also track URL changes for SPAs
      if (window.history && window.history.pushState) {
        const originalPushState = window.history.pushState;
        window.history.pushState = function() {
          originalPushState.apply(this, arguments);
          this.handleUrlChange();
        }.bind(this);
        
        window.addEventListener('popstate', this.handleUrlChange);
      }
      
      console.log("Event listeners setup complete");
    } catch (error) {
      console.error("Error setting up event listeners:", error);
    }
  }
  
  // Remove all event listeners
  removeListeners() {
    console.log("Removing event listeners");
    
    try {
      document.removeEventListener('click', this.handleClick, true);
      document.removeEventListener('keydown', this.handleKeyDown, true);
      document.removeEventListener('input', this.handleInput, true);
      document.removeEventListener('submit', this.handleFormSubmit, true);
      
      // Restore original pushState if we modified it
      if (window._originalPushState) {
        window.history.pushState = window._originalPushState;
      }
      
      window.removeEventListener('popstate', this.handleUrlChange);
      
      console.log("Event listeners removed");
    } catch (error) {
      console.error("Error removing event listeners:", error);
    }
  }
  
  // Focus and blur handlers
  handleFocus() {
    this.windowHasFocus = true;
  }
  
  handleBlur() {
    this.windowHasFocus = false;
  }
  
  // Check if action is a duplicate
  isDuplicateAction(type, element, details = {}) {
    const elementPath = element ? getElementPath(element) : null;
    
    // If it's the same type of action on the same element within 1 second
    if (this.lastActionDetails.type === type && 
        this.lastActionDetails.elementPath === elementPath &&
        Date.now() - this.lastActionDetails.timestamp < 1000) {
      
      // For inputs, check if value is the same
      if (type === 'input' && details.value !== undefined) {
        return details.value === this.lastActionDetails.value;
      }
      
      return true;
    }
    
    // Update last action
    this.lastActionDetails = {
      type,
      elementPath,
      timestamp: Date.now(),
      ...details
    };
    
    return false;
  }
  
  // Handle URL changes (for SPAs)
  async handleUrlChange() {
    if (!this.isCapturing) return;
    
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
      if (this.pageNavigations.includes(currentUrl)) return;
      
      console.log("URL change detected:", currentUrl);
      this.pageNavigations.push(currentUrl);
      
      // Skip if within 500ms of another URL change (debounce)
      if (this.isDuplicateAction('navigate', null, { url: currentUrl })) {
        console.log("Ignoring rapid URL change");
        return;
      }
      
      // Wait a moment for page to render
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Capture screenshot (force capture for navigation)
      const screenshot = await this.captureScreenshot(true);
      if (!screenshot) {
        console.log("Failed to capture screenshot for navigation, retrying...");
        await new Promise(resolve => setTimeout(resolve, 500));
        const retryScreenshot = await this.captureScreenshot(true);
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
        instruction: `Navigate to **${document.title}** (${this.formatUrl(currentUrl)})`,
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
  
  // Handle click events
  async handleClick(event) {
    if (!this.isCapturing) return;
    
    try {
      // Skip if window doesn't have focus
      if (!this.windowHasFocus) {
        console.log("Ignoring click while window doesn't have focus");
        return;
      }
      
      // Skip programmatically triggered clicks
      if (!event.isTrusted) {
        console.log("Ignoring non-user click event");
        return;
      }
      
      // Skip clicks on SotoScribe overlay elements
      if (event.target.closest('[data-sotoscribe]')) {
        console.log("Ignoring click on SotoScribe overlay");
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
      if (this.isDuplicateAction('click', element)) {
        console.log("Ignoring duplicate click action");
        return;
      }
      
      console.log("Click event captured");
      
      // Get the clicked element
      this.lastActionElement = element;
      
      // Determine the element description
      const elementInfo = getElementInfo(element);
      console.log("Element info:", elementInfo);
      
      // Capture the screenshot with the element highlighted and red dot at click position
      this.highlightElement(element, event.clientX, event.clientY);
      
      // Force capture screenshot for clicks
      const screenshot = await this.captureScreenshot(true);
      this.removeHighlight();
      
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
  async handleFormSubmit(event) {
    if (!this.isCapturing) return;
    
    try {
      // Skip if window doesn't have focus
      if (!this.windowHasFocus) {
        console.log("Ignoring form submission while window doesn't have focus");
        return;
      }
      
      // Skip programmatically triggered form submissions
      if (!event.isTrusted) {
        console.log("Ignoring non-user form submission");
        return;
      }
      
      // Skip form submissions from SotoScribe overlays
      if (event.target.closest('[data-sotoscribe]')) {
        console.log("Ignoring form submission from SotoScribe overlay");
        return;
      }
      
      // Check for duplicate submission
      if (this.isDuplicateAction('form_submit', event.target)) {
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
      
      // Capture screenshot (force capture for form submission)
      const screenshot = await this.captureScreenshot(true);
      
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
  async handleKeyDown(event) {
    if (!this.isCapturing) return;
    
    try {
      // Skip if window doesn't have focus
      if (!this.windowHasFocus) {
        console.log("Ignoring keyboard event while window doesn't have focus");
        return;
      }
      
      // Skip programmatically triggered key events
      if (!event.isTrusted) {
        console.log("Ignoring non-user keyboard event");
        return;
      }
      
      // Skip keyboard events from SotoScribe overlays
      if (event.target.closest('[data-sotoscribe]')) {
        console.log("Ignoring keyboard event from SotoScribe overlay");
        return;
      }
      
      // Only capture keyboard shortcuts (with modifier keys)
      if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) {
        console.log("Keyboard shortcut captured");
        
        // Check for duplicate keyboard shortcut
        if (this.isDuplicateAction('keyboard', document.activeElement)) {
          console.log("Ignoring duplicate keyboard shortcut");
          return;
        }
        
        // Create a human-readable keyboard shortcut
        const shortcut = generateKeyboardShortcut(event);
        
        // Target element
        const targetElement = document.activeElement;
        const elementInfo = targetElement ? getElementInfo(targetElement) : null;
        
        // Capture screenshot (force capture for keyboard shortcuts)
        const screenshot = await this.captureScreenshot(true);
        
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
  handleInput(event) {
    if (!this.isCapturing) return;
    
    try {
      // Skip if window doesn't have focus
      if (!this.windowHasFocus) {
        console.log("Ignoring input while window doesn't have focus");
        return;
      }
      
      // Skip programmatically triggered input events
      if (!event.isTrusted) {
        console.log("Ignoring non-user input event");
        return;
      }
      
      // Skip input events from SotoScribe overlays
      if (event.target.closest('[data-sotoscribe]')) {
        console.log("Ignoring input from SotoScribe overlay");
        return;
      }
      
      console.log("Input event captured");
      
      // Get the input element
      const element = event.target;
      this.lastActionElement = element;
      
      // Generate a unique ID for this element
      const elementId = element.id || element.name || `elem_${Math.random().toString(36).substr(2, 9)}`;
      
      // Clear any existing timeout for this element
      if (this.pendingScreenshots.has(elementId)) {
        clearTimeout(this.pendingScreenshots.get(elementId));
      }
      
      // Set a new timeout
      const timeoutId = setTimeout(async () => {
        console.log("Input debounce triggered, capturing step for", elementId);
        this.pendingScreenshots.delete(elementId);
        
        // Get actual input value
        const actualValue = element.value || element.innerText || '';
        
        // Check for duplicate input with same value
        if (this.isDuplicateAction('input', element, { value: actualValue })) {
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
        this.highlightElement(element);
        const screenshot = await this.captureScreenshot(true); // Force capture for inputs
        this.removeHighlight();
        
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
      
      this.pendingScreenshots.set(elementId, timeoutId);
    } catch (error) {
      console.error("Error handling input:", error);
    }
  }
  
  // Format URL for display
  formatUrl(url) {
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
  
  // Capture a screenshot of the current page
  async captureScreenshot(forceCapture = false) {
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
          chrome.runtime.sendMessage({ 
            action: 'captureScreenshot',
            forceCapture: forceCapture
          }, (response) => {
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
  
  // Inject highlight styles
  injectHighlightStyles() {
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
  
  // Highlight an element with a distinctive overlay and add a red dot at click position
  highlightElement(element, clickX, clickY) {
    try {
      if (!element) return;
      
      // Remove existing highlight if any
      this.removeHighlight();
      
      // Create overlay
      this.highlightOverlay = document.createElement('div');
      this.highlightOverlay.setAttribute('data-sotoscribe', 'highlight');
      
      // Get element position
      const rect = element.getBoundingClientRect();
      
      // Style the overlay
      this.highlightOverlay.style.position = 'absolute';
      this.highlightOverlay.style.left = rect.left + window.scrollX + 'px';
      this.highlightOverlay.style.top = rect.top + window.scrollY + 'px';
      this.highlightOverlay.style.width = rect.width + 'px';
      this.highlightOverlay.style.height = rect.height + 'px';
      this.highlightOverlay.style.border = '3px solid #00B3A4';
      this.highlightOverlay.style.boxSizing = 'border-box';
      this.highlightOverlay.style.pointerEvents = 'none';
      this.highlightOverlay.style.zIndex = '999999';
      this.highlightOverlay.style.animation = 'sotoscribe-pulse 1s infinite';
      
      // Add to document
      document.body.appendChild(this.highlightOverlay);
      
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
  removeHighlight() {
    try {
      if (this.highlightOverlay && this.highlightOverlay.parentNode) {
        this.highlightOverlay.parentNode.removeChild(this.highlightOverlay);
      }
      this.highlightOverlay = null;
      
      // Also remove red dot if present
      const redDot = document.getElementById('sotoscribe-click-dot');
      if (redDot && redDot.parentNode) {
        redDot.parentNode.removeChild(redDot);
      }
    } catch (error) {
      console.error("Error removing highlight:", error);
    }
  }
  
  // Client-side function to inject session indicator
  injectSessionIndicator() {
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
  
  // Client-side function to remove session indicator
  removeSessionIndicator() {
    const indicator = document.getElementById('sotoscribe-indicator');
    if (indicator) {
      indicator.remove();
    }
  }
}