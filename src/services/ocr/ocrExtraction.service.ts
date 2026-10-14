import { ExtractedFields, SupportedIdType } from '../../types/idVerification.types';

export interface ExtractionResult {
  extractedFields: ExtractedFields;
  warnings: string[];
  extractionQuality: number; // 0 to 100 percentage
  rawNormalizedText: string;
}

export class OcrExtractionService {
  public static extractFields(
    rawText: string,
    idType: SupportedIdType,
    country: string,
    ocrConfidenceBase: number
  ): ExtractionResult {
    const warnings: string[] = [];
    const cleanLines = rawText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    const fullNormalizedText = cleanLines.join(' ');

    let fullName = '';
    let docNumber = '';
    let dob: string | undefined;
    let expDate: string | undefined;
    let gender: string | undefined;
    let address: string | undefined;
    let mrzChecksumsValid: boolean | undefined;

    if (idType === 'Passport') {
      const td3Lines = cleanLines
        .map((l) => l.replace(/\s+/g, ''))
        .filter((l) => l.length >= 35 && /^[Pp][<A-Za-z0-9]/.test(l) || /^[A-Za-z0-9<]{9}\d[A-Za-z]/.test(l));
      const line1 = td3Lines.find((l) => /^[Pp][<A-Za-z0-9]/.test(l));
      const line2 = td3Lines.find((l) => /^[A-Za-z0-9<]{9}\d[A-Za-z]{3}\d{6}/.test(l));

      if (line1) {
        const surnameMatch = line1.match(/^[Pp]<([A-Z0-9]{3})([A-Z0-9<]+)/i);
        if (surnameMatch && surnameMatch[2]) {
          const parts = surnameMatch[2].split('<<');
          const surname = (parts[0] || '').replace(/</g, ' ').trim();
          const givenNames = (parts[1] || '').replace(/</g, ' ').trim();
          fullName = givenNames ? `${givenNames} ${surname}`.trim() : surname;
        }
      }
      if (line2 && line2.length >= 28) {
        docNumber = line2.substring(0, 9).replace(/</g, '').trim();
        const docNumCheck = parseInt(line2.substring(9, 10), 10);
        const dobRaw = line2.substring(13, 19);
        const dobCheck = parseInt(line2.substring(19, 20), 10);
        const sexChar = line2.substring(20, 21).toUpperCase();
        if (sexChar === 'M') gender = 'MALE';
        else if (sexChar === 'F') gender = 'FEMALE';
        const expRaw = line2.substring(21, 27);
        const expCheck = parseInt(line2.substring(27, 28), 10);
        dob = this.parseMrzDate(dobRaw, true);
        expDate = this.parseMrzDate(expRaw, false);
        const isDocNumValid = this.computeIcaoCheckDigit(line2.substring(0, 9)) === docNumCheck;
        const isDobValid = this.computeIcaoCheckDigit(dobRaw) === dobCheck;
        const isExpValid = this.computeIcaoCheckDigit(expRaw) === expCheck;
        mrzChecksumsValid = isDocNumValid && isDobValid && isExpValid;
        if (!mrzChecksumsValid) warnings.push('Passport MRZ check digits did not match optical checksums.');
      }
      if (!fullName) fullName = this.findField(cleanLines, ['given names', 'surname', 'name', 'nom', 'full name']) || '';
      if (!docNumber) {
        const pNumMatch = fullNormalizedText.match(/(?:passport|no|number)[.:\s#]*([A-Z][0-9]{7,9}|[0-9]{8,9})/i);
        if (pNumMatch) docNumber = pNumMatch[1];
      }
    }

    else if (idType === 'Aadhaar') {
      // 12-digit Aadhaar (starts 2-9 per UIDAI spec)
      const aadhaarMatch = fullNormalizedText.match(/\b([2-9][0-9]{3}[\s-]?[0-9]{4}[\s-]?[0-9]{4})\b/);
      if (aadhaarMatch) docNumber = aadhaarMatch[1].replace(/[\s-]/g, '');

      // DOB including Hindi label
      const dobMatch = fullNormalizedText.match(
        /(?:DOB|Date of Birth|Year of Birth|जन्म तिथि)[:\s]*([0-9]{2}[\/\-][0-9]{2}[\/\-][0-9]{4}|[0-9]{4})/i
      );
      if (dobMatch) dob = this.normalizeDate(dobMatch[1]);

      // Gender including Hindi
      const genderMatch = fullNormalizedText.match(/\b(MALE|FEMALE|TRANSGENDER|पुरुष|महिला)\b/i);
      if (genderMatch) {
        const raw = genderMatch[1].toLowerCase();
        if (raw === 'male' || raw === 'पुरुष') gender = 'MALE';
        else if (raw === 'female' || raw === 'महिला') gender = 'FEMALE';
        else gender = 'TRANSGENDER';
      }

      // Name extraction: 3-pass heuristic
      const NOISE = /government|india|unique|identification|authority|uidai|enrollment|enrolment|help|mera|aadhaar|resident|address|download|e-aadhaar|mobile|vid:|vid |validity|s\/o|d\/o|w\/o|c\/o|dob|date|birth|male|female|gender|year|टिप्पणी|आधार|भारत|सरकार|पहचान|प्राधिकरण/i;

      // Pass 1: line before DOB line
      if (!fullName && dob) {
        for (let i = 1; i < cleanLines.length; i++) {
          const ll = cleanLines[i].toLowerCase();
          if (ll.includes('dob') || ll.includes('date of birth') || ll.includes('year of birth')) {
            const cand = cleanLines[i - 1];
            if (cand && !NOISE.test(cand) && /^[A-Za-z\s.]+$/.test(cand) && cand.trim().length > 3 && cand.trim().length < 50) {
              fullName = cand.trim();
              break;
            }
          }
        }
      }

      // Pass 2: line after "Government of India" header
      if (!fullName) {
        for (let i = 0; i < cleanLines.length - 1; i++) {
          if (/government\s+of\s+india/i.test(cleanLines[i])) {
            for (let j = i + 1; j < Math.min(i + 4, cleanLines.length); j++) {
              const cand = cleanLines[j];
              const words = cand.trim().split(/\s+/);
              if (!NOISE.test(cand) && /^[A-Za-z\s.]+$/.test(cand) && words.length >= 2 && words.length <= 5 && cand.trim().length > 4 && cand.trim().length < 50) {
                fullName = cand.trim();
                break;
              }
            }
            if (fullName) break;
          }
        }
      }

      // Pass 3: best-scored alpha line
      if (!fullName) {
        let bestScore = -1;
        for (const line of cleanLines) {
          const words = line.trim().split(/\s+/);
          if (!NOISE.test(line) && /^[A-Za-z\s.]+$/.test(line) && words.length >= 2 && words.length <= 5 && line.trim().length > 5 && line.trim().length < 50) {
            const pc = words.filter((w) => /^[A-Z][a-z]+/.test(w) || /^[A-Z]{2,}$/.test(w)).length;
            const score = pc * 10 + words.length;
            if (score > bestScore) { bestScore = score; fullName = line.trim(); }
          }
        }
      }

      const addrMatch = fullNormalizedText.match(/(?:Address|S\/O|D\/O|W\/O)[:\s]+([^,]+(?:,[^,]+){2,})/i);
      if (addrMatch) address = addrMatch[1].trim();
    }

    else if (idType === 'PAN Card') {
      const panMatch = fullNormalizedText.match(/\b([A-Z]{5}[0-9]{4}[A-Z])\b/);
      if (panMatch) docNumber = panMatch[1];
      const dobMatch = fullNormalizedText.match(/(?:DOB|Date of Birth)[:\s]*([0-9]{2}[\/\-][0-9]{2}[\/\-][0-9]{4})/i)
        || fullNormalizedText.match(/\b([0-9]{2}[\/\-][0-9]{2}[\/\-][0-9]{4})\b/);
      if (dobMatch) dob = this.normalizeDate(dobMatch[1]);
      for (const line of cleanLines) {
        const words = line.split(' ');
        if (!/income|tax|department|govt|india|permanent|account|number|father|card/i.test(line) && words.length >= 2 && words.length <= 4 && /^[A-Za-z\s]+$/.test(line) && line.length > 5 && line.length < 40) {
          fullName = line; break;
        }
      }
    }

    else {
      const dlMatch = fullNormalizedText.match(/(?:DL\s*(?:NO|NUMBER)?|LICENCE\s*(?:NO|NUMBER)?|LICENSE\s*(?:NO|NUMBER)?|ID\s*(?:NO|NUMBER)?|NO|NUMBER)[:\s#]+([A-Z0-9-]{6,18})/i);
      if (dlMatch) docNumber = dlMatch[1];
      const dobMatch = fullNormalizedText.match(/(?:DOB|Birth)[:\s]*([0-9]{2}[\/\-][0-9]{2}[\/\-][0-9]{4}|[0-9]{4}[\/\-][0-9]{2}[\/\-][0-9]{2})/i);
      if (dobMatch) dob = this.normalizeDate(dobMatch[1], country);
      const expMatchDL = fullNormalizedText.match(/(?:EXP|EXPIRES|EXPIRY|VALID UNTIL|VALID UPTO)[:\s]*([0-9]{2}[\/\-][0-9]{2}[\/\-][0-9]{4}|[0-9]{4}[\/\-][0-9]{2}[\/\-][0-9]{2})/i);
      if (expMatchDL) expDate = this.normalizeDate(expMatchDL[1], country);
      fullName = this.findField(cleanLines, ['name', 'fn', 'ln', 'nom', 'full name']) || '';
      if (!fullName) {
        for (const line of cleanLines) {
          const words = line.split(' ');
          if (!/department|transport|motor|vehicles|state|license|driving|driver|republic|card/i.test(line) && words.length >= 2 && words.length <= 4 && /^[A-Za-z\s]+$/.test(line) && line.length > 5 && line.length < 40) {
            fullName = line; break;
          }
        }
      }
    }

    if (!expDate && idType !== 'Aadhaar' && idType !== 'PAN Card') {
      const expMatch = fullNormalizedText.match(/(?:exp|expiry|valid until|valid upto|valid thru)[.:\s]*([0-9]{2}[\/\-][0-9]{2}[\/\-][0-9]{4}|[0-9]{4}[\/\-][0-9]{2}[\/\-][0-9]{2})/i);
      if (expMatch) expDate = this.normalizeDate(expMatch[1], country);
    }

    const isExpired = expDate ? new Date(expDate).getTime() < Date.now() : false;
    if (isExpired) warnings.push(`Document expired on ${expDate}.`);

    const documentNumberMasked = docNumber
      ? docNumber.length > 4
        ? `${'*'.repeat(Math.min(docNumber.length - 4, docNumber.length === 8 && idType === 'Driving License' ? 3 : docNumber.length - 4))}${docNumber.slice(-4)}`
        : docNumber
      : '';

    if (!fullName) warnings.push('Guest full name could not be automatically extracted from document image.');
    if (!docNumber) warnings.push('Document number could not be clearly resolved.');
    if (ocrConfidenceBase < 0.6) warnings.push('OCR text quality is low. Ensure good lighting without glare or blur.');

    let fieldScore = 0;
    if (fullName) fieldScore += 0.35;
    if (docNumber) fieldScore += 0.35;
    if (dob) fieldScore += 0.15;
    if (expDate || idType === 'Aadhaar' || idType === 'PAN Card') fieldScore += 0.15;

    const overallConfidence = Math.min(1.0, Math.round((ocrConfidenceBase * 0.4 + fieldScore * 0.6) * 100) / 100);
    const extractionQuality = Math.round(overallConfidence * 100);

    const extractedFields: ExtractedFields = {
      fullName: fullName.trim(),
      documentType: idType,
      issuingCountry: country,
      documentNumberMasked,
      dateOfBirth: dob,
      expirationDate: expDate,
      gender,
      confidence: overallConfidence,
      isExpired,
      rawConfidenceDetails: {
        ocrConfidence: ocrConfidenceBase,
        fieldScore,
        mrzChecksumsValid: mrzChecksumsValid ? 1.0 : 0.0,
      },
    };

    return { extractedFields, warnings, extractionQuality, rawNormalizedText: fullNormalizedText };
  }

  public static findField(lines: string[], keywords: string[]): string | undefined {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const kw of keywords) {
        const regex = new RegExp(`^${kw}[:\\s]*(.*)$`, 'i');
        const match = line.match(regex);
        if (match && match[1] && match[1].trim().length > 1) return match[1].trim();
        if (new RegExp(`^${kw}$`, 'i').test(line) && i + 1 < lines.length) return lines[i + 1].trim();
      }
    }
    return undefined;
  }

  public static normalizeDate(dateStr: string, country?: string): string | undefined {
    if (!dateStr) return undefined;
    const clean = dateStr.trim();
    const dmy = clean.match(/^(\d{2})[\/\.\-](\d{2})[\/\.\-](\d{4})$/);
    if (dmy) {
      const first = parseInt(dmy[1], 10);
      const second = parseInt(dmy[2], 10);
      const year = dmy[3];
      // US documents typically use MM/DD/YYYY
      if (country === 'United States' || country === 'USA') {
        if (first <= 12 && second <= 31) {
          return `${year}-${dmy[1].padStart(2, '0')}-${dmy[2].padStart(2, '0')}`;
        }
      }
      // If second is > 12, it must be DD/MM/YYYY
      if (second <= 12 && first > 12) {
        return `${year}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
      }
      // Default standard DD/MM/YYYY
      return `${year}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    }
    const ymd = clean.match(/^(\d{4})[\/\.\-](\d{2})[\/\.\-](\d{2})$/);
    if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
    if (/^\d{4}$/.test(clean)) return `${clean}-01-01`;
    return undefined;
  }

  private static parseMrzDate(yymmdd: string, isPast: boolean): string | undefined {
    if (!yymmdd || yymmdd.length !== 6 || !/^\d{6}$/.test(yymmdd)) return undefined;
    const yy = parseInt(yymmdd.substring(0, 2), 10);
    const mm = yymmdd.substring(2, 4);
    const dd = yymmdd.substring(4, 6);
    const currentYear = new Date().getFullYear() % 100;
    const fullYear = isPast ? (yy > currentYear ? 1900 + yy : 2000 + yy) : 2000 + yy;
    return `${fullYear}-${mm}-${dd}`;
  }

  public static computeIcaoCheckDigit(str: string): number {
    const weights = [7, 3, 1];
    let sum = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      let val = 0;
      if (char >= '0' && char <= '9') val = parseInt(char, 10);
      else if (char >= 'A' && char <= 'Z') val = char.charCodeAt(0) - 55;
      else if (char === '<') val = 0;
      sum += val * weights[i % 3];
    }
    return sum % 10;
  }
}
