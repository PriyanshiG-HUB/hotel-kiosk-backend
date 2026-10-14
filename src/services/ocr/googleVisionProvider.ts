import { OcrProvider, OcrProviderResult } from './ocrProvider.interface';

export class GoogleVisionOcrProvider implements OcrProvider {
  public readonly name = 'google-cloud-vision';

  public isAvailable(): boolean {
    const key = process.env.GOOGLE_VISION_API_KEY;
    return Boolean(key && key !== 'your_google_cloud_vision_api_key' && key.trim().length > 10);
  }

  public async recognize(imageBuffer: Buffer): Promise<OcrProviderResult> {
    if (!this.isAvailable()) {
      throw new Error('Google Cloud Vision credentials are not configured or invalid.');
    }

    const apiKey = process.env.GOOGLE_VISION_API_KEY;
    const imageBase64 = imageBuffer.toString('base64');
    const url = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [
          {
            image: { content: imageBase64 },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Cloud Vision API HTTP error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const annotation = data?.responses?.[0]?.fullTextAnnotation;

    if (!annotation?.text) {
      return {
        text: '',
        confidence: 0,
        provider: this.name,
      };
    }

    // Compute average confidence if pages/blocks available
    let avgConfidence = 0.95;
    const pages = annotation.pages;
    if (pages && pages[0]?.confidence) {
      avgConfidence = pages[0].confidence;
    }

    return {
      text: annotation.text,
      confidence: Math.round(avgConfidence * 100) / 100,
      provider: this.name,
    };
  }
}
