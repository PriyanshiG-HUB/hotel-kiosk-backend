import fs from 'fs';
import path from 'path';
import { ImageQualityService } from '../src/services/imageQuality.service';

describe('ImageQualityService - Document Quality Verification', () => {
  const testDir = path.join(__dirname, 'test-artifacts');

  beforeAll(() => {
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should reject non-existent file path', () => {
    const report = ImageQualityService.assessImageQuality('non/existent/file.jpg', 'image/jpeg');
    expect(report.passed).toBe(false);
    expect(report.issues).toContain('file_not_found');
  });

  it('should reject unsupported MIME type', () => {
    const filePath = path.join(testDir, 'test.pdf');
    fs.writeFileSync(filePath, Buffer.alloc(20000));
    const report = ImageQualityService.assessImageQuality(filePath, 'application/pdf');
    expect(report.passed).toBe(false);
    expect(report.issues).toContain('unsupported_mime_type_application/pdf');
  });

  it('should reject file smaller than minimum required size', () => {
    const tinyPath = path.join(testDir, 'tiny.jpg');
    fs.writeFileSync(tinyPath, Buffer.alloc(100)); // 100 bytes is too small
    const report = ImageQualityService.assessImageQuality(tinyPath, 'image/jpeg');
    expect(report.passed).toBe(false);
    expect(report.issues).toContain('image_too_small_or_empty');
  });

  it('should pass valid image with appropriate size and magic header', () => {
    const validPath = path.join(testDir, 'valid.jpg');
    // JPEG header: FF D8 FF E0
    const buffer = Buffer.alloc(25 * 1024);
    buffer[0] = 0xff;
    buffer[1] = 0xd8;
    buffer[2] = 0xff;
    buffer[3] = 0xe0;
    fs.writeFileSync(validPath, buffer);

    const report = ImageQualityService.assessImageQuality(validPath, 'image/jpeg');
    expect(report.passed).toBe(true);
    expect(report.issues.length).toBe(0);
  });
});
