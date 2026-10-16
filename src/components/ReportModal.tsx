import React, { useState } from 'react';
import { collection, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { ContentReport } from '../types';

interface ReportModalProps {
  target: {
    type: 'COMMENT' | 'POST';
    id: string;
    excerpt: string;
    authorId?: string;
  } | null;
  onClose: () => void;
}

export const ReportModal: React.FC<ReportModalProps> = ({ target, onClose }) => {
  const { user } = useAuth();
  const [reasonCategory, setReasonCategory] = useState('Bullying / Harassment');
  const [details, setDetails] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!target) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setError('You must be signed in to submit a moderation report.');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const reportData: Omit<ContentReport, 'id'> = {
        targetType: target.type,
        targetId: target.id,
        targetAuthorId: target.authorId || '',
        targetExcerpt: target.excerpt.substring(0, 300),
        reporterId: user.uid,
        reporterEmail: user.email || 'anonymous',
        reason: `${reasonCategory}: ${details.trim()}`,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };

      await addDoc(collection(db, 'reports'), reportData);
      setSubmitted(true);
      setTimeout(() => {
        setSubmitted(false);
        onClose();
      }, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit report');
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
      <div className="modal max-w-md">
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          <i className="fas fa-times"></i>
        </button>

        <div className="text-center mb-5">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-100 text-red-600 border-2 border-red-600 mb-2">
            <i className="fas fa-flag text-lg"></i>
          </div>
          <h2 className="text-xl font-bold">Report Content to Moderators</h2>
          <p className="text-xs text-zinc-600 mt-1">
            Our moderation team reviews reports of bullying, abuse, and harassment.
          </p>
        </div>

        {submitted ? (
          <div className="p-4 bg-emerald-50 border-2 border-emerald-500 rounded-2xl text-center text-sm font-bold text-emerald-800">
            <i className="fas fa-check-circle text-lg mb-1 block"></i>
            Report submitted successfully. Thank you for keeping our community safe.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="p-3 bg-zinc-100 border border-zinc-300 rounded-2xl text-xs text-zinc-700 italic">
              &quot;{target.excerpt.substring(0, 150)}...&quot;
            </div>

            {error && (
              <div className="p-2.5 bg-red-50 border border-red-500 rounded-xl text-xs text-red-700">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-zinc-700">
                Reason for report
              </label>
              <select
                value={reasonCategory}
                onChange={(e) => setReasonCategory(e.target.value)}
                className="neo-input text-sm py-2"
              >
                <option value="Bullying / Harassment">Bullying / Harassment</option>
                <option value="Hate Speech / Threats">Hate Speech / Threats</option>
                <option value="Spam / Advertisements">Spam / Advertisements</option>
                <option value="Inappropriate Content">Inappropriate Content</option>
                <option value="Other Policy Violation">Other Policy Violation</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-zinc-700">
                Additional context (optional)
              </label>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                rows={3}
                placeholder="Describe what occurred..."
                className="neo-input text-sm py-2 resize-none"
              />
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={onClose}
                className="btn-secondary text-xs py-2 px-4"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="btn-primary btn-danger text-xs py-2 px-4 font-bold flex items-center gap-2"
              >
                {loading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-paper-plane"></i>}
                Submit Report
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
