import React, { useState, useEffect } from 'react';
import { Member } from '../types';
import { missionMetaList } from '../data';

interface MemberModalProps {
  member: Member | null;
  onClose: () => void;
}

export const MemberModal: React.FC<MemberModalProps> = ({ member, onClose }) => {
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
    return (
      <div className="modal-overlay" aria-hidden="true" />
    );
  }

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
      <div className="modal">
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          aria-label="Close modal"
        >
          <i className="fas fa-times"></i>
        </button>

        <div className="modal-header">
          <div
            className={`modal-avatar ${!member.active ? 'inactive-avatar' : ''}`}
          >
            {!imageError ? (
              <img
                src={member.img}
                alt={member.name}
                onError={() => setImageError(true)}
              />
            ) : null}
            {imageError && (
              <span className="fallback" style={{ display: 'flex' }}>
                {member.initial}
              </span>
            )}
          </div>
          <div className="modal-name">{member.name}</div>
          <div className="modal-title-badge">
            <i className="fas fa-tag"></i> {member.title}
          </div>
          <div className="modal-status-row">
            {member.active ? (
              <span className="modal-pill active-pill">
                <i className="fas fa-circle"></i> Active
              </span>
            ) : (
              <span className="modal-pill inactive-pill">
                <i className="fas fa-circle"></i> Inactive
              </span>
            )}
            <span
              className={`modal-pill attend-pill ${
                member.perfect ? 'perfect' : ''
              }`}
            >
              <i
                className={`fas ${
                  member.perfect ? 'fa-medal' : 'fa-check'
                }`}
              ></i>{' '}
              {member.attend} missions
            </span>
          </div>
        </div>

        <div className="modal-section-title">
          <i className="fas fa-flag-checkered"></i> Mission History
        </div>

        <div className="mission-list">
          {missionMetaList.map((m) => {
            const attended = member.missions[m.id as keyof typeof member.missions];
            const itemCls = attended ? 'mission-item' : 'mission-item missed';
            const iconCls = attended ? m.cls : 'missed-icon';
            const checkIcon = attended
              ? 'fa-circle-check mission-check'
              : 'fa-circle-xmark mission-check missed-check';

            return (
              <div key={m.id} className={itemCls}>
                <div className={`mission-icon ${iconCls}`}>
                  <i
                    className={`fas ${attended ? m.icon : 'fa-minus'}`}
                  ></i>
                </div>
                <div className="mission-info">
                  <div className="mission-name">
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
