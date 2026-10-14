import { AzureDocumentIntelligenceOcrProvider } from './azureProvider';
import { GoogleVisionOcrProvider } from './googleVisionProvider';
import { OcrProvider } from './ocrProvider.interface';
import { TesseractOcrProvider } from './tesseractProvider';

export class OcrProviderFactory {
  private static localProvider = new TesseractOcrProvider();
  private static googleProvider = new GoogleVisionOcrProvider();
  private static azureProvider = new AzureDocumentIntelligenceOcrProvider();

  public static getProvider(): OcrProvider {
    const configured = (process.env.OCR_PROVIDER || 'tesseract').toLowerCase().trim();

    if (configured === 'google' || configured === 'google-vision') {
      if (this.googleProvider.isAvailable()) {
        return this.googleProvider;
      }
      console.warn(
        '[OCR PROVIDER NOTICE] Google Cloud Vision selected but credentials not valid. Falling back to local Tesseract engine.'
      );
      return this.localProvider;
    }

    if (configured === 'azure' || configured === 'azure-document-intelligence') {
      if (this.azureProvider.isAvailable()) {
        return this.azureProvider;
      }
      console.warn(
        '[OCR PROVIDER NOTICE] Azure Document Intelligence selected but credentials not configured. Falling back to local Tesseract engine.'
      );
      return this.localProvider;
    }

    return this.localProvider;
  }

  public static getLocalProvider(): OcrProvider {
    return this.localProvider;
  }
}
