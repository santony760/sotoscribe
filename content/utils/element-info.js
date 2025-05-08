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

// SotoScribe - Element Information Utilities
// Functions for extracting and generating information about DOM elements

import { findLabelForElement } from './dom-utils.js';
import { findShadowInputLabel } from './shadow-dom-utils.js';

/**
 * Extract useful information about an element
 * @param {Element} element - Target element
 * @returns {Object} Element information
 */
export function getElementInfo(element) {
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
    let label = findLabelForElement(element);
    
    // Try shadow DOM label finding if no label found
    if (!label) {
      label = findShadowInputLabel(element);
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
    
    return {
      tagName,
      attributes,
      textContent,
      elementName,
      label,
      ariaLabel,
      role,
      isVisible,
      dimensions
    };
  } catch (error) {
    console.error("Error getting element info:", error);
    return { 
      tagName: element.tagName?.toLowerCase() || 'unknown',
      error: 'Failed to get complete element info'
    };
  }
}

/**
 * Generate a click instruction
 * @param {Object} elementInfo - Element information
 * @returns {string} Instruction text
 */
export function generateClickInstruction(elementInfo) {
  try {
    let instructionText = '';
    
    // Get additional details for better description
    const elementText = elementInfo.elementName || 'element';
    const elementType = elementInfo.tagName || 'element';
    const elementRole = elementInfo.role || '';
    
    // Salesforce-specific handling
    if (elementInfo.salesforce && Object.keys(elementInfo.salesforce).length > 0) {
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

/**
 * Generate an input instruction
 * @param {Object} elementInfo - Element information
 * @param {boolean} isSensitive - Whether the field contains sensitive data
 * @param {string} actualValue - The value entered
 * @param {boolean} isSalesforce - Whether this is a Salesforce element
 * @returns {string} Instruction text
 */
export function generateInputInstruction(elementInfo, isSensitive, actualValue, isSalesforce = false) {
  try {
    let fieldName = elementInfo.label || 
                   elementInfo.ariaLabel ||
                   elementInfo.attributes?.placeholder || 
                   elementInfo.attributes?.name ||
                   elementInfo.attributes?.id ||
                   'this field';
                   
    // Use Salesforce label if available
    if (isSalesforce && elementInfo.salesforce && elementInfo.salesforce.label) {
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

/**
 * Create a keyboard shortcut string (e.g., "Ctrl + C")
 * @param {KeyboardEvent} event - Keyboard event
 * @returns {string} Human-readable shortcut
 */
export function generateKeyboardShortcut(event) {
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

/**
 * Generate a form submission instruction
 * @param {Element} formElement - Form element
 * @param {Object} formData - Form data
 * @returns {string} Instruction text
 */
export function generateFormSubmitInstruction(formElement, formData) {
  try {
    let formName = formElement.id || 
                   formElement.name || 
                   formElement.getAttribute('aria-label') ||
                   'form';
    
    // Get the submit button text if available
    const submitButton = formElement.querySelector('button[type="submit"], input[type="submit"]');
    const submitText = submitButton ? 
                      (submitButton.value || submitButton.textContent || 'Submit') : 
                      'Submit';
    
    return `Click the **${submitText}** button to submit the **${formName}** form`;
  } catch (error) {
    console.error("Error generating form submit instruction:", error);
    return `Submit the form`;
  }
}