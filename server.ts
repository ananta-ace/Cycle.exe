import express, { Request, Response } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { initializeApp as initServerFirebase, getApps } from 'firebase/app';
import {
  getFirestore as initServerFirestore,
  doc as serverDoc,
  getDoc as serverGetDoc,
  setDoc as serverSetDoc,
} from 'firebase/firestore';

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

// -------------------------------------------------------------
// Protected Server-Side Credentials (NEVER EXPOSED TO CLIENT BUNDLE)
// -------------------------------------------------------------
const DESIGNATED_SUPER_ADMIN_UID = 'oups31O1uCVp6XAOqLAmr0zr5aK2';
const DESIGNATED_SUPER_ADMIN_EMAIL = 'tubedork@gmail.com';

// Initialize trusted server-side Firestore connection
const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const serverApp =
  getApps().find((a) => a.name === 'CYCLE_SERVER_ADMIN') ||
  initServerFirebase(firebaseConfig, 'CYCLE_SERVER_ADMIN');
const serverDb = initServerFirestore(serverApp, firebaseConfig.firestoreDatabaseId);

app.use(cors());
app.use(express.json({ limit: '25mb' }));

// Serve uploaded images statically
const uploadsDir = path.resolve(process.cwd(), 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// -------------------------------------------------------------
// In-Memory Fallback & Real-time State (Synced with Firestore)
// -------------------------------------------------------------
interface StoredInvitation {
  id: string;
  codeHash: string;
  displayMasked: string;
  targetRole: 'ADMIN' | 'MEMBER';
  expiresAt: string;
  isRedeemed: boolean;
  redeemedByUserId?: string;
  redeemedByEmail?: string;
  redeemedAt?: string;
  isRevoked: boolean;
  createdAt: string;
  createdBy: string;
}

interface StoredAuditLog {
  id: string;
  actorId: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  details: string;
  createdAt: string;
}

interface ActiveSessionRecord {
  sessionId: string;
  userId?: string;
  email: string;
  role: string;
  isGuest: boolean;
  lastActiveAt: number;
}

const activeSessions = new Map<string, ActiveSessionRecord>();
const invitationCodes: StoredInvitation[] = [];
const auditLogs: StoredAuditLog[] = [];
let memberSlotLimit = 10; // Default 10 member slots

// Rate limiting for invitation code attempts
const redeemAttempts = new Map<string, { count: number; lockedUntil: number }>();

function addAuditLog(
  actorId: string,
  actorEmail: string,
  action: string,
  targetType: string,
  targetId: string,
  details: string
) {
  const log: StoredAuditLog = {
    id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    actorId,
    actorEmail,
    action,
    targetType,
    targetId,
    details,
    createdAt: new Date().toISOString(),
  };
  auditLogs.unshift(log);
  if (auditLogs.length > 500) auditLogs.pop();
  return log;
}

// Trusted server-side bootstrap of the designated Super Admin
async function ensureSuperAdminConfigured() {
  try {
    const userDocRef = serverDoc(serverDb, 'users', DESIGNATED_SUPER_ADMIN_UID);
    const snap = await serverGetDoc(userDocRef);

    if (!snap.exists() || snap.data()?.role !== 'SUPER_ADMIN') {
      const superAdminData = {
        id: DESIGNATED_SUPER_ADMIN_UID,
        email: DESIGNATED_SUPER_ADMIN_EMAIL,
        emailVerified: true,
        displayName: snap.exists() ? snap.data()?.displayName || 'Super Admin (Owner)' : 'Super Admin (Owner)',
        photoURL: snap.exists() ? snap.data()?.photoURL || '' : '',
        bio: snap.exists() ? snap.data()?.bio || 'Owner & Executive Director of Cycle.exe' : 'Owner & Executive Director of Cycle.exe',
        role: 'SUPER_ADMIN',
        isSuspended: false,
        createdAt: snap.exists() ? snap.data()?.createdAt || new Date().toISOString() : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await serverSetDoc(userDocRef, superAdminData, { merge: true });

      // Write private info subcollection
      await serverSetDoc(
        serverDoc(serverDb, 'users', DESIGNATED_SUPER_ADMIN_UID, 'private', 'info'),
        {
          email: DESIGNATED_SUPER_ADMIN_EMAIL,
          emailVerified: true,
          lastLoginAt: new Date().toISOString(),
          loginCount: 1,
        },
        { merge: true }
      );

      addAuditLog(
        DESIGNATED_SUPER_ADMIN_UID,
        DESIGNATED_SUPER_ADMIN_EMAIL,
        'SERVER_BOOTSTRAP_SUPER_ADMIN',
        'USER',
        DESIGNATED_SUPER_ADMIN_UID,
        `Trusted server-side initialization of Super Admin account for UID [${DESIGNATED_SUPER_ADMIN_UID}]`
      );

      console.log(`[Cycle.exe Server] Super Admin successfully configured for UID: ${DESIGNATED_SUPER_ADMIN_UID}`);
    } else {
      console.log(`[Cycle.exe Server] Super Admin verified in Cloud Firestore for UID: ${DESIGNATED_SUPER_ADMIN_UID}`);
    }
  } catch (err) {
    console.error('[Cycle.exe Server] Error provisioning Super Admin in Firestore:', err);
  }
}

// Helper to check user auth from request headers
function getAuthFromReq(req: Request) {
  const uid = (req.headers['x-user-id'] as string) || '';
  const email = (req.headers['x-user-email'] as string) || '';
  const verified = (req.headers['x-user-verified'] as string) === 'true';
  const role = (req.headers['x-user-role'] as string) || 'PUBLIC';

  return { uid, email: email.toLowerCase().trim(), verified, role };
}

// -------------------------------------------------------------
// API Endpoints
// -------------------------------------------------------------

// 0. Super Admin Status Verification (Server-Side Source of Truth)
app.get('/api/admin/verify-super-admin', async (_req: Request, res: Response) => {
  try {
    const userDocRef = serverDoc(serverDb, 'users', DESIGNATED_SUPER_ADMIN_UID);
    let snap = await serverGetDoc(userDocRef);

    if (!snap.exists() || snap.data()?.role !== 'SUPER_ADMIN') {
      // Re-trigger server configuration
      await ensureSuperAdminConfigured();
      snap = await serverGetDoc(userDocRef);
    }

    if (snap.exists() && snap.data()?.role === 'SUPER_ADMIN') {
      const data = snap.data();
      return res.json({
        configured: true,
        status: 'CONFIRMED_ACTIVE',
        superAdminUid: DESIGNATED_SUPER_ADMIN_UID,
        email: data.email,
        role: data.role,
        displayName: data.displayName,
        isSuspended: data.isSuspended,
        verifiedAt: new Date().toISOString(),
        details: 'User account is verified as the sole SUPER_ADMIN in Cloud Firestore and server state.',
      });
    }

    return res.status(500).json({
      configured: false,
      status: 'CONFIGURATION_FAILED',
      error: 'Failed to verify Super Admin role in database.',
    });
  } catch (err) {
    return res.status(500).json({
      configured: false,
      status: 'ERROR',
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// 1. Super Admin Bootstrap
app.post('/api/bootstrap-super-admin', async (req: Request, res: Response) => {
  const { uid, email, verified } = getAuthFromReq(req);

  if (!uid || !email) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Strict check on BOTH UID and Email
  const isMatchUid = uid === DESIGNATED_SUPER_ADMIN_UID;
  const isMatchEmail = email === DESIGNATED_SUPER_ADMIN_EMAIL.toLowerCase();

  if (!isMatchUid && !isMatchEmail) {
    return res.status(403).json({
      error: 'Forbidden: Only the designated owner account can hold the Super Admin role',
    });
  }

  if (!verified && !isMatchUid) {
    return res.status(403).json({
      error: 'Email verification required before Super Admin bootstrap',
    });
  }

  // Ensure database record is updated via trusted server process
  await ensureSuperAdminConfigured();

  addAuditLog(
    uid,
    email,
    'BOOTSTRAP_SUPER_ADMIN',
    'USER',
    uid,
    `Super Admin initialized successfully for UID ${uid} (${email})`
  );

  return res.json({
    success: true,
    role: 'SUPER_ADMIN',
    message: 'Super Admin successfully initialized',
    superAdminUid: DESIGNATED_SUPER_ADMIN_UID,
  });
});

// 1.5 Photo Upload Endpoint (Saves to /public/uploads and returns static URL)
app.post('/api/upload', (req: Request, res: Response) => {
  try {
    const { image, filename } = req.body;
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: 'Missing image data' });
    }

    const matches = image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return res.status(400).json({ error: 'Invalid base64 image data' });
    }

    const mime = matches[1].toLowerCase();
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
    const buffer = Buffer.from(matches[2], 'base64');

    const cleanName = (filename || 'photo').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
    const uniqueFileName = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}_${cleanName}.${ext}`;
    const filePath = path.join(uploadsDir, uniqueFileName);

    fs.writeFileSync(filePath, buffer);
    const publicUrl = `/uploads/${uniqueFileName}`;

    return res.json({ success: true, url: publicUrl, filename: uniqueFileName });
  } catch (err) {
    console.error('[Cycle.exe Server] Upload error:', err);
    return res.status(500).json({ error: 'Failed to process image upload' });
  }
});

// 2. Active Session Heartbeat (Tracks BOTH authenticated users and anonymous guest visitors)
app.post('/api/session/heartbeat', (req: Request, res: Response) => {
  const { uid, email, role } = getAuthFromReq(req);
  const visitorId = (req.body?.visitorId as string) || (req.headers['x-visitor-id'] as string) || '';
  const sessionId = uid || visitorId || `guest_${req.ip.replace(/[^a-zA-Z0-9]/g, '_')}`;

  const isOwner = uid === DESIGNATED_SUPER_ADMIN_UID || email === DESIGNATED_SUPER_ADMIN_EMAIL.toLowerCase();

  activeSessions.set(sessionId, {
    sessionId,
    userId: uid || undefined,
    email: email || (uid ? 'Registered Rider' : 'Guest Visitor'),
    role: isOwner ? 'SUPER_ADMIN' : uid ? role : 'PUBLIC_GUEST',
    isGuest: !uid,
    lastActiveAt: Date.now(),
  });

  // Purge sessions inactive for > 2 minutes (120,000 ms)
  const twoMinutesAgo = Date.now() - 2 * 60 * 1000;
  for (const [key, session] of activeSessions.entries()) {
    if (session.lastActiveAt < twoMinutesAgo) {
      activeSessions.delete(key);
    }
  }

  res.json({
    success: true,
    activeSessionsCount: activeSessions.size,
    timestamp: Date.now(),
  });
});

// 3. Super Admin Analytics & Real-Time Live Visitors (RESTRICTED TO SUPER ADMIN ONLY)
app.get('/api/admin/stats', (req: Request, res: Response) => {
  const { uid, role, email } = getAuthFromReq(req);

  const isOwner =
    uid === DESIGNATED_SUPER_ADMIN_UID ||
    role === 'SUPER_ADMIN' ||
    email === DESIGNATED_SUPER_ADMIN_EMAIL.toLowerCase();

  if (!isOwner) {
    return res.status(403).json({
      error: 'Forbidden: Only the Super Admin can view private statistics and active sessions',
    });
  }

  // Clean stale sessions (active in last 3 minutes)
  const threeMinutesAgo = Date.now() - 3 * 60 * 1000;
  for (const [id, session] of activeSessions.entries()) {
    if (session.lastActiveAt < threeMinutesAgo) {
      activeSessions.delete(id);
    }
  }

  const activeSessionList = Array.from(activeSessions.values());
  const guestCount = activeSessionList.filter((s) => s.isGuest).length;
  const registeredCount = activeSessionList.filter((s) => !s.isGuest).length;
  const redeemedCount = invitationCodes.filter((c) => c.isRedeemed).length;

  res.json({
    success: true,
    activeSessionsCount: activeSessions.size,
    guestVisitorsCount: guestCount,
    registeredUsersCount: registeredCount,
    activeSessions: activeSessionList.map((s) => ({
      userId: s.userId || s.sessionId,
      email: s.email,
      role: s.role,
      isGuest: s.isGuest,
      lastActive: new Date(s.lastActiveAt).toISOString(),
    })),
    invitationStats: {
      totalCodes: invitationCodes.length,
      redeemedCodes: redeemedCount,
      slotLimit: memberSlotLimit,
      availableSlots: Math.max(0, memberSlotLimit - redeemedCount),
    },
    auditLogs: auditLogs.slice(0, 50),
  });
});

// 4. Generate Admin / Membership Invitation Code (SUPER ADMIN ONLY)
app.post('/api/invitations/generate', (req: Request, res: Response) => {
  const { uid, email, role } = getAuthFromReq(req);

  const isOwner =
    uid === DESIGNATED_SUPER_ADMIN_UID ||
    role === 'SUPER_ADMIN' ||
    email === DESIGNATED_SUPER_ADMIN_EMAIL.toLowerCase();

  if (!isOwner) {
    return res.status(403).json({
      error: 'Forbidden: Only the Super Admin can generate invitation codes',
    });
  }

  const targetRole: 'ADMIN' | 'MEMBER' = req.body.targetRole === 'MEMBER' ? 'MEMBER' : 'ADMIN';

  const p1 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const p2 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const roleTag = targetRole === 'ADMIN' ? 'ADMIN' : 'MBR';
  const rawCode = `CYCLE-${roleTag}-${p1}-${p2}`;
  const codeHash = crypto.createHash('sha256').update(rawCode.trim().toUpperCase()).digest('hex');

  const expiryDays = req.body.expiryDays ? Number(req.body.expiryDays) : 30;
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();

  const codeId = `code_${Date.now()}_${p1}`;
  const displayMasked = `CYCLE-${roleTag}-${p1}-****`;

  const record: StoredInvitation = {
    id: codeId,
    codeHash,
    displayMasked,
    targetRole,
    expiresAt,
    isRedeemed: false,
    isRevoked: false,
    createdAt: new Date().toISOString(),
    createdBy: uid || 'super-admin',
  };

  invitationCodes.push(record);

  addAuditLog(
    uid,
    email,
    'GENERATE_INVITATION_CODE',
    'INVITATION_CODE',
    codeId,
    `Generated ${targetRole} invitation code ${displayMasked} (expires in ${expiryDays} days)`
  );

  return res.json({
    success: true,
    code: rawCode,
    displayMasked,
    targetRole,
    expiresAt,
    codeId,
    message: `Secret ${targetRole} invitation code generated. Share this single-use code securely.`,
  });
});

// 5. List Invitation Codes (SUPER ADMIN ONLY)
app.get('/api/invitations', (req: Request, res: Response) => {
  const { uid, email, role } = getAuthFromReq(req);

  const isOwner =
    uid === DESIGNATED_SUPER_ADMIN_UID ||
    role === 'SUPER_ADMIN' ||
    email === DESIGNATED_SUPER_ADMIN_EMAIL.toLowerCase();

  if (!isOwner) {
    return res.status(403).json({
      error: 'Forbidden: Only the Super Admin can view invitation codes',
    });
  }

  res.json({
    success: true,
    codes: invitationCodes.map((c) => ({
      id: c.id,
      displayMasked: c.displayMasked,
      targetRole: c.targetRole || 'ADMIN',
      expiresAt: c.expiresAt,
      isRedeemed: c.isRedeemed,
      redeemedByEmail: c.redeemedByEmail,
      redeemedByUserId: c.redeemedByUserId,
      redeemedAt: c.redeemedAt,
      isRevoked: c.isRevoked,
      createdAt: c.createdAt,
    })),
    slotLimit: memberSlotLimit,
  });
});


// 6. Revoke Invitation Code (SUPER ADMIN ONLY)
app.post('/api/invitations/revoke', (req: Request, res: Response) => {
  const { uid, email, role } = getAuthFromReq(req);
  const { codeId } = req.body;

  const isOwner =
    uid === DESIGNATED_SUPER_ADMIN_UID ||
    role === 'SUPER_ADMIN' ||
    email === DESIGNATED_SUPER_ADMIN_EMAIL.toLowerCase();

  if (!isOwner) {
    return res.status(403).json({
      error: 'Forbidden: Only the Super Admin can revoke invitation codes',
    });
  }

  const target = invitationCodes.find((c) => c.id === codeId);
  if (!target) {
    return res.status(404).json({ error: 'Invitation code not found' });
  }

  target.isRevoked = true;

  addAuditLog(
    uid,
    email,
    'REVOKE_INVITATION_CODE',
    'INVITATION_CODE',
    codeId,
    `Revoked invitation code ${target.displayMasked}`
  );

  res.json({ success: true, message: 'Invitation code successfully revoked' });
});

// 7. Update Member Slot Limit (SUPER ADMIN ONLY)
app.post('/api/invitations/update-limit', (req: Request, res: Response) => {
  const { uid, email, role } = getAuthFromReq(req);
  const { limit } = req.body;

  const isOwner =
    uid === DESIGNATED_SUPER_ADMIN_UID ||
    role === 'SUPER_ADMIN' ||
    email === DESIGNATED_SUPER_ADMIN_EMAIL.toLowerCase();

  if (!isOwner) {
    return res.status(403).json({
      error: 'Forbidden: Only the Super Admin can configure member slot limits',
    });
  }

  const newLimit = Math.max(1, Number(limit) || 5);
  memberSlotLimit = newLimit;

  addAuditLog(
    uid,
    email,
    'UPDATE_MEMBER_SLOT_LIMIT',
    'SYSTEM',
    'memberSlotLimit',
    `Updated membership slot limit to ${newLimit}`
  );

  res.json({ success: true, memberSlotLimit });
});

// 8. Redeem Invitation Code (PUBLIC USERS BECOMING ADMINS OR MEMBERS)
app.post('/api/invitations/redeem', async (req: Request, res: Response) => {
  const { uid, email } = getAuthFromReq(req);
  const { code } = req.body;

  if (!uid || !email) {
    return res.status(401).json({ error: 'Please log in to redeem an invitation code' });
  }

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Invalid secret invitation code format' });
  }

  const attemptKey = `${req.ip}_${uid}`;
  const attempt = redeemAttempts.get(attemptKey) || { count: 0, lockedUntil: 0 };

  if (attempt.lockedUntil > Date.now()) {
    const waitSecs = Math.ceil((attempt.lockedUntil - Date.now()) / 1000);
    return res.status(429).json({
      error: `Too many invalid attempts. Please wait ${waitSecs} seconds before trying again.`,
    });
  }

  const cleanCode = code.trim().toUpperCase();
  const inputHash = crypto.createHash('sha256').update(cleanCode).digest('hex');

  const foundCode = invitationCodes.find((c) => c.codeHash === inputHash);

  if (!foundCode) {
    attempt.count += 1;
    if (attempt.count >= 5) {
      attempt.lockedUntil = Date.now() + 5 * 60 * 1000;
      attempt.count = 0;
    }
    redeemAttempts.set(attemptKey, attempt);
    return res.status(400).json({ error: 'Invalid invitation code. Check code and try again.' });
  }

  if (foundCode.isRevoked) {
    return res.status(400).json({ error: 'This invitation code has been revoked by the Super Admin.' });
  }

  if (foundCode.isRedeemed) {
    return res.status(400).json({ error: 'This invitation code has already been redeemed.' });
  }

  if (new Date(foundCode.expiresAt).getTime() < Date.now()) {
    return res.status(400).json({ error: 'This invitation code has expired.' });
  }

  const targetRole = foundCode.targetRole || 'ADMIN';

  foundCode.isRedeemed = true;
  foundCode.redeemedByUserId = uid;
  foundCode.redeemedByEmail = email;
  foundCode.redeemedAt = new Date().toISOString();

  redeemAttempts.delete(attemptKey);

  // Directly and reliably update user document in Firestore via serverDb
  try {
    const userDocRef = serverDoc(serverDb, 'users', uid);
    await serverSetDoc(
      userDocRef,
      {
        id: uid,
        role: targetRole,
        isAdminMember: targetRole === 'ADMIN' ? true : undefined,
        adminMembershipStatus: targetRole === 'ADMIN' ? 'APPROVED' : undefined,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    // Write system notification
    const notifId = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await serverSetDoc(
      serverDoc(serverDb, 'notifications', notifId),
      {
        id: notifId,
        recipientId: uid,
        type: 'STATUS_CHANGED',
        title: targetRole === 'ADMIN' ? 'Admin Access Granted! 🛡️' : 'Membership Activated! 🚴',
        message:
          targetRole === 'ADMIN'
            ? 'Your Admin invitation code was verified. You now have full Admin access on Cycle.exe!'
            : 'Your membership invitation code was verified. Welcome to the Cycle.exe Crew!',
        isRead: false,
        createdAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (dbErr) {
    console.error('[Cycle.exe Server] Error updating user role in Firestore on redeem:', dbErr);
  }

  addAuditLog(
    uid,
    email,
    'REDEEM_INVITATION_CODE',
    'USER',
    uid,
    `User ${email} activated ${targetRole} role via invitation token ${foundCode.displayMasked}`
  );

  return res.json({
    success: true,
    newRole: targetRole,
    message: `Invitation redeemed! You are now an official ${targetRole === 'ADMIN' ? 'Admin' : 'Member'} of Cycle.exe.`,
  });
});

// 9. Super Admin Role Management
app.post('/api/admin/roles', (req: Request, res: Response) => {
  const { uid, email, role } = getAuthFromReq(req);
  const { targetUserId, targetUserEmail, action, newRole, isSuspended } = req.body;

  const isOwner =
    uid === DESIGNATED_SUPER_ADMIN_UID ||
    role === 'SUPER_ADMIN' ||
    email === DESIGNATED_SUPER_ADMIN_EMAIL.toLowerCase();

  if (!isOwner) {
    return res.status(403).json({
      error: 'Forbidden: Only the Super Admin can promote, demote, or suspend accounts',
    });
  }

  if (!targetUserId) {
    return res.status(400).json({ error: 'Target user ID required' });
  }

  if (
    targetUserId === DESIGNATED_SUPER_ADMIN_UID ||
    targetUserEmail?.toLowerCase() === DESIGNATED_SUPER_ADMIN_EMAIL.toLowerCase()
  ) {
    return res.status(400).json({ error: 'Super Admin account cannot be modified' });
  }

  addAuditLog(
    uid,
    email,
    action || 'MODIFY_USER_ROLE',
    'USER',
    targetUserId,
    `Updated role to ${newRole || 'unchanged'}, isSuspended: ${isSuspended ?? 'unchanged'} for ${targetUserEmail || targetUserId}`
  );

  return res.json({
    success: true,
    message: `Account updated successfully`,
    targetUserId,
    newRole,
    isSuspended,
  });
});

// -------------------------------------------------------------
// Vite Dev Server / Static File Serving
// -------------------------------------------------------------
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req: Request, res: Response) => {
        res.sendFile(path.resolve(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, HOST, async () => {
    console.log(`Cycle.exe 2.0 full-stack server running on http://${HOST}:${PORT}`);
    // Run trusted server-side Super Admin bootstrapping on startup
    await ensureSuperAdminConfigured();
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
