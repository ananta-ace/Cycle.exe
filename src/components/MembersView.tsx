import React, { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { Member, UserProfile } from '../types';
import { memberList as staticMemberList } from '../data';
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
  const { profile } = useAuth();
  const [members, setMembers] = useState<Member[]>(staticMemberList);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [ratingTarget, setRatingTarget] = useState<Member | null>(null);

  // Real-time synchronization of Admin Members from Firestore
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'users'),
      (snapshot) => {
        const firestoreApprovedMembers: Member[] = [];
        snapshot.forEach((docSnap) => {
          const u = docSnap.data() as UserProfile;
          const isApproved =
            u.isAdminMember === true ||
            u.adminMembershipStatus === 'APPROVED' ||
            u.role === 'SUPER_ADMIN';

          if (isApproved && !u.isSuspended) {
            firestoreApprovedMembers.push({
              id: u.id,
              name: u.displayName || 'Admin Member',
              title: u.customTitle || (u.role === 'SUPER_ADMIN' ? 'Owner & Executive Director' : 'Cycling Enthusiast'),
              img: u.photoURL || '',
              initial: (u.displayName || 'A').charAt(0).toUpperCase(),
              active: !u.isSuspended,
              attend: '3/3',
              perfect: true,
              bio: u.bio || '',
              ratingAverage: u.ratingAverage || 0,
              ratingCount: u.ratingCount || 0,
              isCustomMember: true,
              missions: { m1: true, m2: true, m3: true },
            });
          }
        });

        // Merge: keep static members if not already represented, and update existing with dynamic Firestore ratings
        const mergedMap = new Map<string, Member>();
        staticMemberList.forEach((m) => mergedMap.set(m.id, { ...m }));

        firestoreApprovedMembers.forEach((fm) => {
          // If match found by name or ID, merge updates
          const existing = Array.from(mergedMap.values()).find(
            (em) => em.id === fm.id || em.name.toLowerCase() === fm.name.toLowerCase()
          );
          if (existing) {
            mergedMap.set(existing.id, {
              ...existing,
              title: fm.title || existing.title,
              img: fm.img || existing.img,
              ratingAverage: fm.ratingAverage,
              ratingCount: fm.ratingCount,
              bio: fm.bio || existing.bio,
            });
          } else {
            mergedMap.set(fm.id, fm);
          }
        });

        setMembers(Array.from(mergedMap.values()));
      },
      (err) => {
        console.warn('Error loading dynamic members:', err);
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
      <div className="hero mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#f9c74f]/30 border border-[#f9c74f] text-xs font-black text-amber-950 mb-3">
          <i className="fas fa-crown text-[#f9c74f]"></i> Official Community Leadership Directory
        </div>
        <h1 className="text-3xl md:text-4xl font-black text-zinc-900 tracking-tight">
          <i className="fas fa-users text-[#f9c74f]"></i> The Crew &amp; Admin Members
        </h1>
        <p className="text-sm md:text-base text-zinc-600 max-w-xl mx-auto mt-2">
          Cycle.exe official group leaders, ride pace setters, and verified Admin Members. Tap any card to view their profile, custom title, mission history, or submit a rating.
        </p>

        {/* Application CTA banner */}
        <div className="mt-6 max-w-xl mx-auto p-4 bg-white rounded-3xl border-3 border-[#1e1e1e] shadow-[0_5px_0_#1e1e1e] flex flex-col sm:flex-row items-center justify-between gap-4 text-left">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#1e1e1e] text-[#f9c74f] flex items-center justify-center text-lg border border-[#1e1e1e] shrink-0">
              <i className="fas fa-bicycle"></i>
            </div>
            <div>
              <h4 className="font-black text-sm text-zinc-900">
                {userIsApproved
                  ? 'You are an Approved Admin Member!'
                  : userIsPending
                  ? 'Your Admin Application is Pending'
                  : 'Want to Lead Group Rides?'}
              </h4>
              <p className="text-xs text-zinc-600">
                {userIsApproved
                  ? 'Manage your custom title and view your community ratings.'
                  : userIsPending
                  ? 'The Super Admin is reviewing your submission.'
                  : 'Apply for official Admin Membership to post and earn community badges.'}
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

      {/* Admin Members Grid */}
      <div className="group-grid">
        {members.map((member) => {
          const isFailed = failedImages[member.id];
          const cardClass = `card ${!member.active ? 'inactive' : ''}`;
          const statusClass = `status-badge ${member.active ? 'active' : 'inactive'}`;
          const attendClass = `attend-badge ${
            member.perfect ? 'perfect' : !member.active ? 'inactive-attend' : ''
          }`;
          const hasRating = member.ratingAverage !== undefined && member.ratingAverage > 0;

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

      {/* Rating modal */}
      <RatingModal
        isOpen={ratingTarget !== null}
        targetMember={ratingTarget}
        onClose={() => setRatingTarget(null)}
      />
    </div>
  );
};
