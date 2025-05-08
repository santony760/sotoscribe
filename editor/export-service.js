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

// SotoScribe - Export Service
// Handles HTML generation and document export

import { formatUrl, markdownToHtml, getBase64Size, compressScreenshot } from '../shared/utils.js';
import { log, sfLog } from '../shared/logging.js';
import { config } from '../shared/config.js';

/**
 * Generate HTML preview content
 * @param {Array} steps - Workflow steps
 * @returns {string} HTML preview content
 */
export function generatePreview(steps) {
  if (steps.length === 0) {
    return '<p>No steps to preview.</p>';
  }
  
  return `
    <div style="margin: 15px 0;">
      <p><strong>Workflow with ${steps.length} steps</strong></p>
      <p>Created on ${new Date().toLocaleDateString()}</p>
      <p>Export format: HTML Document</p>
    </div>
    <div style="max-height: 300px; overflow-y: auto; border: 1px solid #eee; padding: 10px;">
      ${steps.map((step, index) => `
        <div style="margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #eee;">
          <strong>Step ${index + 1}:</strong> ${step.instruction || 'No instruction'}
        </div>
      `).join('')}
    </div>
  `;
}

/**
 * Generate complete HTML document
 * @param {Array} steps - Workflow steps
 * @param {boolean} compressImages - Whether to compress images
 * @returns {Promise<string>} HTML document content
 */
export async function generateHtml(steps, compressImages = true) {
  log(`Generating HTML with ${steps.length} steps${compressImages ? ' (with image compression)' : ''}`);
  
  // Count Salesforce steps
  const salesforceSteps = steps.filter(step => 
    step.salesforceMetadata || step.source === 'salesforce'
  ).length;
  
  if (salesforceSteps > 0) {
    sfLog(`Including ${salesforceSteps} Salesforce steps in export`);
  }
  
  // Start with HTML template
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
    .salesforce-step .step-number {
      background-color: #00A1E0; /* Salesforce blue */
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
    .tag {
      display: inline-block;
      font-size: 12px;
      padding: 2px 8px;
      border-radius: 3px;
      margin-left: 8px;
      background-color: #f0f0f0;
      color: #666;
    }
    .salesforce-tag {
      background-color: #00A1E0;
      color: white;
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

  // Process each step
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const isSalesforceStep = step.salesforceMetadata || step.source === 'salesforce';
    
    // Convert markdown to HTML for instructions
    const instructionHtml = step.instruction ? 
      markdownToHtml(step.instruction) : 
      'No instruction';
    
    htmlContent += `
    <div class="step ${isSalesforceStep ? 'salesforce-step' : ''}">
      <div class="step-header">
        <div class="step-number">${i + 1}</div>
        <h2>${instructionHtml}</h2>
        ${isSalesforceStep ? '<span class="tag salesforce-tag">Salesforce</span>' : ''}
      </div>
      
      <div class="step-metadata">
        <p><strong>Page:</strong> ${step.title || 'Untitled Page'}</p>
        <p><strong>URL:</strong> ${step.url || 'Unknown URL'}</p>
        ${step.timestamp ? `<p><strong>Time:</strong> ${new Date(step.timestamp).toLocaleTimeString()}</p>` : ''}
      </div>
      
      ${await processScreenshot(step.screenshot, compressImages)}
    </div>
  `;
  }

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

/**
 * Process screenshot for HTML export
 * @param {string} screenshot - Screenshot data URL
 * @param {boolean} compress - Whether to compress the image
 * @returns {Promise<string>} HTML image tag or placeholder
 */
async function processScreenshot(screenshot, compress) {
  if (!screenshot) {
    return '<p>[No screenshot available]</p>';
  }
  
  try {
    let imageData = screenshot;
    
    // Compress the image if needed
    if (compress) {
      const originalSize = getBase64Size(screenshot);
      // Only compress if larger than 100KB
      if (originalSize > 102400) {
        try {
          imageData = await compressScreenshot(screenshot, 80);
          const newSize = getBase64Size(imageData);
          log(`Compressed image from ${Math.round(originalSize/1024)}KB to ${Math.round(newSize/1024)}KB`);
        } catch (compressionError) {
          console.error("Error compressing screenshot, using original:", compressionError);
        }
      }
    }
    
    return `<img class="step-screenshot" src="${imageData}" alt="Step screenshot">`;
  } catch (error) {
    console.error("Error processing screenshot:", error);
    return '<p>[Error loading screenshot]</p>';
  }
}

/**
 * Export workflow to HTML file
 * @param {Array} steps - Workflow steps
 * @param {Object} options - Export options
 * @returns {Promise<boolean>} Success status
 */
export async function exportToHtml(steps, options = {}) {
  const defaults = {
    compressImages: true,
    filename: `workflow-${Date.now()}.html`
  };
  
  const settings = { ...defaults, ...options };
  
  try {
    log("Starting HTML export process");
    
    // Generate HTML content
    const htmlContent = await generateHtml(steps, settings.compressImages);
    
    // Create a blob with the HTML content
    const blob = new Blob([htmlContent], { type: 'text/html' });
    
    // Create a download link
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = settings.filename;
    document.body.appendChild(a);
    
    // Trigger download
    a.click();
    
    // Clean up
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    
    log("HTML export completed successfully");
    
    return true;
  } catch (error) {
    console.error("Error exporting HTML:", error);
    return false;
  }
}

/**
 * Clear workflow data from storage
 * @returns {Promise<boolean>} Success status
 */
export async function clearWorkflowData() {
  return new Promise((resolve) => {
    try {
      log("Clearing workflow data after export");
      chrome.runtime.sendMessage({ action: 'clearSteps' }, response => {
        if (response && response.success) {
          log("Workflow data cleared successfully");
          resolve(true);
        } else {
          console.error("Failed to clear workflow data:", response);
          resolve(false);
        }
      });
    } catch (error) {
      console.error("Error clearing workflow data:", error);
      resolve(false);
    }
  });
}

/**
 * Estimate export file size
 * @param {Array} steps - Workflow steps
 * @returns {number} Estimated size in bytes
 */
export function estimateExportSize(steps) {
  let totalSize = 0;
  
  // Base HTML size (template)
  totalSize += 5000; // ~5KB for the HTML template
  
  // Add step content
  for (const step of steps) {
    // Text content
    totalSize += (step.instruction?.length || 0) * 2; // UTF-8 encoding
    totalSize += (step.title?.length || 0) * 2;
    totalSize += (step.url?.length || 0) * 2;
    
    // Screenshot (largest contributor)
    if (step.screenshot) {
      totalSize += getBase64Size(step.screenshot);
    }
  }
  
  return totalSize;
}

/**
 * Format export size for display
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size string
 */
export function formatExportSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} bytes`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}