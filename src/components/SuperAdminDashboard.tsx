import React, { useState, useEffect } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  updateDoc,
  setDoc,
  deleteDoc,
  addDoc,
  doc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth, DESIGNATED_SUPER_ADMIN_EMAIL } from '../context/AuthContext';
import {
  UserProfile,
  InvitationCodeSummary,
  SuperAdminStats,
  AdminMembershipApplication,
  Member,
} from '../types';
import { uploadImage } from '../utils/imageUpload';

export const SuperAdminDashboard: React.FC = () => {
  const { user, isSuperAdmin, role } = useAuth();

  // All registered users from Firestore
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(true);

  // User Profile Inspection Modal (Requirement 6)
  const [inspectingUser, setInspectingUser] = useState<UserProfile | null>(null);

  // Home Screen Featured Members (Requirement 5)
  const [featuredMembers, setFeaturedMembers] = useState<Member[]>([]);
  const [loadingFeatured, setLoadingFeatured] = useState(true);
  const [editingFeaturedMember, setEditingFeaturedMember] = useState<Member | null>(null);
  const [isCreatingCustomFeatured, setIsCreatingCustomFeatured] = useState(false);
  const [selectedUserToFeature, setSelectedUserToFeature] = useState<string>('');

  // Featured Member Form Fields
  const [featName, setFeatName] = useState('');
  const [featTitle, setFeatTitle] = useState('');
  const [featImg, setFeatImg] = useState('');
  const [featActive, setFeatActive] = useState(true);
  const [featAttend, setFeatAttend] = useState('Active Rider');
  const [featPerfect, setFeatPerfect] = useState(false);
  const [featBio, setFeatBio] = useState('');
  const [featBadges, setFeatBadges] = useState<string[]>([]);
  const [featCompletedRaces, setFeatCompletedRaces] = useState<string[]>([]);
  const [featOrder, setFeatOrder] = useState<number>(1);
  const [newBadgeText, setNewBadgeText] = useState('');
  const [newRaceText, setNewRaceText] = useState('');
  const [uploadingFeatImg, setUploadingFeatImg] = useState(false);
  const [featSaving, setFeatSaving] = useState(false);

  // Applications
  const [applications, setApplications] = useState<AdminMembershipApplication[]>([]);
  const [loadingApps, setLoadingApps] = useState(true);
  const [appFilter, setAppFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED'>('ALL');

  // Title editor
  const [editingTitleUser, setEditingTitleUser] = useState<UserProfile | null>(null);
  const [newTitleValue, setNewTitleValue] = useState('');

  // Server stats & analytics
  const [stats, setStats] = useState<SuperAdminStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  // Invitation codes (Requirement 1: Admin Invitation System)
  const [invitations, setInvitations] = useState<InvitationCodeSummary[]>([]);
  const [targetInviteRole, setTargetInviteRole] = useState<'ADMIN' | 'MEMBER'>('ADMIN');
  const [newGeneratedCode, setNewGeneratedCode] = useState<string | null>(null);
  const [newGeneratedRole, setNewGeneratedRole] = useState<'ADMIN' | 'MEMBER' | null>(null);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [slotLimit, setSlotLimit] = useState(5);
  const [customSlotLimit, setCustomSlotLimit] = useState('5');

  // Active sub-tab in Super Admin view
  const [adminTab, setAdminTab] = useState<
    'featured' | 'users' | 'analytics' | 'invitations' | 'applications' | 'audit'
  >('featured');

  // 1. Fetch real users from Firestore
  useEffect(() => {
    if (!isSuperAdmin) return;
    const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: UserProfile[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<UserProfile, 'id'>) }));
        setAllUsers(list);
        setLoadingUsers(false);
      },
      (err) => {
        console.error('Error fetching all users:', err);
        setLoadingUsers(false);
      }
    );

    // Listen to membership applications
    const appsQuery = query(collection(db, 'applications'), orderBy('createdAt', 'desc'));
    const unsubApps = onSnapshot(
      appsQuery,
      (snap) => {
        const list: AdminMembershipApplication[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<AdminMembershipApplication, 'id'>) }));
        setApplications(list);
        setLoadingApps(false);
      },
      (err) => {
        console.error('Error fetching applications:', err);
        setLoadingApps(false);
      }
    );

    // Listen to featured members for home screen management
    const featQuery = query(collection(db, 'featuredMembers'), orderBy('order', 'asc'));
    const unsubFeat = onSnapshot(
      featQuery,
      (snap) => {
        const list: Member[] = [];
        snap.forEach((d) => {
          const data = d.data();
          list.push({
            id: d.id,
            userId: data.userId || d.id,
            name: data.name || '',
            title: data.title || '',
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
            completedRacesCount:
              data.completedRacesCount ||
              (Array.isArray(data.completedRaces) ? data.completedRaces.length : 0),
            order: data.order !== undefined ? data.order : 0,
            isCustomMember: true,
          });
        });
        setFeaturedMembers(list);
        setLoadingFeatured(false);
      },
      (err) => {
        console.error('Error fetching featured members:', err);
        setLoadingFeatured(false);
      }
    );

    return () => {
      unsub();
      unsubApps();
      unsubFeat();
    };
  }, [isSuperAdmin]);

  // Approve Admin Membership Application
  const handleApproveApp = async (app: AdminMembershipApplication) => {
    if (!user || !isSuperAdmin) return;
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'applications', app.id), {
        status: 'APPROVED',
        reviewedBy: user.uid,
        reviewedAt: now,
        updatedAt: now,
      });

      await updateDoc(doc(db, 'users', app.userId), {
        isAdminMember: true,
        role: 'ADMIN',
        adminMembershipStatus: 'APPROVED',
        customTitle: app.requestedTitle || 'Admin Member',
        isSuspended: false,
        updatedAt: now,
      });

      // Send congratulations notification
      await addDoc(collection(db, 'notifications'), {
        recipientId: app.userId,
        type: 'APPLICATION_APPROVED',
        title: 'Admin Membership Approved! 🚴',
        message:
          'Congratulations! Your Admin Membership application was approved by the Super Admin. You are now an official Cycle.exe Admin Member.',
        isRead: false,
        createdAt: now,
      });

      alert(`Approved ${app.applicantName} as an Admin Member!`);
    } catch (err: unknown) {
      console.error('Error approving application:', err);
      alert(err instanceof Error ? err.message : 'Failed to approve application');
    }
  };

  // Reject Application
  const handleRejectApp = async (app: AdminMembershipApplication) => {
    if (!user || !isSuperAdmin) return;
    const reason = prompt('Please enter a rejection reason (optional):') || 'Requirements not met at this time.';

    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'applications', app.id), {
        status: 'REJECTED',
        rejectionReason: reason,
        reviewedBy: user.uid,
        reviewedAt: now,
        updatedAt: now,
      });

      await updateDoc(doc(db, 'users', app.userId), {
        adminMembershipStatus: 'REJECTED',
        updatedAt: now,
      });

      await addDoc(collection(db, 'notifications'), {
        recipientId: app.userId,
        type: 'APPLICATION_REJECTED',
        title: 'Application Status Update',
        message: `Your application for Admin Membership was not approved. Note: "${reason}"`,
        isRead: false,
        createdAt: now,
      });

      alert(`Application for ${app.applicantName} marked as rejected.`);
    } catch (err: unknown) {
      console.error('Error rejecting application:', err);
      alert(err instanceof Error ? err.message : 'Failed to reject application');
    }
  };

  // Suspend Admin Member
  const handleSuspendAdminMember = async (targetUserId: string, name: string) => {
    if (!user || !isSuperAdmin) return;
    if (!confirm(`Are you sure you want to suspend Admin Member privileges for ${name}?`)) return;

    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'users', targetUserId), {
        isAdminMember: false,
        adminMembershipStatus: 'SUSPENDED',
        isSuspended: true,
        updatedAt: now,
      });

      try {
        await updateDoc(doc(db, 'applications', targetUserId), {
          status: 'SUSPENDED',
          updatedAt: now,
        });
      } catch {
        // App record might not exist if manually promoted
      }

      await addDoc(collection(db, 'notifications'), {
        recipientId: targetUserId,
        type: 'STATUS_CHANGED',
        title: 'Admin Membership Suspended',
        message:
          'Your Admin Member privileges have been suspended by the Super Admin. You retain ordinary account access.',
        isRead: false,
        createdAt: now,
      });

      alert(`Suspended Admin Member privileges for ${name}.`);
    } catch (err: unknown) {
      console.error('Error suspending member:', err);
      alert(err instanceof Error ? err.message : 'Failed to suspend member');
    }
  };

  // Reinstate Admin Member
  const handleReinstateAdminMember = async (targetUserId: string, name: string) => {
    if (!user || !isSuperAdmin) return;
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'users', targetUserId), {
        isAdminMember: true,
        adminMembershipStatus: 'APPROVED',
        isSuspended: false,
        updatedAt: now,
      });

      try {
        await updateDoc(doc(db, 'applications', targetUserId), {
          status: 'APPROVED',
          updatedAt: now,
        });
      } catch {
        // App record might not exist
      }

      await addDoc(collection(db, 'notifications'), {
        recipientId: targetUserId,
        type: 'STATUS_CHANGED',
        title: 'Admin Membership Reinstated',
        message: 'Your Admin Member privileges have been reinstated by the Super Admin. Welcome back!',
        isRead: false,
        createdAt: now,
      });

      alert(`Reinstated Admin Member ${name}.`);
    } catch (err: unknown) {
      console.error('Error reinstating member:', err);
      alert(err instanceof Error ? err.message : 'Failed to reinstate member');
    }
  };

  // Remove someone from the Admin Member panel without deleting their account
  const handleRemoveFromAdminPanel = async (targetUserId: string, name: string) => {
    if (!user || !isSuperAdmin) return;
    if (!confirm(`Are you sure you want to remove ${name} from the Admin Member directory? Their regular account and personal data will be preserved.`)) return;

    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'users', targetUserId), {
        isAdminMember: false,
        adminMembershipStatus: 'NONE',
        role: 'PUBLIC',
        updatedAt: now,
      });

      try {
        await updateDoc(doc(db, 'applications', targetUserId), {
          status: 'REJECTED',
          updatedAt: now,
        });
      } catch {
        // Fallback
      }

      alert(`Removed ${name} from Admin Member directory.`);
    } catch (err: unknown) {
      console.error('Error removing from panel:', err);
      alert(err instanceof Error ? err.message : 'Failed to remove from panel');
    }
  };

  // Save edited custom title
  const handleSaveCustomTitle = async () => {
    if (!editingTitleUser || !newTitleValue.trim()) return;
    try {
      await updateDoc(doc(db, 'users', editingTitleUser.id), {
        customTitle: newTitleValue.trim(),
        updatedAt: new Date().toISOString(),
      });
      setEditingTitleUser(null);
      alert('Custom community title updated!');
    } catch (err: unknown) {
      console.error('Error updating title:', err);
      alert('Failed to update title');
    }
  };

  // 2. Fetch server-side Super Admin stats
  const fetchStats = async () => {
    if (!user) return;
    try {
      setLoadingStats(true);
      const res = await fetch('/api/admin/stats', {
        headers: {
          'x-user-id': user.uid,
          'x-user-email': user.email || '',
          'x-user-role': role,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Error fetching admin stats:', err);
    } finally {
      setLoadingStats(false);
    }
  };

  // 3. Fetch invitation codes
  const fetchInvitations = async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/invitations', {
        headers: {
          'x-user-id': user.uid,
          'x-user-email': user.email || '',
          'x-user-role': role,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setInvitations(data.codes || []);
        if (data.slotLimit) {
          setSlotLimit(data.slotLimit);
          setCustomSlotLimit(String(data.slotLimit));
        }
      }
    } catch (err) {
      console.error('Error fetching invitations:', err);
    }
  };

  useEffect(() => {
    if (isSuperAdmin) {
      fetchStats();
      fetchInvitations();
    }
  }, [isSuperAdmin]);

  // Generate new code (Admin or Member)
  const handleGenerateCode = async () => {
    if (!user) return;
    try {
      setGeneratingCode(true);
      const res = await fetch('/api/invitations/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.uid,
          'x-user-email': user.email || '',
          'x-user-role': role,
        },
        body: JSON.stringify({ targetRole: targetInviteRole, expiryDays: 30 }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate code');

      setNewGeneratedCode(data.code);
      setNewGeneratedRole(data.targetRole || targetInviteRole);
      fetchInvitations();
      fetchStats();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error generating code');
    } finally {
      setGeneratingCode(false);
    }
  };

  // ------------------------------------------------------------------
  // Featured Members Management Handlers (Requirement 5)
  // ------------------------------------------------------------------
  const handleOpenEditFeatured = (m: Member) => {
    setEditingFeaturedMember(m);
    setIsCreatingCustomFeatured(false);
    setFeatName(m.name || '');
    setFeatTitle(m.title || '');
    setFeatImg(m.img || '');
    setFeatActive(m.active !== false);
    setFeatAttend(m.attend || 'Active Rider');
    setFeatPerfect(!!m.perfect);
    setFeatBio(m.bio || '');
    setFeatBadges(m.badges || []);
    setFeatCompletedRaces(m.completedRaces || []);
    setFeatOrder(m.order !== undefined ? m.order : 1);
  };

  const handleOpenAddCustomFeatured = () => {
    setEditingFeaturedMember(null);
    setIsCreatingCustomFeatured(true);
    setFeatName('');
    setFeatTitle('Cycle.exe Crew Leader');
    setFeatImg('');
    setFeatActive(true);
    setFeatAttend('Active Rider');
    setFeatPerfect(false);
    setFeatBio('');
    setFeatBadges(['Verified Rider', 'Cycle.exe Crew']);
    setFeatCompletedRaces(['Mission 001: Midnight Sprint']);
    setFeatOrder(featuredMembers.length + 1);
  };

  const handleFeatureRegisteredUser = async (targetUserId: string) => {
    const targetUser = allUsers.find((u) => u.id === targetUserId);
    if (!targetUser) return;

    try {
      const now = new Date().toISOString();
      const newFeatData: Omit<Member, 'id'> = {
        userId: targetUser.id,
        name: targetUser.displayName || 'Rider',
        title: targetUser.customTitle || (targetUser.role === 'SUPER_ADMIN' ? 'Executive Lead' : targetUser.role === 'ADMIN' ? 'Admin Crew Leader' : 'Admin Member'),
        img: targetUser.photoURL || '',
        initial: (targetUser.displayName || 'R').charAt(0).toUpperCase(),
        active: !targetUser.isSuspended,
        attend: 'Active Rider',
        perfect: false,
        bio: targetUser.bio || '',
        ratingAverage: targetUser.ratingAverage || 0,
        ratingCount: targetUser.ratingCount || 0,
        badges: ['Verified Rider', 'Cycle.exe Crew'],
        completedRaces: ['Mission 001: Midnight Sprint'],
        completedRacesCount: 1,
        order: featuredMembers.length + 1,
        isCustomMember: true,
      };

      await setDoc(doc(db, 'featuredMembers', targetUser.id), {
        ...newFeatData,
        createdAt: now,
        updatedAt: now,
      });

      setSelectedUserToFeature('');
      // Open editor so Super Admin can customize completed races & badges right away
      handleOpenEditFeatured({
        id: targetUser.id,
        ...newFeatData,
      });
    } catch (err) {
      console.error('Error featuring user on home screen:', err);
      alert('Failed to feature user on home screen');
    }
  };

  const handleSaveFeaturedMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!featName.trim()) {
      alert('Please enter a rider name');
      return;
    }

    try {
      setFeatSaving(true);
      const now = new Date().toISOString();
      const payload: Partial<Member> & { updatedAt: string } = {
        name: featName.trim(),
        title: featTitle.trim() || 'Cycle.exe Crew Leader',
        img: featImg.trim(),
        initial: featName.trim().charAt(0).toUpperCase(),
        active: featActive,
        attend: featAttend.trim() || 'Active Rider',
        perfect: featPerfect,
        bio: featBio.trim(),
        badges: featBadges.filter((b) => b.trim().length > 0),
        completedRaces: featCompletedRaces.filter((r) => r.trim().length > 0),
        completedRacesCount: featCompletedRaces.filter((r) => r.trim().length > 0).length,
        order: Number(featOrder) || 1,
        updatedAt: now,
      };

      if (editingFeaturedMember) {
        await setDoc(doc(db, 'featuredMembers', editingFeaturedMember.id), payload, { merge: true });
      } else {
        await addDoc(collection(db, 'featuredMembers'), {
          ...payload,
          ratingAverage: 0,
          ratingCount: 0,
          createdAt: now,
        });
      }

      setEditingFeaturedMember(null);
      setIsCreatingCustomFeatured(false);
    } catch (err) {
      console.error('Error saving featured member:', err);
      alert('Failed to save featured member');
    } finally {
      setFeatSaving(false);
    }
  };

  const handleDeleteFeaturedMember = async (memberId: string, memberName: string) => {
    if (!confirm(`Are you sure you want to remove "${memberName}" from the Home Screen?`)) return;
    try {
      await deleteDoc(doc(db, 'featuredMembers', memberId));
    } catch (err) {
      console.error('Error deleting featured member:', err);
      alert('Failed to delete featured member');
    }
  };

  const handleAddBadge = (bText: string) => {
    const clean = bText.trim();
    if (clean && !featBadges.includes(clean)) {
      setFeatBadges((prev) => [...prev, clean]);
      setNewBadgeText('');
    }
  };

  const handleRemoveBadge = (idx: number) => {
    setFeatBadges((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleAddRace = (rText: string) => {
    const clean = rText.trim();
    if (clean && !featCompletedRaces.includes(clean)) {
      setFeatCompletedRaces((prev) => [...prev, clean]);
      setNewRaceText('');
    }
  };

  const handleRemoveRace = (idx: number) => {
    setFeatCompletedRaces((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleUploadFeatPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploadingFeatImg(true);
      const url = await uploadImage(file);
      setFeatImg(url);
    } catch (err) {
      console.error('Upload error:', err);
      alert('Failed to upload image. Please try again.');
    } finally {
      setUploadingFeatImg(false);
    }
  };

  // Revoke code
  const handleRevokeCode = async (codeId: string) => {
    if (!user) return;
    if (!confirm('Are you sure you want to revoke this invitation code?')) return;

    try {
      const res = await fetch('/api/invitations/revoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.uid,
          'x-user-email': user.email || '',
          'x-user-role': role,
        },
        body: JSON.stringify({ codeId }),
      });
      if (res.ok) {
        fetchInvitations();
        fetchStats();
      }
    } catch (err) {
      console.error('Error revoking code:', err);
    }
  };

  // Update member slot limit
  const handleUpdateSlotLimit = async () => {
    if (!user) return;
    const limitNum = Number(customSlotLimit);
    if (isNaN(limitNum) || limitNum < 1) {
      alert('Please enter a valid positive number');
      return;
    }

    try {
      const res = await fetch('/api/invitations/update-limit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.uid,
          'x-user-email': user.email || '',
          'x-user-role': role,
        },
        body: JSON.stringify({ limit: limitNum }),
      });
      if (res.ok) {
        setSlotLimit(limitNum);
        alert(`Member slot limit updated to ${limitNum}`);
      }
    } catch (err) {
      console.error('Update limit error:', err);
    }
  };

  // Super Admin change role
  const handleChangeRole = async (targetUser: UserProfile, newRole: string) => {
    if (!user) return;
    if (targetUser.email.toLowerCase() === DESIGNATED_SUPER_ADMIN_EMAIL.toLowerCase()) {
      alert('The Super Admin account role cannot be changed.');
      return;
    }

    try {
      // 1. Server audit check
      await fetch('/api/admin/roles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.uid,
          'x-user-email': user.email || '',
          'x-user-role': role,
        },
        body: JSON.stringify({
          targetUserId: targetUser.id,
          targetUserEmail: targetUser.email,
          newRole,
          action: `SET_ROLE_TO_${newRole}`,
        }),
      });

      // 2. Update Firestore document
      await updateDoc(doc(db, 'users', targetUser.id), {
        role: newRole,
        updatedAt: new Date().toISOString(),
      });

      fetchStats();
    } catch (err) {
      console.error('Role update error:', err);
      alert('Failed to update user role');
    }
  };

  // Toggle account suspension
  const handleToggleSuspend = async (targetUser: UserProfile) => {
    if (!user) return;
    if (targetUser.email.toLowerCase() === DESIGNATED_SUPER_ADMIN_EMAIL.toLowerCase()) {
      alert('The Super Admin account cannot be suspended.');
      return;
    }

    const nextState = !targetUser.isSuspended;
    try {
      await fetch('/api/admin/roles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.uid,
          'x-user-email': user.email || '',
          'x-user-role': role,
        },
        body: JSON.stringify({
          targetUserId: targetUser.id,
          targetUserEmail: targetUser.email,
          isSuspended: nextState,
          action: nextState ? 'SUSPEND_USER' : 'REACTIVATE_USER',
        }),
      });

      await updateDoc(doc(db, 'users', targetUser.id), {
        isSuspended: nextState,
        updatedAt: new Date().toISOString(),
      });

      fetchStats();
    } catch (err) {
      console.error('Suspension toggle error:', err);
    }
  };

  if (!isSuperAdmin) {
    return (
      <div className="neo-card max-w-md mx-auto text-center py-12">
        <i className="fas fa-crown text-4xl text-amber-500 mb-3"></i>
        <h2 className="text-xl font-bold mb-1">Super Admin Clearance Required</h2>
        <p className="text-xs text-zinc-600">
          This dashboard is strictly protected and only accessible to the primary owner of Cycle.exe.
        </p>
      </div>
    );
  }

  // Calculate real metrics from Firestore users list
  const totalUsers = allUsers.length;
  const publicCount = allUsers.filter((u) => u.role === 'PUBLIC').length;
  const memberCount = allUsers.filter((u) => u.role === 'MEMBER').length;
  const adminCount = allUsers.filter((u) => u.role === 'ADMIN').length;
  const superAdminCount = allUsers.filter((u) => u.role === 'SUPER_ADMIN').length;

  const filteredUsers = allUsers.filter(
    (u) =>
      u.displayName.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.email.toLowerCase().includes(userSearch.toLowerCase())
  );

  return (
    <div className="space-y-8">
      {/* Super Admin Top Header */}
      <div className="neo-card p-6 sm:p-8 bg-[#fff7ed] border-2 border-[#b45309] shadow-[0_8px_0_#fed7aa]">
        <div className="flex items-center justify-between flex-wrap gap-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-[#1e1e1e] text-[#f9c74f] border-2 border-[#1e1e1e] flex items-center justify-center font-bold text-2xl shadow-[0_4px_0_#b1b1b1] shrink-0">
              <i className="fas fa-crown"></i>
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl sm:text-3xl font-black text-zinc-900">Super Admin Control Hub</h1>
                <span className="role-badge SUPER_ADMIN">EXECUTIVE</span>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 border border-emerald-400 text-emerald-900 text-xs font-black shadow-sm">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span>{stats?.activeSessionsCount || 1} Live Visitor{(stats?.activeSessionsCount || 1) === 1 ? '' : 's'} Online</span>
                </div>
              </div>
              <p className="text-xs sm:text-sm text-zinc-700 mt-1">
                Logged in as <strong>{user?.email}</strong>. Sole executive authority for Cycle.exe.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 bg-white p-1.5 rounded-full border-2 border-zinc-900 shadow-[0_3px_0_#d6d2ca]">
            <button
              type="button"
              onClick={() => setAdminTab('featured')}
              className={`text-xs sm:text-sm font-bold py-2 px-4 rounded-full transition flex items-center gap-1.5 ${
                adminTab === 'featured' ? 'bg-[#1e1e1e] text-[#f9c74f]' : 'text-zinc-700 hover:bg-zinc-100'
              }`}
            >
              <i className="fas fa-home text-amber-400"></i>
              <span>Home Screen Featured ({featuredMembers.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setAdminTab('users')}
              className={`text-xs sm:text-sm font-bold py-2 px-4 rounded-full transition ${
                adminTab === 'users' ? 'bg-[#1e1e1e] text-[#f9c74f]' : 'text-zinc-700 hover:bg-zinc-100'
              }`}
            >
              <i className="fas fa-users-cog mr-1.5"></i> Users ({totalUsers})
            </button>
            <button
              type="button"
              onClick={() => setAdminTab('analytics')}
              className={`text-xs font-bold py-1.5 px-3.5 rounded-full transition flex items-center gap-1.5 ${
                adminTab === 'analytics' ? 'bg-[#1e1e1e] text-[#f9c74f]' : 'text-zinc-700 hover:bg-zinc-100'
              }`}
            >
              <i className="fas fa-chart-line mr-1"></i> Live Visitors ({stats?.activeSessionsCount || 0})
            </button>
            <button
              type="button"
              onClick={() => setAdminTab('invitations')}
              className={`text-xs font-bold py-1.5 px-3.5 rounded-full transition ${
                adminTab === 'invitations' ? 'bg-[#1e1e1e] text-[#f9c74f]' : 'text-zinc-700 hover:bg-zinc-100'
              }`}
            >
              <i className="fas fa-ticket-alt mr-1"></i> Invitations
            </button>
            <button
              type="button"
              onClick={() => setAdminTab('applications')}
              className={`text-xs sm:text-sm font-bold py-2 px-4 rounded-full transition flex items-center gap-2 ${
                adminTab === 'applications' ? 'bg-[#1e1e1e] text-[#f9c74f]' : 'text-zinc-700 hover:bg-zinc-100'
              }`}
            >
              <i className="fas fa-id-card"></i>
              <span>Applications</span>
              {applications.filter((a) => a.status === 'PENDING').length > 0 && (
                <span className="w-5 h-5 rounded-full bg-amber-500 text-black text-[10px] font-black flex items-center justify-center">
                  {applications.filter((a) => a.status === 'PENDING').length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setAdminTab('audit')}
              className={`text-xs font-bold py-1.5 px-3.5 rounded-full transition ${
                adminTab === 'audit' ? 'bg-[#1e1e1e] text-[#f9c74f]' : 'text-zinc-700 hover:bg-zinc-100'
              }`}
            >
              <i className="fas fa-history mr-1"></i> Logs
            </button>
          </div>
        </div>
      </div>

      {/* TAB: HOME SCREEN FEATURED MEMBERS MANAGEMENT (Requirement 5) */}
      {adminTab === 'featured' && (
        <div className="space-y-6">
          <div className="neo-card">
            <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <i className="fas fa-star text-amber-500"></i> Home Screen Featured Members
                </h2>
                <p className="text-xs text-zinc-600 mt-0.5">
                  Choose exactly which riders appear on the Cycle.exe home screen. Manage their completed races, badges, titles, and stats.
                </p>
              </div>

              <button
                type="button"
                onClick={handleOpenAddCustomFeatured}
                className="btn-primary py-2 px-4 text-xs font-black flex items-center gap-1.5 shadow-[0_3px_0_#1e1e1e]"
              >
                <i className="fas fa-user-plus"></i> Add Custom Crew Leader
              </button>
            </div>

            {/* Quick Feature from Registered Users */}
            <div className="p-4 bg-[#fbf9f4] border-2 border-zinc-900 rounded-2xl mb-6 shadow-sm">
              <label className="block text-xs font-black uppercase tracking-wider mb-2 text-zinc-800">
                <i className="fas fa-user-check text-amber-600 mr-1"></i> Feature A Registered User On Home Screen
              </label>
              <div className="flex flex-col sm:flex-row gap-3">
                <select
                  value={selectedUserToFeature}
                  onChange={(e) => setSelectedUserToFeature(e.target.value)}
                  className="neo-input text-xs py-2.5 flex-1 font-bold bg-white"
                >
                  <option value="">-- Select a registered rider account to feature --</option>
                  {allUsers
                    .filter((u) => !featuredMembers.some((fm) => fm.userId === u.id || fm.id === u.id))
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.displayName} ({u.email}) — [{u.role}]
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  disabled={!selectedUserToFeature}
                  onClick={() => handleFeatureRegisteredUser(selectedUserToFeature)}
                  className="btn-secondary py-2.5 px-5 text-xs font-black whitespace-nowrap disabled:opacity-50 flex items-center gap-1.5"
                >
                  <i className="fas fa-plus"></i> Add To Home Screen
                </button>
              </div>
              <p className="text-[11px] text-zinc-500 mt-2">
                Selecting a rider imports their profile and places them on the home screen leadership grid where you can update their completed races and badges.
              </p>
            </div>

            {/* Featured Members Cards Grid */}
            {loadingFeatured ? (
              <div className="text-center py-12 text-zinc-500 font-bold text-sm">
                <i className="fas fa-spinner fa-spin text-2xl mb-2 block"></i> Loading featured members...
              </div>
            ) : featuredMembers.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed border-zinc-300 rounded-2xl bg-zinc-50">
                <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-2xl border-2 border-amber-400">
                  <i className="fas fa-users-slash"></i>
                </div>
                <h3 className="font-bold text-zinc-800 text-base mb-1">No Members Featured On Home Screen</h3>
                <p className="text-xs text-zinc-500 max-w-md mx-auto mb-4">
                  All previous static crew members have been removed. Use the dropdown above to choose which users appear on the home screen.
                </p>
                <button
                  type="button"
                  onClick={handleOpenAddCustomFeatured}
                  className="btn-primary py-2 px-4 text-xs font-black inline-flex items-center gap-1.5"
                >
                  <i className="fas fa-plus"></i> Add First Featured Member
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {featuredMembers.map((fm, idx) => (
                  <div
                    key={fm.id}
                    className="p-5 bg-white border-2 border-zinc-900 rounded-2xl shadow-[0_4px_0_#d6d2ca] flex flex-col justify-between relative group hover:border-black transition"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-full border-2 border-zinc-900 bg-zinc-100 overflow-hidden flex items-center justify-center font-black text-lg text-zinc-700 shrink-0">
                            {fm.img ? (
                              <img src={fm.img} alt={fm.name} className="w-full h-full object-cover" />
                            ) : (
                              fm.initial
                            )}
                          </div>
                          <div>
                            <div className="font-black text-zinc-900 text-base flex items-center gap-1.5">
                              <span>{fm.name}</span>
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-100 border border-zinc-300 text-zinc-600">
                                #{fm.order ?? idx + 1}
                              </span>
                            </div>
                            <div className="text-xs font-bold text-amber-800 bg-[#f9c74f]/30 px-2 py-0.5 rounded-full inline-block mt-0.5 border border-[#f9c74f]">
                              {fm.title}
                            </div>
                          </div>
                        </div>

                        <span
                          className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
                            fm.active
                              ? 'bg-emerald-100 border-emerald-400 text-emerald-800'
                              : 'bg-zinc-100 border-zinc-300 text-zinc-600'
                          }`}
                        >
                          {fm.active ? 'Active' : 'Inactive'}
                        </span>
                      </div>

                      {/* Attendance & Races */}
                      <div className="flex items-center gap-2 text-xs font-bold text-zinc-700 mb-2">
                        <span className="flex items-center gap-1 text-emerald-700">
                          <i className={`fas ${fm.perfect ? 'fa-medal text-amber-500' : 'fa-check'}`}></i>
                          {fm.attend || 'Regular Rider'}
                        </span>
                        <span>•</span>
                        <span>{fm.completedRaces?.length || 0} Completed Races</span>
                      </div>

                      {/* Bio preview */}
                      {fm.bio && (
                        <p className="text-xs text-zinc-600 italic line-clamp-2 mb-3 bg-zinc-50 p-2 rounded-lg border border-zinc-200">
                          "{fm.bio}"
                        </p>
                      )}

                      {/* Badges preview */}
                      {fm.badges && fm.badges.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-3">
                          {fm.badges.map((b, bIdx) => (
                            <span
                              key={bIdx}
                              className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 border border-amber-300 text-amber-950"
                            >
                              <i className="fas fa-award text-amber-600 mr-1 text-[9px]"></i>
                              {b}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Completed Races preview */}
                      {fm.completedRaces && fm.completedRaces.length > 0 && (
                        <div className="mb-3">
                          <span className="text-[10px] font-black uppercase text-zinc-400 block mb-1">
                            Completed Races ({fm.completedRaces.length}):
                          </span>
                          <div className="space-y-1">
                            {fm.completedRaces.slice(0, 2).map((r, rIdx) => (
                              <div
                                key={rIdx}
                                className="text-[11px] font-semibold text-zinc-700 truncate flex items-center gap-1"
                              >
                                <i className="fas fa-flag-checkered text-[10px] text-zinc-400"></i>
                                <span>{r}</span>
                              </div>
                            ))}
                            {fm.completedRaces.length > 2 && (
                              <span className="text-[10px] text-zinc-400 font-bold block">
                                +{fm.completedRaces.length - 2} more races
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Rating info */}
                      <div className="text-xs font-bold text-zinc-600 mb-4 flex items-center gap-1">
                        <i className="fas fa-star text-amber-500"></i>
                        <span>
                          {fm.ratingAverage ? fm.ratingAverage.toFixed(1) : 'No ratings yet'}{' '}
                          {fm.ratingCount ? `(${fm.ratingCount})` : ''}
                        </span>
                      </div>
                    </div>

                    {/* Card Actions */}
                    <div className="pt-3 border-t border-zinc-200 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => handleOpenEditFeatured(fm)}
                        className="btn-secondary py-1.5 px-3 text-xs font-bold flex-1 flex items-center justify-center gap-1"
                      >
                        <i className="fas fa-pencil-alt text-amber-700"></i> Edit Profile &amp; Races
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteFeaturedMember(fm.id, fm.name)}
                        className="py-1.5 px-3 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-300 rounded-xl transition flex items-center gap-1"
                        title="Remove from home screen"
                      >
                        <i className="fas fa-trash-alt"></i> Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 0: ADMIN MEMBERSHIP APPLICATIONS */}
      {adminTab === 'applications' && (
        <div className="space-y-6">
          <div className="neo-card">
            <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <i className="fas fa-id-card text-amber-600"></i> Admin Membership Applications
                </h2>
                <p className="text-xs text-zinc-600">
                  Review applicant motivation, cycling experience, and make final approval or suspension decisions.
                </p>
              </div>

              <div className="flex gap-1.5 flex-wrap">
                {(['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setAppFilter(filter)}
                    className={`text-xs font-bold py-1 px-3 rounded-full border border-zinc-900 transition ${
                      appFilter === filter
                        ? 'bg-zinc-900 text-white'
                        : 'bg-white text-zinc-700 hover:bg-zinc-100'
                    }`}
                  >
                    {filter}
                    {filter === 'PENDING' && (
                      <span className="ml-1 px-1.5 py-0.2 rounded-full bg-amber-500 text-black text-[10px]">
                        {applications.filter((a) => a.status === 'PENDING').length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {loadingApps ? (
              <div className="py-8 text-center text-xs font-bold text-zinc-500">
                <i className="fas fa-spinner fa-spin mr-2"></i> Loading applications...
              </div>
            ) : applications.length === 0 ? (
              <div className="py-12 text-center text-zinc-400">
                <i className="fas fa-inbox text-3xl mb-2 block opacity-40"></i>
                <p className="font-bold text-sm text-zinc-600">No applications found</p>
                <p className="text-xs text-zinc-400">
                  Applications submitted by registered riders will appear here in real time.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {applications
                  .filter((a) => (appFilter === 'ALL' ? true : a.status === appFilter))
                  .map((app) => (
                    <div
                      key={app.id}
                      className="p-4 bg-zinc-50 border-2 border-zinc-900 rounded-2xl shadow-[0_3px_0_#d6d2ca]"
                    >
                      <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-full bg-zinc-200 border-2 border-zinc-900 overflow-hidden flex items-center justify-center font-bold text-sm shrink-0">
                            {app.applicantPhotoURL ? (
                              <img
                                src={app.applicantPhotoURL}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              app.applicantName.charAt(0).toUpperCase()
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-black text-base text-zinc-900">
                                {app.applicantName}
                              </h3>
                              <span
                                className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${
                                  app.status === 'PENDING'
                                    ? 'bg-amber-100 text-amber-900 border-amber-400'
                                    : app.status === 'APPROVED'
                                    ? 'bg-emerald-100 text-emerald-900 border-emerald-400'
                                    : app.status === 'REJECTED'
                                    ? 'bg-rose-100 text-rose-900 border-rose-400'
                                    : 'bg-zinc-200 text-zinc-800 border-zinc-400'
                                }`}
                              >
                                {app.status}
                              </span>
                            </div>
                            <p className="text-xs text-zinc-500 font-mono">{app.applicantEmail}</p>
                            <span className="text-[10px] text-zinc-400">
                              Applied: {new Date(app.createdAt).toLocaleString()}
                            </span>
                          </div>
                        </div>

                        {/* Requested title badge */}
                        {app.requestedTitle && (
                          <div className="text-right">
                            <span className="text-[10px] font-bold text-zinc-500 block uppercase">
                              Requested Title
                            </span>
                            <span className="text-xs font-black text-amber-900 bg-[#f9c74f]/40 px-2.5 py-1 rounded-full border border-[#f9c74f]">
                              {app.requestedTitle}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Application text details */}
                      <div className="space-y-2 mb-4 bg-white p-3 rounded-xl border border-zinc-200 text-xs">
                        <div>
                          <span className="font-bold text-zinc-700 block mb-0.5">
                            Motivation &amp; Community Reason:
                          </span>
                          <p className="text-zinc-800 leading-relaxed italic">{app.reason}</p>
                        </div>
                        <div className="pt-2 border-t border-zinc-100">
                          <span className="font-bold text-zinc-700 block mb-0.5">
                            Cycling Background &amp; Experience:
                          </span>
                          <p className="text-zinc-800 leading-relaxed">{app.cyclingExperience}</p>
                        </div>
                        {app.rejectionReason && (
                          <div className="pt-2 border-t border-red-100 text-red-700">
                            <span className="font-bold block">Rejection Note:</span>
                            <p className="italic">{app.rejectionReason}</p>
                          </div>
                        )}
                      </div>

                      {/* Moderator Recommendations (if any) */}
                      {app.adminRecommendations && app.adminRecommendations.length > 0 && (
                        <div className="mb-3 p-2.5 bg-blue-50 border border-blue-200 rounded-xl text-xs">
                          <span className="font-bold text-blue-900 block mb-1">
                            <i className="fas fa-shield-alt mr-1"></i> Moderator Team Feedback:
                          </span>
                          <div className="space-y-1">
                            {app.adminRecommendations.map((rec, i) => (
                              <div key={i} className="flex items-center justify-between text-[11px]">
                                <span>
                                  <strong>{rec.adminName}:</strong> {rec.comment}
                                </span>
                                <span
                                  className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${
                                    rec.recommendation === 'APPROVE'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-rose-100 text-rose-800'
                                  }`}
                                >
                                  {rec.recommendation}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Action buttons (Exclusive to Super Admin) */}
                      <div className="flex items-center justify-end flex-wrap gap-2 pt-2 border-t border-zinc-200">
                        {app.status === 'PENDING' && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleRejectApp(app)}
                              className="px-3 py-1.5 rounded-xl border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-800 text-xs font-bold transition"
                            >
                              <i className="fas fa-times mr-1"></i> Reject
                            </button>
                            <button
                              type="button"
                              onClick={() => handleApproveApp(app)}
                              className="btn-primary py-1.5 px-4 text-xs font-black flex items-center gap-1.5"
                            >
                              <i className="fas fa-check"></i> Approve as Admin Member
                            </button>
                          </>
                        )}

                        {app.status === 'APPROVED' && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleRemoveFromAdminPanel(app.userId, app.applicantName)}
                              className="px-3 py-1.5 rounded-xl border border-zinc-300 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-xs font-bold transition"
                            >
                              Remove from Admin Directory
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSuspendAdminMember(app.userId, app.applicantName)}
                              className="px-3 py-1.5 rounded-xl border border-red-300 bg-red-50 hover:bg-red-100 text-red-800 text-xs font-bold transition"
                            >
                              <i className="fas fa-user-slash mr-1"></i> Suspend Member
                            </button>
                          </>
                        )}

                        {app.status === 'SUSPENDED' && (
                          <button
                            type="button"
                            onClick={() => handleReinstateAdminMember(app.userId, app.applicantName)}
                            className="btn-primary py-1.5 px-4 text-xs font-black flex items-center gap-1.5"
                          >
                            <i className="fas fa-user-check"></i> Reinstate Admin Member
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 1: REAL-TIME PRIVATE ANALYTICS */}
      {adminTab === 'analytics' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="neo-card p-4 text-center">
              <div className="text-xs uppercase font-bold text-zinc-500 mb-1">Total Registered</div>
              <div className="text-3xl font-extrabold text-[#1e1e1e]">{totalUsers}</div>
              <div className="text-[0.7rem] text-zinc-400 mt-1">all accounts</div>
            </div>

            <div className="neo-card p-4 text-center">
              <div className="text-xs uppercase font-bold text-zinc-500 mb-1">Active Members</div>
              <div className="text-3xl font-extrabold text-emerald-600">{memberCount}</div>
              <div className="text-[0.7rem] text-zinc-400 mt-1">quota: {slotLimit} slots</div>
            </div>

            <div className="neo-card p-4 text-center">
              <div className="text-xs uppercase font-bold text-zinc-500 mb-1">Admins / Mods</div>
              <div className="text-3xl font-extrabold text-amber-600">{adminCount}</div>
              <div className="text-[0.7rem] text-zinc-400 mt-1">appointed by you</div>
            </div>

            <div className="neo-card p-4 text-center bg-zinc-900 text-white">
              <div className="text-xs uppercase font-bold text-[#f9c74f] mb-1">
                <i className="fas fa-broadcast-tower animate-pulse mr-1"></i> Live Sessions
              </div>
              <div className="text-3xl font-extrabold text-white">
                {stats?.activeSessionsCount ?? 1}
              </div>
              <div className="text-[0.7rem] text-zinc-400 mt-1">heartbeats last 15m</div>
            </div>
          </div>

          {/* Breakdown cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="neo-card">
              <h3 className="font-bold text-base mb-3 flex items-center gap-2">
                <i className="fas fa-pie-chart text-[#b45309]"></i> User Role Breakdown
              </h3>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-zinc-400"></span> Public Users
                  </span>
                  <span className="font-bold">{publicCount}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-emerald-500"></span> Authorized Members
                  </span>
                  <span className="font-bold">{memberCount}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-amber-500"></span> Appointed Admins
                  </span>
                  <span className="font-bold">{adminCount}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-zinc-900"></span> Super Admin
                  </span>
                  <span className="font-bold">{superAdminCount}</span>
                </div>
              </div>
            </div>

            <div className="neo-card">
              <h3 className="font-bold text-base mb-3 flex items-center gap-2">
                <i className="fas fa-user-clock text-[#b45309]"></i> Current Active Sessions
              </h3>
              {loadingStats ? (
                <div className="text-xs text-zinc-500">Loading active sessions...</div>
              ) : stats?.activeSessions && stats.activeSessions.length > 0 ? (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {stats.activeSessions.map((s, idx) => (
                    <div
                      key={idx}
                      className="p-2 bg-[#f6f3ee] border border-zinc-200 rounded-xl text-xs flex items-center justify-between"
                    >
                      <div>
                        <span className="font-bold">{s.email || s.userId}</span>
                        <span className={`ml-2 role-badge ${s.role}`}>{s.role}</span>
                      </div>
                      <span className="text-zinc-500 text-[0.68rem]">
                        {new Date(s.lastActive).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-zinc-500 italic">No other active sessions detected.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: USER & ROLE MANAGEMENT */}
      {adminTab === 'users' && (
        <div className="neo-card">
          <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
            <div>
              <h2 className="text-xl font-bold">User &amp; Role Management</h2>
              <p className="text-xs text-zinc-600">
                Promote public users to members or admins. Revoke privileges instantly.
              </p>
            </div>

            <input
              type="text"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Search user by name or email..."
              className="neo-input text-xs py-2 w-64"
            />
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Rider</th>
                  <th>Email</th>
                  <th>Current Role</th>
                  <th>Community Title</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loadingUsers ? (
                  <tr>
                    <td colSpan={7} className="text-center py-6 text-zinc-500 font-bold">
                      <i className="fas fa-spinner fa-spin mr-2"></i> Loading registered users...
                    </td>
                  </tr>
                ) : filteredUsers.map((u) => {
                  const isOwner = u.email.toLowerCase() === DESIGNATED_SUPER_ADMIN_EMAIL.toLowerCase();

                  return (
                    <tr
                      key={u.id}
                      className={`${u.isSuspended ? 'bg-red-50/50' : ''} hover:bg-zinc-50 transition`}
                    >
                      <td>
                        <button
                          type="button"
                          onClick={() => setInspectingUser(u)}
                          className="flex items-center gap-2 text-left group"
                          title="Click to view full user profile"
                        >
                          <div className="w-8 h-8 rounded-full bg-zinc-200 border-2 border-zinc-900 flex items-center justify-center font-bold text-xs overflow-hidden flex-shrink-0 group-hover:scale-105 transition">
                            {u.photoURL ? (
                              <img src={u.photoURL} alt={u.displayName} className="w-full h-full object-cover" />
                            ) : (
                              u.displayName.charAt(0).toUpperCase()
                            )}
                          </div>
                          <div>
                            <span className="font-black text-zinc-900 group-hover:underline block">
                              {u.displayName}
                            </span>
                            <span className="text-[10px] text-zinc-500 flex items-center gap-1 font-semibold">
                              <i className="fas fa-id-badge text-[9px]"></i> View Profile
                            </span>
                          </div>
                        </button>
                      </td>
                      <td className="text-xs text-zinc-600">{u.email}</td>
                      <td>
                        <div className="flex items-center gap-1">
                          <span className={`role-badge ${u.role}`}>{u.role}</span>
                          {u.isAdminMember && (
                            <span className="text-[10px] bg-amber-100 text-amber-900 font-black px-1.5 py-0.5 rounded border border-amber-300">
                              Admin Member
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-zinc-800">
                            {u.customTitle || (isOwner ? 'Executive Owner' : '—')}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingTitleUser(u);
                              setNewTitleValue(u.customTitle || '');
                            }}
                            className="text-[11px] text-zinc-400 hover:text-black p-1"
                            title="Edit / Moderate custom title"
                          >
                            <i className="fas fa-pencil-alt"></i>
                          </button>
                        </div>
                      </td>
                      <td>
                        {u.isSuspended ? (
                          <span className="text-[0.65rem] font-bold uppercase bg-red-100 text-red-800 px-2 py-0.5 rounded-full border border-red-300">
                            Suspended
                          </span>
                        ) : (
                          <span className="text-[0.65rem] font-bold uppercase bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-300">
                            Active
                          </span>
                        )}
                      </td>
                      <td className="text-xs text-zinc-500">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                      <td>
                        {isOwner ? (
                          <span className="text-xs font-bold text-amber-700 italic">Permanent Owner</span>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setInspectingUser(u)}
                              title="Inspect User Profile"
                              className="px-2 py-1 rounded-lg border border-zinc-900 bg-white hover:bg-zinc-100 text-xs font-bold flex items-center gap-1"
                            >
                              <i className="fas fa-eye text-amber-600"></i>
                            </button>

                            <select
                              value={u.role}
                              onChange={(e) => handleChangeRole(u, e.target.value)}
                              className="text-xs font-bold py-1 px-2 rounded-lg border border-zinc-900 bg-white"
                            >
                              <option value="PUBLIC">PUBLIC</option>
                              <option value="MEMBER">MEMBER</option>
                              <option value="ADMIN">ADMIN</option>
                            </select>

                            <button
                              type="button"
                              onClick={() => handleToggleSuspend(u)}
                              title={u.isSuspended ? 'Reactivate account' : 'Suspend account'}
                              className={`p-1.5 rounded-lg border text-xs ${
                                u.isSuspended
                                  ? 'bg-emerald-100 border-emerald-700 text-emerald-800 hover:bg-emerald-200'
                                  : 'bg-red-100 border-red-700 text-red-800 hover:bg-red-200'
                              }`}
                            >
                              <i className={`fas ${u.isSuspended ? 'fa-user-check' : 'fa-user-slash'}`}></i>
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: INVITATION CODES MANAGEMENT (Requirement 1: Admin Invitation System) */}
      {adminTab === 'invitations' && (
        <div className="space-y-6">
          <div className="neo-card">
            <div className="flex items-center justify-between flex-wrap gap-4 mb-5">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <i className="fas fa-ticket-alt text-amber-600"></i> Admin &amp; Member Invitation Codes
                </h2>
                <p className="text-xs text-zinc-600 mt-0.5">
                  Generate single-use cryptographic invitation tokens to invite anyone to become an <strong>Admin</strong> or <strong>Member</strong>.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-xs font-bold">
                  <span>Slot Limit:</span>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={customSlotLimit}
                    onChange={(e) => setCustomSlotLimit(e.target.value)}
                    className="w-16 px-2 py-1 text-xs border border-zinc-900 rounded-lg text-center"
                  />
                  <button
                    type="button"
                    onClick={handleUpdateSlotLimit}
                    className="btn-secondary text-[0.7rem] py-1 px-2.5 font-bold"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>

            {/* Target Role Selector & Generator Box */}
            <div className="p-4 bg-[#fbf9f4] border-2 border-zinc-900 rounded-2xl mb-6 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                <span className="text-xs font-black uppercase text-zinc-700">Target Role:</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setTargetInviteRole('ADMIN')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black border-2 transition flex items-center gap-1.5 ${
                      targetInviteRole === 'ADMIN'
                        ? 'bg-[#1e1e1e] text-[#f9c74f] border-[#1e1e1e] shadow-sm'
                        : 'bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-100'
                    }`}
                  >
                    <i className="fas fa-shield-alt text-amber-500"></i> Admin Invitation (Admin Privileges)
                  </button>
                  <button
                    type="button"
                    onClick={() => setTargetInviteRole('MEMBER')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black border-2 transition flex items-center gap-1.5 ${
                      targetInviteRole === 'MEMBER'
                        ? 'bg-[#1e1e1e] text-[#f9c74f] border-[#1e1e1e] shadow-sm'
                        : 'bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-100'
                    }`}
                  >
                    <i className="fas fa-biking text-emerald-500"></i> Member Invitation (Member Access)
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={handleGenerateCode}
                disabled={generatingCode}
                className="btn-primary text-xs py-2.5 px-5 font-black whitespace-nowrap flex items-center gap-2 shadow-[0_3px_0_#1e1e1e]"
              >
                {generatingCode ? (
                  <i className="fas fa-spinner fa-spin"></i>
                ) : (
                  <i className="fas fa-plus"></i>
                )}{' '}
                Generate {targetInviteRole === 'ADMIN' ? 'Admin' : 'Member'} Invitation Code
              </button>
            </div>

            {/* Generated Code Reveal Modal */}
            {newGeneratedCode && (
              <div className="p-5 bg-amber-50 border-2 border-amber-500 rounded-2xl mb-6 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-black uppercase text-amber-900 flex items-center gap-1.5">
                    <i className="fas fa-key text-amber-600"></i> Newly Generated {newGeneratedRole || targetInviteRole} Invitation Token
                  </span>
                  <button
                    type="button"
                    onClick={() => setNewGeneratedCode(null)}
                    className="text-amber-800 hover:text-black text-xs font-bold"
                  >
                    Dismiss
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-2">
                  <code className="text-xl sm:text-2xl font-black font-mono tracking-wider bg-white py-2.5 px-5 rounded-xl border-2 border-zinc-900 text-zinc-900">
                    {newGeneratedCode}
                  </code>
                  <span className={`role-badge ${newGeneratedRole || targetInviteRole}`}>
                    {newGeneratedRole || targetInviteRole}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(newGeneratedCode);
                      alert(`Copied ${newGeneratedRole || targetInviteRole} invitation code to clipboard!`);
                    }}
                    className="btn-primary text-xs py-2.5 px-4 font-black flex items-center gap-1.5"
                  >
                    <i className="fas fa-copy"></i> Copy Code
                  </button>
                </div>
                <p className="text-xs text-amber-800 mt-2 font-medium">
                  Share this single-use code securely. The recipient can redeem it in their <strong>Profile tab</strong> to activate <strong>{newGeneratedRole || targetInviteRole}</strong> status instantly.
                </p>
              </div>
            )}

            {/* Invitations Table */}
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Masked Token</th>
                    <th>Target Role</th>
                    <th>Created</th>
                    <th>Expires</th>
                    <th>Status</th>
                    <th>Redeemed By</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {invitations.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-6 text-zinc-500 italic">
                        No invitation codes generated yet. Click &quot;Generate Invitation Code&quot; above.
                      </td>
                    </tr>
                  ) : (
                    invitations.map((inv) => (
                      <tr key={inv.id}>
                        <td className="font-mono font-bold">{inv.displayMasked}</td>
                        <td>
                          <span className={`role-badge ${inv.targetRole || 'ADMIN'}`}>
                            {inv.targetRole || 'ADMIN'}
                          </span>
                        </td>
                        <td className="text-xs text-zinc-500">
                          {new Date(inv.createdAt).toLocaleDateString()}
                        </td>
                        <td className="text-xs text-zinc-500">
                          {new Date(inv.expiresAt).toLocaleDateString()}
                        </td>
                        <td>
                          {inv.isRevoked ? (
                            <span className="text-[0.65rem] font-bold uppercase bg-red-100 text-red-800 px-2 py-0.5 rounded-full border border-red-300">
                              Revoked
                            </span>
                          ) : inv.isRedeemed ? (
                            <span className="text-[0.65rem] font-bold uppercase bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-300">
                              Redeemed
                            </span>
                          ) : (
                            <span className="text-[0.65rem] font-bold uppercase bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full border border-amber-300">
                              Available
                            </span>
                          )}
                        </td>
                        <td className="text-xs text-zinc-600">
                          {inv.redeemedByEmail || '—'}
                        </td>
                        <td>
                          {!inv.isRevoked && !inv.isRedeemed && (
                            <button
                              type="button"
                              onClick={() => handleRevokeCode(inv.id)}
                              className="text-xs text-red-600 hover:text-red-800 font-bold"
                            >
                              Revoke
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: SECURITY AUDIT LOGS */}
      {adminTab === 'audit' && (
        <div className="neo-card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold">Security Audit Trail</h2>
              <p className="text-xs text-zinc-600">
                Immutable record of all privileged administrative events and access.
              </p>
            </div>
            <button
              type="button"
              onClick={fetchStats}
              className="btn-secondary text-xs py-1.5 px-3 font-bold"
            >
              <i className="fas fa-sync-alt mr-1"></i> Refresh Logs
            </button>
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Target Type</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {!stats?.auditLogs || stats.auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-6 text-zinc-500 italic">
                      No security audit events recorded yet.
                    </td>
                  </tr>
                ) : (
                  stats.auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="text-xs font-mono text-zinc-500 whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td>
                        <span className="text-[0.7rem] font-bold uppercase tracking-wider bg-zinc-900 text-[#f9c74f] px-2 py-0.5 rounded-md font-mono">
                          {log.action}
                        </span>
                      </td>
                      <td className="text-xs font-semibold">{log.actorEmail}</td>
                      <td className="text-xs text-zinc-500 font-mono">{log.targetType}</td>
                      <td className="text-xs text-zinc-700">{log.details}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Super Admin Title Editor Modal */}
      {editingTitleUser && (
        <div className="modal-overlay open" role="dialog" aria-modal="true">
          <div className="modal max-w-md p-6 border-3 border-[#1e1e1e] bg-white rounded-3xl shadow-[0_10px_0_#1e1e1e]">
            <button
              type="button"
              className="modal-close"
              onClick={() => setEditingTitleUser(null)}
              aria-label="Close"
            >
              <i className="fas fa-times"></i>
            </button>

            <h3 className="font-black text-lg text-zinc-900 mb-1">
              Edit Custom Community Title
            </h3>
            <p className="text-xs text-zinc-600 mb-4">
              Moderate or customize community title for <strong>{editingTitleUser.displayName}</strong>.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-black uppercase tracking-wider mb-1 text-zinc-700">
                  Custom Title
                </label>
                <input
                  type="text"
                  value={newTitleValue}
                  onChange={(e) => setNewTitleValue(e.target.value)}
                  placeholder="e.g. Chill Guy, Road Warrior, Dhesh Dhesh..."
                  className="neo-input text-sm w-full p-2.5 font-bold"
                />
              </div>

              <div className="flex flex-wrap gap-1.5 pt-1">
                {['Chill Guy', 'Road Warrior', 'Dhesh Dhesh', 'Cycling Enthusiast', 'Lover', 'Climb Specialist'].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setNewTitleValue(t)}
                    className="text-[11px] px-2.5 py-1 rounded-full bg-zinc-100 hover:bg-[#f9c74f] font-bold text-zinc-800 border border-zinc-300 transition"
                  >
                    {t}
                  </button>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-zinc-200">
                <button
                  type="button"
                  onClick={() => setEditingTitleUser(null)}
                  className="btn-secondary py-2 px-4 text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveCustomTitle}
                  className="btn-primary py-2 px-5 text-xs font-black"
                >
                  Save Title
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: USER PROFILE INSPECTION MODAL (Requirement 6) */}
      {inspectingUser && (
        <div
          className="modal-overlay open"
          onClick={(e) => {
            if (e.target === e.currentTarget) setInspectingUser(null);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="modal max-w-lg p-6 sm:p-8 border-3 border-[#1e1e1e] bg-white rounded-3xl shadow-[0_10px_0_#1e1e1e] max-h-[90vh] overflow-y-auto">
            <button
              type="button"
              className="modal-close"
              onClick={() => setInspectingUser(null)}
              aria-label="Close"
            >
              <i className="fas fa-times"></i>
            </button>

            <div className="text-center pb-5 border-b border-zinc-200">
              <div className="w-20 h-20 mx-auto mb-3 rounded-full border-3 border-zinc-900 bg-zinc-200 overflow-hidden flex items-center justify-center font-black text-2xl text-zinc-700 shadow-[0_4px_0_#1e1e1e]">
                {inspectingUser.photoURL ? (
                  <img src={inspectingUser.photoURL} alt={inspectingUser.displayName} className="w-full h-full object-cover" />
                ) : (
                  inspectingUser.displayName?.charAt(0).toUpperCase() || 'R'
                )}
              </div>
              <h3 className="font-black text-2xl text-zinc-900 tracking-tight">
                {inspectingUser.displayName}
              </h3>
              <p className="text-xs text-zinc-500 font-mono mt-0.5">{inspectingUser.email}</p>

              <div className="flex items-center justify-center gap-2 mt-3 flex-wrap">
                <span className={`role-badge ${inspectingUser.role}`}>{inspectingUser.role}</span>
                {inspectingUser.isSuspended ? (
                  <span className="text-xs font-black uppercase bg-red-100 text-red-800 px-2.5 py-0.5 rounded-full border border-red-300">
                    <i className="fas fa-ban mr-1"></i> Suspended
                  </span>
                ) : (
                  <span className="text-xs font-black uppercase bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-full border border-emerald-300">
                    <i className="fas fa-check-circle mr-1"></i> Active Account
                  </span>
                )}
              </div>
            </div>

            {/* Profile Information Details */}
            <div className="py-4 space-y-3 text-xs">
              <div className="flex items-center justify-between p-2.5 bg-zinc-50 rounded-xl border border-zinc-200">
                <span className="font-bold text-zinc-500 uppercase">Community Title:</span>
                <span className="font-black text-zinc-900">
                  {inspectingUser.customTitle || 'Standard Member'}
                </span>
              </div>

              <div className="flex items-center justify-between p-2.5 bg-zinc-50 rounded-xl border border-zinc-200">
                <span className="font-bold text-zinc-500 uppercase">Registered Date:</span>
                <span className="font-bold text-zinc-800">
                  {new Date(inspectingUser.createdAt).toLocaleDateString()}
                </span>
              </div>

              <div className="flex items-center justify-between p-2.5 bg-zinc-50 rounded-xl border border-zinc-200">
                <span className="font-bold text-zinc-500 uppercase">Community Rating:</span>
                <span className="font-black text-zinc-900 flex items-center gap-1">
                  <i className="fas fa-star text-amber-500"></i>
                  {inspectingUser.ratingAverage ? inspectingUser.ratingAverage.toFixed(1) : 'No ratings'}{' '}
                  <span className="font-normal text-zinc-500">({inspectingUser.ratingCount || 0} reviews)</span>
                </span>
              </div>

              {inspectingUser.bio && (
                <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-200">
                  <span className="font-bold text-zinc-500 uppercase block mb-1">Rider Bio:</span>
                  <p className="text-zinc-700 italic">"{inspectingUser.bio}"</p>
                </div>
              )}
            </div>

            {/* Quick Actions for Super Admin */}
            <div className="pt-4 border-t border-zinc-200 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-black uppercase text-zinc-600">Home Screen Status:</span>
                {featuredMembers.some((fm) => fm.userId === inspectingUser.id || fm.id === inspectingUser.id) ? (
                  <span className="text-xs font-bold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-300 flex items-center gap-1">
                    <i className="fas fa-star text-amber-500"></i> Featured on Home Screen
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      handleFeatureRegisteredUser(inspectingUser.id);
                      setInspectingUser(null);
                    }}
                    className="btn-primary py-1.5 px-3 text-xs font-black flex items-center gap-1.5"
                  >
                    <i className="fas fa-plus"></i> Feature on Home Screen
                  </button>
                )}
              </div>

              {inspectingUser.email.toLowerCase() !== DESIGNATED_SUPER_ADMIN_EMAIL.toLowerCase() && (
                <div className="flex items-center justify-between gap-2 pt-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-zinc-600">Change Role:</span>
                    <select
                      value={inspectingUser.role}
                      onChange={(e) => {
                        handleChangeRole(inspectingUser, e.target.value);
                        setInspectingUser((prev) => prev ? { ...prev, role: e.target.value as any } : null);
                      }}
                      className="text-xs font-bold py-1 px-2.5 rounded-xl border border-zinc-900 bg-white"
                    >
                      <option value="PUBLIC">PUBLIC</option>
                      <option value="MEMBER">MEMBER</option>
                      <option value="ADMIN">ADMIN</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      handleToggleSuspend(inspectingUser);
                      setInspectingUser((prev) => prev ? { ...prev, isSuspended: !prev.isSuspended } : null);
                    }}
                    className={`py-1.5 px-3 text-xs font-bold rounded-xl border transition flex items-center gap-1.5 ${
                      inspectingUser.isSuspended
                        ? 'bg-emerald-100 border-emerald-700 text-emerald-800 hover:bg-emerald-200'
                        : 'bg-red-100 border-red-700 text-red-800 hover:bg-red-200'
                    }`}
                  >
                    <i className={`fas ${inspectingUser.isSuspended ? 'fa-user-check' : 'fa-user-slash'}`}></i>
                    {inspectingUser.isSuspended ? 'Reactivate Account' : 'Suspend Account'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: FEATURED MEMBER EDITOR MODAL (Requirement 5) */}
      {(editingFeaturedMember || isCreatingCustomFeatured) && (
        <div
          className="modal-overlay open"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setEditingFeaturedMember(null);
              setIsCreatingCustomFeatured(false);
            }
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="modal max-w-2xl p-7 sm:p-9 border-3 border-[#1e1e1e] bg-white rounded-3xl shadow-[0_10px_0_#1e1e1e] max-h-[90vh] overflow-y-auto">
            <button
              type="button"
              className="modal-close"
              onClick={() => {
                setEditingFeaturedMember(null);
                setIsCreatingCustomFeatured(false);
              }}
              aria-label="Close"
            >
              <i className="fas fa-times"></i>
            </button>

            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-[#1e1e1e] text-[#f9c74f] border-2 border-[#1e1e1e] flex items-center justify-center text-xl shadow-[0_3px_0_#1e1e1e]">
                <i className="fas fa-star"></i>
              </div>
              <div>
                <h3 className="font-black text-xl text-zinc-900 tracking-tight">
                  {editingFeaturedMember
                    ? `Manage Home Screen Profile: ${editingFeaturedMember.name}`
                    : 'Add Custom Featured Crew Leader'}
                </h3>
                <p className="text-xs text-zinc-600">
                  Update completed expeditions, badges, title, and bio displayed on the home screen.
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveFeaturedMember} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider mb-1 text-zinc-800">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={featName}
                    onChange={(e) => setFeatName(e.target.value)}
                    placeholder="e.g. Ananta, Joy, Borson..."
                    className="neo-input text-sm w-full p-2.5 font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black uppercase tracking-wider mb-1 text-zinc-800">
                    Community Leadership Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={featTitle}
                    onChange={(e) => setFeatTitle(e.target.value)}
                    placeholder="e.g. Cycle.exe Crew Leader, Pace Setter..."
                    className="neo-input text-sm w-full p-2.5 font-bold"
                  />
                </div>
              </div>

              {/* Photo Upload & Preview */}
              <div>
                <label className="block text-xs font-black uppercase tracking-wider mb-1 text-zinc-800">
                  Photo / Avatar Image
                </label>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full border-2 border-zinc-900 bg-zinc-200 overflow-hidden flex items-center justify-center font-black text-xl text-zinc-700 shrink-0">
                    {featImg ? (
                      <img src={featImg} alt="Preview" className="w-full h-full object-cover" />
                    ) : (
                      featName ? featName.charAt(0).toUpperCase() : 'C'
                    )}
                  </div>

                  <div className="flex-1 space-y-2">
                    <input
                      type="text"
                      value={featImg}
                      onChange={(e) => setFeatImg(e.target.value)}
                      placeholder="Image URL or upload below (e.g. /images/Ananta.png)"
                      className="neo-input text-xs w-full p-2 font-mono"
                    />
                    <label className="inline-flex items-center gap-1.5 btn-secondary text-xs py-1.5 px-3 font-bold cursor-pointer">
                      <i className={`fas ${uploadingFeatImg ? 'fa-spinner fa-spin' : 'fa-camera'}`}></i>
                      <span>{uploadingFeatImg ? 'Uploading...' : 'Upload Image File'}</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleUploadFeatPhoto}
                        className="hidden"
                        disabled={uploadingFeatImg}
                      />
                    </label>
                  </div>
                </div>
              </div>

              {/* Status and Attendance */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider mb-1 text-zinc-800">
                    Attendance Record Text
                  </label>
                  <input
                    type="text"
                    value={featAttend}
                    onChange={(e) => setFeatAttend(e.target.value)}
                    placeholder="e.g. 12 Races or 100% Attendance"
                    className="neo-input text-xs w-full p-2.5 font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black uppercase tracking-wider mb-1 text-zinc-800">
                    Display Order #
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={featOrder}
                    onChange={(e) => setFeatOrder(Number(e.target.value))}
                    className="neo-input text-xs w-full p-2.5 font-bold"
                  />
                </div>

                <div className="flex flex-col justify-end space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-black text-zinc-800">
                    <input
                      type="checkbox"
                      checked={featActive}
                      onChange={(e) => setFeatActive(e.target.checked)}
                      className="w-4 h-4 rounded border-2 border-zinc-900"
                    />
                    <span>Active Rider Status</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer text-xs font-black text-zinc-800">
                    <input
                      type="checkbox"
                      checked={featPerfect}
                      onChange={(e) => setFeatPerfect(e.target.checked)}
                      className="w-4 h-4 rounded border-2 border-zinc-900"
                    />
                    <span>Perfect Attendance (Medal)</span>
                  </label>
                </div>
              </div>

              {/* Bio / Quote */}
              <div>
                <label className="block text-xs font-black uppercase tracking-wider mb-1 text-zinc-800">
                  Rider Bio / Moto
                </label>
                <textarea
                  rows={2}
                  value={featBio}
                  onChange={(e) => setFeatBio(e.target.value)}
                  placeholder="e.g. Paceline leader, long-distance touring and mountain climbs."
                  className="neo-input text-xs w-full p-2.5"
                ></textarea>
              </div>

              {/* SECTION: COMMUNITY BADGES MANAGEMENT */}
              <div className="p-4 bg-amber-50/60 border-2 border-amber-400 rounded-2xl">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-black uppercase tracking-wider text-amber-950 flex items-center gap-1.5">
                    <i className="fas fa-award text-amber-600"></i> Earned Community Badges
                  </label>
                  <span className="text-[11px] text-amber-800 font-bold">{featBadges.length} Badges</span>
                </div>

                {/* Add badge input */}
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={newBadgeText}
                    onChange={(e) => setNewBadgeText(e.target.value)}
                    placeholder="e.g. Century Rider, Mountain King, Pace Setter..."
                    className="neo-input text-xs flex-1 p-2 font-bold bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddBadge(newBadgeText)}
                    disabled={!newBadgeText.trim()}
                    className="btn-primary text-xs py-2 px-4 font-black whitespace-nowrap disabled:opacity-50"
                  >
                    <i className="fas fa-plus"></i> Add Badge
                  </button>
                </div>

                {/* Quick suggestions */}
                <div className="flex flex-wrap gap-1 mb-3">
                  {['Century Rider', 'Pace Setter', 'Mountain King', 'Night Rider', 'Sprint Captain', 'Gold Medalist', 'Verified Leader'].map((qb) => (
                    <button
                      key={qb}
                      type="button"
                      onClick={() => handleAddBadge(qb)}
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white border border-amber-400 text-amber-950 hover:bg-[#f9c74f] transition"
                    >
                      + {qb}
                    </button>
                  ))}
                </div>

                {/* Active Badges List */}
                <div className="flex flex-wrap gap-1.5 min-h-[30px]">
                  {featBadges.length === 0 ? (
                    <span className="text-xs text-zinc-500 italic">No badges assigned yet.</span>
                  ) : (
                    featBadges.map((b, bIdx) => (
                      <span
                        key={bIdx}
                        className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 border border-amber-400 text-amber-950 shadow-sm"
                      >
                        <i className="fas fa-award text-amber-600 text-[10px]"></i>
                        <span>{b}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveBadge(bIdx)}
                          className="hover:text-red-700 font-black ml-0.5"
                          title="Remove badge"
                        >
                          &times;
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </div>

              {/* SECTION: COMPLETED RACES & EXPEDITIONS MANAGEMENT */}
              <div className="p-4 bg-zinc-50 border-2 border-zinc-900 rounded-2xl">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-black uppercase tracking-wider text-zinc-900 flex items-center gap-1.5">
                    <i className="fas fa-flag-checkered text-amber-600"></i> Completed Expeditions &amp; Races
                  </label>
                  <span className="text-[11px] text-zinc-600 font-bold">{featCompletedRaces.length} Completed</span>
                </div>

                {/* Add race input */}
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={newRaceText}
                    onChange={(e) => setNewRaceText(e.target.value)}
                    placeholder="e.g. Mission 002: Coastal Ridge Climb"
                    className="neo-input text-xs flex-1 p-2 font-bold bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddRace(newRaceText)}
                    disabled={!newRaceText.trim()}
                    className="btn-primary text-xs py-2 px-4 font-black whitespace-nowrap disabled:opacity-50"
                  >
                    <i className="fas fa-plus"></i> Add Race
                  </button>
                </div>

                {/* Quick race suggestions from missions */}
                <div className="flex flex-wrap gap-1 mb-3">
                  {[
                    'Mission 001: Midnight Sprint',
                    'Mission 002: Coastal Ridge Climb',
                    'Mission 003: Dhaka Metro Circuit',
                    'Mission 004: Riverbank Pace Ride',
                  ].map((qr) => (
                    <button
                      key={qr}
                      type="button"
                      onClick={() => handleAddRace(qr)}
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white border border-zinc-300 text-zinc-700 hover:bg-zinc-100 transition"
                    >
                      + {qr}
                    </button>
                  ))}
                </div>

                {/* Active races list */}
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {featCompletedRaces.length === 0 ? (
                    <p className="text-xs text-zinc-500 italic py-2">No completed races logged yet.</p>
                  ) : (
                    featCompletedRaces.map((r, rIdx) => (
                      <div
                        key={rIdx}
                        className="p-2 bg-white rounded-xl border border-zinc-200 flex items-center justify-between text-xs font-bold text-zinc-800"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-zinc-900 text-[#f9c74f] flex items-center justify-center text-[10px] font-black">
                            {rIdx + 1}
                          </span>
                          <span>{r}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveRace(rIdx)}
                          className="text-red-600 hover:text-red-800 font-bold px-2 py-0.5"
                          title="Remove race"
                        >
                          <i className="fas fa-trash-alt text-[10px]"></i>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Form Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t border-zinc-200">
                <button
                  type="button"
                  onClick={() => {
                    setEditingFeaturedMember(null);
                    setIsCreatingCustomFeatured(false);
                  }}
                  className="btn-secondary py-2 px-5 text-xs font-bold"
                  disabled={featSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={featSaving}
                  className="btn-primary py-2 px-6 text-xs font-black flex items-center gap-2 shadow-[0_3px_0_#1e1e1e]"
                >
                  {featSaving ? (
                    <i className="fas fa-spinner fa-spin"></i>
                  ) : (
                    <i className="fas fa-check"></i>
                  )}
                  Save Home Screen Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
