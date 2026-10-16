import React, { useState } from 'react';
import { useAuth, DESIGNATED_SUPER_ADMIN_EMAIL } from '../context/AuthContext';

export const SuperAdminBootstrapBanner: React.FC = () => {
  const { user, role, bootstrapSuperAdmin, resendVerificationEmail } = useAuth();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!user || user.email?.toLowerCase() !== DESIGNATED_SUPER_ADMIN_EMAIL.toLowerCase()) {
    return null;
  }

  // If already super admin, banner does not show
  if (role === 'SUPER_ADMIN') {
    return null;
  }

  const handleBootstrap = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await bootstrapSuperAdmin();
      setMsg(res.message);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Bootstrap failed');
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
        <div className="w-10 h-10 rounded-full bg-[#f9c74f] text-[#1e1e1e] flex items-center justify-center font-bold text-lg border-2 border-[#1e1e1e]">
          <i className="fas fa-crown"></i>
        </div>
        <div>
          <div className="font-bold text-sm text-zinc-900">
            Cycle.exe Designated Owner Detected ({user.email})
          </div>
          <div className="text-xs text-zinc-700">
            {user.emailVerified
              ? 'Click below to securely bootstrap your permanent SUPER_ADMIN authority.'
              : 'Your email address must be verified before Super Admin authority can be activated.'}
          </div>
          {msg && <div className="text-xs font-bold text-emerald-700 mt-1">{msg}</div>}
          {error && <div className="text-xs font-bold text-red-700 mt-1">{error}</div>}
        </div>
      </div>

      <div className="flex items-center gap-2">
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
            )}
            Initialize Super Admin
          </button>
        )}
      </div>
    </div>
  );
};
