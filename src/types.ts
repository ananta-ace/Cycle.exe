export type UserRole = 'PUBLIC' | 'MEMBER' | 'ADMIN' | 'SUPER_ADMIN';

export type TabType =
  | 'home'
  | 'members'
  | 'community'
  | 'missions'
  | 'gallery'
  | 'profile'
  | 'notifications'
  | 'admin'
  | 'superadmin'
  | 'adminchat';

export interface UserProfile {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  photoURL: string;
  bio: string;
  role: UserRole;
  customTitle?: string;
  adminMembershipStatus?: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  isAdminMember?: boolean;
  isSuspended: boolean;
  isAccountSuspended?: boolean;
  welcomeSeenForRole?: string;
  ratingAverage?: number;
  ratingCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Member {
  id: string;
  name: string;
  title: string;
  img: string;
  initial: string;
  active: boolean;
  attend: string;
  perfect: boolean;
  bio?: string;
  ratingAverage?: number;
  ratingCount?: number;
  isCustomMember?: boolean;
  userId?: string;
  badges?: string[];
  completedRaces?: string[];
  completedRacesCount?: number;
  order?: number;
  createdAt?: string;
  updatedAt?: string;
  missions?: {
    m1: boolean;
    m2: boolean;
    m3: boolean;
  };
}

export interface AdminMembershipApplication {
  id: string;
  userId: string;
  applicantName: string;
  applicantEmail: string;
  applicantPhotoURL: string;
  reason: string;
  cyclingExperience: string;
  requestedTitle?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  adminRecommendations?: {
    adminId: string;
    adminName: string;
    recommendation: 'APPROVE' | 'REJECT';
    comment: string;
    createdAt: string;
  }[];
  rejectionReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemberRating {
  id: string;
  targetMemberId: string;
  raterId: string;
  raterName: string;
  rating: number; // 1 to 5
  comment?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GalleryPhoto {
  id: string;
  title: string;
  description?: string;
  photoURL: string;
  uploadedBy: string;
  uploadedByName?: string;
  uploadedAt: string;
}

export interface NoticeReply {
  id: string;
  senderId: string;
  senderName: string;
  senderEmail?: string;
  senderRole?: UserRole | string;
  senderPhotoURL?: string;
  text: string;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  recipientId: string; // user UID or 'SUPER_ADMIN' or 'ADMINS' or 'ALL_ADMINS'
  recipientName?: string;
  recipientEmail?: string;
  senderId?: string;
  senderName?: string;
  senderEmail?: string;
  senderRole?: string;
  senderPhotoURL?: string;
  type:
    | 'APPLICATION_SUBMITTED'
    | 'APPLICATION_APPROVED'
    | 'APPLICATION_REJECTED'
    | 'STATUS_CHANGED'
    | 'NEW_RATING'
    | 'SYSTEM'
    | 'DIRECT_NOTICE';
  title: string;
  message: string;
  link?: string;
  applicantId?: string;
  applicantName?: string;
  applicantPhotoURL?: string;
  isRead: boolean;
  readAt?: string | null;
  deliveryStatus?: 'DELIVERED' | 'READ';
  deliveredAt?: string;
  isDirectNotice?: boolean;
  isUrgent?: boolean;
  replies?: NoticeReply[];
  replyCount?: number;
  lastRepliedAt?: string;
  hasNewReply?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface MissionSegment {
  num: number;
  from?: string;
  to?: string;
  segment: string;
  distance: string;
}

export interface MissionReport {
  id: string;
  num?: string;
  tag?: string;
  name?: string;
  title: string;
  coverPhoto?: string;
  description?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  shortDate?: string;
  fullDate?: string;
  startDate?: string;
  endDate?: string;
  time?: string;
  duration?: string;
  avgSpeed?: string;
  totalDist?: string;
  distanceTargetKm?: number;
  durationTargetHours?: number;
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD' | 'EXTREME';
  rules?: string;
  rewardDescription?: string;
  icon?: string;
  cls?: string;
  variant?: 'alt-accent' | 'green-accent' | 'default' | 'custom';
  customColor?: string;
  isDuo?: boolean;
  status: 'COMING_SOON' | 'UPCOMING' | 'ONGOING' | 'ENDED' | 'CANCELLED' | 'DRAFT' | 'PUBLISHED';
  location?: string;
  startLocation?: string;
  destination?: string;
  instructions?: string;
  segments?: MissionSegment[];
  crewIds?: string[];
  crewNote?: string;
  notes?: string;
  disclaimer?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Post {
  id: string;
  authorId: string;
  authorName: string;
  authorPhotoURL: string;
  authorTitle?: string;
  content: string;
  photoURLs: string[];
  likesCount: number;
  commentsCount: number;
  isHidden: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PostComment {
  id: string;
  postId: string;
  parentId?: string | null; // For nested replies!
  replyToAuthor?: string;
  authorId: string;
  authorName: string;
  authorPhotoURL: string;
  text: string;
  replyCount?: number;
  isReported: boolean;
  isDeleted: boolean;
  deletedReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentReport {
  id: string;
  targetType: 'COMMENT' | 'POST';
  targetId: string;
  targetAuthorId?: string;
  targetExcerpt: string;
  reporterId: string;
  reporterEmail: string;
  reason: string;
  status: 'PENDING' | 'REVIEWED' | 'DISMISSED' | 'ACTION_TAKEN';
  moderatorNotes?: string;
  createdAt: string;
}

export interface GalleryItem {
  id: number;
  src: string;
  title: string;
  icon: string;
  fallbackName: string;
  meta: {
    icon: string;
    text: string;
  }[];
}

export interface InvitationCodeSummary {
  id: string;
  displayMasked: string;
  targetRole?: 'ADMIN' | 'MEMBER';
  expiresAt: string;
  isRedeemed: boolean;
  redeemedByEmail?: string;
  redeemedByUserId?: string;
  redeemedAt?: string;
  isRevoked: boolean;
  createdAt: string;
}

export interface SuperAdminStats {
  activeSessionsCount: number;
  activeSessions: {
    userId: string;
    email: string;
    role: string;
    lastActive: string;
  }[];
  invitationStats: {
    totalCodes: number;
    redeemedCodes: number;
    slotLimit: number;
    availableSlots: number;
  };
  auditLogs: {
    id: string;
    actorEmail: string;
    action: string;
    targetType: string;
    details: string;
    createdAt: string;
  }[];
}

export interface ChatMessageReaction {
  emoji: string;
  count: number;
  userIds: string[];
}

export interface AdminChatMessage {
  id: string;
  topicId: string;
  topicName?: string;
  senderId: string;
  senderName: string;
  senderPhotoURL?: string;
  senderRole: 'ADMIN' | 'SUPER_ADMIN';
  senderTitle?: string;
  text: string;
  imageUrl?: string;
  reactions?: ChatMessageReaction[];
  isPinned?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface AdminChatTopic {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  createdBy: string;
  createdAt: string;
}
