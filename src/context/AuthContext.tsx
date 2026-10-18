import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  collection,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { UserRole, UserProfile } from '../types';

export const DESIGNATED_SUPER_ADMIN_EMAIL = 'tubedork@gmail.com';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  role: UserRole;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isMember: boolean;
  isSuspended: boolean;
  loading: boolean;
  unreadNotificationsCount: number;
  signInWithGoogle: () => Promise<void>;
  registerWithEmail: (email: string, pass: string, name: string) => Promise<void>;
  loginWithEmail: (email: string, pass: string) => Promise<void>;
  signOutUser: () => Promise<void>;
  bootstrapSuperAdmin: () => Promise<{ success: boolean; message: string }>;
  redeemInvitation: (code: string) => Promise<{ success: boolean; message: string }>;
  updateProfileDetails: (name: string, bio: string, photoURL?: string, customTitle?: string) => Promise<void>;
  dismissWelcomeModal: (roleToken: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);

  // Listen for unread notifications
  useEffect(() => {
    if (!user) {
      setUnreadNotificationsCount(0);
      return;
    }

    const notifsRef = collection(db, 'notifications');
    const unsub = onSnapshot(
      notifsRef,
      (snapshot) => {
        let count = 0;
        const isSuper =
          profile?.role === 'SUPER_ADMIN' ||
          user.email?.toLowerCase() === DESIGNATED_SUPER_ADMIN_EMAIL.toLowerCase();
        const isAdm = profile?.role === 'ADMIN' || isSuper;

        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          if (!data.isRead) {
            if (data.recipientId === user.uid) {
              count++;
            } else if (isSuper && (data.recipientId === 'SUPER_ADMIN' || data.recipientId === 'ALL_ADMINS')) {
              count++;
            } else if (isAdm && data.recipientId === 'ALL_ADMINS') {
              count++;
            }
          }
        });
        setUnreadNotificationsCount(count);
      },
      (err) => {
        console.warn('Notifications count listener warning:', err);
      }
    );

    return () => unsub();
  }, [user, profile]);

  // Initialize and observe auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (currentUser) {
        // Fetch or create profile
        const userRef = doc(db, 'users', currentUser.uid);
        try {
          const userSnap = await getDoc(userRef);

          if (!userSnap.exists()) {
            // New user registration profile
            const isOwnerEmail =
              currentUser.email?.toLowerCase() === DESIGNATED_SUPER_ADMIN_EMAIL.toLowerCase();

            // Default to PUBLIC unless verified owner bootstrapped
            const initialRole: UserRole = isOwnerEmail && currentUser.emailVerified ? 'SUPER_ADMIN' : 'PUBLIC';

            const newProfile: UserProfile = {
              id: currentUser.uid,
              email: currentUser.email || '',
              emailVerified: currentUser.emailVerified,
              displayName: currentUser.displayName || currentUser.email?.split('@')[0] || 'Cyclist',
              photoURL: currentUser.photoURL || '',
              bio: '',
              role: initialRole,
              isSuspended: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };

            await setDoc(userRef, newProfile);
            setProfile(newProfile);

            // Record private info subcollection
            await setDoc(doc(db, 'users', currentUser.uid, 'private', 'info'), {
              email: currentUser.email,
              emailVerified: currentUser.emailVerified,
              lastLoginAt: new Date().toISOString(),
              loginCount: 1,
            });
          } else {
            const data = userSnap.data() as UserProfile;
            setProfile(data);
          }
        } catch (err) {
          console.error('Error fetching/creating user profile:', err);
        }

        // Real-time snapshot listener on profile to ensure immediate revocation / promotion takes effect
        const unsubProfile = onSnapshot(userRef, (snap) => {
          if (snap.exists()) {
            const data = snap.data() as UserProfile;
            setProfile(data);
          }
        });

        // Heartbeat will be handled globally
        setLoading(false);
        return () => {
          unsubProfile();
        };
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // Send real-time heartbeat for live visitor tracking (both guests and users)
  useEffect(() => {
    let visitorId = '';
    try {
      visitorId = localStorage.getItem('cycle_visitor_id') || '';
      if (!visitorId) {
        visitorId = `v_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`;
        localStorage.setItem('cycle_visitor_id', visitorId);
      }
    } catch {
      visitorId = `v_temp_${Date.now()}`;
    }

    const sendBeat = async () => {
      try {
        await fetch('/api/session/heartbeat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': user?.uid || '',
            'x-user-email': user?.email || '',
            'x-user-role': profile?.role || 'PUBLIC',
            'x-visitor-id': visitorId,
          },
          body: JSON.stringify({ visitorId }),
        });
      } catch {
        // Non-blocking
      }
    };

    sendBeat();
    const interval = setInterval(sendBeat, 20000);
    return () => clearInterval(interval);
  }, [user, profile?.role]);

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const registerWithEmail = async (email: string, pass: string, name: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    if (cred.user) {
      await updateProfile(cred.user, { displayName: name });
      await sendEmailVerification(cred.user);
    }
  };

  const loginWithEmail = async (email: string, pass: string) => {
    await signInWithEmailAndPassword(auth, email, pass);
  };

  const resendVerificationEmail = async () => {
    if (auth.currentUser) {
      await sendEmailVerification(auth.currentUser);
    }
  };

  const signOutUser = async () => {
    await signOut(auth);
    setProfile(null);
  };

  const bootstrapSuperAdmin = async () => {
    if (!user) throw new Error('You must be signed in.');

    const res = await fetch('/api/bootstrap-super-admin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': user.uid,
        'x-user-email': user.email || '',
        'x-user-verified': String(user.emailVerified),
      },
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Bootstrap failed');

    // Update Firestore user document role to SUPER_ADMIN
    await updateDoc(doc(db, 'users', user.uid), {
      role: 'SUPER_ADMIN',
      updatedAt: new Date().toISOString(),
    });

    setProfile((prev) => (prev ? { ...prev, role: 'SUPER_ADMIN' } : null));
    return { success: true, message: data.message };
  };

  const redeemInvitation = async (code: string) => {
    if (!user) throw new Error('Please sign in first to redeem an invitation code.');

    const res = await fetch('/api/invitations/redeem', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': user.uid,
        'x-user-email': user.email || '',
      },
      body: JSON.stringify({ code: code.trim() }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to redeem invitation code');

    const newRole = (data.newRole as UserRole) || 'ADMIN';
    setProfile((prev) =>
      prev
        ? {
            ...prev,
            role: newRole,
            isAdminMember: newRole === 'ADMIN' ? true : prev.isAdminMember,
            adminMembershipStatus: newRole === 'ADMIN' ? 'APPROVED' : prev.adminMembershipStatus,
          }
        : null
    );

    return { success: true, message: data.message };
  };

  const updateProfileDetails = async (
    displayName: string,
    bio: string,
    photoURL?: string,
    customTitle?: string
  ) => {
    if (!user) return;
    const updates: Partial<UserProfile> = {
      displayName: displayName.trim(),
      bio: bio.trim(),
      updatedAt: new Date().toISOString(),
    };
    if (photoURL !== undefined) updates.photoURL = photoURL;
    if (customTitle !== undefined) updates.customTitle = customTitle.trim();

    await updateDoc(doc(db, 'users', user.uid), updates);
    if (auth.currentUser) {
      await updateProfile(auth.currentUser, {
        displayName,
        photoURL: photoURL || auth.currentUser.photoURL,
      });
    }
  };

  const dismissWelcomeModal = async (roleToken: string) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        welcomeSeenForRole: roleToken,
        updatedAt: new Date().toISOString(),
      });
      setProfile((prev) => (prev ? { ...prev, welcomeSeenForRole: roleToken } : null));
    } catch (err) {
      console.error('Error dismissing welcome modal:', err);
    }
  };

  const role: UserRole = profile?.role || 'PUBLIC';
  const isSuperAdmin =
    role === 'SUPER_ADMIN' ||
    user?.email?.toLowerCase() === DESIGNATED_SUPER_ADMIN_EMAIL.toLowerCase();
  const isAdmin = role === 'ADMIN' || isSuperAdmin;
  const isMember =
    (role === 'MEMBER' ||
      profile?.isAdminMember === true ||
      profile?.adminMembershipStatus === 'APPROVED' ||
      isAdmin) &&
    !profile?.isSuspended;
  const isSuspended = profile?.isSuspended || false;

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        role,
        isSuperAdmin,
        isAdmin,
        isMember,
        isSuspended,
        loading,
        unreadNotificationsCount,
        signInWithGoogle,
        registerWithEmail,
        loginWithEmail,
        signOutUser,
        bootstrapSuperAdmin,
        redeemInvitation,
        updateProfileDetails,
        dismissWelcomeModal,
        resendVerificationEmail,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
