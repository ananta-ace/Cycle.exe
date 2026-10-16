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
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { MissionReport } from '../types';
import { missionMetaList, members } from '../data';

export const MissionsView: React.FC = () => {
  const { isSuperAdmin, user } = useAuth();

  const [communityMissions, setCommunityMissions] = useState<MissionReport[]>([]);
  const [loadingMissions, setLoadingMissions] = useState(true);
  const [filter, setFilter] = useState<'ALL' | 'HISTORICAL' | 'PUBLISHED' | 'ARCHIVED'>('ALL');

  // Mission Modal state for Create / Edit
  const [modalOpen, setModalOpen] = useState(false);
  const [editingMissionId, setEditingMissionId] = useState<string | null>(null);

  // Form fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [coverPhoto, setCoverPhoto] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [distanceKm, setDistanceKm] = useState('30');
  const [durationHours, setDurationHours] = useState('2.5');
  const [difficulty, setDifficulty] = useState<'EASY' | 'MEDIUM' | 'HARD' | 'EXTREME'>('MEDIUM');
  const [rules, setRules] = useState('');
  const [status, setStatus] = useState<'DRAFT' | 'PUBLISHED' | 'ARCHIVED'>('PUBLISHED');
  const [reward, setReward] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Detail Modal for any mission
  const [selectedMission, setSelectedMission] = useState<MissionReport | null>(null);

  // 1. Listen for dynamic Firestore community missions
  useEffect(() => {
    const q = query(collection(db, 'missions'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list: MissionReport[] = [];
        snapshot.forEach((snap) => {
          list.push({ id: snap.id, ...(snap.data() as Omit<MissionReport, 'id'>) });
        });
        setCommunityMissions(list);
        setLoadingMissions(false);
      },
      (err) => {
        console.error('Error listening to missions:', err);
        setLoadingMissions(false);
      }
    );

    return () => unsub();
  }, []);

  const openCreateModal = () => {
    setEditingMissionId(null);
    setTitle('');
    setDescription('');
    setCoverPhoto('');
    setStartDate(new Date().toISOString().split('T')[0]);
    setEndDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
    setDistanceKm('35');
    setDurationHours('3');
    setDifficulty('MEDIUM');
    setRules('Helmets required. Respect traffic lights. Stay with the group paceline.');
    setStatus('PUBLISHED');
    setReward('Cycle.exe Mission Finisher Badge');
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (m: MissionReport) => {
    setEditingMissionId(m.id);
    setTitle(m.title || m.name || '');
    setDescription(m.description || '');
    setCoverPhoto(m.coverPhoto || '');
    setStartDate(m.startDate || '');
    setEndDate(m.endDate || '');
    setDistanceKm(String(m.distanceTargetKm || m.totalDist?.replace(/[^0-9.]/g, '') || 30));
    setDurationHours(String(m.durationTargetHours || 2));
    setDifficulty(m.difficulty || 'MEDIUM');
    setRules(m.rules || '');
    setStatus(m.status || 'PUBLISHED');
    setReward(m.rewardDescription || '');
    setFormError(null);
    setModalOpen(true);
  };

  const handleSaveMission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) {
      alert('Only the Super Admin can create or edit missions.');
      return;
    }

    if (!title.trim()) {
      setFormError('Please enter a mission title.');
      return;
    }

    try {
      setSaving(true);
      setFormError(null);

      const missionPayload: Omit<MissionReport, 'id'> = {
        title: title.trim(),
        description: description.trim(),
        coverPhoto: coverPhoto.trim(),
        startDate,
        endDate,
        distanceTargetKm: Number(distanceKm) || 0,
        durationTargetHours: Number(durationHours) || 0,
        difficulty,
        rules: rules.trim(),
        status,
        rewardDescription: reward.trim(),
        createdBy: user?.uid || 'super-admin',
        createdAt: new Date().toISOString(),
        segments: [],
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

  const handleDeleteMission = async (missionId: string) => {
    if (!isSuperAdmin) {
      alert('Only the Super Admin can delete missions.');
      return;
    }

    if (!confirm('Are you sure you want to delete this mission? This cannot be undone.')) return;

    try {
      await deleteDoc(doc(db, 'missions', missionId));
    } catch (err) {
      console.error('Error deleting mission:', err);
    }
  };

  return (
    <div>
      {/* Hero */}
      <div className="hero">
        <h1>
          <i className="fas fa-flag-checkered"></i> Mission Operations
        </h1>
        <p>Every ride, every route, every rider. Verified cycling expeditions and challenges.</p>
      </div>

      {/* Stats Bar */}
      <div className="stats">
        <div className="stat-item">
          <i className="fas fa-users stat-icon"></i>
          <div className="stat-content">
            <span className="stat-number">6</span>
            <span className="stat-label">crew riders</span>
          </div>
        </div>
        <div className="stat-item">
          <i className="fas fa-trophy stat-icon"></i>
          <div className="stat-content">
            <span className="stat-number">{3 + communityMissions.length}</span>
            <span className="stat-label">total missions</span>
          </div>
        </div>
        <div className="stat-item">
          <i className="fas fa-road stat-icon"></i>
          <div className="stat-content">
            <span className="stat-number">103.7+</span>
            <span className="stat-label">km logged</span>
          </div>
        </div>
        <div className="stat-item">
          <i className="fas fa-heart stat-icon"></i>
          <div className="stat-content">
            <span className="stat-number">100%</span>
            <span className="stat-label">good vibes</span>
          </div>
        </div>
      </div>

      {/* Controls Bar */}
      <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
        <div className="flex gap-2">
          {(['ALL', 'HISTORICAL', 'PUBLISHED'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={`text-xs font-bold py-1.5 px-3.5 rounded-full border border-zinc-900 transition ${
                filter === tab ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-800 hover:bg-zinc-100'
              }`}
            >
              {tab === 'HISTORICAL' ? 'Original Crew (3)' : tab === 'PUBLISHED' ? 'Community Challenges' : 'All Missions'}
            </button>
          ))}
        </div>

        {/* Super Admin Exclusive: Create Mission */}
        {isSuperAdmin && (
          <button
            type="button"
            onClick={openCreateModal}
            className="btn-primary text-xs py-2 px-4 font-bold flex items-center gap-2"
          >
            <i className="fas fa-plus"></i> Create Community Mission
          </button>
        )}
      </div>

      {/* NEW COMMUNITY MISSIONS */}
      {loadingMissions && (
        <div className="text-center py-4 text-xs font-bold text-zinc-500">
          <i className="fas fa-spinner fa-spin mr-2"></i> Loading community challenges...
        </div>
      )}
      {!loadingMissions && (filter === 'ALL' || filter === 'PUBLISHED') && communityMissions.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <i className="fas fa-compass text-[#b45309]"></i> Active Community Challenges
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {communityMissions.map((cm) => (
              <div
                key={cm.id}
                className="neo-card flex flex-col justify-between hover:shadow-[0_12px_0_#d6d2ca] transition"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span
                      className={`text-[0.65rem] font-bold uppercase px-2.5 py-0.5 rounded-full border ${
                        cm.difficulty === 'EXTREME'
                          ? 'bg-red-100 text-red-800 border-red-300'
                          : cm.difficulty === 'HARD'
                          ? 'bg-orange-100 text-orange-800 border-orange-300'
                          : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                      }`}
                    >
                      {cm.difficulty || 'MEDIUM'} DIFFICULTY
                    </span>
                    <span className="text-[0.68rem] font-mono text-zinc-500">
                      {cm.startDate ? `${cm.startDate} to ${cm.endDate}` : 'Ongoing'}
                    </span>
                  </div>

                  <h3 className="text-xl font-bold mb-2">{cm.title}</h3>
                  <p className="text-xs text-zinc-600 line-clamp-3 mb-4 leading-relaxed">
                    {cm.description}
                  </p>

                  <div className="flex items-center gap-4 text-xs font-bold text-zinc-700 mb-4 bg-[#f6f3ee] p-2.5 rounded-xl border border-zinc-200">
                    <span>
                      <i className="fas fa-road text-[#b45309] mr-1"></i> {cm.distanceTargetKm} km
                    </span>
                    {cm.durationTargetHours ? (
                      <span>
                        <i className="fas fa-clock text-[#b45309] mr-1"></i> ~{cm.durationTargetHours} hrs
                      </span>
                    ) : null}
                    {cm.rewardDescription ? (
                      <span className="truncate">
                        <i className="fas fa-medal text-amber-500 mr-1"></i> {cm.rewardDescription}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-zinc-200">
                  <button
                    type="button"
                    onClick={() => setSelectedMission(cm)}
                    className="text-xs font-bold text-zinc-900 hover:text-[#b45309] underline underline-offset-2"
                  >
                    View Mission Briefing &amp; Rules →
                  </button>

                  {/* Super Admin Action Controls */}
                  {isSuperAdmin && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => openEditModal(cm)}
                        title="Edit Mission"
                        className="w-7 h-7 rounded-full bg-zinc-100 hover:bg-zinc-200 text-xs flex items-center justify-center text-zinc-700"
                      >
                        <i className="fas fa-pencil-alt"></i>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteMission(cm.id)}
                        title="Delete Mission"
                        className="w-7 h-7 rounded-full bg-zinc-100 hover:bg-red-100 hover:text-red-600 text-xs flex items-center justify-center text-zinc-700"
                      >
                        <i className="fas fa-trash-alt"></i>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ORIGINAL 3 HISTORICAL MISSIONS */}
      {(filter === 'ALL' || filter === 'HISTORICAL') && (
        <div>
          <div className="section-title">
            <i className="fas fa-flag-checkered"></i>
            <span>Historic Crew Expeditions</span>
            <span>
              <i className="fas fa-bolt"></i> 3 rides
            </span>
          </div>

          {missionMetaList.map((m) => {
            let accentClass = '';
            if (m.variant === 'alt-accent') accentClass = 'alt-accent';
            else if (m.variant === 'green-accent') accentClass = 'green-accent';

            return (
              <div key={m.id} className={`mission-report ${accentClass}`}>
                <div className="report-badge">
                  <i className="fas fa-flag"></i> Mission {m.num}
                </div>

                <h2>
                  <i className="fas fa-map-signs"></i> {m.name}
                  {m.isDuo && (
                    <span className="duo-badge">
                      <i className="fas fa-user-friends"></i> Duo Ride
                    </span>
                  )}
                </h2>

                <div className="report-meta">
                  <span>
                    <i className="fas fa-calendar-alt"></i> {m.fullDate}
                  </span>
                  <span>
                    <i className="fas fa-clock"></i> {m.time}
                  </span>
                  <span>
                    <i className="fas fa-hourglass-half"></i> Duration: {m.duration}
                  </span>
                  <span>
                    <i className="fas fa-tachometer-alt"></i> Avg speed: {m.avgSpeed}
                  </span>
                </div>

                <table className="route-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Segment</th>
                      <th style={{ textAlign: 'right' }}>Distance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.segments?.map((seg) => (
                      <tr key={seg.num}>
                        <td>
                          <span className="seg-icon">{seg.num}</span>
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

                <div className="crew-list">
                  <strong>
                    <i className="fas fa-users"></i> Crew:
                  </strong>
                  {m.crewIds?.map((cid) => {
                    const member = members[cid];
                    if (!member) return null;
                    const isInactive = !member.active;

                    return (
                      <span
                        key={cid}
                        className={`crew-chip ${isInactive ? 'inactive-chip' : ''}`}
                      >
                        <span className="chip-photo">
                          <img
                            src={member.img}
                            alt={member.name}
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        </span>
                        {member.name}
                      </span>
                    );
                  })}
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

      {/* Mission Detail Modal */}
      {selectedMission && (
        <div
          className="modal-overlay open"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedMission(null);
          }}
        >
          <div className="modal max-w-lg">
            <button
              type="button"
              className="modal-close"
              onClick={() => setSelectedMission(null)}
            >
              <i className="fas fa-times"></i>
            </button>

            <div className="text-xs font-bold uppercase text-[#b45309] mb-1">
              Mission Briefing
            </div>
            <h2 className="text-2xl font-bold mb-3">{selectedMission.title}</h2>

            <div className="flex flex-wrap gap-2 mb-4">
              <span className="role-badge MEMBER">
                <i className="fas fa-road"></i> {selectedMission.distanceTargetKm} KM
              </span>
              <span className="role-badge ADMIN">
                <i className="fas fa-tachometer-alt"></i> {selectedMission.difficulty}
              </span>
              {selectedMission.durationTargetHours && (
                <span className="role-badge PUBLIC">
                  <i className="fas fa-clock"></i> ~{selectedMission.durationTargetHours} HOURS
                </span>
              )}
            </div>

            <div className="text-sm text-zinc-800 leading-relaxed mb-4 whitespace-pre-line">
              {selectedMission.description}
            </div>

            {selectedMission.rules && (
              <div className="p-3.5 bg-zinc-100 border-2 border-zinc-900 rounded-2xl mb-4">
                <div className="text-xs font-bold uppercase text-zinc-700 mb-1">
                  <i className="fas fa-shield-alt text-[#b45309] mr-1"></i> Mission Rules &amp; Protocols
                </div>
                <div className="text-xs text-zinc-700 whitespace-pre-line">
                  {selectedMission.rules}
                </div>
              </div>
            )}

            {selectedMission.rewardDescription && (
              <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900 font-bold mb-4 flex items-center gap-2">
                <i className="fas fa-award text-amber-600 text-lg"></i>
                <span>Reward: {selectedMission.rewardDescription}</span>
              </div>
            )}

            <button
              type="button"
              onClick={() => setSelectedMission(null)}
              className="w-full btn-secondary text-xs py-2"
            >
              Close Briefing
            </button>
          </div>
        </div>
      )}

      {/* Super Admin Create / Edit Mission Modal */}
      {modalOpen && (
        <div
          className="modal-overlay open"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <div className="modal max-w-lg">
            <button
              type="button"
              className="modal-close"
              onClick={() => setModalOpen(false)}
            >
              <i className="fas fa-times"></i>
            </button>

            <h2 className="text-xl font-bold mb-4">
              <i className="fas fa-flag-checkered text-[#b45309] mr-1"></i>{' '}
              {editingMissionId ? 'Edit Mission' : 'Create Super Admin Mission'}
            </h2>

            {formError && (
              <div className="p-2.5 mb-3 bg-red-50 border border-red-500 rounded-xl text-xs text-red-700">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveMission} className="space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-zinc-700">
                  Mission Title
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Gazipur Night Sprint"
                  className="neo-input text-sm py-2"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-zinc-700">
                  Description &amp; Route Summary
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="Detailed route itinerary, elevation, scenic checkpoints..."
                  className="neo-input text-sm py-2 resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-zinc-700">
                    Distance Target (km)
                  </label>
                  <input
                    type="number"
                    value={distanceKm}
                    onChange={(e) => setDistanceKm(e.target.value)}
                    className="neo-input text-sm py-2"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-zinc-700">
                    Difficulty Level
                  </label>
                  <select
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value as any)}
                    className="neo-input text-sm py-2"
                  >
                    <option value="EASY">EASY</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HARD">HARD</option>
                    <option value="EXTREME">EXTREME</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-zinc-700">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="neo-input text-sm py-2"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-zinc-700">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="neo-input text-sm py-2"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-zinc-700">
                  Safety Rules &amp; Equipment Requirements
                </label>
                <textarea
                  value={rules}
                  onChange={(e) => setRules(e.target.value)}
                  rows={2}
                  placeholder="Helmets required, front/rear lights for twilight rides..."
                  className="neo-input text-sm py-2 resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-zinc-700">
                  Finisher Reward Description
                </label>
                <input
                  type="text"
                  value={reward}
                  onChange={(e) => setReward(e.target.value)}
                  placeholder="e.g. Cycle.exe Gold Medal Badge"
                  className="neo-input text-sm py-2"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="btn-secondary text-xs py-2 px-4"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary text-xs py-2 px-5 font-bold"
                >
                  {saving ? (
                    <i className="fas fa-spinner fa-spin"></i>
                  ) : (
                    <i className="fas fa-save"></i>
                  )}{' '}
                  Save Mission
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
