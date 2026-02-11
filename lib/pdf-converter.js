import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'materials');

// Ensure the uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/**
 * Convert a PDF file to PNG images at 300 DPI
 * @param {string} pdfPath - Path to the uploaded PDF file
 * @param {number} materialId - DB material ID (used as folder name)
 * @param {function(number, number)} [onProgress] - Callback for progress (current, total)
 * @returns {Promise<number>} - Number of pages converted
 */
export async function convertPdfToImages(pdfPath, materialId, onProgress) {
    // Lazy load mupdf...
    let mupdf;
    try {
        mupdf = await import('mupdf');
    } catch (e) {
        // Fallback for some environments where dynamic import might behave differently
        console.error('Failed to load mupdf dynamically', e);
        throw e;
    }

    const outputDir = path.join(UPLOADS_DIR, String(materialId));
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const pdfData = fs.readFileSync(pdfPath);
    const doc = mupdf.Document.openDocument(pdfData, 'application/pdf');
    const pageCount = doc.countPages();
    const scale = 200 / 72; // Reduced to 200 DPI to save memory

    try {
        for (let i = 0; i < pageCount; i++) {
            // Report progress at start of page processing
            if (onProgress) onProgress(i, pageCount);

            let page = null;
            let pixmap = null;
            try {
                page = doc.loadPage(i);
                pixmap = page.toPixmap(
                    mupdf.Matrix.scale(scale, scale),
                    mupdf.ColorSpace.DeviceRGB,
                    false, // no alpha
                    true   // include annotations
                );
                // asPNG returns a Uint8Array
                const pngData = pixmap.asPNG();
                const pageName = `page-${String(i + 1).padStart(3, '0')}.png`;
                fs.writeFileSync(path.join(outputDir, pageName), pngData);
            } finally {
                // Manually destroy to free WASM memory
                if (pixmap && typeof pixmap.destroy === 'function') pixmap.destroy();
                if (page && typeof page.destroy === 'function') page.destroy();
            }
        }
        // Report final completion
        if (onProgress) onProgress(pageCount, pageCount);

    } finally {
        if (doc && typeof doc.destroy === 'function') doc.destroy();
    }

    return pageCount;
}

/**
 * Get a page image path for a material
 * @param {number} materialId
 * @param {number} pageNum (1-indexed)
 * @returns {string|null} - Path to the image file, or null if not found
 */
export function getPageImagePath(materialId, pageNum) {
    const pageName = `page-${String(pageNum).padStart(3, '0')}.png`;
    const imagePath = path.join(UPLOADS_DIR, String(materialId), pageName);
    return fs.existsSync(imagePath) ? imagePath : null;
}

/**
 * Delete all converted images for a material
 * @param {number} materialId
 */
export function deleteMaterialImages(materialId) {
    const dir = path.join(UPLOADS_DIR, String(materialId));
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
