import { CheckInService } from '../src/services/checkin.service';
import { supabase } from '../src/config/supabase';

describe('CheckInService - Duplicate Check-in & Concurrency Protection', () => {
  const testBookingId = 'test-booking-uuid-1234';

  beforeEach(() => {
    // Release any leftover active locks
    (CheckInService as any).activeLocks.clear();
  });

  it('should reject check-in when bookingId is missing', async () => {
    const outcome = await CheckInService.completeCheckIn({
      bookingId: '',
      sessionId: 'session-123',
    });

    expect(outcome.success).toBe(false);
    expect(outcome.status).toBe('booking_invalid');
  });

  it('should detect parallel in-flight race condition and return checkin_in_progress', async () => {
    // Simulate first lock acquisition
    (CheckInService as any).activeLocks.add(testBookingId);

    // Second simultaneous request arrives
    const concurrentOutcome = await CheckInService.completeCheckIn({
      bookingId: testBookingId,
      sessionId: 'session-abc',
    });

    expect(concurrentOutcome.success).toBe(false);
    expect(concurrentOutcome.status).toBe('checkin_in_progress');
    expect(concurrentOutcome.message).toContain('check-in operation is currently in progress');
  });

  it('should reject check-in for an already checked-in booking', async () => {
    // Mock Supabase query to simulate already checked-in booking
    const spy = jest.spyOn(supabase, 'from').mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          booking_id: testBookingId,
          booking_status: 'checked_in',
          checked_out: false,
        },
        error: null,
      }),
    } as any);

    const outcome = await CheckInService.completeCheckIn({
      bookingId: testBookingId,
    });

    expect(outcome.success).toBe(false);
    expect(outcome.status).toBe('already_checked_in');
    expect(outcome.message).toContain('already been checked in');

    spy.mockRestore();
  });

  it('should reject check-in for a completed and checked-out booking', async () => {
    const spy = jest.spyOn(supabase, 'from').mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          booking_id: testBookingId,
          booking_status: 'completed',
          checked_out: true,
        },
        error: null,
      }),
    } as any);

    const outcome = await CheckInService.completeCheckIn({
      bookingId: testBookingId,
    });

    expect(outcome.success).toBe(false);
    expect(outcome.status).toBe('booking_already_completed');

    spy.mockRestore();
  });

  it('should reject check-in when ID verification session is missing for confirmed booking', async () => {
    const spy = jest.spyOn(supabase, 'from').mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          booking_id: testBookingId,
          booking_status: 'confirmed',
          checked_out: false,
        },
        error: null,
      }),
    } as any);

    const outcome = await CheckInService.completeCheckIn({
      bookingId: testBookingId,
      // No sessionId
    });

    expect(outcome.success).toBe(false);
    expect(outcome.status).toBe('verification_required');
    expect(outcome.message).toContain('verification session is required');

    spy.mockRestore();
  });

  it('should reject check-in when ID verification session is pending manual review without staff approval', async () => {
    const bookingSpy = jest.spyOn(supabase, 'from').mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          booking_id: testBookingId,
          booking_status: 'confirmed',
          checked_out: false,
        },
        error: null,
      }),
    } as any);

    // Mock IdVerificationSessionService
    const { IdVerificationSessionService } = require('../src/services/idVerificationSession.service');
    const sessionSpy = jest.spyOn(IdVerificationSessionService, 'getSession').mockResolvedValue({
      sessionId: 'pending-session-id',
      bookingId: testBookingId,
      status: 'pending_manual_review',
      overallOutcome: 'staff_review_required',
    });

    const outcome = await CheckInService.completeCheckIn({
      bookingId: testBookingId,
      sessionId: 'pending-session-id',
    });

    expect(outcome.success).toBe(false);
    expect(outcome.status).toBe('verification_required');
    expect(outcome.message).toContain('requires staff authorization');

    bookingSpy.mockRestore();
    sessionSpy.mockRestore();
  });

  it('should successfully complete check-in when session is approved by authorized staff review', async () => {
    const bookingSpy = jest.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      if (table === 'bookings') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: {
              booking_id: testBookingId,
              booking_status: 'confirmed',
              checked_out: false,
              room_id: 'room-uuid-1',
            },
            error: null,
          }),
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                select: jest.fn().mockResolvedValue({
                  data: [{ booking_id: testBookingId, booking_status: 'checked_in' }],
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'rooms') {
        return {
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      return {} as any;
    }) as any);

    const { IdVerificationSessionService } = require('../src/services/idVerificationSession.service');
    const sessionSpy = jest.spyOn(IdVerificationSessionService, 'getSession').mockResolvedValue({
      sessionId: 'approved-session-id',
      bookingId: testBookingId,
      status: 'authenticity_verified',
      overallOutcome: 'proceed',
      staffReview: {
        reviewedBy: 'STAFF-101',
        decision: 'approved',
      },
    });

    const outcome = await CheckInService.completeCheckIn({
      bookingId: testBookingId,
      sessionId: 'approved-session-id',
    });

    expect(outcome.success).toBe(true);
    expect(outcome.status).toBe('checkin_completed');

    bookingSpy.mockRestore();
    sessionSpy.mockRestore();
  });

  it('should roll back booking update if room status update fails', async () => {
    let revertCalled = false;

    const bookingSpy = jest.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      if (table === 'bookings') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: {
              booking_id: testBookingId,
              booking_status: 'confirmed',
              checked_out: false,
              room_id: 'room-uuid-1',
            },
            error: null,
          }),
          update: jest.fn().mockImplementation((payload) => {
            if (payload.booking_status === 'confirmed') {
              revertCalled = true;
            }
            return {
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  select: jest.fn().mockResolvedValue({
                    data: [{ booking_id: testBookingId, booking_status: 'checked_in' }],
                    error: null,
                  }),
                }),
              }),
            };
          }),
        };
      }
      if (table === 'rooms') {
        return {
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ error: { message: 'Room lock failed' } }),
          }),
        };
      }
      return {} as any;
    }) as any);

    const { IdVerificationSessionService } = require('../src/services/idVerificationSession.service');
    const sessionSpy = jest.spyOn(IdVerificationSessionService, 'getSession').mockResolvedValue({
      sessionId: 'valid-session-id',
      bookingId: testBookingId,
      status: 'authenticity_verified',
      overallOutcome: 'proceed',
    });

    const outcome = await CheckInService.completeCheckIn({
      bookingId: testBookingId,
      sessionId: 'valid-session-id',
    });

    expect(outcome.success).toBe(false);
    expect(outcome.status).toBe('booking_invalid');
    expect(outcome.message).toContain('Failed to allocate room. Check-in was safely rolled back.');
    expect(revertCalled).toBe(true);

    bookingSpy.mockRestore();
    sessionSpy.mockRestore();
  });

  it('should detect concurrent race condition when 0 rows are updated by optimistic lock', async () => {
    const bookingSpy = jest.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      if (table === 'bookings') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: {
              booking_id: testBookingId,
              booking_status: 'confirmed',
              checked_out: false,
              room_id: 'room-uuid-1',
            },
            error: null,
          }),
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                select: jest.fn().mockResolvedValue({
                  data: [], // 0 rows updated because another process updated it
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      return {} as any;
    }) as any);

    const { IdVerificationSessionService } = require('../src/services/idVerificationSession.service');
    const sessionSpy = jest.spyOn(IdVerificationSessionService, 'getSession').mockResolvedValue({
      sessionId: 'valid-session-id',
      bookingId: testBookingId,
      status: 'authenticity_verified',
      overallOutcome: 'proceed',
    });

    const outcome = await CheckInService.completeCheckIn({
      bookingId: testBookingId,
      sessionId: 'valid-session-id',
    });

    expect(outcome.success).toBe(false);
    expect(outcome.status).toBe('duplicate_checkin');
    expect(outcome.message).toContain('Concurrent check-in detected');

    bookingSpy.mockRestore();
    sessionSpy.mockRestore();
  });
});
