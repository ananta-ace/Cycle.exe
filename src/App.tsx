import React, { useState, useEffect } from 'react';
import { TabType, Member } from './types';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { MembersView } from './components/MembersView';
import { MemberModal } from './components/MemberModal';
import { MissionsView } from './components/MissionsView';
import { GalleryView } from './components/GalleryView';
import { CommunityFeed } from './components/CommunityFeed';
import { ProfileView } from './components/ProfileView';
import { AdminDashboard } from './components/AdminDashboard';
import { SuperAdminDashboard } from './components/SuperAdminDashboard';
import { AuthModal } from './components/AuthModal';
import { SuperAdminBootstrapBanner } from './components/SuperAdminBootstrapBanner';
import { ApplicationModal } from './components/ApplicationModal';
import { NotificationsDrawer } from './components/NotificationsDrawer';
import { WelcomeMembershipModal } from './components/WelcomeMembershipModal';
import { AdminChatView } from './components/AdminChatView';

const MainContent: React.FC = () => {
  const { isSuperAdmin, isAdmin } = useAuth();

  const [activeTab, setActiveTab] = useState<TabType>(() => {
    const hash = window.location.hash.toLowerCase().replace('#', '');
    if (
      hash === 'missions' ||
      hash === 'gallery' ||
      hash === 'community' ||
      hash === 'profile' ||
      hash === 'admin' ||
      hash === 'superadmin' ||
      hash === 'adminchat'
    ) {
      return hash as TabType;
    }
    return 'members';
  });

  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [notificationsDrawerOpen, setNotificationsDrawerOpen] = useState(false);

  // Light / Dark Theme State
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('cycle_theme');
      if (saved === 'dark' || saved === 'light') return saved;
    }
    return 'light';
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.body.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
      document.body.classList.remove('dark');
    }
    localStorage.setItem('cycle_theme', theme);
  }, [theme]);

  const handleToggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  // Sync hash with activeTab
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    window.location.hash = tab;
  };

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.toLowerCase().replace('#', '');
      if (
        hash === 'members' ||
        hash === 'missions' ||
        hash === 'gallery' ||
        hash === 'community' ||
        hash === 'profile' ||
        hash === 'admin' ||
        hash === 'superadmin' ||
        hash === 'adminchat'
      ) {
        setActiveTab(hash as TabType);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Keyboard and protection listeners
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey && ['c', 'C', 'x', 'X', 'a', 'A', 'u', 'U', 's', 'S', 'p', 'P'].includes(e.key)) ||
        e.key === 'F12'
      ) {
        e.preventDefault();
      }
    };

    const handleDragStart = (e: DragEvent) => {
      e.preventDefault();
    };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('dragstart', handleDragStart);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('dragstart', handleDragStart);
    };
  }, []);

  return (
    <div className="page">
      <Navbar
        activeTab={activeTab}
        onSelectTab={handleTabChange}
        onOpenAuth={() => setAuthModalOpen(true)}
        onOpenNotifications={() => setNotificationsDrawerOpen(true)}
        theme={theme}
        onToggleTheme={handleToggleTheme}
      />

      {/* Super Admin bootstrap banner if owner email detected */}
      <SuperAdminBootstrapBanner />

      <main>
        {activeTab === 'members' && (
          <MembersView
            onSelectMember={(member) => setSelectedMember(member)}
            onOpenApplyModal={() => setApplyModalOpen(true)}
          />
        )}
        {activeTab === 'community' && <CommunityFeed />}
        {activeTab === 'missions' && <MissionsView />}
        {activeTab === 'gallery' && <GalleryView />}
        {activeTab === 'profile' && <ProfileView />}
        {activeTab === 'admin' && isAdmin && <AdminDashboard />}
        {activeTab === 'superadmin' && isSuperAdmin && <SuperAdminDashboard />}
        {activeTab === 'adminchat' && isAdmin && <AdminChatView />}
      </main>

      <Footer />

      {/* Modals */}
      <MemberModal
        member={selectedMember}
        onClose={() => setSelectedMember(null)}
      />

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
      />

      <ApplicationModal
        isOpen={applyModalOpen}
        onClose={() => setApplyModalOpen(false)}
        onOpenAuth={() => setAuthModalOpen(true)}
      />

      <NotificationsDrawer
        isOpen={notificationsDrawerOpen}
        onClose={() => setNotificationsDrawerOpen(false)}
        onNavigateTab={handleTabChange}
      />

      <WelcomeMembershipModal />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <MainContent />
    </AuthProvider>
  );
};
