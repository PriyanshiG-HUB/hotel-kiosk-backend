export type VerificationStatus =
  | 'not_started'
  | 'capture_complete'
  | 'ocr_processing'
  | 'ocr_completed'
  | 'needs_recapture'
  | 'authenticity_pending'
  | 'authenticity_verified'
  | 'authenticity_failed'
  | 'pending_manual_review'
  | 'verification_unavailable'
  | 'expired_document'
  | 'duplicate_checkin'
  | 'booking_invalid'
  | 'verification_error';

export type SupportedIdType =
  | 'Passport'
  | 'Driving License'
  | 'State ID'
  | 'Aadhaar'
  | 'PAN Card'
  | 'National ID'
  | 'Health Card';

export interface ExtractedFields {
  fullName: string;
  documentType: string;
  issuingCountry: string;
  documentNumberMasked: string; // Only masked in public responses (e.g. *******1234)
  dateOfBirth?: string; // YYYY-MM-DD when available and permitted
  expirationDate?: string; // YYYY-MM-DD
  issueDate?: string;
  gender?: string;
  address?: string;
  confidence: number; // Extraction confidence (0 to 1)
  isExpired: boolean;
  rawConfidenceDetails?: Record<string, number>;
  warnings?: string[];
  extractionQuality?: number; // 0 to 100 percentage
  /** Result of comparing OCR-extracted number vs number entered earlier in the form */
  aadhaarNumberMatch?: 'match' | 'mismatch' | 'unable_to_verify';
}

export interface AuthenticityResult {
  method: 'mrz_data_integrity' | 'secure_qr_signature' | 'provider_authorized_api' | 'format_heuristics' | 'manual_review_required';
  status: 'verified' | 'failed' | 'pending_manual_review' | 'unavailable';
  isAuthentic: boolean;
  requiresManualReview: boolean;
  details: string;
  signatureVerified?: boolean;
  checksumMatches?: boolean;
  dataIntegrityVerified?: boolean;
  verifiedAt?: string;
  providerName?: string;
}

export interface BookingValidationResult {
  isValid: boolean;
  bookingId?: string;
  guestName?: string;
  checkInStatus: 'not_checked_in' | 'checked_in' | 'already_checked_out' | 'cancelled' | 'in_progress';
  message: string;
}

export interface StaffReviewRecord {
  reviewedBy: string; // staffCode or full name
  staffId?: string;
  staffCode?: string;
  staffName?: string;
  role?: string;
  reviewedAt: string;
  decision: 'approved' | 'rejected';
  notes?: string;
  physicalOriginalInspected: boolean;
}

export interface VerificationSession {
  sessionId: string;
  bookingId?: string;
  guestId?: string;
  expectedGuestName?: string;
  /** The document number the guest entered earlier in the check-in form (used for OCR comparison) */
  enteredDocumentNumber?: string;
  selectedIdType: SupportedIdType;
  issuingCountry: string;
  consentObtained: boolean;
  consentTimestamp?: string;
  status: VerificationStatus;
  frontDocumentUploaded: boolean;
  backDocumentUploaded?: boolean;
  documentMimeType?: string;
  temporaryFilePaths?: string[];
  extractedFields?: ExtractedFields;
  correctedFields?: Partial<ExtractedFields>;
  authenticity?: AuthenticityResult;
  bookingValidation?: BookingValidationResult;
  staffReview?: StaffReviewRecord;
  persistenceStatus?: 'supabase_database' | 'persistent_file_store';
  overallOutcome: 'proceed' | 'staff_review_required' | 'rejected' | 'in_progress';
  warnings?: string[];
  extractionQuality?: number;
  cropBox?: { x: number; y: number; width: number; height: number };
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface StaffReviewDto {
  staffId: string; // staffCode (e.g. STAFF-101) or staffId UUID
  staffPin: string;
  decision: 'approved' | 'rejected';
  notes?: string;
  staffName?: string;
  physicalOriginalInspected?: boolean;
}

export interface CreateSessionDto {
  bookingId?: string;
  guestId?: string;
  guestName?: string;
  /** The document number the guest entered in a prior step (e.g. Aadhaar number from booking form) */
  enteredDocumentNumber?: string;
  selectedIdType: SupportedIdType;
  issuingCountry: string;
  consentGiven: boolean;
}

export interface CorrectFieldsDto {
  fullName?: string;
  documentNumberMasked?: string;
  dateOfBirth?: string;
  expirationDate?: string;
}

export interface CheckInCompleteDto {
  sessionId?: string;
  bookingId: string;
  guestId?: string;
  paymentMethod?: string;
  paymentAmount?: number;
}
