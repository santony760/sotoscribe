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
let sharePointModal;
let imageEditModal;
let exportPdfBtn;
let exportSharePointBtn;

// Initialize the editor
document.addEventListener('DOMContentLoaded', async () => {
  // Get DOM elements
  stepsContainer = document.getElementById('stepsContainer');
  exportModal = document.getElementById('exportModal');
  sharePointModal = document.getElementById('sharePointModal');
  imageEditModal = document.getElementById('imageEditModal');
  exportPdfBtn = document.getElementById('exportPdfBtn');
  exportSharePointBtn = document.getElementById('exportSharePointBtn');
  
  // Add event listeners for export buttons
  exportPdfBtn.addEventListener('click', prepareExport);
  exportSharePointBtn.addEventListener('click', prepareSharePointEmbed);
  document.getElementById('closeExportBtn').addEventListener('click', closeExportModal);
  document.getElementById('confirmExportBtn').addEventListener('click', downloadPdf);
  document.getElementById('closeSharePointBtn').addEventListener('click', closeSharePointModal);
  document.getElementById('copyEmbedBtn').addEventListener('click', copyEmbedCode);
  
  // Image editing modal buttons
  document.getElementById('cancelImageEditBtn').addEventListener('click', closeImageEditModal);
  document.getElementById('saveImageEditBtn').addEventListener('click', saveImageEdit);
  document.getElementById('blurToolBtn').addEventListener('click', () => setImageEditTool('blur'));
  document.getElementById('annotateToolBtn').addEventListener('click', () => setImageEditTool('annotate'));
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
    chrome.runtime.sendMessage({ action: 'getSteps' }, (response) => {
      if (response && response.steps) {
        workflowSteps = response.steps;
      }
      resolve();
    });
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
  metadata.textContent = `${step.title || 'Untitled Page'} (${formatUrl(step.url)})`;
  
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
  
  // Set up canvas
  const canvasContainer = document.getElementById('imageEditCanvas');
  canvasContainer.innerHTML = `<canvas id="editCanvas" style="width: 100%;"></canvas>`;
  const canvas = document.getElementById('editCanvas');
  const ctx = canvas.getContext('2d');
  
  // Load image
  const img = new Image();
  img.onload = () => {
    // Set canvas dimensions
    canvas.width = img.width;
    canvas.height = img.height;
    
    // Draw image
    ctx.drawImage(img, 0, 0);
    
    // Show modal
    imageEditModal.style.display = 'flex';
  };
  img.src = imageSource;
}

// Set image edit tool
function setImageEditTool(tool) {
  const canvas = document.getElementById('editCanvas');
  if (!canvas) return;
  
  // Clear existing event listeners
  canvas.removeEventListener('mousedown', handleBlur);
  canvas.removeEventListener('mousedown', handleAnnotate);
  
  // Set new tool
  if (tool === 'blur') {
    canvas.addEventListener('mousedown', handleBlur);
  } else if (tool === 'annotate') {
    canvas.addEventListener('mousedown', handleAnnotate);
  }
}

// Handle blur tool
function handleBlur(event) {
  const canvas = document.getElementById('editCanvas');
  const ctx = canvas.getContext('2d');
  
  // Get mouse position
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;
  
  // Apply pixelation effect (simplified blur)
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
}

// Reset image to original
function resetImage() {
  if (!currentStepBeingEdited && currentStepBeingEdited !== 0) return;
  
  const step = workflowSteps[currentStepBeingEdited];
  const imageSource = step.screenshot;
  
  if (!imageSource) return;
  
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

// Generate PDF
async function generatePdf() {
  // This is just a placeholder for PDF generation
  // We would use a library like jsPDF for a real implementation
  
  // For demonstration, we'll create a simple PDF-like object
  const pdfData = {
    title: 'SotoScribe Workflow Documentation',
    date: new Date().toLocaleDateString(),
    steps: workflowSteps
  };
  
  return new Promise((resolve) => {
    // Simulate PDF generation
    setTimeout(() => {
      resolve(pdfData);
    }, 500);
  });
}

// Download PDF
async function downloadPdf() {
  // Change button text to show progress
  const downloadBtn = document.getElementById('confirmExportBtn');
  downloadBtn.textContent = 'Generating PDF...';
  downloadBtn.disabled = true;
  
  try {
    // Generate PDF data
    await generatePdf();
    
    // Create a dummy blob for demonstration
    // In a real implementation, we'd create a PDF blob
    const blob = new Blob([JSON.stringify(workflowSteps)], { type: 'application/pdf' });
    
    // Create a download link
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workflow-${Date.now()}.pdf`;
    document.body.appendChild(a);
    a.click();
    
    // Clean up
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    
    // Clear data after export
    chrome.runtime.sendMessage({ action: 'clearSteps' });
    
    // Close modal
    closeExportModal();
    
    // Show success message
    alert('Workflow exported successfully. All temporary data has been cleared.');
    
    // Close the editor tab
    window.close();
  } catch (error) {
    alert('Error generating PDF: ' + error.message);
  } finally {
    // Reset button
    downloadBtn.textContent = 'Download PDF';
    downloadBtn.disabled = false;
  }
}

// Prepare SharePoint embed code
function prepareSharePointEmbed() {
  if (workflowSteps.length === 0) {
    alert('No steps to embed. Capture some workflow steps first.');
    return;
  }
  
  // Generate embed code
  const embedCode = document.getElementById('embedCode');
  
  // This is a simplified placeholder for the embed code
  // In a real implementation, we'd create a more sophisticated HTML snippet
  embedCode.value = `<!-- SotoScribe Workflow Embed -->
<div class="sotoscribe-workflow" style="border: 1px solid #eee; padding: 15px; max-width: 800px; margin: 0 auto;">
  <h2>Workflow Documentation</h2>
  <p>Created on ${new Date().toLocaleDateString()}</p>
  
  ${workflowSteps.map((step, index) => `
    <div style="margin: 20px 0; padding: 10px; border: 1px solid #ddd;">
      <h3>Step ${index + 1}</h3>
      <p>${step.instruction || 'No instruction'}</p>
      ${step.screenshot ? `<img src="[DATA_URL_REMOVED_FOR_SECURITY]" alt="Step ${index + 1}" style="max-width: 100%; border: 1px solid #eee;" />` : ''}
    </div>
  `).join('')}
</div>
<!-- End SotoScribe Workflow Embed -->`;
  
  // Show modal
  sharePointModal.style.display = 'flex';
}

// Close SharePoint modal
function closeSharePointModal() {
  sharePointModal.style.display = 'none';
}

// Copy embed code to clipboard
function copyEmbedCode() {
  const embedCode = document.getElementById('embedCode');
  
  // Select the text
  embedCode.select();
  
  // Copy to clipboard
  document.execCommand('copy');
  
  // Show success message
  const copyBtn = document.getElementById('copyEmbedBtn');
  const originalText = copyBtn.textContent;
  copyBtn.textContent = 'Copied!';
  
  // Reset button after a short delay
  setTimeout(() => {
    copyBtn.textContent = originalText;
  }, 2000);
}
