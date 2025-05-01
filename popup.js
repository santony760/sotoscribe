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

document.addEventListener('DOMContentLoaded', async () => {
  const startButton = document.getElementById('startCapture');
  const stopButton = document.getElementById('stopCapture');
  const statusText = document.getElementById('status');
  
  // Get the current state
  const state = await getCurrentState();
  updateUI(state);
  
  // Add event listeners
  startButton.addEventListener('click', startCapture);
  stopButton.addEventListener('click', stopCapture);
});

// Get current capture state
async function getCurrentState() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getState' }, (response) => {
      resolve(response || { isCapturing: false, stepsCount: 0 });
    });
  });
}

// Start capturing
async function startCapture() {
  // Send message to background script
  await chrome.runtime.sendMessage({ action: 'startCapture' });
  
  // Update UI
  updateUI({ isCapturing: true, stepsCount: 0 });
  
  // Close popup
  window.close();
}

// Stop capturing
async function stopCapture() {
  // Send message to background script
  await chrome.runtime.sendMessage({ action: 'stopCapture' });
  
  // Update UI
  const state = await getCurrentState();
  updateUI(state);
  
  // Close popup
  window.close();
}

// Update the UI based on the current state
function updateUI(state) {
  const startButton = document.getElementById('startCapture');
  const stopButton = document.getElementById('stopCapture');
  const statusText = document.getElementById('status');
  
  if (state.isCapturing) {
    startButton.style.display = 'none';
    stopButton.style.display = 'block';
    statusText.textContent = 'Recording in progress';
    statusText.classList.add('recording');
  } else {
    startButton.style.display = 'block';
    stopButton.style.display = 'none';
    
    if (state.stepsCount > 0) {
      statusText.textContent = `${state.stepsCount} steps captured. Recording stopped.`;
    } else {
      statusText.textContent = 'Ready to capture';
    }
    
    statusText.classList.remove('recording');
  }
}
