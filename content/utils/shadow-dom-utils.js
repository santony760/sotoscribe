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

// SotoScribe - Shadow DOM Utilities
// Helper functions for traversing and manipulating Shadow DOM elements

/**
 * Find elements that match a selector within shadow DOM trees
 * @param {Element} root - Root element to start searching from
 * @param {string} selector - CSS selector to match
 * @returns {Element[]} Array of matching elements
 */
export function findElementsInShadowDOM(root, selector) {
  const elements = [];
  
  // Skip if no root
  if (!root) return elements;
  
  // Helper function to traverse shadow DOM
  function traverse(node) {
    try {
      // Check if the node has a shadow root
      if (node.shadowRoot) {
        // Look for matching elements in this shadow root
        const shadowMatches = node.shadowRoot.querySelectorAll(selector);
        elements.push(...Array.from(shadowMatches));
        
        // Traverse children of the shadow root
        Array.from(node.shadowRoot.children).forEach(traverse);
      }
      
      // Traverse regular DOM children
      if (node.children) {
        Array.from(node.children).forEach(traverse);
      }
    } catch (error) {
      console.error("Error traversing shadow DOM:", error);
    }
  }
  
  // Start traversal
  traverse(root);
  return elements;
}

/**
 * Get all shadow roots within a subtree
 * @param {Element} root - Root element to start from
 * @returns {ShadowRoot[]} Array of shadow roots
 */
export function getAllShadowRoots(root) {
  const shadowRoots = [];
  
  function collectShadowRoots(node) {
    try {
      if (node.shadowRoot) {
        shadowRoots.push(node.shadowRoot);
        
        // Traverse shadow root children
        Array.from(node.shadowRoot.children).forEach(collectShadowRoots);
      }
      
      // Traverse regular DOM children
      if (node.children) {
        Array.from(node.children).forEach(collectShadowRoots);
      }
    } catch (error) {
      console.error("Error collecting shadow roots:", error);
    }
  }
  
  collectShadowRoots(root);
  return shadowRoots;
}

/**
 * Traverse all shadow roots starting from an element
 * @param {Element} element - Starting element
 * @param {Function} callback - Function to call for each shadow root
 */
export function traverseShadowRoots(element, callback) {
  const shadowRoots = getAllShadowRoots(element);
  shadowRoots.forEach(callback);
}

/**
 * Find closest element matching selector, traversing up through shadow DOM boundaries
 * @param {Element} element - Starting element
 * @param {string} selector - CSS selector to match
 * @returns {Element|null} Matching element or null
 */
export function shadowClosest(element, selector) {
  let current = element;
  
  while (current) {
    // Check if the current element matches
    if (current.matches && current.matches(selector)) {
      return current;
    }
    
    // Go up to parent
    let parent = current.parentElement;
    
    // If no parent but we're in a shadow root, go to the shadow host
    if (!parent && current.getRootNode && current.getRootNode() !== document) {
      const rootNode = current.getRootNode();
      parent = rootNode.host;
    }
    
    // Move to the parent
    current = parent;
    
    // Break if we reached the top
    if (!current || current === document.documentElement) {
      break;
    }
  }
  
  return null;
}

/**
 * Find Lightning components within shadow DOM
 * @param {Element} root - Root element to start from
 * @returns {Element[]} Array of Lightning components
 */
export function findLightningComponents(root) {
  const components = [];
  
  // Find custom elements (which are likely Lightning components)
  const customElements = Array.from(root.querySelectorAll('*')).filter(el => 
    el.tagName && el.tagName.includes('-')
  );
  
  components.push(...customElements);
  
  // Find elements with Lightning/Aura attributes
  const attrElements = Array.from(root.querySelectorAll('[data-aura-rendered-by], [data-component-id], [lightning-component-id]'));
  
  components.push(...attrElements);
  
  // Also look in shadow DOM
  traverseShadowRoots(root, (shadowRoot) => {
    // Find custom elements in shadow roots
    const shadowCustomElements = Array.from(shadowRoot.querySelectorAll('*')).filter(el => 
      el.tagName && el.tagName.includes('-')
    );
    
    components.push(...shadowCustomElements);
    
    // Find elements with Lightning/Aura attributes in shadow roots
    const shadowAttrElements = Array.from(shadowRoot.querySelectorAll('[data-aura-rendered-by], [data-component-id], [lightning-component-id]'));
    
    components.push(...shadowAttrElements);
  });
  
  // Remove duplicates
  return [...new Set(components)];
}

/**
 * Get computed styles for an element, including those in shadow DOM
 * @param {Element} element - Target element
 * @returns {CSSStyleDeclaration} Computed styles
 */
export function getShadowComputedStyle(element) {
  try {
    return window.getComputedStyle(element);
  } catch (error) {
    console.error("Error getting computed style:", error);
    return {};
  }
}

/**
 * Check if an element is visible, even in shadow DOM
 * @param {Element} element - Element to check
 * @returns {boolean} Whether the element is visible
 */
export function isShadowElementVisible(element) {
  try {
    if (!element) return false;
    
    // Get computed styles
    const styles = getShadowComputedStyle(element);
    
    // Check visibility
    return styles.display !== 'none' && 
           styles.visibility !== 'hidden' && 
           styles.opacity !== '0' && 
           styles.width !== '0px' && 
           styles.height !== '0px';
  } catch (error) {
    console.error("Error checking shadow element visibility:", error);
    return true; // Default to visible on error
  }
}

/**
 * Find label for an input element in shadow DOM
 * @param {Element} element - Input element
 * @returns {string} Label text or empty string
 */
export function findShadowInputLabel(element) {
  try {
    // Check for aria-label attribute
    if (element.getAttribute('aria-label')) {
      return element.getAttribute('aria-label');
    }
    
    // Check for standard label with for attribute
    if (element.id) {
      // Look in both light and shadow DOM
      const selector = `label[for="${element.id}"]`;
      
      // Check in regular DOM
      const lightLabel = document.querySelector(selector);
      if (lightLabel) {
        return lightLabel.textContent.trim();
      }
      
      // Check in shadow DOM
      const shadowLabels = findElementsInShadowDOM(document.body, selector);
      if (shadowLabels.length > 0) {
        return shadowLabels[0].textContent.trim();
      }
    }
    
    // Check for parent label
    const parentLabel = shadowClosest(element, 'label');
    if (parentLabel) {
      return parentLabel.textContent.trim();
    }
    
    // Check for Salesforce specific patterns
    
    // Salesforce Lightning form element label
    const formElement = shadowClosest(element, '.slds-form-element');
    if (formElement) {
      const labelElement = formElement.querySelector('.slds-form-element__label');
      if (labelElement) {
        return labelElement.textContent.trim();
      }
      
      // Look in shadow DOM
      const shadowLabels = findElementsInShadowDOM(formElement, '.slds-form-element__label');
      if (shadowLabels.length > 0) {
        return shadowLabels[0].textContent.trim();
      }
    }
    
    // Salesforce Lightning stacked form label
    const labelWrapper = shadowClosest(element, '.slds-form-element__row');
    if (labelWrapper) {
      const labelElement = labelWrapper.querySelector('.slds-form-element__label');
      if (labelElement) {
        return labelElement.textContent.trim();
      }
    }
    
    // Preceding sibling span or div that might contain label
    let sibling = element.previousElementSibling;
    while (sibling) {
      if ((sibling.tagName === 'SPAN' || sibling.tagName === 'DIV' || sibling.tagName === 'LABEL') &&
          sibling.textContent.trim()) {
        return sibling.textContent.trim();
      }
      sibling = sibling.previousElementSibling;
    }
    
    // Parent element with label semantics
    const labelParent = shadowClosest(element, '[role="label"], .slds-form-element__label, .slds-checkbox_faux, .slds-radio_faux');
    if (labelParent) {
      return labelParent.textContent.trim();
    }
    
    return '';
  } catch (error) {
    console.error("Error finding shadow input label:", error);
    return '';
  }
}