// Blueprint Converter - Client-Side App Controller

// Initialize PDF.js Worker using blob URL to avoid CORS restriction issues
const pdfWorkerUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
const workerCode = `importScripts("${pdfWorkerUrl}");`;
const workerBlob = new Blob([workerCode], { type: 'application/javascript' });
pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);

// App State
let fileQueue = [];
let isConverting = false;

// DOM Elements
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const browseBtn = document.getElementById('browse-btn');
const queuePanel = document.getElementById('queue-panel');
const queueCountEl = document.getElementById('queue-count');
const queueSizeEl = document.getElementById('queue-size');
const fileQueueEl = document.getElementById('file-queue');
const convertAllBtn = document.getElementById('convert-all-btn');
const downloadZipBtn = document.getElementById('download-zip-btn');
const clearQueueBtn = document.getElementById('clear-queue-btn');
const globalFormatSelect = document.getElementById('global-format-select');

// Initialize Lucide Icons
lucide.createIcons();

// Event Listeners
browseBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', handleFileSelect);

// Global format change listener
if (globalFormatSelect) {
  globalFormatSelect.addEventListener('change', (e) => {
    const selectedFormat = e.target.value;
    if (!selectedFormat) return;
    
    fileQueue.forEach(item => {
      // PDF input files cannot target PDF output
      if (selectedFormat === 'pdf' && item.type === 'pdf') {
        return;
      }
      item.targetFormat = selectedFormat;
    });
    
    // Re-render list and recalculate metrics
    renderQueue();
    updateQueueStats();
  });
}

const mergeCheckbox = document.getElementById('merge-pdf-checkbox');
if (mergeCheckbox) {
  mergeCheckbox.addEventListener('change', updateDownloadButtonState);
}

// Drag & Drop Handlers
['dragenter', 'dragover'].forEach(eventName => {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  }, false);
});

['dragleave', 'drop'].forEach(eventName => {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
  }, false);
});

dropzone.addEventListener('drop', (e) => {
  const dt = e.dataTransfer;
  const files = dt.files;
  if (files.length > 0) {
    addFilesToQueue(files);
  }
});

// Control Actions
clearQueueBtn.addEventListener('click', clearQueue);
convertAllBtn.addEventListener('click', convertAllFiles);
downloadZipBtn.addEventListener('click', downloadAllAsZip);

// Close tools dropdown on click outside
window.addEventListener('click', (e) => {
  const dropdown = document.querySelector('.tools-dropdown');
  if (dropdown && dropdown.hasAttribute('open') && !dropdown.contains(e.target)) {
    dropdown.removeAttribute('open');
  }
});

// Share functionality
const shareBtn = document.getElementById('share-btn');
if (shareBtn) {
  shareBtn.addEventListener('click', async () => {
    const shareData = {
      title: 'Blueprint Converter - 100% Local File & Image Converter',
      text: 'Convert PDF to JPG, HEIC to JPG, WebP, PNG, and images entirely in your browser. 100% private, secure, and offline.',
      url: window.location.origin
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        if (err.name !== 'AbortError') console.error('Error sharing:', err);
      }
    } else {
      // Fallback copy to clipboard
      try {
        await navigator.clipboard.writeText(shareData.url);
        const shareTextSpan = shareBtn.querySelector('span');
        const originalText = shareTextSpan.textContent;
        shareTextSpan.textContent = 'Link Copied!';
        shareBtn.style.borderColor = '#10b981'; // Green success border
        setTimeout(() => {
          shareTextSpan.textContent = originalText;
          shareBtn.style.borderColor = '';
        }, 2000);
      } catch (err) {
        console.error('Failed to copy link:', err);
      }
    }
  });
}

// File selection handler
function handleFileSelect(e) {
  const files = e.target.files;
  if (files.length > 0) {
    addFilesToQueue(files);
  }
}

// Add files to queue and generate details
async function addFilesToQueue(files) {
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const extension = file.name.split('.').pop().toLowerCase();
    
    // Skip duplicate files
    if (fileQueue.some(item => item.file.name === file.name && item.file.size === file.size)) {
      continue;
    }

    const fileId = 'file_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const type = extension === 'pdf' ? 'pdf' : (['heic', 'heif'].includes(extension) ? 'heic' : 'image');
    
    const queueItem = {
      id: fileId,
      file: file,
      name: file.name,
      size: file.size,
      extension: extension,
      type: type,
      thumbnail: null,
      targetFormat: 'jpg', // Default target
      status: 'ready',
      progress: 0,
      error: null,
      pageCount: 0,
      convertedBlobs: [], // Holds array of {name: string, blob: Blob}
      settings: {
        quality: 80,
        scale: 1,
        dpi: 150,
        pageRange: ''
      }
    };

    fileQueue.push(queueItem);
    updateQueueStats();
    renderQueue();

    // Generate thumbnails in background
    generateThumbnail(queueItem);
  }
  
  // Reset input field
  fileInput.value = '';
}

// Generate image/pdf thumbnails
async function generateThumbnail(item) {
  try {
    if (item.type === 'pdf') {
      const fileReader = new FileReader();
      fileReader.onload = async function() {
        const typedarray = new Uint8Array(this.result);
        try {
          const pdf = await pdfjsLib.getDocument(typedarray).promise;
          item.pageCount = pdf.numPages;
          
          // Render page 1
          const page = await pdf.getPage(1);
          const viewport = page.getViewport({ scale: 0.2 });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          
          await page.render({
            canvasContext: context,
            viewport: viewport
          }).promise;
          
          item.thumbnail = canvas.toDataURL();
          updateCardThumbnail(item.id, item.thumbnail, item.pageCount);
        } catch (err) {
          console.error("PDF thumbnail generation failed:", err);
        }
      };
      fileReader.readAsArrayBuffer(item.file);
    } else if (item.type === 'heic') {
      // For HEIC, we use a placeholder icon on loading to keep load instantaneous,
      // as full resolution HEIC conversion takes time.
      updateCardThumbnail(item.id, null, 0, 'image');
    } else {
      // Standard images (JPG, PNG, WEBP, SVG)
      const reader = new FileReader();
      reader.onload = function(e) {
        item.thumbnail = e.target.result;
        updateCardThumbnail(item.id, item.thumbnail);
      };
      reader.readAsDataURL(item.file);
    }
  } catch (error) {
    console.error("Thumbnail generation error:", error);
  }
}

// Update card thumbnail in the DOM
function updateCardThumbnail(id, dataUrl, pageCount = 0, iconType = null) {
  const card = document.getElementById(id);
  if (!card) return;
  const thumbContainer = card.querySelector('.file-thumbnail');
  
  if (dataUrl) {
    thumbContainer.innerHTML = `<img src="${dataUrl}" alt="Preview">`;
    if (pageCount > 1) {
      thumbContainer.innerHTML += `<span class="page-badge">${pageCount} Pages</span>`;
    }
  } else if (iconType === 'image') {
    thumbContainer.innerHTML = `<div class="icon-placeholder"><i data-lucide="image"></i></div>`;
    lucide.createIcons({ attrs: { class: 'icon-placeholder-svg' } });
  }
}

// Update global queue metrics
function updateQueueStats() {
  if (fileQueue.length > 0) {
    queuePanel.classList.remove('hidden');
    queueCountEl.textContent = fileQueue.length;
    
    const totalBytes = fileQueue.reduce((acc, item) => acc + item.size, 0);
    queueSizeEl.textContent = formatBytes(totalBytes);
  } else {
    queuePanel.classList.add('hidden');
  }
  
  // Show/Hide merge option if 2 or more images are set to PDF
  const imageToPdfItems = fileQueue.filter(item => item.type !== 'pdf' && item.targetFormat === 'pdf');
  const queueOptions = document.getElementById('queue-options');
  if (imageToPdfItems.length >= 2) {
    queueOptions.classList.remove('hidden');
  } else {
    queueOptions.classList.add('hidden');
    const mergeCheckbox = document.getElementById('merge-pdf-checkbox');
    if (mergeCheckbox) mergeCheckbox.checked = false;
  }
  
  updateDownloadButtonState();
  syncGlobalFormatSelect();
  
  // Enable ZIP download only if there are successful conversions
  const hasSuccessful = fileQueue.some(item => item.status === 'success');
  downloadZipBtn.disabled = !hasSuccessful;
}

// Update text of main download action button dynamically
function updateDownloadButtonState() {
  const mergeCheckbox = document.getElementById('merge-pdf-checkbox');
  const shouldMerge = mergeCheckbox && mergeCheckbox.checked;
  
  if (shouldMerge) {
    downloadZipBtn.innerHTML = `<i data-lucide="file-text"></i> Download Combined PDF`;
  } else {
    downloadZipBtn.innerHTML = `<i data-lucide="download-cloud"></i> Download ZIP`;
  }
  lucide.createIcons();
}

// Synchronize global format select display value based on file queue states
function syncGlobalFormatSelect() {
  if (!globalFormatSelect || fileQueue.length === 0) return;
  
  const firstFormat = fileQueue[0].targetFormat;
  const allSame = fileQueue.every(item => {
    // If a PDF file is present, it might be restricted, but check if all editable matches
    if (item.type === 'pdf' && firstFormat === 'pdf') return false;
    return item.targetFormat === firstFormat;
  });
  
  if (allSame) {
    globalFormatSelect.value = firstFormat;
  } else {
    globalFormatSelect.value = ''; // Sets back to placeholder "Format..."
  }
}

// Format bytes into human readable string
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Render queue container
function renderQueue() {
  // Clear list
  fileQueueEl.innerHTML = '';
  
  fileQueue.forEach(item => {
    const card = document.createElement('div');
    card.className = `file-card`;
    card.id = item.id;
    
    // Build specific settings panel based on format
    let settingsHtml = '';
    
    if (item.type === 'pdf') {
      settingsHtml = `
        <div class="setting-group">
          <label>DPI / Resolution</label>
          <select class="select-control dpi-select">
            <option value="72" ${item.settings.dpi === 72 ? 'selected' : ''}>72 DPI (Web)</option>
            <option value="150" ${item.settings.dpi === 150 ? 'selected' : ''}>150 DPI (Medium)</option>
            <option value="300" ${item.settings.dpi === 300 ? 'selected' : ''}>300 DPI (High Print)</option>
          </select>
        </div>
        <div class="setting-group">
          <label>Page Range (e.g. 1-3, 5)</label>
          <input type="text" class="text-input page-range-input" placeholder="All Pages" value="${item.settings.pageRange}">
        </div>
      `;
    } else {
      // Image/HEIC settings
      settingsHtml = `
        <div class="setting-group">
          <label>Quality</label>
          <div class="slider-wrapper">
            <input type="range" class="range-slider quality-slider" min="10" max="100" value="${item.settings.quality}">
            <span class="slider-val">${item.settings.quality}%</span>
          </div>
        </div>
        <div class="setting-group">
          <label>Scale / Size</label>
          <select class="select-control scale-select">
            <option value="1" ${item.settings.scale === 1 ? 'selected' : ''}>Original Size (1.0x)</option>
            <option value="0.75" ${item.settings.scale === 0.75 ? 'selected' : ''}>Medium (0.75x)</option>
            <option value="0.5" ${item.settings.scale === 0.5 ? 'selected' : ''}>Small (0.5x)</option>
            <option value="2" ${item.settings.scale === 2 ? 'selected' : ''}>Double (2.0x)</option>
          </select>
        </div>
      `;
    }

    let formatOptionsHtml = `
      <option value="jpg" ${item.targetFormat === 'jpg' ? 'selected' : ''}>JPEG (.jpg)</option>
      <option value="png" ${item.targetFormat === 'png' ? 'selected' : ''}>PNG (.png)</option>
      <option value="webp" ${item.targetFormat === 'webp' ? 'selected' : ''}>WebP (.webp)</option>
    `;
    if (item.type !== 'pdf') {
      formatOptionsHtml += `
        <option value="pdf" ${item.targetFormat === 'pdf' ? 'selected' : ''}>PDF (.pdf)</option>
      `;
    }

    card.innerHTML = `
      <div class="file-thumbnail">
        <div class="icon-placeholder"><i data-lucide="${item.type === 'pdf' ? 'file-text' : 'image'}"></i></div>
      </div>
      <div class="file-details">
        <div class="file-name" title="${item.name}">${item.name}</div>
        <div class="file-meta">
          <span class="type-badge">${item.extension}</span>
          <span>${formatBytes(item.size)}</span>
        </div>
      </div>
      <div class="file-settings">
        <div class="setting-group">
          <label>Convert To</label>
          <select class="select-control format-select">
            ${formatOptionsHtml}
          </select>
        </div>
        ${settingsHtml}
      </div>
      <div class="file-actions-status">
        <span class="status-pill ${item.status}">
          ${getStatusIcon(item.status)}
          <span class="status-text">${getStatusText(item.status, item.progress)}</span>
        </span>
        ${item.status === 'success' ? `
          <button class="btn btn-primary btn-outline download-item-btn" title="Download output">
            <i data-lucide="download"></i>
          </button>
        ` : ''}
        <button class="remove-btn" title="Remove file">
          <i data-lucide="x"></i>
        </button>
      </div>
      <div class="card-progress-bar ${item.status}" style="width: ${item.progress}%"></div>
    `;
    
    fileQueueEl.appendChild(card);
    
    // If thumbnail was loaded previously, render it
    if (item.thumbnail) {
      updateCardThumbnail(item.id, item.thumbnail, item.pageCount);
    } else if (item.type === 'heic') {
      updateCardThumbnail(item.id, null, 0, 'image');
    }

    // Attach local Card listeners
    attachCardListeners(card, item);
  });
  
  lucide.createIcons();
}

// Get status text
function getStatusText(status, progress) {
  switch (status) {
    case 'ready': return 'Ready';
    case 'processing': return `Converting (${progress}%)`;
    case 'success': return 'Converted';
    case 'danger':
    case 'error': return 'Failed';
    default: return 'Ready';
  }
}

// Get icon markup for status pills
function getStatusIcon(status) {
  switch (status) {
    case 'ready': return '<i data-lucide="clock"></i>';
    case 'processing': return '<i data-lucide="loader" class="animate-spin-slow"></i>';
    case 'success': return '<i data-lucide="check-circle-2"></i>';
    case 'danger':
    case 'error': return '<i data-lucide="alert-circle"></i>';
    default: return '<i data-lucide="clock"></i>';
  }
}

// Setup input listeners on rendered card
function attachCardListeners(cardEl, item) {
  // Format Selector
  const formatSelect = cardEl.querySelector('.format-select');
  formatSelect.addEventListener('change', (e) => {
    item.targetFormat = e.target.value;
    updateQueueStats();
  });

  // Remove Button
  const removeBtn = cardEl.querySelector('.remove-btn');
  removeBtn.addEventListener('click', () => {
    if (isConverting) return;
    fileQueue = fileQueue.filter(q => q.id !== item.id);
    updateQueueStats();
    renderQueue();
  });

  // Settings specific listeners
  if (item.type === 'pdf') {
    const dpiSelect = cardEl.querySelector('.dpi-select');
    dpiSelect.addEventListener('change', (e) => {
      item.settings.dpi = parseInt(e.target.value);
    });

    const rangeInput = cardEl.querySelector('.page-range-input');
    rangeInput.addEventListener('input', (e) => {
      item.settings.pageRange = e.target.value;
    });
  } else {
    // Quality slider
    const qualitySlider = cardEl.querySelector('.quality-slider');
    const qualityVal = cardEl.querySelector('.slider-val');
    qualitySlider.addEventListener('input', (e) => {
      item.settings.quality = parseInt(e.target.value);
      qualityVal.textContent = item.settings.quality + '%';
    });

    // Scale selector
    const scaleSelect = cardEl.querySelector('.scale-select');
    scaleSelect.addEventListener('change', (e) => {
      item.settings.scale = parseFloat(e.target.value);
    });
  }

  // Download Individual button (if successful)
  const downloadBtn = cardEl.querySelector('.download-item-btn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      downloadIndividualFile(item);
    });
  }
}

// Clear all queue items
function clearQueue() {
  if (isConverting) return;
  fileQueue = [];
  updateQueueStats();
  renderQueue();
}

// Download individual converted items
function downloadIndividualFile(item) {
  if (item.convertedBlobs.length === 0) return;
  
  if (item.convertedBlobs.length === 1) {
    const fileObj = item.convertedBlobs[0];
    triggerDownload(fileObj.blob, fileObj.name);
  } else {
    // If multi-page PDF, zip this single item
    const zip = new JSZip();
    item.convertedBlobs.forEach(fileObj => {
      zip.file(fileObj.name, fileObj.blob);
    });
    
    zip.generateAsync({ type: 'blob' }).then((content) => {
      const baseName = item.name.substring(0, item.name.lastIndexOf('.')) || item.name;
      triggerDownload(content, `${baseName}_converted.zip`);
    });
  }
}

// Download all successfully converted items as one ZIP file
// Download all successfully converted items as one ZIP file (or combined PDF if selected)
function downloadAllAsZip() {
  const mergeCheckbox = document.getElementById('merge-pdf-checkbox');
  const shouldMerge = mergeCheckbox && mergeCheckbox.checked;
  
  if (shouldMerge) {
    const mergeItems = fileQueue.filter(item => item.type !== 'pdf' && item.targetFormat === 'pdf');
    if (mergeItems.length > 0) {
      const unconverted = mergeItems.some(item => item.status !== 'success');
      if (unconverted) {
        alert("Please click 'Convert All' first to process the files.");
        return;
      }
      
      // If combined PDF was compiled during convertAllFiles, download it directly
      const firstItem = mergeItems[0];
      if (firstItem.convertedBlobs.length > 0 && firstItem.convertedBlobs[0].name.startsWith('blueprint_combined_')) {
        triggerDownload(firstItem.convertedBlobs[0].blob, firstItem.convertedBlobs[0].name);
        return;
      }
      
      // If converted individually and then checked the box, compile on-the-fly!
      const originalText = downloadZipBtn.innerHTML;
      downloadZipBtn.disabled = true;
      downloadZipBtn.innerHTML = `<i data-lucide="loader" class="animate-spin-slow"></i> Compiling PDF...`;
      lucide.createIcons();
      
      processMergedPdf(mergeItems).then(() => {
        downloadZipBtn.disabled = false;
        downloadZipBtn.innerHTML = originalText;
        lucide.createIcons();
      }).catch(err => {
        downloadZipBtn.disabled = false;
        downloadZipBtn.innerHTML = originalText;
        lucide.createIcons();
        alert("Failed to compile combined PDF: " + err.message);
      });
      return;
    }
  }

  const successfulItems = fileQueue.filter(item => item.status === 'success');
  if (successfulItems.length === 0) return;
  
  const zip = new JSZip();
  
  successfulItems.forEach(item => {
    item.convertedBlobs.forEach(fileObj => {
      // Add files to zip
      zip.file(fileObj.name, fileObj.blob);
    });
  });
  
  zip.generateAsync({ type: 'blob' }).then((content) => {
    triggerDownload(content, `blueprint_batch_${Date.now()}.zip`);
  });
}

// Trigger browser download dialog
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Convert all files sequentially
async function convertAllFiles() {
  if (isConverting || fileQueue.length === 0) return;
  
  isConverting = true;
  toggleControls(true);
  
  // Check if we should combine image-to-PDF conversions
  const mergeCheckbox = document.getElementById('merge-pdf-checkbox');
  const shouldMerge = mergeCheckbox && mergeCheckbox.checked;
  const mergeItems = shouldMerge 
    ? fileQueue.filter(item => item.status !== 'success' && item.type !== 'pdf' && item.targetFormat === 'pdf')
    : [];
    
  if (shouldMerge && mergeItems.length > 0) {
    try {
      await processMergedPdf(mergeItems);
    } catch (err) {
      console.error("Batch PDF compilation failed:", err);
      mergeItems.forEach(item => {
        item.status = 'danger';
        item.progress = 100;
        item.error = err.message;
        updateCardStatusUI(item);
      });
    }
  }
  
  for (let i = 0; i < fileQueue.length; i++) {
    const item = fileQueue[i];
    
    // Skip already converted items unless re-running (including merged items)
    if (item.status === 'success') continue;
    
    item.status = 'processing';
    item.progress = 10;
    updateCardStatusUI(item);
    
    try {
      if (item.type === 'pdf') {
        await processPdf(item);
      } else if (item.type === 'heic') {
        await processHeic(item);
      } else {
        await processStandardImage(item);
      }
      
      item.status = 'success';
      item.progress = 100;
    } catch (err) {
      console.error(`Conversion failed for ${item.name}:`, err);
      item.status = 'danger';
      item.progress = 100;
      item.error = err.message;
    }
    
    updateCardStatusUI(item);
  }
  
  isConverting = false;
  toggleControls(false);
  updateQueueStats();
  
  // Re-attach download item listeners because we update items in DOM
  renderQueue();
}

// Toggle control states during conversion
function toggleControls(disable) {
  convertAllBtn.disabled = disable;
  clearQueueBtn.disabled = disable;
  fileInput.disabled = disable;
  browseBtn.disabled = disable;
  
  if (globalFormatSelect) {
    globalFormatSelect.disabled = disable;
  }
  
  document.querySelectorAll('.select-control, .range-slider, .text-input, .remove-btn').forEach(control => {
    control.disabled = disable;
  });
}

// Update card state in DOM without full rendering loop to avoid flashing
function updateCardStatusUI(item) {
  const card = document.getElementById(item.id);
  if (!card) return;
  
  // Update progress bar width
  const progressBar = card.querySelector('.card-progress-bar');
  progressBar.style.width = item.progress + '%';
  progressBar.className = `card-progress-bar ${item.status}`;
  
  // Update status badge
  const statusPill = card.querySelector('.status-pill');
  statusPill.className = `status-pill ${item.status}`;
  statusPill.innerHTML = `
    ${getStatusIcon(item.status)}
    <span class="status-text">${getStatusText(item.status, item.progress)}</span>
  `;
}

// Convert JPEG/PNG/WebP/SVG/BMP/GIF using canvas
function processStandardImage(item) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = function(e) {
      const img = new Image();
      
      img.onload = function() {
        try {
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          
          // Apply scale settings
          const width = img.width * item.settings.scale;
          const height = img.height * item.settings.scale;
          
          canvas.width = width;
          canvas.height = height;
          
          // Draw standard image
          context.drawImage(img, 0, 0, width, height);
          
          // Output type format mapping
          const mimeType = getMimeType(item.targetFormat);
          const quality = item.settings.quality / 100;
          
          if (item.targetFormat === 'pdf') {
            const imgDataUrl = canvas.toDataURL('image/jpeg', 0.9);
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({
              orientation: width > height ? 'l' : 'p',
              unit: 'px',
              format: [width, height]
            });
            doc.addImage(imgDataUrl, 'JPEG', 0, 0, width, height);
            const pdfBlob = doc.output('blob');
            const baseName = item.name.substring(0, item.name.lastIndexOf('.')) || item.name;
            item.convertedBlobs = [{
              name: `${baseName}_converted.pdf`,
              blob: pdfBlob
            }];
            item.progress = 100;
            resolve();
            return;
          }
          
          canvas.toBlob((blob) => {
            if (blob) {
              const baseName = item.name.substring(0, item.name.lastIndexOf('.')) || item.name;
              item.convertedBlobs = [{
                name: `${baseName}_converted.${item.targetFormat}`,
                blob: blob
              }];
              item.progress = 100;
              resolve();
            } else {
              reject(new Error("Canvas conversion to blob returned empty data."));
            }
          }, mimeType, quality);
        } catch (err) {
          reject(err);
        }
      };
      
      img.onerror = function() {
        reject(new Error("Failed to load image file into browser decoder."));
      };
      
      img.src = e.target.result;
    };
    
    reader.onerror = function() {
      reject(new Error("File reader failed to load raw file buffer."));
    };
    
    reader.readAsDataURL(item.file);
  });
}

// Convert HEIC file using heic2any
async function processHeic(item) {
  item.progress = 30;
  updateCardStatusUI(item);
  
  // HEIC is always converted to JPEG first
  const mimeType = item.targetFormat === 'pdf' ? 'image/jpeg' : getMimeType(item.targetFormat);
  const conversionResult = await heic2any({
    blob: item.file,
    toType: mimeType,
    quality: item.settings.quality / 100
  });
  
  item.progress = 70;
  updateCardStatusUI(item);
  
  const blobResult = Array.isArray(conversionResult) ? conversionResult[0] : conversionResult;
  const baseName = item.name.substring(0, item.name.lastIndexOf('.')) || item.name;
  
  if (item.targetFormat === 'pdf') {
    // If compiling to PDF, we need to read the dimensions of the converted JPG
    await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = function() {
        try {
          const width = img.width * item.settings.scale;
          const height = img.height * item.settings.scale;
          
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          context.drawImage(img, 0, 0, width, height);
          
          const imgDataUrl = canvas.toDataURL('image/jpeg', 0.9);
          const { jsPDF } = window.jspdf;
          const doc = new jsPDF({
            orientation: width > height ? 'l' : 'p',
            unit: 'px',
            format: [width, height]
          });
          doc.addImage(imgDataUrl, 'JPEG', 0, 0, width, height);
          const pdfBlob = doc.output('blob');
          
          item.convertedBlobs = [{
            name: `${baseName}_converted.pdf`,
            blob: pdfBlob
          }];
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error("Failed to load HEIC-to-JPG conversion into image element."));
      img.src = URL.createObjectURL(blobResult);
    });
  } else {
    item.convertedBlobs = [{
      name: `${baseName}_converted.${item.targetFormat}`,
      blob: blobResult
    }];
  }
}

// Convert PDF pages to JPG/PNG/WebP using PDF.js
function processPdf(item) {
  return new Promise((resolve, reject) => {
    const fileReader = new FileReader();
    
    fileReader.onload = async function() {
      const typedarray = new Uint8Array(this.result);
      
      try {
        const pdf = await pdfjsLib.getDocument(typedarray).promise;
        const totalPages = pdf.numPages;
        const pagesToExtract = parsePageRange(item.settings.pageRange, totalPages);
        
        item.convertedBlobs = [];
        const baseName = item.name.substring(0, item.name.lastIndexOf('.')) || item.name;
        
        for (let idx = 0; idx < pagesToExtract.length; idx++) {
          const pageNum = pagesToExtract[idx];
          
          item.progress = Math.round(((idx) / pagesToExtract.length) * 80) + 10;
          updateCardStatusUI(item);
          
          const page = await pdf.getPage(pageNum);
          
          // Calculate scale coordinate mapping based on DPI
          // 72 standard points per inch is base viewport scaling in PDFJS.
          const scale = item.settings.dpi / 72;
          const viewport = page.getViewport({ scale: scale });
          
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          
          await page.render({
            canvasContext: context,
            viewport: viewport
          }).promise;
          
          const mimeType = getMimeType(item.targetFormat);
          const quality = 0.85; // Fixed high quality for PDF renders to keep pages readable
          
          await new Promise((resBlob) => {
            canvas.toBlob((blob) => {
              if (blob) {
                item.convertedBlobs.push({
                  name: `${baseName}_page_${pageNum}.${item.targetFormat}`,
                  blob: blob
                });
              }
              resBlob();
            }, mimeType, quality);
          });
        }
        
        resolve();
      } catch (err) {
        reject(err);
      }
    };
    
    fileReader.onerror = () => reject(new Error("Failed to read PDF document binary buffer."));
    fileReader.readAsArrayBuffer(item.file);
  });
}

// Parse page range inputs (e.g. 1-3, 5)
function parsePageRange(rangeStr, totalPages) {
  if (!rangeStr || rangeStr.trim() === '') {
    // Return all pages
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  
  const pages = new Set();
  const parts = rangeStr.split(',');
  
  for (let part of parts) {
    part = part.trim();
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-');
      const start = parseInt(startStr);
      const end = parseInt(endStr);
      if (!isNaN(start) && !isNaN(end) && start > 0 && end <= totalPages) {
        const min = Math.min(start, end);
        const max = Math.max(start, end);
        for (let i = min; i <= max; i++) {
          pages.add(i);
        }
      }
    } else {
      const val = parseInt(part);
      if (!isNaN(val) && val > 0 && val <= totalPages) {
        pages.add(val);
      }
    }
  }
  
  // Sort and filter pages array
  const sortedPages = Array.from(pages).sort((a, b) => a - b);
  return sortedPages.length > 0 ? sortedPages : Array.from({ length: totalPages }, (_, i) => i + 1);
}

// Map short type to standard mime types
function getMimeType(format) {
  switch (format) {
    case 'jpg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    default: return 'image/jpeg';
  }
}

// Combine multiple images into a single multi-page PDF document client-side
function processMergedPdf(items) {
  return new Promise(async (resolve, reject) => {
    try {
      const { jsPDF } = window.jspdf;
      let pdfDoc = null;
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        item.status = 'processing';
        item.progress = 20;
        updateCardStatusUI(item);
        
        let canvas = null;
        
        if (item.type === 'heic') {
          // Convert HEIC to JPEG blob first
          const mimeType = 'image/jpeg';
          const conversionResult = await heic2any({
            blob: item.file,
            toType: mimeType,
            quality: item.settings.quality / 100
          });
          const blobResult = Array.isArray(conversionResult) ? conversionResult[0] : conversionResult;
          
          canvas = await new Promise((resCanvas, rejCanvas) => {
            const img = new Image();
            img.onload = function() {
              const w = img.width * item.settings.scale;
              const h = img.height * item.settings.scale;
              const cv = document.createElement('canvas');
              cv.width = w;
              cv.height = h;
              const ctx = cv.getContext('2d');
              ctx.drawImage(img, 0, 0, w, h);
              resCanvas(cv);
            };
            img.onerror = () => rejCanvas(new Error("Failed to load HEIC output image."));
            img.src = URL.createObjectURL(blobResult);
          });
        } else {
          // Standard image (JPG, PNG, WebP, SVG)
          canvas = await new Promise((resCanvas, rejCanvas) => {
            const reader = new FileReader();
            reader.onload = function(e) {
              const img = new Image();
              img.onload = function() {
                const w = img.width * item.settings.scale;
                const h = img.height * item.settings.scale;
                const cv = document.createElement('canvas');
                cv.width = w;
                cv.height = h;
                const ctx = cv.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                resCanvas(cv);
              };
              img.onerror = () => rejCanvas(new Error("Failed to load image."));
              img.src = e.target.result;
            };
            reader.onerror = () => rejCanvas(new Error("Failed to read image file."));
            reader.readAsDataURL(item.file);
          });
        }
        
        item.progress = 60;
        updateCardStatusUI(item);
        
        const width = canvas.width;
        const height = canvas.height;
        const imgDataUrl = canvas.toDataURL('image/jpeg', 0.9);
        
        const orientation = width > height ? 'l' : 'p';
        if (!pdfDoc) {
          pdfDoc = new jsPDF({
            orientation: orientation,
            unit: 'px',
            format: [width, height]
          });
        } else {
          pdfDoc.addPage([width, height], orientation);
        }
        
        pdfDoc.addImage(imgDataUrl, 'JPEG', 0, 0, width, height);
        
        item.progress = 90;
        updateCardStatusUI(item);
      }
      
      if (pdfDoc) {
        const combinedBlob = pdfDoc.output('blob');
        const timestamp = Date.now();
        const mergedFileName = `blueprint_combined_${timestamp}.pdf`;
        
        // Save combined PDF blob on all merged items
        items.forEach(item => {
          item.convertedBlobs = [{
            name: mergedFileName,
            blob: combinedBlob
          }];
          item.status = 'success';
          item.progress = 100;
          updateCardStatusUI(item);
        });
        
        // Auto trigger download of the merged PDF
        triggerDownload(combinedBlob, mergedFileName);
      }
      
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}
