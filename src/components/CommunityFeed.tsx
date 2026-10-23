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
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { Post, PostComment } from '../types';
import { ReportModal } from './ReportModal';
import { ApplicationModal } from './ApplicationModal';
import { uploadImage } from '../utils/imageUpload';

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

  // Likes state: map postId -> boolean
  const [userLikes, setUserLikes] = useState<Record<string, boolean>>({});

  // Active comments state: map postId -> list of comments
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({});
  const [commentsMap, setCommentsMap] = useState<Record<string, PostComment[]>>({});
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  const [commentLoading, setCommentLoading] = useState<Record<string, boolean>>({});

  // Nested reply state: map commentId -> boolean or text
  const [replyingToComment, setReplyingToComment] = useState<string | null>(null);
  const [replyInputText, setReplyInputText] = useState('');
  const [replyLoading, setReplyLoading] = useState(false);

  // Edit comment state
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editCommentText, setEditCommentText] = useState('');

  // Reporting modal target
  const [reportTarget, setReportTarget] = useState<{
    type: 'COMMENT' | 'POST';
    id: string;
    excerpt: string;
    authorId?: string;
  } | null>(null);

  // Edit post state
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [editContent, setEditContent] = useState('');

  // Apply modal trigger
  const [isApplyModalOpen, setIsApplyModalOpen] = useState(false);

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
      const unsub = onSnapshot(
        likeDocRef,
        (snap) => {
          setUserLikes((prev) => ({ ...prev, [p.id]: snap.exists() }));
        },
        () => {
          // Graceful fallback for offline / restricted
        }
      );
      unsubs.push(unsub);
    });

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [posts, user]);

  // Handle image selection
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
      setPostError('Only verified Admin Members and Admins can publish posts.');
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

      if (selectedFiles.length > 0) {
        for (let i = 0; i < selectedFiles.length; i++) {
          const file = selectedFiles[i];
          try {
            setUploadProgress(Math.round(((i + 1) / selectedFiles.length) * 80));
            const url = await uploadImage(file);
            uploadedUrls.push(url);
          } catch (fileErr) {
            console.error('File upload error:', fileErr);
          }
        }
      }

      const postData: Omit<Post, 'id'> = {
        authorId: user.uid,
        authorName: profile?.displayName || user.displayName || 'Rider',
        authorPhotoURL: profile?.photoURL || user.photoURL || '',
        authorTitle: profile?.customTitle || (isSuperAdmin ? 'Super Admin' : isAdmin ? 'Admin' : 'Admin Member'),
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
      alert('Please sign in to like posts.');
      return;
    }
    if (!isMember) {
      alert('Public users cannot like posts. Apply for Admin Membership to join community interactions!');
      return;
    }

    const likeDocRef = doc(db, 'posts', post.id, 'likes', user.uid);
    const postRef = doc(db, 'posts', post.id);
    const isCurrentlyLiked = userLikes[post.id];

    try {
      if (isCurrentlyLiked) {
        await deleteDoc(likeDocRef);
        await updateDoc(postRef, {
          likesCount: Math.max(0, post.likesCount - 1),
        });
      } else {
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

  // Toggle comments expand and listen
  const toggleComments = async (postId: string) => {
    const isExpanded = !expandedComments[postId];
    setExpandedComments((prev) => ({ ...prev, [postId]: isExpanded }));

    if (isExpanded && !commentsMap[postId]) {
      const q = query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt', 'asc'));
      const snap = await getDocs(q);
      const list: PostComment[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<PostComment, 'id'>) }));
      setCommentsMap((prev) => ({ ...prev, [postId]: list }));

      onSnapshot(
        q,
        (snapshot) => {
          const liveList: PostComment[] = [];
          snapshot.forEach((d) => liveList.push({ id: d.id, ...(d.data() as Omit<PostComment, 'id'>) }));
          setCommentsMap((prev) => ({ ...prev, [postId]: liveList }));
        },
        () => {
          // Graceful non-blocking
        }
      );
    }
  };

  // Add top-level comment
  const handleAddComment = async (postId: string) => {
    if (!user) {
      alert('Please sign in to comment.');
      return;
    }
    if (!isMember) {
      alert('Public users cannot comment. Apply for Admin Membership to participate!');
      return;
    }

    const text = commentInputs[postId]?.trim();
    if (!text) return;

    try {
      setCommentLoading((prev) => ({ ...prev, [postId]: true }));

      const commentData: Omit<PostComment, 'id'> = {
        postId,
        parentId: null,
        authorId: user.uid,
        authorName: profile?.displayName || user.displayName || 'Rider',
        authorPhotoURL: profile?.photoURL || user.photoURL || '',
        text,
        replyCount: 0,
        isReported: false,
        isDeleted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await addDoc(collection(db, 'posts', postId, 'comments'), commentData);

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

  // Add nested reply to a comment
  const handleAddReply = async (postId: string, parentComment: PostComment) => {
    if (!user) {
      alert('Please sign in to reply.');
      return;
    }
    if (!isMember) {
      alert('Only approved Admin Members and Admins can reply.');
      return;
    }
    if (!replyInputText.trim()) return;

    try {
      setReplyLoading(true);

      const replyData: Omit<PostComment, 'id'> = {
        postId,
        parentId: parentComment.id,
        replyToAuthor: parentComment.authorName,
        authorId: user.uid,
        authorName: profile?.displayName || user.displayName || 'Rider',
        authorPhotoURL: profile?.photoURL || user.photoURL || '',
        text: replyInputText.trim(),
        isReported: false,
        isDeleted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await addDoc(collection(db, 'posts', postId, 'comments'), replyData);

      // Increment reply count on parent comment
      await updateDoc(doc(db, 'posts', postId, 'comments', parentComment.id), {
        replyCount: (parentComment.replyCount || 0) + 1,
        updatedAt: new Date().toISOString(),
      });

      // Increment comments count on post
      const post = posts.find((p) => p.id === postId);
      if (post) {
        await updateDoc(doc(db, 'posts', postId), {
          commentsCount: post.commentsCount + 1,
        });
      }

      setReplyInputText('');
      setReplyingToComment(null);
    } catch (err) {
      console.error('Error adding reply:', err);
    } finally {
      setReplyLoading(false);
    }
  };

  // Delete Comment / Reply
  const handleDeleteComment = async (postId: string, comment: PostComment) => {
    const canDelete = isSuperAdmin || (user && user.uid === comment.authorId);
    if (!canDelete) {
      alert('Permission denied. Only the author or Super Admin can delete comments.');
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

  // Edit comment
  const handleSaveEditComment = async (postId: string, commentId: string) => {
    if (!editCommentText.trim()) return;
    try {
      await updateDoc(doc(db, 'posts', postId, 'comments', commentId), {
        text: editCommentText.trim(),
        updatedAt: new Date().toISOString(),
      });
      setEditingCommentId(null);
    } catch (err) {
      console.error('Error editing comment:', err);
    }
  };

  // Delete Post
  const handleDeletePost = async (post: Post) => {
    const canDelete = isSuperAdmin || (user && user.uid === post.authorId);
    if (!canDelete) {
      alert('Permission denied. You can only delete your own posts.');
      return;
    }

    if (!confirm('Are you sure you want to delete this post?')) return;

    try {
      await deleteDoc(doc(db, 'posts', post.id));
    } catch (err) {
      console.error('Delete post error:', err);
    }
  };

  // Save edited post
  const handleSaveEditPost = async () => {
    if (!editingPost || !editContent.trim()) return;
    try {
      await updateDoc(doc(db, 'posts', editingPost.id), {
        content: editContent.trim(),
        updatedAt: new Date().toISOString(),
      });
      setEditingPost(null);
    } catch (err) {
      console.error('Update post error:', err);
    }
  };

  return (
    <div className="max-w-4xl xl:max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="hero text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#f9c74f]/30 border border-[#f9c74f] text-xs font-black text-amber-950 mb-3">
          <i className="fas fa-satellite-dish text-[#f9c74f]"></i> Live Rider Stream
        </div>
        <h1 className="text-3xl md:text-5xl font-black text-zinc-900 tracking-tight">
          <i className="fas fa-comments text-[#f9c74f]"></i> Community Feed
        </h1>
        <p className="text-base text-zinc-600 max-w-2xl mx-auto mt-2 leading-relaxed">
          Ride logs, route updates, gear discussions, and photos shared by our approved Admin Members and team.
        </p>
      </div>

      {/* Permission Notices */}
      {!user ? (
        <div className="p-6 bg-white border-3 border-[#1e1e1e] rounded-3xl shadow-[0_5px_0_#1e1e1e] flex items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <i className="fas fa-info-circle text-amber-500 text-3xl"></i>
            <div>
              <p className="font-black text-base text-zinc-900">Viewing as Public Guest</p>
              <p className="text-xs sm:text-sm text-zinc-500 mt-0.5">
                Sign in to view user profiles, explore missions, or apply for Admin Membership!
              </p>
            </div>
          </div>
        </div>
      ) : !isMember ? (
        <div className="p-6 bg-amber-50 border-3 border-amber-400 rounded-3xl shadow-[0_5px_0_#1e1e1e] flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[#1e1e1e] text-[#f9c74f] flex items-center justify-center text-xl border border-[#1e1e1e] shrink-0">
              <i className="fas fa-lock"></i>
            </div>
            <div>
              <p className="font-black text-base text-amber-950">
                Posting is reserved for Approved Admin Members
              </p>
              <p className="text-xs sm:text-sm text-amber-900/80 mt-0.5">
                Normal accounts can view posts and rate leaders. Submit an application to unlock posting, liking, and commenting!
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsApplyModalOpen(true)}
            className="btn-primary py-2.5 px-5 text-xs font-black shrink-0 whitespace-nowrap"
          >
            <i className="fas fa-paper-plane mr-1.5"></i> Apply for Admin Member
          </button>
        </div>
      ) : null}

      {/* Post Creator Box (For Approved Admin Members, Admins, Super Admin) */}
      {isMember && (
        <div className="bg-white p-6 sm:p-8 rounded-3xl border-3 border-[#1e1e1e] shadow-[0_6px_0_#1e1e1e]">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-full bg-zinc-200 border-2 border-zinc-900 overflow-hidden flex items-center justify-center font-bold text-base shrink-0">
              {profile?.photoURL ? (
                <img src={profile.photoURL} alt="" className="w-full h-full object-cover" />
              ) : (
                profile?.displayName?.charAt(0).toUpperCase() || 'R'
              )}
            </div>
            <div>
              <span className="font-black text-sm text-zinc-900 block leading-tight">
                {profile?.displayName || 'Cyclist'}
              </span>
              <span className="text-[11px] font-bold text-amber-800 bg-[#f9c74f]/30 px-2 py-0.5 rounded-full inline-block border border-[#f9c74f]/50">
                {profile?.customTitle || 'Admin Member'}
              </span>
            </div>
          </div>

          <form onSubmit={handleCreatePost}>
            <textarea
              rows={3}
              value={newPostText}
              onChange={(e) => setNewPostText(e.target.value)}
              placeholder="What's happening on your ride? Share a route update, sprint challenge, or tip..."
              className="neo-input text-sm w-full p-3 resize-none mb-3"
            ></textarea>

            {/* Selected File Previews */}
            {filePreviews.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                {filePreviews.map((url, idx) => (
                  <div key={idx} className="relative rounded-2xl overflow-hidden border-2 border-zinc-900 h-24">
                    <img src={url} alt="" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      className="absolute top-1 right-1 bg-black/70 hover:bg-black text-white w-5 h-5 rounded-full flex items-center justify-center text-[10px]"
                    >
                      <i className="fas fa-times"></i>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {uploadProgress !== null && (
              <div className="mb-3">
                <div className="w-full h-2 bg-zinc-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-200"
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
              </div>
            )}

            {postError && (
              <div className="mb-3 p-2.5 bg-red-50 border-2 border-red-500 rounded-xl text-xs font-semibold text-red-700">
                {postError}
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-zinc-100">
              <label className="cursor-pointer text-xs font-bold text-zinc-600 hover:text-black flex items-center gap-1.5 p-2 rounded-xl hover:bg-zinc-100 transition">
                <i className="fas fa-image text-emerald-600 text-sm"></i>
                <span>Add Photos (Max 4)</span>
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </label>

              <button
                type="submit"
                disabled={isPosting || (!newPostText.trim() && selectedFiles.length === 0)}
                className="btn-primary py-2 px-5 text-xs font-black flex items-center gap-2"
              >
                {isPosting ? (
                  <>
                    <i className="fas fa-spinner fa-spin"></i> Publishing...
                  </>
                ) : (
                  <>
                    <i className="fas fa-paper-plane"></i> Publish Post
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Feed List */}
      {loading ? (
        <div className="py-12 text-center text-zinc-500 font-bold text-sm">
          <i className="fas fa-spinner fa-spin text-2xl mb-2 block"></i> Loading community feed...
        </div>
      ) : posts.length === 0 ? (
        <div className="p-8 text-center bg-white rounded-3xl border-3 border-[#1e1e1e] shadow-[0_5px_0_#1e1e1e]">
          <i className="fas fa-bicycle text-4xl text-zinc-300 mb-2 block"></i>
          <h3 className="font-black text-lg text-zinc-800">No Posts Yet</h3>
          <p className="text-xs text-zinc-500 mt-1">
            Be the first Admin Member to publish a ride update to the feed!
          </p>
        </div>
      ) : (
        <div className="space-y-7">
          {posts.map((post) => {
            const isAuthor = user && user.uid === post.authorId;
            const canModerate = isSuperAdmin || isAdmin;
            const isLiked = !!userLikes[post.id];
            const isCommentsOpen = !!expandedComments[post.id];
            const postComments = commentsMap[post.id] || [];

            // Group comments into top-level and nested replies
            const topLevelComments = postComments.filter((c) => !c.parentId);
            const repliesByParentId = postComments.reduce<Record<string, PostComment[]>>((acc, c) => {
              if (c.parentId) {
                if (!acc[c.parentId]) acc[c.parentId] = [];
                acc[c.parentId].push(c);
              }
              return acc;
            }, {});

            return (
              <div
                key={post.id}
                className="bg-white rounded-3xl border-3 border-[#1e1e1e] p-6 sm:p-8 shadow-[0_6px_0_#1e1e1e] transition"
              >
                {/* Author Info */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-zinc-200 border-2 border-zinc-900 overflow-hidden flex items-center justify-center font-bold text-sm shrink-0">
                      {post.authorPhotoURL ? (
                        <img src={post.authorPhotoURL} alt="" className="w-full h-full object-cover" />
                      ) : (
                        post.authorName.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-black text-sm text-zinc-900">{post.authorName}</span>
                        {post.authorTitle && (
                          <span className="text-[10px] font-bold text-amber-900 bg-[#f9c74f]/30 px-2 py-0.5 rounded-full border border-[#f9c74f]/50">
                            {post.authorTitle}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-zinc-400 font-medium">
                        {new Date(post.createdAt).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>

                  {/* Actions Dropdown / buttons */}
                  <div className="flex items-center gap-2">
                    {user && !isAuthor && (
                      <button
                        type="button"
                        onClick={() =>
                          setReportTarget({
                            type: 'POST',
                            id: post.id,
                            excerpt: post.content.substring(0, 100),
                            authorId: post.authorId,
                          })
                        }
                        className="text-zinc-400 hover:text-amber-600 text-xs p-1"
                        title="Report post"
                      >
                        <i className="fas fa-flag"></i>
                      </button>
                    )}
                    {isAuthor && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingPost(post);
                          setEditContent(post.content);
                        }}
                        className="text-zinc-400 hover:text-black text-xs p-1"
                        title="Edit post"
                      >
                        <i className="fas fa-pencil-alt"></i>
                      </button>
                    )}
                    {(isAuthor || canModerate) && (
                      <button
                        type="button"
                        onClick={() => handleDeletePost(post)}
                        className="text-zinc-400 hover:text-red-600 text-xs p-1"
                        title="Delete post"
                      >
                        <i className="fas fa-trash-alt"></i>
                      </button>
                    )}
                  </div>
                </div>

                {/* Post Content */}
                <p className="text-sm text-zinc-800 whitespace-pre-wrap leading-relaxed mb-3">
                  {post.content}
                </p>

                {/* Attached Photos */}
                {post.photoURLs && post.photoURLs.length > 0 && (
                  <div
                    className={`grid gap-2 mb-3 rounded-2xl overflow-hidden border-2 border-zinc-900 ${
                      post.photoURLs.length === 1
                        ? 'grid-cols-1'
                        : post.photoURLs.length === 2
                        ? 'grid-cols-2'
                        : 'grid-cols-2 sm:grid-cols-3'
                    }`}
                  >
                    {post.photoURLs.map((imgUrl, i) => (
                      <div key={i} className="max-h-72 bg-black flex items-center justify-center">
                        <img
                          src={imgUrl}
                          alt="Post photo"
                          className="w-full h-full object-cover max-h-72 cursor-pointer hover:opacity-95"
                          onClick={() => window.open(imgUrl, '_blank')}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* Bottom Bar: Likes & Comments */}
                <div className="flex items-center justify-between pt-3 border-t border-zinc-100 text-xs font-bold text-zinc-600">
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => handleToggleLike(post)}
                      className={`flex items-center gap-1.5 transition ${
                        isLiked ? 'text-red-600' : 'hover:text-red-600'
                      }`}
                    >
                      <i className={`fas fa-heart ${isLiked ? 'scale-110' : ''}`}></i>
                      <span>{post.likesCount} {post.likesCount === 1 ? 'Like' : 'Likes'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleComments(post.id)}
                      className="flex items-center gap-1.5 hover:text-black transition"
                    >
                      <i className="fas fa-comment-dots"></i>
                      <span>{post.commentsCount} {post.commentsCount === 1 ? 'Comment' : 'Comments'}</span>
                    </button>
                  </div>
                </div>

                {/* Expanded Threaded Comments Section */}
                {isCommentsOpen && (
                  <div className="mt-4 pt-3 border-t border-zinc-200 space-y-3">
                    {/* Top Level Add Comment */}
                    {isMember ? (
                      <div className="flex items-center gap-2">
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
                          className="neo-input text-xs flex-1 p-2.5"
                        />
                        <button
                          type="button"
                          onClick={() => handleAddComment(post.id)}
                          disabled={commentLoading[post.id] || !commentInputs[post.id]?.trim()}
                          className="btn-primary py-2 px-3 text-xs font-bold"
                        >
                          <i className="fas fa-paper-plane"></i>
                        </button>
                      </div>
                    ) : (
                      <div className="p-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-[11px] text-zinc-500 text-center font-semibold">
                        Sign in as an approved Admin Member to join this discussion.
                      </div>
                    )}

                    {/* Comments List */}
                    <div className="space-y-3 pt-1">
                      {topLevelComments.length === 0 ? (
                        <p className="text-[11px] text-zinc-400 italic text-center py-2">
                          No comments yet. Start the conversation!
                        </p>
                      ) : (
                        topLevelComments.map((comment) => {
                          const isCommentAuthor = user && user.uid === comment.authorId;
                          const replies = repliesByParentId[comment.id] || [];
                          const isReplying = replyingToComment === comment.id;
                          const isEditing = editingCommentId === comment.id;

                          return (
                            <div key={comment.id} className="space-y-2">
                              {/* Top-level comment item */}
                              <div className="bg-zinc-50 p-3 rounded-2xl border border-zinc-200 flex items-start gap-2.5">
                                <div className="w-7 h-7 rounded-full bg-zinc-200 border border-zinc-400 overflow-hidden flex items-center justify-center font-bold text-xs shrink-0">
                                  {comment.authorPhotoURL ? (
                                    <img
                                      src={comment.authorPhotoURL}
                                      alt=""
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    comment.authorName.charAt(0).toUpperCase()
                                  )}
                                </div>

                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-1 mb-0.5">
                                    <span className="font-black text-xs text-zinc-900">
                                      {comment.authorName}
                                    </span>
                                    <span className="text-[10px] text-zinc-400">
                                      {new Date(comment.createdAt).toLocaleTimeString([], {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })}
                                    </span>
                                  </div>

                                  {isEditing ? (
                                    <div className="mt-1 flex gap-2">
                                      <input
                                        type="text"
                                        value={editCommentText}
                                        onChange={(e) => setEditCommentText(e.target.value)}
                                        className="neo-input text-xs flex-1 p-1.5"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => handleSaveEditComment(post.id, comment.id)}
                                        className="btn-primary text-[10px] px-2 py-1 font-bold"
                                      >
                                        Save
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditingCommentId(null)}
                                        className="btn-secondary text-[10px] px-2 py-1 font-bold"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <p className="text-xs text-zinc-800 leading-snug break-words">
                                      {comment.text}
                                    </p>
                                  )}

                                  {/* Comment Footer: Reply button & Delete */}
                                  <div className="flex items-center gap-3 mt-1.5 text-[10px] font-bold text-zinc-500">
                                    {isMember && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setReplyingToComment(isReplying ? null : comment.id);
                                          setReplyInputText('');
                                        }}
                                        className="hover:text-black flex items-center gap-1"
                                      >
                                        <i className="fas fa-reply"></i>
                                        <span>Reply</span>
                                      </button>
                                    )}

                                    {isCommentAuthor && !isEditing && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingCommentId(comment.id);
                                          setEditCommentText(comment.text);
                                        }}
                                        className="hover:text-black"
                                      >
                                        Edit
                                      </button>
                                    )}

                                    {(isCommentAuthor || canModerate) && (
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteComment(post.id, comment)}
                                        className="hover:text-red-600"
                                      >
                                        Delete
                                      </button>
                                    )}

                                    {user && !isCommentAuthor && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setReportTarget({
                                            type: 'COMMENT',
                                            id: comment.id,
                                            excerpt: comment.text.substring(0, 80),
                                            authorId: comment.authorId,
                                          })
                                        }
                                        className="hover:text-amber-600"
                                      >
                                        Report
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Nested Inline Reply Box */}
                              {isReplying && (
                                <div className="ml-8 pl-3 border-l-2 border-[#f9c74f] flex items-center gap-2 pt-1 animate-in fade-in">
                                  <input
                                    type="text"
                                    value={replyInputText}
                                    onChange={(e) => setReplyInputText(e.target.value)}
                                    placeholder={`Reply to ${comment.authorName}...`}
                                    className="neo-input text-xs flex-1 p-2"
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleAddReply(post.id, comment);
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleAddReply(post.id, comment)}
                                    disabled={replyLoading || !replyInputText.trim()}
                                    className="btn-primary py-1.5 px-3 text-xs font-bold"
                                  >
                                    {replyLoading ? <i className="fas fa-spinner fa-spin"></i> : 'Reply'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setReplyingToComment(null)}
                                    className="text-xs text-zinc-400 hover:text-black p-1"
                                  >
                                    <i className="fas fa-times"></i>
                                  </button>
                                </div>
                              )}

                              {/* Visually Nested Replies */}
                              {replies.length > 0 && (
                                <div className="ml-8 space-y-2 border-l-2 border-zinc-200 pl-3">
                                  {replies.map((reply) => {
                                    const isReplyAuthor = user && user.uid === reply.authorId;
                                    return (
                                      <div
                                        key={reply.id}
                                        className="bg-zinc-100/70 p-2.5 rounded-xl border border-zinc-200 flex items-start gap-2"
                                      >
                                        <div className="w-5 h-5 rounded-full bg-zinc-300 border border-zinc-400 overflow-hidden flex items-center justify-center font-bold text-[10px] shrink-0">
                                          {reply.authorPhotoURL ? (
                                            <img
                                              src={reply.authorPhotoURL}
                                              alt=""
                                              className="w-full h-full object-cover"
                                            />
                                          ) : (
                                            reply.authorName.charAt(0).toUpperCase()
                                          )}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center justify-between gap-1 mb-0.5">
                                            <span className="font-bold text-[11px] text-zinc-900">
                                              {reply.authorName}
                                            </span>
                                            <span className="text-[9px] text-zinc-400">
                                              {new Date(reply.createdAt).toLocaleTimeString([], {
                                                hour: '2-digit',
                                                minute: '2-digit',
                                              })}
                                            </span>
                                          </div>
                                          <p className="text-xs text-zinc-800 break-words leading-tight">
                                            {reply.replyToAuthor && (
                                              <span className="text-amber-800 font-bold mr-1">
                                                @{reply.replyToAuthor}
                                              </span>
                                            )}
                                            {reply.text}
                                          </p>

                                          <div className="flex items-center gap-2 mt-1 text-[9px] font-bold text-zinc-500">
                                            {(isReplyAuthor || canModerate) && (
                                              <button
                                                type="button"
                                                onClick={() => handleDeleteComment(post.id, reply)}
                                                className="hover:text-red-600"
                                              >
                                                Delete
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Edit Post Modal */}
      {editingPost && (
        <div className="modal-overlay open" role="dialog" aria-modal="true">
          <div className="modal max-w-lg p-6 border-3 border-[#1e1e1e] bg-white rounded-3xl shadow-[0_10px_0_#1e1e1e]">
            <h3 className="font-black text-lg mb-3">Edit Post</h3>
            <textarea
              rows={4}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="neo-input text-sm w-full p-3 mb-4"
            ></textarea>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingPost(null)}
                className="btn-secondary py-2 px-4 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEditPost}
                className="btn-primary py-2 px-5 text-xs font-black"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report Modal */}
      <ReportModal target={reportTarget} onClose={() => setReportTarget(null)} />

      {/* Membership Application Modal */}
      <ApplicationModal
        isOpen={isApplyModalOpen}
        onClose={() => setIsApplyModalOpen(false)}
        onOpenAuth={() => {}}
      />
    </div>
  );
};
