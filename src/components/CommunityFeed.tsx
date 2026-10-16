import React, { useState, useEffect } from 'react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  setDoc,
  getDocs,
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { Post, PostComment } from '../types';
import { ReportModal } from './ReportModal';

export const CommunityFeed: React.FC = () => {
  const { user, profile, isMember, isSuperAdmin, isAdmin } = useAuth();

  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [newPostText, setNewPostText] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isPosting, setIsPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  // Likes state: map postId -> boolean (whether current user liked)
  const [userLikes, setUserLikes] = useState<Record<string, boolean>>({});

  // Active comment box toggle: map postId -> boolean
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({});
  const [commentsMap, setCommentsMap] = useState<Record<string, PostComment[]>>({});
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  const [commentLoading, setCommentLoading] = useState<Record<string, boolean>>({});

  // Reporting modal target
  const [reportTarget, setReportTarget] = useState<{
    type: 'COMMENT' | 'POST';
    id: string;
    excerpt: string;
    authorId?: string;
  } | null>(null);

  // Edit post modal / state
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [editContent, setEditContent] = useState('');

  // 1. Listen for real-time posts
  useEffect(() => {
    const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items: Post[] = [];
        snapshot.forEach((docSnap) => {
          items.push({ id: docSnap.id, ...(docSnap.data() as Omit<Post, 'id'>) });
        });
        setPosts(items);
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching posts:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // 2. Fetch current user likes for all posts
  useEffect(() => {
    if (!user) {
      setUserLikes({});
      return;
    }

    const unsubs: (() => void)[] = [];

    posts.forEach((p) => {
      const likeDocRef = doc(db, 'posts', p.id, 'likes', user.uid);
      const unsub = onSnapshot(likeDocRef, (snap) => {
        setUserLikes((prev) => ({ ...prev, [p.id]: snap.exists() }));
      });
      unsubs.push(unsub);
    });

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [posts, user]);

  // Handle image selection with type and size validation
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);

    const validFiles: File[] = [];
    const previews: string[] = [];

    for (const f of files) {
      if (!f.type.startsWith('image/')) {
        setPostError('Only image files (PNG, JPEG, WebP, GIF) are allowed.');
        return;
      }
      if (f.size > 5 * 1024 * 1024) {
        setPostError(`File "${f.name}" exceeds the 5MB maximum limit.`);
        return;
      }
      validFiles.push(f);
      previews.push(URL.createObjectURL(f));
    }

    setPostError(null);
    setSelectedFiles((prev) => [...prev, ...validFiles].slice(0, 4));
    setFilePreviews((prev) => [...prev, ...previews].slice(0, 4));
  };

  const removeFile = (idx: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== idx));
    setFilePreviews((prev) => prev.filter((_, i) => i !== idx));
  };

  // Create new post
  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !isMember) {
      setPostError('Only verified Cycle.exe Members can publish posts.');
      return;
    }

    if (!newPostText.trim() && selectedFiles.length === 0) {
      setPostError('Please enter some text or attach an image.');
      return;
    }

    try {
      setIsPosting(true);
      setPostError(null);

      const uploadedUrls: string[] = [];

      // Upload selected files
      if (selectedFiles.length > 0) {
        for (let i = 0; i < selectedFiles.length; i++) {
          const file = selectedFiles[i];
          const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
          const storageRef = ref(storage, `posts/${user.uid}/${fileName}`);

          try {
            const uploadTask = uploadBytesResumable(storageRef, file);
            await new Promise<void>((resolve, reject) => {
              uploadTask.on(
                'state_changed',
                (snapshot) => {
                  const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                  setUploadProgress(Math.round(progress));
                },
                (err) => reject(err),
                async () => {
                  const url = await getDownloadURL(uploadTask.snapshot.ref);
                  uploadedUrls.push(url);
                  resolve();
                }
              );
            });
          } catch {
            // If Firebase Storage has bucket restrictions, fallback to inline base64
            const base64Url = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.readAsDataURL(file);
            });
            uploadedUrls.push(base64Url);
          }
        }
      }

      const postData: Omit<Post, 'id'> = {
        authorId: user.uid,
        authorName: profile?.displayName || user.displayName || 'Cyclist',
        authorPhotoURL: profile?.photoURL || user.photoURL || '',
        content: newPostText.trim(),
        photoURLs: uploadedUrls,
        likesCount: 0,
        commentsCount: 0,
        isHidden: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await addDoc(collection(db, 'posts'), postData);

      setNewPostText('');
      setSelectedFiles([]);
      setFilePreviews([]);
      setUploadProgress(null);
    } catch (err: unknown) {
      console.error('Post creation error:', err);
      setPostError(err instanceof Error ? err.message : 'Failed to publish post');
    } finally {
      setIsPosting(false);
    }
  };

  // Toggle Like / Unlike
  const handleToggleLike = async (post: Post) => {
    if (!user) {
      alert('Please sign in and become a Member to like posts.');
      return;
    }
    if (!isMember) {
      alert('Public users cannot like posts. Enter your invitation code in your Profile to activate membership!');
      return;
    }

    const likeDocRef = doc(db, 'posts', post.id, 'likes', user.uid);
    const postRef = doc(db, 'posts', post.id);
    const isCurrentlyLiked = userLikes[post.id];

    try {
      if (isCurrentlyLiked) {
        // Unlike
        await deleteDoc(likeDocRef);
        await updateDoc(postRef, {
          likesCount: Math.max(0, post.likesCount - 1),
        });
      } else {
        // Like
        await setDoc(likeDocRef, {
          postId: post.id,
          userId: user.uid,
          createdAt: new Date().toISOString(),
        });
        await updateDoc(postRef, {
          likesCount: post.likesCount + 1,
        });
      }
    } catch (err) {
      console.error('Like toggle error:', err);
    }
  };

  // Fetch comments when toggled
  const toggleComments = async (postId: string) => {
    const isExpanded = !expandedComments[postId];
    setExpandedComments((prev) => ({ ...prev, [postId]: isExpanded }));

    if (isExpanded && !commentsMap[postId]) {
      const q = query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt', 'asc'));
      const snap = await getDocs(q);
      const list: PostComment[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<PostComment, 'id'>) }));
      setCommentsMap((prev) => ({ ...prev, [postId]: list }));

      // Attach live listener
      onSnapshot(q, (snapshot) => {
        const liveList: PostComment[] = [];
        snapshot.forEach((d) => liveList.push({ id: d.id, ...(d.data() as Omit<PostComment, 'id'>) }));
        setCommentsMap((prev) => ({ ...prev, [postId]: liveList }));
      });
    }
  };

  // Add comment
  const handleAddComment = async (postId: string) => {
    if (!user) {
      alert('Please sign in to comment.');
      return;
    }
    if (!isMember) {
      alert('Public users cannot comment. Activate your membership in your Profile!');
      return;
    }

    const text = commentInputs[postId]?.trim();
    if (!text) return;

    try {
      setCommentLoading((prev) => ({ ...prev, [postId]: true }));

      const commentData: Omit<PostComment, 'id'> = {
        postId,
        authorId: user.uid,
        authorName: profile?.displayName || user.displayName || 'Rider',
        authorPhotoURL: profile?.photoURL || user.photoURL || '',
        text,
        isReported: false,
        isDeleted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await addDoc(collection(db, 'posts', postId, 'comments'), commentData);

      // Increment comment count on parent post
      const post = posts.find((p) => p.id === postId);
      if (post) {
        await updateDoc(doc(db, 'posts', postId), {
          commentsCount: post.commentsCount + 1,
        });
      }

      setCommentInputs((prev) => ({ ...prev, [postId]: '' }));
    } catch (err) {
      console.error('Comment error:', err);
    } finally {
      setCommentLoading((prev) => ({ ...prev, [postId]: false }));
    }
  };

  // Delete Comment (Author or Super Admin ONLY!)
  const handleDeleteComment = async (postId: string, comment: PostComment) => {
    const canDelete = isSuperAdmin || (user && user.uid === comment.authorId);
    if (!canDelete) {
      alert("Permission denied. Only the author or Super Admin can delete comments.");
      return;
    }

    if (!confirm('Are you sure you want to delete this comment?')) return;

    try {
      await deleteDoc(doc(db, 'posts', postId, 'comments', comment.id));
      const post = posts.find((p) => p.id === postId);
      if (post && post.commentsCount > 0) {
        await updateDoc(doc(db, 'posts', postId), {
          commentsCount: Math.max(0, post.commentsCount - 1),
        });
      }
    } catch (err) {
      console.error('Delete comment error:', err);
    }
  };

  // Delete Post (Author or Super Admin ONLY!)
  const handleDeletePost = async (post: Post) => {
    const canDelete = isSuperAdmin || (user && user.uid === post.authorId);
    if (!canDelete) {
      alert('Permission denied. You can only delete your own posts.');
      return;
    }

    if (!confirm('Are you sure you want to delete this post? This cannot be undone.')) return;

    try {
      await deleteDoc(doc(db, 'posts', post.id));
    } catch (err) {
      console.error('Delete post error:', err);
    }
  };

  // Toggle Hide Post (Admins & Super Admin)
  const handleToggleHidePost = async (post: Post) => {
    if (!isAdmin) return;
    try {
      await updateDoc(doc(db, 'posts', post.id), {
        isHidden: !post.isHidden,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Hide post error:', err);
    }
  };

  // Edit Post
  const handleSavePostEdit = async () => {
    if (!editingPost) return;
    try {
      await updateDoc(doc(db, 'posts', editingPost.id), {
        content: editContent.trim(),
        updatedAt: new Date().toISOString(),
      });
      setEditingPost(null);
    } catch (err) {
      console.error('Edit post error:', err);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Hero */}
      <div className="hero mb-8">
        <h1>
          <i className="fas fa-comments"></i> Community Feed
        </h1>
        <p>Live discussions, ride photos, route check-ins, and cycling updates.</p>
      </div>

      {/* Post Creator Box */}
      <div className="neo-card mb-8">
        {user ? (
          isMember ? (
            <form onSubmit={handleCreatePost}>
              <div className="flex gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-zinc-200 border-2 border-zinc-900 flex items-center justify-center font-bold text-sm overflow-hidden flex-shrink-0">
                  {profile?.photoURL ? (
                    <img
                      src={profile.photoURL}
                      alt={profile.displayName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    profile?.displayName?.charAt(0).toUpperCase() || 'U'
                  )}
                </div>
                <textarea
                  value={newPostText}
                  onChange={(e) => setNewPostText(e.target.value)}
                  placeholder="Share a route, mechanical tip, or cycling memory with the crew..."
                  rows={3}
                  className="neo-input text-sm resize-none w-full"
                />
              </div>

              {/* Previews */}
              {filePreviews.length > 0 && (
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {filePreviews.map((url, idx) => (
                    <div key={idx} className="relative rounded-xl overflow-hidden border-2 border-zinc-900 aspect-video">
                      <img src={url} alt="Upload preview" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removeFile(idx)}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/80 text-white flex items-center justify-center text-xs hover:bg-red-600"
                      >
                        <i className="fas fa-times"></i>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {uploadProgress !== null && (
                <div className="w-full bg-zinc-200 h-2 rounded-full overflow-hidden mb-3">
                  <div
                    className="bg-[#b45309] h-full transition-all duration-200"
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
              )}

              {postError && (
                <div className="text-xs font-semibold text-red-600 mb-2">{postError}</div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-zinc-200">
                <label className="cursor-pointer inline-flex items-center gap-2 text-xs font-bold text-zinc-700 hover:text-black">
                  <i className="fas fa-camera text-base text-[#b45309]"></i>
                  <span>Add Photos</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </label>

                <button
                  type="submit"
                  disabled={isPosting}
                  className="btn-primary text-xs py-2 px-5 font-bold"
                >
                  {isPosting ? (
                    <>
                      <i className="fas fa-spinner fa-spin"></i> Posting...
                    </>
                  ) : (
                    <>
                      <i className="fas fa-paper-plane"></i> Post to Crew
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : (
            <div className="p-4 bg-amber-50 border-2 border-amber-300 rounded-2xl flex items-center gap-3">
              <i className="fas fa-lock text-xl text-amber-600"></i>
              <div className="text-xs text-amber-900 leading-relaxed">
                <strong>You are browsing as a Public User.</strong> Viewing posts is open to all, but publishing posts, liking, and commenting require an authorized <strong>Member</strong> account. Activate your membership in your Profile!
              </div>
            </div>
          )
        ) : (
          <div className="p-4 bg-zinc-100 border-2 border-dashed border-zinc-400 rounded-2xl text-center">
            <p className="text-xs font-bold text-zinc-700 mb-2">
              Sign in to join the conversation and interact with the Cycle.exe community.
            </p>
          </div>
        )}
      </div>

      {/* Posts Feed */}
      {loading ? (
        <div className="text-center py-12">
          <i className="fas fa-spinner fa-spin text-3xl text-[#b45309]"></i>
          <p className="text-sm font-bold text-zinc-600 mt-2">Loading community feed...</p>
        </div>
      ) : posts.length === 0 ? (
        <div className="neo-card text-center py-12 text-zinc-500">
          <i className="fas fa-comment-slash text-4xl mb-3 text-zinc-400"></i>
          <p className="font-bold text-base">No community posts yet.</p>
          <p className="text-xs mt-1">Be the first crew member to share a ride update!</p>
        </div>
      ) : (
        posts.map((post) => {
          // If hidden and not admin, skip display
          if (post.isHidden && !isAdmin) return null;

          const isAuthor = user && user.uid === post.authorId;
          const isLiked = userLikes[post.id] || false;
          const comments = commentsMap[post.id] || [];

          return (
            <div key={post.id} className={`post-card ${post.isHidden ? 'opacity-60 bg-amber-50/50' : ''}`}>
              {post.isHidden && (
                <div className="mb-2 py-1 px-3 bg-red-100 text-red-800 text-xs font-bold rounded-full inline-flex items-center gap-1.5">
                  <i className="fas fa-eye-slash"></i> Post hidden by moderator
                </div>
              )}

              {/* Post Header */}
              <div className="post-header">
                <div className="post-author">
                  <div className="author-avatar">
                    {post.authorPhotoURL ? (
                      <img src={post.authorPhotoURL} alt={post.authorName} />
                    ) : (
                      post.authorName.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="author-meta">
                    <div className="author-name-row">
                      <span className="author-name">{post.authorName}</span>
                    </div>
                    <span className="post-time">
                      {new Date(post.createdAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>

                {/* Post Options Menu */}
                <div className="flex items-center gap-1">
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => handleToggleHidePost(post)}
                      title={post.isHidden ? 'Unhide post' : 'Hide post'}
                      className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 text-xs flex items-center justify-center text-zinc-700"
                    >
                      <i className={`fas ${post.isHidden ? 'fa-eye' : 'fa-eye-slash'}`}></i>
                    </button>
                  )}

                  {isAuthor && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingPost(post);
                        setEditContent(post.content);
                      }}
                      title="Edit post"
                      className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 text-xs flex items-center justify-center text-zinc-700"
                    >
                      <i className="fas fa-pencil-alt"></i>
                    </button>
                  )}

                  {(isAuthor || isSuperAdmin) && (
                    <button
                      type="button"
                      onClick={() => handleDeletePost(post)}
                      title="Delete post"
                      className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-red-100 hover:text-red-600 text-xs flex items-center justify-center text-zinc-700"
                    >
                      <i className="fas fa-trash-alt"></i>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      setReportTarget({
                        type: 'POST',
                        id: post.id,
                        excerpt: post.content,
                        authorId: post.authorId,
                      })
                    }
                    title="Report post"
                    className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 text-xs flex items-center justify-center text-zinc-700"
                  >
                    <i className="fas fa-flag"></i>
                  </button>
                </div>
              </div>

              {/* Post Content */}
              <div className="post-body">{post.content}</div>

              {/* Media Gallery */}
              {post.photoURLs && post.photoURLs.length > 0 && (
                <div className="post-media-grid">
                  {post.photoURLs.map((url, i) => (
                    <img key={i} src={url} alt="Post attached media" className="post-media-img" />
                  ))}
                </div>
              )}

              {/* Actions Row */}
              <div className="post-actions">
                <button
                  type="button"
                  onClick={() => handleToggleLike(post)}
                  className={`action-btn ${isLiked ? 'liked' : ''}`}
                >
                  <i className={`fas ${isLiked ? 'fa-heart' : 'fa-heart'}`}></i>
                  <span>{post.likesCount || 0}</span>
                </button>

                <button
                  type="button"
                  onClick={() => toggleComments(post.id)}
                  className="action-btn"
                >
                  <i className="fas fa-comment"></i>
                  <span>{post.commentsCount || 0}</span>
                </button>
              </div>

              {/* Expanded Comments */}
              {expandedComments[post.id] && (
                <div className="comments-container">
                  <div className="space-y-2 mb-3">
                    {comments.length === 0 ? (
                      <p className="text-xs text-zinc-500 italic py-2">No comments yet. Start the conversation!</p>
                    ) : (
                      comments.map((c) => (
                        <div key={c.id} className="comment-card">
                          <div className="comment-avatar">
                            {c.authorPhotoURL ? (
                              <img src={c.authorPhotoURL} alt={c.authorName} />
                            ) : (
                              c.authorName.charAt(0).toUpperCase()
                            )}
                          </div>
                          <div className="comment-content">
                            <div className="comment-header">
                              <span className="comment-author-name">{c.authorName}</span>
                              <div className="flex items-center gap-1.5">
                                <span className="comment-time">
                                  {new Date(c.createdAt).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>

                                {/* Only Author or Super Admin can delete */}
                                {(isSuperAdmin || (user && user.uid === c.authorId)) && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteComment(post.id, c)}
                                    title="Delete comment"
                                    className="text-zinc-400 hover:text-red-600 text-xs ml-1"
                                  >
                                    <i className="fas fa-times"></i>
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() =>
                                    setReportTarget({
                                      type: 'COMMENT',
                                      id: c.id,
                                      excerpt: c.text,
                                      authorId: c.authorId,
                                    })
                                  }
                                  title="Report comment"
                                  className="text-zinc-400 hover:text-red-600 text-xs ml-1"
                                >
                                  <i className="fas fa-flag"></i>
                                </button>
                              </div>
                            </div>
                            <div className="comment-text">{c.text}</div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Add comment box */}
                  {user ? (
                    isMember ? (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={commentInputs[post.id] || ''}
                          onChange={(e) =>
                            setCommentInputs((prev) => ({ ...prev, [post.id]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleAddComment(post.id);
                          }}
                          placeholder="Write a comment..."
                          className="neo-input text-xs py-2 flex-1"
                        />
                        <button
                          type="button"
                          onClick={() => handleAddComment(post.id)}
                          disabled={commentLoading[post.id]}
                          className="btn-primary text-xs py-2 px-3 font-bold"
                        >
                          {commentLoading[post.id] ? (
                            <i className="fas fa-spinner fa-spin"></i>
                          ) : (
                            <i className="fas fa-paper-plane"></i>
                          )}
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-amber-800 bg-amber-50 p-2.5 rounded-xl border border-amber-200">
                        Public users can view comments. Activate your membership in your Profile to participate in the conversation!
                      </p>
                    )
                  ) : (
                    <p className="text-xs text-zinc-500 italic">Sign in to leave a comment.</p>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}

      {/* Edit Post Modal */}
      {editingPost && (
        <div
          className="modal-overlay open"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingPost(null);
          }}
        >
          <div className="modal max-w-md">
            <button
              type="button"
              className="modal-close"
              onClick={() => setEditingPost(null)}
            >
              <i className="fas fa-times"></i>
            </button>
            <h3 className="text-lg font-bold mb-3">Edit Post</h3>
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={4}
              className="neo-input text-sm resize-none mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingPost(null)}
                className="btn-secondary text-xs py-2 px-4"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSavePostEdit}
                className="btn-primary text-xs py-2 px-4 font-bold"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report Modal */}
      <ReportModal target={reportTarget} onClose={() => setReportTarget(null)} />
    </div>
  );
};
