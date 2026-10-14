import { Request, Response } from 'express';
import { AuthenticityService } from '../services/authenticity.service';
import { CheckInService } from '../services/checkin.service';
import { IdVerificationSessionService } from '../services/idVerificationSession.service';
import { ImageQualityService } from '../services/imageQuality.service';
import { OcrService } from '../services/ocr.service';
import { CreateSessionDto } from '../types/idVerification.types';

export class IdVerificationController {
  /**
   * POST /api/id-verification/sessions
   * Creates a new verification attempt linked to booking or walk-in guest
   */
  public static async createSession(req: Request, res: Response) {
    try {
      const { bookingId, guestId, guestName, selectedIdType, issuingCountry, consentGiven } = req.body;

      if (!consentGiven) {
        return res.status(400).json({
          message: 'Explicit guest consent is required before processing identity documents.',
          code: 'consent_required',
        });
      }

      if (!selectedIdType || !issuingCountry) {
        return res.status(400).json({
          message: 'Selected ID type and issuing country are required.',
          code: 'invalid_parameters',
        });
      }

      // Check booking validity and duplicate check-in upfront if bookingId provided
      if (bookingId) {
        const eligibility = await CheckInService.validateBookingEligibility(bookingId);
        if (!eligibility.isValid) {
          if (eligibility.checkInStatus === 'checked_in') {
            return res.status(409).json({
              message: eligibility.message,
              code: 'already_checked_in',
              status: 'duplicate_checkin',
            });
          }
          return res.status(400).json({
            message: eligibility.message,
            code: 'booking_invalid',
            status: 'booking_invalid',
          });
        }
      }

      const dto: CreateSessionDto = {
        bookingId,
        guestId,
        guestName,
        selectedIdType,
        issuingCountry,
        consentGiven: Boolean(consentGiven),
      };

      const session = await IdVerificationSessionService.createSession(dto);
      return res.status(201).json(session);
    } catch (err: any) {
      console.error('Error creating verification session:', err);
      return res.status(500).json({ message: 'Internal Server Error', error: err.message });
    }
  }

  /**
   * POST /api/id-verification/:sessionId/document
   * Uploads front (and optional back) document image with quality checks
   */
  public static async uploadDocument(req: Request, res: Response) {
    try {
      const sessionId = req.params.sessionId as string;
      const session = await IdVerificationSessionService.getSession(sessionId);

      if (!session) {
        return res.status(404).json({ message: 'Verification session not found or expired', code: 'session_expired' });
      }

      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      const frontFile = files?.['front']?.[0] || (req.file ? req.file : undefined);
      const backFile = files?.['back']?.[0];

      if (!frontFile) {
        return res.status(400).json({ message: 'Front document image is required', code: 'front_image_required' });
      }

      // Assess image quality
      const qualityReport = ImageQualityService.assessImageQuality(frontFile.path, frontFile.mimetype);
      if (!qualityReport.passed) {
        return res.status(400).json({
          message: 'Document image quality check failed. Please recapture in good lighting.',
          code: 'quality_check_failed',
          issues: qualityReport.issues,
        });
      }

      // Track file for post-processing privacy deletion
      IdVerificationSessionService.trackTemporaryFile(sessionId, frontFile.path);
      if (backFile) {
        IdVerificationSessionService.trackTemporaryFile(sessionId, backFile.path);
      }

      const updated = await IdVerificationSessionService.updateSession(sessionId, {
        status: 'capture_complete',
        frontDocumentUploaded: true,
        backDocumentUploaded: Boolean(backFile),
        documentMimeType: frontFile.mimetype,
      });

      return res.json(updated);
    } catch (err: any) {
      console.error('Error uploading document:', err);
      return res.status(500).json({ message: 'Internal Server Error', error: err.message });
    }
  }

  /**
   * POST /api/id-verification/:sessionId/process
   * Performs real OCR and document authenticity checks
   */
  public static async processDocument(req: Request, res: Response) {
    try {
      const sessionId = req.params.sessionId as string;
      const session = await IdVerificationSessionService.getSession(sessionId);

      if (!session) {
        return res.status(404).json({ message: 'Verification session not found or expired', code: 'session_expired' });
      }

      // Read internal session to access temporary file path
      const internalSession = (IdVerificationSessionService as any).sessions.get(sessionId);
      const frontPath = internalSession?.temporaryFilePaths?.[0];

      if (!frontPath) {
        return res.status(400).json({
          message: 'No document image found for this session. Please capture your ID first.',
          code: 'document_missing',
        });
      }

      // 1. Update status to ocr_processing
      await IdVerificationSessionService.updateSession(sessionId, { status: 'ocr_processing' });

      // 2. Perform Real OCR
      let ocrResult;
      try {
        ocrResult = await OcrService.recognizeText(frontPath);
      } catch (ocrErr: any) {
        console.error('OCR processing error:', ocrErr);
        await IdVerificationSessionService.updateSession(sessionId, {
          status: 'verification_error',
          overallOutcome: 'staff_review_required',
        });
        return res.status(502).json({
          message: 'Document text could not be read clearly. Please request staff assistance.',
          code: 'ocr_extraction_failed',
        });
      }

      // 3. Extract Fields
      const extractedFields = OcrService.extractFields(
        ocrResult.text,
        session.selectedIdType,
        session.issuingCountry,
        ocrResult.confidence
      );

      // 4. Authenticity Check
      const authenticityResult = await AuthenticityService.verifyAuthenticity(
        session.selectedIdType,
        session.issuingCountry,
        extractedFields,
        ocrResult.text
      );

      // 5. Immediate Privacy Cleanup: delete raw images from disk
      IdVerificationSessionService.cleanupTemporaryFiles(internalSession);

      // 6. Determine final outcome
      let finalStatus = session.status;
      let overallOutcome: 'proceed' | 'staff_review_required' | 'rejected' = 'proceed';

      if (extractedFields.isExpired) {
        finalStatus = 'expired_document';
        overallOutcome = 'rejected';
      } else if (authenticityResult.status === 'verified') {
        finalStatus = 'authenticity_verified';
        overallOutcome = 'proceed';
      } else if (authenticityResult.status === 'pending_manual_review' || authenticityResult.requiresManualReview) {
        finalStatus = 'pending_manual_review';
        overallOutcome = 'staff_review_required';
      } else if (authenticityResult.status === 'failed') {
        finalStatus = 'authenticity_failed';
        overallOutcome = 'rejected';
      } else {
        finalStatus = 'verification_unavailable';
        overallOutcome = 'staff_review_required';
      }

      const updated = await IdVerificationSessionService.updateSession(sessionId, {
        status: finalStatus,
        extractedFields,
        authenticity: authenticityResult,
        overallOutcome,
      });

      return res.json(updated);
    } catch (err: any) {
      console.error('Error processing document:', err);
      return res.status(500).json({ message: 'Internal Server Error', error: err.message });
    }
  }

  /**
   * GET /api/id-verification/:sessionId
   * Retrieves the current verification status
   */
  public static async getSession(req: Request, res: Response) {
    try {
      const sessionId = req.params.sessionId as string;
      const session = await IdVerificationSessionService.getSession(sessionId);

      if (!session) {
        return res.status(404).json({ message: 'Verification session not found or expired', code: 'session_expired' });
      }

      return res.json(session);
    } catch (err: any) {
      return res.status(500).json({ message: 'Internal Server Error', error: err.message });
    }
  }

  /**
   * POST /api/id-verification/:sessionId/correct
   * Allows guest or staff to correct extraction errors
   */
  public static async correctFields(req: Request, res: Response) {
    try {
      const sessionId = req.params.sessionId as string;
      const { fullName, documentNumberMasked, dateOfBirth, expirationDate } = req.body;

      const session = await IdVerificationSessionService.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ message: 'Verification session not found or expired', code: 'session_expired' });
      }

      const corrected = {
        ...session.extractedFields,
        ...(fullName ? { fullName } : {}),
        ...(documentNumberMasked ? { documentNumberMasked } : {}),
        ...(dateOfBirth ? { dateOfBirth } : {}),
        ...(expirationDate ? { expirationDate } : {}),
      };

      const updated = await IdVerificationSessionService.updateSession(sessionId, {
        extractedFields: corrected as any,
        correctedFields: req.body,
      });

      return res.json(updated);
    } catch (err: any) {
      return res.status(500).json({ message: 'Internal Server Error', error: err.message });
    }
  }

  /**
   * POST /api/check-in/complete
   * Performs atomic, concurrency-safe check-in completion
   */
  public static async completeCheckIn(req: Request, res: Response) {
    try {
      const { sessionId, bookingId, paymentMethod, paymentAmount } = req.body;

      if (!bookingId) {
        return res.status(400).json({ message: 'Booking ID is required for check-in.', code: 'booking_required' });
      }

      const outcome = await CheckInService.completeCheckIn({
        sessionId,
        bookingId,
        paymentMethod,
        paymentAmount,
      });

      if (!outcome.success) {
        const statusCode =
          outcome.status === 'already_checked_in' ||
          outcome.status === 'duplicate_checkin' ||
          outcome.status === 'checkin_in_progress'
            ? 409
            : outcome.status === 'verification_required'
            ? 403
            : 400;

        return res.status(statusCode).json(outcome);
      }

      return res.json(outcome);
    } catch (err: any) {
      console.error('Error completing check-in:', err);
      return res.status(500).json({ message: 'Internal Server Error', error: err.message });
    }
  }

  /**
   * POST /api/id-verification/:sessionId/staff-review
   * Authenticated staff override for document manual inspection
   */
  public static async staffReview(req: Request, res: Response) {
    try {
      const sessionId = req.params.sessionId as string;
      const { staffId, staffPin, decision, notes, staffName } = req.body;

      if (!staffId || !decision) {
        return res.status(400).json({
          message: 'Staff ID and review decision (approved/rejected) are required.',
          code: 'invalid_review_parameters',
        });
      }

      // Security validation: verify staff kiosk PIN
      const expectedPin = process.env.STAFF_KIOSK_PIN || '1234';
      if (!staffPin || String(staffPin).trim() !== expectedPin) {
        return res.status(401).json({
          message: 'Invalid staff authorization PIN. Physical inspection approval denied.',
          code: 'unauthorized_staff',
        });
      }

      const updated = await IdVerificationSessionService.recordStaffReview(sessionId, {
        staffId: String(staffId).trim(),
        staffName: staffName ? String(staffName).trim() : undefined,
        decision,
        notes: notes ? String(notes).trim() : undefined,
      });

      if (!updated) {
        return res.status(404).json({
          message: 'Verification session not found or expired.',
          code: 'session_expired',
        });
      }

      return res.json(updated);
    } catch (err: any) {
      console.error('Error during staff review:', err);
      return res.status(500).json({ message: 'Internal Server Error', error: err.message });
    }
  }

  /**
   * POST /api/id-verification/:sessionId/cancel
   * Explicit guest or kiosk session cancellation with immediate file purge
   */
  public static async cancelSession(req: Request, res: Response) {
    try {
      const sessionId = req.params.sessionId as string;
      const cancelled = await IdVerificationSessionService.cancelSession(sessionId);

      if (!cancelled) {
        return res.status(404).json({
          message: 'Verification session not found or already closed.',
          code: 'session_not_found',
        });
      }

      return res.json({
        success: true,
        message: 'Verification session cancelled and temporary image files purged.',
      });
    } catch (err: any) {
      console.error('Error cancelling session:', err);
      return res.status(500).json({ message: 'Internal Server Error', error: err.message });
    }
  }
}
