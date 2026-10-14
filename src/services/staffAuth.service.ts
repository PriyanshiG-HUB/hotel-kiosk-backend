import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { supabase } from '../config/supabase';

export interface StaffMember {
  staffId: string;
  staffCode: string;
  fullName: string;
  email: string;
  role: 'admin' | 'manager' | 'front_desk';
  department?: string;
  pinHash: string;
  isActive: boolean;
  failedAttempts: number;
  lockedUntil: string | null;
}

export interface StaffAuthResult {
  authenticated: boolean;
  staff?: StaffMember;
  error?: string;
  code?: 'invalid_staff_id' | 'account_inactive' | 'account_locked' | 'invalid_pin' | 'unauthorized_role';
}

export class StaffAuthService {
  private static readonly MAX_FAILED_ATTEMPTS = 5;
  private static readonly LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
  private static readonly STORE_FILE_PATH = path.join(__dirname, '../../uploads/staff_store.json');
  private static inMemoryStaff: Map<string, StaffMember> = new Map();
  private static isInitialized = false;

  public static initialize() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // Load from disk store if exists
    try {
      if (fs.existsSync(this.STORE_FILE_PATH)) {
        const raw = fs.readFileSync(this.STORE_FILE_PATH, 'utf-8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const s of list) {
            this.inMemoryStaff.set(s.staffCode.toUpperCase(), {
              staffId: s.staffId || `staff-${s.staffCode.toLowerCase()}`,
              staffCode: s.staffCode.toUpperCase(),
              fullName: s.fullName,
              email: s.email,
              role: s.role,
              department: s.department,
              pinHash: s.pinHash,
              isActive: s.isActive ?? true,
              failedAttempts: s.failedAttempts || 0,
              lockedUntil: s.lockedUntil || null,
            });
          }
        }
      }
    } catch (e) {
      console.warn('Could not read local staff store:', e);
    }
  }

  private static persistToDisk() {
    try {
      const list = Array.from(this.inMemoryStaff.values());
      const dir = path.dirname(this.STORE_FILE_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.STORE_FILE_PATH, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e) {
      console.warn('Failed to persist staff data to disk:', e);
    }
  }

  /**
   * Finds a staff member by code or UUID in Supabase, falling back to local store
   */
  public static async findStaff(staffIdentifier: string): Promise<StaffMember | null> {
    this.initialize();
    const cleanId = staffIdentifier.trim();
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanId);

    // 1. Check Supabase
    try {
      let query = supabase.from('staff').select('*');
      if (isUUID) {
        query = query.eq('staff_id', cleanId);
      } else {
        query = query.ilike('staff_code', cleanId);
      }

      const { data, error } = await query.single();
      if (!error && data) {
        return {
          staffId: data.staff_id,
          staffCode: data.staff_code,
          fullName: data.full_name,
          email: data.email,
          role: data.role,
          department: data.department,
          pinHash: data.pin_hash,
          isActive: data.is_active,
          failedAttempts: data.failed_attempts || 0,
          lockedUntil: data.locked_until || null,
        };
      }
    } catch (_) {
      // Supabase table may not exist yet
    }

    // 2. Check in-memory / local fallback store
    const upperCode = cleanId.toUpperCase();
    return this.inMemoryStaff.get(upperCode) || null;
  }

  /**
   * Authenticates a staff member with PIN, role check, and brute-force lockout
   */
  public static async authenticateStaff(
    staffIdentifier: string,
    pin: string,
    requiredRoles: Array<'admin' | 'manager' | 'front_desk'> = ['admin', 'manager', 'front_desk']
  ): Promise<StaffAuthResult> {
    this.initialize();

    if (!staffIdentifier || !pin) {
      return { authenticated: false, error: 'Staff ID and PIN are required.', code: 'invalid_staff_id' };
    }

    const staff = await this.findStaff(staffIdentifier);
    if (!staff) {
      return {
        authenticated: false,
        error: `Staff member "${staffIdentifier}" was not found in the authorized staff registry.`,
        code: 'invalid_staff_id',
      };
    }

    // Check if account is active
    if (!staff.isActive) {
      return {
        authenticated: false,
        error: `Staff account "${staff.staffCode}" is deactivated. Approval denied.`,
        code: 'account_inactive',
      };
    }

    // Check account lockout
    if (staff.lockedUntil) {
      const lockTime = new Date(staff.lockedUntil).getTime();
      const now = Date.now();
      if (now < lockTime) {
        const remainingMinutes = Math.ceil((lockTime - now) / 60000);
        return {
          authenticated: false,
          error: `Staff account is temporarily locked due to repeated failed attempts. Try again in ${remainingMinutes} minute(s).`,
          code: 'account_locked',
        };
      }
    }

    // Verify PIN with bcrypt
    const isPinValid = bcrypt.compareSync(pin, staff.pinHash);

    if (!isPinValid) {
      // Increment failed attempts
      const newFailedAttempts = (staff.failedAttempts || 0) + 1;
      let lockedUntil: string | null = null;

      if (newFailedAttempts >= this.MAX_FAILED_ATTEMPTS) {
        lockedUntil = new Date(Date.now() + this.LOCKOUT_DURATION_MS).toISOString();
      }

      await this.updateStaffSecurity(staff.staffCode, {
        failedAttempts: newFailedAttempts,
        lockedUntil,
      });

      return {
        authenticated: false,
        error: lockedUntil
          ? 'Too many failed authorization attempts. Account locked for 15 minutes.'
          : `Invalid staff security PIN. Attempt ${newFailedAttempts} of ${this.MAX_FAILED_ATTEMPTS}.`,
        code: 'invalid_pin',
      };
    }

    // Role authorization check
    if (!requiredRoles.includes(staff.role)) {
      return {
        authenticated: false,
        error: `Staff role "${staff.role}" is not authorized for physical document verification. Required roles: ${requiredRoles.join(', ')}.`,
        code: 'unauthorized_role',
      };
    }

    // Reset failed attempts upon successful login
    if (staff.failedAttempts > 0 || staff.lockedUntil) {
      await this.updateStaffSecurity(staff.staffCode, {
        failedAttempts: 0,
        lockedUntil: null,
      });
    }

    return {
      authenticated: true,
      staff,
    };
  }

  /**
   * Updates failed attempts and lockout status in Supabase and local store
   */
  private static async updateStaffSecurity(
    staffCode: string,
    updates: { failedAttempts: number; lockedUntil: string | null }
  ) {
    const upperCode = staffCode.toUpperCase();

    // Update in-memory
    const memStaff = this.inMemoryStaff.get(upperCode);
    if (memStaff) {
      memStaff.failedAttempts = updates.failedAttempts;
      memStaff.lockedUntil = updates.lockedUntil;
      this.persistToDisk();
    }

    // Update Supabase if table exists
    try {
      await supabase
        .from('staff')
        .update({
          failed_attempts: updates.failedAttempts,
          locked_until: updates.lockedUntil,
          updated_at: new Date().toISOString(),
        })
        .ilike('staff_code', staffCode);
    } catch (_) {}
  }
}
