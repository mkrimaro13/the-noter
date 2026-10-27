/**
 * Reads an image file and — for large photographs — scales and re-encodes it
 * before it becomes a data URL. Notes live in localStorage, so keeping images
 * reasonably small makes the quota last.
 */
export async function imageFileToDataUrl(file: File, maxDimension = 1600): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('That file is not an image.');
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error('Images must be smaller than 15 MB.');
  }

  const dataUrl = await readAsDataUrl(file);

  // Small files, animated GIFs and SVGs are kept untouched.
  if (file.size <= 250_000 || file.type === 'image/gif' || file.type === 'image/svg+xml') {
    return dataUrl;
  }

  try {
    const image = await loadImage(dataUrl);
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    if (scale >= 1) return dataUrl;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

    const context = canvas.getContext('2d');
    if (!context) return dataUrl;

    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/webp', 0.84);
  } catch {
    // If decoding fails we still let the browser try to display the original.
    return dataUrl;
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not read the image.'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode the image.'));
    image.src = src;
  });
}
