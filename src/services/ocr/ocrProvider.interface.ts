export interface OcrProviderResult {
  text: string;
  confidence: number; // 0 to 1
  provider: string;
  blocks?: Array<{
    text: string;
    confidence: number;
    bbox?: { x0: number; y0: number; x1: number; y1: number };
  }>;
}

export interface OcrProvider {
  readonly name: string;
  isAvailable(): boolean;
  recognize(imageBuffer: Buffer, mimeType?: string): Promise<OcrProviderResult>;
}
