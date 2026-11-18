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
  getDocs,
  setDoc,
  updateDoc,
  onSnapshot,
  collection,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { UserRole, UserProfile } from '../types';

export const AUTHORIZED_SUPER_ADMIN_EMAILS = [
  'ananta.base@gmail.com',
  'towhidulislamananta@gmail.com',
];

export const isSuperAdminEmail = (email?: string | null): boolean => {
  if (!email) return false;
  return AUTHORIZED_SUPER_ADMIN_EMAILS.includes(email.toLowerCase().trim());
};

export const DESIGNATED_SUPER_ADMIN_EMAIL = 'ananta.base@gmail.com';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  role: UserRole;
  isSuperAdmin: boolean;
  firestoreSuperAdminSynced: boolean;
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
  syncSuperAdminAccess: () => Promise<{ synced: boolean; message: string }>;
  redeemInvitation: (code: string) => Promise<{ success: boolean; message: string }>;
  updateProfileDetails: (name: string, bio: string, photoURL?: string, customTitle?: string) => Promise<void>;
  dismissWelcomeModal: (roleToken: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  accountNotice: string | null;
  clearAccountNotice: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);

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
          isSuperAdminEmail(user.email);
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
    let unsubProfile: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      setUser(currentUser);

      if (currentUser) {
        // Fetch or create profile
        const userRef = doc(db, 'users', currentUser.uid);
        try {
          const userSnap = await getDoc(userRef);

          if (!userSnap.exists()) {
            // New user registration profile
            const isOwnerEmail = isSuperAdminEmail(currentUser.email);

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

            if (isSuperAdminEmail(currentUser.email) && currentUser.emailVerified) {
              const now = new Date().toISOString();
              if (data.role !== 'SUPER_ADMIN') {
                try {
                  await updateDoc(userRef, { role: 'SUPER_ADMIN', isSuspended: false, updatedAt: now });
                  setProfile({ ...data, role: 'SUPER_ADMIN', isSuspended: false });
                } catch {
                  // Cannot self-promote yet under live Firestore rules until synced by existing Super Admin or rules update
                }
              }
              // When signed in with live Firestore Super Admin rights (e.g. towhidulislamananta@gmail.com),
              // ensure ALL authorized Super Admin accounts (including ananta.base@gmail.com) have role === 'SUPER_ADMIN' in Firestore.
              try {
                const allSnap = await getDocs(collection(db, 'users'));
                for (const d of allSnap.docs) {
                  const uData = d.data() as Partial<UserProfile>;
                  const shouldBeSuper = isSuperAdminEmail(uData.email);
                  if (shouldBeSuper && uData.role !== 'SUPER_ADMIN') {
                    await updateDoc(doc(db, 'users', d.id), {
                      role: 'SUPER_ADMIN',
                      isSuspended: false,
                      updatedAt: now,
                    });
                  } else if (!shouldBeSuper && uData.role === 'SUPER_ADMIN') {
                    await updateDoc(doc(db, 'users', d.id), {
                      role: 'PUBLIC',
                      updatedAt: now,
                    });
                  }
                }
              } catch {
                // Current user does not yet have cross-user write permission in Firestore rules
              }
            }
          }
        } catch (err) {
          console.error('Error fetching/creating user profile:', err);
        }

        let profileExisted = Boolean(userRef);
        try {
          const checkSnap = await getDoc(userRef);
          profileExisted = checkSnap.exists();
        } catch {
          profileExisted = false;
        }

        unsubProfile = onSnapshot(
          userRef,
          (snap) => {
            if (snap.exists()) {
              profileExisted = true;
              const data = snap.data() as UserProfile;
              setProfile(data);
            } else if (profileExisted) {
              profileExisted = false;
              setProfile(null);
              setAccountNotice('Your Cycle.exe account was deleted by the Super Admin.');
              signOut(auth).catch(() => {});
            }
          },
          (err) => {
            console.warn('Profile sync warning:', err);
          }
        );

        setLoading(false);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      if (unsubProfile) unsubProfile();
      unsubscribe();
    };
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

  const syncSuperAdminAccess = async (): Promise<{ synced: boolean; message: string }> => {
    if (!user || !isSuperAdminEmail(user.email)) {
      return { synced: false, message: 'Only authorized Super Admin emails can sync Super Admin access.' };
    }
    if (!user.emailVerified) {
      return { synced: false, message: 'Please verify your email address first.' };
    }

    const now = new Date().toISOString();
    try {
      const userRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userRef);
      if (snap.exists() && snap.data()?.role !== 'SUPER_ADMIN') {
        await updateDoc(userRef, { role: 'SUPER_ADMIN', isSuspended: false, updatedAt: now });
      }

      const allSnap = await getDocs(collection(db, 'users'));
      let updatedCount = 0;
      for (const d of allSnap.docs) {
        const uData = d.data() as Partial<UserProfile>;
        const shouldBeSuper = isSuperAdminEmail(uData.email);
        if (shouldBeSuper && uData.role !== 'SUPER_ADMIN') {
          await updateDoc(doc(db, 'users', d.id), {
            role: 'SUPER_ADMIN',
            isSuspended: false,
            updatedAt: now,
          });
          updatedCount++;
        } else if (!shouldBeSuper && uData.role === 'SUPER_ADMIN') {
          await updateDoc(doc(db, 'users', d.id), {
            role: 'PUBLIC',
            updatedAt: now,
          });
        }
      }

      const refreshed = await getDoc(userRef);
      if (refreshed.exists()) {
        setProfile(refreshed.data() as UserProfile);
      }

      return {
        synced: true,
        message:
          updatedCount > 0
            ? `Synced SUPER_ADMIN database clearance for ${updatedCount} account(s)!`
            : 'Your Super Admin database clearance is active!',
      };
    } catch (err: unknown) {
      return {
        synced: false,
        message:
          err instanceof Error
            ? `Database rules blocked self-promotion (${err.message}). Sign in once as towhidulislamananta@gmail.com or publish firestore.rules in Firebase Console.`
            : 'Database permission sync requires opening the app once as towhidulislamananta@gmail.com or publishing firestore.rules.',
      };
    }
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
      isSuspended: false,
      updatedAt: new Date().toISOString(),
    });

    setProfile((prev) => (prev ? { ...prev, role: 'SUPER_ADMIN', isSuspended: false } : null));
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
    const trimmedName = displayName.trim() || profile?.displayName || 'Cyclist';
    const updates: Partial<UserProfile> = {
      displayName: trimmedName,
      bio: bio.trim(),
      updatedAt: new Date().toISOString(),
    };
    if (photoURL !== undefined) updates.photoURL = photoURL;
    if (customTitle !== undefined) updates.customTitle = customTitle.trim();

    await updateDoc(doc(db, 'users', user.uid), updates);
    setProfile((prev) => (prev ? { ...prev, ...updates } : prev));

    if (auth.currentUser) {
      try {
        const authUpdates: { displayName?: string; photoURL?: string } = {
          displayName: trimmedName,
        };
        if (
          photoURL &&
          !photoURL.startsWith('data:') &&
          photoURL.length <= 1800
        ) {
          authUpdates.photoURL = photoURL.startsWith('/')
            ? `${window.location.origin}${photoURL}`
            : photoURL;
        }
        await updateProfile(auth.currentUser, authUpdates);
      } catch (authProfileErr) {
        console.warn('Non-fatal Firebase Auth profile sync notice:', authProfileErr);
      }
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

  const isSuperAdmin = isSuperAdminEmail(user?.email);
  const firestoreSuperAdminSynced = isSuperAdmin && profile?.role === 'SUPER_ADMIN';
  const rawRole: UserRole = profile?.role || 'PUBLIC';
  const role: UserRole = isSuperAdmin
    ? 'SUPER_ADMIN'
    : rawRole === 'SUPER_ADMIN'
    ? 'PUBLIC'
    : rawRole;
  const isAdmin = isSuperAdmin || (role === 'ADMIN' && !profile?.isSuspended);
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
        firestoreSuperAdminSynced,
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
        syncSuperAdminAccess,
        redeemInvitation,
        updateProfileDetails,
        dismissWelcomeModal,
        resendVerificationEmail,
        accountNotice,
        clearAccountNotice: () => setAccountNotice(null),
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
