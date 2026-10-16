import React, { useState, useEffect } from 'react';
import { Member } from '../types';
import { missionMetaList } from '../data';

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
      <div className="modal max-w-lg p-6 max-h-[90vh] overflow-y-auto">
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
                <i className="fas fa-circle"></i> Active Member
              </span>
            ) : (
              <span className="modal-pill inactive-pill">
                <i className="fas fa-circle"></i> Inactive
              </span>
            )}
            <span className={`modal-pill attend-pill ${member.perfect ? 'perfect' : ''}`}>
              <i className={`fas ${member.perfect ? 'fa-medal' : 'fa-check'}`}></i>{' '}
              {member.attend} missions
            </span>
          </div>

          {member.bio && (
            <p className="mt-3 text-xs text-zinc-600 max-w-sm mx-auto leading-relaxed italic">
              "{member.bio}"
            </p>
          )}
        </div>

        <div className="modal-section-title mt-4">
          <i className="fas fa-flag-checkered"></i> Mission &amp; Community Participation
        </div>

        <div className="mission-list">
          {missionMetaList.map((m) => {
            const attended = member.missions?.[m.id as keyof typeof member.missions] ?? false;
            const itemCls = attended ? 'mission-item' : 'mission-item missed';
            const iconCls = attended ? m.cls : 'missed-icon';
            const checkIcon = attended
              ? 'fa-circle-check mission-check'
              : 'fa-circle-xmark mission-check missed-check';

            return (
              <div key={m.id} className={itemCls}>
                <div className={`mission-icon ${iconCls}`}>
                  <i className={`fas ${attended ? m.icon : 'fa-minus'}`}></i>
                </div>
                <div className="mission-info">
                  <div className="mission-name font-bold">
                    Mission {m.num} · {m.name || m.title}
                  </div>
                  <div className="mission-meta">
                    <span>
                      <i className="fas fa-calendar-alt"></i> {m.shortDate}
                    </span>
                    <span>
                      <i className="fas fa-road"></i> {m.totalDist}
                    </span>
                  </div>
                </div>
                <i className={`fas ${checkIcon}`}></i>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
