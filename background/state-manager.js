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

// SotoScribe - State Manager
// Manages the in-memory state of the workflow capture process

import { log, sfLog } from '../shared/logging.js';

export class StateManager {
  constructor() {
    this.resetState();
  }
  
  // Reset to initial state
  resetState() {
    // Clear any existing intervals
    if (this.captureInterval) {
      clearInterval(this.captureInterval);
    }
    
    // Clear any pending step processing
    if (this.mergeQueueTimeout) {
      clearTimeout(this.mergeQueueTimeout);
    }
    
    // Core capture state
    this.isCapturing = false;
    this.sessionId = null;
    this.steps = [];
    this.readyTabs = {}; // Track tabs with ready content scripts
    this.captureInterval = null; // For screenshot interval tracking
    this.editorTabId = null;
    
    // Step merging queue to reduce duplicates
    this.pendingSteps = [];
    this.mergeQueueTimeout = null;
    this.MERGE_QUEUE_DELAY = 500; // 500ms delay for merging similar events
    
    // Track last action by type for better duplicate detection
    this.lastActions = {
      click: { timestamp: 0, elementPath: null, url: null },
      input: { timestamp: 0, elementPath: null, value: null, url: null },
      navigate: { timestamp: 0, url: null },
      ui_change: { timestamp: 0, url: null },
      keyboard: { timestamp: 0, elementPath: null, url: null },
      form_submit: { timestamp: 0, formId: null, url: null }
    };
    
    // Salesforce-specific state
    this.isSalesforceActive = false;
    this.lastStepTime = 0;
    this.salesforceStats = {
      eventCaptureCount: 0,
      mutationCaptureCount: 0,
      pollingCaptureCount: 0,
      shadowDOMInputsFound: 0,
      failedScreenshots: 0
    };
    
    log("State manager reset");
  }
  
  // Add a step to the workflow with improved duplicate detection and merge queue
  addStep(stepData) {
    // Add timestamp if not present
    if (!stepData.timestamp) {
      stepData.timestamp = Date.now();
    }
    
    // Update last step time
    this.lastStepTime = stepData.timestamp;
    
    // Check for duplicates using improved method
    if (this.isLikelyDuplicate(stepData)) {
      log(`Duplicate detected and filtered: ${stepData.type}`);
      return this.steps.length; // Return current count without adding
    }
    
    // Add to pending queue for potential merging
    this.pendingSteps.push(stepData);
    
    // Process queue after a delay to allow for merging similar events
    this.scheduleMergeQueueProcessing();
    
    // Update Salesforce stats if applicable
    if (stepData.salesforceMetadata) {
      this.isSalesforceActive = true;
      
      // Track capture method statistics
      const captureMethod = stepData.salesforceMetadata.captureMethod;
      if (captureMethod === 'event_handler') {
        this.salesforceStats.eventCaptureCount++;
      } else if (captureMethod === 'mutation_observer') {
        this.salesforceStats.mutationCaptureCount++;
      } else if (captureMethod === 'polling') {
        this.salesforceStats.pollingCaptureCount++;
      }
      
      // Track shadow DOM statistics
      if (stepData.salesforceMetadata.inShadowDOM) {
        this.salesforceStats.shadowDOMInputsFound++;
      }
      
      sfLog(`Added Salesforce step to queue (#${this.pendingSteps.length}): ${stepData.type} via ${captureMethod}`);
    } else {
      log(`Added step to merge queue (#${this.pendingSteps.length}): ${stepData.type}`);
    }
    
    // Return the current count plus pending items
    return this.steps.length + this.pendingSteps.length;
  }
  
  // Schedule processing of the merge queue
  scheduleMergeQueueProcessing() {
    // Clear any existing timeout
    if (this.mergeQueueTimeout) {
      clearTimeout(this.mergeQueueTimeout);
    }
    
    // Set new timeout to process queue
    this.mergeQueueTimeout = setTimeout(() => {
      this.processMergeQueue();
    }, this.MERGE_QUEUE_DELAY);
  }
  
  // Process pending steps, merging similar events
  processMergeQueue() {
    if (this.pendingSteps.length === 0) return;
    
    log(`Processing merge queue with ${this.pendingSteps.length} pending steps`);
    
    // Group steps by type
    const stepsByType = {};
    this.pendingSteps.forEach(step => {
      if (!stepsByType[step.type]) {
        stepsByType[step.type] = [];
      }
      stepsByType[step.type].push(step);
    });
    
    // Process each type
    Object.keys(stepsByType).forEach(type => {
      const typeSteps = stepsByType[type];
      
      // Sort by timestamp
      typeSteps.sort((a, b) => a.timestamp - b.timestamp);
      
      // For inputs, merge similar input events on the same element
      if (type === 'input') {
        this.mergeInputSteps(typeSteps);
      } 
      // For UI changes, only keep the most recent one for the same URL
      else if (type === 'ui_change') {
        this.mergeUIChangeSteps(typeSteps);
      }
      // For navigation, avoid duplicates to the same URL
      else if (type === 'navigate') {
        this.mergeNavigationSteps(typeSteps);
      }
      // For all other types, just add them
      else {
        typeSteps.forEach(step => {
          this.addStepToFinalList(step);
        });
      }
    });
    
    // Clear pending steps
    this.pendingSteps = [];
    
    log(`Merge queue processed, now have ${this.steps.length} final steps`);
  }
  
  // Merge input steps on the same element
  mergeInputSteps(inputSteps) {
    if (inputSteps.length <= 1) {
      inputSteps.forEach(step => this.addStepToFinalList(step));
      return;
    }
    
    // Group by element path
    const stepsByElement = {};
    inputSteps.forEach(step => {
      const elementPath = step.elementInfo?.path || 'unknown';
      if (!stepsByElement[elementPath]) {
        stepsByElement[elementPath] = [];
      }
      stepsByElement[elementPath].push(step);
    });
    
    // For each element, only keep the last input
    Object.values(stepsByElement).forEach(elementSteps => {
      if (elementSteps.length === 1) {
        this.addStepToFinalList(elementSteps[0]);
      } else {
        // Sort by timestamp and keep the last one
        elementSteps.sort((a, b) => a.timestamp - b.timestamp);
        const lastStep = elementSteps[elementSteps.length - 1];
        
        // Update the last action tracker
        if (lastStep.elementInfo?.path) {
          this.lastActions.input = {
            timestamp: lastStep.timestamp,
            elementPath: lastStep.elementInfo.path,
            value: lastStep.actualValue,
            url: lastStep.url
          };
        }
        
        this.addStepToFinalList(lastStep);
        log(`Merged ${elementSteps.length} input steps on the same element`);
      }
    });
  }
  
  // Merge UI change steps for the same page
  mergeUIChangeSteps(uiSteps) {
    if (uiSteps.length <= 1) {
      uiSteps.forEach(step => this.addStepToFinalList(step));
      return;
    }
    
    // Group by URL
    const stepsByUrl = {};
    uiSteps.forEach(step => {
      const url = step.url || 'unknown';
      if (!stepsByUrl[url]) {
        stepsByUrl[url] = [];
      }
      stepsByUrl[url].push(step);
    });
    
    // For each URL, only keep the last UI change
    Object.values(stepsByUrl).forEach(urlSteps => {
      if (urlSteps.length === 1) {
        this.addStepToFinalList(urlSteps[0]);
      } else {
        // Sort by timestamp and keep the last one
        urlSteps.sort((a, b) => a.timestamp - b.timestamp);
        const lastStep = urlSteps[urlSteps.length - 1];
        
        // Update the last action tracker
        this.lastActions.ui_change = {
          timestamp: lastStep.timestamp,
          url: lastStep.url
        };
        
        this.addStepToFinalList(lastStep);
        log(`Merged ${urlSteps.length} UI change steps on the same page`);
      }
    });
  }
  
  // Merge navigation steps to the same URL
  mergeNavigationSteps(navSteps) {
    if (navSteps.length <= 1) {
      navSteps.forEach(step => this.addStepToFinalList(step));
      return;
    }
    
    // Group by URL
    const stepsByUrl = {};
    navSteps.forEach(step => {
      const url = step.url || 'unknown';
      if (!stepsByUrl[url]) {
        stepsByUrl[url] = [];
      }
      stepsByUrl[url].push(step);
    });
    
    // For each URL, only keep the last navigation
    Object.values(stepsByUrl).forEach(urlSteps => {
      if (urlSteps.length === 1) {
        this.addStepToFinalList(urlSteps[0]);
      } else {
        // Sort by timestamp and keep the last one
        urlSteps.sort((a, b) => a.timestamp - b.timestamp);
        const lastStep = urlSteps[urlSteps.length - 1];
        
        // Update the last action tracker
        this.lastActions.navigate = {
          timestamp: lastStep.timestamp,
          url: lastStep.url
        };
        
        this.addStepToFinalList(lastStep);
        log(`Merged ${urlSteps.length} navigation steps to the same URL`);
      }
    });
  }
  
  // Add step to the final list
  addStepToFinalList(step) {
    this.steps.push(step);
    log(`Added step (#${this.steps.length}): ${step.type}`);
    
    // Update last action trackers for better duplicate detection
    this.updateLastActionTracker(step);
    
    return this.steps.length;
  }
  
  // Update the last action tracker for better duplicate detection
  updateLastActionTracker(step) {
    switch (step.type) {
      case 'click':
        if (step.elementInfo?.path) {
          this.lastActions.click = {
            timestamp: step.timestamp,
            elementPath: step.elementInfo.path,
            url: step.url
          };
        }
        break;
        
      case 'input':
        if (step.elementInfo?.path) {
          this.lastActions.input = {
            timestamp: step.timestamp,
            elementPath: step.elementInfo.path,
            value: step.actualValue,
            url: step.url
          };
        }
        break;
        
      case 'navigate':
        this.lastActions.navigate = {
          timestamp: step.timestamp,
          url: step.url
        };
        break;
        
      case 'ui_change':
        this.lastActions.ui_change = {
          timestamp: step.timestamp,
          url: step.url
        };
        break;
        
      case 'keyboard':
        if (step.targetElement?.path) {
          this.lastActions.keyboard = {
            timestamp: step.timestamp,
            elementPath: step.targetElement.path,
            url: step.url
          };
        }
        break;
        
      case 'form_submit':
        this.lastActions.form_submit = {
          timestamp: step.timestamp,
          formId: step.formId || 'unknown',
          url: step.url
        };
        break;
    }
  }
  
  // Improved duplicate detection using the lastActions tracker
  isLikelyDuplicate(step) {
    const type = step.type;
    const now = step.timestamp;
    
    // Skip the check if we don't have a lastAction record for this type
    if (!this.lastActions[type]) return false;
    
    const lastAction = this.lastActions[type];
    
    // Time-based threshold varies by step type
    const thresholds = {
      click: 800,      // 800ms for clicks
      input: 2000,     // 2s for inputs (to allow for typing)
      navigate: 1000,  // 1s for navigation
      ui_change: 2000, // 2s for UI changes
      keyboard: 800,   // 800ms for keyboard shortcuts
      form_submit: 1000 // 1s for form submissions
    };
    
    const threshold = thresholds[type] || 1000;
    
    // If too recent, likely a duplicate
    if (now - lastAction.timestamp < threshold) {
      // For simple types like navigation and UI changes, just check the URL
      if (type === 'navigate' || type === 'ui_change') {
        if (step.url === lastAction.url) {
          return true;
        }
      }
      // For clicks, check element path
      else if (type === 'click') {
        if (step.elementInfo?.path === lastAction.elementPath && 
            step.url === lastAction.url) {
          return true;
        }
      }
      // For inputs, check element path and partial value
      else if (type === 'input') {
        if (step.elementInfo?.path === lastAction.elementPath && 
            step.url === lastAction.url) {
          // For masked values, always consider them unique
          if (step.isSensitive) {
            return false;
          }
          
          // If the current value contains the last value (typing continuation)
          // or vice versa (backspacing), treat as duplicate
          if (lastAction.value && step.actualValue) {
            if (step.actualValue.includes(lastAction.value) || 
                lastAction.value.includes(step.actualValue)) {
              return true;
            }
          }
        }
      }
      // For keyboard shortcuts, check element and URL
      else if (type === 'keyboard') {
        if (step.targetElement?.path === lastAction.elementPath && 
            step.url === lastAction.url) {
          return true;
        }
      }
      // For form submissions, check form ID and URL
      else if (type === 'form_submit') {
        if (step.formId === lastAction.formId && 
            step.url === lastAction.url) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  // Get step by index
  getStep(index) {
    if (index >= 0 && index < this.steps.length) {
      return this.steps[index];
    }
    return null;
  }
  
  // Remove a step by index
  removeStep(index) {
    if (index >= 0 && index < this.steps.length) {
      this.steps.splice(index, 1);
      log(`Removed step at index ${index}, ${this.steps.length} steps remaining`);
      return true;
    }
    return false;
  }
  
  // Move a step up or down in the order
  moveStep(index, direction) {
    if (direction === 'up' && index > 0) {
      // Swap with previous step
      const temp = this.steps[index];
      this.steps[index] = this.steps[index - 1];
      this.steps[index - 1] = temp;
      return true;
    } else if (direction === 'down' && index < this.steps.length - 1) {
      // Swap with next step
      const temp = this.steps[index];
      this.steps[index] = this.steps[index + 1];
      this.steps[index + 1] = temp;
      return true;
    }
    return false;
  }
  
  // Update a step's instructions
  updateStepInstruction(index, newInstruction) {
    if (index >= 0 && index < this.steps.length) {
      this.steps[index].instruction = newInstruction;
      return true;
    }
    return false;
  }
  
  // Track screenshot errors
  recordScreenshotError() {
    if (this.isSalesforceActive) {
      this.salesforceStats.failedScreenshots++;
    }
  }
  
  // Generate diagnostic data
  getDiagnosticData() {
    return {
      steps: this.steps.length,
      pendingSteps: this.pendingSteps.length,
      isCapturing: this.isCapturing,
      isSalesforceActive: this.isSalesforceActive,
      salesforceStats: this.salesforceStats,
      lastStepTimestamp: this.lastStepTime,
      timeSinceLastStep: this.lastStepTime ? Date.now() - this.lastStepTime : 'N/A',
      readyTabsCount: Object.keys(this.readyTabs).length,
      lastActions: this.lastActions
    };
  }
  
  // Get stats about steps by type
  getStepTypeStats() {
    const stats = {
      navigate: 0,
      click: 0,
      input: 0,
      keyboard: 0,
      form_submit: 0,
      ui_change: 0,
      screen_state: 0,
      other: 0
    };
    
    for (const step of this.steps) {
      if (stats[step.type] !== undefined) {
        stats[step.type]++;
      } else {
        stats.other++;
      }
    }
    
    return stats;
  }
}
