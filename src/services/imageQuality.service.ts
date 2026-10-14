import fs from 'fs';

export interface ImageQualityReport {
  passed: boolean;
  fileSizeBytes: number;
  mimeType: string;
  reason?: string;
  issues: string[];
}

export class ImageQualityService {
  private static readonly MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
  private static readonly MIN_FILE_SIZE = 15 * 1024; // 15 KB (reject empty / corrupted)
  private static readonly ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];

  /**
   * Evaluates image file quality before passing to OCR
   */
  public static assessImageQuality(filePath: string, mimeType: string): ImageQualityReport {
    const issues: string[] = [];

    if (!fs.existsSync(filePath)) {
      return {
        passed: false,
        fileSizeBytes: 0,
        mimeType,
        reason: 'Image file does not exist on disk',
        issues: ['file_not_found'],
      };
    }

    const stats = fs.statSync(filePath);
    const fileSizeBytes = stats.size;

    if (!this.ALLOWED_MIME_TYPES.includes(mimeType.toLowerCase())) {
      issues.push(`unsupported_mime_type_${mimeType}`);
    }

    if (fileSizeBytes > this.MAX_FILE_SIZE) {
      issues.push('image_exceeds_max_size_5mb');
    }

    if (fileSizeBytes < this.MIN_FILE_SIZE) {
      issues.push('image_too_small_or_empty');
    }

    // Inspect header magic bytes to verify genuine image content
    try {
      const buffer = Buffer.alloc(12);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buffer, 0, 12, 0);
      fs.closeSync(fd);

      const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
      const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
      const isWebp =
        buffer[0] === 0x52 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x46 &&
        buffer[8] === 0x57 &&
        buffer[9] === 0x45 &&
        buffer[10] === 0x42 &&
        buffer[11] === 0x50;

      if (!isJpeg && !isPng && !isWebp) {
        issues.push('invalid_image_magic_header');
      }
    } catch (err) {
      issues.push('file_read_error');
    }

    const passed = issues.length === 0;
    return {
      passed,
      fileSizeBytes,
      mimeType,
      reason: passed ? undefined : issues.join(', '),
      issues,
    };
  }
}
