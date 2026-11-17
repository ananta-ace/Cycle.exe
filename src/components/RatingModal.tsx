import React, { useState, useEffect } from 'react';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  runTransaction,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { Member, MemberRating } from '../types';

interface RatingModalProps {
  isOpen: boolean;
  targetMember: Member | null;
  onClose: () => void;
  onRatingUpdated?: (summary?: { ratingAverage: number; ratingCount: number }) => void;
  onOpenAuth?: () => void;
}

function extractReadableError(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  try {
    const parsed = JSON.parse(err.message);
    if (parsed && typeof parsed.error === 'string') {
      if (parsed.error.toLowerCase().includes('permission')) {
        return 'Permission denied while saving rating. Please make sure you are signed in and try again.';
      }
      return parsed.error;
    }
  } catch {
    // Plain error message
  }
  return err.message || fallback;
}

export const RatingModal: React.FC<RatingModalProps> = ({
  isOpen,
  targetMember,
  onClose,
  onRatingUpdated,
  onOpenAuth,
}) => {
  const { user, profile } = useAuth();
  const [rating, setRating] = useState<number>(5);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [existingRating, setExistingRating] = useState<MemberRating | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !targetMember) return;

    setConfirmingDelete(false);
    setError(null);

    if (!user) {
      setExistingRating(null);
      setRating(5);
      setComment('');
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchExistingRating = async () => {
      try {
        setLoading(true);
        const featRef = doc(db, 'featuredMembers', targetMember.id, 'ratings', user.uid);
        let snap = await getDoc(featRef);

        const linkedUserId = targetMember.userId || targetMember.id;
        if (!snap.exists() && linkedUserId !== targetMember.id) {
          const userRef = doc(db, 'users', linkedUserId, 'ratings', user.uid);
          snap = await getDoc(userRef);
        }

        if (cancelled) return;

        if (snap.exists()) {
          const data = snap.data() as MemberRating;
          setExistingRating(data);
          setRating(Math.min(5, Math.max(1, Number(data.rating) || 5)));
          setComment(data.comment || '');
        } else {
          setExistingRating(null);
          setRating(5);
          setComment('');
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('Notice when fetching rating:', err);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchExistingRating();

    return () => {
      cancelled = true;
    };
  }, [isOpen, targetMember?.id, targetMember?.userId, user?.uid]);

  if (!isOpen || !targetMember) return null;

  const isSelfRating = Boolean(
    user && (user.uid === targetMember.id || (targetMember.userId && user.uid === targetMember.userId))
  );

  const aggregateRatings = async (
    targetId: string,
    delta: { mode: 'upsert'; previousRating: number | null; newRating: number } | { mode: 'delete'; previousRating: number }
  ): Promise<{ ratingAverage: number; ratingCount: number }> => {
    const now = new Date().toISOString();
    const featMemberRef = doc(db, 'featuredMembers', targetId);
    const featMemberPath = `featuredMembers/${targetId}`;

    let avg = 0;
    let count = 0;
    let computedFromList = false;

    try {
      const snap = await getDocs(collection(db, 'featuredMembers', targetId, 'ratings'));
      let sum = 0;
      snap.forEach((d) => {
        const r = Number((d.data() as MemberRating).rating) || 0;
        if (r >= 1 && r <= 5) {
          sum += r;
          count++;
        }
      });
      avg = count > 0 ? Number((sum / count).toFixed(1)) : 0;
      computedFromList = true;
    } catch {
      // If collection list is restricted by deployed rules, compute atomically via transaction below
      computedFromList = false;
    }

    if (computedFromList) {
      try {
        await updateDoc(featMemberRef, {
          ratingAverage: avg,
          ratingCount: count,
          updatedAt: now,
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, featMemberPath);
      }
    } else {
      try {
        const result = await runTransaction(db, async (tx) => {
          const memberSnap = await tx.get(featMemberRef);
          const data = memberSnap.exists() ? memberSnap.data() : {};
          const oldAvg = typeof data.ratingAverage === 'number' ? data.ratingAverage : 0;
          const oldCount = typeof data.ratingCount === 'number' ? data.ratingCount : 0;
          const oldSum = oldAvg * oldCount;

          let newCount = oldCount;
          let newAvg = oldAvg;

          if (delta.mode === 'upsert') {
            if (delta.previousRating !== null && oldCount > 0) {
              newCount = oldCount;
              const newSum = Math.max(0, oldSum - delta.previousRating + delta.newRating);
              newAvg = Number(Math.min(5, Math.max(1, newSum / newCount)).toFixed(1));
            } else {
              newCount = oldCount + 1;
              const newSum = oldSum + delta.newRating;
              newAvg = Number(Math.min(5, Math.max(1, newSum / newCount)).toFixed(1));
            }
          } else {
            newCount = Math.max(0, oldCount - 1);
            if (newCount === 0) {
              newAvg = 0;
            } else {
              const newSum = Math.max(0, oldSum - delta.previousRating);
              newAvg = Number(Math.min(5, Math.max(1, newSum / newCount)).toFixed(1));
            }
          }

          tx.update(featMemberRef, {
            ratingAverage: newAvg,
            ratingCount: newCount,
            updatedAt: now,
          });

          return { ratingAverage: newAvg, ratingCount: newCount };
        });

        avg = result.ratingAverage;
        count = result.ratingCount;
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, featMemberPath);
      }
    }

    const linkedUserId = targetMember.userId || targetId;
    if (linkedUserId) {
      try {
        const userDocRef = doc(db, 'users', linkedUserId);
        const userSnap = await getDoc(userDocRef);
        if (userSnap.exists()) {
          await updateDoc(userDocRef, {
            ratingAverage: avg,
            ratingCount: count,
            updatedAt: now,
          });
        }
      } catch {
        // Secondary sync on users collection is non-fatal
      }
    }

    return { ratingAverage: avg, ratingCount: count };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setError('You must be signed in to rate a crew leader.');
      return;
    }
    if (isSelfRating) {
      setError('You cannot rate yourself.');
      return;
    }
    if (rating < 1 || rating > 5) {
      setError('Please select a rating between 1 and 5 stars.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const now = new Date().toISOString();
      const normalizedRating = Math.round(rating);
      const safeName = (profile?.displayName || user.displayName || 'Rider').trim().slice(0, 80) || 'Rider';
      const safeComment = comment.trim().slice(0, 500);

      const ratingData: MemberRating = {
        id: user.uid,
        targetMemberId: targetMember.id,
        raterId: user.uid,
        raterName: safeName,
        rating: normalizedRating,
        comment: safeComment,
        createdAt: existingRating?.createdAt || now,
        updatedAt: now,
      };

      const featRatingPath = `featuredMembers/${targetMember.id}/ratings/${user.uid}`;
      try {
        await setDoc(doc(db, 'featuredMembers', targetMember.id, 'ratings', user.uid), ratingData);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, featRatingPath);
      }

      const linkedUserId = targetMember.userId || targetMember.id;
      if (linkedUserId && linkedUserId !== user.uid) {
        try {
          const userSnap = await getDoc(doc(db, 'users', linkedUserId));
          if (userSnap.exists()) {
            await setDoc(doc(db, 'users', linkedUserId, 'ratings', user.uid), {
              ...ratingData,
              targetMemberId: linkedUserId,
            });
          }
        } catch {
          // Mirroring to users subcollection is non-fatal
        }
      }

      const summary = await aggregateRatings(targetMember.id, {
        mode: 'upsert',
        previousRating: existingRating ? Number(existingRating.rating) || null : null,
        newRating: normalizedRating,
      });

      if (onRatingUpdated) onRatingUpdated(summary);
      onClose();
    } catch (err: unknown) {
      console.error('Error submitting rating:', err);
      setError(extractReadableError(err, 'Failed to submit rating. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!user || !existingRating) return;

    try {
      setSubmitting(true);
      setError(null);

      const previousRating = Number(existingRating.rating) || 0;
      const featRatingPath = `featuredMembers/${targetMember.id}/ratings/${user.uid}`;
      try {
        await deleteDoc(doc(db, 'featuredMembers', targetMember.id, 'ratings', user.uid));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, featRatingPath);
      }

      const linkedUserId = targetMember.userId || targetMember.id;
      if (linkedUserId) {
        try {
          await deleteDoc(doc(db, 'users', linkedUserId, 'ratings', user.uid));
        } catch {
          // Non-fatal
        }
      }

      const summary = await aggregateRatings(targetMember.id, {
        mode: 'delete',
        previousRating,
      });

      if (onRatingUpdated) onRatingUpdated(summary);
      onClose();
    } catch (err: unknown) {
      console.error('Error deleting rating:', err);
      setError(extractReadableError(err, 'Failed to delete rating. Please try again.'));
    } finally {
      setSubmitting(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <div
      className="modal-overlay open"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) {
          onClose();
        }
      }}
    >
      <div className="modal max-w-lg p-7 sm:p-9 border-3 border-[#1e1e1e] bg-white rounded-3xl shadow-[0_10px_0_#1e1e1e]">
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          disabled={submitting}
          aria-label="Close"
        >
          <i className="fas fa-times"></i>
        </button>

        <div className="text-center mb-4">
          <div className="w-16 h-16 mx-auto mb-2 rounded-full overflow-hidden border-2 border-[#1e1e1e] shadow-[0_3px_0_#1e1e1e] bg-zinc-200">
            {targetMember.img ? (
              <img
                src={targetMember.img}
                alt={targetMember.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center font-black text-xl text-zinc-700">
                {targetMember.initial}
              </div>
            )}
          </div>
          <h3 className="font-black text-lg text-zinc-900 tracking-tight">
            Rate {targetMember.name}
          </h3>
          <p className="text-xs text-amber-800 font-bold">
            {targetMember.title || 'Admin Member'}
          </p>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Community feedback helps highlight friendly, supportive group leaders!
          </p>
        </div>

        {!user ? (
          <div className="p-5 bg-amber-50 border-2 border-amber-300 rounded-2xl text-center space-y-3">
            <i className="fas fa-user-lock text-amber-600 text-2xl block"></i>
            <p className="text-xs text-amber-950 font-bold leading-relaxed">
              Please sign in with your Cycle.exe account to submit or manage a rating for {targetMember.name}.
            </p>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="btn-secondary py-2 px-4 text-xs font-bold"
              >
                Close
              </button>
              {onOpenAuth && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAuth();
                  }}
                  className="btn-primary py-2 px-5 text-xs font-black flex items-center gap-1.5"
                >
                  <i className="fas fa-sign-in-alt"></i> Sign In to Rate
                </button>
              )}
            </div>
          </div>
        ) : isSelfRating ? (
          <div className="p-4 bg-amber-50 border-2 border-amber-300 rounded-2xl text-xs text-amber-900 text-center font-bold">
            <i className="fas fa-exclamation-triangle text-amber-600 text-lg mb-1 block"></i>
            You cannot rate yourself. Ratings are submitted by other registered community members.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 bg-red-50 border-2 border-red-500 rounded-2xl text-xs font-semibold text-red-700">
                {error}
              </div>
            )}

            {/* Star selector */}
            <div className="text-center">
              <span className="text-xs font-black uppercase tracking-wider text-zinc-600 block mb-2">
                Select Rating (1 to 5 Stars)
              </span>
              <div className="flex items-center justify-center gap-2">
                {[1, 2, 3, 4, 5].map((star) => {
                  const active = (hoverRating !== null ? hoverRating : rating) >= star;
                  return (
                    <button
                      key={star}
                      type="button"
                      onMouseEnter={() => setHoverRating(star)}
                      onMouseLeave={() => setHoverRating(null)}
                      onClick={() => setRating(star)}
                      className="p-1 text-3xl transition-transform hover:scale-125 focus:outline-none"
                      aria-label={`Rate ${star} ${star === 1 ? 'star' : 'stars'}`}
                    >
                      <i
                        className={`fas fa-star ${
                          active ? 'text-[#f9c74f] drop-shadow-[0_1px_1px_rgba(0,0,0,0.3)]' : 'text-zinc-200'
                        }`}
                      ></i>
                    </button>
                  );
                })}
              </div>
              <span className="text-xs font-bold text-zinc-700 mt-1 block">
                {rating === 1 && '1 Star — Needs Improvement'}
                {rating === 2 && '2 Stars — Fair Leader'}
                {rating === 3 && '3 Stars — Good Rider'}
                {rating === 4 && '4 Stars — Great Team Leader!'}
                {rating === 5 && '5 Stars — Outstanding Cycling Leader! 🚴 ⭐'}
              </span>
            </div>

            <div>
              <label className="block text-xs font-black uppercase tracking-wider mb-1 text-zinc-700">
                Optional Feedback / Comment
              </label>
              <textarea
                rows={2}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Share a short note about this member's ride support or community leadership..."
                className="neo-input text-sm w-full p-2.5 resize-none"
                maxLength={500}
              ></textarea>
            </div>

            <div className="flex items-center justify-between gap-2 pt-2 flex-wrap">
              {existingRating ? (
                confirmingDelete ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={submitting}
                      className="px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition"
                    >
                      {submitting ? 'Removing...' : 'Confirm Remove'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(false)}
                      disabled={submitting}
                      className="text-xs font-bold text-zinc-600 hover:text-zinc-900"
                    >
                      Keep
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(true)}
                    disabled={submitting}
                    className="text-xs font-bold text-red-600 hover:text-red-800 underline"
                  >
                    Remove My Rating
                  </button>
                )
              ) : (
                <div></div>
              )}

              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="btn-secondary py-2 px-3 text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || loading}
                  className="btn-primary py-2 px-5 text-xs font-black flex items-center gap-1.5"
                >
                  {submitting ? (
                    <>
                      <i className="fas fa-spinner fa-spin"></i> Saving...
                    </>
                  ) : existingRating ? (
                    <>
                      <i className="fas fa-check"></i> Update Rating
                    </>
                  ) : (
                    <>
                      <i className="fas fa-star"></i> Submit Rating
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
