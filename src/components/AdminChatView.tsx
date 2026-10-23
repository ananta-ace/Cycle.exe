import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  setDoc,
  getDocs,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import {
  AdminChatMessage,
  AdminChatConversation,
  AdminChatType,
  AdminChatParticipant,
} from '../types';
import { uploadImage } from '../utils/imageUpload';

// WhatsApp-style reaction emojis
const QUICK_EMOJIS = ['👍', '❤️', '😂', '🚲', '⚡', '🔥', '🛡️', '🎯'];

// Group preset icons
const GROUP_ICON_PRESETS = [
  { icon: 'fa-users', label: 'Crew' },
  { icon: 'fa-bicycle', label: 'Ride' },
  { icon: 'fa-shield-alt', label: 'Shield' },
  { icon: 'fa-crown', label: 'Executive' },
  { icon: 'fa-flag-checkered', label: 'Mission' },
  { icon: 'fa-bolt', label: 'Sprint' },
  { icon: 'fa-map-marked-alt', label: 'Scouting' },
  { icon: 'fa-bullhorn', label: 'Briefing' },
];

// Web Audio synthesizer for WhatsApp Web notification chime
function playNotificationChime() {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    // Pleasant WhatsApp-like double chime (F5 -> A5)
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(698.46, ctx.currentTime); // F5
    osc1.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1); // A5

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1046.5, ctx.currentTime + 0.08); // C6
    osc2.frequency.exponentialRampToValueAtTime(1318.51, ctx.currentTime + 0.24); // E6

    gain.gain.setValueAtTime(0.01, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.38);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.15);
    osc2.start(ctx.currentTime + 0.08);
    osc2.stop(ctx.currentTime + 0.38);
  } catch (err) {
    console.debug('Chime suppressed:', err);
  }
}

// Deterministic conversation ID for 1-to-1 direct chats between two user UIDs
function getDirectChatId(uid1: string, uid2: string): string {
  const sorted = [uid1, uid2].sort();
  return `direct_${sorted[0]}_${sorted[1]}`;
}

export const AdminChatView: React.FC = () => {
  const { user, profile, isAdmin, isSuperAdmin } = useAuth();

  // All Admin conversations & messages state
  const [conversations, setConversations] = useState<AdminChatConversation[]>([]);
  const [activeChatId, setActiveChatId] = useState<string>(() => {
    return localStorage.getItem('cycle_whatsapp_active_chat') || 'group_all_admins_hq';
  });
  const [messages, setMessages] = useState<AdminChatMessage[]>([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(true);

  // Admin Directory (all active Admins and Super Admin)
  const [adminDirectory, setAdminDirectory] = useState<AdminChatParticipant[]>([]);
  const [loadingDirectory, setLoadingDirectory] = useState(false);

  // Message input & draft
  const [inputText, setInputText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [replyingTo, setReplyingTo] = useState<AdminChatMessage | null>(null);

  // Filter & Search
  const [chatSearch, setChatSearch] = useState('');
  const [chatFilter, setChatFilter] = useState<'all' | 'direct' | 'groups' | 'unread'>('all');
  const [messageSearchQuery, setMessageSearchQuery] = useState('');
  const [isMessageSearchOpen, setIsMessageSearchOpen] = useState(false);
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);

  // UI Modals
  const [isNewDirectModalOpen, setIsNewDirectModalOpen] = useState(false);
  const [isNewGroupModalOpen, setIsNewGroupModalOpen] = useState(false);
  const [isGroupInfoModalOpen, setIsGroupInfoModalOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);

  // New Group Form State
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [newGroupIcon, setNewGroupIcon] = useState('fa-users');
  const [selectedGroupParticipants, setSelectedGroupParticipants] = useState<string[]>([]);
  const [creatingGroup, setCreatingGroup] = useState(false);

  // Mobile navigation state (toggle between chat list and conversation)
  const [mobileShowConversation, setMobileShowConversation] = useState(false);

  // Notifications & Sound
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    return localStorage.getItem('cycle_chat_sound') !== 'false';
  });
  const [desktopNotifsEnabled, setDesktopNotifsEnabled] = useState<boolean>(() => {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted';
  });

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isInitialLoad = useRef(true);
  const lastMessageCount = useRef(0);

  // Persist selected chat
  useEffect(() => {
    if (activeChatId) {
      localStorage.setItem('cycle_whatsapp_active_chat', activeChatId);
    }
  }, [activeChatId]);

  // Request desktop notifications
  const handleEnableDesktopNotifications = async () => {
    if (typeof Notification === 'undefined') {
      alert('Desktop notifications are not supported in this browser.');
      return;
    }
    try {
      const res = await Notification.requestPermission();
      if (res === 'granted') {
        setDesktopNotifsEnabled(true);
      }
    } catch (e) {
      console.warn('Error requesting notifications:', e);
    }
  };

  const handleToggleSound = () => {
    const nextVal = !soundEnabled;
    setSoundEnabled(nextVal);
    localStorage.setItem('cycle_chat_sound', String(nextVal));
    if (nextVal) {
      playNotificationChime();
    }
  };

  // 1. Fetch & Listen to Admin Directory
  useEffect(() => {
    if (!isAdmin || !user) return;

    const fetchDirectory = async () => {
      try {
        setLoadingDirectory(true);
        // Try backend API first for full server-authoritative directory
        const res = await fetch('/api/admin/directory', {
          headers: {
            'x-user-id': user.uid,
            'x-user-email': user.email || '',
            'x-user-role': profile?.role || 'ADMIN',
          },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.admins && Array.isArray(data.admins)) {
            setAdminDirectory(data.admins);
            return;
          }
        }
      } catch (err) {
        console.debug('Falling back to direct Firestore users query:', err);
      }

      // Fallback: Direct Firestore query on users collection
      try {
        const usersSnap = await getDocs(collection(db, 'users'));
        const admins: AdminChatParticipant[] = [];
        usersSnap.forEach((docSnap) => {
          const u = docSnap.data();
          if (u.role === 'ADMIN' || u.role === 'SUPER_ADMIN') {
            admins.push({
              id: docSnap.id,
              displayName: u.displayName || (u.role === 'SUPER_ADMIN' ? 'Super Admin' : 'Admin'),
              email: u.email || '',
              role: u.role,
              photoURL: u.photoURL || '',
              customTitle: u.customTitle,
            });
          }
        });
        setAdminDirectory(admins);
      } catch (e) {
        console.warn('Directory query error:', e);
      } finally {
        setLoadingDirectory(false);
      }
    };

    fetchDirectory();
  }, [isAdmin, user, profile?.role]);

  // 2. Real-time Listener on Admin Chats Collection
  useEffect(() => {
    if (!isAdmin || !user) return;

    setLoadingChats(true);
    const chatsRef = collection(db, 'adminChats');
    const unsub = onSnapshot(
      chatsRef,
      (snapshot) => {
        const list: AdminChatConversation[] = [];
        snapshot.forEach((snapDoc) => {
          const data = snapDoc.data() as Omit<AdminChatConversation, 'id'>;
          list.push({ id: snapDoc.id, ...data });
        });

        // Ensure the default built-in group "group_all_admins_hq" exists
        const hasHq = list.some((c) => c.id === 'group_all_admins_hq');
        if (!hasHq) {
          const defaultHq: AdminChatConversation = {
            id: 'group_all_admins_hq',
            type: 'GROUP',
            name: 'Cycle.exe Leadership HQ',
            description: 'Official group chat for all Admins and the Super Admin',
            icon: 'fa-shield-alt',
            participantIds: ['all'],
            createdBy: 'system',
            createdByName: 'System',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: new Date().toISOString(),
          };
          list.unshift(defaultHq);
        }

        // Sort: Pinned first, then latest activity
        list.sort((a, b) => {
          if (a.isPinned && !b.isPinned) return -1;
          if (!a.isPinned && b.isPinned) return 1;
          const timeA = new Date(a.lastMessageAt || a.updatedAt || a.createdAt).getTime();
          const timeB = new Date(b.lastMessageAt || b.updatedAt || b.createdAt).getTime();
          return timeB - timeA;
        });

        setConversations(list);
        setLoadingChats(false);
      },
      (err) => {
        console.error('Error listening to admin chats:', err);
        setLoadingChats(false);
      }
    );

    return () => unsub();
  }, [isAdmin, user]);

  // 3. Real-time Listener on Admin Chat Messages
  useEffect(() => {
    if (!isAdmin || !user) return;

    setLoadingMessages(true);
    const messagesRef = collection(db, 'adminChatMessages');
    const q = query(messagesRef, orderBy('createdAt', 'asc'));

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list: AdminChatMessage[] = [];
        snapshot.forEach((snapDoc) => {
          const data = snapDoc.data() as Omit<AdminChatMessage, 'id'>;
          list.push({ id: snapDoc.id, ...data });
        });

        // Incoming message notification handling
        if (!isInitialLoad.current && list.length > lastMessageCount.current) {
          const newest = list[list.length - 1];
          if (newest && newest.senderId !== user.uid) {
            // Play audio chime
            if (soundEnabled) {
              playNotificationChime();
            }

            // Desktop notification if permitted & window hidden
            if (desktopNotifsEnabled && document.hidden) {
              try {
                new Notification(`Cycle.exe Admin [${newest.senderName}]`, {
                  body: newest.text.substring(0, 90) || 'Sent a photo',
                  icon: '/images/favicon.png',
                });
              } catch (e) {
                console.debug('Notification trigger error:', e);
              }
            }
          }
        }

        lastMessageCount.current = list.length;
        setMessages(list);
        setLoadingMessages(false);

        // Auto-scroll on initial load or if user is near bottom
        if (isInitialLoad.current) {
          setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
            isInitialLoad.current = false;
          }, 150);
        } else {
          const container = chatScrollContainerRef.current;
          if (container) {
            const isNearBottom =
              container.scrollHeight - container.scrollTop - container.clientHeight < 250;
            if (isNearBottom) {
              messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }
          }
        }
      },
      (err) => {
        console.error('Error listening to admin chat messages:', err);
        setLoadingMessages(false);
      }
    );

    return () => unsub();
  }, [isAdmin, user, soundEnabled, desktopNotifsEnabled]);

  // Active conversation object
  const activeChat = useMemo(() => {
    return (
      conversations.find((c) => c.id === activeChatId) ||
      conversations[0] || {
        id: 'group_all_admins_hq',
        type: 'GROUP' as AdminChatType,
        name: 'Cycle.exe Leadership HQ',
        description: 'Official group chat for all Admins and Super Admin',
        icon: 'fa-shield-alt',
        participantIds: ['all'],
        createdBy: 'system',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
    );
  }, [conversations, activeChatId]);

  // Messages filtered for the active conversation
  const currentChatMessages = useMemo(() => {
    return messages.filter((m) => {
      // Direct or topic match
      const isChatMatch =
        m.chatId === activeChat.id ||
        m.topicId === activeChat.id ||
        (!m.chatId && activeChat.id === 'group_all_admins_hq' && (!m.topicId || m.topicId === 'general-hq'));

      if (!isChatMatch) return false;

      // Pinned filter
      if (showPinnedOnly && !m.isPinned) return false;

      // Search filter
      if (messageSearchQuery.trim()) {
        const q = messageSearchQuery.toLowerCase();
        const matchesText = m.text?.toLowerCase().includes(q);
        const matchesSender = m.senderName?.toLowerCase().includes(q);
        if (!matchesText && !matchesSender) return false;
      }

      return true;
    });
  }, [messages, activeChat.id, showPinnedOnly, messageSearchQuery]);

  // Pinned messages count in current chat
  const pinnedMessagesCount = useMemo(() => {
    return messages.filter((m) => {
      const isChatMatch =
        m.chatId === activeChat.id ||
        m.topicId === activeChat.id ||
        (!m.chatId && activeChat.id === 'group_all_admins_hq');
      return isChatMatch && m.isPinned;
    }).length;
  }, [messages, activeChat.id]);

  // Mark unread messages as read when viewing active chat
  useEffect(() => {
    if (!user || !isAdmin || currentChatMessages.length === 0) return;

    const unread = currentChatMessages.filter((m) => {
      return m.senderId !== user.uid && (!m.readBy || !m.readBy.includes(user.uid));
    });

    if (unread.length > 0) {
      unread.forEach(async (msg) => {
        try {
          const currentReadBy = Array.isArray(msg.readBy) ? msg.readBy : [];
          await updateDoc(doc(db, 'adminChatMessages', msg.id), {
            readBy: [...currentReadBy, user.uid],
            updatedAt: new Date().toISOString(),
          });
        } catch {
          // Non-blocking read receipt update
        }
      });
    }
  }, [user, isAdmin, activeChat.id, currentChatMessages]);

  // Calculate unread count for each conversation
  const getChatUnreadCount = (chat: AdminChatConversation) => {
    if (!user) return 0;
    return messages.filter((m) => {
      const isChatMatch =
        m.chatId === chat.id ||
        m.topicId === chat.id ||
        (!m.chatId && chat.id === 'group_all_admins_hq' && (!m.topicId || m.topicId === 'general-hq'));
      const isFromOther = m.senderId !== user.uid;
      const isUnread = !m.readBy || !m.readBy.includes(user.uid);
      return isChatMatch && isFromOther && isUnread;
    }).length;
  };

  // Get other participant in 1:1 direct chat
  const getDirectChatTarget = (chat: AdminChatConversation): AdminChatParticipant | null => {
    if (chat.type !== 'DIRECT' || !user) return null;
    const otherId = chat.participantIds.find((id) => id !== user.uid) || chat.participantIds[0];
    if (chat.participantDetails && chat.participantDetails[otherId]) {
      return chat.participantDetails[otherId];
    }
    const foundInDir = adminDirectory.find((a) => a.id === otherId);
    if (foundInDir) return foundInDir;

    return {
      id: otherId,
      displayName: chat.name || 'Admin',
      role: 'ADMIN',
    };
  };

  // Filtered conversations list according to tabs and search
  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => {
      // Tab filter
      if (chatFilter === 'direct' && c.type !== 'DIRECT') return false;
      if (chatFilter === 'groups' && c.type !== 'GROUP') return false;
      if (chatFilter === 'unread' && getChatUnreadCount(c) === 0) return false;

      // Text search
      if (chatSearch.trim()) {
        const queryStr = chatSearch.toLowerCase();
        let targetName = c.name;
        if (c.type === 'DIRECT') {
          const target = getDirectChatTarget(c);
          if (target) targetName = target.displayName;
        }
        const matchesName = targetName.toLowerCase().includes(queryStr);
        const matchesDesc = c.description?.toLowerCase().includes(queryStr);
        const matchesLast = c.lastMessage?.text?.toLowerCase().includes(queryStr);
        if (!matchesName && !matchesDesc && !matchesLast) return false;
      }

      return true;
    });
  }, [conversations, chatFilter, chatSearch, user, messages, adminDirectory]);

  // Image Attachment Handler
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please select an image file (PNG, JPG, WebP).');
      return;
    }

    try {
      setUploadingImage(true);
      const url = await uploadImage(file);
      setAttachedImage(url);
    } catch (err) {
      console.error('Failed to attach image:', err);
      alert('Could not process image upload.');
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Send a Message
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!user || !isAdmin || (!inputText.trim() && !attachedImage) || sendingMessage) return;

    const textToSend = inputText.trim();
    const imageToSend = attachedImage;
    const replyContext = replyingTo;

    setInputText('');
    setAttachedImage(null);
    setReplyingTo(null);
    setIsEmojiPickerOpen(false);
    setSendingMessage(true);

    try {
      const now = new Date().toISOString();
      const senderDisplayName = profile?.displayName || user.displayName || (isSuperAdmin ? 'Super Admin' : 'Admin');
      const senderRole = isSuperAdmin ? 'SUPER_ADMIN' : 'ADMIN';

      const newMsg: Record<string, unknown> = {
        chatId: activeChat.id,
        topicId: activeChat.id,
        topicName: activeChat.name,
        senderId: user.uid,
        senderName: senderDisplayName,
        senderPhotoURL: profile?.photoURL || user.photoURL || '',
        senderRole,
        senderTitle: profile?.customTitle || (isSuperAdmin ? 'Executive Director' : 'Crew Moderator'),
        text: textToSend || (imageToSend ? 'Shared an image' : ''),
        reactions: [],
        readBy: [user.uid],
        isPinned: false,
        createdAt: now,
        updatedAt: now,
      };

      if (imageToSend) {
        newMsg.imageUrl = imageToSend;
      }

      if (replyContext) {
        newMsg.replyTo = {
          messageId: replyContext.id,
          senderName: replyContext.senderName,
          text: replyContext.text.substring(0, 100),
        };
      }

      await addDoc(collection(db, 'adminChatMessages'), newMsg);

      // Update conversation's last message in adminChats
      try {
        await setDoc(
          doc(db, 'adminChats', activeChat.id),
          {
            lastMessage: {
              text: textToSend || (imageToSend ? '📷 Photo' : ''),
              senderId: user.uid,
              senderName: senderDisplayName,
              createdAt: now,
            },
            lastMessageAt: now,
            updatedAt: now,
          },
          { merge: true }
        );
      } catch (convErr) {
        console.debug('Conversation update fallback:', convErr);
      }

      // Add notification for recipient admins in global notifications
      try {
        const notifRecipient =
          activeChat.type === 'DIRECT'
            ? activeChat.participantIds.find((id) => id !== user.uid) || 'ALL_ADMINS'
            : 'ALL_ADMINS';

        const notifTitle =
          activeChat.type === 'DIRECT'
            ? `💬 New Direct Message from ${senderDisplayName}`
            : `💬 ${senderDisplayName} in #${activeChat.name}`;

        await addDoc(collection(db, 'notifications'), {
          recipientId: notifRecipient,
          senderId: user.uid,
          senderName: senderDisplayName,
          senderRole,
          type: 'SYSTEM',
          title: notifTitle,
          message: textToSend.substring(0, 100) || 'Sent a photo',
          link: 'adminchat',
          isRead: false,
          createdAt: now,
        });
      } catch (nErr) {
        console.debug('Notification dispatch bypass:', nErr);
      }

      // Auto-scroll to bottom
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 60);
    } catch (err) {
      console.error('Failed to send message:', err);
      alert('Failed to send message. Please try again.');
      setInputText(textToSend);
      setAttachedImage(imageToSend);
      setReplyingTo(replyContext);
    } finally {
      setSendingMessage(false);
    }
  };

  // Toggle emoji reaction
  const handleToggleReaction = async (message: AdminChatMessage, emoji: string) => {
    if (!user || !isAdmin) return;

    const existingReactions = Array.isArray(message.reactions) ? [...message.reactions] : [];
    const targetIdx = existingReactions.findIndex((r) => r.emoji === emoji);

    if (targetIdx >= 0) {
      const current = existingReactions[targetIdx];
      const hasReacted = current.userIds.includes(user.uid);

      if (hasReacted) {
        const updatedUsers = current.userIds.filter((uid) => uid !== user.uid);
        if (updatedUsers.length === 0) {
          existingReactions.splice(targetIdx, 1);
        } else {
          existingReactions[targetIdx] = {
            ...current,
            count: updatedUsers.length,
            userIds: updatedUsers,
          };
        }
      } else {
        const updatedUsers = [...current.userIds, user.uid];
        existingReactions[targetIdx] = {
          ...current,
          count: updatedUsers.length,
          userIds: updatedUsers,
        };
      }
    } else {
      existingReactions.push({
        emoji,
        count: 1,
        userIds: [user.uid],
      });
    }

    try {
      await updateDoc(doc(db, 'adminChatMessages', message.id), {
        reactions: existingReactions,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Error toggling reaction:', err);
    }
  };

  // Toggle Pinned status on message
  const handleTogglePin = async (message: AdminChatMessage) => {
    if (!isAdmin) return;
    try {
      await updateDoc(doc(db, 'adminChatMessages', message.id), {
        isPinned: !message.isPinned,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Error toggling pin:', err);
    }
  };

  // Delete message
  const handleDeleteMessage = async (message: AdminChatMessage) => {
    if (!isAdmin || !user) return;
    if (message.senderId !== user.uid && !isSuperAdmin) {
      alert('Only the message author or Super Admin can delete this message.');
      return;
    }

    if (!window.confirm('Delete this message permanently from the chat?')) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'adminChatMessages', message.id));
    } catch (err) {
      console.error('Error deleting message:', err);
      alert('Failed to delete message.');
    }
  };

  // Start or open 1-to-1 direct chat
  const handleStartDirectChat = async (targetAdmin: AdminChatParticipant) => {
    if (!user || !isAdmin) return;

    if (targetAdmin.id === user.uid) {
      alert('You cannot start a direct chat with yourself.');
      return;
    }

    const chatId = getDirectChatId(user.uid, targetAdmin.id);

    // Check if conversation already exists in state
    const existing = conversations.find((c) => c.id === chatId);
    if (existing) {
      setActiveChatId(chatId);
      setIsNewDirectModalOpen(false);
      setMobileShowConversation(true);
      return;
    }

    // Create new direct conversation document in Firestore
    try {
      const now = new Date().toISOString();
      const userParticipant: AdminChatParticipant = {
        id: user.uid,
        displayName: profile?.displayName || user.displayName || (isSuperAdmin ? 'Super Admin' : 'Admin'),
        email: user.email || '',
        role: isSuperAdmin ? 'SUPER_ADMIN' : 'ADMIN',
        photoURL: profile?.photoURL || user.photoURL || '',
        customTitle: profile?.customTitle,
      };

      const newConv: AdminChatConversation = {
        id: chatId,
        type: 'DIRECT',
        name: targetAdmin.displayName,
        participantIds: [user.uid, targetAdmin.id],
        participantDetails: {
          [user.uid]: userParticipant,
          [targetAdmin.id]: targetAdmin,
        },
        createdBy: user.uid,
        createdByName: userParticipant.displayName,
        createdAt: now,
        updatedAt: now,
      };

      await setDoc(doc(db, 'adminChats', chatId), newConv);
      setActiveChatId(chatId);
      setIsNewDirectModalOpen(false);
      setMobileShowConversation(true);
    } catch (err) {
      console.error('Error creating direct chat:', err);
      alert('Failed to initialize direct chat.');
    }
  };

  // Create a new Group Chat
  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !isAdmin || !newGroupName.trim() || creatingGroup) return;

    try {
      setCreatingGroup(true);
      const now = new Date().toISOString();
      const groupId = `group_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const myDisplayName = profile?.displayName || user.displayName || (isSuperAdmin ? 'Super Admin' : 'Admin');

      // Participant IDs: current user + selected admins
      const participantIds = Array.from(new Set([user.uid, ...selectedGroupParticipants]));

      // Participant Details map
      const participantDetails: Record<string, AdminChatParticipant> = {
        [user.uid]: {
          id: user.uid,
          displayName: myDisplayName,
          email: user.email || '',
          role: isSuperAdmin ? 'SUPER_ADMIN' : 'ADMIN',
          photoURL: profile?.photoURL || user.photoURL || '',
          customTitle: profile?.customTitle,
        },
      };

      selectedGroupParticipants.forEach((pId) => {
        const found = adminDirectory.find((a) => a.id === pId);
        if (found) participantDetails[pId] = found;
      });

      const newGroupDoc: AdminChatConversation = {
        id: groupId,
        type: 'GROUP',
        name: newGroupName.trim(),
        description: newGroupDesc.trim() || `Admin operations group created by ${myDisplayName}`,
        icon: newGroupIcon || 'fa-users',
        participantIds,
        participantDetails,
        createdBy: user.uid,
        createdByName: myDisplayName,
        createdAt: now,
        updatedAt: now,
        lastMessage: {
          text: `Group "${newGroupName.trim()}" created`,
          senderId: 'system',
          senderName: 'System',
          createdAt: now,
        },
        lastMessageAt: now,
      };

      await setDoc(doc(db, 'adminChats', groupId), newGroupDoc);

      // Post initial system announcement message
      await addDoc(collection(db, 'adminChatMessages'), {
        chatId: groupId,
        topicId: groupId,
        topicName: newGroupName.trim(),
        senderId: user.uid,
        senderName: myDisplayName,
        senderRole: isSuperAdmin ? 'SUPER_ADMIN' : 'ADMIN',
        senderPhotoURL: profile?.photoURL || user.photoURL || '',
        text: `🏁 Group "${newGroupName.trim()}" created. Welcome crew leaders!`,
        reactions: [],
        readBy: [user.uid],
        isPinned: true,
        createdAt: now,
        updatedAt: now,
      });

      setActiveChatId(groupId);
      setNewGroupName('');
      setNewGroupDesc('');
      setSelectedGroupParticipants([]);
      setIsNewGroupModalOpen(false);
      setMobileShowConversation(true);
    } catch (err) {
      console.error('Error creating group chat:', err);
      alert('Failed to create group. Please check your admin privileges.');
    } finally {
      setCreatingGroup(false);
    }
  };

  // If not admin, render access denial
  if (!isAdmin) {
    return (
      <div className="max-w-xl mx-auto my-12 p-8 border-3 border-zinc-900 bg-white rounded-3xl shadow-[0_8px_0_#1e1e1e] text-center">
        <div className="w-16 h-16 rounded-full bg-red-100 border-2 border-zinc-900 mx-auto flex items-center justify-center text-red-600 text-2xl mb-4 shadow-[0_4px_0_#1e1e1e]">
          <i className="fas fa-lock"></i>
        </div>
        <h2 className="text-2xl font-black text-zinc-900 mb-2">Restricted Admin Communications</h2>
        <p className="text-sm text-zinc-600 mb-6 font-medium">
          The Cycle.exe WhatsApp Admin HQ is end-to-end encrypted and reserved exclusively for verified Admins and the Super Admin.
        </p>
        <div className="p-4 bg-zinc-50 border-2 border-zinc-200 rounded-2xl text-xs text-zinc-600 font-medium">
          <i className="fas fa-info-circle text-amber-600 mr-2"></i>
          Are you a ride leader? Apply for an Admin Membership or contact the Super Admin to receive clearance.
        </div>
      </div>
    );
  }

  // Format timestamp helper (WhatsApp style)
  const formatWhatsAppTime = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      if (isToday) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      const yesterday = new Date();
      yesterday.setDate(now.getDate() - 1);
      if (d.toDateString() === yesterday.toDateString()) {
        return 'Yesterday';
      }
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-3">
      {/* WhatsApp Workspace Container */}
      <div className="border-3 border-zinc-900 bg-white rounded-3xl shadow-[0_8px_0_#1e1e1e] overflow-hidden flex flex-col md:flex-row h-[780px]">
        {/* ======================================================== */}
        {/* LEFT PANE: WhatsApp Chat List & Sidebar                  */}
        {/* ======================================================== */}
        <div
          className={`w-full md:w-[380px] lg:w-[420px] border-r-3 border-zinc-900 flex flex-col bg-[#f0f2f5] shrink-0 ${
            mobileShowConversation ? 'hidden md:flex' : 'flex'
          }`}
        >
          {/* WhatsApp Left Header Bar */}
          <div className="p-3.5 bg-[#005c4b] text-white flex items-center justify-between border-b-2 border-zinc-900">
            {/* User Profile */}
            <div className="flex items-center gap-2.5 truncate">
              <div className="relative w-9 h-9 rounded-full bg-white text-zinc-900 border border-zinc-900 overflow-hidden flex items-center justify-center font-bold text-sm shrink-0">
                {profile?.photoURL ? (
                  <img src={profile.photoURL} alt={profile.displayName} className="w-full h-full object-cover" />
                ) : (
                  profile?.displayName?.charAt(0).toUpperCase() || 'A'
                )}
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 border border-white"></span>
              </div>
              <div className="truncate">
                <div className="font-bold text-xs tracking-tight flex items-center gap-1 truncate">
                  <span>{profile?.displayName || 'Admin'}</span>
                  {isSuperAdmin ? (
                    <span className="bg-[#f9c74f] text-zinc-900 text-[9px] font-black px-1.5 py-0.2 rounded-full">
                      👑 OWNER
                    </span>
                  ) : (
                    <span className="bg-emerald-700 text-white text-[9px] font-black px-1.5 py-0.2 rounded-full">
                      🛡️ ADMIN
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-emerald-100 flex items-center gap-1 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  WhatsApp Admin Comms
                </div>
              </div>
            </div>

            {/* Quick Action Buttons */}
            <div className="flex items-center gap-1.5">
              {/* New 1:1 Direct Chat */}
              <button
                type="button"
                onClick={() => setIsNewDirectModalOpen(true)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 transition flex items-center justify-center text-white text-xs border border-white/20"
                title="Start 1:1 Direct Chat with an Admin"
              >
                <i className="fas fa-comment-medical"></i>
              </button>

              {/* New Group Chat */}
              <button
                type="button"
                onClick={() => setIsNewGroupModalOpen(true)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 transition flex items-center justify-center text-white text-xs border border-white/20"
                title="Create New Admin Group"
              >
                <i className="fas fa-users-cog"></i>
              </button>

              {/* Sound toggle */}
              <button
                type="button"
                onClick={handleToggleSound}
                className={`w-8 h-8 rounded-full transition flex items-center justify-center text-xs border border-white/20 ${
                  soundEnabled ? 'bg-amber-400 text-zinc-900 font-bold' : 'bg-white/10 text-white/70'
                }`}
                title={soundEnabled ? 'Chime sound is enabled' : 'Chime sound muted'}
              >
                <i className={`fas ${soundEnabled ? 'fa-bell' : 'fa-bell-slash'}`}></i>
              </button>
            </div>
          </div>

          {/* Search Bar */}
          <div className="p-2.5 bg-white border-b border-zinc-200">
            <div className="relative flex items-center">
              <i className="fas fa-search absolute left-3 text-zinc-400 text-xs"></i>
              <input
                type="text"
                placeholder="Search or start a new chat..."
                value={chatSearch}
                onChange={(e) => setChatSearch(e.target.value)}
                className="w-full bg-[#f0f2f5] text-xs font-medium pl-9 pr-7 py-2 rounded-xl border border-zinc-200 focus:outline-none focus:border-zinc-900 focus:bg-white transition"
              />
              {chatSearch && (
                <button
                  type="button"
                  onClick={() => setChatSearch('')}
                  className="absolute right-2.5 text-zinc-400 hover:text-zinc-700 text-xs"
                >
                  <i className="fas fa-times-circle"></i>
                </button>
              )}
            </div>
          </div>

          {/* WhatsApp Filters: All, Direct, Groups, Unread */}
          <div className="px-3 py-2 bg-white border-b border-zinc-200 flex items-center gap-1.5 overflow-x-auto">
            <button
              type="button"
              onClick={() => setChatFilter('all')}
              className={`px-3 py-1 rounded-full text-[11px] font-bold transition whitespace-nowrap ${
                chatFilter === 'all'
                  ? 'bg-[#00a884] text-white shadow-sm'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setChatFilter('direct')}
              className={`px-3 py-1 rounded-full text-[11px] font-bold transition whitespace-nowrap flex items-center gap-1 ${
                chatFilter === 'direct'
                  ? 'bg-[#00a884] text-white shadow-sm'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              <i className="fas fa-user text-[10px]"></i> 1:1 Direct
            </button>
            <button
              type="button"
              onClick={() => setChatFilter('groups')}
              className={`px-3 py-1 rounded-full text-[11px] font-bold transition whitespace-nowrap flex items-center gap-1 ${
                chatFilter === 'groups'
                  ? 'bg-[#00a884] text-white shadow-sm'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              <i className="fas fa-users text-[10px]"></i> Groups
            </button>
            <button
              type="button"
              onClick={() => setChatFilter('unread')}
              className={`px-3 py-1 rounded-full text-[11px] font-bold transition whitespace-nowrap ${
                chatFilter === 'unread'
                  ? 'bg-[#00a884] text-white shadow-sm'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              Unread
            </button>
          </div>

          {/* Conversations List */}
          <div className="flex-1 overflow-y-auto divide-y divide-zinc-200 bg-white">
            {loadingChats ? (
              <div className="p-8 text-center text-xs text-zinc-400 font-bold">
                <i className="fas fa-spinner fa-spin mr-2"></i> Loading conversations...
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="p-8 text-center text-zinc-400 space-y-2">
                <i className="fas fa-comments text-3xl text-zinc-300"></i>
                <div className="text-xs font-bold text-zinc-600">No chats found</div>
                <div className="text-[11px] text-zinc-400">
                  {chatFilter !== 'all'
                    ? 'No conversations match the selected filter.'
                    : 'Start a direct chat or create an admin group to begin!'}
                </div>
                <div className="pt-2 flex justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsNewDirectModalOpen(true)}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg bg-zinc-900 text-white"
                  >
                    + Direct Chat
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsNewGroupModalOpen(true)}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg bg-[#00a884] text-white"
                  >
                    + New Group
                  </button>
                </div>
              </div>
            ) : (
              filteredConversations.map((chat) => {
                const isActive = chat.id === activeChat.id;
                const unreadCount = getChatUnreadCount(chat);
                const isDirect = chat.type === 'DIRECT';
                const directTarget = isDirect ? getDirectChatTarget(chat) : null;
                const displayName = isDirect ? directTarget?.displayName || chat.name : chat.name;
                const photo = isDirect ? directTarget?.photoURL : chat.photoURL;

                return (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => {
                      setActiveChatId(chat.id);
                      setMobileShowConversation(true);
                      setMessageSearchQuery('');
                      setShowPinnedOnly(false);
                    }}
                    className={`w-full p-3 text-left flex items-center gap-3 transition border-l-4 ${
                      isActive
                        ? 'bg-[#e9edef] border-[#00a884]'
                        : 'hover:bg-zinc-50 border-transparent'
                    }`}
                  >
                    {/* Chat Avatar */}
                    <div className="relative shrink-0">
                      {isDirect ? (
                        <div className="w-12 h-12 rounded-full bg-zinc-200 border-2 border-zinc-900 overflow-hidden flex items-center justify-center font-black text-sm text-zinc-700">
                          {photo ? (
                            <img src={photo} alt={displayName} className="w-full h-full object-cover" />
                          ) : (
                            displayName.charAt(0).toUpperCase()
                          )}
                        </div>
                      ) : (
                        <div className="w-12 h-12 rounded-2xl bg-[#00a884] text-white border-2 border-zinc-900 flex items-center justify-center text-lg shadow-sm">
                          <i className={`fas ${chat.icon || 'fa-users'}`}></i>
                        </div>
                      )}
                      {/* Direct chat online badge or group tag */}
                      {isDirect && (
                        <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white"></span>
                      )}
                    </div>

                    {/* Chat Metadata & Last Message Preview */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span className="font-bold text-xs text-zinc-900 truncate flex items-center gap-1.5">
                          <span className="truncate">{displayName}</span>
                          {isDirect && directTarget?.role === 'SUPER_ADMIN' && (
                            <span className="text-[9px] bg-amber-100 text-amber-800 px-1 rounded font-black border border-amber-300">
                              👑 OWNER
                            </span>
                          )}
                          {!isDirect && (
                            <span className="text-[9px] bg-zinc-100 text-zinc-600 px-1 rounded font-bold border border-zinc-200">
                              GROUP
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] text-zinc-400 font-medium shrink-0">
                          {formatWhatsAppTime(chat.lastMessage?.createdAt || chat.lastMessageAt || chat.createdAt)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-zinc-500 truncate font-normal">
                          {chat.lastMessage ? (
                            <span>
                              {chat.lastMessage.senderId === user?.uid && (
                                <span className="text-emerald-600 font-bold mr-1">✓✓</span>
                              )}
                              {!isDirect && chat.lastMessage.senderId !== user?.uid && (
                                <span className="font-semibold text-zinc-700 mr-1">
                                  {chat.lastMessage.senderName}:
                                </span>
                              )}
                              {chat.lastMessage.text}
                            </span>
                          ) : (
                            <span className="italic text-zinc-400">No messages yet</span>
                          )}
                        </p>

                        <div className="flex items-center gap-1 shrink-0">
                          {chat.isPinned && (
                            <i className="fas fa-thumbtack text-[10px] text-amber-500"></i>
                          )}
                          {unreadCount > 0 && (
                            <span className="w-5 h-5 rounded-full bg-[#25d366] text-white text-[10px] font-black flex items-center justify-center">
                              {unreadCount}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ======================================================== */}
        {/* RIGHT PANE: WhatsApp Conversation Canvas                 */}
        {/* ======================================================== */}
        <div
          className={`flex-1 flex flex-col bg-[#efeae2] relative overflow-hidden ${
            !mobileShowConversation ? 'hidden md:flex' : 'flex'
          }`}
        >
          {/* Subtle WhatsApp chat pattern overlay */}
          <div
            className="absolute inset-0 opacity-[0.035] pointer-events-none"
            style={{
              backgroundImage: `radial-gradient(#1e1e1e 1px, transparent 1px)`,
              backgroundSize: '16px 16px',
            }}
          ></div>

          {/* Conversation Top Header */}
          <div className="p-3 bg-[#f0f2f5] border-b-2 border-zinc-900 flex items-center justify-between gap-3 shrink-0 relative z-10">
            <div className="flex items-center gap-2.5 truncate">
              {/* Mobile Back Button */}
              <button
                type="button"
                onClick={() => setMobileShowConversation(false)}
                className="md:hidden w-8 h-8 rounded-full bg-white border border-zinc-300 flex items-center justify-center text-zinc-700 text-xs"
              >
                <i className="fas fa-arrow-left"></i>
              </button>

              {/* Chat Avatar */}
              <div
                onClick={() => {
                  if (activeChat.type === 'GROUP') {
                    setIsGroupInfoModalOpen(true);
                  }
                }}
                className={`relative w-10 h-10 rounded-full border-2 border-zinc-900 flex items-center justify-center text-sm font-bold overflow-hidden cursor-pointer shrink-0 ${
                  activeChat.type === 'GROUP' ? 'bg-[#00a884] text-white' : 'bg-white text-zinc-800'
                }`}
                title={activeChat.type === 'GROUP' ? 'View Group Info' : 'Contact Details'}
              >
                {activeChat.type === 'DIRECT' ? (
                  getDirectChatTarget(activeChat)?.photoURL ? (
                    <img
                      src={getDirectChatTarget(activeChat)?.photoURL}
                      alt={activeChat.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    (getDirectChatTarget(activeChat)?.displayName || activeChat.name).charAt(0).toUpperCase()
                  )
                ) : (
                  <i className={`fas ${activeChat.icon || 'fa-users'}`}></i>
                )}
              </div>

              {/* Header Title & Subtitle */}
              <div
                className="truncate cursor-pointer"
                onClick={() => {
                  if (activeChat.type === 'GROUP') {
                    setIsGroupInfoModalOpen(true);
                  }
                }}
              >
                <div className="flex items-center gap-2 truncate">
                  <h2 className="text-sm font-black text-zinc-900 tracking-tight truncate">
                    {activeChat.type === 'DIRECT'
                      ? getDirectChatTarget(activeChat)?.displayName || activeChat.name
                      : activeChat.name}
                  </h2>
                  {activeChat.type === 'DIRECT' && getDirectChatTarget(activeChat)?.role === 'SUPER_ADMIN' && (
                    <span className="bg-[#f9c74f] text-zinc-900 text-[9px] font-black px-1.5 rounded-full border border-zinc-900">
                      👑 OWNER
                    </span>
                  )}
                  {activeChat.type === 'GROUP' && (
                    <span className="bg-emerald-100 text-emerald-800 text-[9px] font-black px-1.5 rounded-full border border-emerald-300">
                      GROUP
                    </span>
                  )}
                </div>

                <div className="text-[11px] text-zinc-500 truncate font-medium">
                  {activeChat.type === 'DIRECT' ? (
                    <span className="flex items-center gap-1.5 text-emerald-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      Verified Leadership Member • Direct Comms
                    </span>
                  ) : (
                    <span>
                      {activeChat.participantIds?.includes('all')
                        ? 'All verified Admins & Super Admin'
                        : `${activeChat.participantIds?.length || 2} members • Click for group info`}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Conversation Toolbar Icons */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Group Info Trigger */}
              {activeChat.type === 'GROUP' && (
                <button
                  type="button"
                  onClick={() => setIsGroupInfoModalOpen(true)}
                  className="px-2.5 py-1.5 rounded-xl border border-zinc-300 bg-white hover:bg-zinc-100 text-zinc-800 text-xs font-bold transition flex items-center gap-1"
                  title="View group members & details"
                >
                  <i className="fas fa-info-circle text-emerald-600"></i>
                  <span className="hidden sm:inline">Info</span>
                </button>
              )}

              {/* Pinned Messages Filter */}
              <button
                type="button"
                onClick={() => setShowPinnedOnly(!showPinnedOnly)}
                className={`px-2.5 py-1.5 rounded-xl border text-xs font-bold transition flex items-center gap-1 ${
                  showPinnedOnly
                    ? 'bg-[#1e1e1e] text-white border-zinc-900 shadow-sm'
                    : 'bg-white border-zinc-300 text-zinc-700 hover:bg-zinc-100'
                }`}
                title="Filter pinned messages in this chat"
              >
                <i className="fas fa-thumbtack text-amber-500"></i>
                <span className="hidden sm:inline">Pinned</span>
                {pinnedMessagesCount > 0 && (
                  <span className="text-[10px] font-black px-1 rounded-full bg-amber-100 text-amber-900 ml-0.5">
                    {pinnedMessagesCount}
                  </span>
                )}
              </button>

              {/* In-Chat Search Toggle */}
              <button
                type="button"
                onClick={() => setIsMessageSearchOpen(!isMessageSearchOpen)}
                className={`w-8 h-8 rounded-xl border flex items-center justify-center text-xs transition ${
                  isMessageSearchOpen
                    ? 'bg-amber-100 border-amber-400 text-amber-900'
                    : 'bg-white border-zinc-300 text-zinc-600 hover:bg-zinc-100'
                }`}
                title="Search messages in this conversation"
              >
                <i className="fas fa-search"></i>
              </button>

              {/* Desktop Alerts Prompt if not yet granted */}
              {!desktopNotifsEnabled && (
                <button
                  type="button"
                  onClick={handleEnableDesktopNotifications}
                  className="w-8 h-8 rounded-xl border border-zinc-300 bg-white hover:bg-zinc-100 text-zinc-700 flex items-center justify-center text-xs"
                  title="Enable desktop notifications"
                >
                  <i className="fas fa-bell"></i>
                </button>
              )}
            </div>
          </div>

          {/* Search Bar Dropdown inside conversation */}
          {isMessageSearchOpen && (
            <div className="p-2.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2 relative z-10">
              <i className="fas fa-search text-amber-700 text-xs"></i>
              <input
                type="text"
                placeholder="Search messages in this chat..."
                value={messageSearchQuery}
                onChange={(e) => setMessageSearchQuery(e.target.value)}
                className="flex-1 bg-white border border-amber-300 rounded-lg px-3 py-1 text-xs focus:outline-none focus:border-zinc-900 font-medium"
              />
              {messageSearchQuery && (
                <button
                  type="button"
                  onClick={() => setMessageSearchQuery('')}
                  className="text-xs text-amber-800 font-bold hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          {/* Pinned Messages Header Alert Banner */}
          {pinnedMessagesCount > 0 && !showPinnedOnly && (
            <div className="bg-[#fff9e6] border-b border-amber-200 px-4 py-1.5 flex items-center justify-between text-xs text-amber-900 shrink-0 relative z-10">
              <div className="flex items-center gap-2 truncate">
                <i className="fas fa-thumbtack text-amber-600"></i>
                <span className="font-bold">
                  {pinnedMessagesCount} Pinned {pinnedMessagesCount === 1 ? 'Message' : 'Messages'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowPinnedOnly(true)}
                className="text-[11px] font-bold text-amber-800 underline hover:text-amber-950"
              >
                View Pinned
              </button>
            </div>
          )}

          {/* ======================================================== */}
          {/* MESSAGES FEED (WhatsApp Bubbles)                        */}
          {/* ======================================================== */}
          <div
            ref={chatScrollContainerRef}
            className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3 relative z-10"
          >
            {loadingMessages ? (
              <div className="h-full flex items-center justify-center text-zinc-500 text-xs font-bold">
                <i className="fas fa-spinner fa-spin mr-2"></i> Connecting to WhatsApp real-time stream...
              </div>
            ) : currentChatMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-400">
                <div className="w-16 h-16 rounded-full bg-white/70 border-2 border-dashed border-zinc-300 flex items-center justify-center text-2xl text-zinc-400 mb-3 shadow-sm">
                  <i className={`fas ${activeChat.icon || 'fa-comments'}`}></i>
                </div>
                <h4 className="font-black text-sm text-zinc-700 mb-1">
                  {showPinnedOnly ? 'No pinned messages in this chat' : `Conversation started with ${activeChat.name}`}
                </h4>
                <p className="text-xs text-zinc-500 max-w-sm">
                  {showPinnedOnly
                    ? 'Pin any message to keep key directions permanently highlighted.'
                    : 'Send a message below. All messages are encrypted and delivered instantly to verified admins.'}
                </p>
              </div>
            ) : (
              currentChatMessages.map((msg, index) => {
                const isMe = msg.senderId === user?.uid;
                const prevMsg = currentChatMessages[index - 1];
                const showDateHeader =
                  !prevMsg ||
                  new Date(msg.createdAt).toDateString() !== new Date(prevMsg.createdAt).toDateString();

                return (
                  <React.Fragment key={msg.id}>
                    {/* Centered WhatsApp Date Badge */}
                    {showDateHeader && (
                      <div className="flex items-center justify-center my-3">
                        <span className="bg-white/90 text-zinc-600 text-[10px] font-bold uppercase tracking-wider px-3 py-0.5 rounded-full shadow-sm border border-zinc-200">
                          {new Date(msg.createdAt).toLocaleDateString(undefined, {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </div>
                    )}

                    {/* Message Bubble Container */}
                    <div className={`group relative flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                      {/* Avatar on incoming messages in group chats */}
                      {!isMe && activeChat.type === 'GROUP' && (
                        <div className="w-7 h-7 rounded-full bg-zinc-200 border border-zinc-900 overflow-hidden flex items-center justify-center font-bold text-[10px] mr-1.5 self-end mb-1 shrink-0">
                          {msg.senderPhotoURL ? (
                            <img src={msg.senderPhotoURL} alt={msg.senderName} className="w-full h-full object-cover" />
                          ) : (
                            msg.senderName.charAt(0).toUpperCase()
                          )}
                        </div>
                      )}

                      {/* WhatsApp Bubble */}
                      <div
                        className={`relative max-w-[85%] sm:max-w-[70%] md:max-w-[65%] rounded-2xl p-2.5 sm:p-3 shadow-sm border ${
                          isMe
                            ? 'bg-[#d9fdd3] text-zinc-900 border-[#c4e8be] rounded-tr-none'
                            : 'bg-white text-zinc-900 border-zinc-200 rounded-tl-none'
                        } ${msg.isPinned ? 'ring-2 ring-amber-400' : ''}`}
                      >
                        {/* Sender header on incoming group messages */}
                        {!isMe && (
                          <div className="flex items-center gap-1.5 mb-1 pb-0.5 border-b border-zinc-100">
                            <span
                              className={`text-[11px] font-black truncate ${
                                msg.senderRole === 'SUPER_ADMIN' ? 'text-amber-700' : 'text-[#00a884]'
                              }`}
                            >
                              {msg.senderName}
                            </span>
                            {msg.senderRole === 'SUPER_ADMIN' && (
                              <span className="text-[8px] font-black bg-amber-100 text-amber-800 px-1 rounded border border-amber-300">
                                👑 OWNER
                              </span>
                            )}
                            {msg.senderTitle && (
                              <span className="text-[9px] text-zinc-400 font-medium truncate">
                                • {msg.senderTitle}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Quoted / Reply Preview if present */}
                        {msg.replyTo && (
                          <div className="mb-2 p-1.5 rounded-lg bg-black/5 border-l-4 border-[#00a884] text-[11px]">
                            <div className="font-bold text-[#00a884] text-[10px]">
                              {msg.replyTo.senderName}
                            </div>
                            <div className="text-zinc-600 truncate">{msg.replyTo.text}</div>
                          </div>
                        )}

                        {/* Attached Image */}
                        {msg.imageUrl && (
                          <div className="mb-2 rounded-xl overflow-hidden border border-zinc-300 bg-zinc-100">
                            <img
                              src={msg.imageUrl}
                              alt="Attachment"
                              onClick={() => setLightboxImage(msg.imageUrl || null)}
                              className="max-h-64 w-full object-cover cursor-pointer hover:opacity-95 transition"
                            />
                          </div>
                        )}

                        {/* Message Text */}
                        <p className="text-xs sm:text-[13px] leading-relaxed break-words whitespace-pre-wrap font-normal selection:bg-[#f9c74f]">
                          {msg.text}
                        </p>

                        {/* Footer info: Pinned icon, Time, Checkmarks */}
                        <div className="flex items-center justify-end gap-1.5 mt-1 text-[10px] text-zinc-400">
                          {msg.isPinned && (
                            <span className="text-amber-600 text-[9px] font-bold flex items-center gap-0.5 mr-1">
                              <i className="fas fa-thumbtack text-[8px]"></i> Pinned
                            </span>
                          )}
                          <span>
                            {new Date(msg.createdAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          {isMe && (
                            <span className="text-[#53bdeb] font-bold text-[11px]" title="Delivered & Read">
                              ✓✓
                            </span>
                          )}
                        </div>

                        {/* Reactions tray */}
                        {Array.isArray(msg.reactions) && msg.reactions.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5 pt-1 border-t border-black/5">
                            {msg.reactions.map((react) => {
                              const hasReacted = user && react.userIds.includes(user.uid);
                              return (
                                <button
                                  key={react.emoji}
                                  type="button"
                                  onClick={() => handleToggleReaction(msg, react.emoji)}
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold border transition ${
                                    hasReacted
                                      ? 'bg-amber-100 border-amber-300 text-amber-900 shadow-sm'
                                      : 'bg-white border-zinc-200 text-zinc-700 hover:border-zinc-400'
                                  }`}
                                  title={`Reacted by ${react.count} admin(s)`}
                                >
                                  <span>{react.emoji}</span>
                                  <span className="text-[10px]">{react.count}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Floating Action Toolbar on hover (WhatsApp style) */}
                      <div
                        className={`absolute top-0 opacity-0 group-hover:opacity-100 transition-opacity bg-white border border-zinc-300 rounded-full shadow-md px-1.5 py-0.5 flex items-center gap-1 z-20 ${
                          isMe ? 'right-0 -translate-y-6' : 'left-8 -translate-y-6'
                        }`}
                      >
                        {/* Quick Reactions */}
                        {QUICK_EMOJIS.slice(0, 4).map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => handleToggleReaction(msg, emoji)}
                            className="text-xs hover:scale-125 transition-transform p-0.5"
                          >
                            {emoji}
                          </button>
                        ))}

                        <span className="w-px h-3 bg-zinc-200 mx-0.5"></span>

                        {/* Reply Button */}
                        <button
                          type="button"
                          onClick={() => {
                            setReplyingTo(msg);
                            textareaRef.current?.focus();
                          }}
                          className="text-zinc-600 hover:text-zinc-900 text-[11px] p-0.5"
                          title="Reply"
                        >
                          <i className="fas fa-reply"></i>
                        </button>

                        {/* Pin Button */}
                        <button
                          type="button"
                          onClick={() => handleTogglePin(msg)}
                          className={`text-[11px] p-0.5 ${
                            msg.isPinned ? 'text-amber-600' : 'text-zinc-600 hover:text-amber-600'
                          }`}
                          title={msg.isPinned ? 'Unpin message' : 'Pin message'}
                        >
                          <i className="fas fa-thumbtack"></i>
                        </button>

                        {/* Delete Button (if author or super admin) */}
                        {(msg.senderId === user?.uid || isSuperAdmin) && (
                          <button
                            type="button"
                            onClick={() => handleDeleteMessage(msg)}
                            className="text-red-500 hover:text-red-700 text-[11px] p-0.5"
                            title="Delete message"
                          >
                            <i className="fas fa-trash-alt"></i>
                          </button>
                        )}
                      </div>
                    </div>
                  </React.Fragment>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* ======================================================== */}
          {/* BOTTOM INPUT BAR (WhatsApp Style)                        */}
          {/* ======================================================== */}
          <div className="p-3 bg-[#f0f2f5] border-t-2 border-zinc-900 relative z-20">
            {/* Replying banner preview */}
            {replyingTo && (
              <div className="mb-2 p-2 bg-white rounded-xl border border-emerald-300 flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-2 truncate text-xs">
                  <div className="w-1 h-8 bg-[#00a884] rounded-full"></div>
                  <div className="truncate">
                    <span className="font-bold text-[#00a884] block truncate">
                      Replying to {replyingTo.senderName}
                    </span>
                    <span className="text-zinc-600 truncate block text-[11px]">
                      {replyingTo.text || 'Photo attachment'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyingTo(null)}
                  className="text-zinc-400 hover:text-zinc-700 px-2"
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>
            )}

            {/* Attached Image Preview */}
            {attachedImage && (
              <div className="mb-2 p-2 bg-white rounded-xl border border-zinc-300 flex items-center gap-3">
                <div className="w-14 h-14 rounded-lg overflow-hidden border border-zinc-200 shrink-0">
                  <img src={attachedImage} alt="Attachment Preview" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0 text-xs">
                  <div className="font-bold text-zinc-900">Photo attached</div>
                  <div className="text-[11px] text-zinc-500">Will be sent with your message</div>
                </div>
                <button
                  type="button"
                  onClick={() => setAttachedImage(null)}
                  className="w-7 h-7 rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-600 flex items-center justify-center text-xs"
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>
            )}

            {/* Emoji Quick Picker Popover */}
            {isEmojiPickerOpen && (
              <div className="mb-2 p-2.5 bg-white border border-zinc-300 rounded-2xl shadow-lg flex flex-wrap gap-2 animate-fadeIn">
                {QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      setInputText((prev) => prev + emoji);
                    }}
                    className="text-lg hover:scale-125 transition-transform p-1"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}

            {/* Main Input Row */}
            <form onSubmit={handleSendMessage} className="flex items-end gap-2">
              {/* Emoji Button */}
              <button
                type="button"
                onClick={() => setIsEmojiPickerOpen(!isEmojiPickerOpen)}
                className={`w-10 h-10 rounded-full border border-zinc-300 flex items-center justify-center text-base transition shrink-0 ${
                  isEmojiPickerOpen ? 'bg-amber-100 text-amber-900 border-amber-400' : 'bg-white text-zinc-600 hover:bg-zinc-100'
                }`}
                title="Toggle Emojis"
              >
                <i className="far fa-smile"></i>
              </button>

              {/* Attachment Button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingImage}
                className="w-10 h-10 rounded-full bg-white border border-zinc-300 hover:bg-zinc-100 flex items-center justify-center text-zinc-600 text-base transition shrink-0"
                title="Attach Photo or Document"
              >
                {uploadingImage ? (
                  <i className="fas fa-spinner fa-spin text-sm text-emerald-600"></i>
                ) : (
                  <i className="fas fa-paperclip"></i>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />

              {/* Text Input */}
              <div className="flex-1 bg-white rounded-2xl border border-zinc-300 focus-within:border-zinc-900 focus-within:ring-1 focus-within:ring-zinc-900 transition flex items-center px-3.5 py-1.5 shadow-sm">
                <textarea
                  ref={textareaRef}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="Type a message..."
                  rows={1}
                  className="w-full text-xs sm:text-sm font-medium focus:outline-none resize-none max-h-28 text-zinc-900 placeholder:text-zinc-400"
                />
              </div>

              {/* WhatsApp Round Send Button */}
              <button
                type="submit"
                disabled={sendingMessage || (!inputText.trim() && !attachedImage)}
                className="w-11 h-11 rounded-full bg-[#00a884] hover:bg-[#069173] active:scale-95 disabled:opacity-40 disabled:pointer-events-none text-white border-2 border-zinc-900 shadow-[0_3px_0_#1e1e1e] flex items-center justify-center text-sm transition shrink-0"
                title="Send Message"
              >
                {sendingMessage ? (
                  <i className="fas fa-spinner fa-spin"></i>
                ) : (
                  <i className="fas fa-paper-plane text-xs"></i>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* MODAL 1: NEW DIRECT 1:1 CHAT (Select Admin)              */}
      {/* ======================================================== */}
      {isNewDirectModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white border-3 border-zinc-900 rounded-3xl p-6 shadow-[0_10px_0_#1e1e1e] space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b-2 border-zinc-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#00a884] text-white flex items-center justify-center text-sm border-2 border-zinc-900">
                  <i className="fas fa-user-plus"></i>
                </div>
                <div>
                  <h3 className="text-base font-black text-zinc-900 tracking-tight">New 1:1 Direct Chat</h3>
                  <p className="text-xs text-zinc-500">Select an Admin or Super Admin to start messaging</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsNewDirectModalOpen(false)}
                className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-600 flex items-center justify-center text-xs"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>

            {/* Admin Directory List */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {loadingDirectory ? (
                <div className="p-6 text-center text-xs text-zinc-400 font-bold">
                  <i className="fas fa-spinner fa-spin mr-2"></i> Loading admin contacts...
                </div>
              ) : adminDirectory.filter((a) => a.id !== user?.uid).length === 0 ? (
                <div className="p-6 text-center text-zinc-400 text-xs">
                  No other admins registered yet. Generate an Admin Invitation Code in the Super Admin dashboard to onboard more leaders!
                </div>
              ) : (
                adminDirectory
                  .filter((a) => a.id !== user?.uid)
                  .map((adm) => (
                    <div
                      key={adm.id}
                      onClick={() => handleStartDirectChat(adm)}
                      className="p-3 rounded-2xl border-2 border-zinc-200 hover:border-zinc-900 hover:bg-emerald-50/50 transition cursor-pointer flex items-center justify-between gap-3 group"
                    >
                      <div className="flex items-center gap-3 truncate">
                        <div className="w-10 h-10 rounded-full bg-zinc-200 border-2 border-zinc-900 overflow-hidden flex items-center justify-center font-bold text-xs shrink-0">
                          {adm.photoURL ? (
                            <img src={adm.photoURL} alt={adm.displayName} className="w-full h-full object-cover" />
                          ) : (
                            adm.displayName.charAt(0).toUpperCase()
                          )}
                        </div>
                        <div className="truncate">
                          <div className="font-bold text-xs text-zinc-900 truncate group-hover:text-emerald-900">
                            {adm.displayName}
                          </div>
                          <div className="text-[10px] text-zinc-500 truncate">{adm.email || 'Admin Account'}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`text-[9px] font-black px-2 py-0.5 rounded-full border ${
                            adm.role === 'SUPER_ADMIN'
                              ? 'bg-amber-100 text-amber-900 border-amber-300'
                              : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                          }`}
                        >
                          {adm.role === 'SUPER_ADMIN' ? '👑 OWNER' : '🛡️ ADMIN'}
                        </span>
                        <i className="fas fa-comment text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity"></i>
                      </div>
                    </div>
                  ))
              )}
            </div>

            <div className="pt-2 border-t border-zinc-100 flex justify-end">
              <button
                type="button"
                onClick={() => setIsNewDirectModalOpen(false)}
                className="btn-secondary text-xs py-2 px-4"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 2: NEW GROUP CHAT (Create Group)                   */}
      {/* ======================================================== */}
      {isNewGroupModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white border-3 border-zinc-900 rounded-3xl p-6 shadow-[0_10px_0_#1e1e1e] space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b-2 border-zinc-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#00a884] text-white flex items-center justify-center text-sm border-2 border-zinc-900">
                  <i className="fas fa-users-cog"></i>
                </div>
                <div>
                  <h3 className="text-base font-black text-zinc-900 tracking-tight">Create Admin Group</h3>
                  <p className="text-xs text-zinc-500">Coordinate ride missions, moderation, and policies</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsNewGroupModalOpen(false)}
                className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-600 flex items-center justify-center text-xs"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>

            <form onSubmit={handleCreateGroup} className="space-y-4 flex-1 overflow-y-auto pr-1">
              {/* Group Name */}
              <div>
                <label className="block text-xs font-black text-zinc-700 uppercase mb-1">
                  Group Subject / Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Mission 004 Scouting Crew"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  className="w-full border-2 border-zinc-900 rounded-xl px-3.5 py-2 text-xs font-bold focus:outline-none focus:bg-amber-50/50"
                />
              </div>

              {/* Group Description */}
              <div>
                <label className="block text-xs font-black text-zinc-700 uppercase mb-1">
                  Description / Purpose
                </label>
                <input
                  type="text"
                  placeholder="e.g., Coordinating road scouts, route timings and ride safety"
                  value={newGroupDesc}
                  onChange={(e) => setNewGroupDesc(e.target.value)}
                  className="w-full border-2 border-zinc-900 rounded-xl px-3.5 py-2 text-xs font-medium focus:outline-none"
                />
              </div>

              {/* Group Icon Selector */}
              <div>
                <label className="block text-xs font-black text-zinc-700 uppercase mb-1.5">
                  Select Group Icon
                </label>
                <div className="flex flex-wrap gap-2">
                  {GROUP_ICON_PRESETS.map((item) => (
                    <button
                      key={item.icon}
                      type="button"
                      onClick={() => setNewGroupIcon(item.icon)}
                      className={`px-3 py-1.5 rounded-xl border-2 transition flex items-center gap-1.5 text-xs font-bold ${
                        newGroupIcon === item.icon
                          ? 'bg-[#00a884] text-white border-zinc-900 shadow-sm'
                          : 'bg-zinc-50 border-zinc-300 text-zinc-700 hover:bg-zinc-100'
                      }`}
                    >
                      <i className={`fas ${item.icon}`}></i>
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Select Participants */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-black text-zinc-700 uppercase">
                    Add Participants ({selectedGroupParticipants.length} selected)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const allIds = adminDirectory.filter((a) => a.id !== user?.uid).map((a) => a.id);
                      if (selectedGroupParticipants.length === allIds.length) {
                        setSelectedGroupParticipants([]);
                      } else {
                        setSelectedGroupParticipants(allIds);
                      }
                    }}
                    className="text-[11px] font-bold text-emerald-700 hover:underline"
                  >
                    {selectedGroupParticipants.length ===
                    adminDirectory.filter((a) => a.id !== user?.uid).length
                      ? 'Deselect All'
                      : 'Select All Admins'}
                  </button>
                </div>

                <div className="space-y-1.5 max-h-48 overflow-y-auto border-2 border-zinc-200 rounded-2xl p-2 bg-zinc-50">
                  {adminDirectory
                    .filter((a) => a.id !== user?.uid)
                    .map((adm) => {
                      const isChecked = selectedGroupParticipants.includes(adm.id);
                      return (
                        <label
                          key={adm.id}
                          className={`flex items-center justify-between p-2 rounded-xl border cursor-pointer transition ${
                            isChecked
                              ? 'bg-emerald-50 border-emerald-400 font-bold'
                              : 'bg-white border-zinc-200 hover:bg-zinc-100'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 truncate">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                if (isChecked) {
                                  setSelectedGroupParticipants((prev) => prev.filter((id) => id !== adm.id));
                                } else {
                                  setSelectedGroupParticipants((prev) => [...prev, adm.id]);
                                }
                              }}
                              className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                            />
                            <div className="truncate">
                              <span className="text-xs text-zinc-900 block truncate">{adm.displayName}</span>
                              <span className="text-[10px] text-zinc-400 block truncate">{adm.email}</span>
                            </div>
                          </div>
                          <span
                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                              adm.role === 'SUPER_ADMIN'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-zinc-100 text-zinc-700'
                            }`}
                          >
                            {adm.role === 'SUPER_ADMIN' ? '👑 OWNER' : '🛡️ ADMIN'}
                          </span>
                        </label>
                      );
                    })}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 border-t border-zinc-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsNewGroupModalOpen(false)}
                  className="btn-secondary text-xs py-2 px-4"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingGroup || !newGroupName.trim()}
                  className="btn-primary text-xs py-2 px-5 font-bold"
                >
                  {creatingGroup ? (
                    <i className="fas fa-spinner fa-spin mr-1"></i>
                  ) : (
                    <i className="fas fa-check mr-1"></i>
                  )}
                  Create WhatsApp Group
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 3: GROUP INFO & PARTICIPANT ROSTER                 */}
      {/* ======================================================== */}
      {isGroupInfoModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white border-3 border-zinc-900 rounded-3xl p-6 shadow-[0_10px_0_#1e1e1e] space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b-2 border-zinc-100">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-[#00a884] text-white flex items-center justify-center text-base border-2 border-zinc-900">
                  <i className={`fas ${activeChat.icon || 'fa-users'}`}></i>
                </div>
                <div>
                  <h3 className="text-base font-black text-zinc-900 tracking-tight">{activeChat.name}</h3>
                  <p className="text-xs text-zinc-500">Group Information & Participants</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsGroupInfoModalOpen(false)}
                className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-600 flex items-center justify-center text-xs"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>

            <div className="space-y-3 flex-1 overflow-y-auto pr-1">
              {/* Group Description */}
              <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-2xl text-xs text-zinc-700">
                <span className="font-bold text-zinc-900 block mb-0.5">Description</span>
                {activeChat.description || 'No description provided.'}
              </div>

              {/* Metadata */}
              <div className="text-[11px] text-zinc-500 flex items-center justify-between px-1">
                <span>Created {new Date(activeChat.createdAt).toLocaleDateString()}</span>
                <span>By {activeChat.createdByName || 'Admin'}</span>
              </div>

              {/* Participants Roster */}
              <div>
                <h4 className="text-xs font-black text-zinc-700 uppercase tracking-wider mb-2">
                  Group Participants (
                  {activeChat.participantIds?.includes('all')
                    ? adminDirectory.length
                    : activeChat.participantIds?.length || 2}
                  )
                </h4>

                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {adminDirectory
                    .filter((a) => {
                      if (activeChat.participantIds?.includes('all')) return true;
                      return activeChat.participantIds?.includes(a.id);
                    })
                    .map((member) => (
                      <div
                        key={member.id}
                        className="p-2.5 rounded-xl border border-zinc-200 bg-white flex items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2.5 truncate">
                          <div className="w-8 h-8 rounded-full bg-zinc-200 border border-zinc-900 overflow-hidden flex items-center justify-center font-bold text-xs shrink-0">
                            {member.photoURL ? (
                              <img src={member.photoURL} alt={member.displayName} className="w-full h-full object-cover" />
                            ) : (
                              member.displayName.charAt(0).toUpperCase()
                            )}
                          </div>
                          <div className="truncate">
                            <span className="text-xs font-bold text-zinc-900 block truncate">
                              {member.displayName} {member.id === user?.uid && '(You)'}
                            </span>
                            <span className="text-[10px] text-zinc-500 block truncate">{member.email}</span>
                          </div>
                        </div>

                        <span
                          className={`text-[9px] font-black px-2 py-0.5 rounded-full border ${
                            member.role === 'SUPER_ADMIN'
                              ? 'bg-amber-100 text-amber-900 border-amber-300'
                              : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                          }`}
                        >
                          {member.role === 'SUPER_ADMIN' ? '👑 OWNER' : '🛡️ ADMIN'}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-zinc-100 flex justify-end">
              <button
                type="button"
                onClick={() => setIsGroupInfoModalOpen(false)}
                className="btn-secondary text-xs py-2 px-4"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 4: IMAGE LIGHTBOX                                  */}
      {/* ======================================================== */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setLightboxImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh]">
            <img
              src={lightboxImage}
              alt="Enlarged"
              className="max-h-[85vh] w-auto max-w-full rounded-2xl border-2 border-white shadow-2xl object-contain"
            />
            <button
              type="button"
              onClick={() => setLightboxImage(null)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white text-zinc-900 font-bold flex items-center justify-center text-sm shadow-md"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
