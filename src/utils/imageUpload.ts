import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';

export interface ImageUploadOptions {
  /** Target category ('posts', 'gallery', 'avatars', 'featured', 'uploads') */
  folder?: string;
  /** Maximum pixel dimension (width or height) */
  maxDimension?: number;
  /** Initial image compression quality (0.0 to 1.0) */
  quality?: number;
  /** Maximum binary size in bytes so Firestore documents remain safely under 1MB */
  maxBytes?: number;
  /** Optional progress callback (0 - 100) */
  onProgress?: (progressPercent: number) => void;
}

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'bmp',
  'avif',
  'svg',
  'heic',
  'heif',
  'jfif',
  'tiff',
  'tif',
]);

/**
 * Checks if a File is an image by MIME type or file extension.
 */
export function isImageFile(file: File): boolean {
  if (file.type && file.type.startsWith('image/')) return true;
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTENSIONS.has(ext);
}

// Cache whether Firebase Storage bucket is unavailable (e.g. 404 Not Found)
// so subsequent uploads in the same session do not wait for a failed network probe.
let storageBucketUnavailable = false;

function getDefaultLimits(folder: string): { maxDimension: number; quality: number; maxBytes: number } {
  switch (folder) {
    case 'avatars':
      return { maxDimension: 1024, quality: 0.88, maxBytes: 200 * 1024 };
    case 'featured':
      return { maxDimension: 1200, quality: 0.88, maxBytes: 260 * 1024 };
    case 'posts':
      return { maxDimension: 1920, quality: 0.86, maxBytes: 420 * 1024 };
    case 'gallery':
    default:
      return { maxDimension: 2048, quality: 0.88, maxBytes: 520 * 1024 };
  }
}

/**
 * Loads an image File into a drawable Image / ImageBitmap using an object URL
 * (avoids loading huge multi-megabyte base64 strings into JS memory).
 */
async function loadDrawableImage(
  file: File
): Promise<{ source: CanvasImageSource; width: number; height: number; cleanup: () => void }> {
  // Prefer createImageBitmap when available (handles EXIF orientation in modern browsers)
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => {
          try {
            bitmap.close();
          } catch {
            // ignore
          }
        },
      };
    } catch {
      // Fallback to HTMLImageElement + object URL below
    }
  }

  const objectUrl = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        source: img,
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        cleanup: () => URL.revokeObjectURL(objectUrl),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not decode image file. Please try JPEG, PNG, or WebP.'));
    };
    img.src = objectUrl;
  });
}

function canvasToBlobAsync(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to encode image'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read optimized image'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Draws a source image scaled to fit within maxDim using high-quality smoothing
 * (and progressive step-down for very large images).
 */
function renderScaledCanvas(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  maxDim: number
): HTMLCanvasElement {
  let targetW = srcWidth;
  let targetH = srcHeight;

  if (targetW > maxDim || targetH > maxDim) {
    if (targetW > targetH) {
      targetH = Math.max(1, Math.round((targetH * maxDim) / targetW));
      targetW = maxDim;
    } else {
      targetW = Math.max(1, Math.round((targetW * maxDim) / targetH));
      targetH = maxDim;
    }
  }

  // Progressive 2x downscale if shrinking a huge image (> 2.5x scale ratio) for crisper edges & lower memory
  let currentSource: CanvasImageSource = source;
  let curW = srcWidth;
  let curH = srcHeight;
  const intermediateCanvases: HTMLCanvasElement[] = [];

  while (curW > targetW * 2.5 && curH > targetH * 2.5 && curW > 2048) {
    const nextW = Math.max(targetW, Math.round(curW / 2));
    const nextH = Math.max(targetH, Math.round(curH / 2));
    const stepCanvas = document.createElement('canvas');
    stepCanvas.width = nextW;
    stepCanvas.height = nextH;
    const stepCtx = stepCanvas.getContext('2d');
    if (!stepCtx) break;
    stepCtx.imageSmoothingEnabled = true;
    stepCtx.imageSmoothingQuality = 'high';
    stepCtx.drawImage(currentSource, 0, 0, nextW, nextH);
    intermediateCanvases.push(stepCanvas);
    currentSource = stepCanvas;
    curW = nextW;
    curH = nextH;
  }

  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = targetW;
  finalCanvas.height = targetH;
  const ctx = finalCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('Browser canvas context is unavailable');
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(currentSource, 0, 0, targetW, targetH);

  // Free intermediate canvases immediately
  for (const c of intermediateCanvases) {
    c.width = 0;
    c.height = 0;
  }

  return finalCanvas;
}

/**
 * Optimizes an image File of ANY size into an efficient Blob.
 */
export async function optimizeImageToBlob(
  file: File,
  maxDim = 2048,
  quality = 0.88,
  maxBytes?: number
): Promise<{ blob: Blob; mimeType: string }> {
  // Preserve small SVG/GIF directly when under byte limit
  if (
    (file.type === 'image/svg+xml' || file.type === 'image/gif') &&
    (!maxBytes || file.size <= maxBytes)
  ) {
    return { blob: file, mimeType: file.type };
  }

  const { source, width, height, cleanup } = await loadDrawableImage(file);

  try {
    // If file is already reasonably dimensioned and fits under byte budget, keep it as-is
    if (
      width <= maxDim &&
      height <= maxDim &&
      file.size <= (maxBytes || 2 * 1024 * 1024) &&
      (file.type === 'image/webp' || file.type === 'image/jpeg' || file.type === 'image/png')
    ) {
      return { blob: file, mimeType: file.type };
    }

    let currentMaxDim = maxDim;
    let currentQuality = quality;
    const budget = maxBytes || 600 * 1024;

    // Try up to several adaptive passes so images of ANY input size (even 50MB-200MB+)
    // fit cleanly and look sharp
    const attempts: Array<{ dimFactor: number; qual: number }> = [
      { dimFactor: 1, qual: currentQuality },
      { dimFactor: 1, qual: Math.min(currentQuality, 0.78) },
      { dimFactor: 0.8, qual: 0.75 },
      { dimFactor: 0.65, qual: 0.70 },
      { dimFactor: 0.5, qual: 0.65 },
      { dimFactor: 0.38, qual: 0.58 },
      { dimFactor: 0.28, qual: 0.52 },
      { dimFactor: 0.2, qual: 0.45 },
    ];

    let bestBlob: Blob | null = null;
    let bestMime = 'image/webp';

    for (const step of attempts) {
      const targetDim = Math.max(320, Math.round(currentMaxDim * step.dimFactor));
      const canvas = renderScaledCanvas(source, width, height, targetDim);

      let blob = await canvasToBlobAsync(canvas, 'image/webp', step.qual);
      let mimeType = 'image/webp';

      // Safari/older canvas fallback if WebP encoding isn't supported
      if (!blob || blob.type !== 'image/webp') {
        blob = await canvasToBlobAsync(canvas, 'image/jpeg', step.qual);
        mimeType = 'image/jpeg';
      }

      canvas.width = 0;
      canvas.height = 0;

      if (blob) {
        bestBlob = blob;
        bestMime = mimeType;
        if (!maxBytes || blob.size <= budget) {
          return { blob, mimeType };
        }
      }
    }

    if (bestBlob) {
      return { blob: bestBlob, mimeType: bestMime };
    }

    return { blob: file, mimeType: file.type || 'image/jpeg' };
  } finally {
    cleanup();
  }
}

/**
 * Compresses an image File to a base64 Data URL.
 */
export async function compressImage(
  file: File,
  maxDim = 1280,
  quality = 0.85,
  maxBytes = 500 * 1024
): Promise<string> {
  const { blob } = await optimizeImageToBlob(file, maxDim, quality, maxBytes);
  return blobToDataUrl(blob);
}

/**
 * Uploads an image of ANY size and returns a persistent URL shared across all users:
 *
 * 1. Optimizes any size photo in the browser using memory-safe object URLs & progressive canvas scaling.
 * 2. Tries Firebase Storage with a fast stall timeout (if bucket is configured).
 * 3. Persists a crisp, byte-budgeted Data URL directly inside the Firestore record
 *    (survives all container restarts, Cloud Run scaling, and static deployments, visible to everyone!).
 */
export async function uploadImage(
  file: File,
  options?: ImageUploadOptions
): Promise<string> {
  if (!isImageFile(file)) {
    throw new Error('Please select a valid image file (JPEG, PNG, WebP, GIF, etc.).');
  }

  const folder = options?.folder || 'uploads';
  const defaults = getDefaultLimits(folder);
  const maxDimension = options?.maxDimension || defaults.maxDimension;
  const quality = options?.quality || defaults.quality;
  const maxBytes = options?.maxBytes || defaults.maxBytes;
  const onProgress = options?.onProgress;

  if (onProgress) onProgress(10);

  // 1. Optimize image in browser (supports input files of any size)
  const { blob, mimeType } = await optimizeImageToBlob(file, maxDimension, quality, maxBytes);

  if (onProgress) onProgress(45);

  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : mimeType === 'image/gif' ? 'gif' : 'jpg';
  const cleanName = file.name
    ? file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 32)
    : 'image';
  const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}_${cleanName}.${ext}`;
  const storagePath = `${folder}/${fileName}`;

  // 2. Fast-fail Firebase Storage attempt (only if bucket hasn't already returned 404/unavailable)
  if (!storageBucketUnavailable && storage?.app?.options?.storageBucket) {
    try {
      const storageRef = ref(storage, storagePath);
      const uploadTask = uploadBytesResumable(storageRef, blob, {
        contentType: mimeType,
        customMetadata: {
          originalName: file.name || 'image',
          uploadedAt: new Date().toISOString(),
        },
      });

      const downloadURL = await new Promise<string>((resolve, reject) => {
        let settled = false;
        const stallTimer = setTimeout(() => {
          if (!settled) {
            settled = true;
            try {
              uploadTask.cancel();
            } catch {
              // ignore
            }
            storageBucketUnavailable = true;
            reject(new Error('Storage upload timed out'));
          }
        }, 2500);

        uploadTask.on(
          'state_changed',
          (snapshot) => {
            if (snapshot.bytesTransferred > 0) {
              clearTimeout(stallTimer);
            }
            if (snapshot.totalBytes > 0 && onProgress) {
              const pct = 45 + Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 50);
              onProgress(Math.min(95, pct));
            }
          },
          (error) => {
            clearTimeout(stallTimer);
            if (!settled) {
              settled = true;
              storageBucketUnavailable = true;
              reject(error);
            }
          },
          async () => {
            clearTimeout(stallTimer);
            if (!settled) {
              settled = true;
              try {
                const url = await getDownloadURL(uploadTask.snapshot.ref);
                resolve(url);
              } catch (urlErr) {
                reject(urlErr);
              }
            }
          }
        );
      });

      if (downloadURL) {
        if (onProgress) onProgress(100);
        return downloadURL;
      }
    } catch {
      storageBucketUnavailable = true;
    }
  }

  if (onProgress) onProgress(75);

  // 3. Persistent Cloud Firestore Data URL (works across all browsers, users, and restarts)
  // Ensure the Data URL is compact enough to stay well below Firestore's 1MB document limit
  let finalBlob = blob;
  if (finalBlob.size > maxBytes) {
    const recompressed = await optimizeImageToBlob(file, Math.min(maxDimension, 1280), 0.70, maxBytes);
    finalBlob = recompressed.blob;
  }

  let dataUrl = await blobToDataUrl(finalBlob);
  if (dataUrl.length > 880_000) {
    const tighter = await optimizeImageToBlob(file, 960, 0.60, 480 * 1024);
    dataUrl = await blobToDataUrl(tighter.blob);
  }
  if (onProgress) onProgress(100);
  return dataUrl;
}
