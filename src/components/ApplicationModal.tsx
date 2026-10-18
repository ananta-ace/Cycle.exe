import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, addDoc, collection } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { AdminMembershipApplication } from '../types';

interface ApplicationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenAuth: () => void;
}

export const ApplicationModal: React.FC<ApplicationModalProps> = ({
  isOpen,
  onClose,
  onOpenAuth,
}) => {
  const { user, profile } = useAuth();

  const [reason, setReason] = useState('');
  const [experience, setExperience] = useState('');
  const [requestedTitle, setRequestedTitle] = useState('Cycling Enthusiast');
  const [existingApp, setExistingApp] = useState<AdminMembershipApplication | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Suggested community titles
  const suggestedTitles = [
    'Cycling Enthusiast',
    'Road Warrior',
    'Chill Guy',
    'Dhesh Dhesh',
    'Lover',
    'Peloton Pacer',
    'Climb Hunter',
    'Weekend Cruiser',
  ];

  useEffect(() => {
    if (!isOpen || !user) return;

    const checkExisting = async () => {
      try {
        setLoading(true);
        setError(null);
        const snap = await getDoc(doc(db, 'applications', user.uid));
        if (snap.exists()) {
          const data = snap.data() as AdminMembershipApplication;
          setExistingApp(data);
          if (data.reason) setReason(data.reason);
          if (data.cyclingExperience) setExperience(data.cyclingExperience);
          if (data.requestedTitle) setRequestedTitle(data.requestedTitle);
        } else {
          setExistingApp(null);
        }
      } catch (err) {
        console.error('Error fetching application:', err);
      } finally {
        setLoading(false);
      }
    };

    checkExisting();
  }, [isOpen, user]);

  if (!isOpen) return null;

  if (!user) {
    return (
      <div className="modal-overlay open" role="dialog" aria-modal="true">
        <div className="modal max-w-md text-center p-6 border-3 border-[#1e1e1e] bg-white rounded-3xl shadow-[0_8px_0_#1e1e1e]">
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <i className="fas fa-times"></i>
          </button>
          <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-[#f9c74f] text-[#1e1e1e] border-2 border-[#1e1e1e] flex items-center justify-center text-2xl shadow-[0_4px_0_#1e1e1e]">
            <i className="fas fa-id-badge"></i>
          </div>
          <h2 className="text-2xl font-black text-zinc-900 mb-2">Sign In Required</h2>
          <p className="text-zinc-600 text-sm mb-6">
            You must be signed in with a registered rider account to apply for Admin Membership.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 btn-secondary py-2.5 font-bold"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenAuth();
              }}
              className="flex-1 btn-primary py-2.5 font-bold"
            >
              Sign In / Register
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError('Please provide a reason for applying.');
      return;
    }
    if (!experience.trim()) {
      setError('Please share your cycling background.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const now = new Date().toISOString();
      const appData: AdminMembershipApplication = {
        id: user.uid,
        userId: user.uid,
        applicantName: profile?.displayName || user.displayName || 'Rider',
        applicantEmail: user.email || '',
        applicantPhotoURL: profile?.photoURL || user.photoURL || '',
        reason: reason.trim(),
        cyclingExperience: experience.trim(),
        requestedTitle: requestedTitle.trim() || 'Cycling Enthusiast',
        status: 'PENDING',
        createdAt: existingApp?.createdAt || now,
        updatedAt: now,
      };

      // Save application document with user UID as document ID
      await setDoc(doc(db, 'applications', user.uid), appData);

      // Create notification for Super Admin and Admins
      try {
        await addDoc(collection(db, 'notifications'), {
          recipientId: 'SUPER_ADMIN',
          type: 'APPLICATION_SUBMITTED',
          title: existingApp?.status === 'REJECTED' ? 'Admin Membership Application Re-Submitted' : 'New Admin Member Application',
          message: `${profile?.displayName || user.displayName || 'A rider'} ${existingApp?.status === 'REJECTED' ? 're-submitted' : 'submitted'} an application for Admin Membership.`,
          applicantId: user.uid,
          applicantName: profile?.displayName || user.displayName || 'Rider',
          applicantPhotoURL: profile?.photoURL || user.photoURL || '',
          isRead: false,
          createdAt: now,
        });
      } catch (notifErr) {
        console.warn('Notification non-critical warning:', notifErr);
      }

      // Update user profile status if allowed
      try {
        await setDoc(
          doc(db, 'users', user.uid),
          {
            adminMembershipStatus: 'PENDING',
            updatedAt: now,
          },
          { merge: true }
        );
      } catch (userErr) {
        console.warn('User status sync non-critical warning:', userErr);
      }

      setSuccess(true);
      setExistingApp(appData);
    } catch (err: unknown) {
      console.error('Error submitting application:', err);
      setError(err instanceof Error ? err.message : 'Failed to submit application. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay open" role="dialog" aria-modal="true">
      <div className="modal max-w-2xl p-7 sm:p-9 border-3 border-[#1e1e1e] bg-white rounded-3xl shadow-[0_10px_0_#1e1e1e] max-h-[90vh] overflow-y-auto">
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          <i className="fas fa-times"></i>
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-2xl bg-[#f9c74f] text-[#1e1e1e] border-2 border-[#1e1e1e] flex items-center justify-center text-xl shadow-[0_3px_0_#1e1e1e]">
            <i className="fas fa-bicycle"></i>
          </div>
          <div>
            <h2 className="text-xl font-black text-zinc-900 tracking-tight">
              Admin Membership Application
            </h2>
            <p className="text-xs text-zinc-600">
              Apply to join the official Cycle.exe Admin Members team
            </p>
          </div>
        </div>

        {/* Existing Status Banner */}
        {existingApp && !success && (
          <div
            className={`mb-4 p-3.5 rounded-2xl border-2 text-xs font-medium ${
              existingApp.status === 'PENDING'
                ? 'bg-amber-50 border-amber-400 text-amber-900'
                : existingApp.status === 'APPROVED'
                ? 'bg-emerald-50 border-emerald-400 text-emerald-900'
                : existingApp.status === 'REJECTED'
                ? 'bg-rose-50 border-rose-400 text-rose-900'
                : 'bg-zinc-100 border-zinc-400 text-zinc-800'
            }`}
          >
            <div className="flex items-center gap-2 font-black mb-1">
              <i
                className={`fas ${
                  existingApp.status === 'PENDING'
                    ? 'fa-clock'
                    : existingApp.status === 'APPROVED'
                    ? 'fa-check-circle'
                    : 'fa-info-circle'
                }`}
              ></i>
              <span>Application Status: {existingApp.status}</span>
            </div>
            {existingApp.status === 'PENDING' && (
              <p>
                Your application is currently under review by our moderation team and the Super Admin. You will be notified once a decision has been made.
              </p>
            )}
            {existingApp.status === 'APPROVED' && (
              <p>
                Congratulations! Your Admin Membership is approved. You have full community privileges and your custom title is displayed on the Crew directory.
              </p>
            )}
            {existingApp.status === 'REJECTED' && (
              <div>
                <p>Your previous application was not approved.</p>
                {existingApp.rejectionReason && (
                  <p className="italic mt-1">Note: "{existingApp.rejectionReason}"</p>
                )}
                <p className="mt-1 font-bold">You may update your details and re-apply below.</p>
              </div>
            )}
          </div>
        )}

        {success ? (
          <div className="text-center py-6">
            <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-emerald-100 text-emerald-600 border-2 border-emerald-500 flex items-center justify-center text-2xl shadow-[0_4px_0_#1e1e1e]">
              <i className="fas fa-check"></i>
            </div>
            <h3 className="text-xl font-black text-zinc-900 mb-2">Application Submitted!</h3>
            <p className="text-zinc-600 text-sm max-w-md mx-auto mb-6">
              Your application has been delivered to the Admin Notification Panel and Super Admin for review.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="btn-primary py-2.5 px-6 font-bold text-sm"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 bg-red-50 border-2 border-red-500 rounded-2xl text-xs font-semibold text-red-700 flex items-start gap-2">
                <i className="fas fa-exclamation-circle text-sm mt-0.5"></i>
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-black uppercase tracking-wider mb-1.5 text-zinc-700">
                1. Why do you want to become a Cycle.exe Admin Member? *
              </label>
              <textarea
                required
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Share your motivation, how you will support other riders, and why you'd like to join our leadership team..."
                className="neo-input text-sm w-full p-3 resize-none"
                disabled={loading || submitting}
              ></textarea>
            </div>

            <div>
              <label className="block text-xs font-black uppercase tracking-wider mb-1.5 text-zinc-700">
                2. Your Cycling Background &amp; Experience *
              </label>
              <textarea
                required
                rows={3}
                value={experience}
                onChange={(e) => setExperience(e.target.value)}
                placeholder="How often do you ride? What kind of bikes/routes do you prefer? Any group ride experience?"
                className="neo-input text-sm w-full p-3 resize-none"
                disabled={loading || submitting}
              ></textarea>
            </div>

            <div>
              <label className="block text-xs font-black uppercase tracking-wider mb-1.5 text-zinc-700">
                3. Preferred Custom Community Title
              </label>
              <input
                type="text"
                value={requestedTitle}
                onChange={(e) => setRequestedTitle(e.target.value)}
                placeholder="e.g. Chill Guy, Road Warrior, Dhesh Dhesh..."
                className="neo-input text-sm w-full p-2.5 mb-2 font-bold"
                disabled={loading || submitting}
              />
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[10px] font-bold text-zinc-500 self-center mr-1">Suggestions:</span>
                {suggestedTitles.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setRequestedTitle(t)}
                    className={`text-[11px] px-2 py-0.5 rounded-full border transition font-bold ${
                      requestedTitle === t
                        ? 'bg-[#1e1e1e] text-[#f9c74f] border-[#1e1e1e]'
                        : 'bg-zinc-100 text-zinc-700 border-zinc-300 hover:bg-zinc-200'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="btn-secondary py-2.5 px-4 font-bold text-sm"
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || (existingApp?.status === 'PENDING')}
                className="btn-primary py-2.5 px-6 font-black text-sm flex items-center gap-2"
              >
                {submitting ? (
                  <>
                    <i className="fas fa-spinner fa-spin"></i> Submitting...
                  </>
                ) : existingApp?.status === 'PENDING' ? (
                  <>
                    <i className="fas fa-check"></i> Application Pending Review
                  </>
                ) : existingApp?.status === 'REJECTED' ? (
                  <>
                    <i className="fas fa-redo"></i> Re-Submit Application
                  </>
                ) : (
                  <>
                    <i className="fas fa-paper-plane"></i> Submit Application
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
