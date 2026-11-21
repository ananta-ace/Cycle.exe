import React, { useState } from 'react';
import { usePWAInstall, useOnlineStatus } from '../hooks/usePWAInstall';

const EXE_DOWNLOAD_PATH = './downloads/cycle.exe';

interface DesktopAppButtonProps {
  onOpenModal: () => void;
}

export const DesktopAppButton: React.FC<DesktopAppButtonProps> = ({ onOpenModal }) => {
  const { isDesktopShell } = usePWAInstall();

  // Hide download button only when already running inside the Cycle.exe desktop shell
  if (isDesktopShell) {
    return null;
  }

  return (
    <a
      href={EXE_DOWNLOAD_PATH}
      download="cycle.exe"
      onClick={() => {
        onOpenModal();
      }}
      className="h-10 px-3.5 rounded-full bg-[#f9c74f] text-[#1e1e1e] border-2 border-zinc-900 shadow-[0_3px_0_#d6d2ca] flex items-center gap-1.5 font-black text-xs hover:bg-amber-400 hover:scale-105 active:scale-95 transition whitespace-nowrap"
      title="Download cycle.exe for Windows"
      aria-label="Download cycle.exe"
    >
      <i className="fas fa-download text-xs"></i>
      <span>Download</span>
    </a>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-500 border-2 border-[#1e1e1e] px-3 py-2 text-xs font-black text-[#1e1e1e] shadow-[0_4px_0_#1e1e1e]">
      <span className="h-2.5 w-2.5 rounded-full bg-[#1e1e1e] animate-pulse" />
      <span>Offline Mode — Cached Cycle.exe assets active</span>
    </div>
  );
};

interface DesktopAppModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DesktopAppModal: React.FC<DesktopAppModalProps> = ({ isOpen, onClose }) => {
  const { isInstallable, isInstalled, isIOS, isDesktopShell, install } = usePWAInstall();
  const [installing, setInstalling] = useState(false);

  if (!isOpen) return null;

  const handleInstantInstall = async () => {
    try {
      setInstalling(true);
      const ok = await install();
      if (ok) onClose();
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div
      className="modal-overlay open"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal max-w-lg p-6 sm:p-8 border-3 border-[#1e1e1e] bg-white rounded-3xl shadow-[0_10px_0_#1e1e1e] max-h-[90vh] overflow-y-auto">
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          <i className="fas fa-times"></i>
        </button>

        <div className="flex items-center gap-3 pb-4 border-b border-zinc-200">
          <div className="w-12 h-12 rounded-2xl bg-[#1e1e1e] text-[#f9c74f] border-2 border-[#1e1e1e] flex items-center justify-center text-xl shadow-[0_3px_0_#f9c74f] shrink-0">
            <i className="fab fa-windows"></i>
          </div>
          <div>
            <h3 className="font-black text-xl text-zinc-900 tracking-tight">
              Download cycle.exe
            </h3>
            <p className="text-xs text-zinc-600 font-medium">
              Your standalone Windows desktop software download has started.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          <div className="p-4 rounded-2xl border-2 border-[#1e1e1e] bg-[#fbf9f4] space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs font-black uppercase tracking-wider text-zinc-900 flex items-center gap-2">
                <i className="fas fa-file-download text-amber-600"></i>
                Standalone Windows Software (64-bit)
              </span>
              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-400">
                cycle.exe
              </span>
            </div>

            <p className="text-xs text-zinc-700 leading-relaxed">
              Double-click <strong>cycle.exe</strong> after downloading to run Cycle.exe as an independent desktop application with zero external browser required.
            </p>

            <a
              href={EXE_DOWNLOAD_PATH}
              download="cycle.exe"
              className="btn-primary py-2.5 px-4 text-xs font-black inline-flex items-center gap-2"
            >
              <i className="fas fa-download"></i>
              <span>Download cycle.exe Again</span>
            </a>

            <p className="text-[11px] text-zinc-500 leading-relaxed">
              If Windows SmartScreen appears for a newly downloaded app, click <strong>More info &rarr; Run anyway</strong>.
            </p>
          </div>

          {!isDesktopShell && !isInstalled && (isInstallable || isIOS) && (
            <div className="p-4 rounded-2xl border-2 border-zinc-300 bg-white space-y-2">
              <span className="text-xs font-black uppercase tracking-wider text-zinc-800 flex items-center gap-2">
                <i className="fas fa-mobile-alt text-amber-600"></i>
                Browser / Mobile Quick Install
              </span>
              {isInstallable ? (
                <button
                  type="button"
                  disabled={installing}
                  onClick={handleInstantInstall}
                  className="btn-secondary py-2 px-4 text-xs font-black inline-flex items-center gap-2"
                >
                  <i className={`fas ${installing ? 'fa-spinner fa-spin' : 'fa-bolt'}`}></i>
                  <span>{installing ? 'Installing...' : 'Install Instant App'}</span>
                </button>
              ) : (
                <p className="text-xs text-zinc-600 leading-relaxed">
                  On iPhone / iPad Safari: tap <strong>Share &rarr; Add to Home Screen</strong>.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
