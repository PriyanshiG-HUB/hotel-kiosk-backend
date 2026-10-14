import request from 'supertest';
import app from '../src/app';

describe('ID Verification API Endpoints', () => {
  let createdSessionId: string;

  it('POST /api/id-verification/sessions - should reject session creation without explicit consent', async () => {
    const res = await request(app)
      .post('/api/id-verification/sessions')
      .send({
        selectedIdType: 'Passport',
        issuingCountry: 'United States',
        consentGiven: false,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('consent_required');
  });

  it('POST /api/id-verification/sessions - should reject invalid/missing ID type parameters', async () => {
    const res = await request(app)
      .post('/api/id-verification/sessions')
      .send({
        consentGiven: true,
      });

    expect(res.status).toBe(400);
  });

  it('POST /api/id-verification/sessions - should successfully create session with consent and valid params', async () => {
    const res = await request(app)
      .post('/api/id-verification/sessions')
      .send({
        selectedIdType: 'Passport',
        issuingCountry: 'United States',
        consentGiven: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.sessionId).toBeDefined();
    expect(res.body.status).toBe('not_started');
    expect(res.body.consentObtained).toBe(true);

    createdSessionId = res.body.sessionId;
  });

  it('GET /api/id-verification/:sessionId - should return session details', async () => {
    const res = await request(app).get(`/api/id-verification/${createdSessionId}`);

    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe(createdSessionId);
    expect(res.body.status).toBe('not_started');
  });

  it('GET /api/id-verification/:sessionId - should return 404 for unknown session', async () => {
    const res = await request(app).get('/api/id-verification/00000000-0000-0000-0000-000000000000');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('session_expired');
  });

  it('POST /api/id-verification/:sessionId/correct - should allow correcting extracted fields', async () => {
    const res = await request(app)
      .post(`/api/id-verification/${createdSessionId}/correct`)
      .send({
        fullName: 'Jane Doe',
        documentNumberMasked: '*****4321',
      });

    expect(res.status).toBe(200);
    expect(res.body.extractedFields?.fullName).toBe('Jane Doe');
  });

  it('POST /api/id-verification/:sessionId/staff-review - should reject unauthorized staff review with wrong PIN', async () => {
    const res = await request(app)
      .post(`/api/id-verification/${createdSessionId}/staff-review`)
      .send({
        staffId: 'STAFF-99',
        staffPin: '0000', // Invalid PIN
        decision: 'approved',
      });

    expect(res.status).toBe(401);
    expect(['unauthorized_staff', 'invalid_staff_id', 'invalid_pin']).toContain(res.body.code);
  });

  it('POST /api/id-verification/:sessionId/staff-review - should approve document with valid staff credentials', async () => {
    const res = await request(app)
      .post(`/api/id-verification/${createdSessionId}/staff-review`)
      .send({
        staffId: 'STAFF-101',
        staffPin: '1234', // Valid default kiosk staff PIN
        decision: 'approved',
        notes: 'Physical document verified under UV light',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('authenticity_verified');
    expect(res.body.overallOutcome).toBe('proceed');
    expect(res.body.staffReview?.reviewedBy).toBe('STAFF-101');
    expect(res.body.staffReview?.decision).toBe('approved');
  });

  it('POST /api/id-verification/:sessionId/cancel - should cancel session and purge files', async () => {
    const res = await request(app).post(`/api/id-verification/${createdSessionId}/cancel`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
