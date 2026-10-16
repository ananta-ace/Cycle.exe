export type UserRole = 'PUBLIC' | 'MEMBER' | 'ADMIN' | 'SUPER_ADMIN';

export type TabType =
  | 'home'
  | 'members'
  | 'community'
  | 'missions'
  | 'gallery'
  | 'profile'
  | 'admin'
  | 'superadmin';

export interface UserProfile {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  photoURL: string;
  bio: string;
  role: UserRole;
  isSuspended: boolean;
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
  missions: {
    m1: boolean;
    m2: boolean;
    m3: boolean;
  };
}

export interface MissionSegment {
  num: number;
  segment: string;
  distance: string;
}

export interface MissionReport {
  id: string;
  num?: string;
  name?: string;
  title?: string;
  coverPhoto?: string;
  description?: string;
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
  variant?: 'alt-accent' | 'green-accent' | 'default';
  isDuo?: boolean;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  segments?: MissionSegment[];
  crewIds?: string[];
  crewNote?: string;
  createdBy?: string;
  createdAt?: string;
}

export interface Post {
  id: string;
  authorId: string;
  authorName: string;
  authorPhotoURL: string;
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
  authorId: string;
  authorName: string;
  authorPhotoURL: string;
  text: string;
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
