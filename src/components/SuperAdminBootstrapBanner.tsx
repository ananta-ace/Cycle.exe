import React, { useState } from 'react';
import { useAuth, isSuperAdminEmail } from '../context/AuthContext';

export const SuperAdminBootstrapBanner: React.FC = () => {
  const { user, profile, firestoreSuperAdminSynced, bootstrapSuperAdmin, syncSuperAdminAccess, resendVerificationEmail } = useAuth();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!user || !isSuperAdminEmail(user.email)) {
    return null;
  }

  // Only hide banner once email is verified AND Firestore DB role is synced to SUPER_ADMIN
  if (user.emailVerified && firestoreSuperAdminSynced) {
    return null;
  }

  const handleBootstrap = async () => {
    try {
      setLoading(true);
      setError(null);
      setMsg(null);
      const syncRes = await syncSuperAdminAccess();
      if (syncRes.synced) {
        setMsg(syncRes.message);
        return;
      }
      const res = await bootstrapSuperAdmin();
      setMsg(res.message);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : 'Bootstrap failed';
      setError(
        `Database role is currently "${profile?.role || 'PUBLIC'}" (${detail}). Sign in once as towhidulislamananta@gmail.com to auto-grant database SUPER_ADMIN clearance to ${user.email}, or publish firestore.rules in Firebase Console.`
      );
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      setLoading(true);
      await resendVerificationEmail();
      setMsg('Verification email sent! Check your inbox, click the link, and refresh this page.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send verification email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="banner-alert mb-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-[#f9c74f] text-[#1e1e1e] flex items-center justify-center font-bold text-lg border-2 border-[#1e1e1e] shrink-0">
          <i className="fas fa-crown"></i>
        </div>
        <div>
          <div className="font-bold text-sm text-zinc-900">
            Super Admin Database Clearance Sync Needed ({user.email})
          </div>
          <div className="text-xs text-zinc-700">
            {!user.emailVerified
              ? 'Your email address must be verified before Super Admin authority can be activated.'
              : `Your Firestore record currently has role "${profile?.role || 'PUBLIC'}". Sign in once with towhidulislamananta@gmail.com to auto-sync "${user.email}" to SUPER_ADMIN in the database, or click Initialize / Retry Sync if firestore.rules is published.`}
          </div>
          {msg && <div className="text-xs font-bold text-emerald-700 mt-1">{msg}</div>}
          {error && <div className="text-xs font-bold text-red-700 mt-1">{error}</div>}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {!user.emailVerified ? (
          <button
            type="button"
            onClick={handleResend}
            disabled={loading}
            className="btn-primary text-xs py-2 px-4"
          >
            <i className="fas fa-envelope"></i> Resend Verification
          </button>
        ) : (
          <button
            type="button"
            onClick={handleBootstrap}
            disabled={loading}
            className="btn-primary btn-accent text-xs py-2 px-4 font-bold"
          >
            {loading ? (
              <i className="fas fa-spinner fa-spin"></i>
            ) : (
              <i className="fas fa-key"></i>
            )}{' '}
            Activate Super Admin
          </button>
        )}
      </div>
    </div>
  );
};
