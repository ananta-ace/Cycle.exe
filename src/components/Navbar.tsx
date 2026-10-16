import React from 'react';
import { TabType } from '../types';
import { useAuth } from '../context/AuthContext';

interface NavbarProps {
  activeTab: TabType;
  onSelectTab: (tab: TabType) => void;
  onOpenAuth: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ activeTab, onSelectTab, onOpenAuth }) => {
  const { user, profile, role, isSuperAdmin, isAdmin } = useAuth();

  return (
    <div className="topbar">
      <button
        type="button"
        className="brand"
        onClick={() => onSelectTab('members')}
        title="Cycle.exe 2.0"
      >
        <i className="fas fa-terminal"></i> CYCLE<span>.exe</span>
        <span className="ver">2.0</span>
      </button>

      <nav className="tabs" aria-label="Main Navigation">
        <button
          type="button"
          className={`tab ${activeTab === 'members' ? 'active' : ''}`}
          onClick={() => onSelectTab('members')}
        >
          <i className="fas fa-users"></i> Crew
        </button>

        <button
          type="button"
          className={`tab ${activeTab === 'community' ? 'active' : ''}`}
          onClick={() => onSelectTab('community')}
        >
          <i className="fas fa-comments"></i> Community
        </button>

        <button
          type="button"
          className={`tab ${activeTab === 'missions' ? 'active' : ''}`}
          onClick={() => onSelectTab('missions')}
        >
          <i className="fas fa-flag-checkered"></i> Missions
        </button>

        <button
          type="button"
          className={`tab ${activeTab === 'gallery' ? 'active' : ''}`}
          onClick={() => onSelectTab('gallery')}
        >
          <i className="fas fa-images"></i> Gallery
        </button>

        {user && (
          <button
            type="button"
            className={`tab ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => onSelectTab('profile')}
          >
            <i className="fas fa-id-badge"></i> Profile
          </button>
        )}

        {/* Regular Admin Dashboard (Only visible to non-Super Admin admins) */}
        {isAdmin && !isSuperAdmin && (
          <button
            type="button"
            className={`tab admin-tab ${activeTab === 'admin' ? 'active' : ''}`}
            onClick={() => onSelectTab('admin')}
          >
            <i className="fas fa-shield-alt"></i> Moderation
          </button>
        )}

        {/* Super Admin Dashboard (EXCLUSIVELY visible to Super Admin) */}
        {isSuperAdmin && (
          <button
            type="button"
            className={`tab super-tab ${activeTab === 'superadmin' ? 'active' : ''}`}
            onClick={() => onSelectTab('superadmin')}
          >
            <i className="fas fa-crown"></i> Super Admin
          </button>
        )}
      </nav>

      {/* Auth / Profile Button */}
      <div className="flex items-center gap-3">
        {user ? (
          <button
            type="button"
            onClick={() => onSelectTab('profile')}
            className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-full border-2 border-zinc-900 shadow-[0_3px_0_#d6d2ca] hover:bg-zinc-50 transition"
          >
            <div className="w-7 h-7 rounded-full bg-zinc-200 border border-zinc-900 flex items-center justify-center font-bold text-xs overflow-hidden">
              {profile?.photoURL ? (
                <img
                  src={profile.photoURL}
                  alt={profile.displayName}
                  className="w-full h-full object-cover"
                />
              ) : (
                profile?.displayName?.charAt(0).toUpperCase() || 'U'
              )}
            </div>
            <span className="font-bold text-sm max-w-[100px] truncate">
              {profile?.displayName || 'Cyclist'}
            </span>
            <span className={`role-badge ${role}`}>{role}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpenAuth}
            className="btn-primary text-sm py-2 px-4"
          >
            <i className="fas fa-sign-in-alt"></i> Sign In / Join
          </button>
        )}
      </div>
    </div>
  );
};
