import { AuthenticityService } from '../src/services/authenticity.service';
import { ExtractedFields } from '../src/types/idVerification.types';

describe('AuthenticityService - Document Authenticity & UIDAI Verification', () => {
  it('should calculate ICAO Doc 9303 checksums accurately using weights 7-3-1', () => {
    // Standard ICAO test vector: 'L898902C3' -> check digit '6'
    // 'L' (21*7=147) + '8' (8*3=24) + '9' (9*1=9) + '8' (8*7=56) + '9' (9*3=27) + '0' (0*1=0) + '2' (2*7=14) + 'C' (12*3=36) + '3' (3*1=3)
    // sum = 316, 316 % 10 = 6
    expect(AuthenticityService.computeIcaoCheckDigit('L898902C3')).toBe(6);
    expect(AuthenticityService.computeIcaoCheckDigit('740812')).toBe(2);
  });

  it('should return pending_manual_review for Passport when ICAO PKI gateway is unconfigured', async () => {
    delete process.env.ICAO_PKD_SERVICE_URL;
    delete process.env.PASSPORT_VERIFY_API_KEY;

    const mockFields: ExtractedFields = {
      fullName: 'ANNA ERIKSSON',
      documentType: 'Passport',
      issuingCountry: 'United Kingdom',
      documentNumberMasked: '*****02C3',
      dateOfBirth: '1974-08-12',
      expirationDate: '2030-04-15',
      confidence: 0.9,
      isExpired: false,
    };

    const rawMrz = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';

    const result = await AuthenticityService.verifyAuthenticity('Passport', 'United Kingdom', mockFields, rawMrz);

    expect(result.status).toBe('pending_manual_review');
    expect(result.requiresManualReview).toBe(true);
    expect(result.isAuthentic).toBe(false); // Honest: not claimed authentic without cryptographic key
    expect(result.method).toBe('mrz_data_integrity');
    expect(result.dataIntegrityVerified).toBe(true);
    expect(result.details).toContain('Passport ICAO Doc 9303 MRZ data integrity checksums matched');
  });

  it('should NEVER mark Aadhaar as authenticated without authorized UIDAI verification mechanism', async () => {
    delete process.env.UIDAI_VERIFY_ENDPOINT;
    delete process.env.UIDAI_AUTH_API_KEY;
    delete process.env.UIDAI_PUBLIC_CERT_PATH;

    const mockAadhaarFields: ExtractedFields = {
      fullName: 'Rahul Verma',
      documentType: 'Aadhaar',
      issuingCountry: 'India',
      documentNumberMasked: '********9012',
      dateOfBirth: '1992-05-10',
      confidence: 0.95,
      isExpired: false,
    };

    const result = await AuthenticityService.verifyAuthenticity('Aadhaar', 'India', mockAadhaarFields, 'Aadhaar text');

    expect(result.status).toBe('pending_manual_review');
    expect(result.isAuthentic).toBe(false);
    expect(result.requiresManualReview).toBe(true);
    expect(result.details).toContain('UIDAI regulations, OCR cannot establish authenticity');
  });
});
