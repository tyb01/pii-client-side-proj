/**
 * Canvas-based preprocessing for scanned pages before OCR: grayscale,
 * contrast normalization (histogram stretch), and deskew. These are the
 * cheap wins that meaningfully improve Tesseract accuracy on faxed/skewed
 * hospital documents, per the plan.
 */

function cloneCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  out.getContext("2d")!.drawImage(canvas, 0, 0);
  return out;
}

/** Grayscale + linear contrast stretch based on the image's actual min/max luminance. */
export function grayscaleAndNormalizeContrast(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const out = cloneCanvas(canvas);
  const ctx = out.getContext("2d")!;
  const imageData = ctx.getImageData(0, 0, out.width, out.height);
  const { data } = imageData;

  const gray = new Uint8ClampedArray(data.length / 4);
  let min = 255;
  let max = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[p] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }

  const range = Math.max(max - min, 1);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const stretched = ((gray[p] - min) / range) * 255;
    data[i] = data[i + 1] = data[i + 2] = stretched;
  }

  ctx.putImageData(imageData, 0, 0);
  return out;
}

function rotateCanvas(canvas: HTMLCanvasElement, angleDeg: number): HTMLCanvasElement {
  if (Math.abs(angleDeg) < 0.05) return canvas;
  const rad = (angleDeg * Math.PI) / 180;
  const w = canvas.width;
  const h = canvas.height;
  const newW = Math.ceil(Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad)));
  const newH = Math.ceil(Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad)));

  const out = document.createElement("canvas");
  out.width = newW;
  out.height = newH;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, newW, newH);
  ctx.translate(newW / 2, newH / 2);
  ctx.rotate(rad);
  ctx.drawImage(canvas, -w / 2, -h / 2);
  return out;
}

/**
 * Estimates document skew via a projection-profile search: rotate a small
 * working copy across a range of angles and pick the one that maximizes
 * variance of row-wise ink density (text lines produce sharp peaks/troughs
 * only when they're horizontal).
 */
function detectSkewAngleDeg(canvas: HTMLCanvasElement): number {
  const maxDim = 500;
  const scale = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.round(canvas.width * scale));
  small.height = Math.max(1, Math.round(canvas.height * scale));
  small.getContext("2d")!.drawImage(canvas, 0, 0, small.width, small.height);

  let bestAngle = 0;
  let bestScore = -Infinity;

  for (let angle = -10; angle <= 10; angle += 0.5) {
    const rotated = rotateCanvas(small, angle);
    const ctx = rotated.getContext("2d")!;
    const { data } = ctx.getImageData(0, 0, rotated.width, rotated.height);

    const rowSums = new Float64Array(rotated.height);
    for (let y = 0; y < rotated.height; y++) {
      let sum = 0;
      const rowStart = y * rotated.width * 4;
      for (let x = 0; x < rotated.width; x++) {
        sum += 255 - data[rowStart + x * 4]; // ink density (darker = more text)
      }
      rowSums[y] = sum;
    }

    const mean = rowSums.reduce((a, b) => a + b, 0) / rowSums.length;
    const variance =
      rowSums.reduce((a, b) => a + (b - mean) ** 2, 0) / rowSums.length;

    if (variance > bestScore) {
      bestScore = variance;
      bestAngle = angle;
    }
  }

  return bestAngle;
}

export interface PreprocessResult {
  canvas: HTMLCanvasElement;
  skewAngleDeg: number;
}

export function preprocessForOcr(source: HTMLCanvasElement): PreprocessResult {
  const normalized = grayscaleAndNormalizeContrast(source);
  const skewAngleDeg = detectSkewAngleDeg(normalized);
  const deskewed = rotateCanvas(normalized, -skewAngleDeg);
  return { canvas: deskewed, skewAngleDeg };
}
