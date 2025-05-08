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

// SotoScribe - Background Service Worker
// Main entry point that coordinates extension functionality

import { StateManager } from './state-manager.js';
import { ScreenshotService } from './screenshot-service.js';
import { 
  isRestrictedUrl, 
  isTrackingDomain, 
  isSalesforceUrl, 
  formatUrl 
} from '../shared/utils.js';
import { log, sfLog } from '../shared/logging.js';

// Create service instances
const stateManager = new StateManager();
const screenshotService = new ScreenshotService();

// Initialize fresh state
function resetState() {
  stateManager.resetState();
}

// Start a new capture session
async function startCapture() {
  log("Starting capture session");
  if (stateManager.isCapturing) return;
  
  resetState();
  stateManager.isCapturing = true;
  stateManager.sessionId = Date.now().toString();
  
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  log("Current tab:", tab.id, tab.url);
  
  // Check if the tab is on a restricted URL
  if (isRestrictedUrl(tab.url)) {
    log("Cannot capture on restricted URL:", tab.url);
    await chrome.action.setBadgeText({ text: "ERR" });
    await chrome.action.setBadgeBackgroundColor({ color: "#E53935" });
    
    // We'll still mark as capturing but won't try to inject scripts
    // This allows capture to start when user navigates to a supported page
    return;
  }
  
  // Check if this is a tracking domain (don't start capture on tracking pages)
  if (isTrackingDomain(tab.url)) {
    log("Cannot start capture on tracking domain:", tab.url);
    await chrome.action.setBadgeText({ text: "WAIT" });
    await chrome.action.setBadgeBackgroundColor({ color: "#FFA000" });
    
    // Still mark as capturing, but don't inject scripts yet
    return;
  }
  
  // Inject session indicator
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: injectSessionIndicator
    });
    log("Session indicator injected");
  } catch (error) {
    console.error("Error injecting session indicator:", error);
  }
  
  // Check if this is a Salesforce page
  const isSalesforce = isSalesforceUrl(tab.url);
  if (isSalesforce) {
    sfLog("Salesforce page detected, using Salesforce-specific handling");
  }
  
  // Notify content script - with retry mechanism
  let retryAttempt = 0;
  const maxRetries = 3;
  
  async function tryConnectToContentScript() {
    try {
      log(`Connection attempt ${retryAttempt + 1} to content script`);
      
      // Check if we know this tab has a content script ready
      const isContentScriptReady = stateManager.readyTabs && stateManager.readyTabs[tab.id];
      
      chrome.tabs.sendMessage(tab.id, {
        action: "startCapture",
        sessionId: stateManager.sessionId,
        isSalesforce: isSalesforce
      }, response => {
        if (chrome.runtime.lastError) {
          console.warn("Content script connection error:", chrome.runtime.lastError);
          
          // If we've tried enough times, give up gracefully
          if (retryAttempt >= maxRetries) {
            log("Max retries reached, content script unavailable");
            // We'll still keep the extension in capture mode
            // When content script becomes available, it can join
          } else {
            // Try again after delay
            retryAttempt++;
            setTimeout(tryConnectToContentScript, 1000);
          }
        } else {
          log("Start message sent to content script successfully");
        }
      });
    } catch (error) {
      console.error("Error sending message to content script:", error);
    }
  }
  
  // Try to connect to content script
  tryConnectToContentScript();
  
  // Update UI
  await chrome.action.setBadgeText({ text: "REC" });
  await chrome.action.setBadgeBackgroundColor({ color: "#00B3A4" });
  log("Capture session started successfully");
}

// Stop the current capture session
async function stopCapture() {
  log("Stopping capture session");
  if (!stateManager.isCapturing) return;
  
  stateManager.isCapturing = false;
  
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  // Only attempt to execute scripts if the tab is not on a restricted URL
  if (!isRestrictedUrl(tab.url)) {
    // Remove session indicator
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: removeSessionIndicator
      });
      log("Session indicator removed");
    } catch (error) {
      console.error("Error removing session indicator:", error);
    }
    
    // Notify content script
    try {
      await chrome.tabs.sendMessage(tab.id, { action: "stopCapture" }, response => {
        // Handle potential error, but proceed regardless
        if (chrome.runtime.lastError) {
          console.warn("Warning when stopping content script:", chrome.runtime.lastError);
        } else {
          log("Stop message sent to content script");
        }
      });
    } catch (error) {
      console.error("Error sending stop message to content script:", error);
    }
  }
  
  // Update UI
  await chrome.action.setBadgeText({ text: "" });
  
  // Open editor if we have steps
  log("Steps captured:", stateManager.steps.length);
  if (stateManager.steps.length > 0) {
    await openEditor();
  } else {
    log("No steps to edit");
  }
}

// Client-side function to inject session indicator
function injectSessionIndicator() {
  if (document.getElementById('sotoscribe-indicator')) return;
  
  const indicator = document.createElement('div');
  indicator.id = 'sotoscribe-indicator';
  indicator.setAttribute('data-sotoscribe', 'indicator');
  indicator.textContent = 'Recording';
  indicator.style.position = 'fixed';
  indicator.style.top = '10px';
  indicator.style.right = '10px';
  indicator.style.backgroundColor = '#00B3A4';
  indicator.style.color = 'white';
  indicator.style.padding = '5px 10px';
  indicator.style.borderRadius = '4px';
  indicator.style.zIndex = '999999';
  indicator.style.fontFamily = 'Arial, sans-serif';
  indicator.style.fontSize = '12px';
  
  document.body.appendChild(indicator);
}

// Client-side function to remove session indicator
function removeSessionIndicator() {
  const indicator = document.getElementById('sotoscribe-indicator');
  if (indicator) {
    indicator.remove();
  }
}

// Open the editor with current steps
async function openEditor() {
  log("Opening editor tab");
  try {
    // Create a new tab with the editor
    const tab = await chrome.tabs.create({
      url: chrome.runtime.getURL('editor/editor.html')
    });
    
    log("Editor tab created:", tab.id);
    
    // Store the editor tab ID temporarily
    stateManager.editorTabId = tab.id;
  } catch (error) {
    console.error("Error opening editor:", error);
  }
}

// Listen for tab URL changes to detect when we move to/from restricted pages
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only process if we're in capture mode and URL has changed
  if (stateManager.isCapturing && changeInfo.url) {
    const isRestricted = isRestrictedUrl(changeInfo.url);
    const isTracking = isTrackingDomain(changeInfo.url);
    const isSalesforce = isSalesforceUrl(changeInfo.url);
    
    if (isRestricted) {
      log("Tab navigated to restricted URL:", changeInfo.url);
      chrome.action.setBadgeText({ text: "WAIT" });
      chrome.action.setBadgeBackgroundColor({ color: "#FFA000" });
    } else if (isTracking) {
      log("Tab navigated to tracking domain:", changeInfo.url);
      chrome.action.setBadgeText({ text: "WAIT" });
      chrome.action.setBadgeBackgroundColor({ color: "#FFA000" });
    } else {
      log("Tab navigated to supported URL:", changeInfo.url);
      chrome.action.setBadgeText({ text: "REC" });
      chrome.action.setBadgeBackgroundColor({ color: "#00B3A4" });
      
      // If Salesforce, use specialized handling
      if (isSalesforce) {
        sfLog("Navigated to Salesforce page:", changeInfo.url);
      }
      
      // Try to re-establish content script connection after a delay
      // This gives the content script time to load
      setTimeout(() => {
        if (stateManager.isCapturing) {
          try {
            chrome.tabs.sendMessage(tabId, {
              action: "startCapture",
              sessionId: stateManager.sessionId,
              isSalesforce: isSalesforce
            }, response => {
              if (chrome.runtime.lastError) {
                console.warn("Content script reconnection warning:", chrome.runtime.lastError.message);
              } else {
                log("Successfully reconnected to content script");
              }
            });
          } catch (error) {
            console.error("Error reconnecting to content script:", error);
          }
        }
      }, 1000);
    }
  }
});

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log("Background received message:", message.action);
  
  switch (message.action) {
    case "contentScriptLoaded":
      log("Content script loaded on:", message.url);
      // Store which tabs have content scripts ready
      if (sender.tab) {
        stateManager.readyTabs[sender.tab.id] = true;
      }
      sendResponse({ acknowledged: true });
      break;
      
    case "contentScriptReady":
      log("Content script ready on:", message.url);
      // Track if this is Salesforce
      const isSalesforce = message.isSalesforce === true;
      
      // If Salesforce, update our records
      if (isSalesforce) {
        sfLog("Salesforce content script ready on tab:", sender.tab?.id);
      }
      
      // If we're capturing and this tab just got ready, send the start message
      if (stateManager.isCapturing && sender.tab && 
          sender.tab.active) {
        chrome.tabs.sendMessage(sender.tab.id, {
          action: "startCapture",
          sessionId: stateManager.sessionId,
          isSalesforce: isSalesforce
        }, response => {
          if (chrome.runtime.lastError) {
            console.warn("Warning sending start to ready script:", chrome.runtime.lastError);
          }
        });
      }
      sendResponse({ acknowledged: true });
      break;
      
    case "startCapture":
      startCapture().then(() => {
        sendResponse({ success: true });
      }).catch(error => {
        console.error("Error starting capture:", error);
        sendResponse({ success: false, error: error.message });
      });
      break;
      
    case "stopCapture":
      stopCapture().then(() => {
        sendResponse({ success: true });
      }).catch(error => {
        console.error("Error stopping capture:", error);
        sendResponse({ success: false, error: error.message });
      });
      break;
      
    case "getState":
      sendResponse({ 
        isCapturing: stateManager.isCapturing,
        stepsCount: stateManager.steps.length
      });
      break;
      
    case "addStep":
      if (stateManager.isCapturing) {
        const stepType = message.data.type;
        const sourceType = message.data.salesforceMetadata?.captureMethod || 'event_handler';
        
        if (message.data.salesforceMetadata) {
          sfLog(`Adding Salesforce step: ${stepType} (via ${sourceType})`);
        } else {
          log(`Adding step: ${stepType}`);
        }
        
        // Skip steps from tracking domains
        if (message.data.url && isTrackingDomain(message.data.url)) {
          log("Skipping step from tracking domain:", message.data.url);
          sendResponse({ success: false, error: "Tracking domain" });
          break;
        }
        
        // Add the step (StateManager handles duplicate detection)
        const stepCount = stateManager.addStep(message.data);
        sendResponse({ success: true, stepCount });
      } else {
        log("Rejecting step: not in capture mode");
        sendResponse({ success: false, error: "Not in capture mode" });
      }
      break;
      
    case "getSteps":
      // This will be called by the editor page to get the steps
      log("Editor requesting steps, sending:", stateManager.steps.length);
      sendResponse({ steps: stateManager.steps });
      break;
      
    case "clearSteps":
      // Clear after export
      log("Clearing steps");
      resetState();
      sendResponse({ success: true });
      break;
      
    case "captureScreenshot":
      // Pass along force capture flag if present
      const forceCapture = message.forceCapture || false;
      const isSalesforceScreenshot = message.isSalesforce || false;  // Renamed to avoid redeclaration
      
      screenshotService.captureTabScreenshot(isSalesforceScreenshot, forceCapture).then(screenshot => {
        sendResponse({ screenshot });
      }).catch(error => {
        console.error("Error capturing screenshot:", error);
        sendResponse({ error: error.message });
      });
      break;
      
    case "getDiagnostics":
      // Return diagnostic information
      sendResponse({
        stateManager: stateManager.getDiagnosticData(),
        screenshotService: screenshotService.getDiagnosticData(),
        isCapturing: stateManager.isCapturing,
        lastStepTime: stateManager.lastStepTime,
        stepTypeStats: stateManager.getStepTypeStats(),
        pendingStepCount: stateManager.pendingSteps?.length || 0
      });
      break;
  }
  
  return true; // Required for async response
});

// Handle tab closures for the editor tab
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === stateManager.editorTabId) {
    // Editor was closed, clean up data
    log("Editor tab closed, cleaning up data");
    resetState();
  }
  
  // Also remove from readyTabs if it exists
  if (stateManager.readyTabs && stateManager.readyTabs[tabId]) {
    delete stateManager.readyTabs[tabId];
  }
});

// Initial setup
log("SotoScribe background script initialized");
resetState();
