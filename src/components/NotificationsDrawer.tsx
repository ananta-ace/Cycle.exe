import React, { useState, useEffect } from 'react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { AppNotification, TabType } from '../types';

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
  const { user, isSuperAdmin, isAdmin } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

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
            (isSuperAdmin && (data.recipientId === 'SUPER_ADMIN' || data.recipientId === 'ALL_ADMINS')) ||
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

  const markAsRead = async (id: string) => {
    try {
      await updateDoc(doc(db, 'notifications', id), { isRead: true });
    } catch (err) {
      console.error('Error updating notification:', err);
    }
  };

  const markAllAsRead = async () => {
    const unread = notifications.filter((n) => !n.isRead);
    for (const item of unread) {
      try {
        await updateDoc(doc(db, 'notifications', item.id), { isRead: true });
      } catch (err) {
        console.error('Error marking all as read:', err);
      }
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
    if (!notif.isRead) {
      await markAsRead(notif.id);
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

  return (
    <div
      className="modal-overlay open"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal max-w-lg w-full p-6 sm:p-7 border-3 border-[#1e1e1e] bg-white rounded-3xl shadow-[0_10px_0_#1e1e1e] max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-zinc-200 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#f9c74f] text-[#1e1e1e] border-2 border-[#1e1e1e] flex items-center justify-center text-sm shadow-[0_2px_0_#1e1e1e]">
              <i className="fas fa-bell"></i>
            </div>
            <div>
              <h3 className="font-black text-base text-zinc-900 tracking-tight">Notifications</h3>
              <p className="text-[11px] text-zinc-500 font-medium">Activity and platform updates</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
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
              className="text-zinc-500 hover:text-black p-1 text-lg"
              onClick={onClose}
              aria-label="Close"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>
        </div>

        {/* Content list */}
        <div className="overflow-y-auto flex-1 space-y-2.5 pr-1">
          {loading ? (
            <div className="py-8 text-center text-zinc-500 text-xs font-bold">
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
              return (
                <div
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  className={`p-3 rounded-2xl border-2 transition cursor-pointer relative group ${
                    isUnread
                      ? 'bg-amber-50/80 border-amber-300 hover:bg-amber-50 shadow-[0_2px_0_#d6d2ca]'
                      : 'bg-zinc-50 border-zinc-200 hover:bg-zinc-100'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <div
                      className={`w-8 h-8 rounded-xl border flex items-center justify-center text-xs shrink-0 ${
                        notif.type === 'APPLICATION_SUBMITTED'
                          ? 'bg-[#1e1e1e] text-[#f9c74f] border-black'
                          : notif.type === 'APPLICATION_APPROVED'
                          ? 'bg-emerald-500 text-white border-emerald-600'
                          : notif.type === 'APPLICATION_REJECTED'
                          ? 'bg-rose-500 text-white border-rose-600'
                          : 'bg-blue-500 text-white border-blue-600'
                      }`}
                    >
                      <i
                        className={`fas ${
                          notif.type === 'APPLICATION_SUBMITTED'
                            ? 'fa-bicycle'
                            : notif.type === 'APPLICATION_APPROVED'
                            ? 'fa-check'
                            : notif.type === 'APPLICATION_REJECTED'
                            ? 'fa-times'
                            : 'fa-info'
                        }`}
                      ></i>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <h4 className="font-black text-xs text-zinc-900 truncate">
                          {notif.title}
                        </h4>
                        <span className="text-[10px] text-zinc-400 shrink-0 font-medium">
                          {new Date(notif.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-700 leading-snug break-words">
                        {notif.message}
                      </p>
                      {notif.applicantName && (
                        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-600 font-bold">
                          {notif.applicantPhotoURL && (
                            <img
                              src={notif.applicantPhotoURL}
                              alt=""
                              className="w-4 h-4 rounded-full object-cover border border-zinc-400"
                            />
                          )}
                          <span>Applicant: {notif.applicantName}</span>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={(e) => deleteNotification(notif.id, e)}
                      className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-600 transition p-1 text-xs shrink-0"
                      title="Dismiss"
                    >
                      <i className="fas fa-trash-alt"></i>
                    </button>
                  </div>
                  {isUnread && (
                    <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-amber-500"></span>
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
