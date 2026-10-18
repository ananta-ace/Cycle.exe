import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { Member } from '../types';
import { useAuth } from '../context/AuthContext';
import { RatingModal } from './RatingModal';

interface MembersViewProps {
  onSelectMember: (member: Member) => void;
  onOpenApplyModal: () => void;
}

export const MembersView: React.FC<MembersViewProps> = ({
  onSelectMember,
  onOpenApplyModal,
}) => {
  const { profile, isSuperAdmin } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [ratingTarget, setRatingTarget] = useState<Member | null>(null);

  // Real-time synchronization of Featured Members exclusively managed by Super Admin
  useEffect(() => {
    const q = query(collection(db, 'featuredMembers'), orderBy('order', 'asc'));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list: Member[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          list.push({
            id: docSnap.id,
            userId: data.userId || docSnap.id,
            name: data.name || 'Featured Rider',
            title: data.title || 'Cycle.exe Crew Leader',
            img: data.img || '',
            initial: (data.name || 'C').charAt(0).toUpperCase(),
            active: data.active !== false,
            attend: data.attend || 'Active Rider',
            perfect: !!data.perfect,
            bio: data.bio || '',
            ratingAverage: data.ratingAverage || 0,
            ratingCount: data.ratingCount || 0,
            badges: Array.isArray(data.badges) ? data.badges : [],
            completedRaces: Array.isArray(data.completedRaces) ? data.completedRaces : [],
            completedRacesCount: data.completedRacesCount || (Array.isArray(data.completedRaces) ? data.completedRaces.length : 0),
            isCustomMember: true,
          });
        });

        setMembers(list);
        setLoading(false);
      },
      (err) => {
        console.warn('Error loading featured members:', err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  const handleImageError = (id: string) => {
    setFailedImages((prev) => ({ ...prev, [id]: true }));
  };

  const handleOpenRating = (e: React.MouseEvent, m: Member) => {
    e.stopPropagation();
    setRatingTarget(m);
  };

  const userIsApproved = profile?.isAdminMember === true || profile?.adminMembershipStatus === 'APPROVED';
  const userIsPending = profile?.adminMembershipStatus === 'PENDING';

  return (
    <div>
      {/* Hero */}
      <div className="hero mb-12">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#f9c74f]/30 border border-[#f9c74f] text-xs font-black text-amber-950 mb-4">
          <i className="fas fa-crown text-[#f9c74f]"></i> Official Community Leadership Directory
        </div>
        <h1 className="text-3xl md:text-5xl font-black text-zinc-900 tracking-tight">
          <i className="fas fa-users text-[#f9c74f]"></i> The Crew &amp; Featured Riders
        </h1>
        <p className="text-base md:text-lg text-zinc-600 max-w-2xl mx-auto mt-3 leading-relaxed">
          Cycle.exe official group leaders, ride pace setters, and featured Admin Members. Curated by the Super Admin. Tap any card to view completed races, community badges, or submit a rating.
        </p>

        {/* Application CTA banner */}
        <div className="mt-8 max-w-3xl lg:max-w-4xl mx-auto p-6 sm:p-7 bg-white rounded-3xl border-3 border-[#1e1e1e] shadow-[0_6px_0_#1e1e1e] flex flex-col sm:flex-row items-center justify-between gap-6 text-left">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[#1e1e1e] text-[#f9c74f] flex items-center justify-center text-xl border border-[#1e1e1e] shrink-0 shadow-sm">
              <i className="fas fa-bicycle"></i>
            </div>
            <div>
              <h4 className="font-black text-base text-zinc-900">
                {userIsApproved
                  ? 'You are an Approved Admin Member!'
                  : userIsPending
                  ? 'Your Admin Application is Pending'
                  : 'Want to Lead Group Rides?'}
              </h4>
              <p className="text-xs sm:text-sm text-zinc-600 mt-0.5">
                {userIsApproved
                  ? 'Manage your custom title and view your community ratings.'
                  : userIsPending
                  ? 'The Super Admin is reviewing your submission.'
                  : 'Apply for official Admin Membership to lead missions and earn community badges.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenApplyModal}
            className={`py-2 px-4 text-xs font-black rounded-xl transition shrink-0 ${
              userIsApproved
                ? 'btn-secondary'
                : userIsPending
                ? 'bg-amber-100 text-amber-900 border-2 border-amber-400'
                : 'btn-primary'
            }`}
          >
            {userIsApproved ? (
              <>
                <i className="fas fa-check-circle text-emerald-600 mr-1"></i> Membership Active
              </>
            ) : userIsPending ? (
              <>
                <i className="fas fa-clock text-amber-600 mr-1"></i> Under Review
              </>
            ) : (
              <>
                <i className="fas fa-paper-plane mr-1"></i> Apply for Admin Member
              </>
            )}
          </button>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="text-center py-16 text-zinc-500 font-bold text-sm">
          <i className="fas fa-spinner fa-spin text-2xl mb-2 block"></i> Loading featured riders...
        </div>
      )}

      {/* Zero State if no members are featured yet */}
      {!loading && members.length === 0 && (
        <div className="max-w-xl mx-auto my-12 p-8 sm:p-10 bg-white rounded-3xl border-3 border-[#1e1e1e] shadow-[0_8px_0_#1e1e1e] text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#f9c74f] text-[#1e1e1e] border-2 border-[#1e1e1e] flex items-center justify-center text-3xl shadow-[0_3px_0_#1e1e1e]">
            <i className="fas fa-user-plus"></i>
          </div>
          <h3 className="text-2xl font-black text-zinc-900 mb-2">Home Screen Crew Ready</h3>
          <p className="text-sm text-zinc-600 leading-relaxed mb-6">
            The previous static roster has been cleared. The Super Admin can now select registered users to showcase on this home screen, and manage their completed races, badges, and titles.
          </p>

          {isSuperAdmin ? (
            <a
              href="#superadmin"
              className="btn-primary inline-flex items-center gap-2 py-3 px-6 text-xs font-black"
            >
              <i className="fas fa-crown"></i> Open Super Admin Panel to Feature Riders
            </a>
          ) : (
            <button
              type="button"
              onClick={onOpenApplyModal}
              className="btn-primary inline-flex items-center gap-2 py-2.5 px-5 text-xs font-black"
            >
              <i className="fas fa-paper-plane"></i> Apply to Join The Crew
            </button>
          )}
        </div>
      )}

      {/* Featured Members Grid */}
      {!loading && members.length > 0 && (
        <div className="group-grid">
          {members.map((member) => {
            const isFailed = failedImages[member.id];
            const cardClass = `card ${!member.active ? 'inactive' : ''}`;
            const statusClass = `status-badge ${member.active ? 'active' : 'inactive'}`;
            const attendClass = `attend-badge ${
              member.perfect ? 'perfect' : !member.active ? 'inactive-attend' : ''
            }`;
            const hasRating = member.ratingAverage !== undefined && member.ratingAverage > 0;
            const completedCount = member.completedRacesCount || member.completedRaces?.length || 0;

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
                    {member.attend || `${completedCount} Races`}
                  </div>
                </div>

                <div className="avatar">
                  {!isFailed && member.img ? (
                    <img
                      src={member.img}
                      alt={member.name}
                      onError={() => handleImageError(member.id)}
                    />
                  ) : null}
                  {(isFailed || !member.img) && (
                    <span className="fallback" style={{ display: 'flex' }}>
                      {member.initial}
                    </span>
                  )}
                </div>

                <div className="member-name font-black text-lg">{member.name}</div>
                <div className="member-role font-bold text-xs text-amber-900 bg-[#f9c74f]/30 px-2.5 py-0.5 rounded-full inline-block mx-auto mb-2 border border-[#f9c74f]">
                  {member.title}
                </div>

                {/* Badges preview row */}
                {member.badges && member.badges.length > 0 && (
                  <div className="flex flex-wrap items-center justify-center gap-1 mb-2">
                    {member.badges.slice(0, 3).map((badge, bIdx) => (
                      <span
                        key={bIdx}
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-100 border border-zinc-300 text-zinc-700"
                      >
                        <i className="fas fa-tag text-[9px] text-amber-600 mr-1"></i>
                        {badge}
                      </span>
                    ))}
                    {member.badges.length > 3 && (
                      <span className="text-[10px] text-zinc-400 font-bold">
                        +{member.badges.length - 3}
                      </span>
                    )}
                  </div>
                )}

                {/* Public Rating Display */}
                <div className="mb-2 flex items-center justify-center gap-1.5 text-xs font-bold">
                  {hasRating ? (
                    <span className="text-zinc-800 flex items-center gap-1">
                      <i className="fas fa-star text-[#f9c74f]"></i>
                      <span>{member.ratingAverage?.toFixed(1)}</span>
                      <span className="text-[11px] text-zinc-500 font-normal">
                        ({member.ratingCount})
                      </span>
                    </span>
                  ) : (
                    <span className="text-[11px] text-zinc-400 font-medium italic">
                      Not rated yet
                    </span>
                  )}
                </div>

                {/* Rate button & tap hint */}
                <div className="mt-2 pt-2 border-t border-zinc-200/80 flex items-center justify-between gap-1 text-xs">
                  <button
                    type="button"
                    onClick={(e) => handleOpenRating(e, member)}
                    className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-[#f9c74f] text-amber-950 font-bold text-[11px] border border-amber-300 transition flex items-center gap-1"
                    title={`Rate ${member.name}`}
                  >
                    <i className="fas fa-star text-amber-600"></i> Rate
                  </button>
                  <span className="text-[11px] text-zinc-400 font-semibold">
                    <i className="fas fa-hand-pointer text-[10px]"></i> details
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Rating modal */}
      <RatingModal
        isOpen={ratingTarget !== null}
        targetMember={ratingTarget}
        onClose={() => setRatingTarget(null)}
      />
    </div>
  );
};
