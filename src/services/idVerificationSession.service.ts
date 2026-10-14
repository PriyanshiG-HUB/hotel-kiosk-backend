import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../config/supabase';
import {
  CreateSessionDto,
  ExtractedFields,
  StaffReviewDto,
  VerificationSession,
  VerificationStatus,
} from '../types/idVerification.types';

export class IdVerificationSessionService {
  private static sessions: Map<string, VerificationSession> = new Map();
  private static readonly SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes
  private static readonly STORE_FILE_PATH = path.join(__dirname, '../../uploads/sessions_store.json');
  private static isInitialized = false;
  private static cleanupInterval: any = null;

  /**
   * Initializes session store from durable disk storage and runs orphan cleanup
   */
  public static initialize() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // 1. Ensure uploads directory exists
    const uploadsDir = path.dirname(this.STORE_FILE_PATH);
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // 2. Load persisted sessions from disk (durability across server restarts)
    try {
      if (fs.existsSync(this.STORE_FILE_PATH)) {
        const raw = fs.readFileSync(this.STORE_FILE_PATH, 'utf-8');
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
          const now = Date.now();
          for (const s of data) {
            // Only keep non-expired sessions
            if (s.expiresAt && new Date(s.expiresAt).getTime() > now) {
              this.sessions.set(s.sessionId, s);
            }
          }
        }
      }
    } catch (err) {
      console.warn('Could not read existing sessions store:', err);
    }

    // 3. Clean up abandoned / orphaned files on startup
    this.cleanupOrphanedTemporaryFiles();

    // 4. Periodic background cleanup every 5 minutes (unref so timer does not block exit)
    if (!this.cleanupInterval) {
      this.cleanupInterval = setInterval(() => {
        this.cleanupOrphanedTemporaryFiles();
      }, 5 * 60 * 1000);
      if (this.cleanupInterval.unref) {
        this.cleanupInterval.unref();
      }
    }
  }

  /**
   * Flushes active sessions to durable disk storage
   */
  private static persistToDisk() {
    try {
      const active = Array.from(this.sessions.values()).map((s) => ({ ...s }));
      fs.writeFileSync(this.STORE_FILE_PATH, JSON.stringify(active, null, 2), 'utf-8');
    } catch (err) {
      console.warn('Failed to persist sessions to disk:', err);
    }
  }

  /**
   * Creates a new ID verification session
   */
  public static async createSession(dto: CreateSessionDto): Promise<VerificationSession> {
    this.initialize();

    const sessionId = uuidv4();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.SESSION_TTL_MS);

    const session: VerificationSession = {
      sessionId,
      bookingId: dto.bookingId,
      guestId: dto.guestId,
      expectedGuestName: dto.guestName,
      enteredDocumentNumber: dto.enteredDocumentNumber,
      selectedIdType: dto.selectedIdType,
      issuingCountry: dto.issuingCountry,
      consentObtained: dto.consentGiven,
      consentTimestamp: dto.consentGiven ? now.toISOString() : undefined,
      status: 'not_started',
      frontDocumentUploaded: false,
      temporaryFilePaths: [],
      persistenceStatus: 'persistent_file_store',
      overallOutcome: 'in_progress',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    this.sessions.set(sessionId, session);

    // Attempt to persist to Supabase PostgreSQL id_verifications table
    try {
      const { error } = await supabase.from('id_verifications').insert([
        {
          session_id: sessionId,
          booking_id: dto.bookingId || null,
          guest_id: dto.guestId || null,
          id_type: dto.selectedIdType,
          issuing_country: dto.issuingCountry,
          status: 'not_started',
          consent_obtained: dto.consentGiven,
          created_at: now.toISOString(),
        },
      ]);

      if (error) {
        if (error.code === 'PGRST205') {
          console.warn(
            '[DATABASE NOTICE] Table "id_verifications" not yet found in Supabase. Verification session saved to durable local store. Run migration 20261013_id_verification_and_checkin.sql to enable PostgreSQL table audit.'
          );
        } else {
          console.error('[DATABASE AUDIT ERROR] Failed to write session to Supabase:', error.message);
        }
      } else {
        session.persistenceStatus = 'supabase_database';
      }
    } catch (err: any) {
      console.warn('[DATABASE AUDIT WARNING] Supabase connection error:', err.message);
    }

    this.persistToDisk();
    return this.sanitizeSession(session);
  }

  /**
   * Retrieves a verification session by ID
   */
  public static async getSession(sessionId: string): Promise<VerificationSession | null> {
    this.initialize();

    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // Check TTL expiration
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      session.status = 'verification_error';
      session.overallOutcome = 'rejected';
      this.cleanupTemporaryFiles(session);
      this.persistToDisk();
      return null;
    }

    return this.sanitizeSession(session);
  }

  /**
   * Updates an active verification session
   */
  public static async updateSession(
    sessionId: string,
    updates: Partial<VerificationSession>
  ): Promise<VerificationSession | null> {
    this.initialize();

    const session = this.sessions.get(sessionId);
    if (!session) return null;

    Object.assign(session, updates, { updatedAt: new Date().toISOString() });
    this.sessions.set(sessionId, session);

    // Sync with Supabase if table exists
    try {
      const isUUID = session.staffReview?.staffId &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session.staffReview.staffId);

      const { error } = await supabase
        .from('id_verifications')
        .update({
          status: session.status,
          extracted_name: session.extractedFields?.fullName || null,
          document_masked: session.extractedFields?.documentNumberMasked || null,
          date_of_birth: session.extractedFields?.dateOfBirth || null,
          expiration_date: session.extractedFields?.expirationDate || null,
          extraction_quality: session.extractionQuality || (session.extractedFields?.confidence ? Math.round(session.extractedFields.confidence * 100) : null),
          extracted_fields_json: session.extractedFields || null,
          authenticity_status: session.authenticity?.status || null,
          overall_outcome: session.overallOutcome,
          reviewed_by: session.staffReview?.reviewedBy || null,
          reviewed_by_staff_id: isUUID ? session.staffReview?.staffId : null,
          reviewed_at: session.staffReview?.reviewedAt || null,
          staff_notes: session.staffReview?.notes || null,
          physical_id_inspected: session.staffReview?.physicalOriginalInspected ?? false,
          updated_at: session.updatedAt,
        })
        .eq('session_id', sessionId);

      if (!error) {
        session.persistenceStatus = 'supabase_database';
      }
    } catch (_) {
      // Ignored if table not created
    }

    this.persistToDisk();
    return this.sanitizeSession(session);
  }

  /**
   * Records an authorized staff manual-review override or decision
   */
  public static async recordStaffReview(
    sessionId: string,
    review: StaffReviewDto
  ): Promise<VerificationSession | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // Concurrency / Duplicate check: prevent conflicting duplicate review
    if (session.staffReview?.decision && (session.status === 'authenticity_verified' || session.status === 'authenticity_failed')) {
      throw new Error(`Session has already been reviewed with outcome "${session.staffReview.decision}" by ${session.staffReview.reviewedBy}. Duplicate review blocked.`);
    }

    const isApproved = review.decision === 'approved';
    const now = new Date().toISOString();

    const staffRecord = {
      reviewedBy: review.staffId,
      staffId: review.staffId,
      staffName: review.staffName || 'Kiosk Staff Member',
      reviewedAt: now,
      decision: review.decision,
      notes: review.notes,
      physicalOriginalInspected: review.physicalOriginalInspected ?? true,
    };

    const newStatus: VerificationStatus = isApproved ? 'authenticity_verified' : 'authenticity_failed';
    const outcome = isApproved ? 'proceed' : 'rejected';

    const updatedAuthenticity = {
      ...session.authenticity,
      method: (session.authenticity?.method || 'manual_review_required') as any,
      status: (isApproved ? 'verified' : 'failed') as any,
      isAuthentic: isApproved,
      requiresManualReview: false,
      details: isApproved
        ? `Approved by authorized staff member (${review.staffId}) following visual physical document review.`
        : `Rejected by staff member (${review.staffId}): ${review.notes || 'Document inspection failed'}`,
      verifiedAt: now,
    };

    return this.updateSession(sessionId, {
      status: newStatus,
      overallOutcome: outcome,
      authenticity: updatedAuthenticity,
      staffReview: staffRecord,
    });
  }

  /**
   * Cancels a verification session and purges uploaded files immediately
   */
  public static async cancelSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    this.cleanupTemporaryFiles(session);
    await this.updateSession(sessionId, {
      status: 'verification_error',
      overallOutcome: 'rejected',
    });
    return true;
  }

  /**
   * Registers uploaded document temporary file for automated privacy deletion
   */
  public static trackTemporaryFile(sessionId: string, filePath: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (!session.temporaryFilePaths) session.temporaryFilePaths = [];
      session.temporaryFilePaths.push(filePath);
      this.persistToDisk();
    }
  }

  /**
   * Immediately deletes uploaded image files from disk post-OCR/verification
   */
  public static cleanupTemporaryFiles(session: VerificationSession) {
    if (session.temporaryFilePaths && session.temporaryFilePaths.length > 0) {
      for (const p of session.temporaryFilePaths) {
        try {
          if (fs.existsSync(p)) {
            fs.unlinkSync(p);
          }
        } catch (e) {
          console.warn(`Failed to unlink temporary image file: ${p}`, e);
        }
      }
      session.temporaryFilePaths = [];
    }
    this.persistToDisk();
  }

  /**
   * Scans temporary uploads directory and safely removes orphaned files older than 15 minutes
   */
  public static cleanupOrphanedTemporaryFiles() {
    const tempDir = path.join(__dirname, '../../uploads/temp');
    if (!fs.existsSync(tempDir)) return;

    try {
      const files = fs.readdirSync(tempDir);
      const now = Date.now();
      for (const f of files) {
        const fullPath = path.join(tempDir, f);
        try {
          const stats = fs.statSync(fullPath);
          // If file is older than 15 minutes, safely unlink
          if (now - stats.mtimeMs > 15 * 60 * 1000) {
            fs.unlinkSync(fullPath);
          }
        } catch (_) {}
      }
    } catch (err) {
      console.warn('Error during orphaned temporary file cleanup:', err);
    }
  }

  /**
   * Removes sensitive private server paths and raw credentials before sending to client
   */
  public static sanitizeSession(session: VerificationSession): VerificationSession {
    const copy = { ...session };
    delete copy.temporaryFilePaths;
    return copy;
  }
}
