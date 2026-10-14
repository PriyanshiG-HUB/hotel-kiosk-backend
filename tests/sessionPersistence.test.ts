import fs from 'fs';
import path from 'path';
import { IdVerificationSessionService } from '../src/services/idVerificationSession.service';

describe('IdVerificationSessionService - Persistence & Orphan File Cleanup Across Server Restarts', () => {
  const storeFilePath = path.join(__dirname, '../uploads/sessions_store.json');
  const tempUploadDir = path.join(__dirname, '../uploads/temp');

  beforeAll(() => {
    if (!fs.existsSync(tempUploadDir)) {
      fs.mkdirSync(tempUploadDir, { recursive: true });
    }
  });

  it('should persist session to disk store and restore it across server restart', async () => {
    // 1. Create a session
    const session = await IdVerificationSessionService.createSession({
      selectedIdType: 'Passport',
      issuingCountry: 'United States',
      guestName: 'John Restart',
      consentGiven: true,
    });

    expect(session.sessionId).toBeDefined();

    // Verify session store file exists
    expect(fs.existsSync(storeFilePath)).toBe(true);

    // 2. Simulate server crash/restart: clear memory map completely
    (IdVerificationSessionService as any).sessions.clear();
    (IdVerificationSessionService as any).isInitialized = false;

    // 3. Reinitialize service (as happens on backend restart)
    const recovered = await IdVerificationSessionService.getSession(session.sessionId);

    expect(recovered).not.toBeNull();
    expect(recovered?.sessionId).toBe(session.sessionId);
    expect(recovered?.expectedGuestName).toBe('John Restart');
    expect(recovered?.persistenceStatus).toBe('persistent_file_store');
  });

  it('should clean up orphaned temporary files abandoned on disk during startup', async () => {
    // Create an artificial orphaned file with modified time older than 15 minutes
    const orphanFile = path.join(tempUploadDir, `id-orphan-test-${Date.now()}.jpg`);
    fs.writeFileSync(orphanFile, 'test-orphan-data');

    // Backdate file mtime to 30 minutes ago
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    fs.utimesSync(orphanFile, thirtyMinutesAgo, thirtyMinutesAgo);

    expect(fs.existsSync(orphanFile)).toBe(true);

    // Trigger orphan cleanup routine
    IdVerificationSessionService.cleanupOrphanedTemporaryFiles();

    // Verify orphaned file was safely removed
    expect(fs.existsSync(orphanFile)).toBe(false);
  });
});
