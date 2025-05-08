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

// SotoScribe - Image Editor Module
// Handles screenshot editing functionality in the editor

import { log } from '../shared/logging.js';
import { config } from '../shared/config.js';

// State for image editor
let currentStepBeingEdited = null;
let workflowSteps = [];
let imageEditModal = null;
let canvasElements = [];
let isDragging = false;
let selectedElement = null;
let offsetX, offsetY;
let isBlurring = false;

// Zoom state
let zoomLevel = 1; // 1 = 100%
const MIN_ZOOM = 0.25; // 25%
const MAX_ZOOM = 3; // 300%
const ZOOM_STEP = 0.25; // 25% per step

/**
 * Initialize the image editor
 * @param {Array} steps - Workflow steps
 * @param {HTMLElement} modal - Modal element
 */
export function initImageEditor(steps, modal) {
  workflowSteps = steps;
  imageEditModal = modal;
  
  // Add event listeners for modal buttons
  document.getElementById('cancelImageEditBtn').addEventListener('click', closeImageEditModal);
  document.getElementById('saveImageEditBtn').addEventListener('click', saveImageEdit);
  document.getElementById('saveZoomedImageBtn').addEventListener('click', showSaveZoomedConfirmation);
  document.getElementById('blurToolBtn').addEventListener('click', () => setImageEditTool('blur'));
  document.getElementById('annotateToolBtn').addEventListener('click', () => setImageEditTool('annotate'));
  document.getElementById('clickTargetBtn').addEventListener('click', () => setImageEditTool('clickTarget'));
  document.getElementById('resetImageBtn').addEventListener('click', resetImage);
  
  // Add zoom control listeners
  document.getElementById('zoomInBtn').addEventListener('click', zoomIn);
  document.getElementById('zoomOutBtn').addEventListener('click', zoomOut);
  document.getElementById('resetZoomBtn').addEventListener('click', resetZoom);
  
  // Add confirmation modal listeners
  document.getElementById('cancelZoomedSaveBtn').addEventListener('click', closeConfirmationModal);
  document.getElementById('confirmZoomedSaveBtn').addEventListener('click', saveZoomedImage);
  
  log("Image editor initialized with zoom support");
}

/**
 * Show the confirmation modal for saving zoomed view
 */
function showSaveZoomedConfirmation() {
  const confirmationModal = document.getElementById('confirmationModal');
  if (confirmationModal) {
    confirmationModal.style.display = 'flex';
  }
}

/**
 * Close the confirmation modal
 */
function closeConfirmationModal() {
  const confirmationModal = document.getElementById('confirmationModal');
  if (confirmationModal) {
    confirmationModal.style.display = 'none';
  }
}

/**
 * Update the workflow steps reference
 * @param {Array} steps - New workflow steps reference
 */
export function updateSteps(steps) {
  workflowSteps = steps;
}

/**
 * Open the image editor for a specific step
 * @param {number} index - Index of the step in workflow
 */
export function openImageEditor(index) {
  currentStepBeingEdited = index;
  
  // Reset zoom level
  zoomLevel = 1;
  updateZoomDisplay();
  
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
  canvasContainer.innerHTML = `<canvas id="editCanvas" style="transform-origin: 0 0;"></canvas>`;
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
    
    // Apply initial zoom
    applyZoom(canvas);
    
    // Show modal
    imageEditModal.style.display = 'flex';
    
    log(`Image editor opened for step ${index + 1}`);
  };
  img.src = imageSource;
}

/**
 * Apply zoom transformation to canvas
 * @param {HTMLCanvasElement} canvas - Canvas element to zoom
 */
export function applyZoom(canvas) {
  if (!canvas) {
    canvas = document.getElementById('editCanvas');
    if (!canvas) return;
  }
  
  // Apply zoom transformation
  canvas.style.transform = `scale(${zoomLevel})`;
  
  // Update zoom percentage display
  updateZoomDisplay();
}

/**
 * Update zoom level display
 */
function updateZoomDisplay() {
  const zoomDisplay = document.getElementById('zoomLevel');
  if (zoomDisplay) {
    zoomDisplay.textContent = `${Math.round(zoomLevel * 100)}%`;
  }
}

/**
 * Zoom in 
 */
export function zoomIn() {
  if (zoomLevel < MAX_ZOOM) {
    zoomLevel += ZOOM_STEP;
    applyZoom();
    log(`Zoomed in to ${Math.round(zoomLevel * 100)}%`);
  }
}

/**
 * Zoom out
 */
export function zoomOut() {
  if (zoomLevel > MIN_ZOOM) {
    zoomLevel -= ZOOM_STEP;
    applyZoom();
    log(`Zoomed out to ${Math.round(zoomLevel * 100)}%`);
  }
}

/**
 * Reset zoom to 100%
 */
export function resetZoom() {
  zoomLevel = 1;
  applyZoom();
  log("Zoom reset to 100%");
}

/**
 * Save only the zoomed portion of the image
 * @returns {string|null} Updated screenshot data URL or null on failure
 */
export function saveZoomedImage() {
  if (!currentStepBeingEdited && currentStepBeingEdited !== 0) return null;
  
  try {
    const canvas = document.getElementById('editCanvas');
    if (!canvas) return null;
    
    const canvasContainer = document.getElementById('imageEditCanvas');
    if (!canvasContainer) return null;
    
    // Close confirmation modal
    closeConfirmationModal();
    
    // Get the current scroll position and visible area
    const scrollLeft = canvasContainer.scrollLeft;
    const scrollTop = canvasContainer.scrollTop;
    const visibleWidth = canvasContainer.clientWidth;
    const visibleHeight = canvasContainer.clientHeight;
    
    // Calculate the visible rectangle in the original image coordinates
    const sourceX = scrollLeft / zoomLevel;
    const sourceY = scrollTop / zoomLevel;
    const sourceWidth = visibleWidth / zoomLevel;
    const sourceHeight = visibleHeight / zoomLevel;
    
    // Create a new canvas for the cropped area
    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = sourceWidth;
    croppedCanvas.height = sourceHeight;
    
    // Draw only the visible portion to the new canvas
    const ctx = croppedCanvas.getContext('2d');
    ctx.drawImage(canvas, 
      sourceX, sourceY, sourceWidth, sourceHeight,  // Source rectangle
      0, 0, sourceWidth, sourceHeight               // Destination rectangle
    );
    
    // Draw annotations that are within the visible area
    canvasElements.forEach(element => {
      // Check if the element is within the visible area
      if (element.x >= sourceX && element.x <= sourceX + sourceWidth && 
          element.y >= sourceY && element.y <= sourceY + sourceHeight) {
        
        // Calculate the new position in the cropped canvas
        const newX = element.x - sourceX;
        const newY = element.y - sourceY;
        
        if (element.type === 'annotation') {
          // Draw circle
          ctx.beginPath();
          ctx.arc(newX, newY, element.radius, 0, 2 * Math.PI);
          ctx.strokeStyle = config.CAPTURE_SETTINGS.HIGHLIGHT_BORDER_COLOR;
          ctx.lineWidth = 3;
          ctx.stroke();
          
          // Draw number
          ctx.font = 'bold 16px Arial';
          ctx.fillStyle = config.CAPTURE_SETTINGS.HIGHLIGHT_BORDER_COLOR;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(element.text, newX, newY);
        } else if (element.type === 'clickTarget') {
          // Draw red click target
          ctx.beginPath();
          ctx.arc(newX, newY, element.radius, 0, 2 * Math.PI);
          ctx.fillStyle = config.CAPTURE_SETTINGS.CLICK_INDICATOR_COLOR;
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 0, 0, 0.4)';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }
    });
    
    // Get the data URL of the cropped image
    const croppedDataUrl = croppedCanvas.toDataURL('image/png');
    
    // Update the screenshot in the steps data
    workflowSteps[currentStepBeingEdited].screenshot = croppedDataUrl;
    
    log(`Saved zoomed portion of image for step ${currentStepBeingEdited + 1}`);
    
    // Close modal
    closeImageEditModal();
    
    return croppedDataUrl;
  } catch (error) {
    console.error("Error saving zoomed image:", error);
    return null;
  }
}

/**
 * Setup drag events for canvas elements
 * @param {HTMLCanvasElement} canvas - Canvas element
 */
function setupCanvasDragEvents(canvas) {
  // Mouse down event - start dragging if on an element
  canvas.addEventListener('mousedown', function(event) {
    const rect = canvas.getBoundingClientRect();
    const mouseX = (event.clientX - rect.left) / zoomLevel;
    const mouseY = (event.clientY - rect.top) / zoomLevel;

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
      const mouseX = (event.clientX - rect.left) / zoomLevel;
      const mouseY = (event.clientY - rect.top) / zoomLevel;
      
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
  
  // Add mouse wheel zoom support
  canvas.addEventListener('wheel', handleMouseWheel, { passive: false });
}

/**
 * Handle mouse wheel for zooming
 * @param {WheelEvent} event - Mouse wheel event
 */
function handleMouseWheel(event) {
  event.preventDefault();
  
  // Check if Ctrl key is pressed for zoom behavior
  if (event.ctrlKey || event.metaKey) {
    if (event.deltaY < 0) {
      // Zoom in
      zoomIn();
    } else {
      // Zoom out
      zoomOut();
    }
  }
}

/**
 * Redraw the canvas with all elements
 * @param {HTMLCanvasElement} canvas - Canvas element
 */
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
        ctx.strokeStyle = config.CAPTURE_SETTINGS.HIGHLIGHT_BORDER_COLOR;
        ctx.lineWidth = 3;
        ctx.stroke();
        
        // Draw number
        ctx.font = 'bold 16px Arial';
        ctx.fillStyle = config.CAPTURE_SETTINGS.HIGHLIGHT_BORDER_COLOR;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(element.text, element.x, element.y);
      } else if (element.type === 'clickTarget') {
        // Draw red click target
        ctx.beginPath();
        ctx.arc(element.x, element.y, element.radius, 0, 2 * Math.PI);
        ctx.fillStyle = config.CAPTURE_SETTINGS.CLICK_INDICATOR_COLOR;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.4)';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    });
  };
  img.src = step.screenshot;
}

/**
 * Set image edit tool
 * @param {string} tool - Name of the tool (blur, annotate, clickTarget)
 */
export function setImageEditTool(tool) {
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
    log("Blur tool selected");
  } else if (tool === 'annotate') {
    canvas.addEventListener('mousedown', handleAnnotate);
    log("Annotation tool selected");
  } else if (tool === 'clickTarget') {
    canvas.addEventListener('mousedown', handleClickTarget);
    log("Click target tool selected");
  }
}

/**
 * Start blurring (on mouse down)
 * @param {MouseEvent} event - Mouse event
 */
function startBlurring(event) {
  // Prevent starting blur if we're dragging an element
  if (isDragging) return;
  
  isBlurring = true;
  // Apply initial blur at the clicked position
  applyBlur(event);
}

/**
 * Continue blurring as mouse moves
 * @param {MouseEvent} event - Mouse event
 */
function handleBlurMove(event) {
  if (isBlurring) {
    applyBlur(event);
  }
}

/**
 * Stop blurring (on mouse up or mouse out)
 */
function stopBlurring() {
  isBlurring = false;
}

/**
 * Apply blur at the current position
 * @param {MouseEvent} event - Mouse event
 */
function applyBlur(event) {
  const canvas = document.getElementById('editCanvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  
  // Get mouse position with zoom adjustment
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) / zoomLevel;
  const y = (event.clientY - rect.top) / zoomLevel;
  
  // Apply pixelation effect
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

/**
 * Handle annotate tool
 * @param {MouseEvent} event - Mouse event
 */
function handleAnnotate(event) {
  const canvas = document.getElementById('editCanvas');
  const ctx = canvas.getContext('2d');
  
  // Check if we're trying to drag an element
  if (isDragging) return;
  
  // Get mouse position with zoom adjustment
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) / zoomLevel;
  const y = (event.clientY - rect.top) / zoomLevel;
  
  // Draw circle
  ctx.beginPath();
  ctx.arc(x, y, 15, 0, 2 * Math.PI);
  ctx.strokeStyle = config.CAPTURE_SETTINGS.HIGHLIGHT_BORDER_COLOR;
  ctx.lineWidth = 3;
  ctx.stroke();
  
  // Add number label
  const stepNumber = parseInt(prompt('Enter annotation number:', '1')) || 1;
  ctx.font = 'bold 16px Arial';
  ctx.fillStyle = config.CAPTURE_SETTINGS.HIGHLIGHT_BORDER_COLOR;
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
  
  log(`Added annotation #${stepNumber} at (${Math.round(x)}, ${Math.round(y)})`);
}

/**
 * Handle click target tool
 * @param {MouseEvent} event - Mouse event
 */
function handleClickTarget(event) {
  const canvas = document.getElementById('editCanvas');
  const ctx = canvas.getContext('2d');
  
  // Check if we're trying to drag an element
  if (isDragging) return;
  
  // Get mouse position with zoom adjustment
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) / zoomLevel;
  const y = (event.clientY - rect.top) / zoomLevel;
  
  // Draw red click target with shadow effect
  // First draw the "shadow" (outer circle)
  ctx.beginPath();
  ctx.arc(x, y, 20, 0, 2 * Math.PI);
  ctx.fillStyle = config.CAPTURE_SETTINGS.CLICK_INDICATOR_COLOR;
  ctx.fill();

  // Then draw the inner circle on top
  ctx.beginPath();
  ctx.arc(x, y, 17, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgba(255, 0, 0, 0.1)'; // Main dot color
  ctx.fill();
  
  // Add to canvas elements for drag support
  canvasElements.push({
    type: 'clickTarget',
    x: x,
    y: y,
    radius: 20  // Use the larger radius (shadow size) for hit detection
  });
  
  log(`Added click target at (${Math.round(x)}, ${Math.round(y)})`);
}

/**
 * Reset image to original
 */
export function resetImage() {
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
  
  log("Image reset to original");
}

/**
 * Save edited image
 * @returns {string|null} Updated screenshot data URL or null on failure
 */
export function saveImageEdit() {
  if (!currentStepBeingEdited && currentStepBeingEdited !== 0) return null;
  
  const canvas = document.getElementById('editCanvas');
  if (!canvas) return null;
  
  try {
    // Get the updated screenshot as data URL
    const screenshotDataUrl = canvas.toDataURL('image/png');
    
    // Update the screenshot in the steps data
    workflowSteps[currentStepBeingEdited].screenshot = screenshotDataUrl;
    
    log(`Saved edited image for step ${currentStepBeingEdited + 1}`);
    
    // Close modal
    closeImageEditModal();
    
    return screenshotDataUrl;
  } catch (error) {
    console.error("Error saving image edit:", error);
    return null;
  }
}

/**
 * Close image edit modal
 */
export function closeImageEditModal() {
  imageEditModal.style.display = 'none';
  currentStepBeingEdited = null;
  isDragging = false;
  selectedElement = null;
  
  // Reset zoom level
  zoomLevel = 1;
  
  log("Image editor closed");
}

/**
 * Get canvas elements
 * @returns {Array} Current canvas elements
 */
export function getCanvasElements() {
  return [...canvasElements];
}

/**
 * Get current zoom level
 * @returns {number} Current zoom level
 */
export function getZoomLevel() {
  return zoomLevel;
}

/**
 * Get visible area dimensions based on current container and zoom
 * @returns {Object} Object with x, y, width, height of visible area in original image coordinates
 */
export function getVisibleArea() {
  const canvasContainer = document.getElementById('imageEditCanvas');
  if (!canvasContainer) return null;
  
  const scrollLeft = canvasContainer.scrollLeft;
  const scrollTop = canvasContainer.scrollTop;
  const visibleWidth = canvasContainer.clientWidth;
  const visibleHeight = canvasContainer.clientHeight;
  
  return {
    x: scrollLeft / zoomLevel,
    y: scrollTop / zoomLevel,
    width: visibleWidth / zoomLevel,
    height: visibleHeight / zoomLevel
  };
}

/**
 * Add permanent annotation to an image
 * @param {string} imageDataUrl - Image data URL
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {string} text - Annotation text
 * @returns {Promise<string>} Updated image data URL
 */
export function addPermanentAnnotation(imageDataUrl, x, y, text) {
  return new Promise((resolve, reject) => {
    try {
      const img = new Image();
      img.onload = () => {
        // Create a canvas
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        
        // Draw the image
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        
        // Draw annotation
        ctx.beginPath();
        ctx.arc(x, y, 15, 0, 2 * Math.PI);
        ctx.strokeStyle = config.CAPTURE_SETTINGS.HIGHLIGHT_BORDER_COLOR;
        ctx.lineWidth = 3;
        ctx.stroke();
        
        // Draw number
        ctx.font = 'bold 16px Arial';
        ctx.fillStyle = config.CAPTURE_SETTINGS.HIGHLIGHT_BORDER_COLOR;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x, y);
        
        // Convert to data URL
        const newDataUrl = canvas.toDataURL('image/png');
        resolve(newDataUrl);
      };
      
      img.onerror = (error) => {
        reject(error);
      };
      
      img.src = imageDataUrl;
    } catch (error) {
      reject(error);
    }
  });
}