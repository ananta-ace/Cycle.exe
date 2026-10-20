import React, { useState, useEffect } from 'react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  setDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth, DESIGNATED_SUPER_ADMIN_EMAIL } from '../context/AuthContext';
import { UserProfile, AppNotification, NoticeReply } from '../types';

interface SuperAdminNoticesPanelProps {
  allUsers: UserProfile[];
  targetUserForNotice: UserProfile | null;
  onClearTargetUser: () => void;
  isComposerOpen: boolean;
  onOpenComposer: (u?: UserProfile) => void;
  onCloseComposer: () => void;
}

const NOTICE_TEMPLATES = [
  {
    label: 'Welcome & Onboarding',
    title: 'Welcome to the Cycle.exe Cycling Crew! 🚴',
    message:
      'Welcome to Cycle.exe! We are excited to have you in the group. Make sure to check out our upcoming missions, join the community discussions, and come along for our next weekend group ride. Let us know if you have any questions!',
  },
  {
    label: 'Admin Member Invitation',
    title: 'Leadership Opportunity: Join the Cycle.exe Leadership Crew',
    message:
      'Based on your active participation and strong cycling record, we would like to invite you to submit an Admin Member application. We are looking for motivated riders to help lead pace groups, moderate missions, and coordinate rides.',
  },
  {
    label: 'Mission Briefing & Alert',
    title: 'Official Briefing: Upcoming High-Priority Mission',
    message:
      'Attention Rider: A new group mission record has been scheduled. Please ensure your gear and bike safety check are completed before rollout. Reach out or reply to this notice if you need coordinate meetup points.',
  },
  {
    label: 'Conduct & Safety Reminder',
    title: 'Important Notice: Rider Safety & Community Conduct',
    message:
      'This is an official administrative reminder regarding safety standards and helmet protocols during group rides. Please maintain pace etiquette and respect all trail rules. Reply to this notice if you have any questions.',
  },
  {
    label: 'Profile Verification',
    title: 'Action Requested: Verify Your Rider Profile Details',
    message:
      'Please update your rider bio and emergency contact details in your profile tab to ensure our team has up-to-date expedition records.',
  },
];

export const SuperAdminNoticesPanel: React.FC<SuperAdminNoticesPanelProps> = ({
  allUsers,
  targetUserForNotice,
  onClearTargetUser,
  isComposerOpen,
  onOpenComposer,
  onCloseComposer,
}) => {
  const { user, isSuperAdmin, role } = useAuth();

  const [notices, setNotices] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'UNREAD' | 'READ' | 'REPLIED'>('ALL');

  // Active expanded thread for replies
  const [activeThreadNotice, setActiveThreadNotice] = useState<AppNotification | null>(null);
  const [adminReplyText, setAdminReplyText] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);

  // Notice composer form state
  const [selectedRecipientId, setSelectedRecipientId] = useState<string>('');
  const [noticeTitle, setNoticeTitle] = useState('Official Notice from Super Admin');
  const [noticeMessage, setNoticeMessage] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [formError, setFormError] = useState('');

  // Real-time subscription to all direct notices
  useEffect(() => {
    if (!isSuperAdmin) return;

    const notifsRef = collection(db, 'notifications');
    const q = query(notifsRef, orderBy('createdAt', 'desc'));

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list: AppNotification[] = [];
        snapshot.forEach((snap) => {
          const d = snap.data() as Omit<AppNotification, 'id'>;
          // Filter for direct notices or notices sent by super admin
          if (
            d.type === 'DIRECT_NOTICE' ||
            d.isDirectNotice ||
            d.senderRole === 'SUPER_ADMIN' ||
            d.senderId === user?.uid ||
            (d.recipientId && d.recipientId !== 'SUPER_ADMIN' && d.recipientId !== 'ALL_ADMINS')
          ) {
            list.push({ id: snap.id, ...d });
          }
        });
        setNotices(list);
        setLoading(false);

        // Keep active thread notice in sync
        if (activeThreadNotice) {
          const updated = list.find((n) => n.id === activeThreadNotice.id);
          if (updated) setActiveThreadNotice(updated);
        }
      },
      (err) => {
        console.error('Error fetching sent notices:', err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [isSuperAdmin, user?.uid, activeThreadNotice?.id]);

  // When targetUserForNotice prop changes, update composer
  useEffect(() => {
    if (targetUserForNotice) {
      setSelectedRecipientId(targetUserForNotice.id);
      setNoticeTitle(`Official Notice for ${targetUserForNotice.displayName}`);
    } else if (allUsers.length > 0 && !selectedRecipientId) {
      setSelectedRecipientId(allUsers[0].id);
    }
  }, [targetUserForNotice, allUsers, selectedRecipientId]);

  const handleApplyTemplate = (tpl: (typeof NOTICE_TEMPLATES)[0]) => {
    setNoticeTitle(tpl.title);
    setNoticeMessage(tpl.message);
  };

  const handleSendNotice = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!selectedRecipientId) {
      setFormError('Please select a recipient user');
      return;
    }
    if (!noticeMessage.trim()) {
      setFormError('Message text cannot be empty');
      return;
    }

    const recipient = allUsers.find((u) => u.id === selectedRecipientId);
    if (!recipient) {
      setFormError('Selected user could not be found');
      return;
    }

    setIsSending(true);

    try {
      // 1. Try server endpoint first for trusted verification & audit trail
      const serverResp = await fetch('/api/admin/send-notice', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user?.uid || '',
          'x-user-email': user?.email || '',
          'x-user-role': role || 'SUPER_ADMIN',
        },
        body: JSON.stringify({
          recipientId: recipient.id,
          title: noticeTitle.trim() || 'Official Notice from Super Admin',
          message: noticeMessage.trim(),
          isUrgent,
        }),
      });

      if (!serverResp.ok) {
        // Fallback: direct Firestore write via client SDK
        const now = new Date().toISOString();
        const noticeId = `notice_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        await setDoc(doc(db, 'notifications', noticeId), {
          id: noticeId,
          recipientId: recipient.id,
          recipientName: recipient.displayName || 'Rider',
          recipientEmail: recipient.email || '',
          senderId: user?.uid || 'super-admin',
          senderName: user?.displayName || 'Super Admin (Owner)',
          senderEmail: user?.email || DESIGNATED_SUPER_ADMIN_EMAIL,
          senderRole: 'SUPER_ADMIN',
          type: 'DIRECT_NOTICE',
          isDirectNotice: true,
          title: (noticeTitle.trim() || 'Official Notice from Super Admin').substring(0, 120),
          message: noticeMessage.trim().substring(0, 2000),
          isUrgent,
          deliveryStatus: 'DELIVERED',
          deliveredAt: now,
          isRead: false,
          readAt: null,
          replies: [],
          replyCount: 0,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Reset form and close
      setNoticeMessage('');
      setNoticeTitle('Official Notice from Super Admin');
      setIsUrgent(false);
      onClearTargetUser();
      onCloseComposer();
      alert(`Notice delivered directly to ${recipient.displayName} (${recipient.email})!`);
    } catch (err: unknown) {
      console.error('Error sending notice:', err);
      setFormError(err instanceof Error ? err.message : 'Failed to send notice');
    } finally {
      setIsSending(false);
    }
  };

  const handleAdminReplySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeThreadNotice || !adminReplyText.trim() || !user) return;

    setSubmittingReply(true);

    const now = new Date().toISOString();
    const replyItem: NoticeReply = {
      id: `rep_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      senderId: user.uid,
      senderName: user.displayName || 'Super Admin (Owner)',
      senderEmail: user.email || DESIGNATED_SUPER_ADMIN_EMAIL,
      senderRole: 'SUPER_ADMIN',
      text: adminReplyText.trim(),
      createdAt: now,
    };

    const currentReplies = Array.isArray(activeThreadNotice.replies)
      ? activeThreadNotice.replies
      : [];
    const newReplies = [...currentReplies, replyItem];

    try {
      await updateDoc(doc(db, 'notifications', activeThreadNotice.id), {
        replies: newReplies,
        replyCount: newReplies.length,
        lastRepliedAt: now,
        hasNewReply: false,
        updatedAt: now,
      });

      // Also ping the recipient that Super Admin replied
      await setDoc(
        doc(
          db,
          'notifications',
          `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`
        ),
        {
          id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          recipientId: activeThreadNotice.recipientId,
          type: 'DIRECT_NOTICE',
          isDirectNotice: true,
          title: `Reply from Super Admin: ${activeThreadNotice.title}`,
          message: adminReplyText.trim(),
          isRead: false,
          createdAt: now,
        }
      );

      setAdminReplyText('');
    } catch (err) {
      console.error('Error adding admin reply:', err);
      alert('Failed to send reply to thread');
    } finally {
      setSubmittingReply(false);
    }
  };

  const handleDeleteNotice = async (noticeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to permanently delete this notice?')) return;
    try {
      await deleteDoc(doc(db, 'notifications', noticeId));
      if (activeThreadNotice?.id === noticeId) {
        setActiveThreadNotice(null);
      }
    } catch (err) {
      console.error('Error deleting notice:', err);
      alert('Failed to delete notice');
    }
  };

  // Metric computations
  const totalSent = notices.length;
  const readCount = notices.filter((n) => n.isRead).length;
  const unreadCount = notices.filter((n) => !n.isRead).length;
  const repliedCount = notices.filter((n) => (n.replies && n.replies.length > 0) || (n.replyCount || 0) > 0).length;
  const readRate = totalSent > 0 ? Math.round((readCount / totalSent) * 100) : 0;

  // Filtered notices
  const filteredNotices = notices.filter((n) => {
    // Status filter
    if (statusFilter === 'UNREAD' && n.isRead) return false;
    if (statusFilter === 'READ' && !n.isRead) return false;
    if (statusFilter === 'REPLIED' && (!n.replies || n.replies.length === 0)) return false;

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchRecipient =
        n.recipientName?.toLowerCase().includes(q) ||
        n.recipientEmail?.toLowerCase().includes(q) ||
        n.recipientId?.toLowerCase().includes(q);
      const matchTitle = n.title?.toLowerCase().includes(q);
      const matchMessage = n.message?.toLowerCase().includes(q);
      return matchRecipient || matchTitle || matchMessage;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Overview & Action Header */}
      <div className="neo-card p-6 sm:p-7 bg-[#fffbf0] border-2 border-[#1e1e1e] shadow-[0_6px_0_#d6d2ca]">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-8 h-8 rounded-full bg-[#1e1e1e] text-[#f9c74f] flex items-center justify-center text-sm font-bold shadow-[0_2px_0_#1e1e1e]">
                <i className="fas fa-paper-plane"></i>
              </span>
              <h2 className="text-xl sm:text-2xl font-black text-zinc-900 tracking-tight">
                Direct User Notices & Delivery Tracker
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-zinc-600">
              Select any rider, transmit tailored administrative messages, monitor exact view/read
              timestamps, and engage in threaded user replies.
            </p>
          </div>

          <button
            type="button"
            onClick={() => onOpenComposer()}
            className="btn-primary py-2.5 px-6 text-xs sm:text-sm font-black flex items-center gap-2 bg-[#1e1e1e] text-[#f9c74f] border-2 border-black rounded-2xl shadow-[0_4px_0_#999] hover:bg-black transition cursor-pointer"
          >
            <i className="fas fa-plus-circle"></i>
            <span>Compose Direct Notice</span>
          </button>
        </div>

        {/* Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mt-6">
          <div className="p-3.5 bg-white rounded-2xl border-2 border-zinc-900 shadow-[0_3px_0_#e5e7eb] text-center">
            <span className="text-[10px] font-black uppercase text-zinc-500 tracking-wider block mb-0.5">
              Total Notices Sent
            </span>
            <span className="text-2xl sm:text-3xl font-black text-zinc-900">{totalSent}</span>
            <span className="text-[10px] text-zinc-400 font-bold block mt-0.5">all-time messages</span>
          </div>

          <div className="p-3.5 bg-white rounded-2xl border-2 border-amber-500 shadow-[0_3px_0_#fde68a] text-center">
            <span className="text-[10px] font-black uppercase text-amber-700 tracking-wider block mb-0.5 flex items-center justify-center gap-1">
              <i className="fas fa-clock text-amber-500 text-[10px]"></i> Delivered (Unread)
            </span>
            <span className="text-2xl sm:text-3xl font-black text-amber-600">{unreadCount}</span>
            <span className="text-[10px] text-amber-800 font-bold block mt-0.5">awaiting user view</span>
          </div>

          <div className="p-3.5 bg-white rounded-2xl border-2 border-emerald-500 shadow-[0_3px_0_#a7f3d0] text-center">
            <span className="text-[10px] font-black uppercase text-emerald-700 tracking-wider block mb-0.5 flex items-center justify-center gap-1">
              <i className="fas fa-eye text-emerald-500 text-[10px]"></i> Viewed / Read
            </span>
            <span className="text-2xl sm:text-3xl font-black text-emerald-600">{readCount}</span>
            <span className="text-[10px] text-emerald-800 font-bold block mt-0.5">
              {readRate}% open rate
            </span>
          </div>

          <div className="p-3.5 bg-white rounded-2xl border-2 border-purple-500 shadow-[0_3px_0_#e9d5ff] text-center">
            <span className="text-[10px] font-black uppercase text-purple-700 tracking-wider block mb-0.5 flex items-center justify-center gap-1">
              <i className="fas fa-comments text-purple-500 text-[10px]"></i> User Replies
            </span>
            <span className="text-2xl sm:text-3xl font-black text-purple-700">{repliedCount}</span>
            <span className="text-[10px] text-purple-900 font-bold block mt-0.5">two-way threads</span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Status Tabs */}
        <div className="flex flex-wrap gap-1.5 p-1 bg-white rounded-2xl border-2 border-zinc-900 shadow-[0_3px_0_#d6d2ca]">
          <button
            type="button"
            onClick={() => setStatusFilter('ALL')}
            className={`text-xs font-black py-1.5 px-3.5 rounded-xl transition ${
              statusFilter === 'ALL'
                ? 'bg-[#1e1e1e] text-[#f9c74f]'
                : 'text-zinc-700 hover:bg-zinc-100'
            }`}
          >
            All Notices ({totalSent})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('UNREAD')}
            className={`text-xs font-black py-1.5 px-3.5 rounded-xl transition flex items-center gap-1.5 ${
              statusFilter === 'UNREAD'
                ? 'bg-amber-500 text-black'
                : 'text-amber-800 hover:bg-amber-50'
            }`}
          >
            <i className="fas fa-envelope"></i>
            <span>Unread ({unreadCount})</span>
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('READ')}
            className={`text-xs font-black py-1.5 px-3.5 rounded-xl transition flex items-center gap-1.5 ${
              statusFilter === 'READ'
                ? 'bg-emerald-600 text-white'
                : 'text-emerald-800 hover:bg-emerald-50'
            }`}
          >
            <i className="fas fa-check-double"></i>
            <span>Read ({readCount})</span>
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('REPLIED')}
            className={`text-xs font-black py-1.5 px-3.5 rounded-xl transition flex items-center gap-1.5 ${
              statusFilter === 'REPLIED'
                ? 'bg-purple-600 text-white'
                : 'text-purple-800 hover:bg-purple-50'
            }`}
          >
            <i className="fas fa-comments"></i>
            <span>Replied ({repliedCount})</span>
          </button>
        </div>

        {/* Search input */}
        <div className="relative flex-1 sm:max-w-xs">
          <i className="fas fa-search absolute left-3 top-3 text-zinc-400 text-xs"></i>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search rider, title or message..."
            className="w-full pl-8 pr-3 py-2 text-xs font-bold rounded-2xl border-2 border-zinc-900 bg-white shadow-[0_2px_0_#d6d2ca] outline-none"
          />
        </div>
      </div>

      {/* Notices Feed / Table */}
      {loading ? (
        <div className="neo-card py-12 text-center text-zinc-500">
          <i className="fas fa-spinner fa-spin text-2xl mb-2 text-amber-500"></i>
          <p className="font-bold text-xs">Loading direct notices & statuses...</p>
        </div>
      ) : filteredNotices.length === 0 ? (
        <div className="neo-card py-14 text-center text-zinc-400">
          <i className="fas fa-inbox text-4xl mb-3 block opacity-40"></i>
          <h3 className="font-black text-sm text-zinc-700 mb-1">No Direct Notices Found</h3>
          <p className="text-xs text-zinc-500 max-w-sm mx-auto mb-4">
            {searchQuery || statusFilter !== 'ALL'
              ? 'No notices match your current filters. Try resetting your search.'
              : 'You have not dispatched any custom notices to users yet. Click Compose to get started.'}
          </p>
          <button
            type="button"
            onClick={() => onOpenComposer()}
            className="btn-primary py-2 px-5 text-xs font-black inline-flex items-center gap-1.5"
          >
            <i className="fas fa-plus"></i> Compose First Notice
          </button>
        </div>
      ) : (
        <div className="space-y-3.5">
          {filteredNotices.map((n) => {
            const replies = Array.isArray(n.replies) ? n.replies : [];
            const recipientProfile = allUsers.find((u) => u.id === n.recipientId);
            const isRead = n.isRead;
            const hasReplies = replies.length > 0;

            return (
              <div
                key={n.id}
                className={`neo-card p-4 sm:p-5 transition hover:translate-y-[-1px] ${
                  n.isUrgent
                    ? 'border-2 border-red-500 bg-red-50/40 shadow-[0_4px_0_#fca5a5]'
                    : isRead
                    ? 'border-2 border-zinc-300 bg-white shadow-[0_4px_0_#e5e7eb]'
                    : 'border-2 border-amber-400 bg-amber-50/50 shadow-[0_4px_0_#fcd34d]'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  {/* Left Column: Recipient Info & Message */}
                  <div className="flex-1 min-w-0">
                    {/* Header bar with badges */}
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      {n.isUrgent && (
                        <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-red-600 text-white border border-red-700">
                          URGENT
                        </span>
                      )}

                      {/* Recipient identity chip */}
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-zinc-100 border border-zinc-300 text-xs font-bold text-zinc-900">
                        <div className="w-5 h-5 rounded-full bg-zinc-800 text-[#f9c74f] flex items-center justify-center text-[10px] font-black overflow-hidden shrink-0">
                          {recipientProfile?.photoURL ? (
                            <img
                              src={recipientProfile.photoURL}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            (n.recipientName || 'R').charAt(0).toUpperCase()
                          )}
                        </div>
                        <span className="font-black text-zinc-900">
                          To: {n.recipientName || recipientProfile?.displayName || 'User'}
                        </span>
                        {n.recipientEmail && (
                          <span className="text-[10px] text-zinc-500 font-mono hidden sm:inline">
                            ({n.recipientEmail})
                          </span>
                        )}
                        {recipientProfile?.role && (
                          <span className={`role-badge ${recipientProfile.role} text-[9px] py-0 px-1.5`}>
                            {recipientProfile.role}
                          </span>
                        )}
                      </div>

                      <span className="text-[10px] text-zinc-400 font-bold ml-auto sm:ml-0">
                        Sent:{' '}
                        {new Date(n.createdAt).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                        })}{' '}
                        at{' '}
                        {new Date(n.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    {/* Notice Title */}
                    <h3 className="text-sm sm:text-base font-black text-zinc-900 mb-1 flex items-center gap-1.5">
                      <i className="fas fa-bullhorn text-amber-500 text-xs"></i>
                      <span>{n.title}</span>
                    </h3>

                    {/* Message Body */}
                    <p className="text-xs sm:text-sm text-zinc-700 leading-relaxed break-words whitespace-pre-wrap bg-zinc-50/80 p-3 rounded-xl border border-zinc-200 mb-3">
                      {n.message}
                    </p>

                    {/* Replies count and latest reply preview */}
                    {hasReplies && (
                      <div className="p-2.5 rounded-xl bg-purple-50 border border-purple-200 text-xs text-purple-900 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-full bg-purple-700 text-white flex items-center justify-center text-[10px]">
                            <i className="fas fa-reply"></i>
                          </span>
                          <span className="font-black">
                            {replies.length} {replies.length === 1 ? 'Reply' : 'Replies'} in thread
                          </span>
                          <span className="text-purple-600 text-[11px] truncate max-w-xs hidden md:inline">
                            • Latest from {replies[replies.length - 1].senderName}: "
                            {replies[replies.length - 1].text.substring(0, 50)}..."
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setActiveThreadNotice(n)}
                          className="text-[11px] font-black text-purple-900 hover:underline shrink-0"
                        >
                          View Full Conversation &rarr;
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Right Column: Status Tracker & Action Controls */}
                  <div className="lg:w-64 shrink-0 flex flex-col justify-between border-t lg:border-t-0 lg:border-l border-zinc-200 pt-3 lg:pt-0 lg:pl-4 space-y-3">
                    <div className="space-y-2">
                      {/* Delivery Status Card */}
                      <div className="p-2 rounded-xl bg-zinc-50 border border-zinc-200 text-xs">
                        <span className="text-[10px] font-black uppercase text-zinc-500 block mb-0.5">
                          Delivery Status
                        </span>
                        <div className="flex items-center gap-1.5 font-black text-emerald-700">
                          <i className="fas fa-check-circle text-emerald-600"></i>
                          <span>DELIVERED</span>
                        </div>
                        <span className="text-[10px] text-zinc-500 font-medium block">
                          {n.deliveredAt
                            ? new Date(n.deliveredAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })
                            : 'Confirmed via Firestore'}
                        </span>
                      </div>

                      {/* Read Status Card */}
                      <div
                        className={`p-2 rounded-xl border text-xs ${
                          isRead
                            ? 'bg-blue-50/70 border-blue-200 text-blue-900'
                            : 'bg-amber-50/70 border-amber-200 text-amber-900'
                        }`}
                      >
                        <span className="text-[10px] font-black uppercase block mb-0.5 opacity-80">
                          Read / View Status
                        </span>
                        {isRead ? (
                          <>
                            <div className="flex items-center gap-1.5 font-black text-blue-700">
                              <i className="fas fa-eye text-blue-600"></i>
                              <span>VIEWED / READ</span>
                            </div>
                            <span className="text-[10px] text-blue-800 font-bold block mt-0.5">
                              {n.readAt ? (
                                <>
                                  {new Date(n.readAt).toLocaleDateString([], {
                                    month: 'short',
                                    day: 'numeric',
                                  })}{' '}
                                  at{' '}
                                  {new Date(n.readAt).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </>
                              ) : (
                                'Read by recipient'
                              )}
                            </span>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-1.5 font-black text-amber-800">
                              <i className="fas fa-clock text-amber-600"></i>
                              <span>UNREAD (PENDING)</span>
                            </div>
                            <span className="text-[10px] text-amber-700 font-medium block mt-0.5">
                              User has not opened notice yet
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setActiveThreadNotice(n)}
                        className="btn-primary flex-1 py-1.5 px-3 text-xs font-black flex items-center justify-center gap-1 bg-[#1e1e1e] text-[#f9c74f] rounded-xl hover:bg-black transition cursor-pointer"
                      >
                        <i className="fas fa-comments"></i>
                        <span>{hasReplies ? `Thread (${replies.length})` : 'Reply / Thread'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => handleDeleteNotice(n.id, e)}
                        className="p-1.5 text-xs text-red-600 hover:text-red-800 hover:bg-red-50 border border-zinc-200 rounded-xl transition cursor-pointer"
                        title="Delete notice record"
                      >
                        <i className="fas fa-trash-alt"></i>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL 1: SEND DIRECT NOTICE COMPOSER */}
      {isComposerOpen && (
        <div
          className="modal-overlay open"
          onClick={(e) => {
            if (e.target === e.currentTarget) onCloseComposer();
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="modal max-w-2xl w-full p-6 sm:p-8 border-3 border-[#1e1e1e] bg-white rounded-3xl shadow-[0_10px_0_#1e1e1e] max-h-[90vh] overflow-y-auto">
            <button
              type="button"
              className="modal-close"
              onClick={onCloseComposer}
              aria-label="Close"
            >
              <i className="fas fa-times"></i>
            </button>

            <div className="flex items-center gap-3 mb-5 pb-3 border-b-2 border-zinc-200">
              <div className="w-12 h-12 rounded-2xl bg-[#1e1e1e] text-[#f9c74f] border-2 border-[#1e1e1e] flex items-center justify-center text-xl shadow-[0_3px_0_#1e1e1e] shrink-0">
                <i className="fas fa-paper-plane"></i>
              </div>
              <div>
                <h3 className="font-black text-xl text-zinc-900 tracking-tight">
                  Dispatch Custom Direct Notice
                </h3>
                <p className="text-xs text-zinc-600">
                  Choose any registered rider to send an official direct administrative notice.
                </p>
              </div>
            </div>

            {formError && (
              <div className="mb-4 p-3 bg-red-100 border-2 border-red-400 text-red-900 text-xs font-bold rounded-xl flex items-center gap-2">
                <i className="fas fa-exclamation-circle text-red-600"></i>
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSendNotice} className="space-y-4">
              {/* Recipient User Selector */}
              <div>
                <label className="block text-xs font-black uppercase tracking-wider mb-1 text-zinc-800">
                  Select Recipient Rider *
                </label>
                <div className="relative">
                  <select
                    value={selectedRecipientId}
                    onChange={(e) => {
                      setSelectedRecipientId(e.target.value);
                      const target = allUsers.find((u) => u.id === e.target.value);
                      if (target) {
                        setNoticeTitle(`Official Notice for ${target.displayName}`);
                      }
                    }}
                    required
                    className="w-full text-xs font-bold p-3 rounded-xl border-2 border-zinc-900 bg-white shadow-[0_2px_0_#d6d2ca] outline-none cursor-pointer"
                  >
                    <option value="" disabled>
                      -- Choose a user --
                    </option>
                    {allUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.displayName} ({u.email || 'No email'}) • [{u.role}]
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Quick Preset Templates */}
              <div>
                <span className="block text-[11px] font-black uppercase tracking-wider mb-1.5 text-zinc-500">
                  Quick Message Presets:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {NOTICE_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.label}
                      type="button"
                      onClick={() => handleApplyTemplate(tpl)}
                      className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-zinc-100 hover:bg-[#f9c74f] text-zinc-800 border border-zinc-300 transition"
                    >
                      + {tpl.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Title / Subject */}
              <div>
                <label className="block text-xs font-black uppercase tracking-wider mb-1 text-zinc-800">
                  Notice Subject / Header *
                </label>
                <input
                  type="text"
                  required
                  value={noticeTitle}
                  onChange={(e) => setNoticeTitle(e.target.value)}
                  placeholder="e.g. Action Required: Membership Verification"
                  className="w-full text-xs sm:text-sm font-bold p-2.5 rounded-xl border-2 border-zinc-900 bg-white outline-none"
                  maxLength={120}
                />
              </div>

              {/* Message Body */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-black uppercase tracking-wider text-zinc-800">
                    Message Body *
                  </label>
                  <span className="text-[10px] text-zinc-400 font-semibold">
                    {noticeMessage.length}/2000 characters
                  </span>
                </div>
                <textarea
                  required
                  rows={5}
                  value={noticeMessage}
                  onChange={(e) => setNoticeMessage(e.target.value)}
                  placeholder="Type your direct message to the user here. They will receive it in their notifications drawer and can reply back..."
                  className="w-full text-xs sm:text-sm p-3 rounded-xl border-2 border-zinc-900 bg-white outline-none resize-y font-normal"
                  maxLength={2000}
                />
              </div>

              {/* Urgent Toggle */}
              <div className="flex items-center gap-2.5 p-3 rounded-xl bg-zinc-50 border border-zinc-200">
                <input
                  type="checkbox"
                  id="urgentToggle"
                  checked={isUrgent}
                  onChange={(e) => setIsUrgent(e.target.checked)}
                  className="w-4 h-4 rounded border-2 border-zinc-900 text-red-600 focus:ring-red-500 cursor-pointer"
                />
                <label
                  htmlFor="urgentToggle"
                  className="text-xs font-bold text-zinc-800 cursor-pointer flex items-center gap-1.5"
                >
                  <i className="fas fa-exclamation-triangle text-amber-500"></i>
                  <span>Mark as Urgent Notice (highlights in prominent red banner for user)</span>
                </label>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-3 border-t border-zinc-200">
                <button
                  type="button"
                  onClick={onCloseComposer}
                  disabled={isSending}
                  className="btn-secondary py-2 px-5 text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSending}
                  className="btn-primary py-2 px-6 text-xs font-black flex items-center gap-2 bg-[#1e1e1e] text-[#f9c74f] border-2 border-black rounded-xl shadow-[0_3px_0_#999] hover:bg-black transition cursor-pointer disabled:opacity-50"
                >
                  {isSending ? (
                    <>
                      <i className="fas fa-spinner fa-spin"></i>
                      <span>Transmitting Notice...</span>
                    </>
                  ) : (
                    <>
                      <i className="fas fa-paper-plane"></i>
                      <span>Send Notice Directly</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: THREAD CONVERSATION & REPLY DRAWER */}
      {activeThreadNotice && (
        <div
          className="modal-overlay open"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveThreadNotice(null);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="modal max-w-xl w-full p-6 sm:p-7 border-3 border-[#1e1e1e] bg-white rounded-3xl shadow-[0_10px_0_#1e1e1e] max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b-2 border-zinc-200 mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-[#1e1e1e] text-[#f9c74f] border-2 border-[#1e1e1e] flex items-center justify-center text-sm shadow-[0_2px_0_#1e1e1e]">
                  <i className="fas fa-comments"></i>
                </div>
                <div>
                  <h3 className="font-black text-base text-zinc-900 tracking-tight">
                    Notice Conversation Thread
                  </h3>
                  <p className="text-[11px] text-zinc-500 font-medium">
                    With {activeThreadNotice.recipientName || 'Rider'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="text-zinc-500 hover:text-black p-1 text-lg"
                onClick={() => setActiveThreadNotice(null)}
                aria-label="Close"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>

            {/* Status overview in modal */}
            <div className="flex items-center justify-between gap-2 p-2.5 bg-zinc-50 rounded-xl border border-zinc-200 mb-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-bold text-zinc-600">Status:</span>
                <span className="text-emerald-700 font-black flex items-center gap-1">
                  <i className="fas fa-check-double text-[10px]"></i> Delivered
                </span>
                <span>•</span>
                {activeThreadNotice.isRead ? (
                  <span className="text-blue-700 font-black flex items-center gap-1">
                    <i className="fas fa-eye text-[10px]"></i> Read
                  </span>
                ) : (
                  <span className="text-amber-800 font-black flex items-center gap-1">
                    <i className="fas fa-clock text-[10px]"></i> Unread
                  </span>
                )}
              </div>
              <span className="text-[10px] text-zinc-400 font-semibold">
                {new Date(activeThreadNotice.createdAt).toLocaleDateString()}
              </span>
            </div>

            {/* Conversation Flow */}
            <div className="overflow-y-auto flex-1 space-y-3 pr-1 mb-4">
              {/* Initial Super Admin Notice */}
              <div className="p-3.5 rounded-2xl bg-amber-50/70 border-2 border-amber-300">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-black text-xs text-zinc-900">
                      Super Admin (You)
                    </span>
                    <span className="text-[9px] bg-[#1e1e1e] text-[#f9c74f] px-1.5 py-0.2 rounded font-black">
                      OWNER
                    </span>
                  </div>
                  <span className="text-[10px] text-zinc-400">
                    {new Date(activeThreadNotice.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <h4 className="font-black text-xs text-zinc-900 mb-1">
                  {activeThreadNotice.title}
                </h4>
                <p className="text-xs text-zinc-800 whitespace-pre-wrap leading-relaxed">
                  {activeThreadNotice.message}
                </p>
              </div>

              {/* Thread Replies */}
              {Array.isArray(activeThreadNotice.replies) &&
              activeThreadNotice.replies.length > 0 ? (
                activeThreadNotice.replies.map((r) => {
                  const isMe = r.senderId === user?.uid || r.senderRole === 'SUPER_ADMIN';
                  return (
                    <div
                      key={r.id}
                      className={`p-3 rounded-2xl border text-xs ${
                        isMe
                          ? 'bg-amber-50/80 border-amber-300 ml-4'
                          : 'bg-zinc-50 border-zinc-200 mr-4'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-black text-zinc-900">
                            {isMe ? 'Super Admin (You)' : r.senderName}
                          </span>
                          {r.senderRole === 'SUPER_ADMIN' ? (
                            <span className="text-[9px] bg-[#1e1e1e] text-[#f9c74f] px-1.5 py-0.2 rounded font-black">
                              SUPER ADMIN
                            </span>
                          ) : (
                            <span className="text-[9px] bg-zinc-200 text-zinc-800 px-1.5 py-0.2 rounded font-bold">
                              {r.senderRole || 'RIDER'}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-zinc-400">
                          {new Date(r.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <p className="text-zinc-800 leading-snug whitespace-pre-wrap">{r.text}</p>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-6 text-zinc-400">
                  <i className="fas fa-comment-dots text-2xl mb-1 block opacity-30"></i>
                  <p className="text-xs font-bold text-zinc-500">No replies in thread yet</p>
                  <p className="text-[11px] text-zinc-400">
                    When {activeThreadNotice.recipientName || 'the rider'} replies to this notice,
                    their message will appear here.
                  </p>
                </div>
              )}
            </div>

            {/* Admin Response Form */}
            <form onSubmit={handleAdminReplySubmit} className="pt-3 border-t border-zinc-200 space-y-2">
              <label className="block text-[11px] font-black uppercase text-zinc-700">
                Send Follow-up Message in Thread:
              </label>
              <div className="flex gap-2">
                <textarea
                  rows={2}
                  value={adminReplyText}
                  onChange={(e) => setAdminReplyText(e.target.value)}
                  placeholder={`Write a follow-up reply to ${activeThreadNotice.recipientName || 'rider'}...`}
                  className="flex-1 text-xs p-2.5 rounded-xl border-2 border-zinc-300 focus:border-[#1e1e1e] outline-none resize-none bg-white font-normal"
                  maxLength={1000}
                />
                <button
                  type="submit"
                  disabled={!adminReplyText.trim() || submittingReply}
                  className="btn-primary px-4 text-xs font-black bg-[#1e1e1e] text-[#f9c74f] rounded-xl self-end py-2.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-[0_2px_0_#999]"
                >
                  {submittingReply ? (
                    <i className="fas fa-spinner fa-spin"></i>
                  ) : (
                    <i className="fas fa-paper-plane"></i>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
