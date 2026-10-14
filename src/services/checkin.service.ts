import { supabase } from '../config/supabase';
import { CheckInCompleteDto } from '../types/idVerification.types';
import { IdVerificationSessionService } from './idVerificationSession.service';

export interface CheckInOutcome {
  success: boolean;
  status:
    | 'checkin_completed'
    | 'already_checked_in'
    | 'duplicate_checkin'
    | 'booking_invalid'
    | 'booking_already_completed'
    | 'verification_required'
    | 'checkin_in_progress';
  message: string;
  booking?: any;
}

export class CheckInService {
  // In-flight concurrency lock to prevent parallel race conditions
  private static activeLocks: Set<string> = new Set();

  /**
   * Performs concurrency-safe, atomic check-in completion for a verified reservation.
   */
  public static async completeCheckIn(dto: CheckInCompleteDto): Promise<CheckInOutcome> {
    const { bookingId, sessionId } = dto;

    if (!bookingId) {
      return {
        success: false,
        status: 'booking_invalid',
        message: 'Valid Booking ID is required for check-in.',
      };
    }

    // 1. Check in-flight lock for this booking
    if (this.activeLocks.has(bookingId)) {
      return {
        success: false,
        status: 'checkin_in_progress',
        message: 'A check-in operation is currently in progress for this reservation. Please wait.',
      };
    }

    // Acquire lock
    this.activeLocks.add(bookingId);

    try {
      // 2. Fetch booking from Supabase
      const { data: booking, error: bookingErr } = await supabase
        .from('bookings')
        .select(`
          *,
          guests (
            guest_id,
            full_name,
            mobile,
            email,
            nationality,
            id_type,
            id_number
          ),
          rooms (
            room_id,
            room_number,
            room_type,
            price_per_night
          )
        `)
        .eq('booking_id', bookingId)
        .single();

      if (bookingErr || !booking) {
        return {
          success: false,
          status: 'booking_invalid',
          message: 'Reservation not found in the hotel system.',
        };
      }

      // 3. Duplicate Check-in Prevention (Authoritative DB Check)
      if (booking.checked_out || booking.booking_status === 'completed') {
        return {
          success: false,
          status: 'booking_already_completed',
          message: 'This reservation has already been completed and checked out.',
        };
      }

      if (booking.booking_status === 'checked_in') {
        return {
          success: false,
          status: 'already_checked_in',
          message: 'This reservation has already been checked in. Please contact the front desk if you require assistance.',
          booking,
        };
      }

      if (booking.booking_status !== 'confirmed') {
        return {
          success: false,
          status: 'booking_invalid',
          message: `Reservation status is '${booking.booking_status}'. Only confirmed reservations are eligible for check-in.`,
        };
      }

      // 4. Strict Identity Verification Session Gating
      if (!sessionId) {
        return {
          success: false,
          status: 'verification_required',
          message: 'Valid identity verification session is required before check-in can be completed.',
        };
      }

      const session = await IdVerificationSessionService.getSession(sessionId);
      if (!session) {
        return {
          success: false,
          status: 'verification_required',
          message: 'Verification session has expired or does not exist. Please restart ID verification.',
        };
      }

      if (session.bookingId && session.bookingId !== bookingId) {
        return {
          success: false,
          status: 'verification_required',
          message: 'Verification session does not match this reservation.',
        };
      }

      if (session.overallOutcome === 'rejected' || session.status === 'authenticity_failed' || session.status === 'expired_document') {
        return {
          success: false,
          status: 'verification_required',
          message: 'ID verification was rejected or failed. Check-in cannot proceed.',
        };
      }

      if (session.status === 'pending_manual_review' || session.overallOutcome === 'staff_review_required') {
        // Must have an approved staff review to proceed
        if (!session.staffReview || session.staffReview.decision !== 'approved') {
          return {
            success: false,
            status: 'verification_required',
            message: 'Document authenticity requires staff authorization. A staff member must inspect and approve the physical document before check-in can proceed.',
          };
        }
      }

      if (session.overallOutcome !== 'proceed' && session.status !== 'authenticity_verified') {
        return {
          success: false,
          status: 'verification_required',
          message: 'Document authenticity has not been confirmed. Check-in cannot proceed.',
        };
      }

      // 5. Database-Backed Atomic Check-In Operation
      // Attempt 1: Call PostgreSQL stored procedure if migration is active
      try {
        const { data: rpcData, error: rpcErr } = await supabase.rpc('complete_check_in_atomic', {
          p_booking_id: bookingId,
          p_session_id: sessionId,
        });

        if (!rpcErr && rpcData) {
          if (!rpcData.success) {
            return {
              success: false,
              status: rpcData.status || 'duplicate_checkin',
              message: rpcData.message || 'Check-in failed in database.',
            };
          }
          booking.booking_status = 'checked_in';
          return {
            success: true,
            status: 'checkin_completed',
            message: 'Check-in completed successfully via atomic database transaction.',
            booking,
          };
        }
      } catch (_) {
        // Fall back to database conditional update if RPC is not yet created in Supabase schema
      }

      // Attempt 2: Direct Database-level Optimistic Locking
      // Atomically updates only if booking_status is still 'confirmed'
      const { data: updateData, error: updateErr } = await supabase
        .from('bookings')
        .update({
          booking_status: 'checked_in',
        })
        .eq('booking_id', bookingId)
        .eq('booking_status', 'confirmed')
        .select();

      if (updateErr) {
        return {
          success: false,
          status: 'duplicate_checkin',
          message: 'Failed to complete check-in update in database.',
        };
      }

      if (!updateData || updateData.length === 0) {
        // Concurrent transaction updated this booking first
        return {
          success: false,
          status: 'duplicate_checkin',
          message: 'Concurrent check-in detected. This reservation was already checked in by another session.',
        };
      }

      // Atomically update room occupancy with compensation rollback on error
      if (booking.room_id) {
        const { error: roomErr } = await supabase
          .from('rooms')
          .update({
            status: 'occupied',
          })
          .eq('room_id', booking.room_id);

        if (roomErr) {
          // Compensate: Revert booking status to confirmed to prevent inconsistent state
          await supabase
            .from('bookings')
            .update({
              booking_status: 'confirmed',
            })
            .eq('booking_id', bookingId);

          return {
            success: false,
            status: 'booking_invalid',
            message: 'Failed to allocate room. Check-in was safely rolled back.',
          };
        }
      }

      // Return refreshed booking data
      booking.booking_status = 'checked_in';
      return {
        success: true,
        status: 'checkin_completed',
        message: 'Check-in completed successfully.',
        booking,
      };
    } finally {
      // Always release in-flight lock
      this.activeLocks.delete(bookingId);
    }
  }

  /**
   * Validates if a reservation is eligible for check-in before starting ID verification
   */
  public static async validateBookingEligibility(bookingId: string) {
    const { data: booking, error } = await supabase
      .from('bookings')
      .select('booking_id, booking_status, checked_out, check_in, check_out, guest_id')
      .eq('booking_id', bookingId)
      .single();

    if (error || !booking) {
      return {
        isValid: false,
        checkInStatus: 'not_checked_in' as const,
        message: 'Reservation not found.',
      };
    }

    if (booking.checked_out || booking.booking_status === 'completed') {
      return {
        isValid: false,
        checkInStatus: 'already_checked_out' as const,
        message: 'Reservation already completed.',
      };
    }

    if (booking.booking_status === 'checked_in') {
      return {
        isValid: false,
        checkInStatus: 'checked_in' as const,
        message: 'Guest has already checked in for this reservation.',
      };
    }

    return {
      isValid: true,
      checkInStatus: 'not_checked_in' as const,
      message: 'Reservation is valid and eligible for check-in.',
    };
  }
}
