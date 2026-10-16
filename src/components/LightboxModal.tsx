import React, { useState, useEffect } from 'react';
import { GalleryItem } from '../types';

interface LightboxModalProps {
  items: GalleryItem[];
  currentIndex: number | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export const LightboxModal: React.FC<LightboxModalProps> = ({
  items,
  currentIndex,
  onClose,
  onNavigate,
}) => {
  const [imgError, setImgError] = useState(false);

  const isOpen = currentIndex !== null && currentIndex >= 0 && currentIndex < items.length;
  const currentItem = isOpen ? items[currentIndex] : null;

  useEffect(() => {
    setImgError(false);
  }, [currentIndex]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        onNavigate((currentIndex - 1 + items.length) % items.length);
      } else if (e.key === 'ArrowRight') {
        onNavigate((currentIndex + 1) % items.length);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, currentIndex, items.length, onClose, onNavigate]);

  if (!isOpen || !currentItem) return null;

  return (
    <div
      className="lightbox open"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Image lightbox"
    >
      <button
        type="button"
        className="lightbox-close"
        onClick={onClose}
        aria-label="Close"
      >
        <i className="fas fa-times"></i>
      </button>

      <button
        type="button"
        className="lightbox-nav prev"
        onClick={(e) => {
          e.stopPropagation();
          onNavigate((currentIndex - 1 + items.length) % items.length);
        }}
        aria-label="Previous image"
      >
        <i className="fas fa-chevron-left"></i>
      </button>

      <button
        type="button"
        className="lightbox-nav next"
        onClick={(e) => {
          e.stopPropagation();
          onNavigate((currentIndex + 1) % items.length);
        }}
        aria-label="Next image"
      >
        <i className="fas fa-chevron-right"></i>
      </button>

      <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-img-wrap">
          {!imgError ? (
            <img
              src={currentItem.src}
              alt={currentItem.title}
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="lightbox-fallback" style={{ display: 'flex' }}>
              <i className="fas fa-image"></i>
              <span>{currentItem.src.split('/').pop()} not found</span>
            </div>
          )}
        </div>
        <div className="lightbox-caption">
          <h3>
            <i className={`fas ${currentItem.icon}`}></i> {currentItem.title}
          </h3>
          <p>
            {currentItem.meta.map((m, idx) => (
              <span key={idx}>
                <i className={`fas ${m.icon}`}></i> {m.text}
              </span>
            ))}
          </p>
        </div>
      </div>

      <div className="lightbox-counter">
        {currentIndex + 1} / {items.length}
      </div>
    </div>
  );
};
