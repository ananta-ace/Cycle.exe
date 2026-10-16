import React, { useState, useEffect } from 'react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { GalleryPhoto } from '../types';

interface GalleryViewProps {
  onOpenLightbox?: (index: number) => void;
}

export const GalleryView: React.FC<GalleryViewProps> = ({ onOpenLightbox }) => {
  const { isSuperAdmin, user, profile } = useAuth();
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [loading, setLoading] = useState(true);

  // Upload modal state (Super Admin exclusive)
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Active full view photo for lightbox
  const [activePhoto, setActivePhoto] = useState<GalleryPhoto | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'gallery'), orderBy('uploadedAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list: GalleryPhoto[] = [];
        snapshot.forEach((snap) => {
          list.push({ id: snap.id, ...(snap.data() as Omit<GalleryPhoto, 'id'>) });
        });
        setPhotos(list);
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching gallery:', err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0]) return;
    const file = e.target.files[0];
    if (!file.type.startsWith('image/')) {
      setUploadError('Only image files (JPEG, PNG, WebP) are allowed.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setUploadError('Image size must be under 8MB.');
      return;
    }
    setUploadError(null);
    setUploadFile(file);
    setFilePreview(URL.createObjectURL(file));
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) {
      alert('Only the Super Admin can upload photos to the official gallery.');
      return;
    }
    if (!uploadTitle.trim()) {
      setUploadError('Please provide a title for the photo.');
      return;
    }
    if (!uploadFile) {
      setUploadError('Please select an image file to upload.');
      return;
    }

    try {
      setUploading(true);
      setUploadError(null);
      let photoURL = '';

      // Upload to Storage or fallback to Base64
      try {
        const fileName = `${Date.now()}_${uploadFile.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        const storageRef = ref(storage, `gallery/${fileName}`);
        const uploadTask = uploadBytesResumable(storageRef, uploadFile);

        await new Promise<void>((resolve, reject) => {
          uploadTask.on(
            'state_changed',
            (snap) => {
              const progress = (snap.bytesTransferred / snap.totalBytes) * 100;
              setUploadProgress(Math.round(progress));
            },
            (err) => reject(err),
            async () => {
              photoURL = await getDownloadURL(uploadTask.snapshot.ref);
              resolve();
            }
          );
        });
      } catch {
        // Fallback to inline Data URL
        photoURL = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(uploadFile);
        });
      }

      const photoData: Omit<GalleryPhoto, 'id'> = {
        title: uploadTitle.trim(),
        description: uploadDescription.trim(),
        photoURL,
        uploadedBy: user?.uid || 'super-admin',
        uploadedByName: profile?.displayName || 'Super Admin',
        uploadedAt: new Date().toISOString(),
      };

      await addDoc(collection(db, 'gallery'), photoData);

      // Reset form
      setUploadTitle('');
      setUploadDescription('');
      setUploadFile(null);
      setFilePreview(null);
      setUploadProgress(null);
      setIsUploadOpen(false);
    } catch (err: unknown) {
      console.error('Error uploading photo:', err);
      setUploadError(err instanceof Error ? err.message : 'Failed to upload photo');
    } finally {
      setUploading(false);
    }
  };

  const handleDeletePhoto = async (photo: GalleryPhoto, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isSuperAdmin) {
      alert('Only the Super Admin can delete gallery photos.');
      return;
    }
    if (!confirm(`Are you sure you want to permanently delete "${photo.title}"?`)) return;

    try {
      await deleteDoc(doc(db, 'gallery', photo.id));
    } catch (err) {
      console.error('Error deleting photo:', err);
      alert('Failed to delete photo.');
    }
  };

  return (
    <div>
      {/* Hero */}
      <div className="hero mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#f9c74f]/30 border border-[#f9c74f] text-xs font-black text-amber-950 mb-3">
          <i className="fas fa-camera text-[#f9c74f]"></i> Official Community Gallery
        </div>
        <h1 className="text-3xl md:text-4xl font-black text-zinc-900 tracking-tight">
          <i className="fas fa-images text-[#f9c74f]"></i> Moments From The Road
        </h1>
        <p className="text-sm md:text-base text-zinc-600 max-w-xl mx-auto mt-2">
          Curated cycling moments, rides, and scenic routes managed exclusively by the Super Admin.
        </p>

        {/* Super Admin Upload Action */}
        {isSuperAdmin && (
          <div className="mt-5">
            <button
              type="button"
              onClick={() => setIsUploadOpen(true)}
              className="btn-primary py-2.5 px-5 text-xs font-black inline-flex items-center gap-2 shadow-[0_4px_0_#1e1e1e]"
            >
              <i className="fas fa-cloud-upload-alt text-base"></i> Upload Photo to Gallery (Super Admin)
            </button>
          </div>
        )}
      </div>

      {/* Gallery Grid */}
      {loading ? (
        <div className="py-16 text-center text-zinc-500 font-bold text-sm">
          <i className="fas fa-spinner fa-spin text-2xl mb-3 block"></i> Loading official gallery...
        </div>
      ) : photos.length === 0 ? (
        <div className="max-w-md mx-auto my-12 p-8 text-center bg-white rounded-3xl border-3 border-[#1e1e1e] shadow-[0_6px_0_#1e1e1e]">
          <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-zinc-100 border-2 border-zinc-300 flex items-center justify-center text-2xl text-zinc-400">
            <i className="fas fa-images"></i>
          </div>
          <h3 className="font-black text-lg text-zinc-800 mb-1">Gallery is Ready</h3>
          <p className="text-xs text-zinc-500 leading-relaxed mb-4">
            The previous static mock gallery photos have been removed. The Super Admin can now upload authentic photos from our rides with titles and descriptions!
          </p>
          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => setIsUploadOpen(true)}
              className="btn-primary py-2 px-4 text-xs font-bold"
            >
              <i className="fas fa-plus mr-1"></i> Add First Photo
            </button>
          )}
        </div>
      ) : (
        <div className="gallery-grid">
          {photos.map((item, index) => (
            <div
              key={item.id}
              className="gallery-item group relative"
              onClick={() => {
                setActivePhoto(item);
                onOpenLightbox?.(index);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setActivePhoto(item);
                  onOpenLightbox?.(index);
                }
              }}
            >
              <div className="gallery-photo">
                <img
                  src={item.photoURL}
                  alt={item.title}
                  loading="lazy"
                  className="w-full h-full object-cover transition duration-300 group-hover:scale-105"
                />
                <div className="zoom-hint">
                  <i className="fas fa-expand"></i>
                </div>

                {isSuperAdmin && (
                  <button
                    type="button"
                    onClick={(e) => handleDeletePhoto(item, e)}
                    className="absolute top-2 right-2 bg-red-600 hover:bg-red-700 text-white p-2 rounded-xl text-xs font-bold shadow-lg transition opacity-0 group-hover:opacity-100 z-10"
                    title="Delete photo (Super Admin)"
                  >
                    <i className="fas fa-trash-alt"></i>
                  </button>
                )}
              </div>

              <div className="gallery-caption p-3.5">
                <div className="gallery-title font-black text-sm text-zinc-900 truncate">
                  <i className="fas fa-camera text-[#f9c74f] mr-1.5"></i> {item.title}
                </div>
                {item.description && (
                  <p className="text-xs text-zinc-600 mt-1 line-clamp-2 leading-snug">
                    {item.description}
                  </p>
                )}
                <div className="gallery-meta mt-2 pt-2 border-t border-zinc-200/80 flex items-center justify-between text-[11px] text-zinc-400 font-semibold">
                  <span>
                    <i className="fas fa-calendar-alt text-zinc-500 mr-1"></i>
                    {new Date(item.uploadedAt).toLocaleDateString()}
                  </span>
                  <span className="text-amber-800 font-bold">
                    <i className="fas fa-expand text-[10px] mr-1"></i> View Full
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Larger View Modal (Lightbox) */}
      {activePhoto && (
        <div
          className="modal-overlay open"
          onClick={() => setActivePhoto(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="modal max-w-4xl p-4 border-4 border-[#1e1e1e] bg-white rounded-3xl shadow-[0_12px_0_#1e1e1e]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="modal-close"
              onClick={() => setActivePhoto(null)}
              aria-label="Close"
            >
              <i className="fas fa-times"></i>
            </button>

            <div className="max-h-[70vh] rounded-2xl overflow-hidden bg-black flex items-center justify-center border-2 border-zinc-900">
              <img
                src={activePhoto.photoURL}
                alt={activePhoto.title}
                className="max-h-[70vh] w-auto max-w-full object-contain"
              />
            </div>

            <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-black text-zinc-900">{activePhoto.title}</h3>
                {activePhoto.description && (
                  <p className="text-xs text-zinc-600 mt-1 max-w-xl">{activePhoto.description}</p>
                )}
              </div>
              <div className="text-xs font-bold text-zinc-500 shrink-0">
                Uploaded {new Date(activePhoto.uploadedAt).toLocaleDateString()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Super Admin Upload Modal */}
      {isUploadOpen && (
        <div className="modal-overlay open" role="dialog" aria-modal="true">
          <div className="modal max-w-md p-6 border-3 border-[#1e1e1e] bg-white rounded-3xl shadow-[0_10px_0_#1e1e1e]">
            <button
              type="button"
              className="modal-close"
              onClick={() => setIsUploadOpen(false)}
              aria-label="Close"
            >
              <i className="fas fa-times"></i>
            </button>

            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-[#1e1e1e] text-[#f9c74f] flex items-center justify-center text-lg border border-[#1e1e1e]">
                <i className="fas fa-cloud-upload-alt"></i>
              </div>
              <div>
                <h3 className="font-black text-lg text-zinc-900">Add Gallery Photo</h3>
                <p className="text-xs text-zinc-500">Super Admin Photo Uploader</p>
              </div>
            </div>

            {uploadError && (
              <div className="mb-4 p-3 bg-red-50 border-2 border-red-500 rounded-2xl text-xs font-semibold text-red-700">
                {uploadError}
              </div>
            )}

            <form onSubmit={handleUploadSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-black uppercase tracking-wider mb-1 text-zinc-700">
                  Photo Title *
                </label>
                <input
                  type="text"
                  required
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  placeholder="e.g. Morning Sprint at Hatirjheel"
                  className="neo-input text-sm w-full p-2.5 font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-black uppercase tracking-wider mb-1 text-zinc-700">
                  Optional Description
                </label>
                <textarea
                  rows={2}
                  value={uploadDescription}
                  onChange={(e) => setUploadDescription(e.target.value)}
                  placeholder="Tell the community about this ride, route, or moment..."
                  className="neo-input text-sm w-full p-2.5 resize-none"
                  maxLength={500}
                ></textarea>
              </div>

              <div>
                <label className="block text-xs font-black uppercase tracking-wider mb-1 text-zinc-700">
                  Select Image File *
                </label>
                <input
                  type="file"
                  required
                  accept="image/*"
                  onChange={handleFileChange}
                  className="block w-full text-xs text-zinc-600 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-2 file:border-[#1e1e1e] file:text-xs file:font-black file:bg-[#f9c74f] file:text-black hover:file:bg-[#e0b040] cursor-pointer"
                />
              </div>

              {filePreview && (
                <div className="w-full h-36 rounded-2xl overflow-hidden border-2 border-[#1e1e1e] shadow-[0_2px_0_#1e1e1e]">
                  <img src={filePreview} alt="Preview" className="w-full h-full object-cover" />
                </div>
              )}

              {uploadProgress !== null && (
                <div>
                  <div className="flex justify-between text-xs font-bold mb-1">
                    <span>Uploading...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full h-2 bg-zinc-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-200"
                      style={{ width: `${uploadProgress}%` }}
                    ></div>
                  </div>
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsUploadOpen(false)}
                  className="btn-secondary py-2 px-4 text-xs font-bold"
                  disabled={uploading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="btn-primary py-2 px-5 text-xs font-black flex items-center gap-1.5"
                >
                  {uploading ? (
                    <>
                      <i className="fas fa-spinner fa-spin"></i> Uploading...
                    </>
                  ) : (
                    <>
                      <i className="fas fa-check"></i> Publish Photo
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
