-- ============================================================================
-- Migration: 20261014_staff_and_id_verification.sql
-- Description: Creates staff authentication table, enhanced id_verifications table,
--              RLS policies, atomic check-in transaction function, and idempotent
--              seed records for authorized development staff members.
-- Execution: Run this script in the Supabase Dashboard SQL Editor
--            (https://app.supabase.com/project/_/sql)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Create Staff Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff (
    staff_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_code VARCHAR(50) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'manager', 'front_desk')),
    department VARCHAR(100) DEFAULT 'Front Desk',
    property_id UUID NULL,
    pin_hash VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for staff lookups
CREATE INDEX IF NOT EXISTS idx_staff_staff_code ON public.staff(staff_code);
CREATE INDEX IF NOT EXISTS idx_staff_is_active ON public.staff(is_active);

-- ----------------------------------------------------------------------------
-- 2. Create or Update ID Verifications Audit Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.id_verifications (
    session_id UUID PRIMARY KEY,
    booking_id UUID REFERENCES public.bookings(booking_id) ON DELETE SET NULL,
    guest_id UUID REFERENCES public.guests(guest_id) ON DELETE SET NULL,
    id_type VARCHAR(50) NOT NULL,
    issuing_country VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'not_started',
    extracted_name VARCHAR(255),
    document_masked VARCHAR(50),
    date_of_birth DATE,
    expiration_date DATE,
    extraction_quality NUMERIC(5, 2),
    extracted_fields_json JSONB,
    authenticity_status VARCHAR(50),
    overall_outcome VARCHAR(50) DEFAULT 'in_progress',
    consent_obtained BOOLEAN DEFAULT false,
    reviewed_by VARCHAR(100),
    reviewed_by_staff_id UUID REFERENCES public.staff(staff_id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    staff_notes TEXT,
    physical_id_inspected BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add any columns that might be missing if table was previously created with fewer columns
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='id_verifications' AND column_name='reviewed_by_staff_id') THEN
        ALTER TABLE public.id_verifications ADD COLUMN reviewed_by_staff_id UUID REFERENCES public.staff(staff_id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='id_verifications' AND column_name='physical_id_inspected') THEN
        ALTER TABLE public.id_verifications ADD COLUMN physical_id_inspected BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='id_verifications' AND column_name='date_of_birth') THEN
        ALTER TABLE public.id_verifications ADD COLUMN date_of_birth DATE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='id_verifications' AND column_name='expiration_date') THEN
        ALTER TABLE public.id_verifications ADD COLUMN expiration_date DATE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='id_verifications' AND column_name='extraction_quality') THEN
        ALTER TABLE public.id_verifications ADD COLUMN extraction_quality NUMERIC(5, 2);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='id_verifications' AND column_name='extracted_fields_json') THEN
        ALTER TABLE public.id_verifications ADD COLUMN extracted_fields_json JSONB;
    END IF;
END $$;

-- Indexes for efficient lookup
CREATE INDEX IF NOT EXISTS idx_id_verifications_booking_id ON public.id_verifications(booking_id);
CREATE INDEX IF NOT EXISTS idx_id_verifications_guest_id ON public.id_verifications(guest_id);
CREATE INDEX IF NOT EXISTS idx_id_verifications_staff_id ON public.id_verifications(reviewed_by_staff_id);
CREATE INDEX IF NOT EXISTS idx_id_verifications_created_at ON public.id_verifications(created_at);

-- ----------------------------------------------------------------------------
-- 3. Row Level Security (RLS) Configuration
-- ----------------------------------------------------------------------------
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.id_verifications ENABLE ROW LEVEL SECURITY;

-- Allow service role full access to staff and id_verifications
DROP POLICY IF EXISTS "Service role has full access to staff" ON public.staff;
CREATE POLICY "Service role has full access to staff"
    ON public.staff
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Service role has full access to id_verifications" ON public.id_verifications;
CREATE POLICY "Service role has full access to id_verifications"
    ON public.id_verifications
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- 4. Atomic Concurrency-Safe Check-in Function
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 5. Seed Demo Staff Members (Idempotent)
-- ----------------------------------------------------------------------------
-- Demo Staff Accounts for Development / Testing:
-- STAFF-101: Demo Front Desk Staff (PIN: 1234)
-- STAFF-102: Demo Front Desk Supervisor (PIN: 5678)
-- STAFF-103: Demo Administrator (PIN: 9999)
-- PINs are hashed using bcrypt with salt rounds = 10
INSERT INTO public.staff (
    staff_code,
    full_name,
    email,
    role,
    department,
    pin_hash,
    is_active
) VALUES
(
    'STAFF-101',
    'Demo Front Desk Staff',
    'staff101@hotelkiosk.internal',
    'front_desk',
    'Front Desk',
    '$2b$10$7VmkUNWYlYKbYOs1HinrzuJJtOSsopt7FtUA4CEdWaDCgwbz3qy4K',
    true
),
(
    'STAFF-102',
    'Demo Front Desk Supervisor',
    'staff102@hotelkiosk.internal',
    'manager',
    'Guest Services',
    '$2b$10$qbPKyNnaf7ZoQ3yFyYRVnOCzZBBSwDeJIJOpKA6o6v6LMbrVLfXLq',
    true
),
(
    'STAFF-103',
    'Demo Administrator',
    'staff103@hotelkiosk.internal',
    'admin',
    'Management',
    '$2b$10$Bfybheeeq3rzG/q3dCknPem7XAWHfB70TLM3PZk8ph5.tSXrXVxQS',
    true
)
ON CONFLICT (staff_code) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    role = EXCLUDED.role,
    department = EXCLUDED.department,
    pin_hash = EXCLUDED.pin_hash,
    is_active = EXCLUDED.is_active,
    failed_attempts = 0,
    locked_until = NULL,
    updated_at = NOW();
