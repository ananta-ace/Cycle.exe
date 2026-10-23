import React from 'react';
import { TabType } from '../types';
import { useAuth } from '../context/AuthContext';

interface NavbarProps {
  activeTab: TabType;
  onSelectTab: (tab: TabType) => void;
  onOpenAuth: () => void;
  onOpenNotifications: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onSelectTab,
  onOpenAuth,
  onOpenNotifications,
  theme,
  onToggleTheme,
}) => {
  const { user, profile, role, isSuperAdmin, isAdmin, unreadNotificationsCount } = useAuth();

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

        {/* Private Admin HQ Chat (Visible to all Admins & Super Admin) */}
        {isAdmin && (
          <button
            type="button"
            className={`tab admin-chat-tab ${activeTab === 'adminchat' ? 'active' : ''}`}
            onClick={() => onSelectTab('adminchat')}
            title="WhatsApp Admin Chat HQ"
          >
            <i className="fab fa-whatsapp text-emerald-500 text-sm"></i> Admin Chat
          </button>
        )}
      </nav>

      {/* Right-hand utilities & Auth */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Dark / Light Theme Switcher */}
        <button
          type="button"
          onClick={onToggleTheme}
          className="w-10 h-10 rounded-full bg-white border-2 border-zinc-900 shadow-[0_3px_0_#d6d2ca] flex items-center justify-center hover:scale-105 active:scale-95 transition text-base"
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          aria-label="Toggle theme"
        >
          <i className={`fas ${theme === 'dark' ? 'fa-sun text-amber-500' : 'fa-moon text-zinc-700'}`}></i>
        </button>

        {/* Notification Bell (Visible to all users, shows real-time badge when logged in) */}
        <button
          type="button"
          onClick={onOpenNotifications}
          className="relative w-10 h-10 rounded-full bg-white border-2 border-zinc-900 shadow-[0_3px_0_#d6d2ca] flex items-center justify-center text-zinc-800 hover:scale-105 active:scale-95 transition"
          title="Notifications"
          aria-label="Notifications"
        >
          <i className="fas fa-bell text-sm"></i>
          {unreadNotificationsCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center border-2 border-zinc-900 animate-pulse">
              {unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}
            </span>
          )}
        </button>

        {/* Profile / Auth Button */}
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
            <span className="font-bold text-sm max-w-[100px] truncate hidden sm:inline">
              {profile?.displayName || 'Cyclist'}
            </span>
            <span className={`role-badge ${role}`}>{role}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpenAuth}
            className="btn-primary text-sm py-2 px-4 whitespace-nowrap"
          >
            <i className="fas fa-sign-in-alt"></i> Sign In / Join
          </button>
        )}
      </div>
    </div>
  );
};
