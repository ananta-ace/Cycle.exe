import React, { useState } from 'react';
import { Member } from '../types';
import { memberList } from '../data';

interface MembersViewProps {
  onSelectMember: (member: Member) => void;
}

export const MembersView: React.FC<MembersViewProps> = ({ onSelectMember }) => {
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  const handleImageError = (id: string) => {
    setFailedImages((prev) => ({ ...prev, [id]: true }));
  };

  return (
    <div>
      {/* Hero */}
      <div className="hero">
        <h1>
          <i className="fas fa-users"></i> The Crew
        </h1>
        <p>Six riders. Tap any card to see their title, badge, and mission history.</p>
      </div>

      {/* Group Grid */}
      <div className="group-grid">
        {memberList.map((member) => {
          const isFailed = failedImages[member.id];
          const cardClass = `card ${!member.active ? 'inactive' : ''}`;
          const statusClass = `status-badge ${member.active ? 'active' : 'inactive'}`;
          const attendClass = `attend-badge ${
            member.perfect
              ? 'perfect'
              : !member.active
              ? 'inactive-attend'
              : ''
          }`;

          return (
            <div
              key={member.id}
              className={cardClass}
              onClick={() => onSelectMember(member)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectMember(member);
                }
              }}
            >
              <div className="card-badges">
                <div className={statusClass}>
                  <i className="fas fa-circle"></i>{' '}
                  {member.active ? 'Active' : 'Inactive'}
                </div>
                <div className={attendClass}>
                  <i
                    className={`fas ${
                      member.perfect ? 'fa-medal' : 'fa-check'
                    }`}
                  ></i>{' '}
                  {member.attend}
                </div>
              </div>

              <div className="avatar">
                {!isFailed ? (
                  <img
                    src={member.img}
                    alt={member.name}
                    onError={() => handleImageError(member.id)}
                  />
                ) : null}
                {isFailed && (
                  <span className="fallback" style={{ display: 'flex' }}>
                    {member.initial}
                  </span>
                )}
              </div>

              <div className="member-name">{member.name}</div>
              <div className="member-role">{member.title}</div>
              <div className="tap-hint">
                <i className="fas fa-hand-pointer"></i> tap for details
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
