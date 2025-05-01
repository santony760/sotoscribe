# SotoScribe Installation & Usage Guide

## Installation

SotoScribe is designed for secure, local installation in regulated environments. Follow these steps for proper deployment:

### Local Installation (Recommended for Regulated Environments)

1. **Download the Extension Package**
   - Obtain the `sotoscribe.zip` extension package from authorized channels
   - Verify the package hash against provided checksums 

2. **Install in Microsoft Edge**
   - Open Edge and navigate to `edge://extensions/`
   - Enable "Developer mode" using the toggle in the bottom-left corner
   - Click "Load unpacked" and select the extracted extension folder
   - Verify the extension appears with the SotoScribe icon

3. **Verify Permissions**
   - Click "Details" on the SotoScribe extension
   - Review the permissions to confirm only the following are requested:
     - `activeTab`: To interact with the current tab
     - `scripting`: To inject scripts for capturing user actions
     - `tabs`: To manage the editor tab

4. **Security Verification**
   - Inspect the source code if required by your security protocols
   - Confirm no external API calls or storage mechanisms exist
   - Validate the extension does not use persistent background pages

## Usage Guide

### Creating a Workflow Guide

1. **Start Recording**
   - Click the SotoScribe icon in your browser toolbar
   - Click "Start Recording" in the popup
   - Notice the teal "Recording" badge that appears in the top-right corner of the page

2. **Perform Your Workflow**
   - Navigate through your workflow naturally
   - The extension captures:
     - Clicks (with screenshots)
     - Text entry (automatically masked for privacy)
     - Keyboard shortcuts
     - Page navigations

3. **Stop Recording**
   - Click the SotoScribe icon again
   - Click "Stop Recording"
   - A new tab will open with the editor interface

### Editing Your Workflow

1. **Review Steps**
   - Each workflow step shows:
     - A screenshot with highlighted action
     - An editable instruction text
     - The URL and page title for reference

2. **Modify Steps**
   - Edit the instruction text to clarify steps
   - Reorder steps using the up/down arrows
   - Delete unwanted steps using the "×" button
   - Edit screenshots to blur sensitive information

3. **Image Editing**
   - Click the edit icon on any screenshot
   - Use the blur tool to obscure sensitive data
   - Add numbered annotations for clarity
   - Click "Save Changes" when done

### Exporting Your Documentation

1. **PDF Export**
   - Click "Export PDF" in the top-right corner
   - Review the export preview
   - Click "Download PDF" to generate and save locally
   - All data is cleared from memory after export

2. **SharePoint Embed**
   - Click "Generate SharePoint Embed"
   - Copy the provided HTML code
   - Paste into your SharePoint page editor
   - This code creates a self-contained documentation page

### Privacy and Security Notes

- **No Data Storage**: All captured information exists in memory only
- **Session Expiration**: Data is wiped when you close the editor tab
- **Manual Controls**: You control what is captured and exported
- **Local Processing**: All PDF generation happens locally in your browser

### Troubleshooting

- **Missing Screenshots**: Ensure screen recording permissions are granted
- **Cross-Domain Issues**: Recording stops when navigating to a new domain
- **Editor Not Opening**: Check for popup blockers if the editor fails to appear
- **Export Failures**: Ensure you have sufficient permissions to download files

## Data Practices

SotoScribe adheres to strict privacy practices:

- No telemetry or user tracking
- No cloud uploads or sync
- No persistent storage
- No external API calls

All processing occurs locally within your browser, making it suitable for environments with strict data handling requirements.