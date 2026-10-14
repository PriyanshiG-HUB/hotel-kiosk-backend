import { OcrProvider, OcrProviderResult } from './ocrProvider.interface';

export class AzureDocumentIntelligenceOcrProvider implements OcrProvider {
  public readonly name = 'azure-document-intelligence';

  public isAvailable(): boolean {
    const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
    const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
    return Boolean(
      key &&
      endpoint &&
      key !== 'your_azure_doc_intelligence_key' &&
      !endpoint.includes('your-resource')
    );
  }

  public async recognize(imageBuffer: Buffer, mimeType = 'image/jpeg'): Promise<OcrProviderResult> {
    if (!this.isAvailable()) {
      throw new Error('Azure Document Intelligence endpoint or key is unconfigured.');
    }

    const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT!.replace(/\/+$/, '');
    const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY!;
    const url = `${endpoint}/documentintelligence/documentModels/prebuilt-idDocument:analyze?api-version=2024-02-29-preview`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': mimeType || 'application/octet-stream',
      },
      body: imageBuffer,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Azure Document Intelligence HTTP error ${res.status}: ${errText}`);
    }

    const operationLocation = res.headers.get('Operation-Location');
    if (!operationLocation) {
      throw new Error('Azure Document Intelligence did not return Operation-Location header for polling.');
    }

    // Poll async result with timeout (max 15 seconds)
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const pollRes = await fetch(operationLocation, {
        headers: { 'Ocp-Apim-Subscription-Key': key },
      });
      const pollData = await pollRes.json();

      if (pollData.status === 'succeeded') {
        const analyzeResult = pollData.analyzeResult;
        const content = analyzeResult?.content || '';
        return {
          text: content,
          confidence: 0.96,
          provider: this.name,
        };
      }

      if (pollData.status === 'failed') {
        throw new Error(`Azure Document Intelligence processing failed: ${JSON.stringify(pollData.error)}`);
      }
    }

    throw new Error('Azure Document Intelligence request timed out.');
  }
}
