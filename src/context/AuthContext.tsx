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
  signInWithGoogle: () => Promise<void>;
  registerWithEmail: (email: string, pass: string, name: string) => Promise<void>;
  loginWithEmail: (email: string, pass: string) => Promise<void>;
  signOutUser: () => Promise<void>;
  bootstrapSuperAdmin: () => Promise<{ success: boolean; message: string }>;
  redeemInvitation: (code: string) => Promise<{ success: boolean; message: string }>;
  updateProfileDetails: (name: string, bio: string, photoURL?: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

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

        // Send active session heartbeat
        sendHeartbeat(currentUser);
        const interval = setInterval(() => sendHeartbeat(currentUser), 120000);

        setLoading(false);
        return () => {
          unsubProfile();
          clearInterval(interval);
        };
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const sendHeartbeat = async (u: User) => {
    try {
      await fetch('/api/session/heartbeat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': u.uid,
          'x-user-email': u.email || '',
          'x-user-role': profile?.role || 'PUBLIC',
        },
      });
    } catch {
      // Non-blocking
    }
  };

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
    if (!user) throw new Error('Please sign in first.');

    const res = await fetch('/api/invitations/redeem', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': user.uid,
        'x-user-email': user.email || '',
      },
      body: JSON.stringify({ code }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to activate membership');

    // Update Firestore role
    await updateDoc(doc(db, 'users', user.uid), {
      role: 'MEMBER',
      updatedAt: new Date().toISOString(),
    });

    setProfile((prev) => (prev ? { ...prev, role: 'MEMBER' } : null));
    return { success: true, message: data.message };
  };

  const updateProfileDetails = async (displayName: string, bio: string, photoURL?: string) => {
    if (!user) return;
    const updates: Partial<UserProfile> = {
      displayName: displayName.trim(),
      bio: bio.trim(),
      updatedAt: new Date().toISOString(),
    };
    if (photoURL !== undefined) updates.photoURL = photoURL;

    await updateDoc(doc(db, 'users', user.uid), updates);
    if (auth.currentUser) {
      await updateProfile(auth.currentUser, { displayName, photoURL: photoURL || auth.currentUser.photoURL });
    }
  };

  const role: UserRole = profile?.role || 'PUBLIC';
  const isSuperAdmin = role === 'SUPER_ADMIN';
  const isAdmin = role === 'ADMIN' || isSuperAdmin;
  const isMember = (role === 'MEMBER' || isAdmin) && !profile?.isSuspended;
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
        signInWithGoogle,
        registerWithEmail,
        loginWithEmail,
        signOutUser,
        bootstrapSuperAdmin,
        redeemInvitation,
        updateProfileDetails,
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
