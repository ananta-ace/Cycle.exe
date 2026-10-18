import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { Member, MemberRating } from '../types';

interface RatingModalProps {
  isOpen: boolean;
  targetMember: Member | null;
  onClose: () => void;
  onRatingUpdated?: () => void;
}

export const RatingModal: React.FC<RatingModalProps> = ({
  isOpen,
  targetMember,
  onClose,
  onRatingUpdated,
}) => {
  const { user, profile } = useAuth();
  const [rating, setRating] = useState<number>(5);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [existingRating, setExistingRating] = useState<MemberRating | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !targetMember || !user) return;

    const fetchExistingRating = async () => {
      try {
        setLoading(true);
        setError(null);
        // Check featuredMembers ratings first, then users
        const featRef = doc(db, 'featuredMembers', targetMember.id, 'ratings', user.uid);
        let snap = await getDoc(featRef);
        if (!snap.exists()) {
          const userRef = doc(db, 'users', targetMember.id, 'ratings', user.uid);
          snap = await getDoc(userRef);
        }

        if (snap.exists()) {
          const data = snap.data() as MemberRating;
          setExistingRating(data);
          setRating(data.rating);
          setComment(data.comment || '');
        } else {
          setExistingRating(null);
          setRating(5);
          setComment('');
        }
      } catch (err) {
        console.warn('Notice when fetching rating:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchExistingRating();
  }, [isOpen, targetMember, user]);

  if (!isOpen || !targetMember) return null;

  const isSelfRating = user && (user.uid === targetMember.id || user.uid === targetMember.userId);

  // Recalculate average and total count on member document
  const aggregateRatings = async (targetId: string) => {
    try {
      // 1. Gather all ratings from featuredMembers ratings subcollection
      const featRatingsRef = collection(db, 'featuredMembers', targetId, 'ratings');
      const snap = await getDocs(featRatingsRef);

      let sum = 0;
      let count = 0;
      snap.forEach((d) => {
        const r = (d.data() as MemberRating).rating || 0;
        if (r > 0) {
          sum += r;
          count++;
        }
      });

      const avg = count > 0 ? Number((sum / count).toFixed(1)) : 0;
      const now = new Date().toISOString();

      // Update featuredMembers document
      try {
        await setDoc(
          doc(db, 'featuredMembers', targetId),
          { ratingAverage: avg, ratingCount: count, updatedAt: now },
          { merge: true }
        );
      } catch (e) {
        console.warn('Update featured member ratings warning:', e);
      }

      // If linked user document exists, update users collection too
      const linkedUserId = targetMember.userId || targetId;
      try {
        await setDoc(
          doc(db, 'users', linkedUserId),
          { ratingAverage: avg, ratingCount: count, updatedAt: now },
          { merge: true }
        );
      } catch {
        // May not exist or client may not have update permission
      }
    } catch (err) {
      console.warn('Error aggregating ratings:', err);
    }
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

    try {
      setSubmitting(true);
      setError(null);

      const ratingData: MemberRating = {
        id: user.uid,
        targetMemberId: targetMember.id,
        raterId: user.uid,
        raterName: profile?.displayName || user.displayName || 'Rider',
        rating,
        comment: comment.trim(),
        createdAt: existingRating?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Save to featuredMembers ratings subcollection
      const featRatingDocRef = doc(db, 'featuredMembers', targetMember.id, 'ratings', user.uid);
      await setDoc(featRatingDocRef, ratingData);

      // Attempt saving to users collection ratings if target is registered user
      try {
        const userRatingDocRef = doc(db, 'users', targetMember.id, 'ratings', user.uid);
        await setDoc(userRatingDocRef, ratingData);
      } catch {
        // Target may only be in featuredMembers
      }

      // Recalculate rating average
      await aggregateRatings(targetMember.id);

      if (onRatingUpdated) onRatingUpdated();
      onClose();
    } catch (err: unknown) {
      console.error('Error submitting rating:', err);
      setError(err instanceof Error ? err.message : 'Failed to submit rating. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!user || !existingRating) return;
    if (!confirm('Are you sure you want to remove your rating?')) return;

    try {
      setSubmitting(true);
      const featRatingDocRef = doc(db, 'featuredMembers', targetMember.id, 'ratings', user.uid);
      await deleteDoc(featRatingDocRef);

      try {
        const userRatingDocRef = doc(db, 'users', targetMember.id, 'ratings', user.uid);
        await deleteDoc(userRatingDocRef);
      } catch {
        // Non-fatal
      }

      await aggregateRatings(targetMember.id);

      if (onRatingUpdated) onRatingUpdated();
      onClose();
    } catch (err: unknown) {
      console.error('Error deleting rating:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete rating');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay open" role="dialog" aria-modal="true">
      <div className="modal max-w-lg p-7 sm:p-9 border-3 border-[#1e1e1e] bg-white rounded-3xl shadow-[0_10px_0_#1e1e1e]">
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
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

        {isSelfRating ? (
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
                maxLength={300}
              ></textarea>
            </div>

            <div className="flex items-center justify-between pt-2">
              {existingRating ? (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={submitting}
                  className="text-xs font-bold text-red-600 hover:text-red-800 underline"
                >
                  Remove My Rating
                </button>
              ) : (
                <div></div>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
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
