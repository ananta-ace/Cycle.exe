import React, { useState, useEffect } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  updateDoc,
  addDoc,
  doc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth, DESIGNATED_SUPER_ADMIN_EMAIL } from '../context/AuthContext';
import { UserProfile, InvitationCodeSummary, SuperAdminStats, AdminMembershipApplication } from '../types';

export const SuperAdminDashboard: React.FC = () => {
  const { user, isSuperAdmin, role } = useAuth();

  // All registered users from Firestore
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(true);

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

  // Invitation codes
  const [invitations, setInvitations] = useState<InvitationCodeSummary[]>([]);
  const [newGeneratedCode, setNewGeneratedCode] = useState<string | null>(null);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [slotLimit, setSlotLimit] = useState(5);
  const [customSlotLimit, setCustomSlotLimit] = useState('5');

  // Active sub-tab in Super Admin view
  const [adminTab, setAdminTab] = useState<'applications' | 'users' | 'analytics' | 'invitations' | 'audit'>('applications');

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

    return () => {
      unsub();
      unsubApps();
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

  // Generate new code
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
        body: JSON.stringify({ expiryDays: 30 }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate code');

      setNewGeneratedCode(data.code);
      fetchInvitations();
      fetchStats();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error generating code');
    } finally {
      setGeneratingCode(false);
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
              <div className="flex items-center gap-3">
                <h1 className="text-2xl sm:text-3xl font-black text-zinc-900">Super Admin Control Hub</h1>
                <span className="role-badge SUPER_ADMIN">EXECUTIVE</span>
              </div>
              <p className="text-xs sm:text-sm text-zinc-700 mt-1">
                Logged in as <strong>{user?.email}</strong>. Sole executive authority for Cycle.exe 2.0.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2.5 bg-white p-1.5 rounded-full border-2 border-zinc-900 shadow-[0_3px_0_#d6d2ca]">
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
              className={`text-xs font-bold py-1.5 px-3.5 rounded-full transition ${
                adminTab === 'analytics' ? 'bg-[#1e1e1e] text-[#f9c74f]' : 'text-zinc-700 hover:bg-zinc-100'
              }`}
            >
              <i className="fas fa-chart-line mr-1"></i> Analytics
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
                    <tr key={u.id} className={u.isSuspended ? 'bg-red-50/50' : ''}>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-zinc-200 border border-zinc-900 flex items-center justify-center font-bold text-xs overflow-hidden flex-shrink-0">
                            {u.photoURL ? (
                              <img src={u.photoURL} alt={u.displayName} className="w-full h-full object-cover" />
                            ) : (
                              u.displayName.charAt(0).toUpperCase()
                            )}
                          </div>
                          <span className="font-bold">{u.displayName}</span>
                        </div>
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
                            onClick={() => {
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

      {/* TAB 3: INVITATION CODES MANAGEMENT */}
      {adminTab === 'invitations' && (
        <div className="space-y-6">
          <div className="neo-card">
            <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
              <div>
                <h2 className="text-xl font-bold">Membership Invitation Codes</h2>
                <p className="text-xs text-zinc-600">
                  Generate single-use cryptographic invitation tokens for prospective members.
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

                <button
                  type="button"
                  onClick={handleGenerateCode}
                  disabled={generatingCode}
                  className="btn-primary text-xs py-2 px-4 font-bold"
                >
                  {generatingCode ? (
                    <i className="fas fa-spinner fa-spin"></i>
                  ) : (
                    <i className="fas fa-plus"></i>
                  )}{' '}
                  Generate Single-Use Code
                </button>
              </div>
            </div>

            {/* Generated Code Reveal Modal */}
            {newGeneratedCode && (
              <div className="p-4 bg-amber-50 border-2 border-amber-500 rounded-2xl mb-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold uppercase text-amber-800">
                    <i className="fas fa-key mr-1"></i> Newly Generated Invitation Token
                  </span>
                  <button
                    type="button"
                    onClick={() => setNewGeneratedCode(null)}
                    className="text-amber-800 hover:text-black text-xs font-bold"
                  >
                    Dismiss
                  </button>
                </div>
                <div className="flex items-center gap-3 mt-2">
                  <code className="text-xl font-extrabold font-mono tracking-wider bg-white py-2 px-4 rounded-xl border-2 border-zinc-900">
                    {newGeneratedCode}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(newGeneratedCode);
                      alert('Copied code to clipboard!');
                    }}
                    className="btn-secondary text-xs py-2 px-3 font-bold"
                  >
                    <i className="fas fa-copy"></i> Copy
                  </button>
                </div>
                <p className="text-[0.7rem] text-amber-800 mt-2">
                  Copy and share this code securely with the rider. This code will only be shown in plaintext once.
                </p>
              </div>
            )}

            {/* Invitations Table */}
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Masked Token</th>
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
                      <td colSpan={6} className="text-center py-6 text-zinc-500 italic">
                        No invitation codes generated yet. Click &quot;Generate Single-Use Code&quot; above.
                      </td>
                    </tr>
                  ) : (
                    invitations.map((inv) => (
                      <tr key={inv.id}>
                        <td className="font-mono font-bold">{inv.displayMasked}</td>
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
    </div>
  );
};
