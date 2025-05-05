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

// SotoScribe - Editor Controller
// Handles the post-capture workspace for editing and exporting workflows

// In-memory storage for steps
let workflowSteps = [];
let currentStepBeingEdited = null;

// DOM elements
let stepsContainer;
let exportModal;
let imageEditModal;
let exportHtmlBtn;

// For storing canvas elements and tracking drag functionality
let canvasElements = [];
let isDragging = false;
let selectedElement = null;
let offsetX, offsetY;

// Initialize the editor
document.addEventListener('DOMContentLoaded', async () => {
  // Get DOM elements
  stepsContainer = document.getElementById('stepsContainer');
  exportModal = document.getElementById('exportModal');
  imageEditModal = document.getElementById('imageEditModal');
  exportHtmlBtn = document.getElementById('exportHtmlBtn');
  
  // Add event listeners for export buttons
  exportHtmlBtn.addEventListener('click', () => prepareExport());
  document.getElementById('closeExportBtn').addEventListener('click', closeExportModal);
  document.getElementById('confirmExportBtn').addEventListener('click', downloadExport);
  
  // Image editing modal buttons
  document.getElementById('cancelImageEditBtn').addEventListener('click', closeImageEditModal);
  document.getElementById('saveImageEditBtn').addEventListener('click', saveImageEdit);
  document.getElementById('blurToolBtn').addEventListener('click', () => setImageEditTool('blur'));
  document.getElementById('annotateToolBtn').addEventListener('click', () => setImageEditTool('annotate'));
  document.getElementById('clickTargetBtn').addEventListener('click', () => setImageEditTool('clickTarget'));
  document.getElementById('resetImageBtn').addEventListener('click', resetImage);
  
  // Get steps from background script
  await loadSteps();
  
  // Render steps
  renderSteps();
  
  // Listen for beforeunload to warn about data loss
  window.addEventListener('beforeunload', (event) => {
    if (workflowSteps.length > 0) {
      event.preventDefault();
      event.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
      return event.returnValue;
    }
  });
});

// Load steps from background script
async function loadSteps() {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ action: 'getSteps' }, (response) => {
        if (response && response.steps) {
          workflowSteps = response.steps;
          console.log("Successfully loaded", workflowSteps.length, "steps");
        }
        resolve();
      });
    } catch (error) {
      console.error("Error loading steps:", error);
      resolve();
    }
  });
}

// Render all steps in the editor
function renderSteps() {
  // Clear the container
  stepsContainer.innerHTML = '';
  
  // Add each step
  workflowSteps.forEach((step, index) => {
    const stepElement = createStepElement(step, index);
    stepsContainer.appendChild(stepElement);
  });
  
  // Show message if no steps
  if (workflowSteps.length === 0) {
    stepsContainer.innerHTML = `
      <div style="text-align: center; padding: 50px; color: #666;">
        <p>No steps have been captured yet.</p>
        <button id="startNewCapture" class="secondary">Start New Capture</button>
      </div>
    `;
    
    document.getElementById('startNewCapture').addEventListener('click', () => {
      window.close();
    });
  }
}

// Create a DOM element for a step
function createStepElement(step, index) {
  const stepElement = document.createElement('div');
  stepElement.className = 'step';
  stepElement.dataset.index = index;
  
  // Create step header
  const header = document.createElement('div');
  header.className = 'step-header';
  header.innerHTML = `
    <div class="step-number">Step ${index + 1}</div>
    <div class="step-buttons">
      ${index > 0 ? '<button class="step-button move-up" title="Move Up">↑</button>' : ''}
      ${index < workflowSteps.length - 1 ? '<button class="step-button move-down" title="Move Down">↓</button>' : ''}
      <button class="step-button delete" title="Delete Step">×</button>
    </div>
  `;
  
  // Create step content
  const content = document.createElement('div');
  content.className = 'step-content';
  
  // Image section
  const imageSection = document.createElement('div');
  imageSection.className = 'step-image';
  
  if (step.screenshot) {
    imageSection.innerHTML = `
      <img src="${step.screenshot}" alt="Step ${index + 1}" />
      <div class="image-controls">
        <button class="step-button edit-image" title="Edit Image">✏️</button>
      </div>
    `;
  } else {
    imageSection.innerHTML = `
      <div style="padding: 50px; text-align: center; background-color: #f5f5f5; border-radius: 3px;">
        <p>No screenshot available</p>
      </div>
    `;
  }
  
  // Details section
  const detailsSection = document.createElement('div');
  detailsSection.className = 'step-details';
  
  // Create editable instruction
  const instructionTextarea = document.createElement('textarea');
  instructionTextarea.className = 'step-instruction';
  instructionTextarea.value = step.instruction || '';
  instructionTextarea.placeholder = 'Enter instruction for this step...';
  
  // Update the step data when instruction changes
  instructionTextarea.addEventListener('change', () => {
    workflowSteps[index].instruction = instructionTextarea.value;
  });
  
  // Add metadata
  const metadata = document.createElement('div');
  metadata.className = 'step-metadata';
  metadata.textContent = `${step.title || 'Untitled Page'} (${formatUrl(step.url || '')})`;
  
  // Assemble the details section
  detailsSection.appendChild(instructionTextarea);
  detailsSection.appendChild(metadata);
  
  // Assemble the content
  content.appendChild(imageSection);
  content.appendChild(detailsSection);
  
  // Assemble the step
  stepElement.appendChild(header);
  stepElement.appendChild(content);
  
  // Add event listeners for buttons
  const moveUpBtn = header.querySelector('.move-up');
  if (moveUpBtn) {
    moveUpBtn.addEventListener('click', () => moveStep(index, 'up'));
  }
  
  const moveDownBtn = header.querySelector('.move-down');
  if (moveDownBtn) {
    moveDownBtn.addEventListener('click', () => moveStep(index, 'down'));
  }
  
  const deleteBtn = header.querySelector('.delete');
  deleteBtn.addEventListener('click', () => deleteStep(index));
  
  const editImageBtn = content.querySelector('.edit-image');
  if (editImageBtn) {
    editImageBtn.addEventListener('click', () => openImageEditor(index));
  }
  
  return stepElement;
}

// Format URL for display
function formatUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname + urlObj.pathname.slice(0, 20) + (urlObj.pathname.length > 20 ? '...' : '');
  } catch (e) {
    return url;
  }
}

// Move a step up or down
function moveStep(index, direction) {
  if (direction === 'up' && index > 0) {
    // Swap with previous step
    const temp = workflowSteps[index];
    workflowSteps[index] = workflowSteps[index - 1];
    workflowSteps[index - 1] = temp;
  } else if (direction === 'down' && index < workflowSteps.length - 1) {
    // Swap with next step
    const temp = workflowSteps[index];
    workflowSteps[index] = workflowSteps[index + 1];
    workflowSteps[index + 1] = temp;
  }
  
  // Re-render steps
  renderSteps();
}

// Delete a step
function deleteStep(index) {
  if (confirm('Are you sure you want to delete this step?')) {
    workflowSteps.splice(index, 1);
    renderSteps();
  }
}

// Open image editor
function openImageEditor(index) {
  currentStepBeingEdited = index;
  
  // Get the image
  const step = workflowSteps[index];
  const imageSource = step.screenshot;
  
  if (!imageSource) {
    alert('No image available to edit.');
    return;
  }
  
  // Reset canvas elements array
  canvasElements = [];
  
  // Set up canvas
  const canvasContainer = document.getElementById('imageEditCanvas');
  canvasContainer.innerHTML = `<canvas id="editCanvas" style="width: 100%;"></canvas>`;
  const canvas = document.getElementById('editCanvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  
  // Load image
  const img = new Image();
  img.onload = () => {
    // Set canvas dimensions
    canvas.width = img.width;
    canvas.height = img.height;
    
    // Draw image
    ctx.drawImage(img, 0, 0);
    
    // Setup drag events for the canvas
    setupCanvasDragEvents(canvas);
    
    // Show modal
    imageEditModal.style.display = 'flex';
  };
  img.src = imageSource;
}

// Setup drag events for canvas elements
function setupCanvasDragEvents(canvas) {
  // Mouse down event - start dragging if on an element
  canvas.addEventListener('mousedown', function(event) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (event.clientX - rect.left) * scaleX;
    const mouseY = (event.clientY - rect.top) * scaleY;

    // Check if we're on a draggable element
    for (let i = canvasElements.length - 1; i >= 0; i--) {
      const element = canvasElements[i];
      const dx = mouseX - element.x;
      const dy = mouseY - element.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // If mouse is within the circle
      if (distance <= element.radius) {
        isDragging = true;
        selectedElement = element;
        offsetX = dx;
        offsetY = dy;
        break;
      }
    }
  });

  // Mouse move event - update position if dragging
  canvas.addEventListener('mousemove', function(event) {
    if (isDragging && selectedElement) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const mouseX = (event.clientX - rect.left) * scaleX;
      const mouseY = (event.clientY - rect.top) * scaleY;
      
      // Update element position
      selectedElement.x = mouseX - offsetX;
      selectedElement.y = mouseY - offsetY;
      
      // Redraw canvas
      redrawCanvas(canvas);
    }
  });

  // Mouse up event - stop dragging
  canvas.addEventListener('mouseup', function() {
    isDragging = false;
    selectedElement = null;
  });
  
  // Mouse out event - stop dragging if mouse leaves canvas
  canvas.addEventListener('mouseout', function() {
    isDragging = false;
    selectedElement = null;
  });
}

// Redraw the canvas with all elements
function redrawCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const step = workflowSteps[currentStepBeingEdited];
  
  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Draw base image
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0);
    
    // Draw all elements
    canvasElements.forEach(element => {
      if (element.type === 'annotation') {
        // Draw circle
        ctx.beginPath();
        ctx.arc(element.x, element.y, element.radius, 0, 2 * Math.PI);
        ctx.strokeStyle = '#00B3A4';
        ctx.lineWidth = 3;
        ctx.stroke();
        
        // Draw number
        ctx.font = 'bold 16px Arial';
        ctx.fillStyle = '#00B3A4';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(element.text, element.x, element.y);
      } else if (element.type === 'clickTarget') {
        // Draw red click target
        ctx.beginPath();
        ctx.arc(element.x, element.y, element.radius, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(255, 0, 0, 0.2)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.4)';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    });
  };
  img.src = step.screenshot;
}

// Set image edit tool
function setImageEditTool(tool) {
  const canvas = document.getElementById('editCanvas');
  if (!canvas) return;
  
  // Clear existing event listeners
  canvas.removeEventListener('mousedown', handleBlur);
  canvas.removeEventListener('mousedown', handleAnnotate);
  canvas.removeEventListener('mousedown', handleClickTarget);
  
  // Set new tool
  if (tool === 'blur') {
    canvas.addEventListener('mousedown', handleBlur);
  } else if (tool === 'annotate') {
    canvas.addEventListener('mousedown', handleAnnotate);
  } else if (tool === 'clickTarget') {
    canvas.addEventListener('mousedown', handleClickTarget);
  }
}

// Track if we're currently in blur mode
let isBlurring = false;

// Set image edit tool - KEEP ONLY THIS VERSION of the function
function setImageEditTool(tool) {
  const canvas = document.getElementById('editCanvas');
  if (!canvas) return;
  
  // Clear existing event listeners
  canvas.removeEventListener('mousedown', startBlurring);
  canvas.removeEventListener('mousemove', handleBlurMove);
  canvas.removeEventListener('mouseup', stopBlurring);
  canvas.removeEventListener('mouseout', stopBlurring);
  canvas.removeEventListener('mousedown', handleAnnotate);
  canvas.removeEventListener('mousedown', handleClickTarget);
  
  // Set new tool
  if (tool === 'blur') {
    canvas.addEventListener('mousedown', startBlurring);
    canvas.addEventListener('mousemove', handleBlurMove);
    canvas.addEventListener('mouseup', stopBlurring);
    canvas.addEventListener('mouseout', stopBlurring);
  } else if (tool === 'annotate') {
    canvas.addEventListener('mousedown', handleAnnotate);
  } else if (tool === 'clickTarget') {
    canvas.addEventListener('mousedown', handleClickTarget);
  }
}

// Start blurring (on mouse down)
function startBlurring(event) {
  // Prevent starting blur if we're dragging an element
  if (isDragging) return;
  
  isBlurring = true;
  // Apply initial blur at the clicked position
  applyBlur(event);
}

// Continue blurring as mouse moves
function handleBlurMove(event) {
  if (isBlurring) {
    applyBlur(event);
  }
}

// Stop blurring (on mouse up or mouse out)
function stopBlurring() {
  isBlurring = false;
}

// Apply blur at the current position
function applyBlur(event) {
  const canvas = document.getElementById('editCanvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  
  // Get mouse position
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;
  
  // Apply pixelation effect (same as your current blur implementation)
  const size = 20; // Size of blur area
  const pixelSize = 10; // Size of pixelation
  
  // Store the region data
  const imageData = ctx.getImageData(x - size/2, y - size/2, size, size);
  
  // Pixelate the region
  for (let i = 0; i < size; i += pixelSize) {
    for (let j = 0; j < size; j += pixelSize) {
      // Skip if out of bounds
      if (i + pixelSize > size || j + pixelSize > size) continue;
      
      // Get average color
      let r = 0, g = 0, b = 0, a = 0, count = 0;
      
      for (let dx = 0; dx < pixelSize; dx++) {
        for (let dy = 0; dy < pixelSize; dy++) {
          const idx = ((j + dy) * size + (i + dx)) * 4;
          if (idx < imageData.data.length) {
            r += imageData.data[idx];
            g += imageData.data[idx + 1];
            b += imageData.data[idx + 2];
            a += imageData.data[idx + 3];
            count++;
          }
        }
      }
      
      r = Math.floor(r / count);
      g = Math.floor(g / count);
      b = Math.floor(b / count);
      a = Math.floor(a / count);
      
      // Apply average color to the region
      for (let dx = 0; dx < pixelSize; dx++) {
        for (let dy = 0; dy < pixelSize; dy++) {
          const idx = ((j + dy) * size + (i + dx)) * 4;
          if (idx < imageData.data.length) {
            imageData.data[idx] = r;
            imageData.data[idx + 1] = g;
            imageData.data[idx + 2] = b;
            imageData.data[idx + 3] = a;
          }
        }
      }
    }
  }
  
  // Put the modified data back
  ctx.putImageData(imageData, x - size/2, y - size/2);
}

// Handle annotate tool
function handleAnnotate(event) {
  const canvas = document.getElementById('editCanvas');
  const ctx = canvas.getContext('2d');
  
  // Check if we're trying to drag an element
  if (isDragging) return;
  
  // Get mouse position
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;
  
  // Draw circle
  ctx.beginPath();
  ctx.arc(x, y, 15, 0, 2 * Math.PI);
  ctx.strokeStyle = '#00B3A4';
  ctx.lineWidth = 3;
  ctx.stroke();
  
  // Add number label
  const stepNumber = parseInt(prompt('Enter annotation number:', '1')) || 1;
  ctx.font = 'bold 16px Arial';
  ctx.fillStyle = '#00B3A4';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(stepNumber.toString(), x, y);
  
  // Add to canvas elements for drag support
  canvasElements.push({
    type: 'annotation',
    x: x,
    y: y,
    radius: 15,
    text: stepNumber.toString()
  });
}

// Handle click target tool
function handleClickTarget(event) {
  const canvas = document.getElementById('editCanvas');
  const ctx = canvas.getContext('2d');
  
  // Check if we're trying to drag an element
  if (isDragging) return;
  
  // Get mouse position
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;
  
  // Draw red click target with shadow effect
  // First draw the "shadow" (outer circle)
  ctx.beginPath();
  ctx.arc(x, y, 20, 0, 2 * Math.PI); // 10px for inner circle + 3px for the shadow spread
  ctx.fillStyle = 'rgba(255, 0, 0, 0.2)'; // Shadow color from the original
  ctx.fill();

  // Then draw the inner circle on top
  ctx.beginPath();
  ctx.arc(x, y, 17, 0, 2 * Math.PI); // 10px radius = 20px diameter
  ctx.fillStyle = 'rgba(255, 0, 0, 0.1)'; // Main dot color from the original
  ctx.fill();
  
  // Add to canvas elements for drag support
  canvasElements.push({
    type: 'clickTarget',
    x: x,
    y: y,
    radius: 20  // Use the larger radius (shadow size) for hit detection
  });
}

// Reset image to original
function resetImage() {
  if (!currentStepBeingEdited && currentStepBeingEdited !== 0) return;
  
  const step = workflowSteps[currentStepBeingEdited];
  const imageSource = step.screenshot;
  
  if (!imageSource) return;
  
  // Clear canvas elements
  canvasElements = [];
  
  // Reload the image
  const canvas = document.getElementById('editCanvas');
  const ctx = canvas.getContext('2d');
  
  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
  };
  img.src = imageSource;
}

// Save image edit
function saveImageEdit() {
  if (!currentStepBeingEdited && currentStepBeingEdited !== 0) return;
  
  const canvas = document.getElementById('editCanvas');
  if (!canvas) return;
  
  // Update the screenshot in the steps data
  workflowSteps[currentStepBeingEdited].screenshot = canvas.toDataURL('image/png');
  
  // Close modal
  closeImageEditModal();
  
  // Re-render steps
  renderSteps();
}

// Close image edit modal
function closeImageEditModal() {
  imageEditModal.style.display = 'none';
  currentStepBeingEdited = null;
  isDragging = false;
  selectedElement = null;
}

// Prepare for export
function prepareExport() {
  if (workflowSteps.length === 0) {
    alert('No steps to export. Capture some workflow steps first.');
    return;
  }
  
  // Show modal
  exportModal.style.display = 'flex';
  
  // Generate preview
  const exportContent = document.getElementById('exportContent');
  exportContent.innerHTML = `
    <div style="margin: 15px 0;">
      <p><strong>Workflow with ${workflowSteps.length} steps</strong></p>
      <p>Created on ${new Date().toLocaleDateString()}</p>
      <p>Export format: HTML Document</p>
    </div>
    <div style="max-height: 300px; overflow-y: auto; border: 1px solid #eee; padding: 10px;">
      ${workflowSteps.map((step, index) => `
        <div style="margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #eee;">
          <strong>Step ${index + 1}:</strong> ${step.instruction || 'No instruction'}
        </div>
      `).join('')}
    </div>
  `;
}

// Close export modal
function closeExportModal() {
  exportModal.style.display = 'none';
}

// Generate HTML document with workflow
function generateHtml() {
  // Create HTML content
  let htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SotoScribe Workflow Documentation</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
      color: #333;
      line-height: 1.5;
    }
    header {
      text-align: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 1px solid #eee;
    }
    h1 {
      color: #00635A;
      margin-bottom: 10px;
    }
    .creation-date {
      color: #666;
      font-style: italic;
    }
    .step {
      margin-bottom: 40px;
      padding-bottom: 30px;
      border-bottom: 1px solid #eee;
    }
    .step:last-child {
      border-bottom: none;
    }
    .step-header {
      display: flex;
      align-items: center;
      margin-bottom: 15px;
    }
    .step-number {
      background-color: #00B3A4;
      color: white;
      font-weight: bold;
      padding: 5px 10px;
      border-radius: 20px;
      margin-right: 10px;
    }
    .step-instruction {
      font-size: 18px;
      margin-bottom: 15px;
    }
    .step-metadata {
      font-size: 14px;
      color: #666;
      margin-bottom: 15px;
    }
    .step-screenshot {
      max-width: 100%;
      height: auto;
      border: 1px solid #ddd;
      border-radius: 4px;
    }
    footer {
      margin-top: 40px;
      text-align: center;
      color: #666;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <header>
    <h1>SotoScribe Workflow Documentation</h1>
    <p class="creation-date">Created on ${new Date().toLocaleDateString()}</p>
  </header>
  
  <main>
`;

  // Add each step
  workflowSteps.forEach((step, index) => {
    htmlContent += `
    <div class="step">
      <div class="step-header">
        <div class="step-number">${index + 1}</div>
        <h2>${step.instruction || 'No instruction'}</h2>
      </div>
      
      <div class="step-metadata">
        <p><strong>Page:</strong> ${step.title || 'Untitled Page'}</p>
        <p><strong>URL:</strong> ${step.url || 'Unknown URL'}</p>
      </div>
      
      ${step.screenshot ? `<img class="step-screenshot" src="${step.screenshot}" alt="Step ${index + 1} screenshot">` : '<p>[No screenshot available]</p>'}
    </div>
  `;
  });

  // Close HTML structure
  htmlContent += `
  </main>
  
  <footer>
    <p>Generated with SotoScribe - Workflow Documentation Tool</p>
  </footer>
</body>
</html>`;

  return htmlContent;
}

// Download export (HTML)
async function downloadExport() {
  // Change button text to show progress
  const downloadBtn = document.getElementById('confirmExportBtn');
  const originalText = downloadBtn.textContent;
  
  // Add loading spinner
  downloadBtn.innerHTML = '<span class="loader"></span>Generating HTML...';
  downloadBtn.disabled = true;
  
  try {
    // Generate HTML content
    const htmlContent = generateHtml();
    
    // Create a blob with the HTML content
    const blob = new Blob([htmlContent], { type: 'text/html' });
    
    // Create a download link
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workflow-${Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    
    // Clean up
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    
    // Clear data after export
    try {
      chrome.runtime.sendMessage({ action: 'clearSteps' });
    } catch (error) {
      console.error("Error clearing steps:", error);
    }
    
    // Close modal
    closeExportModal();
    
    // Show success message
    alert(`Workflow exported successfully as HTML. All temporary data has been cleared.`);
    
    // Close the editor tab
    window.close();
  } catch (error) {
    console.error(`Error during HTML export:`, error);
    alert(`Error generating HTML: ${error.message}`);
  } finally {
    // Reset button
    downloadBtn.innerHTML = originalText;
    downloadBtn.disabled = false;
  }
}
