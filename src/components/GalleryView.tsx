import React, { useState } from 'react';
import { GalleryItem } from '../types';
import { galleryData } from '../data';

interface GalleryViewProps {
  onOpenLightbox: (index: number) => void;
}

export const GalleryView: React.FC<GalleryViewProps> = ({ onOpenLightbox }) => {
  const [photoErrors, setPhotoErrors] = useState<Record<number, boolean>>({});

  const handlePhotoError = (id: number) => {
    setPhotoErrors((prev) => ({ ...prev, [id]: true }));
  };

  return (
    <div>
      {/* Hero */}
      <div className="hero">
        <h1>
          <i className="fas fa-images"></i> Gallery
        </h1>
        <p>Moments from the road</p>
      </div>

      {/* Gallery Grid */}
      <div className="gallery-grid">
        {galleryData.map((item: GalleryItem) => {
          const hasError = photoErrors[item.id];

          return (
            <div
              key={item.id}
              className="gallery-item"
              onClick={() => onOpenLightbox(item.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenLightbox(item.id);
                }
              }}
            >
              <div className="gallery-photo">
                {!hasError ? (
                  <img
                    src={item.src}
                    alt={item.title}
                    onError={() => handlePhotoError(item.id)}
                  />
                ) : null}
                {hasError && (
                  <div className="ph-fallback" style={{ display: 'flex' }}>
                    <i className="fas fa-image"></i>
                    {item.fallbackName}
                  </div>
                )}
                <div className="zoom-hint">
                  <i className="fas fa-expand"></i>
                </div>
              </div>
              <div className="gallery-caption">
                <div className="gallery-title">
                  <i className={`fas ${item.icon}`}></i> {item.title}
                </div>
                <div className="gallery-meta">
                  {item.meta.map((m, idx) => (
                    <span key={idx}>
                      <i className={`fas ${m.icon}`}></i> {m.text}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
