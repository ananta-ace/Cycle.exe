import React, { useState } from 'react';
import { useAuth, DESIGNATED_SUPER_ADMIN_EMAIL } from '../context/AuthContext';

export const ProfileView: React.FC = () => {
  const {
    user,
    profile,
    role,
    isSuperAdmin,
    isMember,
    updateProfileDetails,
    redeemInvitation,
    signOutUser,
  } = useAuth();

  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [photoURL, setPhotoURL] = useState(profile?.photoURL || '');
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Invitation code state
  const [inviteCode, setInviteCode] = useState('');
  const [activating, setActivating] = useState(false);
  const [codeMsg, setCodeMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  if (!user) {
    return (
      <div className="neo-card max-w-md mx-auto text-center py-12">
        <i className="fas fa-user-lock text-4xl text-[#b45309] mb-3"></i>
        <h2 className="text-xl font-bold mb-1">Sign In Required</h2>
        <p className="text-xs text-zinc-600 mb-4">Please sign in to view and manage your profile.</p>
      </div>
    );
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setSaveMsg(null);
      await updateProfileDetails(displayName, bio, photoURL);
      setSaveMsg('Profile saved successfully!');
      setIsEditing(false);
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleRedeemCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode.trim()) return;

    try {
      setActivating(true);
      setCodeMsg(null);
      const res = await redeemInvitation(inviteCode.trim());
      setCodeMsg({ type: 'success', text: res.message });
      setInviteCode('');
    } catch (err: unknown) {
      setCodeMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Invalid invitation code',
      });
    } finally {
      setActivating(false);
    }
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    const file = e.target.files[0];
    if (file.size > 5 * 1024 * 1024) {
      alert('Avatar image must be under 5MB.');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setPhotoURL(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="max-w-4xl lg:max-w-5xl mx-auto space-y-8">
      {/* Profile Card */}
      <div className="neo-card p-6 sm:p-9">
        <div className="flex flex-col md:flex-row items-center md:items-start gap-8">
          <div className="relative group">
            <div className="w-32 h-32 rounded-full border-4 border-zinc-900 bg-zinc-200 overflow-hidden flex items-center justify-center font-bold text-4xl shadow-[0_6px_0_#d6d2ca] flex-shrink-0">
              {profile?.photoURL || photoURL ? (
                <img
                  src={photoURL || profile?.photoURL}
                  alt={profile?.displayName}
                  className="w-full h-full object-cover"
                />
              ) : (
                profile?.displayName?.charAt(0).toUpperCase() || 'U'
              )}
            </div>
            {isEditing && (
              <label className="absolute bottom-0 right-0 w-9 h-9 rounded-full bg-[#1e1e1e] text-[#f9c74f] border-2 border-zinc-900 flex items-center justify-center cursor-pointer text-sm hover:bg-[#b45309] shadow-md">
                <i className="fas fa-camera"></i>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  className="hidden"
                />
              </label>
            )}
          </div>

          <div className="flex-1 text-center md:text-left">
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 mb-2">
              <h2 className="text-2xl sm:text-3xl font-black text-zinc-900">{profile?.displayName || 'Cyclist'}</h2>
              <span className={`role-badge ${role}`}>
                <i className="fas fa-shield-alt text-[0.6rem]"></i> {role}
              </span>
            </div>

            <p className="text-xs sm:text-sm text-zinc-500 mb-4">
              <i className="fas fa-envelope mr-1.5 text-zinc-400"></i> {user.email} · Registered{' '}
              {new Date(profile?.createdAt || Date.now()).toLocaleDateString()}
            </p>

            <div className="bg-[#f6f3ee] p-4 sm:p-5 rounded-2xl border border-zinc-300 text-sm text-zinc-700 min-h-[70px] whitespace-pre-line mb-5 leading-relaxed">
              {profile?.bio || <span className="italic text-zinc-400">No bio written yet. Click edit to add your cycling background, favorite bike, and routes!</span>}
            </div>

            {saveMsg && (
              <div className="p-3 mb-4 bg-emerald-50 border border-emerald-500 rounded-xl text-xs font-bold text-emerald-800">
                {saveMsg}
              </div>
            )}

            <div className="flex flex-wrap justify-center md:justify-start gap-3">
              <button
                type="button"
                onClick={() => setIsEditing(!isEditing)}
                className="btn-secondary text-xs py-1.5 px-4"
              >
                <i className={`fas ${isEditing ? 'fa-times' : 'fa-edit'}`}></i>{' '}
                {isEditing ? 'Cancel Editing' : 'Edit Profile'}
              </button>

              <button
                type="button"
                onClick={signOutUser}
                className="btn-secondary text-xs py-1.5 px-4 text-red-600 hover:text-red-700"
              >
                <i className="fas fa-sign-out-alt"></i> Sign Out
              </button>
            </div>
          </div>
        </div>

        {/* Edit Profile Form */}
        {isEditing && (
          <form onSubmit={handleSaveProfile} className="mt-6 pt-6 border-t-2 border-zinc-200 space-y-4">
            <h3 className="font-bold text-sm uppercase tracking-wider text-zinc-700">Update Profile Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold mb-1 text-zinc-700">Display Name</label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="neo-input text-sm py-2"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1 text-zinc-700">Profile Photo URL (or use camera icon)</label>
                <input
                  type="url"
                  value={photoURL}
                  onChange={(e) => setPhotoURL(e.target.value)}
                  placeholder="https://..."
                  className="neo-input text-sm py-2"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1 text-zinc-700">Rider Biography</label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                placeholder="Share your riding style, cadence, favorite trails..."
                className="neo-input text-sm py-2 resize-none"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="submit"
                disabled={saving}
                className="btn-primary text-xs py-2 px-5 font-bold"
              >
                {saving ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-save"></i>}{' '}
                Save Changes
              </button>
            </div>
          </form>
        )}
      </div>

      {/* SECTION: "Become a Cycle.exe Member" */}
      <div className="neo-card bg-[#fffdf9] border-2 border-zinc-900 shadow-[0_8px_0_#d6d2ca]">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-[#f9c74f] border-2 border-zinc-900 flex items-center justify-center text-zinc-900 font-bold text-lg">
            <i className="fas fa-ticket-alt"></i>
          </div>
          <div>
            <h3 className="text-xl font-bold">Become a Cycle.exe Member</h3>
            <p className="text-xs text-zinc-600">
              Redeem a single-use invitation code provided by the Super Admin to unlock member privileges.
            </p>
          </div>
        </div>

        <div className="bg-[#f6f3ee] p-4 rounded-2xl border border-zinc-300 mb-4">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-600">Current Status:</span>
            <span className={`role-badge ${role}`}>{role}</span>
          </div>

          {isMember ? (
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-800">
              <i className="fas fa-check-circle text-base text-emerald-600"></i>
              <span>Your membership is active! You can publish posts, upload ride photos, like content, and participate in discussions.</span>
            </div>
          ) : (
            <p className="text-xs text-zinc-600 leading-relaxed">
              You are currently registered as a <strong>Public User</strong>. Enter your secret membership invitation code below to upgrade to <strong>Member</strong>.
            </p>
          )}
        </div>

        {/* Code Activation Form */}
        {!isMember && (
          <form onSubmit={handleRedeemCode} className="space-y-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-zinc-700">
                Secret Invitation Code
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  required
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="e.g. CYCLE-A8B2-9F1C"
                  className="neo-input uppercase tracking-wider font-mono text-sm py-2.5 flex-1"
                />
                <button
                  type="submit"
                  disabled={activating}
                  className="btn-primary text-xs py-2 px-5 font-bold whitespace-nowrap"
                >
                  {activating ? (
                    <>
                      <i className="fas fa-spinner fa-spin"></i> Activating...
                    </>
                  ) : (
                    <>
                      <i className="fas fa-unlock-alt"></i> Activate Membership
                    </>
                  )}
                </button>
              </div>
            </div>

            {codeMsg && (
              <div
                className={`p-3 rounded-xl border text-xs font-bold flex items-center gap-2 ${
                  codeMsg.type === 'success'
                    ? 'bg-emerald-50 border-emerald-500 text-emerald-800'
                    : 'bg-red-50 border-red-500 text-red-700'
                }`}
              >
                <i
                  className={`fas ${
                    codeMsg.type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'
                  }`}
                ></i>
                <span>{codeMsg.text}</span>
              </div>
            )}
          </form>
        )}
      </div>

      {/* Super Admin Notice if Designated Owner */}
      {user.email?.toLowerCase() === DESIGNATED_SUPER_ADMIN_EMAIL.toLowerCase() && (
        <div className="p-4 bg-amber-50 border-2 border-amber-400 rounded-2xl flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <i className="fas fa-crown text-2xl text-amber-600"></i>
            <div>
              <div className="text-sm font-bold text-amber-900">Super Admin Privileges</div>
              <div className="text-xs text-amber-800">
                {isSuperAdmin
                  ? 'Your account holds the highest authority in Cycle.exe 2.0.'
                  : 'Click the banner at the top of the page to bootstrap your Super Admin account.'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
