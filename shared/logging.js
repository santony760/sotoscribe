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

// SotoScribe - Enhanced Logging Utilities
// Provides context-aware logging with timestamps and categories

import { config } from './config.js';

// Store log history for diagnostics
const logHistory = [];
const MAX_LOG_HISTORY = 1000;

/**
 * Standard log function
 * @param {string} message - Primary log message
 * @param {any} data - Optional data to include
 */
export function log(message, data) {
  if (!config.ENABLE_LOGGING) return;
  
  const timestamp = new Date().toISOString();
  const logPrefix = `[SotoScribe ${timestamp}]`;
  
  // Store in history
  logHistory.push({
    timestamp,
    type: 'standard',
    message,
    data
  });
  
  // Trim history if needed
  if (logHistory.length > MAX_LOG_HISTORY) {
    logHistory.shift();
  }
  
  // Log to console
  if (data !== undefined) {
    console.log(logPrefix, message, data);
  } else {
    console.log(logPrefix, message);
  }
}

/**
 * Salesforce-specific logging
 * @param {string} message - Primary log message
 * @param {any} data - Optional data to include
 */
export function sfLog(message, data) {
  if (!config.ENABLE_SALESFORCE_LOGGING) return;
  
  const timestamp = new Date().toISOString();
  const logPrefix = `[SFDC ${timestamp}]`;
  
  // Store in history with Salesforce tag
  logHistory.push({
    timestamp,
    type: 'salesforce',
    message,
    data
  });
  
  // Trim history if needed
  if (logHistory.length > MAX_LOG_HISTORY) {
    logHistory.shift();
  }
  
  // Log to console with distinctive styling
  if (data !== undefined) {
    console.log(`%c${logPrefix}%c ${message}`, 
                'color: #00A1E0; font-weight: bold;', 
                'color: inherit;', 
                data);
  } else {
    console.log(`%c${logPrefix}%c ${message}`, 
                'color: #00A1E0; font-weight: bold;', 
                'color: inherit;');
  }
}

/**
 * Debug logging - only shown in debug mode
 * @param {string} message - Debug message
 * @param {any} data - Optional data to include
 */
export function debugLog(message, data) {
  if (!config.DEBUG_MODE) return;
  
  const timestamp = new Date().toISOString();
  const logPrefix = `[DEBUG ${timestamp}]`;
  
  // Store in history
  logHistory.push({
    timestamp,
    type: 'debug',
    message,
    data
  });
  
  // Trim history if needed
  if (logHistory.length > MAX_LOG_HISTORY) {
    logHistory.shift();
  }
  
  // Log to console
  if (data !== undefined) {
    console.debug(logPrefix, message, data);
  } else {
    console.debug(logPrefix, message);
  }
}

/**
 * Performance timing log
 * @param {string} label - Label for the timing
 * @param {function} fn - Function to time
 * @returns {Promise<any>} Result of the function
 */
export async function timeLog(label, fn) {
  if (!config.ENABLE_PERFORMANCE_LOGGING) {
    return await fn();
  }
  
  const startTime = performance.now();
  try {
    const result = await fn();
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    console.log(`[PERF] ${label}: ${duration.toFixed(2)}ms`);
    
    // Store in history
    logHistory.push({
      timestamp: new Date().toISOString(),
      type: 'performance',
      message: label,
      data: {
        duration,
        startTime,
        endTime
      }
    });
    
    return result;
  } catch (error) {
    const endTime = performance.now();
    console.error(`[PERF] ${label} failed after ${(endTime - startTime).toFixed(2)}ms`, error);
    throw error;
  }
}

/**
 * Error logging with stack trace
 * @param {string} message - Error message
 * @param {Error} error - Error object
 */
export function errorLog(message, error) {
  const timestamp = new Date().toISOString();
  const logPrefix = `[ERROR ${timestamp}]`;
  
  // Store in history
  logHistory.push({
    timestamp,
    type: 'error',
    message,
    error: error ? {
      message: error.message,
      stack: error.stack
    } : null
  });
  
  // Trim history if needed
  if (logHistory.length > MAX_LOG_HISTORY) {
    logHistory.shift();
  }
  
  // Log to console
  if (error) {
    console.error(logPrefix, message, error);
  } else {
    console.error(logPrefix, message);
  }
}

/**
 * Get log history
 * @param {string} type - Optional filter by log type
 * @param {number} limit - Maximum number of logs to return
 * @returns {Array} Filtered log history
 */
export function getLogHistory(type = null, limit = 100) {
  if (type) {
    return logHistory
      .filter(log => log.type === type)
      .slice(-limit);
  }
  
  return logHistory.slice(-limit);
}

/**
 * Clear log history
 */
export function clearLogHistory() {
  logHistory.length = 0;
}

/**
 * Group logs for a specific operation
 * @param {string} label - Group label
 * @param {function} fn - Function to execute within group
 * @returns {any} Result of the function
 */
export async function groupLog(label, fn) {
  if (!config.ENABLE_LOGGING) {
    return await fn();
  }
  
  console.group(label);
  try {
    const result = await fn();
    console.groupEnd();
    return result;
  } catch (error) {
    console.groupEnd();
    throw error;
  }
}