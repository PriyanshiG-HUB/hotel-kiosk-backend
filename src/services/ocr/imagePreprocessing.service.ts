import sharp from 'sharp';

export interface PreprocessingOptions {
  idType?: string;
  cropBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface PreprocessingResult {
  processedBuffer: Buffer;
  originalBuffer: Buffer;
  metadata: {
    originalWidth: number;
    originalHeight: number;
    processedWidth: number;
    processedHeight: number;
    wasUpscaled: boolean;
    wasCropped: boolean;
  };
}

export class ImagePreprocessingService {
  /**
   * Preprocesses image for optimal OCR recognition while strictly preserving the original
   */
  public static async preprocessForOcr(
    inputBuffer: Buffer,
    options: PreprocessingOptions = {}
  ): Promise<PreprocessingResult> {
    let pipeline = sharp(inputBuffer);
    const meta = await pipeline.metadata();

    const originalWidth = meta.width || 1280;
    const originalHeight = meta.height || 720;
    let wasCropped = false;
    let wasUpscaled = false;

    // 1. Auto-orient based on EXIF tags
    pipeline = pipeline.rotate();

    // 2. Document Cropping (if crop coordinates provided)
    if (options.cropBox && options.cropBox.width > 20 && options.cropBox.height > 20) {
      const left = Math.max(0, Math.round(options.cropBox.x));
      const top = Math.max(0, Math.round(options.cropBox.y));
      const width = Math.min(originalWidth - left, Math.round(options.cropBox.width));
      const height = Math.min(originalHeight - top, Math.round(options.cropBox.height));

      if (width > 50 && height > 50) {
        pipeline = pipeline.extract({ left, top, width, height });
        wasCropped = true;
      }
    }

    // 3. Upscaling if resolution is low (optimal OCR width is ~1800-2400px)
    const effectiveWidth = wasCropped && options.cropBox ? options.cropBox.width : originalWidth;
    if (effectiveWidth < 1400) {
      const scale = Math.min(2.5, 2000 / effectiveWidth);
      const targetWidth = Math.round(effectiveWidth * scale);
      pipeline = pipeline.resize({
        width: targetWidth,
        kernel: sharp.kernel.lanczos3,
        withoutEnlargement: false,
      });
      wasUpscaled = true;
    }

    // 4. Strategy per document type
    const isPassport = (options.idType || '').toLowerCase().includes('passport');

    if (isPassport) {
      // Passport strategy: grayscale, contrast normalization, strong sharpening for MRZ
      pipeline = pipeline
        .grayscale()
        .normalize()
        .sharpen({
          sigma: 1.4,
          m1: 1.2,
          m2: 2.5,
        });
    } else {
      // Card strategy (Aadhaar, PAN, Driving License, State ID):
      // Grayscale, adaptive normalization, moderate sharpening
      pipeline = pipeline
        .grayscale()
        .normalize()
        .sharpen({
          sigma: 1.2,
          m1: 1.0,
          m2: 2.0,
        });
    }

    // Export as high-quality uncompressed JPEG/PNG buffer for OCR
    const processedBuffer = await pipeline.jpeg({ quality: 95 }).toBuffer();
    const processedMeta = await sharp(processedBuffer).metadata();

    return {
      processedBuffer,
      originalBuffer: inputBuffer,
      metadata: {
        originalWidth,
        originalHeight,
        processedWidth: processedMeta.width || originalWidth,
        processedHeight: processedMeta.height || originalHeight,
        wasUpscaled,
        wasCropped,
      },
    };
  }
}
