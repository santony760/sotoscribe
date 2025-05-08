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

// SotoScribe - Configuration Settings
// Centralized configuration for the extension

export const config = {
  // Version information
  VERSION: '1.0.1',
  
  // Feature flags
  FEATURES: {
    SALESFORCE_SUPPORT: true,
    SHADOW_DOM_SUPPORT: true,
    SCREENSHOT_FALLBACK: true,
    SENSITIVE_DATA_MASKING: true
  },
  
  // Timing settings
  TIMING: {
    // Regular website settings
    STANDARD_INPUT_DEBOUNCE_MS: 1000,
    SCREENSHOT_THROTTLE_MS: 1000,
    
    // Salesforce-specific settings
    SALESFORCE_INPUT_DEBOUNCE_MS: 1500,
    SALESFORCE_SCREENSHOT_THROTTLE_MS: 1500,
    SALESFORCE_POLLING_INTERVAL_MS: 750,
    SALESFORCE_UI_CHANGE_DEBOUNCE_MS: 500
  },
  
  // Debugging and logging
  DEBUG_MODE: true,
  ENABLE_LOGGING: true,
  ENABLE_SALESFORCE_LOGGING: true,
  ENABLE_PERFORMANCE_LOGGING: true,
  
  // Extension behavior settings
  CAPTURE_SETTINGS: {
    MAX_STEPS: 1000,
    AUTO_SCREENSHOT_QUALITY: 85,
    SALESFORCE_SCREENSHOT_QUALITY: 100,
    HIGHLIGHT_BORDER_COLOR: '#00B3A4',
    HIGHLIGHT_SHADOW_COLOR: 'rgba(0, 179, 164, 0.4)',
    CLICK_INDICATOR_COLOR: 'rgba(255, 0, 0, 0.2)'
  },
  
  // Domain detection settings
  DOMAIN_PATTERNS: {
    SALESFORCE: [
      'lightning.force.com',
      'salesforce.com',
      'visualforce.com'
    ],
    TRACKING: [
      'doubleclick.net',
      'googletagmanager.com', 
      'google-analytics.com',
      'facebook.com/tr',
      'quantserve.com',
      'adnxs.com',
      'adsrvr.org',
      'scorecardresearch.com'
    ],
    RESTRICTED: [
      'chrome://',
      'edge://',
      'about:',
      'chrome-extension://',
      'devtools://',
      'view-source:',
      'file://'
    ]
  }
};

// Function to get a configured value with optional override
export function getConfig(path, defaultValue = null) {
  try {
    const parts = path.split('.');
    let current = config;
    
    for (const part of parts) {
      if (current[part] === undefined) {
        return defaultValue;
      }
      current = current[part];
    }
    
    return current;
  } catch (error) {
    console.error(`Error getting config value for ${path}:`, error);
    return defaultValue;
  }
}