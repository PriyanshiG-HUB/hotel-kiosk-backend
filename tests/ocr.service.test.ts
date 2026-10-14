import { OcrService } from '../src/services/ocr.service';

describe('OcrService - Field Extraction & Parsing', () => {
  it('should parse Passport MRZ lines and extract name, document number, DOB, and expiry', () => {
    const mockPassportMrz = `
      P<USADOE<<JOHN<ROBERT<<<<<<<<<<<<<<<<<<<<<<<
      1234567897USA8501014M3001018<<<<<<<<<<<<<<04
    `;

    const result = OcrService.extractFields(mockPassportMrz, 'Passport', 'United States', 0.95);

    expect(result.documentType).toBe('Passport');
    expect(result.issuingCountry).toBe('United States');
    expect(result.fullName).toBe('JOHN ROBERT DOE');
    expect(result.documentNumberMasked).toBe('*****6789');
    expect(result.dateOfBirth).toBe('1985-01-01');
    expect(result.expirationDate).toBe('2030-01-01');
    expect(result.isExpired).toBe(false);
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('should detect expired documents correctly', () => {
    const expiredMrz = `
      P<UTOERIKSSON<<ANNA<<<<<<<<<<<<<<<<<<<<<<<<<
      L898902C36UTO7408122F1504159ZE184226B<<<<<10
    `;

    const result = OcrService.extractFields(expiredMrz, 'Passport', 'United Kingdom', 0.9);
    expect(result.isExpired).toBe(true);
    expect(result.expirationDate).toBe('2015-04-15');
  });

  it('should extract Aadhaar name, masked 12-digit number, and DOB', () => {
    const mockAadhaarText = `
      Government of India
      Priyanshi Sharma
      DOB: 15/08/1998
      MALE
      4512 8765 9012
    `;

    const result = OcrService.extractFields(mockAadhaarText, 'Aadhaar', 'India', 0.92);

    expect(result.documentType).toBe('Aadhaar');
    expect(result.fullName).toBe('Priyanshi Sharma');
    expect(result.documentNumberMasked).toBe('********9012');
    expect(result.dateOfBirth).toBe('1998-08-15');
    expect(result.gender).toBe('MALE');
    expect(result.isExpired).toBe(false);
  });

  it('should extract Indian PAN card number format and name', () => {
    const mockPanText = `
      INCOME TAX DEPARTMENT
      GOVT OF INDIA
      ABCDE1234F
      Johnathan Doe
      01/01/1990
    `;

    const result = OcrService.extractFields(mockPanText, 'PAN Card', 'India', 0.88);
    expect(result.documentType).toBe('PAN Card');
    expect(result.documentNumberMasked).toBe('******234F');
    expect(result.dateOfBirth).toBe('1990-01-01');
  });

  it('should safely normalize various date formats', () => {
    expect(OcrService.normalizeDate('15/07/2026')).toBe('2026-07-15');
    expect(OcrService.normalizeDate('15-07-2026')).toBe('2026-07-15');
    expect(OcrService.normalizeDate('2026-07-15')).toBe('2026-07-15');
    expect(OcrService.normalizeDate('1995')).toBe('1995-01-01');
    expect(OcrService.normalizeDate('')).toBeUndefined();
  });
});
