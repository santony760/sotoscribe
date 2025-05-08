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

// SotoScribe - Sensitive Data Utilities
// Functions for detecting and masking sensitive information

/**
 * Check if a field contains sensitive information
 * @param {Element} element - Form field element to check
 * @returns {boolean} Whether the field contains sensitive data
 */
export function isSensitiveField(element) {
  try {
    // Check the element type
    if (element.type === 'password') return true;
    
    // Check element attributes
    const sensitiveAttributes = [
      'password', 'secret', 'token', 'key', 'auth', 
      'ssn', 'social', 'creditcard', 'card', 'cvv', 'ccv', 
      'secure', 'private', 'confidential', 'sensitive'
    ];
    
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
    
    // Check for parent label
    const parentLabel = element.closest('label');
    if (parentLabel && parentLabel.textContent) {
      const labelText = parentLabel.textContent.toLowerCase();
      if (sensitiveAttributes.some(term => labelText.includes(term))) {
        return true;
      }
    }
    
    // Check for Salesforce labels nearby
    const formElement = element.closest('.slds-form-element');
    if (formElement) {
      const label = formElement.querySelector('.slds-form-element__label');
      if (label && label.textContent) {
        const labelText = label.textContent.toLowerCase();
        if (sensitiveAttributes.some(term => labelText.includes(term))) {
          return true;
        }
      }
    }
    
    // Check for common patterns in the value
    const value = element.value || '';
    
    // Email pattern
    if (value && value.match(/^[^@\s]+@[^@\s\.]+\.[^@\s]+$/)) {
      return true;
    }
    
    // Credit card pattern (simplified)
    if (value && value.match(/^\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}$/)) {
      return true;
    }
    
    // SSN pattern (US)
    if (value && value.match(/^\d{3}-?\d{2}-?\d{4}$/)) {
      return true;
    }
    
    // Phone number pattern
    if (value && value.match(/^(\+\d{1,3}[- ]?)?\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}$/)) {
      return true;
    }
    
    return false;
  } catch (error) {
    console.error("Error checking for sensitive field:", error);
    return false; // Default to not sensitive on error
  }
}

/**
 * Get masked value for sensitive fields
 * @param {Element} element - Form field element
 * @returns {string} Masked value
 */
export function getMaskedValue(element) {
  try {
    // Determine type of sensitive data
    if (element.type === 'password') {
      return '[PASSWORD]';
    }
    
    const value = element.value || '';
    
    // Email pattern
    if (value.match(/^[^@\s]+@[^@\s\.]+\.[^@\s]+$/)) {
      // Mask email but keep domain
      const parts = value.split('@');
      if (parts.length === 2) {
        const username = parts[0];
        const domain = parts[1];
        const maskedUsername = username.charAt(0) + 
                               '*'.repeat(Math.max(1, username.length - 2)) + 
                               (username.length > 1 ? username.charAt(username.length - 1) : '');
        return `${maskedUsername}@${domain}`;
      }
      return '[EMAIL]';
    }
    
    // Credit card pattern (simplified)
    if (value.match(/^\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}$/)) {
      // Keep only last 4 digits
      const digitsOnly = value.replace(/[^\d]/g, '');
      if (digitsOnly.length >= 12) {
        return '*'.repeat(digitsOnly.length - 4) + digitsOnly.slice(-4);
      }
      return '[CREDIT CARD]';
    }
    
    // SSN pattern (US)
    if (value.match(/^\d{3}-?\d{2}-?\d{4}$/)) {
      // Keep only last 4 digits
      const digitsOnly = value.replace(/[^\d]/g, '');
      return `XXX-XX-${digitsOnly.slice(-4)}`;
    }
    
    // Phone number pattern
    if (value.match(/^(\+\d{1,3}[- ]?)?\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}$/)) {
      // Keep part of the phone number
      const digitsOnly = value.replace(/[^\d]/g, '');
      if (digitsOnly.length >= 10) {
        const lastFour = digitsOnly.slice(-4);
        return `(XXX) XXX-${lastFour}`;
      }
      return '[PHONE NUMBER]';
    }
    
    // Default mask
    return '[SENSITIVE DATA]';
  } catch (error) {
    console.error("Error getting masked value:", error);
    return '[MASKED]'; // Default mask on error
  }
}

/**
 * Check if a field value looks like PII (Personally Identifiable Information)
 * @param {string} value - Field value to check
 * @returns {boolean} Whether the value appears to be PII
 */
export function isPIIValue(value) {
  if (!value || typeof value !== 'string') return false;
  
  try {
    // Email pattern
    if (value.match(/^[^@\s]+@[^@\s\.]+\.[^@\s]+$/)) {
      return true;
    }
    
    // Credit card pattern
    if (value.match(/^\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}$/)) {
      return true;
    }
    
    // SSN pattern (US)
    if (value.match(/^\d{3}-?\d{2}-?\d{4}$/)) {
      return true;
    }
    
    // Phone number pattern
    if (value.match(/^(\+\d{1,3}[- ]?)?\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}$/)) {
      return true;
    }
    
    // Address pattern (simplified)
    if (value.match(/^\d+\s+[A-Za-z\s]+,\s+[A-Za-z\s]+,\s+[A-Z]{2}\s+\d{5}(-\d{4})?$/)) {
      return true;
    }
    
    // Name pattern (simplified - two words, capitalized)
    if (value.match(/^[A-Z][a-z]+\s+[A-Z][a-z]+$/)) {
      return true;
    }
    
    return false;
  } catch (error) {
    console.error("Error checking for PII value:", error);
    return false;
  }
}

/**
 * Get a masked version of a PII value
 * @param {string} value - Original value
 * @param {string} type - Type of PII (optional)
 * @returns {string} Masked value
 */
export function maskPIIValue(value, type = null) {
  if (!value || typeof value !== 'string') return '[MASKED]';
  
  try {
    // Determine type if not provided
    const detectedType = type || detectPIIType(value);
    
    switch(detectedType) {
      case 'email':
        // Mask email but keep domain
        const parts = value.split('@');
        if (parts.length === 2) {
          const username = parts[0];
          const domain = parts[1];
          const maskedUsername = username.charAt(0) + 
                                '*'.repeat(Math.max(1, username.length - 2)) + 
                                (username.length > 1 ? username.charAt(username.length - 1) : '');
          return `${maskedUsername}@${domain}`;
        }
        return '[EMAIL]';
        
      case 'creditCard':
        // Keep only last 4 digits
        const digitsOnly = value.replace(/[^\d]/g, '');
        if (digitsOnly.length >= 12) {
          return '*'.repeat(digitsOnly.length - 4) + digitsOnly.slice(-4);
        }
        return '[CREDIT CARD]';
        
      case 'ssn':
        // Keep only last 4 digits
        const ssnDigits = value.replace(/[^\d]/g, '');
        return `XXX-XX-${ssnDigits.slice(-4)}`;
        
      case 'phone':
        // Keep part of the phone number
        const phoneDigits = value.replace(/[^\d]/g, '');
        if (phoneDigits.length >= 10) {
          const lastFour = phoneDigits.slice(-4);
          return `(XXX) XXX-${lastFour}`;
        }
        return '[PHONE NUMBER]';
        
      case 'address':
        // Just indicate it's an address
        return '[ADDRESS]';
        
      case 'name':
        // Mask name but keep first initials
        const nameParts = value.split(/\s+/);
        if (nameParts.length >= 2) {
          return nameParts.map(part => part.charAt(0) + '*'.repeat(Math.max(1, part.length - 1))).join(' ');
        }
        return '[NAME]';
        
      default:
        return '[SENSITIVE DATA]';
    }
  } catch (error) {
    console.error("Error masking PII value:", error);
    return '[MASKED]';
  }
}

/**
 * Detect the type of PII
 * @param {string} value - Value to check
 * @returns {string|null} Type of PII or null
 */
function detectPIIType(value) {
  if (!value || typeof value !== 'string') return null;
  
  // Email pattern
  if (value.match(/^[^@\s]+@[^@\s\.]+\.[^@\s]+$/)) {
    return 'email';
  }
  
  // Credit card pattern
  if (value.match(/^\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}$/)) {
    return 'creditCard';
  }
  
  // SSN pattern (US)
  if (value.match(/^\d{3}-?\d{2}-?\d{4}$/)) {
    return 'ssn';
  }
  
  // Phone number pattern
  if (value.match(/^(\+\d{1,3}[- ]?)?\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}$/)) {
    return 'phone';
  }
  
  // Address pattern (simplified)
  if (value.match(/^\d+\s+[A-Za-z\s]+,\s+[A-Za-z\s]+,\s+[A-Z]{2}\s+\d{5}(-\d{4})?$/)) {
    return 'address';
  }
  
  // Name pattern (simplified - two words, capitalized)
  if (value.match(/^[A-Z][a-z]+\s+[A-Z][a-z]+$/)) {
    return 'name';
  }
  
  return null;
}