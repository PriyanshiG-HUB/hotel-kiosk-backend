import path from 'path';
import { createWorker } from 'tesseract.js';
import { OcrProvider, OcrProviderResult } from './ocrProvider.interface';

export class TesseractOcrProvider implements OcrProvider {
  public readonly name = 'tesseract-local';
  private static readonly LOCAL_LANG_PATH = path.resolve(__dirname, '../../../');

  public isAvailable(): boolean {
    return true; // Local tesseract is always available via bundled eng.traineddata
  }

  public async recognize(imageBuffer: Buffer): Promise<OcrProviderResult> {
    let worker;
    try {
      worker = await createWorker('eng', 1, {
        langPath: TesseractOcrProvider.LOCAL_LANG_PATH,
        cachePath: TesseractOcrProvider.LOCAL_LANG_PATH,
      });

      const ret = await worker.recognize(imageBuffer);
      await worker.terminate();

      const rawConfidence = ret.data.confidence;
      const normalizedConfidence = typeof rawConfidence === 'number'
        ? Math.min(1.0, Math.max(0.1, Math.round(rawConfidence) / 100))
        : 0.75;

      const blocks = (ret.data.blocks || []).map((b) => ({
        text: b.text,
        confidence: (b.confidence || 75) / 100,
        bbox: b.bbox ? { x0: b.bbox.x0, y0: b.bbox.y0, x1: b.bbox.x1, y1: b.bbox.y1 } : undefined,
      }));

      return {
        text: ret.data.text || '',
        confidence: normalizedConfidence,
        provider: this.name,
        blocks,
      };
    } catch (err: any) {
      if (worker) {
        try {
          await worker.terminate();
        } catch (_) {}
      }
      throw new Error(`Tesseract local OCR failed: ${err.message || String(err)}`);
    }
  }
}
