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

// SotoScribe - Screenshot Service
// Handles capturing and processing screenshots with perceptual hashing

import { isRestrictedUrl, isTrackingDomain } from '../shared/utils.js';
import { log, sfLog, timeLog } from '../shared/logging.js';

export class ScreenshotService {
  constructor() {
    // State for screenshot rate limiting
    this.lastScreenshotTime = 0;
    this.pendingScreenshotRequests = [];
    this.SCREENSHOT_THROTTLE_MS = 1000; // Minimum 1 second between screenshots
    this.SALESFORCE_THROTTLE_MS = 1500; // Longer throttle for Salesforce
    
    // Failure tracking
    this.failureCount = 0;
    this.lastFailureTime = 0;
    
    // Last screenshot hash and data for comparison
    this.lastScreenshotHash = null;
    this.lastScreenshotData = null;
    
    // Hash similarity threshold (0-100)
    // Lower values = more strict comparison (fewer similar screenshots)
    this.HASH_SIMILARITY_THRESHOLD = 90; 
    
    log("Screenshot service initialized with perceptual hashing");
  }
  
  // Public API for capturing a screenshot with throttling and visual change detection
  async captureTabScreenshot(isSalesforce = false, forceCapture = false) {
    return new Promise((resolve, reject) => {
      // Determine throttle time based on context
      const throttleTime = isSalesforce ? this.SALESFORCE_THROTTLE_MS : this.SCREENSHOT_THROTTLE_MS;
      
      // Add request to queue
      this.pendingScreenshotRequests.push({ 
        resolve, 
        reject, 
        isSalesforce,
        forceCapture,
        timestamp: Date.now()
      });
      
      // Start processing if not already started
      if (this.pendingScreenshotRequests.length === 1) {
        this.processScreenshotQueue();
      }
    });
  }
  
  // Process the screenshot queue
  processScreenshotQueue() {
    if (this.pendingScreenshotRequests.length === 0) return;
    
    const now = Date.now();
    const nextRequest = this.pendingScreenshotRequests[0];
    const throttleTime = nextRequest.isSalesforce ? this.SALESFORCE_THROTTLE_MS : this.SCREENSHOT_THROTTLE_MS;
    
    if (now - this.lastScreenshotTime < throttleTime && !nextRequest.forceCapture) {
      // Not enough time has passed, check again later
      setTimeout(() => this.processScreenshotQueue(), 100);
      return;
    }
    
    // Process next request
    this.pendingScreenshotRequests.shift();
    this.lastScreenshotTime = now;
    
    timeLog("Screenshot capture", async () => {
      try {
        const screenshot = await this.captureTabScreenshotImpl(nextRequest.isSalesforce);
        
        if (screenshot) {
          // Check if this screenshot is visually similar to previous one
          const isSignificantChange = await this.isSignificantVisualChange(screenshot, nextRequest.forceCapture);
          
          if (isSignificantChange || nextRequest.forceCapture) {
            // Visual change detected or force capture requested
            nextRequest.resolve(screenshot);
          } else {
            // No significant change, reuse previous screenshot
            log("No significant visual change detected, reusing previous screenshot");
            nextRequest.resolve(this.lastScreenshotData);
          }
        } else {
          nextRequest.resolve(null);
        }
        
        // Process next request if any
        if (this.pendingScreenshotRequests.length > 0) {
          setTimeout(() => this.processScreenshotQueue(), 50);
        }
      } catch (error) {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        
        // Log failure details
        console.error("Screenshot capture error:", error);
        if (nextRequest.isSalesforce) {
          sfLog(`Salesforce screenshot failed (failure #${this.failureCount})`);
        }
        
        nextRequest.reject(error);
        
        // Process next request if any, even after error
        if (this.pendingScreenshotRequests.length > 0) {
          setTimeout(() => this.processScreenshotQueue(), 50);
        }
      }
    });
  }
  
  // Implementation of screenshot capture
  async captureTabScreenshotImpl(isSalesforce = false) {
    try {
      // Get the active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Check if tab still exists
      if (!tab) {
        throw new Error("Tab no longer exists");
      }
      
      // Check if the tab is on a restricted URL
      if (isRestrictedUrl(tab.url)) {
        log("Cannot capture screenshot of restricted URL:", tab.url);
        return null;
      }
      
      // Check if this is a tracking domain
      if (isTrackingDomain(tab.url)) {
        log("Skipping screenshot of tracking domain:", tab.url);
        return null;
      }
      
      // For Salesforce, we'll use a higher quality but slower screenshot
      const screenshotOptions = {
        format: 'png',
        quality: isSalesforce ? 100 : 85 // Higher quality for Salesforce
      };
      
      // Capture the visible area of the tab
      const dataUrl = await chrome.tabs.captureVisibleTab(null, screenshotOptions);
      
      // Reset failure counter on success
      this.failureCount = 0;
      
      return dataUrl;
    } catch (error) {
      // Track failure
      this.failureCount++;
      this.lastFailureTime = Date.now();
      
      // Log detailed error information
      console.error("Error in captureTabScreenshotImpl:", error);
      if (isSalesforce) {
        sfLog(`Salesforce screenshot implementation failed: ${error.message}`);
      }
      
      // Rethrow so the caller can handle it
      throw error;
    }
  }
  
  // Check if a screenshot shows significant visual change compared to the previous one
  async isSignificantVisualChange(newScreenshotData, forceConsiderChanged = false) {
    // If forcing change detection, skip comparison
    if (forceConsiderChanged) return true;
    
    // If we don't have a previous screenshot, this is definitely a change
    if (!this.lastScreenshotData || !this.lastScreenshotHash) {
      await this.updateScreenshotHash(newScreenshotData);
      return true;
    }
    
    try {
      // Generate perceptual hash for new screenshot
      const newHash = await this.generatePerceptualHash(newScreenshotData);
      
      // Calculate similarity between hashes (0-100 scale)
      const similarity = this.calculateHashSimilarity(this.lastScreenshotHash, newHash);
      
      // Check if similarity is below threshold
      const isSignificantChange = similarity < this.HASH_SIMILARITY_THRESHOLD;
      
      // If there's a significant change, update the stored hash and data
      if (isSignificantChange) {
        this.lastScreenshotHash = newHash;
        this.lastScreenshotData = newScreenshotData;
        log(`Visual change detected (similarity: ${similarity.toFixed(1)}%)`);
      } else {
        log(`No significant visual change (similarity: ${similarity.toFixed(1)}%)`);
      }
      
      return isSignificantChange;
    } catch (error) {
      console.error("Error comparing screenshots:", error);
      // On error, assume there's a change to be safe
      await this.updateScreenshotHash(newScreenshotData);
      return true;
    }
  }
  
  // Update the stored screenshot hash and data
  async updateScreenshotHash(screenshotData) {
    try {
      this.lastScreenshotHash = await this.generatePerceptualHash(screenshotData);
      this.lastScreenshotData = screenshotData;
    } catch (error) {
      console.error("Error updating screenshot hash:", error);
    }
  }
  
  // Generate a perceptual hash from a screenshot
  async generatePerceptualHash(dataUrl) {
    return new Promise((resolve, reject) => {
      try {
        // Create an image from the data URL
        const img = new Image();
        img.onload = () => {
          try {
            // Create a small thumbnail for comparison (16x16 pixels)
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const size = 16; // Small size for fast comparison
            
            canvas.width = size;
            canvas.height = size;
            
            // Draw the image as grayscale
            ctx.drawImage(img, 0, 0, size, size);
            const imageData = ctx.getImageData(0, 0, size, size);
            const pixels = imageData.data;
            
            // Convert to grayscale values
            const grayValues = [];
            for (let i = 0; i < pixels.length; i += 4) {
              // Calculate luminance
              const r = pixels[i];
              const g = pixels[i + 1];
              const b = pixels[i + 2];
              const gray = 0.299 * r + 0.587 * g + 0.114 * b;
              grayValues.push(gray);
            }
            
            // Calculate average gray value
            const avg = grayValues.reduce((sum, val) => sum + val, 0) / grayValues.length;
            
            // Create binary hash based on whether each pixel is above or below average
            const hash = grayValues.map(val => val >= avg ? 1 : 0);
            
            resolve(hash);
          } catch (error) {
            reject(error);
          }
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
  
  // Calculate Hamming distance similarity between two hashes (0-100 scale)
  calculateHashSimilarity(hash1, hash2) {
    if (!hash1 || !hash2 || hash1.length !== hash2.length) {
      return 0; // No similarity if invalid or different lengths
    }
    
    // Count matching bits
    let matchingBits = 0;
    for (let i = 0; i < hash1.length; i++) {
      if (hash1[i] === hash2[i]) {
        matchingBits++;
      }
    }
    
    // Convert to percentage
    return (matchingBits / hash1.length) * 100;
  }
  
  // Reset failure tracking
  resetFailureTracking() {
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }
  
  // Get diagnostic data
  getDiagnosticData() {
    return {
      pendingRequests: this.pendingScreenshotRequests.length,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      lastScreenshotTime: this.lastScreenshotTime,
      timeSinceLastScreenshot: Date.now() - this.lastScreenshotTime,
      hashAvailable: this.lastScreenshotHash !== null
    };
  }
  
  // Helper for detecting if we're in a rate limit situation
  isRateLimited() {
    return Date.now() - this.lastScreenshotTime < this.SCREENSHOT_THROTTLE_MS;
  }
}
