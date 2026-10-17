import React from 'react';
import { useAuth } from '../context/AuthContext';

export const WelcomeMembershipModal: React.FC = () => {
  const { user, profile, isSuperAdmin, dismissWelcomeModal } = useAuth();

  if (!user || !profile) return null;

  // Determine if the user is eligible for a welcome modal and hasn't seen it yet
  const isAdminMember = profile.isAdminMember === true || profile.adminMembershipStatus === 'APPROVED';
  const isRegularAdmin = profile.role === 'ADMIN' && !isSuperAdmin;

  // Expected tokens
  const adminMemberToken = 'SEEN_ADMIN_MEMBER_v2';
  const adminToken = 'SEEN_ADMIN_TEAM_v2';

  let showModal = false;
  let title = '';
  let message = '';
  let icon = '';
  let tokenToSave = '';

  if (isRegularAdmin) {
    if (profile.welcomeSeenForRole !== adminToken) {
      showModal = true;
      tokenToSave = adminToken;
      icon = 'fa-trophy';
      title = 'Welcome to the Cycle.exe Admin Team! 🏆';
      message =
        'Your Admin access has been granted by the Super Admin. Please use your moderation and community management permissions responsibly and help keep the cycling community safe.';
    }
  } else if (isAdminMember) {
    if (profile.welcomeSeenForRole !== adminMemberToken) {
      showModal = true;
      tokenToSave = adminMemberToken;
      icon = 'fa-biking';
      title = 'Welcome to the Cycle.exe Admin Members! 🚴';
      message =
        'Congratulations! Your Admin Membership has been officially approved. You can now publish posts, join discussions, select your custom community title, and help shape our cycling rides!';
    }
  }

  if (!showModal) return null;

  const handleContinue = async () => {
    await dismissWelcomeModal(tokenToSave);
  };

  return (
    <div className="modal-overlay open" role="dialog" aria-modal="true">
      <div className="modal max-w-xl text-center p-8 sm:p-10 border-4 border-[#1e1e1e] bg-white rounded-3xl shadow-[0_12px_0_#1e1e1e] animate-in fade-in zoom-in-95 duration-200">
        <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-[#f9c74f] text-[#1e1e1e] border-3 border-[#1e1e1e] flex items-center justify-center text-3xl shadow-[0_4px_0_#1e1e1e]">
          <i className={`fas ${icon}`}></i>
        </div>

        <h2 className="text-2xl font-black tracking-tight text-zinc-900 mb-3">
          {title}
        </h2>

        <p className="text-zinc-700 text-sm leading-relaxed mb-6 font-medium">
          {message}
        </p>

        {isAdminMember && (
          <div className="mb-6 p-3 bg-amber-50 border-2 border-amber-300 rounded-2xl text-xs text-amber-900 text-left flex items-start gap-2.5">
            <i className="fas fa-sparkles text-amber-600 text-base mt-0.5"></i>
            <div>
              <span className="font-bold block text-amber-950">Pro Tip: Choose your custom title!</span>
              Head over to your <strong>Profile</strong> tab to choose a custom community title like <em>"Road Warrior"</em>, <em>"Chill Guy"</em>, or <em>"Cycling Enthusiast"</em>.
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handleContinue}
          className="w-full btn-primary py-3 px-6 text-sm font-black flex items-center justify-center gap-2 rounded-2xl shadow-[0_5px_0_#1e1e1e]"
        >
          <span>Continue to Community</span>
          <i className="fas fa-arrow-right"></i>
        </button>
      </div>
    </div>
  );
};
