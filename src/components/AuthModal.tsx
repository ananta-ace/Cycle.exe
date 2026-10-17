import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const { signInWithGoogle, registerWithEmail, loginWithEmail } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [isUnauthorizedDomain, setIsUnauthorizedDomain] = useState(false);
  const [copiedDomain, setCopiedDomain] = useState(false);

  if (!isOpen) return null;

  const currentHostname = typeof window !== 'undefined' ? window.location.hostname : '';

  const handleCopyDomain = async () => {
    try {
      await navigator.clipboard.writeText(currentHostname);
      setCopiedDomain(true);
      setTimeout(() => setCopiedDomain(false), 2500);
    } catch {
      // Fallback
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setError(null);
      setIsUnauthorizedDomain(false);
      setLoading(true);
      await signInWithGoogle();
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('auth/unauthorized-domain')) {
        setIsUnauthorizedDomain(true);
        setError('This domain is not authorized in your Firebase Authentication settings.');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isRegister) {
        if (!displayName.trim()) throw new Error('Please enter a display name');
        if (password.length < 6) throw new Error('Password must be at least 6 characters');
        await registerWithEmail(email.trim(), password, displayName.trim());
      } else {
        await loginWithEmail(email.trim(), password);
      }
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="modal-overlay open"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal max-w-lg p-7 sm:p-9">
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          <i className="fas fa-times"></i>
        </button>

        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-[#1e1e1e] text-[#f9c74f] text-2xl border-2 border-[#1e1e1e] shadow-[0_4px_0_#d6d2ca] mb-3">
            <i className="fas fa-biking"></i>
          </div>
          <h2 className="text-2xl font-bold tracking-tight">
            {isRegister ? 'Join Cycle.exe Community' : 'Welcome Back Rider'}
          </h2>
          <p className="text-sm text-zinc-600 mt-1">
            {isRegister
              ? 'Create a public account to explore community rides and view missions.'
              : 'Sign in to access your profile, missions, and community feed.'}
          </p>
        </div>

        {isUnauthorizedDomain && (
          <div className="mb-4 p-3.5 bg-amber-50 border-2 border-amber-400 rounded-2xl text-xs text-amber-900 space-y-2.5">
            <div className="flex items-start gap-2">
              <i className="fas fa-shield-alt text-amber-600 text-sm mt-0.5"></i>
              <div>
                <p className="font-bold text-amber-950">Action Required: Authorize Domain in Firebase</p>
                <p className="mt-0.5 text-zinc-700 leading-relaxed">
                  Firebase blocks Google Sign-In on new domains until they are added to your project's Authorized Domains list.
                </p>
              </div>
            </div>

            <div className="bg-white p-2.5 rounded-xl border border-amber-300 flex items-center justify-between gap-2">
              <div className="overflow-hidden">
                <span className="text-[10px] uppercase font-bold text-zinc-500 block">Domain to authorize:</span>
                <code className="font-mono font-bold text-xs text-zinc-900 truncate block">
                  {currentHostname || 'ananta-ace.github.io'}
                </code>
              </div>
              <button
                type="button"
                onClick={handleCopyDomain}
                className="px-2.5 py-1.5 bg-[#f9c74f] hover:bg-[#e0b040] text-black font-bold text-xs rounded-lg transition-colors flex items-center gap-1.5 shrink-0 border border-black/20"
              >
                <i className={copiedDomain ? 'fas fa-check text-green-700' : 'fas fa-copy'}></i>
                <span>{copiedDomain ? 'Copied!' : 'Copy'}</span>
              </button>
            </div>

            <div className="text-[11px] text-zinc-700 space-y-1">
              <p className="font-bold text-zinc-900">How to fix in 1 minute:</p>
              <ol className="list-decimal list-inside space-y-0.5 pl-1 text-zinc-600">
                <li>
                  Open{' '}
                  <a
                    href="https://console.firebase.google.com/project/ai-studio-applet-webapp-9be29/authentication/settings"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-700 underline font-semibold"
                  >
                    Firebase Console &gt; Authentication &gt; Settings
                  </a>
                </li>
                <li>
                  Scroll to <strong>Authorized domains</strong> and click <strong>Add domain</strong>
                </li>
                <li>Paste the copied domain and click <strong>Save</strong></li>
              </ol>
            </div>

            <div className="pt-1 border-t border-amber-200 text-zinc-600 italic text-[11px]">
              💡 Tip: You can also register or sign in immediately using the Email &amp; Password form below!
            </div>
          </div>
        )}

        {error && !isUnauthorizedDomain && (
          <div className="mb-4 p-3 bg-red-50 border-2 border-red-500 rounded-2xl text-xs font-semibold text-red-700 flex items-start gap-2">
            <i className="fas fa-exclamation-circle text-sm mt-0.5"></i>
            <span>{error}</span>
          </div>
        )}

        {/* Google One-Click Login */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full btn-secondary py-2.5 mb-4 text-sm font-bold flex items-center justify-center gap-3"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          Continue with Google
        </button>

        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-zinc-300"></div>
          <span className="text-xs uppercase tracking-wider font-bold text-zinc-500">or with email</span>
          <div className="flex-1 h-px bg-zinc-300"></div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {isRegister && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-zinc-700">
                Display Name / Rider Handle
              </label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. SpeedDemon"
                className="neo-input text-sm py-2"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-zinc-700">
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="rider@example.com"
              className="neo-input text-sm py-2"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-zinc-700">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="neo-input text-sm py-2"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full btn-primary py-2.5 mt-2 text-sm font-bold flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <i className="fas fa-spinner fa-spin"></i> Processing...
              </>
            ) : isRegister ? (
              <>
                <i className="fas fa-user-plus"></i> Create Public Account
              </>
            ) : (
              <>
                <i className="fas fa-sign-in-alt"></i> Sign In
              </>
            )}
          </button>
        </form>

        <div className="mt-5 pt-3 border-t border-zinc-200 text-center">
          <button
            type="button"
            onClick={() => {
              setIsRegister(!isRegister);
              setError(null);
            }}
            className="text-xs font-bold text-zinc-700 hover:text-black underline underline-offset-2"
          >
            {isRegister
              ? 'Already registered? Sign in here'
              : "Don't have an account? Sign up as a Public User"}
          </button>
        </div>
      </div>
    </div>
  );
};
