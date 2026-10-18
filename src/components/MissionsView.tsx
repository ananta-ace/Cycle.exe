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
  getDocs,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { MissionReport, MissionSegment } from '../types';
import { missionMetaList as initialMissions } from '../data';

export const MissionsView: React.FC = () => {
  const { isSuperAdmin, user } = useAuth();

  const [missions, setMissions] = useState<MissionReport[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingMissionId, setEditingMissionId] = useState<string | null>(null);

  // Form Fields
  const [num, setNum] = useState('004');
  const [name, setName] = useState('');
  const [fullDate, setFullDate] = useState('');
  const [shortDate, setShortDate] = useState('');
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState('');
  const [avgSpeed, setAvgSpeed] = useState('');
  const [totalDist, setTotalDist] = useState('');
  const [variant, setVariant] = useState<'default' | 'alt-accent' | 'green-accent'>('default');
  const [icon, setIcon] = useState('fa-map-signs');
  const [isDuo, setIsDuo] = useState(false);
  const [crewNames, setCrewNames] = useState('');
  const [crewNote, setCrewNote] = useState('');
  const [segments, setSegments] = useState<MissionSegment[]>([
    { num: 1, segment: '', distance: '' },
  ]);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // 1. Synchronize missions from Firestore (seed initial missions if empty)
  useEffect(() => {
    const q = query(collection(db, 'missions'), orderBy('createdAt', 'asc'));

    const unsub = onSnapshot(
      q,
      async (snapshot) => {
        if (snapshot.empty) {
          const alreadySeeded = localStorage.getItem('cycle_missions_seeded');
          // If Firestore collection is empty and has never been seeded, seed initial missions once
          if (isSuperAdmin && !alreadySeeded) {
            try {
              localStorage.setItem('cycle_missions_seeded', 'true');
              for (const initM of initialMissions) {
                await addDoc(collection(db, 'missions'), {
                  ...initM,
                  status: 'PUBLISHED',
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                });
              }
              return;
            } catch (seedErr) {
              console.warn('Seeding missions notice:', seedErr);
            }
          } else if (!alreadySeeded) {
            setMissions(initialMissions);
            setLoading(false);
            return;
          } else {
            setMissions([]);
            setLoading(false);
            return;
          }
        }

        const list: MissionReport[] = [];
        snapshot.forEach((snap) => {
          list.push({ id: snap.id, ...(snap.data() as Omit<MissionReport, 'id'>) });
        });

        localStorage.setItem('cycle_missions_seeded', 'true');
        setMissions(list);
        setLoading(false);
      },
      (err) => {
        console.warn('Error listening to missions:', err);
        setMissions(initialMissions);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [isSuperAdmin]);

  // Modal openers
  const openCreateModal = () => {
    setEditingMissionId(null);
    const nextNum = String(missions.length + 1).padStart(3, '0');
    setNum(nextNum);
    setName('');
    const today = new Date();
    const formattedDate = today.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const formattedShort = today.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    setFullDate(formattedDate);
    setShortDate(formattedShort);
    setTime('3:30 PM · Finished 6:30 PM');
    setDuration('3h 00m');
    setAvgSpeed('~12.0 km/h');
    setTotalDist('35.0 km');
    setVariant('default');
    setIcon('fa-map-signs');
    setIsDuo(false);
    setCrewNames('Ananta, Joy, Borson, Sahal');
    setCrewNote('');
    setSegments([
      { num: 1, segment: 'Start Point → Intermediate Checkpoint', distance: '15.0 km' },
      { num: 2, segment: 'Intermediate Checkpoint → Finish Loop', distance: '20.0 km' },
    ]);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (m: MissionReport) => {
    setEditingMissionId(m.id);
    setNum(m.num || '001');
    setName(m.name || m.title || '');
    setFullDate(m.fullDate || m.shortDate || '');
    setShortDate(m.shortDate || '');
    setTime(m.time || '');
    setDuration(m.duration || '');
    setAvgSpeed(m.avgSpeed || '');
    setTotalDist(m.totalDist || '');
    setVariant(m.variant || 'default');
    setIcon(m.icon || 'fa-map-signs');
    setIsDuo(!!m.isDuo);
    setCrewNames(m.crewIds ? m.crewIds.join(', ') : '');
    setCrewNote(m.crewNote || '');
    setSegments(m.segments && m.segments.length > 0 ? m.segments : [{ num: 1, segment: '', distance: '' }]);
    setFormError(null);
    setModalOpen(true);
  };

  const handleAddSegment = () => {
    setSegments((prev) => [...prev, { num: prev.length + 1, segment: '', distance: '' }]);
  };

  const handleRemoveSegment = (index: number) => {
    setSegments((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      return updated.map((s, i) => ({ ...s, num: i + 1 }));
    });
  };

  const handleSegmentChange = (index: number, field: 'segment' | 'distance', value: string) => {
    setSegments((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  // Auto calculate total distance from segments
  const calculateTotalDistance = () => {
    let sum = 0;
    segments.forEach((s) => {
      const numMatch = s.distance.match(/([0-9.]+)/);
      if (numMatch) {
        sum += parseFloat(numMatch[1]);
      }
    });
    if (sum > 0) {
      setTotalDist(`${sum.toFixed(1)} km`);
    }
  };

  const handleSaveMission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) {
      alert('Only the Super Admin can create or edit missions.');
      return;
    }

    if (!name.trim()) {
      setFormError('Please enter a mission title/name.');
      return;
    }

    try {
      setSaving(true);
      setFormError(null);

      // Clean crew list
      const parsedCrew = crewNames
        .split(',')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);

      const missionPayload: Omit<MissionReport, 'id'> = {
        num: num.trim() || '001',
        name: name.trim(),
        title: name.trim(),
        fullDate: fullDate.trim(),
        shortDate: shortDate.trim() || fullDate.trim(),
        time: time.trim(),
        duration: duration.trim(),
        avgSpeed: avgSpeed.trim(),
        totalDist: totalDist.trim(),
        icon: icon.trim() || 'fa-map-signs',
        variant,
        isDuo,
        status: 'PUBLISHED',
        segments: segments.filter((s) => s.segment.trim().length > 0),
        crewIds: parsedCrew,
        crewNote: crewNote.trim(),
        createdBy: user?.uid || 'super-admin',
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      if (editingMissionId) {
        await updateDoc(doc(db, 'missions', editingMissionId), missionPayload);
      } else {
        await addDoc(collection(db, 'missions'), missionPayload);
      }

      setModalOpen(false);
    } catch (err: unknown) {
      console.error('Mission save error:', err);
      setFormError(err instanceof Error ? err.message : 'Failed to save mission');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMission = async (missionId: string, missionName: string) => {
    if (!isSuperAdmin) {
      alert('Only the Super Admin can delete missions.');
      return;
    }

    if (!confirm(`Are you sure you want to permanently delete Mission "${missionName}"?`)) return;

    try {
      // Find and delete the doc from Firestore
      const snap = await getDocs(collection(db, 'missions'));
      let foundDocId: string | null = null;

      snap.forEach((d) => {
        if (d.id === missionId || d.data().num === missionId || d.data().name === missionName) {
          foundDocId = d.id;
        }
      });

      if (foundDocId) {
        await deleteDoc(doc(db, 'missions', foundDocId));
      } else {
        await deleteDoc(doc(db, 'missions', missionId));
      }

      // Also update local view
      setMissions((prev) => prev.filter((m) => m.id !== missionId && m.name !== missionName));
    } catch (err) {
      console.error('Error deleting mission:', err);
      alert('Failed to delete mission from database.');
    }
  };

  return (
    <div>
      {/* Hero */}
      <div className="hero mb-8">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#f9c74f]/30 border border-[#f9c74f] text-xs font-black text-amber-950 mb-3">
          <i className="fas fa-flag-checkered text-[#f9c74f]"></i> Verified Ride Logs
        </div>
        <h1 className="text-3xl md:text-5xl font-black text-zinc-900 tracking-tight">
          <i className="fas fa-map-signs text-[#f9c74f]"></i> Mission Operations &amp; Logs
        </h1>
        <p className="text-base text-zinc-600 max-w-2xl mx-auto mt-2">
          Every ride, route segment, and pace record. Authenticated cycling missions logged and verified by Cycle.exe leadership.
        </p>

        {/* Super Admin Create Mission Button */}
        {isSuperAdmin && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={openCreateModal}
              className="btn-primary py-3 px-6 text-xs sm:text-sm font-black flex items-center gap-2 shadow-[0_5px_0_#1e1e1e]"
            >
              <i className="fas fa-plus"></i> Create New Mission
            </button>
          </div>
        )}
      </div>

      {/* Stats Bar */}
      <div className="stats">
        <div className="stat-item">
          <i className="fas fa-trophy stat-icon"></i>
          <div className="stat-content">
            <span className="stat-number">{missions.length}</span>
            <span className="stat-label">total missions</span>
          </div>
        </div>
        <div className="stat-item">
          <i className="fas fa-road stat-icon"></i>
          <div className="stat-content">
            <span className="stat-number">
              {missions
                .reduce((acc, m) => {
                  const match = m.totalDist?.match(/([0-9.]+)/);
                  return acc + (match ? parseFloat(match[1]) : 0);
                }, 0)
                .toFixed(1)}{' '}
              km
            </span>
            <span className="stat-label">total distance</span>
          </div>
        </div>
        <div className="stat-item">
          <i className="fas fa-tachometer-alt stat-icon"></i>
          <div className="stat-content">
            <span className="stat-number">~11.5</span>
            <span className="stat-label">avg speed (km/h)</span>
          </div>
        </div>
        <div className="stat-item">
          <i className="fas fa-heart stat-icon"></i>
          <div className="stat-content">
            <span className="stat-number">100%</span>
            <span className="stat-label">crew spirit</span>
          </div>
        </div>
      </div>

      {/* Section Header */}
      <div className="section-title">
        <i className="fas fa-flag-checkered"></i>
        <span>Expedition Logs</span>
        <span>
          <i className="fas fa-bolt"></i> {missions.length} {missions.length === 1 ? 'ride' : 'rides'}
        </span>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="text-center py-12 text-zinc-500 font-bold text-sm">
          <i className="fas fa-spinner fa-spin text-2xl mb-2 block"></i> Loading mission records...
        </div>
      )}

      {/* MISSIONS LIST - ALL MISSIONS RENDER WITH IDENTICAL DESIGN & LAYOUT */}
      {!loading && (
        <div className="space-y-8">
          {missions.map((m) => {
            let accentClass = '';
            if (m.variant === 'alt-accent') accentClass = 'alt-accent';
            else if (m.variant === 'green-accent') accentClass = 'green-accent';

            return (
              <div key={m.id || m.num} className={`mission-report ${accentClass} relative group`}>
                {/* Super Admin Control Buttons */}
                {isSuperAdmin && (
                  <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
                    <button
                      type="button"
                      onClick={() => openEditModal(m)}
                      title="Edit Mission Details"
                      className="px-3 py-1.5 rounded-xl bg-white border-2 border-[#1e1e1e] text-xs font-black text-zinc-800 hover:bg-[#f9c74f] shadow-[0_2px_0_#1e1e1e] transition flex items-center gap-1.5"
                    >
                      <i className="fas fa-pencil-alt text-amber-700"></i> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteMission(m.id, m.name || m.title)}
                      title="Delete Mission"
                      className="px-3 py-1.5 rounded-xl bg-rose-50 border-2 border-rose-600 text-xs font-black text-rose-800 hover:bg-rose-100 shadow-[0_2px_0_#991b1b] transition flex items-center gap-1.5"
                    >
                      <i className="fas fa-trash-alt"></i> Delete
                    </button>
                  </div>
                )}

                <div className="report-badge">
                  <i className="fas fa-flag"></i> Mission {m.num || '001'}
                </div>

                <h2>
                  <i className={`fas ${m.icon || 'fa-map-signs'}`}></i> {m.name || m.title}
                  {m.isDuo && (
                    <span className="duo-badge">
                      <i className="fas fa-user-friends"></i> Duo Ride
                    </span>
                  )}
                </h2>

                <div className="report-meta">
                  {m.fullDate && (
                    <span>
                      <i className="fas fa-calendar-alt"></i> {m.fullDate}
                    </span>
                  )}
                  {m.time && (
                    <span>
                      <i className="fas fa-clock"></i> {m.time}
                    </span>
                  )}
                  {m.duration && (
                    <span>
                      <i className="fas fa-hourglass-half"></i> Duration: {m.duration}
                    </span>
                  )}
                  {m.avgSpeed && (
                    <span>
                      <i className="fas fa-tachometer-alt"></i> Avg speed: {m.avgSpeed}
                    </span>
                  )}
                </div>

                {/* Segments Route Table */}
                {m.segments && m.segments.length > 0 && (
                  <table className="route-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Segment</th>
                        <th style={{ textAlign: 'right' }}>Distance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.segments.map((seg, sIdx) => (
                        <tr key={sIdx}>
                          <td>
                            <span className="seg-icon">{seg.num || sIdx + 1}</span>
                          </td>
                          <td>{seg.segment}</td>
                          <td style={{ textAlign: 'right' }}>
                            <span className="km-badge">{seg.distance}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2}>
                          <i className="fas fa-route"></i> TOTAL DISTANCE
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span className="total-km">{m.totalDist}</span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}

                {/* Crew List Section */}
                <div className="crew-list">
                  <strong>
                    <i className="fas fa-users"></i> Crew:
                  </strong>
                  {m.crewIds && m.crewIds.length > 0 ? (
                    m.crewIds.map((cid, cIdx) => (
                      <span key={cIdx} className="crew-chip">
                        <span className="chip-photo">
                          <span className="w-full h-full bg-[#1e1e1e] text-[#f9c74f] font-black text-[10px] flex items-center justify-center">
                            {cid.charAt(0).toUpperCase()}
                          </span>
                        </span>
                        {cid}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-zinc-500 italic">Full group paceline</span>
                  )}

                  {m.crewNote && (
                    <div className="crew-note">
                      <i className="fas fa-info-circle"></i> {m.crewNote}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Super Admin Create / Edit Mission Modal */}
      {modalOpen && (
        <div
          className="modal-overlay open"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="modal max-w-2xl p-7 sm:p-9 border-3 border-[#1e1e1e] bg-white rounded-3xl shadow-[0_10px_0_#1e1e1e] max-h-[90vh] overflow-y-auto">
            <button
              type="button"
              className="modal-close"
              onClick={() => setModalOpen(false)}
              aria-label="Close"
            >
              <i className="fas fa-times"></i>
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-[#1e1e1e] text-[#f9c74f] border-2 border-[#1e1e1e] flex items-center justify-center text-xl shadow-[0_3px_0_#1e1e1e]">
                <i className="fas fa-flag-checkered"></i>
              </div>
              <div>
                <h2 className="text-xl font-black text-zinc-900 tracking-tight">
                  {editingMissionId ? 'Edit Mission Report' : 'Create New Mission Report'}
                </h2>
                <p className="text-xs text-zinc-600">
                  Matches the authentic Cycle.exe report layout with segments and crew breakdown
                </p>
              </div>
            </div>

            {formError && (
              <div className="p-3 mb-4 bg-red-50 border-2 border-red-500 rounded-2xl text-xs font-bold text-red-700">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveMission} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider mb-1 text-zinc-700">
                    Mission # *
                  </label>
                  <input
                    type="text"
                    required
                    value={num}
                    onChange={(e) => setNum(e.target.value)}
                    placeholder="e.g. 004"
                    className="neo-input text-sm w-full p-2.5 font-mono font-bold"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-black uppercase tracking-wider mb-1 text-zinc-700">
                    Mission Name / Route Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Gazipur Scenic Bypass Sprint"
                    className="neo-input text-sm w-full p-2.5 font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider mb-1 text-zinc-700">
                    Full Date
                  </label>
                  <input
                    type="text"
                    value={fullDate}
                    onChange={(e) => setFullDate(e.target.value)}
                    placeholder="e.g. 26 October 2026"
                    className="neo-input text-sm w-full p-2.5"
                  />
                </div>
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider mb-1 text-zinc-700">
                    Ride Time
                  </label>
                  <input
                    type="text"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    placeholder="e.g. 3:30 PM · Finished 6:40 PM"
                    className="neo-input text-sm w-full p-2.5"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider mb-1 text-zinc-700">
                    Duration
                  </label>
                  <input
                    type="text"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    placeholder="e.g. 3h 10m"
                    className="neo-input text-sm w-full p-2.5"
                  />
                </div>
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider mb-1 text-zinc-700">
                    Avg Speed
                  </label>
                  <input
                    type="text"
                    value={avgSpeed}
                    onChange={(e) => setAvgSpeed(e.target.value)}
                    placeholder="e.g. ~12.4 km/h"
                    className="neo-input text-sm w-full p-2.5"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-black uppercase tracking-wider text-zinc-700">
                      Total Distance
                    </label>
                    <button
                      type="button"
                      onClick={calculateTotalDistance}
                      className="text-[10px] font-bold text-amber-700 underline"
                      title="Sum segments"
                    >
                      Sum
                    </button>
                  </div>
                  <input
                    type="text"
                    value={totalDist}
                    onChange={(e) => setTotalDist(e.target.value)}
                    placeholder="e.g. 37.7 km"
                    className="neo-input text-sm w-full p-2.5 font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider mb-1 text-zinc-700">
                    Style Variant
                  </label>
                  <select
                    value={variant}
                    onChange={(e) => setVariant(e.target.value as any)}
                    className="neo-input text-sm w-full p-2.5 font-bold"
                  >
                    <option value="default">Default Yellow Accent</option>
                    <option value="alt-accent">Orange Accent</option>
                    <option value="green-accent">Green Accent</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider mb-1 text-zinc-700">
                    Header Icon
                  </label>
                  <select
                    value={icon}
                    onChange={(e) => setIcon(e.target.value)}
                    className="neo-input text-sm w-full p-2.5 font-bold"
                  >
                    <option value="fa-map-signs">Map Signs (Default)</option>
                    <option value="fa-industry">Industry / Out-and-Back</option>
                    <option value="fa-bridge">Bridge</option>
                    <option value="fa-bicycle">Bicycle</option>
                    <option value="fa-flag">Checkered Flag</option>
                    <option value="fa-mountain">Mountain</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <input
                    type="checkbox"
                    id="isDuoCheck"
                    checked={isDuo}
                    onChange={(e) => setIsDuo(e.target.checked)}
                    className="w-4 h-4 rounded text-zinc-900"
                  />
                  <label htmlFor="isDuoCheck" className="text-xs font-bold text-zinc-800 cursor-pointer">
                    Duo Ride Badge
                  </label>
                </div>
              </div>

              {/* Segments Section */}
              <div className="pt-2 border-t border-zinc-200">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-black uppercase tracking-wider text-zinc-700">
                    Route Segments
                  </label>
                  <button
                    type="button"
                    onClick={handleAddSegment}
                    className="text-xs font-black px-2.5 py-1 rounded-lg bg-zinc-100 hover:bg-[#f9c74f] text-zinc-900 border border-zinc-300 transition"
                  >
                    <i className="fas fa-plus mr-1"></i> Add Segment
                  </button>
                </div>

                <div className="space-y-2">
                  {segments.map((seg, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-zinc-200 text-zinc-800 text-xs font-black flex items-center justify-center shrink-0">
                        {seg.num}
                      </span>
                      <input
                        type="text"
                        value={seg.segment}
                        onChange={(e) => handleSegmentChange(idx, 'segment', e.target.value)}
                        placeholder="e.g. Rajendrapur → Shimultoli"
                        className="neo-input text-xs p-2 flex-1 font-medium"
                      />
                      <input
                        type="text"
                        value={seg.distance}
                        onChange={(e) => handleSegmentChange(idx, 'distance', e.target.value)}
                        placeholder="12.6 km"
                        className="neo-input text-xs p-2 w-24 text-right font-bold"
                      />
                      {segments.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveSegment(idx)}
                          className="text-xs text-red-500 hover:text-red-700 p-1"
                          title="Remove segment"
                        >
                          <i className="fas fa-times"></i>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Crew Members & Crew Note */}
              <div className="pt-2 border-t border-zinc-200 space-y-3">
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider mb-1 text-zinc-700">
                    Crew Members (Comma-separated names)
                  </label>
                  <input
                    type="text"
                    value={crewNames}
                    onChange={(e) => setCrewNames(e.target.value)}
                    placeholder="e.g. Ananta, Joy, Borson, Sahal"
                    className="neo-input text-sm w-full p-2.5"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black uppercase tracking-wider mb-1 text-zinc-700">
                    Crew Note / Expedition Context
                  </label>
                  <textarea
                    rows={2}
                    value={crewNote}
                    onChange={(e) => setCrewNote(e.target.value)}
                    placeholder="e.g. Adil has since become inactive and did not ride. Great weather."
                    className="neo-input text-xs w-full p-2.5 resize-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-zinc-200">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="btn-secondary py-2.5 px-4 text-xs font-bold"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary py-2.5 px-6 text-xs font-black flex items-center gap-2"
                >
                  {saving ? (
                    <>
                      <i className="fas fa-spinner fa-spin"></i> Saving Mission...
                    </>
                  ) : (
                    <>
                      <i className="fas fa-save"></i> Save Mission Report
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
