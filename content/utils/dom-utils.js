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

// SotoScribe - DOM Utilities
// Helper functions for DOM manipulation and inspection

/**
 * Check if an element is visible in the viewport
 * @param {Element} element - Element to check
 * @returns {boolean} Whether the element is visible
 */
export function isElementVisible(element) {
  try {
    if (!element) return false;
    
    // Get computed styles
    const styles = window.getComputedStyle(element);
    
    // Check if element is hidden through CSS
    if (styles.display === 'none' || 
        styles.visibility === 'hidden' || 
        styles.opacity === '0') {
      return false;
    }
    
    // Get element's position
    const rect = element.getBoundingClientRect();
    
    // Check if element has zero size
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }
    
    // Check if element is in viewport
    const isInViewport = (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
    
    return isInViewport;
  } catch (error) {
    console.error("Error checking element visibility:", error);
    return true; // Default to visible on error
  }
}

/**
 * Get a CSS selector path to the element
 * @param {Element} element - Target element
 * @param {number} maxDepth - Maximum depth to traverse up the tree
 * @returns {string} CSS selector path
 */
export function getElementPath(element, maxDepth = 3) {
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

/**
 * Find the nearest label for an input element
 * @param {Element} element - Input element
 * @returns {string} Label text or empty string
 */
export function findLabelForElement(element) {
  try {
    // Check for aria-label attribute
    if (element.getAttribute('aria-label')) {
      return element.getAttribute('aria-label');
    }
    
    // Check for aria-labelledby attribute
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelElement = document.getElementById(labelledBy);
      if (labelElement) {
        return labelElement.textContent.trim();
      }
    }
    
    // Check for standard label with for attribute
    if (element.id) {
      const labelElement = document.querySelector(`label[for="${element.id}"]`);
      if (labelElement) {
        return labelElement.textContent.trim();
      }
    }
    
    // Check for parent label
    const parentLabel = element.closest('label');
    if (parentLabel) {
      return parentLabel.textContent.trim();
    }
    
    // Look for parent with title attribute
    let parent = element.parentElement;
    while (parent && parent !== document.body) {
      if (parent.getAttribute('title')) {
        return parent.getAttribute('title');
      }
      parent = parent.parentElement;
    }
    
    // Check if element has a placeholder
    if (element.getAttribute('placeholder')) {
      return element.getAttribute('placeholder');
    }
    
    // Look for preceding sibling that might be a label
    let sibling = element.previousElementSibling;
    while (sibling) {
      if ((sibling.tagName === 'LABEL' || sibling.tagName === 'SPAN' || sibling.tagName === 'DIV') && 
          sibling.textContent.trim()) {
        return sibling.textContent.trim();
      }
      sibling = sibling.previousElementSibling;
    }
    
    return '';
  } catch (error) {
    console.error("Error finding label for element:", error);
    return '';
  }
}

/**
 * Get all form fields within a form
 * @param {Element} form - Form element
 * @returns {Element[]} Array of form fields
 */
export function getFormFields(form) {
  try {
    if (!form) return [];
    
    // Use form.elements if available
    if (form.elements) {
      return Array.from(form.elements);
    }
    
    // Otherwise query for common form elements
    return Array.from(form.querySelectorAll('input, select, textarea, button'));
  } catch (error) {
    console.error("Error getting form fields:", error);
    return [];
  }
}

/**
 * Get the XPath of an element
 * @param {Element} element - Target element
 * @returns {string} XPath
 */
export function getElementXPath(element) {
  try {
    if (!element) return '';
    
    // Check for ID
    if (element.id) {
      return `//*[@id="${element.id}"]`;
    }
    
    // Get the path by walking up the DOM tree
    const paths = [];
    let current = element;
    
    while (current && current !== document.documentElement) {
      let index = 0;
      let hasFollowingSibling = false;
      
      // Find index among siblings
      if (current.parentNode) {
        const siblings = current.parentNode.children;
        const sameTags = Array.from(siblings).filter(sibling => 
          sibling.tagName === current.tagName
        );
        
        // If there are multiple siblings with same tag, we need an index
        if (sameTags.length > 1) {
          index = Array.from(sameTags).indexOf(current) + 1;
        }
        
        // Check if there are following siblings with same tag
        hasFollowingSibling = Array.from(siblings).some((sibling, sibIndex) => 
          sibIndex > Array.from(siblings).indexOf(current) && sibling.tagName === current.tagName
        );
      }
      
      // Create the path component
      const pathComponent = current.tagName.toLowerCase() + 
        (index > 0 || hasFollowingSibling ? `[${index}]` : '');
      
      paths.unshift(pathComponent);
      current = current.parentNode;
      
      if (!current || current.nodeType !== Node.ELEMENT_NODE) {
        break;
      }
    }
    
    return '/' + paths.join('/');
  } catch (error) {
    console.error("Error getting element XPath:", error);
    return '';
  }
}

/**
 * Find closest element matching a selector
 * @param {Element} element - Starting element
 * @param {string} selector - CSS selector
 * @returns {Element|null} Matching element or null
 */
export function closestElement(element, selector) {
  try {
    // Use native closest if available
    if (element.closest) {
      return element.closest(selector);
    }
    
    // Fallback for older browsers
    let current = element;
    while (current) {
      if (current.matches && current.matches(selector)) {
        return current;
      }
      current = current.parentElement;
    }
    
    return null;
  } catch (error) {
    console.error("Error finding closest element:", error);
    return null;
  }
}

/**
 * Check if an element is a form field
 * @param {Element} element - Element to check
 * @returns {boolean} Whether the element is a form field
 */
export function isFormField(element) {
  try {
    if (!element || !element.tagName) return false;
    
    const tagName = element.tagName.toLowerCase();
    
    // Standard form elements
    if (['input', 'select', 'textarea', 'button'].includes(tagName)) {
      return true;
    }
    
    // Elements with contenteditable
    if (element.getAttribute('contenteditable') === 'true') {
      return true;
    }
    
    // Elements with role attributes for form fields
    const role = element.getAttribute('role');
    if (role && ['textbox', 'combobox', 'listbox', 'button', 'checkbox', 'radio', 'switch'].includes(role)) {
      return true;
    }
    
    return false;
  } catch (error) {
    console.error("Error checking if element is form field:", error);
    return false;
  }
}

/**
 * Create a unique selector for an element
 * @param {Element} element - Target element
 * @returns {string} Unique CSS selector
 */
export function getUniqueSelector(element) {
  try {
    if (!element) return '';
    
    // If element has ID, use that
    if (element.id) {
      return `#${element.id}`;
    }
    
    // Try to create a selector with classes
    if (element.className) {
      const classes = element.className.trim().split(/\s+/);
      if (classes.length > 0 && classes[0]) {
        const classSelector = `.${classes.join('.')}`;
        
        // Check if this uniquely identifies the element
        if (document.querySelectorAll(classSelector).length === 1) {
          return classSelector;
        }
      }
    }
    
    // Fall back to tag name with nth-child
    let path = '';
    let current = element;
    
    while (current && current !== document.documentElement) {
      let selector = current.tagName.toLowerCase();
      
      // Add nth-child for uniqueness
      if (current.parentNode) {
        const siblings = current.parentNode.children;
        const index = Array.from(siblings).indexOf(current) + 1;
        selector += `:nth-child(${index})`;
      }
      
      path = path ? `${selector} > ${path}` : selector;
      
      // Break out if we have a sufficiently unique selector
      if (document.querySelectorAll(path).length === 1) {
        break;
      }
      
      current = current.parentNode;
      
      if (!current || current.nodeType !== Node.ELEMENT_NODE) {
        break;
      }
    }
    
    return path;
  } catch (error) {
    console.error("Error getting unique selector:", error);
    return '';
  }
}