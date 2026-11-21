import express, { type Request, type Response } from 'express';
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

function getArgValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  return eq ? eq.slice(flag.length + 1) : undefined;
}

const isProduction = process.env.NODE_ENV === 'production';
const cliPort = getArgValue('--port');
const cliHost = getArgValue('--host');
const app = express();
const PORT = cliPort
  ? parseInt(cliPort, 10)
  : !isProduction && process.env.DEFAULT_APP_PORT
    ? parseInt(process.env.DEFAULT_APP_PORT, 10)
    : process.env.PORT
      ? parseInt(process.env.PORT, 10)
      : 3000;
const HOST = cliHost || '0.0.0.0';

// -------------------------------------------------------------
const DESIGNATED_SUPER_ADMIN_EMAIL = 'ananta.base@gmail.com';
const AUTHORIZED_SUPER_ADMIN_EMAILS = [
  'ananta.base@gmail.com',
  'towhidulislamananta@gmail.com',
];

function isPermanentOwnerEmail(email?: string | null): boolean {
  if (!email) return false;
  return AUTHORIZED_SUPER_ADMIN_EMAILS.includes(email.toLowerCase().trim());
}

function isSuperAdminEmail(email?: string | null): boolean {
  return isPermanentOwnerEmail(email);
}

interface ActorAuthority {
  isPermanentOwner: boolean;
  isSuperAdmin: boolean;
  role: string;
  isSuspended: boolean;
}

async function resolveActorAuthority(
  uid?: string | null,
  email?: string | null
): Promise<ActorAuthority> {
  if (isPermanentOwnerEmail(email)) {
    return {
      isPermanentOwner: true,
      isSuperAdmin: true,
      role: 'SUPER_ADMIN',
      isSuspended: false,
    };
  }

  if (uid) {
    try {
      const snap = await serverGetDoc(serverDoc(serverDb, 'users', uid));
      if (snap.exists()) {
        const data = snap.data() || {};
        const dbRole = typeof data.role === 'string' ? data.role : 'PUBLIC';
        const isSuspended = data.isSuspended === true;
        return {
          isPermanentOwner: false,
          isSuperAdmin: dbRole === 'SUPER_ADMIN' && !isSuspended,
          role: dbRole,
          isSuspended,
        };
      }
    } catch (err) {
      console.warn('[Cycle.exe Server] Failed to verify actor authority from Firestore:', err);
    }
  }

  return {
    isPermanentOwner: false,
    isSuperAdmin: false,
    role: 'PUBLIC',
    isSuspended: false,
  };
}

// Initialize trusted server-side Firestore connection
const firebaseConfig = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'firebase-applet-config.json'), 'utf8')
);
const serverApp =
  getApps().find((a) => a.name === 'CYCLE_SERVER_ADMIN') ||
  initServerFirebase(firebaseConfig, 'CYCLE_SERVER_ADMIN');
const serverDb = initServerFirestore(serverApp, firebaseConfig.firestoreDatabaseId);

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Serve uploaded images statically
const uploadsDir = path.resolve(process.cwd(), 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// Serve downloadable desktop executables directly with attachment headers
const downloadsDir = path.resolve(process.cwd(), 'public', 'downloads');
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}
app.use(
  '/downloads',
  express.static(downloadsDir, {
    setHeaders: (res, filePath) => {
      if (filePath.toLowerCase().endsWith('.exe')) {
        res.setHeader('Content-Type', 'application/vnd.microsoft.portable-executable');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${path.basename(filePath)}"`
        );
      }
    },
  })
);

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

// Trusted server-side bootstrap of an authorized Super Admin
async function ensureSuperAdminConfigured(targetUid?: string, targetEmail?: string) {
  if (!targetUid || !targetEmail || !isSuperAdminEmail(targetEmail)) {
    return;
  }
  const uid = targetUid;
  const email = targetEmail.toLowerCase().trim();
  try {
    const userDocRef = serverDoc(serverDb, 'users', uid);
    const snap = await serverGetDoc(userDocRef);

    if (!snap.exists() || snap.data()?.role !== 'SUPER_ADMIN') {
      const superAdminData = {
        id: uid,
        email: email,
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
        serverDoc(serverDb, 'users', uid, 'private', 'info'),
        {
          email: email,
          emailVerified: true,
          lastLoginAt: new Date().toISOString(),
          loginCount: 1,
        },
        { merge: true }
      );

      addAuditLog(
        uid,
        email,
        'SERVER_BOOTSTRAP_SUPER_ADMIN',
        'USER',
        uid,
        `Trusted server-side initialization of Super Admin account for UID [${uid}]`
      );

      console.log(`[Cycle.exe Server] Super Admin successfully configured for UID: ${uid}`);
    } else {
      console.log(`[Cycle.exe Server] Super Admin verified in Cloud Firestore for UID: ${uid}`);
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
app.get('/api/admin/verify-super-admin', async (req: Request, res: Response) => {
  const { uid, email } = getAuthFromReq(req);
  const authority = await resolveActorAuthority(uid, email);

  return res.json({
    configured: true,
    status: authority.isPermanentOwner
      ? 'CONFIRMED_PERMANENT_OWNER'
      : authority.isSuperAdmin
        ? 'CONFIRMED_APPOINTED_SUPER_ADMIN'
        : 'ALLOWLIST_AND_APPOINTMENT_ENFORCED',
    authorizedSuperAdmins: AUTHORIZED_SUPER_ADMIN_EMAILS,
    email: email || DESIGNATED_SUPER_ADMIN_EMAIL,
    uid: uid || null,
    isPermanentOwner: authority.isPermanentOwner,
    isSuperAdmin: authority.isSuperAdmin,
    role: authority.isSuperAdmin ? 'SUPER_ADMIN' : authority.role,
    verifiedAt: new Date().toISOString(),
    details:
      'Permanent Owners (ananta.base@gmail.com and towhidulislamananta@gmail.com) hold highest authority and can appoint or remove Super Admins.',
  });
});

// 1. Super Admin Bootstrap
app.post('/api/bootstrap-super-admin', async (req: Request, res: Response) => {
  const { uid, email, verified } = getAuthFromReq(req);

  if (!uid || !email) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!isSuperAdminEmail(email)) {
    return res.status(403).json({
      error: 'Forbidden: Only authorized owner accounts can hold the Super Admin role',
    });
  }

  if (!verified) {
    return res.status(403).json({
      error: 'Email verification required before Super Admin bootstrap',
    });
  }

  // Ensure database record is updated via trusted server process
  await ensureSuperAdminConfigured(uid, email);

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
    superAdminUid: uid,
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
app.post('/api/session/heartbeat', async (req: Request, res: Response) => {
  const { uid, email, role } = getAuthFromReq(req);
  const visitorId = (req.body?.visitorId as string) || (req.headers['x-visitor-id'] as string) || '';
  const sessionId = uid || visitorId || `guest_${req.ip.replace(/[^a-zA-Z0-9]/g, '_')}`;

  const authority = await resolveActorAuthority(uid, email);

  activeSessions.set(sessionId, {
    sessionId,
    userId: uid || undefined,
    email: email || (uid ? 'Registered Rider' : 'Guest Visitor'),
    role: authority.isSuperAdmin ? 'SUPER_ADMIN' : uid ? (authority.role || role) : 'PUBLIC_GUEST',
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
app.get('/api/admin/stats', async (req: Request, res: Response) => {
  const { uid, email } = getAuthFromReq(req);
  const authority = await resolveActorAuthority(uid, email);

  if (!authority.isSuperAdmin) {
    return res.status(403).json({
      error: 'Forbidden: Only Super Admins can view private statistics and active sessions',
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
app.post('/api/invitations/generate', async (req: Request, res: Response) => {
  const { uid, email } = getAuthFromReq(req);
  const authority = await resolveActorAuthority(uid, email);

  if (!authority.isSuperAdmin) {
    return res.status(403).json({
      error: 'Forbidden: Only Super Admins can generate invitation codes',
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
app.get('/api/invitations', async (req: Request, res: Response) => {
  const { uid, email } = getAuthFromReq(req);
  const authority = await resolveActorAuthority(uid, email);

  if (!authority.isSuperAdmin) {
    return res.status(403).json({
      error: 'Forbidden: Only Super Admins can view invitation codes',
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
app.post('/api/invitations/revoke', async (req: Request, res: Response) => {
  const { uid, email } = getAuthFromReq(req);
  const { codeId } = req.body;
  const authority = await resolveActorAuthority(uid, email);

  if (!authority.isSuperAdmin) {
    return res.status(403).json({
      error: 'Forbidden: Only Super Admins can revoke invitation codes',
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
app.post('/api/invitations/update-limit', async (req: Request, res: Response) => {
  const { uid, email } = getAuthFromReq(req);
  const { limit } = req.body;
  const authority = await resolveActorAuthority(uid, email);

  if (!authority.isSuperAdmin) {
    return res.status(403).json({
      error: 'Forbidden: Only Super Admins can configure member slot limits',
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
        ...(targetRole === 'ADMIN'
          ? { isAdminMember: true, adminMembershipStatus: 'APPROVED' }
          : {}),
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

// 9. Super Admin Role Management (Permanent Owners can appoint/remove Super Admins; Super Admins can appoint others)
app.post('/api/admin/roles', async (req: Request, res: Response) => {
  const { uid, email } = getAuthFromReq(req);
  const { targetUserId, targetUserEmail, action, newRole, isSuspended } = req.body;

  const authority = await resolveActorAuthority(uid, email);

  if (!authority.isSuperAdmin) {
    return res.status(403).json({
      error: 'Forbidden: Only Super Admins or Permanent Owners can manage roles or suspend accounts',
    });
  }

  if (!targetUserId || typeof targetUserId !== 'string') {
    return res.status(400).json({ error: 'Target user ID required' });
  }

  const allowedRoles = ['PUBLIC', 'MEMBER', 'ADMIN', 'SUPER_ADMIN'];
  if (newRole !== undefined && !allowedRoles.includes(newRole)) {
    return res.status(400).json({ error: 'Invalid target role specified' });
  }

  let resolvedTargetEmail = (targetUserEmail || '').toString().toLowerCase().trim();
  let resolvedTargetRole = '';
  try {
    const targetSnap = await serverGetDoc(serverDoc(serverDb, 'users', targetUserId));
    if (targetSnap.exists()) {
      const targetData = targetSnap.data() || {};
      if (typeof targetData.email === 'string' && targetData.email) {
        resolvedTargetEmail = targetData.email.toLowerCase().trim();
      }
      if (typeof targetData.role === 'string') {
        resolvedTargetRole = targetData.role;
      }
    }
  } catch (err) {
    console.warn('[Cycle.exe Server] Could not inspect target user before role change:', err);
  }

  if (isPermanentOwnerEmail(resolvedTargetEmail)) {
    return res.status(403).json({ error: 'Permanent Owner account cannot be modified or demoted' });
  }

  const targetIsSuperAdmin = resolvedTargetRole === 'SUPER_ADMIN';
  if (targetIsSuperAdmin && !authority.isPermanentOwner) {
    return res.status(403).json({
      error: 'Forbidden: Only the Permanent Owner can demote, modify, or suspend an existing Super Admin',
    });
  }

  if (targetUserId === uid && !authority.isPermanentOwner) {
    return res.status(403).json({
      error: 'Forbidden: Only the Permanent Owner can modify a Super Admin clearance',
    });
  }

  addAuditLog(
    uid,
    email,
    action || (newRole === 'SUPER_ADMIN' ? 'PROMOTE_TO_SUPER_ADMIN' : 'MODIFY_USER_ROLE'),
    'USER',
    targetUserId,
    `Updated role to ${newRole || 'unchanged'}, isSuspended: ${isSuspended ?? 'unchanged'} for ${resolvedTargetEmail || targetUserId}`
  );

  return res.json({
    success: true,
    message: `Account updated successfully`,
    targetUserId,
    newRole,
    isSuspended,
  });
});

// 9.5 Delete User Account Audit & Session Purge (SUPER ADMIN ONLY; Permanent Owner required to delete another SUPER_ADMIN)
app.post('/api/admin/delete-user', async (req: Request, res: Response) => {
  const { uid, email } = getAuthFromReq(req);
  const { targetUserId, targetUserEmail, targetUserName } = req.body;

  const authority = await resolveActorAuthority(uid, email);

  if (!authority.isSuperAdmin) {
    return res.status(403).json({
      error: 'Forbidden: Only Super Admins can delete user accounts',
    });
  }

  if (!targetUserId || typeof targetUserId !== 'string') {
    return res.status(400).json({ error: 'Target user ID is required' });
  }

  let resolvedTargetEmail = (targetUserEmail || '').toString().toLowerCase().trim();
  let resolvedTargetRole = '';
  try {
    const targetSnap = await serverGetDoc(serverDoc(serverDb, 'users', targetUserId));
    if (targetSnap.exists()) {
      const targetData = targetSnap.data() || {};
      if (typeof targetData.email === 'string' && targetData.email) {
        resolvedTargetEmail = targetData.email.toLowerCase().trim();
      }
      if (typeof targetData.role === 'string') {
        resolvedTargetRole = targetData.role;
      }
    }
  } catch (err) {
    console.warn('[Cycle.exe Server] Could not inspect target user before deletion:', err);
  }

  if (targetUserId === uid || isPermanentOwnerEmail(resolvedTargetEmail)) {
    return res.status(400).json({ error: 'Permanent Owner or active self accounts cannot be deleted' });
  }

  if (resolvedTargetRole === 'SUPER_ADMIN' && !authority.isPermanentOwner) {
    return res.status(403).json({
      error: 'Forbidden: Only the Permanent Owner can delete an appointed Super Admin account',
    });
  }

  // Terminate any active heartbeat session for the deleted user
  activeSessions.delete(targetUserId);

  addAuditLog(
    uid,
    email,
    'DELETE_USER_ACCOUNT',
    'USER',
    targetUserId,
    `Permanently deleted account for ${targetUserName || resolvedTargetEmail || targetUserId} (${resolvedTargetEmail || 'no email'})`
  );

  return res.json({
    success: true,
    deletedUserId: targetUserId,
    message: 'User account deletion recorded and active session terminated',
  });
});

// 10. Send Direct Custom Notice to User (SUPER ADMIN ONLY)
app.post('/api/admin/send-notice', async (req: Request, res: Response) => {
  const { uid, email } = getAuthFromReq(req);
  const { recipientId, title, message, isUrgent } = req.body;

  const authority = await resolveActorAuthority(uid, email);

  if (!authority.isSuperAdmin) {
    return res.status(403).json({
      error: 'Forbidden: Only Super Admins can send direct custom notices to users',
    });
  }

  if (!recipientId || typeof recipientId !== 'string') {
    return res.status(400).json({ error: 'Recipient user ID is required' });
  }

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Message content cannot be empty' });
  }

  try {
    // Look up recipient user info
    let recipientName = 'Rider';
    let recipientEmail = '';
    try {
      const userSnap = await serverGetDoc(serverDoc(serverDb, 'users', recipientId));
      if (userSnap.exists()) {
        const udata = userSnap.data();
        recipientName = udata.displayName || 'Rider';
        recipientEmail = udata.email || '';
      }
    } catch (e) {
      console.warn('[Cycle.exe Server] Could not fetch user data for notice:', e);
    }

    const noticeId = `notice_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const now = new Date().toISOString();

    const noticeDoc = {
      id: noticeId,
      recipientId,
      recipientName,
      recipientEmail,
      senderId: uid || 'super-admin',
      senderName: 'Super Admin (Owner)',
      senderEmail: email || DESIGNATED_SUPER_ADMIN_EMAIL,
      senderRole: 'SUPER_ADMIN',
      type: 'DIRECT_NOTICE',
      isDirectNotice: true,
      title: (title || 'Official Notice from Super Admin').trim().substring(0, 120),
      message: message.trim().substring(0, 2000),
      isUrgent: !!isUrgent,
      deliveryStatus: 'DELIVERED',
      deliveredAt: now,
      isRead: false,
      readAt: null,
      replies: [],
      replyCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    await serverSetDoc(serverDoc(serverDb, 'notifications', noticeId), noticeDoc);

    addAuditLog(
      uid,
      email,
      'SEND_DIRECT_NOTICE',
      'USER',
      recipientId,
      `Sent direct notice "${noticeDoc.title}" to ${recipientName} (${recipientEmail || recipientId})`
    );

    return res.json({
      success: true,
      noticeId,
      notice: noticeDoc,
      message: `Notice successfully delivered to ${recipientName}`,
    });
  } catch (err) {
    console.error('[Cycle.exe Server] Error sending notice:', err);
    return res.status(500).json({
      error: 'Failed to send notice',
      details: err instanceof Error ? err.message : String(err),
    });
  }
});

// 11. Reply to Notice (Recipient User or Super Admin)
app.post('/api/notices/reply', async (req: Request, res: Response) => {
  const { uid, email, role } = getAuthFromReq(req);
  const { noticeId, text } = req.body;

  if (!uid || !email) {
    return res.status(401).json({ error: 'Authentication required to reply to notice' });
  }

  if (!noticeId || typeof noticeId !== 'string') {
    return res.status(400).json({ error: 'Notice ID is required' });
  }

  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Reply text cannot be empty' });
  }

  try {
    const noticeRef = serverDoc(serverDb, 'notifications', noticeId);
    const snap = await serverGetDoc(noticeRef);

    if (!snap.exists()) {
      return res.status(404).json({ error: 'Notice not found' });
    }

    const data = snap.data();
    const isRecipient = data.recipientId === uid;
    const authority = await resolveActorAuthority(uid, email);
    const isSuper = authority.isSuperAdmin;

    if (!isRecipient && !isSuper) {
      return res.status(403).json({
        error: 'Forbidden: You are not authorized to reply to this notice',
      });
    }

    // Get sender display name
    let senderName = authority.isPermanentOwner
      ? 'Super Admin (Owner)'
      : isSuper
        ? 'Super Admin'
        : 'Rider';
    try {
      const userSnap = await serverGetDoc(serverDoc(serverDb, 'users', uid));
      if (userSnap.exists()) {
        senderName = userSnap.data().displayName || senderName;
      }
    } catch {}

    const now = new Date().toISOString();
    const newReply = {
      id: `rep_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
      senderId: uid,
      senderName,
      senderEmail: email,
      senderRole: isSuper ? 'SUPER_ADMIN' : authority.role || role,
      text: text.trim().substring(0, 1000),
      createdAt: now,
    };

    const existingReplies = Array.isArray(data.replies) ? data.replies : [];
    const updatedReplies = [...existingReplies, newReply];

    await serverSetDoc(
      noticeRef,
      {
        replies: updatedReplies,
        replyCount: updatedReplies.length,
        lastRepliedAt: now,
        hasNewReply: true,
        updatedAt: now,
      },
      { merge: true }
    );

    // If user replied, notify Super Admin
    if (!isSuper) {
      const notifId = `notif_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
      await serverSetDoc(
        serverDoc(serverDb, 'notifications', notifId),
        {
          id: notifId,
          recipientId: 'SUPER_ADMIN',
          type: 'SYSTEM',
          title: `💬 Reply from ${senderName}`,
          message: `Re: "${data.title || 'Notice'}": ${newReply.text.substring(0, 140)}`,
          link: noticeId,
          isRead: false,
          createdAt: now,
        },
        { merge: true }
      );
    }

    return res.json({
      success: true,
      reply: newReply,
      message: 'Reply sent successfully',
    });
  } catch (err) {
    console.error('[Cycle.exe Server] Error replying to notice:', err);
    return res.status(500).json({
      error: 'Failed to send reply',
      details: err instanceof Error ? err.message : String(err),
    });
  }
});

// 12. Mark Notice as Read & Update Delivery Status
app.post('/api/notices/mark-read', async (req: Request, res: Response) => {
  const { uid, email } = getAuthFromReq(req);
  const { noticeId } = req.body;

  if (!uid) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!noticeId || typeof noticeId !== 'string') {
    return res.status(400).json({ error: 'Notice ID is required' });
  }

  try {
    const noticeRef = serverDoc(serverDb, 'notifications', noticeId);
    const snap = await serverGetDoc(noticeRef);

    if (!snap.exists()) {
      return res.status(404).json({ error: 'Notice not found' });
    }

    const data = snap.data();
    const authority = await resolveActorAuthority(uid, email);
    if (data.recipientId !== uid && !authority.isSuperAdmin) {
      return res.status(403).json({ error: 'Unauthorized to mark this notice as read' });
    }

    const now = new Date().toISOString();
    await serverSetDoc(
      noticeRef,
      {
        isRead: true,
        readAt: data.readAt || now,
        deliveryStatus: 'READ',
        updatedAt: now,
      },
      { merge: true }
    );

    return res.json({
      success: true,
      readAt: data.readAt || now,
      deliveryStatus: 'READ',
    });
  } catch (err) {
    console.error('[Cycle.exe Server] Error marking notice read:', err);
    return res.status(500).json({
      error: 'Failed to update read status',
      details: err instanceof Error ? err.message : String(err),
    });
  }
});

// -------------------------------------------------------------
// Vite Dev Server / Static File Serving
// -------------------------------------------------------------
async function startServer() {
  app.use('/api', (_req: Request, res: Response) => {
    return res.status(404).json({ error: 'API endpoint not found' });
  });

  const distPath = path.resolve(process.cwd(), 'dist');
  const distIndexPath = path.join(distPath, 'index.html');

  if (!isProduction || !fs.existsSync(distIndexPath)) {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);

    // Explicit fallback for SPA routes in dev mode (Express 5 compatible)
    app.use(async (req: Request, res: Response, next) => {
      const url = req.originalUrl;
      if (url.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
      }
      if (req.path !== '/' && path.extname(req.path) && path.extname(req.path) !== '.html') {
        return next();
      }
      try {
        let template = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    app.use(express.static(distPath));
    app.use((req: Request, res: Response, next) => {
      if (req.originalUrl.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
      }
      if (req.path !== '/' && path.extname(req.path) && path.extname(req.path) !== '.html') {
        return next();
      }
      res.sendFile(distIndexPath);
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`Cycle.exe 2.0 full-stack server running on http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
