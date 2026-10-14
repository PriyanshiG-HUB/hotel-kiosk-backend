import fs from 'fs';
import path from 'path';
import { createWorker } from 'tesseract.js';
import { ExtractedFields, SupportedIdType } from '../types/idVerification.types';

export interface OcrRawResult {
  text: string;
  confidence: number;
  provider: string;
}

export class OcrService {
  /**
   * Performs real OCR using configured cloud provider or local Tesseract engine
   */
  public static async recognizeText(imagePath: string): Promise<OcrRawResult> {
    const provider = process.env.OCR_PROVIDER || 'tesseract';

    // 1. Check if Google Cloud Vision is configured
    if (provider === 'google' && process.env.GOOGLE_VISION_API_KEY) {
      try {
        const imageBase64 = fs.readFileSync(imagePath).toString('base64');
        const url = `https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_VISION_API_KEY}`;
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
        const data = await response.json();
        const annotation = data?.responses?.[0]?.fullTextAnnotation;
        if (annotation?.text) {
          return {
            text: annotation.text,
            confidence: 0.95,
            provider: 'google-vision',
          };
        }
      } catch (err) {
        console.warn('Google Vision OCR failed, falling back to local Tesseract engine:', err);
      }
    }

    // 2. Check if Azure Document Intelligence is configured
    if (provider === 'azure' && process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY && process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT) {
      try {
        const imageBuffer = fs.readFileSync(imagePath);
        const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT.replace(/\/+$/, '');
        const url = `${endpoint}/documentintelligence/documentModels/prebuilt-idDocument:analyze?api-version=2024-02-29-preview`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY,
            'Content-Type': 'application/octet-stream',
          },
          body: imageBuffer,
        });
        const operationLocation = res.headers.get('Operation-Location');
        if (operationLocation) {
          // Poll Azure async result
          for (let i = 0; i < 10; i++) {
            await new Promise((r) => setTimeout(r, 1000));
            const pollRes = await fetch(operationLocation, {
              headers: { 'Ocp-Apim-Subscription-Key': process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY },
            });
            const pollData = await pollRes.json();
            if (pollData.status === 'succeeded') {
              const content = pollData.analyzeResult?.content || '';
              return {
                text: content,
                confidence: 0.96,
                provider: 'azure-document-intelligence',
              };
            }
            if (pollData.status === 'failed') break;
          }
        }
      } catch (err) {
        console.warn('Azure Document Intelligence OCR failed, falling back to Tesseract:', err);
      }
    }

    // 3. Built-in Local Tesseract Engine (Node.js)
    let worker;
    try {
      worker = await createWorker('eng');
      const ret = await worker.recognize(imagePath);
      await worker.terminate();

      return {
        text: ret.data.text || '',
        confidence: (ret.data.confidence || 75) / 100,
        provider: 'tesseract-local',
      };
    } catch (err) {
      if (worker) {
        try {
          await worker.terminate();
        } catch (_) {}
      }
      throw new Error(`OCR recognition failed: ${err instanceof Error ? err.message : String(err)}`);
    }
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
    const cleanLines = rawText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const fullNormalizedText = cleanLines.join(' ');

    let fullName = '';
    let docNumber = '';
    let dob: string | undefined;
    let expDate: string | undefined;
    let gender: string | undefined;

    // A. PASSPORT EXTRACTION (Checks MRZ first, then visual lines)
    if (idType === 'Passport') {
      const mrzLines = cleanLines.filter((l) => /^[P|p][<A-Za-z0-9]{30,}/.test(l.replace(/\s+/g, '')));
      if (mrzLines.length >= 1) {
        const line1 = mrzLines[0].replace(/\s+/g, '');
        // Format: P<COUNTRY<<SURNAME<<GIVEN<NAMES<<<<
        const surnameMatch = line1.match(/^[P|p]<([A-Z0-9]{3})([A-Z<]+)/);
        if (surnameMatch && surnameMatch[2]) {
          const namesPart = surnameMatch[2];
          const parts = namesPart.split('<<');
          const surname = parts[0]?.replace(/</g, ' ').trim() || '';
          const givenNames = parts[1]?.replace(/</g, ' ').trim() || '';
          fullName = givenNames ? `${givenNames} ${surname}`.trim() : surname;
        }
      }

      // Check second MRZ line if present
      const mrzLine2 = cleanLines.find((l) => /^[A-Za-z0-9<]{9}\d[A-Za-z]{3}\d{6}/.test(l.replace(/\s+/g, '')));
      if (mrzLine2) {
        const line2 = mrzLine2.replace(/\s+/g, '');
        docNumber = line2.substring(0, 9).replace(/</g, '');
        const dobStr = line2.substring(13, 19);
        const expStr = line2.substring(21, 27);
        dob = this.parseMrzDate(dobStr, true);
        expDate = this.parseMrzDate(expStr, false);
      }

      // Fallback visual field search for Passport
      if (!fullName) {
        fullName = this.findField(cleanLines, ['given names', 'surname', 'name', 'nom']) || '';
      }
      if (!docNumber) {
        const pNumMatch = fullNormalizedText.match(/(?:passport|no|number)[.:\s]*([A-Z][0-9]{7,9}|[0-9]{8,9})/i);
        if (pNumMatch) docNumber = pNumMatch[1];
      }
    }

    // B. AADHAAR EXTRACTION
    else if (idType === 'Aadhaar') {
      // Find 12 digit number (xxxx xxxx xxxx or 12 digits)
      const aadhaarMatch = fullNormalizedText.match(/\b([2-9][0-9]{3}[\s-]?[0-9]{4}[\s-]?[0-9]{4})\b/);
      if (aadhaarMatch) {
        docNumber = aadhaarMatch[1].replace(/[\s-]/g, '');
      }

      // Look for DOB
      const dobMatch = fullNormalizedText.match(/(?:DOB|Date of Birth|Year of Birth)[:\s]*([0-9]{2}[\/-][0-9]{2}[\/-][0-9]{4}|[0-9]{4})/i);
      if (dobMatch) {
        dob = this.normalizeDate(dobMatch[1]);
      }

      // Look for gender
      const genderMatch = fullNormalizedText.match(/\b(MALE|FEMALE|TRANSGENDER)\b/i);
      if (genderMatch) {
        gender = genderMatch[1].toUpperCase();
      }

      // Name is usually near top or before DOB line
      for (const line of cleanLines) {
        if (
          !/government|india|unique|identification|authority|enrollment|help|uidai|dob|date of birth|male|female|download/i.test(line) &&
          line.split(' ').length >= 2 &&
          line.split(' ').length <= 4 &&
          /^[A-Za-z\s]+$/.test(line)
        ) {
          fullName = line;
          break;
        }
      }
    }

    // C. PAN CARD EXTRACTION
    else if (idType === 'PAN Card') {
      const panMatch = fullNormalizedText.match(/\b([A-Z]{5}[0-9]{4}[A-Z])\b/);
      if (panMatch) {
        docNumber = panMatch[1];
      }

      const dobMatch =
        fullNormalizedText.match(/(?:DOB|Date of Birth)[:\s]*([0-9]{2}[\/-][0-9]{2}[\/-][0-9]{4})/i) ||
        fullNormalizedText.match(/\b([0-9]{2}[\/-][0-9]{2}[\/-][0-9]{4})\b/);
      if (dobMatch) {
        dob = this.normalizeDate(dobMatch[1]);
      }

      for (const line of cleanLines) {
        if (
          !/income|tax|department|govt|india|permanent|account|number|father/i.test(line) &&
          line.split(' ').length >= 2 &&
          line.split(' ').length <= 4 &&
          /^[A-Za-z\s]+$/.test(line)
        ) {
          fullName = line;
          break;
        }
      }
    }

    // D. DRIVING LICENSE / STATE ID / NATIONAL ID
    else {
      // Driver's License number patterns (US, UK, India, Canada)
      const dlMatch = fullNormalizedText.match(/(?:DL|LICENCE|LICENSE|ID|NO|NUMBER)[.:\s#]*([A-Z0-9-]{6,16})/i);
      if (dlMatch) {
        docNumber = dlMatch[1];
      }

      // DOB
      const dobMatch = fullNormalizedText.match(/(?:DOB|Birth)[:\s]*([0-9]{2}[\/-][0-9]{2}[\/-][0-9]{4}|[0-9]{4}[\/-][0-9]{2}[\/-][0-9]{2})/i);
      if (dobMatch) {
        dob = this.normalizeDate(dobMatch[1]);
      }

      // Expiry
      const expMatch = fullNormalizedText.match(/(?:EXP|EXPIRES|EXPIRY|VALID UNTIL|VALID UPTO)[:\s]*([0-9]{2}[\/-][0-9]{2}[\/-][0-9]{4}|[0-9]{4}[\/-][0-9]{2}[\/-][0-9]{2})/i);
      if (expMatch) {
        expDate = this.normalizeDate(expMatch[1]);
      }

      // Name
      fullName = this.findField(cleanLines, ['name', 'fn', 'ln', 'nom', 'full name']) || '';
      if (!fullName) {
        for (const line of cleanLines) {
          if (
            !/department|transport|motor|vehicles|state|license|driving|driver|republic|license/i.test(line) &&
            line.split(' ').length >= 2 &&
            line.split(' ').length <= 4 &&
            /^[A-Za-z\s]+$/.test(line)
          ) {
            fullName = line;
            break;
          }
        }
      }
    }

    // Generic expiry search if not yet found
    if (!expDate && idType !== 'Aadhaar' && idType !== 'PAN Card') {
      const expMatch = fullNormalizedText.match(/(?:exp|expiry|valid until|valid upto|valid thru)[.:\s]*([0-9]{2}[\/-][0-9]{2}[\/-][0-9]{4}|[0-9]{4}[\/-][0-9]{2}[\/-][0-9]{2})/i);
      if (expMatch) {
        expDate = this.normalizeDate(expMatch[1]);
      }
    }

    // Check expiration
    const isExpired = expDate ? new Date(expDate).getTime() < Date.now() : false;

    // Mask document number (Keep last 4 characters visible, mask rest)
    const documentNumberMasked = docNumber
      ? docNumber.length > 4
        ? `${'*'.repeat(docNumber.length - 4)}${docNumber.slice(-4)}`
        : docNumber
      : '';

    // Calculate confidence based on matched fields
    let fieldScore = 0;
    if (fullName) fieldScore += 0.35;
    if (docNumber) fieldScore += 0.35;
    if (dob) fieldScore += 0.15;
    if (expDate || idType === 'Aadhaar' || idType === 'PAN Card') fieldScore += 0.15;

    const overallConfidence = Math.min(1.0, Math.round((confidenceBase * 0.4 + fieldScore * 0.6) * 100) / 100);

    return {
      fullName: fullName.trim(),
      documentType: idType,
      issuingCountry: country,
      documentNumberMasked,
      dateOfBirth: dob,
      expirationDate: expDate,
      gender,
      confidence: overallConfidence,
      isExpired,
    };
  }

  private static findField(lines: string[], keywords: string[]): string | undefined {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const kw of keywords) {
        const regex = new RegExp(`^${kw}[:\\s]*(.*)$`, 'i');
        const match = line.match(regex);
        if (match && match[1] && match[1].trim().length > 1) {
          return match[1].trim();
        }
        if (new RegExp(`^${kw}$`, 'i').test(line) && i + 1 < lines.length) {
          return lines[i + 1].trim();
        }
      }
    }
    return undefined;
  }

  public static normalizeDate(dateStr: string): string | undefined {
    if (!dateStr) return undefined;
    const clean = dateStr.trim();
    // Match DD/MM/YYYY or DD-MM-YYYY
    const dmy = clean.match(/^(\d{2})[\/\.-](\d{2})[\/\.-](\d{4})$/);
    if (dmy) {
      return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    }
    // Match YYYY/MM/DD or YYYY-MM-DD
    const ymd = clean.match(/^(\d{4})[\/\.-](\d{2})[\/\.-](\d{2})$/);
    if (ymd) {
      return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
    }
    // Match YYYY only
    if (/^\d{4}$/.test(clean)) {
      return `${clean}-01-01`;
    }
    return undefined;
  }

  private static parseMrzDate(yymmdd: string, isPast: boolean): string | undefined {
    if (!yymmdd || yymmdd.length !== 6 || !/^\d{6}$/.test(yymmdd)) return undefined;
    const yy = parseInt(yymmdd.substring(0, 2), 10);
    const mm = yymmdd.substring(2, 4);
    const dd = yymmdd.substring(4, 6);
    const currentYear = new Date().getFullYear() % 100;

    let fullYear: number;
    if (isPast) {
      // DOB: if yy > currentYear, 1900s, else 2000s
      fullYear = yy > currentYear ? 1900 + yy : 2000 + yy;
    } else {
      // Expiration: usually 2000s
      fullYear = 2000 + yy;
    }

    return `${fullYear}-${mm}-${dd}`;
  }
}
