import React, { useState, useEffect } from 'react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  addDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { AppNotification, TabType, NoticeReply } from '../types';

interface NotificationsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateTab: (tab: TabType) => void;
}

export const NotificationsDrawer: React.FC<NotificationsDrawerProps> = ({
  isOpen,
  onClose,
  onNavigateTab,
}) => {
  const { user, isSuperAdmin, isAdmin, role } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  // Expanded notice ID to view full thread & reply
  const [expandedNoticeId, setExpandedNoticeId] = useState<string | null>(null);
  const [replyTextMap, setReplyTextMap] = useState<Record<string, string>>({});
  const [submittingReplyId, setSubmittingReplyId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !user) return;

    const notifsRef = collection(db, 'notifications');
    const q = query(notifsRef, orderBy('createdAt', 'desc'));

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list: AppNotification[] = [];
        snapshot.forEach((snap) => {
          const data = snap.data() as Omit<AppNotification, 'id'>;
          const isRecipient =
            data.recipientId === user.uid ||
            (isSuperAdmin &&
              (data.recipientId === 'SUPER_ADMIN' ||
                data.recipientId === 'ALL_ADMINS' ||
                data.senderId === user.uid)) ||
            (isAdmin && data.recipientId === 'ALL_ADMINS');

          if (isRecipient) {
            list.push({ id: snap.id, ...data });
          }
        });
        setNotifications(list);
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching notifications:', err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [isOpen, user, isSuperAdmin, isAdmin]);

  if (!isOpen) return null;

  const markAsRead = async (notif: AppNotification) => {
    if (notif.isRead) return;
    const now = new Date().toISOString();
    try {
      await updateDoc(doc(db, 'notifications', notif.id), {
        isRead: true,
        readAt: notif.readAt || now,
        deliveryStatus: 'READ',
        updatedAt: now,
      });
    } catch (err) {
      console.warn('Client updateDoc read status failed, attempting server proxy:', err);
      try {
        await fetch('/api/notices/mark-read', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': user?.uid || '',
            'x-user-email': user?.email || '',
            'x-user-role': role || 'PUBLIC',
          },
          body: JSON.stringify({ noticeId: notif.id }),
        });
      } catch (e) {
        console.error('Error marking as read:', e);
      }
    }
  };

  const markAllAsRead = async () => {
    const unread = notifications.filter((n) => !n.isRead);
    for (const item of unread) {
      await markAsRead(item);
    }
  };

  const deleteNotification = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteDoc(doc(db, 'notifications', id));
    } catch (err) {
      console.error('Error deleting notification:', err);
    }
  };

  const handleNotificationClick = async (notif: AppNotification) => {
    await markAsRead(notif);

    // If it's a direct notice or has replies, toggle expand
    if (notif.isDirectNotice || notif.type === 'DIRECT_NOTICE' || (notif.replies && notif.replies.length > 0)) {
      setExpandedNoticeId((prev) => (prev === notif.id ? null : notif.id));
      return;
    }

    if (notif.type === 'APPLICATION_SUBMITTED' && isSuperAdmin) {
      onNavigateTab('superadmin');
      onClose();
    } else if (notif.type === 'APPLICATION_SUBMITTED' && isAdmin) {
      onNavigateTab('admin');
      onClose();
    } else if (notif.type === 'APPLICATION_APPROVED' || notif.type === 'STATUS_CHANGED') {
      onNavigateTab('profile');
      onClose();
    }
  };

  const handleSendReply = async (notif: AppNotification) => {
    const text = replyTextMap[notif.id]?.trim();
    if (!text || !user) return;

    setSubmittingReplyId(notif.id);

    const now = new Date().toISOString();
    const replyItem: NoticeReply = {
      id: `reply_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      senderId: user.uid,
      senderName: user.displayName || 'Rider',
      senderEmail: user.email || '',
      senderRole: isSuperAdmin ? 'SUPER_ADMIN' : role,
      senderPhotoURL: user.photoURL || '',
      text,
      createdAt: now,
    };

    const currentReplies = Array.isArray(notif.replies) ? notif.replies : [];
    const newReplies = [...currentReplies, replyItem];

    try {
      // 1. Direct Firestore update
      await updateDoc(doc(db, 'notifications', notif.id), {
        replies: newReplies,
        replyCount: newReplies.length,
        lastRepliedAt: now,
        hasNewReply: true,
        updatedAt: now,
      });

      // 2. If user replied (not superadmin replying to themselves), notify Super Admin
      if (!isSuperAdmin) {
        await addDoc(collection(db, 'notifications'), {
          recipientId: 'SUPER_ADMIN',
          type: 'SYSTEM',
          title: `💬 Reply from ${user.displayName || 'User'}`,
          message: `Re: "${notif.title}": ${text.substring(0, 140)}`,
          link: notif.id,
          isRead: false,
          createdAt: now,
        });
      }

      // Clear input
      setReplyTextMap((prev) => ({ ...prev, [notif.id]: '' }));
    } catch (err) {
      console.warn('Direct update failed, falling back to server API /api/notices/reply:', err);
      try {
        const resp = await fetch('/api/notices/reply', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': user.uid,
            'x-user-email': user.email || '',
            'x-user-role': role || 'PUBLIC',
          },
          body: JSON.stringify({
            noticeId: notif.id,
            text,
          }),
        });
        if (resp.ok) {
          setReplyTextMap((prev) => ({ ...prev, [notif.id]: '' }));
        } else {
          const errData = await resp.json();
          alert(errData.error || 'Failed to send reply');
        }
      } catch (fetchErr) {
        console.error('Server reply failed:', fetchErr);
        alert('Network error sending reply');
      }
    } finally {
      setSubmittingReplyId(null);
    }
  };

  return (
    <div
      className="modal-overlay open"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal max-w-xl w-full p-5 sm:p-7 border-3 border-[#1e1e1e] bg-white rounded-3xl shadow-[0_10px_0_#1e1e1e] max-h-[88vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b-2 border-zinc-200 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-[#f9c74f] text-[#1e1e1e] border-2 border-[#1e1e1e] flex items-center justify-center text-sm shadow-[0_2px_0_#1e1e1e]">
              <i className="fas fa-bell"></i>
            </div>
            <div>
              <h3 className="font-black text-base text-zinc-900 tracking-tight">Notifications & Notices</h3>
              <p className="text-[11px] text-zinc-500 font-medium">Direct messages, updates & replies</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {notifications.some((n) => !n.isRead) && (
              <button
                type="button"
                onClick={markAllAsRead}
                className="text-xs font-bold text-amber-700 hover:text-amber-900 underline underline-offset-2"
              >
                Mark all read
              </button>
            )}
            <button
              type="button"
              className="text-zinc-500 hover:text-black p-1 text-lg transition"
              onClick={onClose}
              aria-label="Close"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>
        </div>

        {/* Content list */}
        <div className="overflow-y-auto flex-1 space-y-3 pr-1">
          {loading ? (
            <div className="py-10 text-center text-zinc-500 text-xs font-bold">
              <i className="fas fa-spinner fa-spin text-base mr-2"></i> Loading notifications...
            </div>
          ) : notifications.length === 0 ? (
            <div className="py-12 text-center text-zinc-400">
              <i className="fas fa-bell-slash text-3xl mb-2 block opacity-40"></i>
              <p className="font-bold text-xs text-zinc-500">No notifications yet</p>
              <p className="text-[11px] text-zinc-400">You're completely caught up!</p>
            </div>
          ) : (
            notifications.map((notif) => {
              const isUnread = !notif.isRead;
              const isDirectNotice = notif.isDirectNotice || notif.type === 'DIRECT_NOTICE';
              const isExpanded = expandedNoticeId === notif.id;
              const replies = Array.isArray(notif.replies) ? notif.replies : [];
              const replyText = replyTextMap[notif.id] || '';
              const isSubmitting = submittingReplyId === notif.id;

              return (
                <div
                  key={notif.id}
                  className={`rounded-2xl border-2 transition relative ${
                    isDirectNotice
                      ? notif.isUrgent
                        ? 'bg-red-50/90 border-red-400 shadow-[0_3px_0_#f87171]'
                        : 'bg-amber-50/90 border-[#1e1e1e] shadow-[0_3px_0_#1e1e1e]'
                      : isUnread
                      ? 'bg-amber-50/70 border-amber-300 shadow-[0_2px_0_#d6d2ca]'
                      : 'bg-zinc-50 border-zinc-200 hover:bg-zinc-100/70'
                  }`}
                >
                  {/* Card Main Header / Row */}
                  <div
                    onClick={() => handleNotificationClick(notif)}
                    className="p-3.5 cursor-pointer"
                  >
                    <div className="flex items-start gap-3">
                      {/* Icon */}
                      <div
                        className={`w-9 h-9 rounded-xl border-2 flex items-center justify-center text-xs shrink-0 shadow-sm ${
                          isDirectNotice
                            ? notif.isUrgent
                              ? 'bg-red-600 text-white border-red-700'
                              : 'bg-[#1e1e1e] text-[#f9c74f] border-[#1e1e1e]'
                            : notif.type === 'APPLICATION_SUBMITTED'
                            ? 'bg-[#1e1e1e] text-[#f9c74f] border-black'
                            : notif.type === 'APPLICATION_APPROVED'
                            ? 'bg-emerald-500 text-white border-emerald-600'
                            : notif.type === 'APPLICATION_REJECTED'
                            ? 'bg-rose-500 text-white border-rose-600'
                            : 'bg-blue-600 text-white border-blue-700'
                        }`}
                      >
                        <i
                          className={`fas ${
                            isDirectNotice
                              ? notif.isUrgent
                                ? 'fa-exclamation-triangle'
                                : 'fa-envelope-open-text'
                              : notif.type === 'APPLICATION_SUBMITTED'
                              ? 'fa-bicycle'
                              : notif.type === 'APPLICATION_APPROVED'
                              ? 'fa-check'
                              : notif.type === 'APPLICATION_REJECTED'
                              ? 'fa-times'
                              : 'fa-info'
                          }`}
                        ></i>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {isDirectNotice && (
                              <span
                                className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${
                                  notif.isUrgent
                                    ? 'bg-red-600 text-white border-red-700'
                                    : 'bg-[#1e1e1e] text-[#f9c74f] border-[#1e1e1e]'
                                }`}
                              >
                                {notif.isUrgent ? 'URGENT NOTICE' : 'DIRECT NOTICE FROM SUPER ADMIN'}
                              </span>
                            )}
                            <h4 className="font-black text-xs text-zinc-900 truncate">
                              {notif.title}
                            </h4>
                          </div>

                          <span className="text-[10px] text-zinc-400 shrink-0 font-semibold">
                            {new Date(notif.createdAt).toLocaleDateString([], {
                              month: 'short',
                              day: 'numeric',
                            })}{' '}
                            {new Date(notif.createdAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>

                        {/* Delivery & Read Status for Direct Notices */}
                        {isDirectNotice && (
                          <div className="flex items-center gap-2 mb-1.5 text-[10px]">
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-bold bg-emerald-100/80 px-2 py-0.5 rounded-md border border-emerald-300">
                              <i className="fas fa-check-double text-[9px]"></i>
                              Delivered
                            </span>

                            {notif.isRead ? (
                              <span className="inline-flex items-center gap-1 text-blue-700 font-bold bg-blue-100/80 px-2 py-0.5 rounded-md border border-blue-300">
                                <i className="fas fa-eye text-[9px]"></i>
                                Read{' '}
                                {notif.readAt &&
                                  new Date(notif.readAt).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-amber-800 font-bold bg-amber-100/80 px-2 py-0.5 rounded-md border border-amber-300">
                                <i className="fas fa-envelope text-[9px]"></i>
                                Unread
                              </span>
                            )}

                            {replies.length > 0 && (
                              <span className="inline-flex items-center gap-1 text-purple-800 font-bold bg-purple-100/80 px-2 py-0.5 rounded-md border border-purple-300">
                                <i className="fas fa-comments text-[9px]"></i>
                                {replies.length} {replies.length === 1 ? 'Reply' : 'Replies'}
                              </span>
                            )}
                          </div>
                        )}

                        <p className="text-xs text-zinc-800 leading-relaxed break-words whitespace-pre-wrap">
                          {notif.message}
                        </p>

                        {/* Interactive toggle prompt */}
                        {isDirectNotice && (
                          <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-600 font-bold">
                            <span className="text-amber-800 hover:text-amber-950 inline-flex items-center gap-1">
                              <i className={`fas ${isExpanded ? 'fa-chevron-up' : 'fa-reply'}`}></i>
                              {isExpanded
                                ? 'Collapse reply thread'
                                : replies.length > 0
                                ? `View conversation & reply (${replies.length})`
                                : 'Reply to Super Admin'}
                            </span>
                            {notif.senderName && (
                              <span className="text-[10px] text-zinc-500 font-medium">
                                From: {notif.senderName}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Dismiss button */}
                      <button
                        type="button"
                        onClick={(e) => deleteNotification(notif.id, e)}
                        className="text-zinc-400 hover:text-red-600 transition p-1 text-xs shrink-0"
                        title="Dismiss"
                      >
                        <i className="fas fa-trash-alt"></i>
                      </button>
                    </div>

                    {isUnread && (
                      <span className="absolute top-3 right-3 w-2.5 h-2.5 rounded-full bg-amber-500 ring-2 ring-white"></span>
                    )}
                  </div>

                  {/* Expanded Reply & Conversation Area */}
                  {isExpanded && (
                    <div className="border-t-2 border-zinc-200 bg-white/90 p-3.5 rounded-b-2xl">
                      {/* Existing Thread Replies */}
                      {replies.length > 0 ? (
                        <div className="space-y-2 mb-3 max-h-52 overflow-y-auto pr-1">
                          <p className="text-[11px] font-black text-zinc-600 uppercase tracking-wide">
                            Conversation Thread
                          </p>
                          {replies.map((rep) => {
                            const isMe = rep.senderId === user?.uid;
                            return (
                              <div
                                key={rep.id}
                                className={`p-2.5 rounded-xl border text-xs ${
                                  isMe
                                    ? 'bg-amber-50/70 border-amber-200 ml-4'
                                    : 'bg-zinc-50 border-zinc-200 mr-4'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2 mb-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-black text-zinc-900 text-[11px]">
                                      {rep.senderName}
                                    </span>
                                    {rep.senderRole === 'SUPER_ADMIN' ? (
                                      <span className="text-[9px] bg-[#1e1e1e] text-[#f9c74f] px-1.5 py-0.2 rounded font-black">
                                        SUPER ADMIN
                                      </span>
                                    ) : (
                                      <span className="text-[9px] bg-zinc-200 text-zinc-800 px-1.5 py-0.2 rounded font-bold">
                                        {rep.senderRole || 'RIDER'}
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[10px] text-zinc-400">
                                    {new Date(rep.createdAt).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </span>
                                </div>
                                <p className="text-zinc-800 leading-snug break-words whitespace-pre-wrap">
                                  {rep.text}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-[11px] text-zinc-500 italic mb-2">
                          No replies yet. Type below to reply directly to the Super Admin.
                        </p>
                      )}

                      {/* Reply Input Form */}
                      <div className="space-y-2">
                        <textarea
                          rows={2}
                          value={replyText}
                          onChange={(e) =>
                            setReplyTextMap((prev) => ({
                              ...prev,
                              [notif.id]: e.target.value,
                            }))
                          }
                          placeholder={
                            isSuperAdmin
                              ? 'Write a reply to the rider...'
                              : 'Write your reply to the Super Admin...'
                          }
                          className="w-full text-xs p-2.5 rounded-xl border-2 border-zinc-300 focus:border-[#1e1e1e] outline-none transition bg-white resize-none"
                          maxLength={1000}
                        />
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-zinc-400">
                            {replyText.length}/1000 characters
                          </span>
                          <button
                            type="button"
                            disabled={!replyText.trim() || isSubmitting}
                            onClick={() => handleSendReply(notif)}
                            className="inline-flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-xl bg-[#1e1e1e] text-[#f9c74f] hover:bg-black transition shadow-[0_2px_0_#999] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                          >
                            {isSubmitting ? (
                              <>
                                <i className="fas fa-spinner fa-spin"></i>
                                Sending...
                              </>
                            ) : (
                              <>
                                <i className="fas fa-paper-plane"></i>
                                Send Reply
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
