import fs from 'fs';
import { ExtractedFields, SupportedIdType } from '../types/idVerification.types';
import { ImagePreprocessingService, PreprocessingOptions } from './ocr/imagePreprocessing.service';
import { ExtractionResult, OcrExtractionService } from './ocr/ocrExtraction.service';
import { OcrProviderFactory } from './ocr/ocrProviderFactory';

export interface OcrRawResult {
  text: string;
  confidence: number;
  provider: string;
  preprocessed?: boolean;
}

export class OcrService {
  /**
   * Performs enhanced OCR using preprocessing and configured modular provider (with local fallback)
   */
  public static async recognizeText(
    imagePath: string,
    options: PreprocessingOptions = {}
  ): Promise<OcrRawResult> {
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Document image not found at path: ${imagePath}`);
    }

    const rawBuffer = fs.readFileSync(imagePath);
    const provider = OcrProviderFactory.getProvider();

    // 1. Run image preprocessing (EXIF rotation, crop, upscale, normalization, sharpening)
    let preprocessedBuffer: Buffer = rawBuffer;
    let wasPreprocessed = false;

    try {
      const prepResult = await ImagePreprocessingService.preprocessForOcr(rawBuffer, options);
      preprocessedBuffer = prepResult.processedBuffer;
      wasPreprocessed = true;
    } catch (prepErr) {
      console.warn('Image preprocessing warning (falling back to original buffer):', prepErr);
      preprocessedBuffer = rawBuffer;
    }

    // 2. Perform OCR recognition with primary provider
    let result;
    try {
      result = await provider.recognize(preprocessedBuffer);
    } catch (provErr: any) {
      console.warn(`Primary OCR provider "${provider.name}" failed: ${provErr.message}. Retrying with local Tesseract engine.`);
      const fallbackProvider = OcrProviderFactory.getLocalProvider();
      result = await fallbackProvider.recognize(preprocessedBuffer);
    }

    // 3. Dual-pass verification: if preprocessed text is empty or unexpectedly low confidence, try original clean buffer
    if ((!result.text || result.text.trim().length < 5) && wasPreprocessed) {
      try {
        const altResult = await provider.recognize(rawBuffer);
        if (altResult.text && altResult.text.trim().length > (result.text?.trim()?.length || 0)) {
          return {
            text: altResult.text,
            confidence: altResult.confidence,
            provider: altResult.provider,
            preprocessed: false,
          };
        }
      } catch (_) {}
    }

    return {
      text: result.text || '',
      confidence: result.confidence,
      provider: result.provider,
      preprocessed: wasPreprocessed,
    };
  }

  /**
   * Extracts and structures fields based on document type and raw OCR text
   */
  public static extractFields(
    rawText: string,
    idType: SupportedIdType,
    country: string,
    confidenceBase: number
  ): ExtractedFields {
    const result: ExtractionResult = OcrExtractionService.extractFields(
      rawText,
      idType,
      country,
      confidenceBase
    );
    return result.extractedFields;
  }

  /**
   * Detailed extraction with warnings and quality scores
   */
  public static extractFieldsDetailed(
    rawText: string,
    idType: SupportedIdType,
    country: string,
    confidenceBase: number
  ): ExtractionResult {
    return OcrExtractionService.extractFields(rawText, idType, country, confidenceBase);
  }

  public static normalizeDate(dateStr: string): string | undefined {
    return OcrExtractionService.normalizeDate(dateStr);
  }

  public static computeIcaoCheckDigit(str: string): number {
    return OcrExtractionService.computeIcaoCheckDigit(str);
  }
}
