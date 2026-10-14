-- Migration: 20261013_id_verification_and_checkin.sql
-- Run this script in the Supabase Dashboard SQL Editor (https://app.supabase.com/project/_/sql)
-- Adds ID verification audit table, indexes, and atomic check-in transaction function.

-- 1. Create id_verifications table for audit trail
CREATE TABLE IF NOT EXISTS public.id_verifications (
    session_id UUID PRIMARY KEY,
    booking_id UUID REFERENCES public.bookings(booking_id) ON DELETE SET NULL,
    guest_id UUID REFERENCES public.guests(guest_id) ON DELETE SET NULL,
    id_type VARCHAR(50) NOT NULL,
    issuing_country VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'not_started',
    extracted_name VARCHAR(255),
    document_masked VARCHAR(50),
    authenticity_status VARCHAR(50),
    overall_outcome VARCHAR(50) DEFAULT 'in_progress',
    consent_obtained BOOLEAN DEFAULT false,
    reviewed_by VARCHAR(100),
    reviewed_at TIMESTAMPTZ,
    staff_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Indexes for efficient lookup
CREATE INDEX IF NOT EXISTS idx_id_verifications_booking_id ON public.id_verifications(booking_id);
CREATE INDEX IF NOT EXISTS idx_id_verifications_guest_id ON public.id_verifications(guest_id);
CREATE INDEX IF NOT EXISTS idx_id_verifications_created_at ON public.id_verifications(created_at);

-- 3. PostgreSQL Stored Procedure for Concurrency-Safe Atomic Check-In
-- Acquires row-level write locks (FOR UPDATE) on both booking and room rows.
-- Ensures bookings.booking_status and rooms.status update atomically together or rollback.
CREATE OR REPLACE FUNCTION public.complete_check_in_atomic(
    p_booking_id UUID,
    p_session_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_booking RECORD;
BEGIN
    -- 1. Acquire exclusive row lock on the booking row
    SELECT * INTO v_booking
    FROM public.bookings
    WHERE booking_id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'status', 'booking_invalid',
            'message', 'Reservation not found in the hotel database.'
        );
    END IF;

    -- Check if booking is already checked out or completed
    IF v_booking.checked_out = true OR v_booking.booking_status = 'completed' THEN
        RETURN jsonb_build_object(
            'success', false,
            'status', 'booking_already_completed',
            'message', 'This reservation has already been completed and checked out.'
        );
    END IF;

    -- Check if booking was already checked in
    IF v_booking.booking_status = 'checked_in' THEN
        RETURN jsonb_build_object(
            'success', false,
            'status', 'already_checked_in',
            'message', 'This reservation has already been checked in. Duplicate check-in blocked.'
        );
    END IF;

    -- Check eligibility: must be in confirmed status
    IF v_booking.booking_status <> 'confirmed' THEN
        RETURN jsonb_build_object(
            'success', false,
            'status', 'booking_invalid',
            'message', format('Reservation status is "%s". Only confirmed reservations are eligible for check-in.', v_booking.booking_status)
        );
    END IF;

    -- 2. Update booking status
    UPDATE public.bookings
    SET booking_status = 'checked_in'
    WHERE booking_id = p_booking_id;

    -- 3. Atomically update allocated room status to occupied
    IF v_booking.room_id IS NOT NULL THEN
        UPDATE public.rooms
        SET status = 'occupied'
        WHERE room_id = v_booking.room_id;
    END IF;

    -- 4. Audit verification link if session ID provided
    IF p_session_id IS NOT NULL THEN
        UPDATE public.id_verifications
        SET booking_id = p_booking_id,
            updated_at = NOW()
        WHERE session_id = p_session_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'status', 'checkin_completed',
        'message', 'Check-in completed successfully.'
    );
END;
$$;
