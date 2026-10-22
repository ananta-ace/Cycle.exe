import React, { useState, useEffect, useRef } from 'react';
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
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { AdminChatMessage, AdminChatTopic } from '../types';
import { uploadImage } from '../utils/imageUpload';

// Default built-in channels
const DEFAULT_TOPICS: AdminChatTopic[] = [
  {
    id: 'general-hq',
    name: 'general-hq',
    description: 'Executive admin discussions, daily coordination & random chat',
    icon: 'fa-comments',
    createdBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'ride-missions',
    name: 'ride-missions',
    description: 'Mission planning, route scouting, ride leader assignments & weather',
    icon: 'fa-flag-checkered',
    createdBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'crew-moderation',
    name: 'crew-moderation',
    description: 'Membership applications, applicant reviews, and conduct incidents',
    icon: 'fa-shield-alt',
    createdBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'super-admin-desk',
    name: 'super-admin-desk',
    description: 'Official directives, system policy announcements & code generations',
    icon: 'fa-crown',
    createdBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

const AVAILABLE_REACTIONS = ['👍', '❤️', '🚲', '⚡', '🛡️', '🎯', '🔥'];

// Web Audio synthesizer for pleasant notification chime (No external assets required)
function playNotificationChime() {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc1.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12); // A5

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(880, ctx.currentTime + 0.12);
    osc2.frequency.exponentialRampToValueAtTime(1174.66, ctx.currentTime + 0.28); // D6

    gain.gain.setValueAtTime(0.01, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.2);
    osc2.start(ctx.currentTime + 0.12);
    osc2.stop(ctx.currentTime + 0.45);
  } catch (err) {
    // Audio autoplay restrictions gracefully handled
    console.debug('Chime audio playback suppressed:', err);
  }
}

export const AdminChatView: React.FC = () => {
  const { user, profile, isAdmin, isSuperAdmin } = useAuth();

  // Selected topic
  const [activeTopicId, setActiveTopicId] = useState<string>(() => {
    return localStorage.getItem('cycle_last_chat_topic') || 'general-hq';
  });

  // Topics list (default + custom from Firestore)
  const [topics, setTopics] = useState<AdminChatTopic[]>(DEFAULT_TOPICS);
  const [isNewTopicModalOpen, setIsNewTopicModalOpen] = useState(false);
  const [newTopicName, setNewTopicName] = useState('');
  const [newTopicDesc, setNewTopicDesc] = useState('');
  const [newTopicIcon, setNewTopicIcon] = useState('fa-hashtag');
  const [creatingTopic, setCreatingTopic] = useState(false);

  // Messages state
  const [messages, setMessages] = useState<AdminChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [inputText, setInputText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);

  // Attachment
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Lightbox for chat photos
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  // Message editing
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  // Audio & Notification preferences
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    return localStorage.getItem('cycle_chat_sound') !== 'false';
  });
  const [desktopNotifsEnabled, setDesktopNotifsEnabled] = useState<boolean>(() => {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted';
  });

  // Online active admins list
  const [activeAdmins, setActiveAdmins] = useState<{ id: string; name: string; role: string; isSuper: boolean }[]>([]);

  // Auto-scroll ref
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollContainerRef = useRef<HTMLDivElement>(null);
  const isInitialLoad = useRef(true);
  const lastMessageCount = useRef(0);

  // Persist selected topic
  useEffect(() => {
    localStorage.setItem('cycle_last_chat_topic', activeTopicId);
  }, [activeTopicId]);

  // Request notification permission if requested
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

  // 1. Listen for custom chat topics from Firestore
  useEffect(() => {
    if (!isAdmin) return;

    const topicsRef = collection(db, 'adminChatTopics');
    const unsub = onSnapshot(
      topicsRef,
      (snapshot) => {
        const custom: AdminChatTopic[] = [];
        snapshot.forEach((snapDoc) => {
          custom.push({ id: snapDoc.id, ...(snapDoc.data() as Omit<AdminChatTopic, 'id'>) });
        });

        // Merge default topics with custom topics (no duplicates)
        const merged = [...DEFAULT_TOPICS];
        custom.forEach((ct) => {
          if (!merged.some((m) => m.id === ct.id)) {
            merged.push(ct);
          }
        });
        setTopics(merged);
      },
      (err) => {
        console.warn('Error loading custom chat topics:', err);
      }
    );

    return () => unsub();
  }, [isAdmin]);

  // 2. Listen for real-time messages
  useEffect(() => {
    if (!isAdmin) return;

    setLoadingMessages(true);
    const messagesRef = collection(db, 'adminChatMessages');
    const q = query(messagesRef, orderBy('createdAt', 'asc'));

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list: AdminChatMessage[] = [];
        snapshot.forEach((snapDoc) => {
          list.push({ id: snapDoc.id, ...(snapDoc.data() as Omit<AdminChatMessage, 'id'>) });
        });

        // Check if a new message arrived from someone else
        if (!isInitialLoad.current && list.length > lastMessageCount.current) {
          const newest = list[list.length - 1];
          if (newest && newest.senderId !== user?.uid) {
            // Play chime if enabled
            if (soundEnabled) {
              playNotificationChime();
            }

            // Desktop notification if permitted
            if (desktopNotifsEnabled && document.hidden) {
              try {
                new Notification(`Cycle.exe Admin Chat [${newest.senderName}]`, {
                  body: `#${newest.topicName || newest.topicId}: ${newest.text.substring(0, 80)}`,
                  icon: '/images/favicon.png',
                });
              } catch (e) {
                console.debug('Desktop notification error:', e);
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
            const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 250;
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
  }, [isAdmin, user?.uid, soundEnabled, desktopNotifsEnabled]);

  // 3. Fetch active admin sessions for live presence
  useEffect(() => {
    if (!isAdmin) return;

    const fetchSessions = async () => {
      try {
        const res = await fetch('/api/admin/stats', {
          headers: {
            'x-user-id': user?.uid || '',
            'x-user-email': user?.email || '',
            'x-user-role': profile?.role || 'ADMIN',
          },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.activeSessions) {
            const adminSessions = data.activeSessions
              .filter((s: { role: string }) => s.role === 'ADMIN' || s.role === 'SUPER_ADMIN')
              .map((s: { userId: string; email: string; role: string }) => ({
                id: s.userId,
                name: s.email.split('@')[0],
                role: s.role,
                isSuper: s.role === 'SUPER_ADMIN',
              }));
            setActiveAdmins(adminSessions);
          }
        }
      } catch {
        // Fallback: active session list silently skipped if non-super-admin
      }
    };

    fetchSessions();
    const interval = setInterval(fetchSessions, 30000);
    return () => clearInterval(interval);
  }, [isAdmin, user, profile?.role]);

  // Handle image attachment
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
      console.error('Failed to upload image:', err);
      alert('Could not attach image. Please try again.');
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Create new discussion topic
  const handleCreateTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !isAdmin) return;

    const cleanName = newTopicName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!cleanName) {
      alert('Please enter a valid channel/topic name (letters, numbers, dashes).');
      return;
    }

    if (topics.some((t) => t.id === cleanName)) {
      alert('A topic with this name already exists.');
      return;
    }

    try {
      setCreatingTopic(true);
      const topicDoc = {
        name: cleanName,
        description: newTopicDesc.trim() || `Channel created by ${profile?.displayName || 'Admin'}`,
        icon: newTopicIcon || 'fa-hashtag',
        createdBy: user.uid,
        createdAt: new Date().toISOString(),
      };

      await setDoc(doc(db, 'adminChatTopics', cleanName), topicDoc);

      setActiveTopicId(cleanName);
      setNewTopicName('');
      setNewTopicDesc('');
      setIsNewTopicModalOpen(false);
    } catch (err) {
      console.error('Error creating topic:', err);
      alert('Failed to create topic. Please check your admin permissions.');
    } finally {
      setCreatingTopic(false);
    }
  };

  // Send a message
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!user || !isAdmin || (!inputText.trim() && !attachedImage) || sendingMessage) return;

    const textToSend = inputText.trim();
    const imageToSend = attachedImage;
    const currentTopic = topics.find((t) => t.id === activeTopicId) || topics[0];

    setInputText('');
    setAttachedImage(null);
    setSendingMessage(true);

    try {
      const now = new Date().toISOString();
      const newMsgData: Record<string, unknown> = {
        topicId: currentTopic.id,
        topicName: currentTopic.name,
        senderId: user.uid,
        senderName: profile?.displayName || user.displayName || 'Admin',
        senderPhotoURL: profile?.photoURL || user.photoURL || '',
        senderRole: isSuperAdmin ? 'SUPER_ADMIN' : 'ADMIN',
        senderTitle: profile?.customTitle || (isSuperAdmin ? 'Executive Director' : 'Crew Moderator'),
        text: textToSend || (imageToSend ? 'Shared an image' : ''),
        reactions: [],
        isPinned: false,
        createdAt: now,
        updatedAt: now,
      };

      if (imageToSend) {
        newMsgData.imageUrl = imageToSend;
      }

      await addDoc(collection(db, 'adminChatMessages'), newMsgData);

      // Create notification for all admins in the system
      try {
        const notifTitle = `💬 ${newMsgData.senderName} in #${currentTopic.name}`;
        const notifMsg = textToSend.length > 90 ? textToSend.substring(0, 90) + '...' : textToSend || 'Shared an image';

        await addDoc(collection(db, 'notifications'), {
          recipientId: 'ALL_ADMINS',
          senderId: user.uid,
          senderName: newMsgData.senderName,
          senderRole: newMsgData.senderRole,
          type: 'SYSTEM',
          title: notifTitle,
          message: notifMsg,
          link: 'adminchat',
          isRead: false,
          createdAt: now,
        });
      } catch (notifErr) {
        console.warn('Silent notice creation bypass:', notifErr);
      }

      // Scroll to bottom
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    } catch (err) {
      console.error('Failed to send message:', err);
      alert('Failed to send message. Please try again.');
      // Restore input text on error
      setInputText(textToSend);
      setAttachedImage(imageToSend);
    } finally {
      setSendingMessage(false);
    }
  };

  // Toggle Reaction on a message
  const handleToggleReaction = async (message: AdminChatMessage, emoji: string) => {
    if (!user || !isAdmin) return;

    const existingReactions = Array.isArray(message.reactions) ? [...message.reactions] : [];
    const targetIdx = existingReactions.findIndex((r) => r.emoji === emoji);

    if (targetIdx >= 0) {
      const current = existingReactions[targetIdx];
      const hasReacted = current.userIds.includes(user.uid);

      if (hasReacted) {
        // Remove reaction
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
        // Add reaction
        const updatedUsers = [...current.userIds, user.uid];
        existingReactions[targetIdx] = {
          ...current,
          count: updatedUsers.length,
          userIds: updatedUsers,
        };
      }
    } else {
      // New emoji reaction
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
      console.error('Error updating reaction:', err);
    }
  };

  // Pin / Unpin message
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

  // Delete message (sender or Super Admin)
  const handleDeleteMessage = async (message: AdminChatMessage) => {
    if (!isAdmin) return;
    if (message.senderId !== user?.uid && !isSuperAdmin) {
      alert('Only the message author or Super Admin can delete this message.');
      return;
    }

    if (!window.confirm('Delete this message permanently from the Admin Chat history?')) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'adminChatMessages', message.id));
    } catch (err) {
      console.error('Error deleting message:', err);
      alert('Failed to delete message.');
    }
  };

  // Save edited message
  const handleSaveEdit = async (messageId: string) => {
    if (!editText.trim()) return;
    try {
      await updateDoc(doc(db, 'adminChatMessages', messageId), {
        text: editText.trim(),
        updatedAt: new Date().toISOString(),
      });
      setEditingMessageId(null);
      setEditText('');
    } catch (err) {
      console.error('Error editing message:', err);
      alert('Failed to edit message.');
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
          The Admin HQ Chat is encrypted and reserved exclusively for verified Admins and the Super Admin of Cycle.exe.
        </p>
        <div className="p-4 bg-zinc-50 border-2 border-zinc-200 rounded-2xl text-xs text-zinc-600">
          <i className="fas fa-info-circle text-amber-600 mr-2"></i>
          Are you a core crew leader? Contact the Super Admin or submit an Admin Membership Application to request clearance.
        </div>
      </div>
    );
  }

  // Filter messages for active topic and search
  const currentTopic = topics.find((t) => t.id === activeTopicId) || topics[0];
  const topicMessages = messages.filter((m) => {
    const matchesTopic = m.topicId === activeTopicId;
    const matchesPinned = !showPinnedOnly || m.isPinned;
    const matchesSearch =
      !searchQuery.trim() ||
      m.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.senderName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesTopic && matchesPinned && matchesSearch;
  });

  const pinnedTopicMessages = messages.filter((m) => m.topicId === activeTopicId && m.isPinned);

  // Unread badge counters per topic (messages since last 24h)
  const getTopicCount = (tId: string) => {
    return messages.filter((m) => m.topicId === tId).length;
  };

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      {/* Top Banner / Breadcrumb */}
      <div className="border-3 border-zinc-900 bg-white rounded-3xl p-4 sm:p-5 shadow-[0_6px_0_#1e1e1e] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#f9c74f] border-2 border-zinc-900 flex items-center justify-center text-zinc-900 text-xl shadow-[0_3px_0_#1e1e1e]">
            <i className="fas fa-shield-alt"></i>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-zinc-900 tracking-tight">Admin Operations HQ</h1>
              <span className="bg-emerald-100 text-emerald-800 text-[10px] font-black px-2 py-0.5 rounded-full border border-emerald-300 uppercase tracking-wider flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                Encrypted Real-Time
              </span>
            </div>
            <p className="text-xs text-zinc-600 font-medium">
              Private comms channel for Admins & Super Admin • Cross-topic coordination & instant history
            </p>
          </div>
        </div>

        {/* Global Chat Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Sound Mute/Unmute */}
          <button
            type="button"
            onClick={handleToggleSound}
            className={`px-3 py-1.5 rounded-xl border-2 border-zinc-900 text-xs font-bold transition flex items-center gap-1.5 ${
              soundEnabled
                ? 'bg-amber-100 text-amber-900 shadow-[0_2px_0_#1e1e1e]'
                : 'bg-zinc-100 text-zinc-500 border-dashed'
            }`}
            title={soundEnabled ? 'Chime sound is enabled' : 'Chime sound is muted'}
          >
            <i className={`fas ${soundEnabled ? 'fa-volume-up text-amber-700' : 'fa-volume-mute'}`}></i>
            <span className="hidden sm:inline">{soundEnabled ? 'Chimes On' : 'Chimes Muted'}</span>
          </button>

          {/* Desktop Push Notifications */}
          {!desktopNotifsEnabled && (
            <button
              type="button"
              onClick={handleEnableDesktopNotifications}
              className="px-3 py-1.5 rounded-xl border-2 border-zinc-900 bg-white hover:bg-zinc-50 text-xs font-bold text-zinc-800 shadow-[0_2px_0_#1e1e1e] transition flex items-center gap-1.5"
              title="Enable browser push notifications"
            >
              <i className="fas fa-bell text-zinc-600"></i>
              <span className="hidden sm:inline">Desktop Alerts</span>
            </button>
          )}

          {/* Pinned Messages Filter */}
          <button
            type="button"
            onClick={() => setShowPinnedOnly(!showPinnedOnly)}
            className={`px-3 py-1.5 rounded-xl border-2 border-zinc-900 text-xs font-bold transition flex items-center gap-1.5 ${
              showPinnedOnly
                ? 'bg-[#1e1e1e] text-white shadow-[0_2px_0_#999]'
                : 'bg-white hover:bg-zinc-50 text-zinc-800 shadow-[0_2px_0_#1e1e1e]'
            }`}
          >
            <i className="fas fa-thumbtack text-amber-400"></i>
            <span>Pinned ({pinnedTopicMessages.length})</span>
          </button>

          {/* Search Toggle */}
          <button
            type="button"
            onClick={() => setIsSearchOpen(!isSearchOpen)}
            className={`px-3 py-1.5 rounded-xl border-2 border-zinc-900 text-xs font-bold transition flex items-center gap-1.5 ${
              isSearchOpen
                ? 'bg-amber-100 text-amber-900 shadow-[0_2px_0_#1e1e1e]'
                : 'bg-white hover:bg-zinc-50 text-zinc-800 shadow-[0_2px_0_#1e1e1e]'
            }`}
          >
            <i className="fas fa-search"></i>
            <span className="hidden sm:inline">Search</span>
          </button>
        </div>
      </div>

      {/* Main Chat Workspace Grid (Channels Sidebar + Messages Canvas) */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-start">
        {/* Left Sidebar: Channels & Online Presence */}
        <div className="lg:col-span-1 space-y-4">
          {/* Channels / Topics Box */}
          <div className="border-3 border-zinc-900 bg-white rounded-3xl p-4 shadow-[0_6px_0_#1e1e1e]">
            <div className="flex items-center justify-between pb-3 border-b-2 border-zinc-100 mb-3">
              <h3 className="text-xs font-black text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                <i className="fas fa-layer-group text-zinc-700"></i>
                Channels / Topics
              </h3>
              <button
                type="button"
                onClick={() => setIsNewTopicModalOpen(true)}
                className="text-[11px] font-bold bg-[#f9c74f] text-zinc-900 px-2 py-0.5 rounded-lg border border-zinc-900 hover:bg-amber-400 transition shadow-[0_1px_0_#1e1e1e]"
                title="Create a new discussion topic"
              >
                <i className="fas fa-plus mr-1"></i> New
              </button>
            </div>

            <div className="space-y-1.5">
              {topics.map((t) => {
                const isActive = t.id === activeTopicId;
                const count = getTopicCount(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setActiveTopicId(t.id);
                      setShowPinnedOnly(false);
                      setSearchQuery('');
                    }}
                    className={`w-full text-left p-2.5 rounded-2xl border-2 transition flex items-center justify-between gap-2 ${
                      isActive
                        ? 'border-zinc-900 bg-zinc-900 text-white shadow-[0_3px_0_#f9c74f]'
                        : 'border-transparent hover:border-zinc-300 hover:bg-zinc-50 text-zinc-800'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <div
                        className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs shrink-0 ${
                          isActive ? 'bg-[#f9c74f] text-zinc-900' : 'bg-zinc-100 text-zinc-700'
                        }`}
                      >
                        <i className={`fas ${t.icon || 'fa-hashtag'}`}></i>
                      </div>
                      <div className="truncate">
                        <div className="font-bold text-xs truncate">#{t.name}</div>
                        <div
                          className={`text-[10px] truncate max-w-[150px] ${
                            isActive ? 'text-zinc-300' : 'text-zinc-500'
                          }`}
                        >
                          {t.description}
                        </div>
                      </div>
                    </div>
                    {count > 0 && (
                      <span
                        className={`text-[10px] font-black px-1.5 py-0.5 rounded-full shrink-0 ${
                          isActive ? 'bg-zinc-700 text-amber-300' : 'bg-zinc-200 text-zinc-700'
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Online Leadership Crew Box */}
          <div className="border-3 border-zinc-900 bg-white rounded-3xl p-4 shadow-[0_6px_0_#1e1e1e]">
            <h3 className="text-xs font-black text-zinc-500 uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b-2 border-zinc-100 mb-3">
              <i className="fas fa-users-cog text-zinc-700"></i>
              Admins Clearance List
            </h3>
            <div className="space-y-2">
              {/* Current user */}
              <div className="flex items-center justify-between p-2 rounded-xl bg-amber-50/70 border border-amber-200">
                <div className="flex items-center gap-2 truncate">
                  <div className="relative w-7 h-7 rounded-full bg-zinc-200 border border-zinc-900 overflow-hidden flex items-center justify-center text-xs font-bold shrink-0">
                    {profile?.photoURL ? (
                      <img src={profile.photoURL} alt={profile.displayName} className="w-full h-full object-cover" />
                    ) : (
                      profile?.displayName?.charAt(0).toUpperCase() || 'A'
                    )}
                    <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-emerald-500 border border-white"></span>
                  </div>
                  <div className="truncate">
                    <span className="text-xs font-bold text-zinc-900 block truncate">
                      {profile?.displayName || 'You'} (You)
                    </span>
                    <span className="text-[10px] text-zinc-500">{isSuperAdmin ? 'Super Admin' : 'Admin'}</span>
                  </div>
                </div>
                <span className="role-badge SUPER_ADMIN scale-90">
                  {isSuperAdmin ? 'SUPER' : 'ADMIN'}
                </span>
              </div>

              {/* Other active admins */}
              {activeAdmins
                .filter((a) => a.id !== user?.uid)
                .map((a) => (
                  <div key={a.id} className="flex items-center justify-between p-2 rounded-xl border border-zinc-100">
                    <div className="flex items-center gap-2 truncate">
                      <div className="relative w-6 h-6 rounded-full bg-zinc-200 border border-zinc-800 flex items-center justify-center text-[10px] font-bold shrink-0">
                        {a.name.charAt(0).toUpperCase()}
                        <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-emerald-500 border border-white"></span>
                      </div>
                      <span className="text-xs font-medium text-zinc-800 truncate">{a.name}</span>
                    </div>
                    <span className="text-[10px] text-zinc-500 font-bold">{a.isSuper ? '👑 Owner' : '🛡️ Admin'}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Right Canvas: Chat Feed & Input Box */}
        <div className="lg:col-span-3 border-3 border-zinc-900 bg-white rounded-3xl shadow-[0_6px_0_#1e1e1e] flex flex-col h-[740px] overflow-hidden">
          {/* Active Channel Header */}
          <div className="p-4 border-b-3 border-zinc-900 bg-zinc-50 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2.5 truncate">
              <div className="w-8 h-8 rounded-xl bg-zinc-900 text-[#f9c74f] flex items-center justify-center text-sm shrink-0 border-2 border-zinc-900">
                <i className={`fas ${currentTopic.icon || 'fa-hashtag'}`}></i>
              </div>
              <div className="truncate">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-black text-zinc-900 tracking-tight truncate">
                    #{currentTopic.name}
                  </h2>
                  {showPinnedOnly && (
                    <span className="bg-amber-200 text-amber-900 text-[10px] font-black px-2 py-0.5 rounded-full border border-zinc-900">
                      FILTERED: PINNED ONLY
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-500 truncate">{currentTopic.description}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[11px] font-bold text-zinc-500 hidden sm:inline">
                {topicMessages.length} {topicMessages.length === 1 ? 'record' : 'records'}
              </span>
            </div>
          </div>

          {/* Search bar drop-down */}
          {isSearchOpen && (
            <div className="p-3 bg-amber-50/80 border-b-2 border-zinc-300 flex items-center gap-2 shrink-0">
              <i className="fas fa-search text-zinc-500 text-xs"></i>
              <input
                type="text"
                placeholder="Search messages or authors in this channel..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-white border border-zinc-300 rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:border-zinc-900"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-xs font-bold text-zinc-500 hover:text-zinc-800"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          {/* Pinned Messages Banner (if any pinned in current topic) */}
          {pinnedTopicMessages.length > 0 && !showPinnedOnly && (
            <div className="bg-amber-50 border-b-2 border-amber-200 p-2.5 px-4 flex items-center justify-between text-xs text-amber-900 shrink-0">
              <div className="flex items-center gap-2 truncate">
                <i className="fas fa-thumbtack text-amber-600"></i>
                <span className="font-bold">
                  {pinnedTopicMessages.length} Pinned {pinnedTopicMessages.length === 1 ? 'Message' : 'Messages'}
                </span>
                <span className="text-amber-700 truncate hidden md:inline">
                  — Latest: "{pinnedTopicMessages[pinnedTopicMessages.length - 1].text.substring(0, 70)}..."
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowPinnedOnly(true)}
                className="font-bold underline text-[11px] shrink-0 hover:text-amber-950"
              >
                View Pinned
              </button>
            </div>
          )}

          {/* Chat Messages Feed */}
          <div
            ref={chatScrollContainerRef}
            className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 bg-zinc-50/50"
          >
            {loadingMessages ? (
              <div className="h-full flex items-center justify-center text-zinc-400 text-xs font-bold">
                <i className="fas fa-spinner fa-spin text-base mr-2"></i> Connecting to encrypted admin stream...
              </div>
            ) : topicMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-400">
                <div className="w-14 h-14 rounded-full bg-zinc-100 border-2 border-dashed border-zinc-300 flex items-center justify-center text-2xl text-zinc-400 mb-3">
                  <i className={`fas ${currentTopic.icon || 'fa-comments'}`}></i>
                </div>
                <h4 className="font-black text-sm text-zinc-700 mb-1">
                  {showPinnedOnly ? 'No pinned messages in this channel' : `Welcome to #${currentTopic.name}`}
                </h4>
                <p className="text-xs text-zinc-500 max-w-sm">
                  {showPinnedOnly
                    ? 'Pin any message to keep crucial decisions visible to all admins.'
                    : 'Start the conversation! Only verified Admins and the Super Admin can read and send messages here.'}
                </p>
              </div>
            ) : (
              topicMessages.map((msg, index) => {
                const isMe = msg.senderId === user?.uid;
                const prevMsg = topicMessages[index - 1];
                const showDateHeader =
                  !prevMsg ||
                  new Date(msg.createdAt).toDateString() !== new Date(prevMsg.createdAt).toDateString();
                const isEditing = editingMessageId === msg.id;

                return (
                  <React.Fragment key={msg.id}>
                    {/* Date separator */}
                    {showDateHeader && (
                      <div className="flex items-center justify-center my-4">
                        <span className="bg-white border border-zinc-300 text-zinc-500 text-[10px] font-black uppercase tracking-wider px-3 py-0.5 rounded-full shadow-sm">
                          {new Date(msg.createdAt).toLocaleDateString(undefined, {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </div>
                    )}

                    {/* Message Row */}
                    <div
                      className={`group relative flex gap-3 p-3 rounded-2xl transition ${
                        msg.isPinned
                          ? 'bg-amber-50/80 border-2 border-amber-300'
                          : 'hover:bg-white hover:shadow-[0_2px_0_#e5e5e5]'
                      }`}
                    >
                      {/* Avatar */}
                      <div className="relative w-9 h-9 rounded-full bg-zinc-200 border-2 border-zinc-900 overflow-hidden flex items-center justify-center text-xs font-black shrink-0">
                        {msg.senderPhotoURL ? (
                          <img src={msg.senderPhotoURL} alt={msg.senderName} className="w-full h-full object-cover" />
                        ) : (
                          msg.senderName.charAt(0).toUpperCase()
                        )}
                      </div>

                      {/* Content Body */}
                      <div className="flex-1 min-w-0">
                        {/* Header: Name, Role, Timestamp */}
                        <div className="flex items-center flex-wrap gap-2 mb-1">
                          <span className="font-black text-xs text-zinc-900">{msg.senderName}</span>
                          <span
                            className={`role-badge scale-90 ${
                              msg.senderRole === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN'
                            }`}
                          >
                            {msg.senderRole === 'SUPER_ADMIN' ? '👑 Super Admin' : '🛡️ Admin'}
                          </span>
                          {msg.senderTitle && (
                            <span className="text-[10px] text-zinc-500 font-semibold bg-zinc-100 px-1.5 py-0.2 rounded border border-zinc-200">
                              {msg.senderTitle}
                            </span>
                          )}
                          <span className="text-[10px] text-zinc-400 font-medium ml-auto">
                            {new Date(msg.createdAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>

                        {/* Pinned pill */}
                        {msg.isPinned && (
                          <div className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md border border-amber-300 mb-1.5">
                            <i className="fas fa-thumbtack text-[9px]"></i> Pinned for all admins
                          </div>
                        )}

                        {/* Edit mode vs Normal text */}
                        {isEditing ? (
                          <div className="mt-1 space-y-2">
                            <textarea
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              className="w-full border-2 border-zinc-900 rounded-xl p-2 text-xs font-medium focus:outline-none"
                              rows={2}
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => handleSaveEdit(msg.id)}
                                className="btn-primary text-xs py-1 px-3"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingMessageId(null)}
                                className="btn-secondary text-xs py-1 px-3"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-zinc-800 leading-relaxed break-words whitespace-pre-wrap font-normal selection:bg-[#f9c74f]">
                            {msg.text}
                          </p>
                        )}

                        {/* Image attachment */}
                        {msg.imageUrl && (
                          <div className="mt-2.5">
                            <button
                              type="button"
                              onClick={() => setLightboxImage(msg.imageUrl || null)}
                              className="rounded-2xl border-2 border-zinc-900 overflow-hidden block max-w-sm hover:opacity-95 transition shadow-[0_3px_0_#1e1e1e]"
                            >
                              <img
                                src={msg.imageUrl}
                                alt="Attachment"
                                className="w-full max-h-60 object-cover"
                              />
                            </button>
                          </div>
                        )}

                        {/* Emoji Reactions Tray */}
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          {Array.isArray(msg.reactions) &&
                            msg.reactions.map((react) => {
                              const reactedByMe = user && react.userIds.includes(user.uid);
                              return (
                                <button
                                  key={react.emoji}
                                  type="button"
                                  onClick={() => handleToggleReaction(msg, react.emoji)}
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border transition ${
                                    reactedByMe
                                      ? 'bg-amber-100 border-amber-400 text-amber-900 shadow-sm'
                                      : 'bg-white border-zinc-200 text-zinc-700 hover:border-zinc-400'
                                  }`}
                                  title={`Reacted by ${react.count} admin(s)`}
                                >
                                  <span>{react.emoji}</span>
                                  <span className="text-[10px]">{react.count}</span>
                                </button>
                              );
                            })}

                          {/* Quick Add Reaction Popover triggers on hover */}
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 ml-1">
                            {AVAILABLE_REACTIONS.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                onClick={() => handleToggleReaction(msg, emoji)}
                                className="w-6 h-6 rounded-full hover:bg-zinc-200 flex items-center justify-center text-xs transition"
                                title={`React with ${emoji}`}
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Action Menu (Pin, Edit, Delete) */}
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-start gap-1">
                        {/* Pin Button */}
                        <button
                          type="button"
                          onClick={() => handleTogglePin(msg)}
                          className={`w-7 h-7 rounded-lg border border-zinc-200 flex items-center justify-center text-xs transition ${
                            msg.isPinned
                              ? 'bg-amber-400 text-zinc-900 border-zinc-900'
                              : 'bg-white hover:bg-zinc-100 text-zinc-600'
                          }`}
                          title={msg.isPinned ? 'Unpin message' : 'Pin message for all admins'}
                        >
                          <i className="fas fa-thumbtack"></i>
                        </button>

                        {/* Edit Button (author only) */}
                        {isMe && !isEditing && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMessageId(msg.id);
                              setEditText(msg.text);
                            }}
                            className="w-7 h-7 rounded-lg bg-white border border-zinc-200 hover:bg-zinc-100 text-zinc-600 flex items-center justify-center text-xs transition"
                            title="Edit message"
                          >
                            <i className="fas fa-pencil-alt"></i>
                          </button>
                        )}

                        {/* Delete Button (author or Super Admin) */}
                        {(isMe || isSuperAdmin) && (
                          <button
                            type="button"
                            onClick={() => handleDeleteMessage(msg)}
                            className="w-7 h-7 rounded-lg bg-white border border-zinc-200 hover:bg-red-50 text-zinc-400 hover:text-red-600 flex items-center justify-center text-xs transition"
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

          {/* Attached Image Preview before sending */}
          {attachedImage && (
            <div className="p-3 bg-amber-50 border-t-2 border-zinc-200 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <img
                  src={attachedImage}
                  alt="Attachment Preview"
                  className="w-12 h-12 object-cover rounded-xl border border-zinc-900 shadow-sm"
                />
                <div>
                  <span className="text-xs font-bold text-zinc-900 block">Image Attached</span>
                  <span className="text-[10px] text-zinc-500">Ready to post with message</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAttachedImage(null)}
                className="text-xs font-bold text-red-600 hover:text-red-800 p-1"
              >
                <i className="fas fa-times-circle mr-1"></i> Remove
              </button>
            </div>
          )}

          {/* Composer Input Form */}
          <form
            onSubmit={handleSendMessage}
            className="p-3 sm:p-4 border-t-3 border-zinc-900 bg-white flex items-end gap-2 shrink-0"
          >
            {/* Attachment Button */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/*"
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingImage}
              className="w-10 h-10 rounded-2xl border-2 border-zinc-900 bg-zinc-50 hover:bg-zinc-100 flex items-center justify-center text-zinc-700 transition shrink-0 shadow-[0_2px_0_#1e1e1e] disabled:opacity-50"
              title="Attach photo"
            >
              <i className={`fas ${uploadingImage ? 'fa-spinner fa-spin' : 'fa-paperclip'}`}></i>
            </button>

            {/* Message Textarea */}
            <div className="flex-1 relative">
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder={`Message #${currentTopic.name}... (Enter to send, Shift+Enter for new line)`}
                rows={1}
                maxLength={2000}
                className="w-full bg-zinc-50 border-2 border-zinc-900 rounded-2xl p-2.5 px-3.5 text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:bg-white resize-none max-h-32 transition shadow-inner font-medium"
              />
              {inputText.length > 1500 && (
                <span className="absolute right-3 bottom-2 text-[10px] text-zinc-400 font-mono">
                  {2000 - inputText.length}
                </span>
              )}
            </div>

            {/* Send Button */}
            <button
              type="submit"
              disabled={(!inputText.trim() && !attachedImage) || sendingMessage}
              className="btn-primary text-xs py-2.5 px-4 h-10 whitespace-nowrap flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {sendingMessage ? (
                <i className="fas fa-spinner fa-spin"></i>
              ) : (
                <>
                  <span>Send</span>
                  <i className="fas fa-paper-plane text-xs"></i>
                </>
              )}
            </button>
          </form>
        </div>
      </div>

      {/* New Topic Creation Modal */}
      {isNewTopicModalOpen && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsNewTopicModalOpen(false);
          }}
        >
          <div className="modal max-w-md w-full p-6 border-3 border-zinc-900 bg-white rounded-3xl shadow-[0_10px_0_#1e1e1e]">
            <div className="flex items-center justify-between pb-3 border-b-2 border-zinc-200 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-[#f9c74f] border-2 border-zinc-900 flex items-center justify-center text-xs font-black">
                  <i className="fas fa-layer-group"></i>
                </div>
                <h3 className="font-black text-lg text-zinc-900">Create Discussion Topic</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsNewTopicModalOpen(false)}
                className="text-zinc-500 hover:text-black p-1 text-base transition"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>

            <form onSubmit={handleCreateTopic} className="space-y-4">
              <div>
                <label className="block text-xs font-black text-zinc-700 uppercase mb-1">
                  Channel Name <span className="text-red-500">*</span>
                </label>
                <div className="flex items-center border-2 border-zinc-900 rounded-xl px-3 py-2 bg-zinc-50">
                  <span className="text-zinc-500 font-bold text-xs mr-1">#</span>
                  <input
                    type="text"
                    required
                    maxLength={40}
                    placeholder="e.g. night-ride-route"
                    value={newTopicName}
                    onChange={(e) => setNewTopicName(e.target.value)}
                    className="flex-1 bg-transparent text-xs font-bold text-zinc-900 focus:outline-none"
                  />
                </div>
                <span className="text-[10px] text-zinc-500 mt-1 block">
                  Letters, numbers, and hyphens only.
                </span>
              </div>

              <div>
                <label className="block text-xs font-black text-zinc-700 uppercase mb-1">
                  Topic Description
                </label>
                <textarea
                  rows={2}
                  maxLength={200}
                  placeholder="What is this channel for?"
                  value={newTopicDesc}
                  onChange={(e) => setNewTopicDesc(e.target.value)}
                  className="w-full border-2 border-zinc-900 rounded-xl p-2.5 text-xs text-zinc-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-zinc-700 uppercase mb-1">
                  Icon
                </label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    'fa-hashtag',
                    'fa-bicycle',
                    'fa-flag-checkered',
                    'fa-shield-alt',
                    'fa-bolt',
                    'fa-bullhorn',
                    'fa-map-marked-alt',
                    'fa-award',
                  ].map((ic) => (
                    <button
                      key={ic}
                      type="button"
                      onClick={() => setNewTopicIcon(ic)}
                      className={`w-9 h-9 rounded-xl border-2 flex items-center justify-center text-xs transition ${
                        newTopicIcon === ic
                          ? 'border-zinc-900 bg-[#f9c74f] text-zinc-900 shadow-[0_2px_0_#1e1e1e]'
                          : 'border-zinc-300 bg-white text-zinc-600 hover:border-zinc-600'
                      }`}
                    >
                      <i className={`fas ${ic}`}></i>
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="submit"
                  disabled={creatingTopic || !newTopicName.trim()}
                  className="btn-primary flex-1 text-xs py-2.5"
                >
                  {creatingTopic ? 'Creating...' : 'Create Channel'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsNewTopicModalOpen(false)}
                  className="btn-secondary text-xs py-2.5 px-4"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lightbox for full image zoom */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh]">
            <img
              src={lightboxImage}
              alt="Enlarged"
              className="max-h-[85vh] max-w-full rounded-2xl object-contain border-2 border-white"
            />
            <button
              type="button"
              onClick={() => setLightboxImage(null)}
              className="absolute -top-10 right-0 text-white text-xl hover:text-amber-400 p-2"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
