import request from 'supertest';
import app from '../src/app';
import { StaffAuthService } from '../src/services/staffAuth.service';

describe('Staff Authentication & Manual Review Security Tests', () => {
  let sessionId: string;

  beforeAll(async () => {
    // Seed staff data in memory/local store
    StaffAuthService.initialize();
  });

  beforeEach(async () => {
    // Create a fresh verification session for testing
    const res = await request(app)
      .post('/api/id-verification/sessions')
      .send({
        selectedIdType: 'Passport',
        issuingCountry: 'United States',
        consentGiven: true,
      });
    sessionId = res.body.sessionId;
  });

  it('should approve document with valid authorized staff credentials (STAFF-101)', async () => {
    const res = await request(app)
      .post(`/api/id-verification/${sessionId}/staff-review`)
      .send({
        staffId: 'STAFF-101',
        staffPin: '1234',
        decision: 'approved',
        physicalOriginalInspected: true,
        notes: 'Passport verified with UV watermark check.',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('authenticity_verified');
    expect(res.body.overallOutcome).toBe('proceed');
    expect(res.body.staffReview?.reviewedBy).toBe('STAFF-101');
    expect(res.body.staffReview?.decision).toBe('approved');
    expect(res.body.staffReview?.physicalOriginalInspected).toBe(true);
  });

  it('should reject staff review with invalid staff ID', async () => {
    const res = await request(app)
      .post(`/api/id-verification/${sessionId}/staff-review`)
      .send({
        staffId: 'STAFF-NONEXISTENT',
        staffPin: '1234',
        decision: 'approved',
      });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('invalid_staff_id');
  });

  it('should reject staff review with incorrect PIN', async () => {
    const res = await request(app)
      .post(`/api/id-verification/${sessionId}/staff-review`)
      .send({
        staffId: 'STAFF-101',
        staffPin: '0000', // Wrong PIN
        decision: 'approved',
      });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('invalid_pin');
  });

  it('should reject staff review when physical original was not inspected', async () => {
    const res = await request(app)
      .post(`/api/id-verification/${sessionId}/staff-review`)
      .send({
        staffId: 'STAFF-101',
        staffPin: '1234',
        decision: 'approved',
        physicalOriginalInspected: false,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('physical_inspection_required');
  });

  it('should record document rejection with audit trail', async () => {
    const res = await request(app)
      .post(`/api/id-verification/${sessionId}/staff-review`)
      .send({
        staffId: 'STAFF-102',
        staffPin: '5678',
        decision: 'rejected',
        notes: 'Document damaged and photo laminated improperly.',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('authenticity_failed');
    expect(res.body.overallOutcome).toBe('rejected');
    expect(res.body.staffReview?.decision).toBe('rejected');
    expect(res.body.staffReview?.notes).toContain('damaged');
  });

  it('should return 404 for nonexistent verification session', async () => {
    const res = await request(app)
      .post('/api/id-verification/00000000-0000-0000-0000-000000000000/staff-review')
      .send({
        staffId: 'STAFF-101',
        staffPin: '1234',
        decision: 'approved',
      });

    expect(res.status).toBe(404);
  });

  it('should prevent duplicate conflicting approval attempts', async () => {
    // First approval
    const first = await request(app)
      .post(`/api/id-verification/${sessionId}/staff-review`)
      .send({
        staffId: 'STAFF-101',
        staffPin: '1234',
        decision: 'approved',
      });
    expect(first.status).toBe(200);

    // Second conflicting review on same session
    const duplicate = await request(app)
      .post(`/api/id-verification/${sessionId}/staff-review`)
      .send({
        staffId: 'STAFF-102',
        staffPin: '5678',
        decision: 'rejected',
      });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('duplicate_review');
  });

  it('should lock out account after repeated failed attempts', async () => {
    const testStaffId = 'STAFF-103';

    // Send 5 failed attempts
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post(`/api/id-verification/${sessionId}/staff-review`)
        .send({
          staffId: testStaffId,
          staffPin: 'WRONG_PIN',
          decision: 'approved',
        });
    }

    // 6th attempt should return 423 Locked
    const lockedRes = await request(app)
      .post(`/api/id-verification/${sessionId}/staff-review`)
      .send({
        staffId: testStaffId,
        staffPin: '9999', // Correct PIN, but locked out!
        decision: 'approved',
      });

    expect(lockedRes.status).toBe(423);
    expect(lockedRes.body.code).toBe('account_locked');
  });
});
