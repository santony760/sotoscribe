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

// SotoScribe - Salesforce Handler
// Specialized handling for Salesforce Lightning UI with improved performance

import { BaseHandler } from './base-handler.js';
import { getElementInfo, generateInputInstruction } from './utils/element-info.js';
import { isSensitiveField, getMaskedValue } from './utils/sensitive-data.js';

// Enhanced logging for Salesforce
function sfLog(message, data) {
  console.log(`[SFDC] ${message}`, data || '');
}

export class SalesforceHandler extends BaseHandler {
  constructor() {
    super();
    
    // Override with Salesforce-specific properties
    this.isSalesforce = true;
    
    // Salesforce-specific state
    this.salesforceUIChangeTimeout = null;
    this.lastProcessedURl = null;
    this.lastNavigationTime = 0;
    this.lastInputDetectedTime = 0;
    this.lastKnownInputs = new Map(); // Track known input elements
    this.diagnosticMode = true; // Enable diagnostic logging
    
    // Custom event names for Lightning
    this.LIGHTNING_EVENTS = {
      PAGE_CHANGE: 'sotoscribe:pagechange',
      INPUT_CHANGE: 'sotoscribe:inputchange',
      COMPONENT_LOAD: 'sotoscribe:componentload'
    };
    
    sfLog("SalesforceHandler created with improved event delegation");
  }
  
  // Override: Initialize handler with Salesforce-specific setup
  async initialize() {
    // Call parent initialize for common setup
    await super.initialize();
    
    // Register custom events for Lightning components
    this.registerCustomEvents();
    
    // Create a single delegated event listener for common Salesforce interactions
    this.setupDelegatedEventListeners();
    
    // Initialize Lightning-specific handling if available
    if (typeof $A !== 'undefined') {
      try {
        $A.getCallback(() => {
          sfLog("Setting up Lightning framework listeners");
          this.setupLightningFrameworkListeners();
        })();
      } catch (error) {
        sfLog("Error accessing Lightning framework:", error);
      }
    }
    
    return true;
  }
  
  // Register custom events for Lightning components
  registerCustomEvents() {
    window.CustomEvent = window.CustomEvent || function(type, params) {
      params = params || { bubbles: false, cancelable: false, detail: null };
      const evt = document.createEvent('CustomEvent');
      evt.initCustomEvent(type, params.bubbles, params.cancelable, params.detail);
      return evt;
    };
    
    sfLog("Custom events registered for Lightning components");
  }
  
  // Setup efficient delegated event listeners for Salesforce
  setupDelegatedEventListeners() {
    // Single delegated click handler for the entire document
    document.addEventListener('click', (event) => {
      if (!this.isCapturing || !this.windowHasFocus) return;
      
      // Skip if not trusted
      if (!event.isTrusted) return;
      
      // Skip Sotoscribe overlay elements
      if (event.target.closest('[data-sotoscribe]')) return;
      
      // Handle the click
      this.handleSalesforceClick(event);
    }, true);
    
    // Single delegated change handler for inputs
    document.addEventListener('change', (event) => {
      if (!this.isCapturing || !this.windowHasFocus) return;
      
      // Skip if not trusted
      if (!event.isTrusted) return;
      
      // Skip Sotoscribe overlay elements
      if (event.target.closest('[data-sotoscribe]')) return;
      
      // For select elements, handle immediately
      if (event.target.tagName === 'SELECT') {
        this.handleSalesforceInput(event);
      }
    }, true);
    
    // Input handler for text fields with debounce
    document.addEventListener('input', (event) => {
      if (!this.isCapturing || !this.windowHasFocus) return;
      
      // Skip if not trusted
      if (!event.isTrusted) return;
      
      // Skip Sotoscribe overlay elements
      if (event.target.closest('[data-sotoscribe]')) return;
      
      // Track the element and last value
      const elementId = this.getElementId(event.target);
      const currentValue = this.getInputValue(event.target);
      
      // Store for future reference
      this.lastKnownInputs.set(elementId, {
        element: event.target,
        value: currentValue,
        timestamp: Date.now()
      });
      
      // Use the parent handler with appropriate debounce
      this.handleInputWithDebounce(event.target, 1000);
    }, true);
    
    // Focus handler for tracking active inputs
    document.addEventListener('focus', (event) => {
      if (!this.isCapturing || !this.windowHasFocus) return;
      
      // Skip if not an input element
      if (!this.isInputElement(event.target)) return;
      
      // Skip Sotoscribe overlay elements
      if (event.target.closest('[data-sotoscribe]')) return;
      
      // Track the element
      const elementId = this.getElementId(event.target);
      const currentValue = this.getInputValue(event.target);
      
      this.lastKnownInputs.set(elementId, {
        element: event.target,
        value: currentValue,
        timestamp: Date.now()
      });
    }, true);
    
    // Custom event listeners for Lightning components
    document.addEventListener(this.LIGHTNING_EVENTS.PAGE_CHANGE, (event) => {
      if (!this.isCapturing || !this.windowHasFocus) return;
      this.handleLightningPageChange(event.detail);
    });
    
    document.addEventListener(this.LIGHTNING_EVENTS.INPUT_CHANGE, (event) => {
      if (!this.isCapturing || !this.windowHasFocus) return;
      this.handleLightningInputChange(event.detail);
    });
    
    document.addEventListener(this.LIGHTNING_EVENTS.COMPONENT_LOAD, (event) => {
      if (!this.isCapturing || !this.windowHasFocus) return;
      this.handleLightningComponentLoad(event.detail);
    });
    
    // Monitor URL changes for Lightning navigation
    this.monitorURLChanges();
    
    sfLog("Delegated event listeners set up for Salesforce");
  }
  
  // Monitor URL changes in Salesforce Lightning
  monitorURLChanges() {
    // Check for URL changes every 500ms
    setInterval(() => {
      if (!this.isCapturing || !this.windowHasFocus) return;
      
      const currentUrl = window.location.href;
      
      // If URL changed and not too recent
      if (currentUrl !== this.lastProcessedURl && 
          Date.now() - this.lastNavigationTime > 500) {
        
        this.lastProcessedURl = currentUrl;
        this.lastNavigationTime = Date.now();
        
        // Handle as URL change
        this.handleUrlChange();
      }
    }, 500);
    
    sfLog("URL change monitoring set up");
  }
  
  // Setup Lightning framework-specific listeners
  setupLightningFrameworkListeners() {
    try {
      // Try to hook into Lightning's navigation events
      if (typeof $A !== 'undefined' && $A.eventService) {
        const originalFireEvent = $A.eventService.fireEvent;
        
        $A.eventService.fireEvent = function(eventName, ...args) {
          // Call original function
          const result = originalFireEvent.apply(this, [eventName, ...args]);
          
          // Check for navigation events
          if (eventName && (
              eventName.includes('navigate') || 
              eventName.includes('pageReference') ||
              eventName.includes('routeChange'))) {
            
            // Dispatch our custom event
            const navigateEvent = new CustomEvent('sotoscribe:pagechange', {
              bubbles: true,
              detail: { eventName, args }
            });
            document.dispatchEvent(navigateEvent);
          }
          
          return result;
        };
        
        sfLog("Lightning framework navigation events hooked");
      }
    } catch (error) {
      console.error("Error setting up Lightning framework listeners:", error);
    }
  }
  
  // Override: Start capture with Salesforce enhancements
  startCapture(sessionId) {
    sfLog("Starting capture in Salesforce mode with improved event handling");
    
    // Call base implementation
    super.startCapture(sessionId);
    
    // Capture initial state after a short delay
    setTimeout(() => {
      this.captureInitialState();
    }, 500);
  }
  
  // Override: Stop capture with Salesforce cleanup
  stopCapture() {
    sfLog("Stopping capture in Salesforce mode");
    
    // Clean up any Salesforce-specific timeouts
    if (this.salesforceUIChangeTimeout) {
      clearTimeout(this.salesforceUIChangeTimeout);
      this.salesforceUIChangeTimeout = null;
    }
    
    // Call base implementation
    super.stopCapture();
  }
  
  // Handle Salesforce-specific click events
  async handleSalesforceClick(event) {
    try {
      // Skip if not capturing
      if (!this.isCapturing) return;
      
      // Get the clicked element
      const element = event.target;
      this.lastActionElement = element;
      
      // Determine the element description with Salesforce enhancements
      const elementInfo = this.getSalesforceElementInfo(element);
      sfLog("Salesforce click on element:", elementInfo);
      
      // Capture the screenshot with the element highlighted (forced capture for clicks)
      this.highlightElement(element, event.clientX, event.clientY);
      const screenshot = await this.captureScreenshot(true); // force capture
      this.removeHighlight();
      
      // Generate instruction
      const instruction = this.generateSalesforceClickInstruction(elementInfo);
      
      // Create step data with Salesforce metadata
      const stepData = {
        type: 'click',
        url: window.location.href,
        title: document.title,
        timestamp: Date.now(),
        elementInfo,
        instruction,
        screenshot,
        salesforceMetadata: {
          isLightningComponent: this.isLightningElement(element),
          inShadowDOM: this.isInShadowDOM(element),
          captureMethod: 'event_handler'
        }
      };
      
      // Send step to background script
      sfLog("Sending Salesforce click step to background");
      chrome.runtime.sendMessage({
        action: 'addStep',
        data: stepData
      });
    } catch (error) {
      console.error("Error handling Salesforce click:", error);
    }
  }
  
  // Handle Salesforce-specific input with debouncing
  handleInputWithDebounce(element, debounceTime) {
    if (!this.isCapturing) return;
    
    const elementId = this.getElementId(element);
    
    // Clear any existing timeout for this element
    if (this.pendingScreenshots.has(elementId)) {
      clearTimeout(this.pendingScreenshots.get(elementId));
    }
    
    // Set a new timeout with Salesforce-specific debounce
    const timeoutId = setTimeout(async () => {
      sfLog(`Input debounce triggered for ${elementId}`);
      this.pendingScreenshots.delete(elementId);
      
      // Get actual input value
      const actualValue = this.getInputValue(element);
      
      // Update last known value for this input
      this.lastKnownInputs.set(elementId, {
        element,
        value: actualValue,
        timestamp: Date.now()
      });
      
      // Determine the element description
      const elementInfo = this.getSalesforceElementInfo(element);
      
      // Check if field contains sensitive data
      const isSensitive = isSensitiveField(element);
      
      // Create a masked value if needed
      const maskedValue = isSensitive ? getMaskedValue(element) : actualValue;
      
      // Highlight the element
      this.highlightElement(element);
      const screenshot = await this.captureScreenshot(true); // force capture for inputs
      this.removeHighlight();
      
      // Generate instruction with actual text for non-sensitive data
      const instruction = generateInputInstruction(elementInfo, isSensitive, actualValue, true);
      
      // Create step data with additional Salesforce info
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
        screenshot,
        salesforceMetadata: {
          isLightningComponent: this.isLightningElement(element),
          inShadowDOM: this.isInShadowDOM(element),
          captureMethod: 'event_handler'
        }
      };
      
      // Send step to background script
      sfLog("Sending Salesforce input step to background");
      chrome.runtime.sendMessage({
        action: 'addStep',
        data: stepData
      });
    }, debounceTime);
    
    this.pendingScreenshots.set(elementId, timeoutId);
  }
  
  // Handle Lightning page change event
  async handleLightningPageChange(detail) {
    sfLog("Lightning page change detected", detail);
    this.handleUrlChange();
  }
  
  // Handle Lightning input change event
  handleLightningInputChange(detail) {
    if (!detail || !detail.element) return;
    
    sfLog("Lightning input change detected", detail);
    
    // Handle as a regular input with the element from the event
    this.handleInputWithDebounce(detail.element, 1000);
  }
  
  // Handle Lightning component load event
  async handleLightningComponentLoad(detail) {
    sfLog("Lightning component load detected", detail);
    
    // Wait for the component to render
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Capture as a UI change
    this.handleSalesforceUIChange();
  }
  
  // Override handleUrlChange to use force capture for Salesforce navigation
  async handleUrlChange() {
    if (!this.isCapturing) return;
    
    try {
      const currentUrl = window.location.href;
      
      // Skip tracking domains
      if (currentUrl.includes('analytics') || 
          currentUrl.includes('tracker') || 
          currentUrl.includes('pixel')) {
        sfLog("Skipping tracking URL:", currentUrl);
        return;
      }
      
      // Update last URL and navigation time
      this.lastProcessedURl = currentUrl;
      this.lastNavigationTime = Date.now();
      
      sfLog("URL change detected in Salesforce:", currentUrl);
      
      // Wait a moment for page to render
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Capture screenshot (force capture for navigation)
      const screenshot = await this.captureScreenshot(true);
      if (!screenshot) {
        sfLog("Failed to capture screenshot for navigation, retrying...");
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
        screenshot: screenshot,
        salesforceMetadata: {
          captureMethod: 'event_handler'
        }
      };
      
      // Send step to background script
      chrome.runtime.sendMessage({
        action: 'addStep',
        data: stepData
      });
    } catch (error) {
      console.error("Error handling URL change in Salesforce:", error);
    }
  }
  
  // Handle Salesforce UI changes
  async handleSalesforceUIChange() {
    // Skip if not capturing or window doesn't have focus
    if (!this.isCapturing || !this.windowHasFocus) {
      return;
    }
    
    // Debounce UI changes to avoid capturing too many steps
    clearTimeout(this.salesforceUIChangeTimeout);
    this.salesforceUIChangeTimeout = setTimeout(async () => {
      try {
        sfLog("Handling Salesforce UI change");
        
        // Capture screenshot
        const screenshot = await this.captureScreenshot(true); // Force capture for UI changes
        if (!screenshot) {
          sfLog("Failed to capture screenshot for UI change, skipping step");
          return;
        }
        
        // Create step data for UI change
        const stepData = {
          type: 'ui_change',
          url: window.location.href,
          title: document.title,
          timestamp: Date.now(),
          instruction: `Salesforce UI updated on **${document.title}**`,
          screenshot,
          salesforceMetadata: {
            captureMethod: 'event_handler'
          }
        };
        
        // Send step to background script
        chrome.runtime.sendMessage({
          action: 'addStep',
          data: stepData
        });
      } catch (error) {
        console.error("Error handling Salesforce UI change:", error);
      }
    }, 500);
  }
  
  // Capture a screenshot with Salesforce-specific settings
  async captureScreenshot(forceCapture = false) {
    try {
      return new Promise((resolve) => {
        // Set timeout to avoid hanging
        const timeoutId = setTimeout(() => {
          console.warn("Screenshot capture timed out");
          resolve(null);
        }, 5000);
        
        // Try to get a screenshot up to 3 times
        let attempts = 0;
        const maxAttempts = 3;
        
        function attemptScreenshot() {
          attempts++;
          
          // Send request to background script with Salesforce flag and force capture
          chrome.runtime.sendMessage({ 
            action: 'captureScreenshot',
            isSalesforce: true,
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
      console.error("Error capturing screenshot in Salesforce:", error);
      return null;
    }
  }
  
  // Salesforce-specific element info extraction
  getSalesforceElementInfo(element) {
    // Get standard element info
    const baseInfo = getElementInfo(element);
    
    // Enhance with Salesforce-specific info
    try {
      const salesforceInfo = {};
      
      // Look for Lightning component containers
      const lightningComponent = this.findClosestLightningComponent(element);
      if (lightningComponent) {
        salesforceInfo.componentId = lightningComponent.getAttribute('data-component-id') || 
                                    lightningComponent.getAttribute('data-aura-rendered-by') ||
                                    lightningComponent.getAttribute('lightning-component-id');
        
        // Try to determine component type
        const componentType = 
          lightningComponent.getAttribute('data-component-type') ||
          lightningComponent.getAttribute('data-component-name') ||
          (lightningComponent.classList && Array.from(lightningComponent.classList)
            .find(cls => cls.startsWith('forcePage') || cls.startsWith('force') || cls.startsWith('lightning')));
        
        if (componentType) {
          salesforceInfo.componentType = componentType;
        }
      }
      
      // Look for SLDS classes which identify Salesforce components
      if (element.classList) {
        const sldsClasses = Array.from(element.classList).filter(cls => cls.startsWith('slds-'));
        if (sldsClasses.length > 0) {
          salesforceInfo.sldsClasses = sldsClasses;
          
          // Try to determine component type from SLDS classes
          if (sldsClasses.includes('slds-button')) {
            salesforceInfo.componentType = 'Button';
          } else if (sldsClasses.includes('slds-input')) {
            salesforceInfo.componentType = 'Input';
          } else if (sldsClasses.includes('slds-form-element')) {
            salesforceInfo.componentType = 'FormField';
          } else if (sldsClasses.includes('slds-modal')) {
            salesforceInfo.componentType = 'Modal';
          }
        }
      }
      
      // Check for Salesforce field labels with improved shadow DOM handling
      const fieldLabel = element.closest('.slds-form-element');
      if (fieldLabel) {
        // Check regular DOM
        let labelElement = fieldLabel.querySelector('.slds-form-element__label');
        
        if (labelElement) {
          salesforceInfo.label = labelElement.textContent.trim();
        }
      }
      
      // Add to base info
      baseInfo.salesforce = salesforceInfo;
      
      // Override elementName with better Salesforce-specific name if available
      if (salesforceInfo.label) {
        baseInfo.elementName = salesforceInfo.label;
      } else if (salesforceInfo.componentType) {
        if (baseInfo.elementName) {
          baseInfo.elementName = `${baseInfo.elementName} ${salesforceInfo.componentType}`;
        } else {
          baseInfo.elementName = salesforceInfo.componentType;
        }
      }
      
      return baseInfo;
    } catch (error) {
      console.error("Error getting Salesforce element info:", error);
      return baseInfo;
    }
  }
  
  // Generate Salesforce-specific click instruction
  generateSalesforceClickInstruction(elementInfo) {
    // Use Salesforce-specific naming if available
    if (elementInfo.salesforce) {
      const sfInfo = elementInfo.salesforce;
      
      if (sfInfo.componentType === 'Button') {
        return `Click the **${elementInfo.elementName || 'button'}**`;
      } else if (sfInfo.componentType === 'Tab') {
        return `Click the **${elementInfo.elementName || 'tab'}**`;
      } else if (sfInfo.label) {
        return `Click on **${sfInfo.label}**`;
      }
    }
    
    // Fall back to standard click instruction
    const elementText = elementInfo.elementName || 'element';
    const elementType = elementInfo.tagName || 'element';
    
    // Create a more descriptive instruction
    let typeName = elementType === 'div' || elementType === 'span' ? 'element' : elementType;
    return `Click on the **${elementText}** ${typeName}`;
  }
  
  // Find the closest Lightning component
  findClosestLightningComponent(element) {
    // Check if element itself is a Lightning component
    if (this.isLightningElement(element)) {
      return element;
    }
    
    // Check for standard Lightning containers
    const lightningComponent = element.closest('[data-component-id], [data-aura-rendered-by], [lightning-component-id]');
    if (lightningComponent) {
      return lightningComponent;
    }
    
    // Check for custom elements that might be Lightning components
    let current = element;
    while (current && current !== document.body) {
      if (current.tagName && current.tagName.includes('-')) {
        return current;
      }
      current = current.parentElement;
    }
    
    return null;
  }
  
  // Check if element is a Lightning component
  isLightningElement(element) {
    if (!element || !element.tagName) return false;
    
    // Check tag name (custom elements contain hyphen)
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
  
  // Check if element is in Shadow DOM
  isInShadowDOM(element) {
    let node = element;
    while (node) {
      if (node.getRootNode && node.getRootNode() !== document) {
        return true;
      }
      node = node.parentNode;
    }
    return false;
  }
  
  // Check if element is an input element
  isInputElement(element) {
    if (!element || !element.tagName) return false;
    
    const tagName = element.tagName.toLowerCase();
    
    // Standard input elements
    if (['input', 'select', 'textarea'].includes(tagName)) {
      return true;
    }
    
    // Elements with contenteditable
    if (element.getAttribute('contenteditable') === 'true') {
      return true;
    }
    
    // Lightning input components
    if (tagName.includes('-input') || 
        tagName.includes('-textarea') || 
        tagName.includes('-select')) {
      return true;
    }
    
    // Elements with input roles
    const role = element.getAttribute('role');
    if (role && ['textbox', 'combobox', 'listbox', 'checkbox', 'radio'].includes(role)) {
      return true;
    }
    
    // SLDS input elements
    if (element.classList && Array.from(element.classList).some(cls => 
        cls === 'slds-input' || 
        cls === 'slds-textarea' || 
        cls === 'slds-select' || 
        cls === 'slds-checkbox' || 
        cls === 'slds-radio')) {
      return true;
    }
    
    return false;
  }
  
  // Generate a unique ID for an element
  getElementId(element) {
    if (!element) return 'unknown_element';
    
    // Try standard IDs first
    if (element.id) return `id_${element.id}`;
    if (element.name) return `name_${element.name}`;
    
    // Try Lightning-specific IDs
    if (element.getAttribute('data-aura-rendered-by')) {
      return `aura_${element.getAttribute('data-aura-rendered-by')}`;
    }
    
    if (element.getAttribute('data-component-id')) {
      return `comp_${element.getAttribute('data-component-id')}`;
    }
    
    if (element.getAttribute('lightning-component-id')) {
      return `lightning_${element.getAttribute('lightning-component-id')}`;
    }
    
    // Fall back to creating a path-based ID
    const path = this.getSimplifiedPath(element);
    if (path) return `path_${path.replace(/[^a-zA-Z0-9]/g, '_')}`;
    
    // Last resort - generate random ID
    return `elem_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  // Get simplified path for element
  getSimplifiedPath(element) {
    try {
      const parts = [];
      let current = element;
      let depth = 0;
      const maxDepth = 3;
      
      while (current && current !== document.body && depth < maxDepth) {
        let identifier = current.tagName.toLowerCase();
        
        if (current.id) {
          identifier += `#${current.id}`;
          parts.unshift(identifier);
          break; // Stop at ID for uniqueness
        } else if (current.classList && current.classList.length) {
          identifier += `.${current.classList[0]}`;
        }
        
        parts.unshift(identifier);
        current = current.parentElement;
        depth++;
      }
      
      return parts.join('_');
    } catch (e) {
      return null;
    }
  }
  
  // Get input value with multiple strategies
  getInputValue(element) {
    if (!element) return '';
    
    try {
      // Standard value property
      if (element.value !== undefined) {
        return element.value;
      }
      
      // Text content for contenteditable
      if (element.getAttribute('contenteditable') === 'true') {
        return element.textContent || '';
      }
      
      // Check for Shadow DOM input
      if (element.shadowRoot) {
        const shadowInput = element.shadowRoot.querySelector('input, textarea');
        if (shadowInput && shadowInput.value !== undefined) {
          return shadowInput.value;
        }
      }
      
      // Check for special Lightning attributes
      if (element.getAttribute('data-value')) {
        return element.getAttribute('data-value');
      }
      
      // Look for input within the element
      const nestedInput = element.querySelector('input, textarea');
      if (nestedInput && nestedInput.value !== undefined) {
        return nestedInput.value;
      }
      
      // For Lightning components
      if (element.tagName && element.tagName.includes('-')) {
        // Try to access properties that might store the value
        if (element.value !== undefined) return element.value;
        if (element.checked !== undefined) return element.checked.toString();
        
        // For lightning-input-rich-text components
        const innerHTML = element.innerHTML;
        if (innerHTML && innerHTML.length > 0 && innerHTML !== '<br>') {
          return innerHTML;
        }
      }
      
      return '';
    } catch (e) {
      console.error("Error getting input value:", e);
      return '';
    }
  }
}