import React, { useState, useEffect } from 'react';
import { Member } from '../types';

interface MemberModalProps {
  member: Member | null;
  onClose: () => void;
  onOpenRating?: (member: Member) => void;
}

export const MemberModal: React.FC<MemberModalProps> = ({
  member,
  onClose,
  onOpenRating,
}) => {
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    setImageError(false);
  }, [member]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (member) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [member, onClose]);

  if (!member) {
    return <div className="modal-overlay" aria-hidden="true" />;
  }

  const ratingAvg = member.ratingAverage !== undefined && member.ratingAverage > 0 ? member.ratingAverage : null;
  const ratingCnt = member.ratingCount || 0;

  return (
    <div
      className="modal-overlay open"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`${member.name} details`}
    >
      <div className="modal max-w-2xl p-7 sm:p-9 max-h-[90vh] overflow-y-auto">
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          aria-label="Close modal"
        >
          <i className="fas fa-times"></i>
        </button>

        <div className="modal-header pb-4 border-b border-zinc-200">
          <div className={`modal-avatar ${!member.active ? 'inactive-avatar' : ''}`}>
            {!imageError && member.img ? (
              <img
                src={member.img}
                alt={member.name}
                onError={() => setImageError(true)}
              />
            ) : null}
            {(imageError || !member.img) && (
              <span className="fallback" style={{ display: 'flex' }}>
                {member.initial}
              </span>
            )}
          </div>
          <div className="modal-name font-black text-2xl text-zinc-900">{member.name}</div>
          <div className="modal-title-badge font-bold text-amber-900 bg-[#f9c74f]/30 border border-[#f9c74f]">
            <i className="fas fa-award"></i> {member.title}
          </div>

          {/* Rating overview */}
          <div className="mt-3 flex items-center justify-center gap-2">
            {ratingAvg ? (
              <div className="flex items-center gap-1.5 bg-amber-50 px-3 py-1 rounded-full border border-amber-300 text-xs font-bold text-amber-950">
                <i className="fas fa-star text-amber-500"></i>
                <span>{ratingAvg.toFixed(1)} / 5.0</span>
                <span className="text-zinc-500 font-normal">({ratingCnt} {ratingCnt === 1 ? 'rating' : 'ratings'})</span>
              </div>
            ) : (
              <span className="text-xs text-zinc-500 font-semibold italic">No ratings yet</span>
            )}

            {onOpenRating && (
              <button
                type="button"
                onClick={() => onOpenRating(member)}
                className="text-xs font-black text-amber-700 hover:text-black bg-[#f9c74f] px-3 py-1 rounded-full border border-black/20 transition flex items-center gap-1 shadow-[0_2px_0_#d6d2ca]"
              >
                <i className="fas fa-star"></i> Rate
              </button>
            )}
          </div>

          <div className="modal-status-row mt-3">
            {member.active ? (
              <span className="modal-pill active-pill">
                <i className="fas fa-circle"></i> Active Rider
              </span>
            ) : (
              <span className="modal-pill inactive-pill">
                <i className="fas fa-circle"></i> Inactive
              </span>
            )}
            <span className={`modal-pill attend-pill ${member.perfect ? 'perfect' : ''}`}>
              <i className={`fas ${member.perfect ? 'fa-medal' : 'fa-check'}`}></i>{' '}
              {member.attend || 'Regular Rider'}
            </span>
          </div>

          {/* Badges display */}
          {member.badges && member.badges.length > 0 && (
            <div className="mt-4 pt-3 border-t border-zinc-200">
              <span className="text-[11px] font-black uppercase tracking-wider text-zinc-500 block mb-1.5">
                <i className="fas fa-award text-[#f9c74f] mr-1"></i> Earned Community Badges
              </span>
              <div className="flex flex-wrap justify-center gap-1.5">
                {member.badges.map((b, idx) => (
                  <span
                    key={idx}
                    className="px-2.5 py-1 rounded-full bg-amber-50 border border-amber-300 text-amber-950 font-bold text-xs flex items-center gap-1"
                  >
                    <i className="fas fa-shield-alt text-amber-600 text-[10px]"></i>
                    {b}
                  </span>
                ))}
              </div>
            </div>
          )}

          {member.bio && (
            <p className="mt-3 text-xs text-zinc-600 max-w-sm mx-auto leading-relaxed italic bg-zinc-50 p-2.5 rounded-xl border border-zinc-200">
              "{member.bio}"
            </p>
          )}
        </div>

        {/* Completed Races List */}
        <div className="modal-section-title mt-4">
          <i className="fas fa-flag-checkered"></i> Completed Expeditions &amp; Races ({member.completedRaces?.length || (member.completedRacesCount || 0)})
        </div>

        {member.completedRaces && member.completedRaces.length > 0 ? (
          <div className="space-y-2 mb-4">
            {member.completedRaces.map((race, rIdx) => (
              <div
                key={rIdx}
                className="p-2.5 bg-zinc-50 border border-zinc-200 rounded-xl flex items-center justify-between text-xs font-bold text-zinc-800"
              >
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-[#1e1e1e] text-[#f9c74f] flex items-center justify-center text-[10px] font-black">
                    {rIdx + 1}
                  </span>
                  <span>{race}</span>
                </div>
                <span className="text-emerald-700 text-[11px] flex items-center gap-1">
                  <i className="fas fa-check-circle"></i> Completed
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-500 italic text-center py-3">
            Races and ride participations are recorded and verified by the Super Admin.
          </p>
        )}
      </div>
    </div>
  );
};
