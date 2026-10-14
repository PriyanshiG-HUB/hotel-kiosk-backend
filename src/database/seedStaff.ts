import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { supabase } from '../config/supabase';

dotenv.config();

export interface SeedStaffAccount {
  staffCode: string;
  fullName: string;
  email: string;
  role: 'admin' | 'manager' | 'front_desk';
  department: string;
  pin: string; // Plaintext for display in seed log ONLY, never committed to production DB
  pinHash: string;
  isActive: boolean;
}

export const DEMO_STAFF_ACCOUNTS: SeedStaffAccount[] = [
  {
    staffCode: 'STAFF-101',
    fullName: 'Demo Front Desk Staff',
    email: 'staff101@hotelkiosk.internal',
    role: 'front_desk',
    department: 'Front Desk',
    pin: '1234',
    pinHash: bcrypt.hashSync('1234', 10),
    isActive: true,
  },
  {
    staffCode: 'STAFF-102',
    fullName: 'Demo Front Desk Supervisor',
    email: 'staff102@hotelkiosk.internal',
    role: 'manager',
    department: 'Guest Services',
    pin: '5678',
    pinHash: bcrypt.hashSync('5678', 10),
    isActive: true,
  },
  {
    staffCode: 'STAFF-103',
    fullName: 'Demo Administrator',
    email: 'staff103@hotelkiosk.internal',
    role: 'admin',
    department: 'Management',
    pin: '9999',
    pinHash: bcrypt.hashSync('9999', 10),
    isActive: true,
  },
];

export async function seedStaff() {
  console.log('--- Seeding Demo Staff Accounts ---');

  // 1. Ensure local fallback store directory exists
  const fallbackPath = path.join(__dirname, '../../uploads/staff_store.json');
  const dir = path.dirname(fallbackPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 2. Write to local fallback store for development reliability
  try {
    fs.writeFileSync(
      fallbackPath,
      JSON.stringify(
        DEMO_STAFF_ACCOUNTS.map((s) => ({
          staffCode: s.staffCode,
          fullName: s.fullName,
          email: s.email,
          role: s.role,
          department: s.department,
          pinHash: s.pinHash,
          isActive: s.isActive,
          failedAttempts: 0,
          lockedUntil: null,
        })),
        null,
        2
      ),
      'utf-8'
    );
    console.log(`[LOCAL STORE] Saved ${DEMO_STAFF_ACCOUNTS.length} demo staff records to: ${fallbackPath}`);
  } catch (err: any) {
    console.warn('[LOCAL STORE WARNING] Could not save local staff fallback store:', err.message);
  }

  // 3. Attempt to seed into Supabase PostgreSQL database
  try {
    for (const member of DEMO_STAFF_ACCOUNTS) {
      const { data, error } = await supabase
        .from('staff')
        .upsert(
          {
            staff_code: member.staffCode,
            full_name: member.fullName,
            email: member.email,
            role: member.role,
            department: member.department,
            pin_hash: member.pinHash,
            is_active: member.isActive,
            failed_attempts: 0,
            locked_until: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'staff_code' }
        )
        .select();

      if (error) {
        if (error.code === 'PGRST205' || error.message?.includes('not find the table')) {
          console.warn(
            `\n[DATABASE NOTICE] Table "public.staff" does not yet exist in Supabase.` +
              `\nPlease run migration "src/database/migrations/20261014_staff_and_id_verification.sql" ` +
              `in the Supabase Dashboard SQL Editor (https://app.supabase.com/project/_/sql).\n`
          );
          break;
        } else {
          console.error(`[DATABASE ERROR] Failed to seed ${member.staffCode}:`, error.message);
        }
      } else {
        console.log(`[SUPABASE] Successfully seeded staff account: ${member.staffCode} (${member.fullName})`);
      }
    }
  } catch (err: any) {
    console.warn('[DATABASE WARNING] Supabase connection error during staff seed:', err.message);
  }

  console.log('\n--- Demo Staff Credentials (Development Only) ---');
  DEMO_STAFF_ACCOUNTS.forEach((s) => {
    console.log(`Staff ID: ${s.staffCode} | Name: ${s.fullName} | Role: ${s.role} | PIN: ${s.pin}`);
  });
  console.log('--------------------------------------------------\n');
}

if (require.main === module) {
  seedStaff()
    .then(() => {
      process.exitCode = 0;
    })
    .catch((err) => {
      console.error('Staff seed failed:', err);
      process.exitCode = 1;
    });
}
