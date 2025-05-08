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

// SotoScribe - Shared Utilities
// Common utility functions used across the extension

import { config } from './config.js';

/**
 * Check if a URL is a restricted browser system URL
 * @param {string} url - URL to check
 * @returns {boolean} Whether the URL is restricted
 */
export function isRestrictedUrl(url) {
  // If it's your Salesforce instance, explicitly allow it
  if (url && url.includes('icertis.lightning.force.com')) {
    return false; // Not restricted - allow this domain
  }
  
  // Check against restricted URL patterns from config
  return url && config.DOMAIN_PATTERNS.RESTRICTED.some(pattern => url.startsWith(pattern));
}

/**
 * Check if a URL is from a tracking or analytics domain
 * @param {string} url - URL to check
 * @returns {boolean} Whether the URL is a tracking domain
 */
export function isTrackingDomain(url) {
  try {
    if (!url) return false;
    
    const urlObj = new URL(url);
    const domain = urlObj.hostname.toLowerCase();
    
    // Check against tracking domains from config
    if (config.DOMAIN_PATTERNS.TRACKING.some(blocked => domain.includes(blocked))) {
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

/**
 * Check if URL is a Salesforce Lightning URL
 * @param {string} url - URL to check
 * @returns {boolean} Whether the URL is Salesforce
 */
export function isSalesforceUrl(url) {
  if (!url) return false;
  
  // Check against Salesforce domain patterns from config
  return config.DOMAIN_PATTERNS.SALESFORCE.some(domain => url.includes(domain));
}

/**
 * Format URL for display with truncation
 * @param {string} url - URL to format
 * @returns {string} Formatted URL
 */
export function formatUrl(url) {
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

/**
 * Generate a unique ID
 * @returns {string} Unique ID
 */
export function generateUniqueId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

/**
 * Debounce a function
 * @param {Function} func - Function to debounce
 * @param {number} wait - Debounce time in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(func, wait) {
  let timeout;
  
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    
    timeout = setTimeout(() => {
      func.apply(context, args);
    }, wait);
  };
}

/**
 * Throttle a function
 * @param {Function} func - Function to throttle
 * @param {number} limit - Throttle time in milliseconds
 * @returns {Function} Throttled function
 */
export function throttle(func, limit) {
  let inThrottle;
  
  return function(...args) {
    const context = this;
    
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Retry a function multiple times
 * @param {Function} fn - Function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} delay - Delay between retries in milliseconds
 * @returns {Promise<any>} Promise resolving to function result
 */
export async function retry(fn, maxRetries = 3, delay = 300) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.warn(`Attempt ${attempt + 1} failed:`, error);
      
      // Wait before next attempt
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

/**
 * Get the file extension from a URL or filename
 * @param {string} urlOrFilename - URL or filename
 * @returns {string} File extension (lowercase)
 */
export function getFileExtension(urlOrFilename) {
  try {
    const parts = urlOrFilename.split('.');
    if (parts.length === 1) return '';
    return parts[parts.length - 1].toLowerCase();
  } catch (error) {
    return '';
  }
}

/**
 * Calculate the base64 size in bytes
 * @param {string} base64String - Base64 encoded string
 * @returns {number} Size in bytes
 */
export function getBase64Size(base64String) {
  const padding = base64String.endsWith('==') ? 2 : base64String.endsWith('=') ? 1 : 0;
  return (base64String.length * 3) / 4 - padding;
}

/**
 * Convert a screenshot data URL to a more compressed one
 * @param {string} dataUrl - Data URL of the image
 * @param {number} quality - JPEG quality (0-100)
 * @returns {Promise<string>} Compressed data URL
 */
export async function compressScreenshot(dataUrl, quality = 85) {
  return new Promise((resolve, reject) => {
    try {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        
        // Convert to JPEG with specified quality
        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality / 100);
        resolve(compressedDataUrl);
      };
      
      img.onerror = (error) => {
        reject(error);
      };
      
      img.src = dataUrl;
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Truncate text to a maximum length
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
export function truncateText(text, maxLength = 100) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Clean XML special characters from a string
 * @param {string} str - String to clean
 * @returns {string} Cleaned string
 */
export function cleanXmlString(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Convert markdown to HTML
 * @param {string} markdown - Markdown text
 * @returns {string} HTML
 */
export function markdownToHtml(markdown) {
  if (!markdown) return '';
  
  // Convert ** to <strong>
  let html = markdown.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Convert * to <em>
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  
  // Convert ` to <code>
  html = html.replace(/`(.*?)`/g, '<code>$1</code>');
  
  // Convert newlines to <br>
  html = html.replace(/\n/g, '<br>');
  
  return html;
}