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

// SotoScribe - Popup UI Controller
// Handles the popup UI for starting and stopping workflow capture

import { log, sfLog } from '../shared/logging.js';
import { config } from '../shared/config.js';

// DOM elements
let startButton;
let stopButton;
let statusText;
let diagnosticsLink;
let salesforceMode;

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
  // Get DOM elements
  startButton = document.getElementById('startCapture');
  stopButton = document.getElementById('stopCapture');
  statusText = document.getElementById('status');
  diagnosticsLink = document.getElementById('diagnosticsLink');
  salesforceMode = document.getElementById('salesforceMode');
  
  // Get the current state
  const state = await getCurrentState();
  updateUI(state);
  
  // Check if we're on Salesforce
  const isSalesforce = await checkIfSalesforce();
  
  // Show Salesforce mode toggle if on a Salesforce page
  if (isSalesforce) {
    // Show Salesforce-specific UI elements
    document.querySelector('.salesforce-options').style.display = 'block';
    
    // Add Salesforce-specific event listeners
    if (salesforceMode) {
      salesforceMode.addEventListener('change', toggleSalesforceMode);
    }
    
    sfLog("Popup opened on Salesforce page");
  } else {
    document.querySelector('.salesforce-options').style.display = 'none';
  }
  
  // Add event listeners
  startButton.addEventListener('click', startCapture);
  stopButton.addEventListener('click', stopCapture);
  
  // Show diagnostics link only in debug mode
  if (config.DEBUG_MODE && diagnosticsLink) {
    diagnosticsLink.style.display = 'block';
    diagnosticsLink.addEventListener('click', showDiagnostics);
  }
  
  log("Popup initialized");
});

// Get current capture state
async function getCurrentState() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getState' }, (response) => {
      resolve(response || { isCapturing: false, stepsCount: 0 });
    });
  });
}

// Check if current page is Salesforce
async function checkIfSalesforce() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTab = tabs[0];
      const isSalesforce = 
        currentTab.url.includes('lightning.force.com') || 
        currentTab.url.includes('salesforce.com') ||
        currentTab.url.includes('visualforce.com');
      
      resolve(isSalesforce);
    });
  });
}

// Start capturing
async function startCapture() {
  log("User requested to start capture");
  
  // Get Salesforce mode setting
  const salesforceEnhanced = salesforceMode && salesforceMode.checked;
  
  // Send message to background script
  await chrome.runtime.sendMessage({ 
    action: 'startCapture',
    salesforceEnhanced: salesforceEnhanced
  });
  
  // Update UI
  updateUI({ isCapturing: true, stepsCount: 0 });
  
  // Close popup
  window.close();
}

// Stop capturing
async function stopCapture() {
  log("User requested to stop capture");
  
  // Send message to background script
  await chrome.runtime.sendMessage({ action: 'stopCapture' });
  
  // Update UI
  const state = await getCurrentState();
  updateUI(state);
  
  // Close popup
  window.close();
}

// Toggle Salesforce enhanced mode
function toggleSalesforceMode() {
  const enhanced = salesforceMode.checked;
  
  // Send setting to background script
  chrome.runtime.sendMessage({ 
    action: 'setSalesforceMode', 
    enhanced: enhanced 
  });
  
  if (enhanced) {
    sfLog("User enabled Salesforce enhanced mode");
  } else {
    sfLog("User disabled Salesforce enhanced mode");
  }
}

// Show diagnostics info
function showDiagnostics() {
  chrome.runtime.sendMessage({ action: 'getDiagnostics' }, (response) => {
    if (response) {
      // Format diagnostics data
      const formatted = JSON.stringify(response, null, 2);
      
      // Show in a dialog
      alert(`Diagnostics:\n${formatted}`);
      
      // Copy to clipboard
      navigator.clipboard.writeText(formatted).then(() => {
        console.log("Diagnostics copied to clipboard");
      });
    }
  });
}

// Update the UI based on the current state
function updateUI(state) {
  if (state.isCapturing) {
    startButton.style.display = 'none';
    stopButton.style.display = 'block';
    statusText.textContent = 'Recording in progress';
    statusText.classList.add('recording');
    
    // Disable Salesforce mode toggle during recording
    if (salesforceMode) {
      salesforceMode.disabled = true;
    }
  } else {
    startButton.style.display = 'block';
    stopButton.style.display = 'none';
    
    if (state.stepsCount > 0) {
      statusText.textContent = `${state.stepsCount} steps captured. Recording stopped.`;
    } else {
      statusText.textContent = 'Ready to capture';
    }
    
    statusText.classList.remove('recording');
    
    // Enable Salesforce mode toggle when not recording
    if (salesforceMode) {
      salesforceMode.disabled = false;
    }
  }
}
