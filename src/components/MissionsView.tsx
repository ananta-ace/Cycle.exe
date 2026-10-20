import React, { useState, useEffect } from 'react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { MissionReport, MissionSegment } from '../types';
import { missionMetaList as initialMissions } from '../data';

interface SegmentFormState {
  num: number;
  from: string;
  to: string;
  distance: string;
}

interface RiderOption {
  id: string;
  name: string;
  role?: string;
  photoURL?: string;
}

const DEFAULT_CREW_MEMBERS: RiderOption[] = [
  { id: 'ananta', name: 'Ananta', role: 'EXECUTIVE LEAD' },
  { id: 'joy', name: 'Joy', role: 'CREW LEADER' },
  { id: 'borson', name: 'Borson', role: 'ADMIN MEMBER' },
  { id: 'sahal', name: 'Sahal', role: 'ADMIN MEMBER' },
  { id: 'fariq', name: 'Fariq', role: 'MEMBER' },
  { id: 'adil', name: 'Adil', role: 'INACTIVE RIDER' },
];

const PRESET_CUSTOM_COLORS = [
  { name: 'Electric Violet', hex: '#7c3aed' },
  { name: 'Royal Cobalt', hex: '#2563eb' },
  { name: 'Cyber Cyan', hex: '#0891b2' },
  { name: 'Racing Crimson', hex: '#dc2626' },
  { name: 'Hot Magenta', hex: '#db2777' },
  { name: 'Blaze Orange', hex: '#ea580c' },
  { name: 'Emerald Forest', hex: '#059669' },
  { name: 'Deep Indigo', hex: '#4f46e5' },
  { name: 'Stealth Slate', hex: '#334155' },
];

// Helper to compute duration string (e.g. "3h 10m") between start and end time
function computeDuration(startStr: string, endStr: string): string {
  if (!startStr || !endStr) return '';
  const parseMinutes = (t: string): number | null => {
    const clean = t.trim().toUpperCase();
    const isPM = clean.includes('PM');
    const isAM = clean.includes('AM');
    const digits = clean.replace(/[APM\s]/g, '').split(':');
    if (digits.length < 2) return null;
    let h = parseInt(digits[0], 10);
    const m = parseInt(digits[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    if (isPM && h < 12) h += 12;
    if (isAM && h === 12) h = 0;
    return h * 60 + m;
  };

  const sMin = parseMinutes(startStr);
  const eMin = parseMinutes(endStr);
  if (sMin !== null && eMin !== null) {
    let diff = eMin - sMin;
    if (diff < 0) diff += 24 * 60; // Overnight
    const hours = Math.floor(diff / 60);
    const mins = diff % 60;
    if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h 00m`;
    return `${mins}m`;
  }
  return '';
}

// Helper to format date string to full and short versions
function formatDateDisplays(dStr: string): { fullDate: string; shortDate: string } {
  if (!dStr) return { fullDate: '', shortDate: '' };
  try {
    const d = new Date(dStr.includes('T') ? dStr : `${dStr}T12:00:00`);
    if (!isNaN(d.getTime())) {
      const fullDate = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      const shortDate = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      return { fullDate, shortDate };
    }
  } catch {
    // Ignore and return raw
  }
  return { fullDate: dStr, shortDate: dStr };
}

export const MissionsView: React.FC = () => {
  const { isSuperAdmin, user } = useAuth();

  const [missions, setMissions] = useState<MissionReport[]>([]);
  const [loading, setLoading] = useState(true);

  // Available riders list for multi-select (default members + real users)
  const [candidateRiders, setCandidateRiders] = useState<RiderOption[]>(DEFAULT_CREW_MEMBERS);

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingMissionId, setEditingMissionId] = useState<string | null>(null);

  // Form Fields - Requested by User
  const [missionTag, setMissionTag] = useState('004'); // Mission Tag / ID
  const [missionTitle, setMissionTitle] = useState(''); // Mission Title / Name
  const [date, setDate] = useState(''); // Date
  const [startTime, setStartTime] = useState('03:30 PM'); // Start Time
  const [endTime, setEndTime] = useState('06:40 PM'); // End Time
  const [duration, setDuration] = useState('3h 10m'); // Auto or manual duration
  const [avgSpeed, setAvgSpeed] = useState('~12.0 km/h');
  const [totalDist, setTotalDist] = useState('37.7 km');

  // Dynamic Mission Segments with From, To, and Distance (km)
  const [segments, setSegments] = useState<SegmentFormState[]>([
    { num: 1, from: 'Rajendrapur', to: 'Shimultoli', distance: '12.6 km' },
    { num: 2, from: 'Shimultoli', to: 'Paglar Ban', distance: '15.0 km' },
  ]);

  // Crew Members Multi-Select State
  const [selectedCrew, setSelectedCrew] = useState<string[]>(['Ananta', 'Joy', 'Borson', 'Sahal']);
  const [crewDropdownOpen, setCrewDropdownOpen] = useState(false);
  const [crewSearch, setCrewSearch] = useState('');
  const [customCrewInput, setCustomCrewInput] = useState('');

  // Optional Notes / Disclaimer
  const [notes, setNotes] = useState('');

  // Style Variant & Custom Color Picker
  const [variant, setVariant] = useState<'default' | 'alt-accent' | 'green-accent' | 'custom'>('default');
  const [customColor, setCustomColor] = useState('#7c3aed');
  const [icon, setIcon] = useState('fa-map-signs');
  const [isDuo, setIsDuo] = useState(false);

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
          if (isSuperAdmin && !alreadySeeded) {
            try {
              localStorage.setItem('cycle_missions_seeded', 'true');
              for (const initM of initialMissions) {
                await addDoc(collection(db, 'missions'), {
                  ...initM,
                  tag: initM.num || '001',
                  date: initM.shortDate || '5 Sep 2026',
                  startTime: '03:30 PM',
                  endTime: '06:40 PM',
                  notes: initM.crewNote || '',
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

  // 2. Fetch registered users from Firestore to populate crew multi-select options
  useEffect(() => {
    const uq = query(collection(db, 'users'));
    const unsub = onSnapshot(
      uq,
      (snapshot) => {
        const userOptions: RiderOption[] = [];
        snapshot.forEach((snap) => {
          const d = snap.data();
          if (d.displayName) {
            userOptions.push({
              id: snap.id,
              name: d.displayName,
              role: d.role,
              photoURL: d.photoURL,
            });
          }
        });

        // Merge default crew and real registered users without duplicate names
        const combined = [...DEFAULT_CREW_MEMBERS];
        userOptions.forEach((uo) => {
          if (!combined.some((c) => c.name.toLowerCase() === uo.name.toLowerCase())) {
            combined.push(uo);
          }
        });
        setCandidateRiders(combined);
      },
      () => {
        setCandidateRiders(DEFAULT_CREW_MEMBERS);
      }
    );

    return () => unsub();
  }, []);

  // Recalculate duration whenever startTime or endTime changes
  useEffect(() => {
    const computed = computeDuration(startTime, endTime);
    if (computed) {
      setDuration(computed);
    }
  }, [startTime, endTime]);

  // Recalculate total distance from segments
  const recalcDistance = (segs: SegmentFormState[]) => {
    let sum = 0;
    segs.forEach((s) => {
      const match = s.distance.match(/([0-9.]+)/);
      if (match) {
        sum += parseFloat(match[1]);
      }
    });
    if (sum > 0) {
      setTotalDist(`${sum.toFixed(1)} km`);
    }
  };

  // Dynamic Segment Handlers
  const handleAddSegment = () => {
    setSegments((prev) => {
      const last = prev[prev.length - 1];
      const nextNum = prev.length + 1;
      // Default the next 'from' to the previous segment's 'to'
      const nextFrom = last?.to || '';
      const updated = [...prev, { num: nextNum, from: nextFrom, to: '', distance: '' }];
      recalcDistance(updated);
      return updated;
    });
  };

  const handleRemoveSegment = (index: number) => {
    if (segments.length <= 1) return;
    setSegments((prev) => {
      const updated = prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, num: i + 1 }));
      recalcDistance(updated);
      return updated;
    });
  };

  const handleSegmentChange = (index: number, field: 'from' | 'to' | 'distance', value: string) => {
    setSegments((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      if (field === 'distance') {
        recalcDistance(updated);
      }
      return updated;
    });
  };

  // Crew multi-select handlers
  const handleToggleCrew = (riderName: string) => {
    setSelectedCrew((prev) =>
      prev.includes(riderName)
        ? prev.filter((m) => m !== riderName)
        : [...prev, riderName]
    );
  };

  const handleRemoveCrewChip = (riderName: string) => {
    setSelectedCrew((prev) => prev.filter((m) => m !== riderName));
  };

  const handleAddCustomCrew = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = customCrewInput.trim();
    if (clean && !selectedCrew.some((c) => c.toLowerCase() === clean.toLowerCase())) {
      setSelectedCrew((prev) => [...prev, clean]);
      setCustomCrewInput('');
    }
  };

  const handleSelectAllCrew = () => {
    const allNames = candidateRiders.map((r) => r.name);
    setSelectedCrew(allNames);
  };

  const handleClearCrew = () => {
    setSelectedCrew([]);
  };

  // Modal Openers
  const openCreateModal = () => {
    setEditingMissionId(null);
    const nextTag = String(missions.length + 1).padStart(3, '0');
    setMissionTag(nextTag);
    setMissionTitle('');

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    setDate(`${yyyy}-${mm}-${dd}`);

    setStartTime('03:30 PM');
    setEndTime('06:30 PM');
    setDuration('');
    setAvgSpeed('');
    setTotalDist('');
    setVariant('default');
    setCustomColor('#7c3aed');
    setIcon('fa-map-signs');
    setIsDuo(false);
    setSelectedCrew(['Ananta', 'Joy', 'Borson', 'Sahal']);
    setNotes('');
    setSegments([
      { num: 1, from: '', to: '', distance: '' },
    ]);
    setFormError(null);
    setCrewDropdownOpen(false);
    setModalOpen(true);
  };

  const openEditModal = (m: MissionReport) => {
    setEditingMissionId(m.id);
    setMissionTag(m.tag || m.num || '001');
    setMissionTitle(m.name || m.title || '');

    // Parse date
    if (m.date) {
      setDate(m.date);
    } else if (m.fullDate) {
      // Try to parse full date or keep string
      setDate(m.fullDate);
    } else {
      setDate(m.shortDate || '');
    }

    // Parse times
    setStartTime(m.startTime || '03:30 PM');
    setEndTime(m.endTime || '06:40 PM');

    if (!m.startTime && m.time) {
      const parts = m.time.split(/·|Finished|-|–/);
      if (parts.length >= 2) {
        setStartTime(parts[0].trim());
        setEndTime(parts[1].replace(/Finished/i, '').trim());
      }
    }

    setDuration(m.duration || '3h 10m');
    setAvgSpeed(m.avgSpeed || '~12.0 km/h');
    setTotalDist(m.totalDist || '37.7 km');
    setVariant((m.variant as any) || (m.customColor ? 'custom' : 'default'));
    setCustomColor(m.customColor || '#7c3aed');
    setIcon(m.icon || 'fa-map-signs');
    setIsDuo(!!m.isDuo);

    // Parse crew
    if (m.crewIds && m.crewIds.length > 0) {
      // Normalize to capitalized names
      const normalized = m.crewIds.map((c) => {
        const found = candidateRiders.find((r) => r.id.toLowerCase() === c.toLowerCase() || r.name.toLowerCase() === c.toLowerCase());
        return found ? found.name : c.charAt(0).toUpperCase() + c.slice(1);
      });
      setSelectedCrew(normalized);
    } else {
      setSelectedCrew(['Ananta', 'Joy']);
    }

    // Parse Notes / Disclaimer
    setNotes(m.notes || m.crewNote || m.disclaimer || '');

    // Parse segments with From, To, Distance
    if (m.segments && m.segments.length > 0) {
      const parsedSegments: SegmentFormState[] = m.segments.map((s, idx) => {
        let fromVal = s.from || '';
        let toVal = s.to || '';

        // If from/to not explicitly set, extract from s.segment (e.g. "Rajendrapur → Shimultoli")
        if (!fromVal && s.segment) {
          const split = s.segment.split(/→|->|to|—/);
          if (split.length >= 2) {
            fromVal = split[0].trim();
            toVal = split[1].trim();
          } else {
            fromVal = s.segment;
            toVal = '';
          }
        }

        return {
          num: s.num || idx + 1,
          from: fromVal,
          to: toVal,
          distance: s.distance || '',
        };
      });
      setSegments(parsedSegments);
    } else {
      setSegments([
        { num: 1, from: m.startLocation || '', to: m.destination || '', distance: m.totalDist || '' },
      ]);
    }

    setFormError(null);
    setCrewDropdownOpen(false);
    setModalOpen(true);
  };

  // Save Mission Report (Creation & Editing)
  const handleSaveMission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) {
      alert('Only the Super Admin can create or edit missions.');
      return;
    }

    if (!missionTitle.trim()) {
      setFormError('Please enter a Mission Title / Name.');
      return;
    }

    if (segments.length === 0) {
      setFormError('Please add at least one mission segment.');
      return;
    }

    try {
      setSaving(true);
      setFormError(null);

      // Auto-compute total distance if empty
      let currentTotalDist = totalDist.trim();
      if (!currentTotalDist) {
        let sum = 0;
        segments.forEach((s) => {
          const m = s.distance.match(/([0-9.]+)/);
          if (m) sum += parseFloat(m[1]);
        });
        currentTotalDist = sum > 0 ? `${sum.toFixed(1)} km` : '';
      }

      // Format date displays
      const { fullDate, shortDate } = formatDateDisplays(date);

      // Format time string
      const timeDisplay =
        startTime.trim() && endTime.trim()
          ? `${startTime.trim()} · Finished ${endTime.trim()}`
          : startTime.trim() || endTime.trim() || '';

      // Build structured segments with from, to, distance, and segment summary
      const formattedSegments: MissionSegment[] = segments
        .filter((s) => s.from.trim() || s.to.trim() || s.distance.trim())
        .map((s, idx) => ({
          num: idx + 1,
          from: s.from.trim(),
          to: s.to.trim(),
          distance: s.distance.trim() || '',
          segment: s.from.trim() && s.to.trim() ? `${s.from.trim()} → ${s.to.trim()}` : s.from.trim() || s.to.trim() || `Segment ${idx + 1}`,
        }));

      // Infer overall start location and destination from segments if provided
      const derivedStart = formattedSegments[0]?.from || '';
      const derivedDest = formattedSegments[formattedSegments.length - 1]?.to || '';

      const missionPayload: Record<string, any> = {
        num: missionTag.trim() || '001',
        tag: missionTag.trim() || '001',
        name: missionTitle.trim(),
        title: missionTitle.trim(),
        date: date.trim(),
        startTime: startTime.trim(),
        endTime: endTime.trim(),
        time: timeDisplay,
        fullDate: fullDate || date.trim(),
        shortDate: shortDate || date.trim(),
        duration: duration.trim(),
        avgSpeed: avgSpeed.trim(),
        totalDist: currentTotalDist,
        startLocation: derivedStart,
        destination: derivedDest,
        location: derivedStart && derivedDest ? `${derivedStart} to ${derivedDest}` : (derivedStart || derivedDest || ''),
        segments: formattedSegments,
        crewIds: selectedCrew,
        crewNote: notes.trim(),
        notes: notes.trim(),
        disclaimer: notes.trim(),
        icon: icon.trim() || 'fa-map-signs',
        variant,
        isDuo,
        status: 'PUBLISHED',
        createdBy: user?.uid || 'super-admin',
        updatedAt: new Date().toISOString(),
      };

      if (variant === 'custom') {
        missionPayload.customColor = customColor;
      } else if (editingMissionId) {
        missionPayload.customColor = deleteField();
      }

      // Ensure no undefined values exist in payload
      const sanitizedPayload: Record<string, any> = {};
      for (const [key, value] of Object.entries(missionPayload)) {
        if (value !== undefined) {
          sanitizedPayload[key] = value;
        }
      }

      if (editingMissionId) {
        await updateDoc(doc(db, 'missions', editingMissionId), sanitizedPayload);
      } else {
        sanitizedPayload.createdAt = new Date().toISOString();
        await addDoc(collection(db, 'missions'), sanitizedPayload);
      }

      setModalOpen(false);
    } catch (err: unknown) {
      console.error('Mission save error:', err);
      setFormError(err instanceof Error ? err.message : 'Failed to save mission');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMission = async (missionId: string, name: string) => {
    if (!isSuperAdmin) {
      alert('Only the Super Admin can delete missions.');
      return;
    }

    if (!confirm(`Are you sure you want to permanently delete Mission "${name}"?`)) return;

    try {
      const snap = await getDocs(collection(db, 'missions'));
      let foundDocId: string | null = null;

      snap.forEach((d) => {
        if (d.id === missionId || d.data().num === missionId || d.data().tag === missionId || d.data().name === name) {
          foundDocId = d.id;
        }
      });

      if (foundDocId) {
        await deleteDoc(doc(db, 'missions', foundDocId));
      } else {
        await deleteDoc(doc(db, 'missions', missionId));
      }

      setMissions((prev) => prev.filter((m) => m.id !== missionId && m.name !== name));
    } catch (err) {
      console.error('Error deleting mission:', err);
      alert('Failed to delete mission from database.');
    }
  };

  // Filtered candidate crew based on search term
  const filteredCandidates = candidateRiders.filter((r) =>
    r.name.toLowerCase().includes(crewSearch.toLowerCase())
  );

  return (
    <div>
      {/* Hero Header */}
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
            <span className="stat-label">total expedition dist</span>
          </div>
        </div>
        <div className="stat-item">
          <i className="fas fa-bolt stat-icon"></i>
          <div className="stat-content">
            <span className="stat-number">
              {(
                missions.reduce((acc, m) => {
                  const match = m.avgSpeed?.match(/([0-9.]+)/);
                  return acc + (match ? parseFloat(match[1]) : 0);
                }, 0) / (missions.length || 1)
              ).toFixed(1)}{' '}
              km/h
            </span>
            <span className="stat-label">avg fleet speed</span>
          </div>
        </div>
        <div className="stat-item">
          <i className="fas fa-stopwatch stat-icon"></i>
          <div className="stat-content">
            <span className="stat-number">
              {missions.reduce((acc, m) => {
                const matchH = m.duration?.match(/(\d+)h/);
                const matchM = m.duration?.match(/(\d+)m/);
                const hours = matchH ? parseInt(matchH[1], 10) : 0;
                const mins = matchM ? parseInt(matchM[1], 10) : 0;
                return acc + hours + mins / 60;
              }, 0).toFixed(0)}{' '}
              hrs
            </span>
            <span className="stat-label">total saddle time</span>
          </div>
        </div>
      </div>

      {/* Mission Log Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h2 className="text-xl font-black text-zinc-900 tracking-tight flex items-center gap-2">
          <i className="fas fa-list-alt text-amber-500"></i> Authenticated Group Mission Records
        </h2>
        <span className="text-xs font-bold text-zinc-500">
          Showing {missions.length} recorded expedition{missions.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="text-center py-12 text-zinc-500 font-bold text-sm">
          <i className="fas fa-spinner fa-spin text-2xl mb-2 block"></i> Loading mission records...
        </div>
      )}

      {/* MISSIONS LIST */}
      {!loading && (
        <div className="space-y-8">
          {missions.map((m) => {
            let accentClass = '';
            if (m.variant === 'alt-accent') accentClass = 'alt-accent';
            else if (m.variant === 'green-accent') accentClass = 'green-accent';

            const isCustom = m.variant === 'custom' && !!m.customColor;
            const cColor = m.customColor || '#7c3aed';

            const cardStyle: React.CSSProperties = isCustom
              ? {
                  borderColor: cColor,
                  boxShadow: `0 10px 0 ${cColor}44`,
                }
              : {};

            const badgeStyle: React.CSSProperties = isCustom
              ? {
                  backgroundColor: cColor,
                  borderColor: cColor,
                  color: '#ffffff',
                }
              : {};

            const iconStyle: React.CSSProperties = isCustom
              ? {
                  color: cColor,
                }
              : {};

            const missionTagDisplay = m.tag || m.num || '001';
            const missionNotes = m.notes || m.crewNote || m.disclaimer || '';

            return (
              <div
                key={m.id || m.num}
                className={`mission-report ${accentClass} relative group`}
                style={cardStyle}
              >
                {/* Super Admin Control Buttons */}
                {isSuperAdmin && (
                  <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
                    <button
                      type="button"
                      onClick={() => openEditModal(m)}
                      title="Edit Mission Details"
                      className="px-3 py-1.5 rounded-xl bg-white border-2 border-[#1e1e1e] text-xs font-black text-zinc-800 hover:bg-[#f9c74f] shadow-[0_2px_0_#1e1e1e] transition flex items-center gap-1.5 cursor-pointer"
                    >
                      <i className="fas fa-pencil-alt text-amber-700"></i> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteMission(m.id, m.name || m.title)}
                      title="Delete Mission"
                      className="px-3 py-1.5 rounded-xl bg-rose-50 border-2 border-rose-600 text-xs font-black text-rose-800 hover:bg-rose-100 shadow-[0_2px_0_#991b1b] transition flex items-center gap-1.5 cursor-pointer"
                    >
                      <i className="fas fa-trash-alt"></i> Delete
                    </button>
                  </div>
                )}

                <div className="report-badge" style={badgeStyle}>
                  <i className="fas fa-flag" style={isCustom ? { color: '#ffffff' } : {}}></i> Mission {missionTagDisplay}
                </div>

                <h2>
                  <i className={`fas ${m.icon || 'fa-map-signs'}`} style={iconStyle}></i> {m.name || m.title}
                  {m.isDuo && (
                    <span
                      className="duo-badge"
                      style={isCustom ? { backgroundColor: cColor, borderColor: cColor } : {}}
                    >
                      <i className="fas fa-user-friends"></i> Duo Ride
                    </span>
                  )}
                </h2>

                <div className="report-meta">
                  {(m.fullDate || m.date || m.shortDate) && (
                    <span>
                      <i className="fas fa-calendar-alt" style={iconStyle}></i> {m.fullDate || m.date || m.shortDate}
                    </span>
                  )}
                  {(m.startTime || m.endTime || m.time) && (
                    <span>
                      <i className="fas fa-clock" style={iconStyle}></i>{' '}
                      {m.startTime && m.endTime ? `${m.startTime} – ${m.endTime}` : m.time}
                    </span>
                  )}
                  {m.duration && (
                    <span>
                      <i className="fas fa-hourglass-half" style={iconStyle}></i> Duration: {m.duration}
                    </span>
                  )}
                  {m.avgSpeed && (
                    <span>
                      <i className="fas fa-tachometer-alt" style={iconStyle}></i> Avg speed: {m.avgSpeed}
                    </span>
                  )}
                </div>

                {/* Segments Route Table with From, To, and Distance */}
                {m.segments && m.segments.length > 0 && (
                  <table className="route-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>From</th>
                        <th>To</th>
                        <th style={{ textAlign: 'right' }}>Distance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.segments.map((seg, sIdx) => {
                        const fromText = seg.from || (seg.segment ? seg.segment.split(/→|->|to/)[0]?.trim() : `Leg ${sIdx + 1}`);
                        const toText = seg.to || (seg.segment ? seg.segment.split(/→|->|to/)[1]?.trim() : '');

                        return (
                          <tr key={sIdx}>
                            <td>
                              <span
                                className="seg-icon"
                                style={
                                  isCustom
                                    ? {
                                        backgroundColor: `${cColor}22`,
                                        color: cColor,
                                        borderColor: `${cColor}55`,
                                      }
                                    : {}
                                }
                              >
                                {seg.num || sIdx + 1}
                              </span>
                            </td>
                            <td className="font-bold text-zinc-900">
                              <span className="inline-flex items-center gap-1">
                                <i className="fas fa-map-pin text-rose-500 text-[10px]"></i>
                                <span>{fromText}</span>
                              </span>
                            </td>
                            <td className="font-bold text-zinc-800">
                              {toText ? (
                                <span className="inline-flex items-center gap-1">
                                  <i className="fas fa-flag text-emerald-600 text-[10px]"></i>
                                  <span>{toText}</span>
                                </span>
                              ) : (
                                <span className="text-zinc-400 italic">—</span>
                              )}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <span
                                className="km-badge"
                                style={
                                  isCustom
                                    ? {
                                        backgroundColor: cColor,
                                        color: '#ffffff',
                                      }
                                    : {}
                                }
                              >
                                {seg.distance}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td
                          colSpan={3}
                          style={isCustom ? { backgroundColor: cColor, borderColor: cColor } : {}}
                        >
                          <i className="fas fa-route"></i> TOTAL EXPEDITION DISTANCE
                        </td>
                        <td
                          style={{
                            textAlign: 'right',
                            ...(isCustom ? { backgroundColor: cColor, borderColor: cColor } : {}),
                          }}
                        >
                          <span
                            className="total-km"
                            style={isCustom ? { color: '#ffffff' } : {}}
                          >
                            {m.totalDist}
                          </span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}

                {/* Crew List Section */}
                <div className="crew-list">
                  <strong>
                    <i className="fas fa-users"></i> Crew ({m.crewIds ? m.crewIds.length : 0}):
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

                  {/* Optional Notes / Disclaimer Callout */}
                  {missionNotes && (
                    <div className="crew-note mt-3">
                      <i className="fas fa-info-circle text-amber-700"></i>
                      <span className="font-semibold">{missionNotes}</span>
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
          <div className="modal max-w-3xl w-full p-6 sm:p-9 border-3 border-[#1e1e1e] bg-white rounded-3xl shadow-[0_10px_0_#1e1e1e] max-h-[92vh] overflow-y-auto">
            <button
              type="button"
              className="modal-close"
              onClick={() => setModalOpen(false)}
              aria-label="Close"
            >
              <i className="fas fa-times"></i>
            </button>

            <div className="flex items-center gap-3 mb-5 pb-3 border-b-2 border-zinc-200">
              <div className="w-12 h-12 rounded-2xl bg-[#1e1e1e] text-[#f9c74f] border-2 border-[#1e1e1e] flex items-center justify-center text-xl shadow-[0_3px_0_#1e1e1e] shrink-0">
                <i className="fas fa-flag-checkered"></i>
              </div>
              <div>
                <h2 className="text-xl sm:text-2xl font-black text-zinc-900 tracking-tight">
                  {editingMissionId ? 'Edit Mission Report' : 'Create New Mission Report'}
                </h2>
                <p className="text-xs text-zinc-600">
                  Configure tags, schedule, dynamic route segments, crew roster, notes, and style variant.
                </p>
              </div>
            </div>

            {formError && (
              <div className="p-3 mb-4 bg-red-50 border-2 border-red-500 rounded-2xl text-xs font-bold text-red-700 flex items-center gap-2">
                <i className="fas fa-exclamation-circle"></i>
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveMission} className="space-y-5">
              {/* 1. MISSION TAG / ID & TITLE */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider mb-1 text-zinc-800">
                    Mission Tag / ID *
                  </label>
                  <input
                    type="text"
                    required
                    value={missionTag}
                    onChange={(e) => setMissionTag(e.target.value)}
                    placeholder="e.g. 004 or M-004"
                    className="neo-input text-sm w-full p-2.5 font-mono font-bold"
                  />
                  <span className="text-[10px] text-zinc-500 font-medium mt-0.5 block">
                    Displays on card badge
                  </span>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-black uppercase tracking-wider mb-1 text-zinc-800">
                    Mission Title / Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={missionTitle}
                    onChange={(e) => setMissionTitle(e.target.value)}
                    placeholder="e.g. Rajendrapur to Paglar Ban Sprint"
                    className="neo-input text-sm w-full p-2.5 font-bold"
                  />
                  <span className="text-[10px] text-zinc-500 font-medium mt-0.5 block">
                    Main headline for the ride report
                  </span>
                </div>
              </div>

              {/* 2. DATE, START TIME, AND END TIME */}
              <div className="p-4 bg-amber-50/60 rounded-2xl border-2 border-zinc-900 shadow-[0_2px_0_#d6d2ca] space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-zinc-900 text-[#f9c74f] flex items-center justify-center text-xs font-black">
                    <i className="fas fa-calendar-alt"></i>
                  </span>
                  <span className="text-xs font-black uppercase tracking-wider text-zinc-900">
                    Mission Schedule: Date, Start Time &amp; End Time
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-black uppercase tracking-wider mb-1 text-zinc-700">
                      Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="neo-input text-xs sm:text-sm w-full p-2.5 font-bold bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-black uppercase tracking-wider mb-1 text-zinc-700">
                      Start Time *
                    </label>
                    <input
                      type="text"
                      required
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      placeholder="e.g. 03:30 PM"
                      className="neo-input text-xs sm:text-sm w-full p-2.5 font-bold bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-black uppercase tracking-wider mb-1 text-zinc-700">
                      End Time *
                    </label>
                    <input
                      type="text"
                      required
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      placeholder="e.g. 06:40 PM"
                      className="neo-input text-xs sm:text-sm w-full p-2.5 font-bold bg-white"
                    />
                  </div>
                </div>

                {/* Duration & Speed Summary */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  <div>
                    <label className="block text-[11px] font-black uppercase tracking-wider mb-1 text-zinc-700">
                      Calculated Duration
                    </label>
                    <input
                      type="text"
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                      placeholder="e.g. 3h 10m"
                      className="neo-input text-xs w-full p-2 bg-white font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-black uppercase tracking-wider mb-1 text-zinc-700">
                      Avg Fleet Speed
                    </label>
                    <input
                      type="text"
                      value={avgSpeed}
                      onChange={(e) => setAvgSpeed(e.target.value)}
                      placeholder="e.g. ~12.4 km/h"
                      className="neo-input text-xs w-full p-2 bg-white font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-black uppercase tracking-wider mb-1 text-zinc-700">
                      Total Distance (Auto-Summed)
                    </label>
                    <input
                      type="text"
                      value={totalDist}
                      onChange={(e) => setTotalDist(e.target.value)}
                      placeholder="e.g. 37.7 km"
                      className="neo-input text-xs w-full p-2 bg-white font-black text-amber-950"
                    />
                  </div>
                </div>
              </div>

              {/* 3. DYNAMIC MISSION SEGMENTS (+ Add Segment) */}
              <div className="p-4 bg-zinc-50 rounded-2xl border-2 border-zinc-900 shadow-[0_2px_0_#d6d2ca] space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-zinc-900 text-[#f9c74f] flex items-center justify-center text-xs font-black">
                      <i className="fas fa-route"></i>
                    </span>
                    <div>
                      <span className="text-xs font-black uppercase tracking-wider text-zinc-900 block">
                        Mission Segments ({segments.length} Legs)
                      </span>
                      <span className="text-[10px] text-zinc-500 font-medium">
                        Specify From, To, and Distance (km) for each route leg.
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleAddSegment}
                    className="btn-primary py-1.5 px-3.5 text-xs font-black flex items-center gap-1.5 bg-[#f9c74f] text-[#1e1e1e] border-2 border-zinc-900 rounded-xl shadow-[0_2px_0_#1e1e1e] hover:bg-amber-400 transition cursor-pointer"
                  >
                    <i className="fas fa-plus"></i> Add Segment
                  </button>
                </div>

                <div className="space-y-2.5 pt-1">
                  {segments.map((seg, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-white rounded-xl border-2 border-zinc-200 hover:border-zinc-900 transition flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shadow-xs"
                    >
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="w-6 h-6 rounded-full bg-zinc-900 text-[#f9c74f] text-xs font-black flex items-center justify-center shrink-0">
                          {seg.num}
                        </span>
                        <span className="text-[10px] font-black uppercase text-zinc-500 sm:hidden">
                          Segment #{seg.num}
                        </span>
                      </div>

                      {/* FROM */}
                      <div className="flex-1 min-w-[130px]">
                        <label className="block text-[9px] font-black uppercase tracking-wider text-zinc-500 mb-0.5">
                          From
                        </label>
                        <div className="relative">
                          <i className="fas fa-map-marker-alt absolute left-2.5 top-2.5 text-rose-500 text-[10px]"></i>
                          <input
                            type="text"
                            required
                            value={seg.from}
                            onChange={(e) => handleSegmentChange(idx, 'from', e.target.value)}
                            placeholder="e.g. Rajendrapur"
                            className="w-full pl-7 pr-2.5 py-1.5 text-xs font-bold rounded-lg border border-zinc-300 focus:border-zinc-900 outline-none"
                          />
                        </div>
                      </div>

                      {/* ARROW */}
                      <div className="hidden sm:flex items-center justify-center text-zinc-400 text-xs px-1">
                        <i className="fas fa-arrow-right"></i>
                      </div>

                      {/* TO */}
                      <div className="flex-1 min-w-[130px]">
                        <label className="block text-[9px] font-black uppercase tracking-wider text-zinc-500 mb-0.5">
                          To
                        </label>
                        <div className="relative">
                          <i className="fas fa-flag-checkered absolute left-2.5 top-2.5 text-emerald-600 text-[10px]"></i>
                          <input
                            type="text"
                            required
                            value={seg.to}
                            onChange={(e) => handleSegmentChange(idx, 'to', e.target.value)}
                            placeholder="e.g. Paglar Ban"
                            className="w-full pl-7 pr-2.5 py-1.5 text-xs font-bold rounded-lg border border-zinc-300 focus:border-zinc-900 outline-none"
                          />
                        </div>
                      </div>

                      {/* DISTANCE (KM) */}
                      <div className="w-full sm:w-28 shrink-0">
                        <label className="block text-[9px] font-black uppercase tracking-wider text-zinc-500 mb-0.5">
                          Distance (km)
                        </label>
                        <input
                          type="text"
                          required
                          value={seg.distance}
                          onChange={(e) => handleSegmentChange(idx, 'distance', e.target.value)}
                          placeholder="e.g. 12.6 km"
                          className="w-full px-2.5 py-1.5 text-xs font-black text-right rounded-lg border border-zinc-300 focus:border-zinc-900 outline-none bg-amber-50/50"
                        />
                      </div>

                      {/* REMOVE BUTTON */}
                      <div className="flex justify-end sm:justify-center items-center shrink-0">
                        {segments.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => handleRemoveSegment(idx)}
                            className="p-1.5 text-xs text-rose-600 hover:text-white hover:bg-rose-600 rounded-lg border border-rose-200 transition cursor-pointer"
                            title="Remove Segment"
                          >
                            <i className="fas fa-trash-alt"></i>
                          </button>
                        ) : (
                          <span className="w-7 h-7"></span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-1 text-xs font-bold text-zinc-600">
                  <button
                    type="button"
                    onClick={handleAddSegment}
                    className="text-amber-800 hover:underline font-black text-xs inline-flex items-center gap-1 cursor-pointer"
                  >
                    <i className="fas fa-plus-circle text-amber-600"></i> + Add Another Route Leg
                  </button>
                  <span>Total Calculated: <strong className="text-zinc-900">{totalDist}</strong></span>
                </div>
              </div>

              {/* 4. CREW MEMBERS: MULTI-SELECT DROPDOWN */}
              <div className="p-4 bg-zinc-50 rounded-2xl border-2 border-zinc-900 shadow-[0_2px_0_#d6d2ca] space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-zinc-900 text-[#f9c74f] flex items-center justify-center text-xs font-black">
                      <i className="fas fa-users"></i>
                    </span>
                    <div>
                      <label className="text-xs font-black uppercase tracking-wider text-zinc-900 block">
                        Crew Members (Multi-Select) *
                      </label>
                      <span className="text-[10px] text-zinc-500 font-medium">
                        Choose riders participating in this mission.
                      </span>
                    </div>
                  </div>

                  <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-zinc-200 text-zinc-800 border border-zinc-300">
                    {selectedCrew.length} Selected
                  </span>
                </div>

                {/* Selected Crew Chips */}
                <div className="flex flex-wrap gap-1.5 min-h-[32px] p-2 bg-white rounded-xl border border-zinc-300">
                  {selectedCrew.length === 0 ? (
                    <span className="text-xs text-zinc-400 italic">No crew members selected yet. Click below to select riders.</span>
                  ) : (
                    selectedCrew.map((name) => (
                      <span
                        key={name}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-amber-100 border border-amber-400 text-amber-950 text-xs font-bold shadow-xs"
                      >
                        <span className="w-4 h-4 rounded-full bg-zinc-900 text-[#f9c74f] flex items-center justify-center text-[9px] font-black">
                          {name.charAt(0).toUpperCase()}
                        </span>
                        <span>{name}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveCrewChip(name)}
                          className="hover:text-red-700 text-amber-800 font-black ml-0.5 cursor-pointer text-sm"
                          title={`Remove ${name}`}
                        >
                          &times;
                        </button>
                      </span>
                    ))
                  )}
                </div>

                {/* Multi-select Dropdown Toggle & Popover */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setCrewDropdownOpen((prev) => !prev)}
                    className="w-full py-2.5 px-3.5 bg-white rounded-xl border-2 border-zinc-900 text-left font-bold text-xs flex items-center justify-between shadow-xs cursor-pointer hover:bg-zinc-50"
                  >
                    <span className="flex items-center gap-2 text-zinc-800">
                      <i className="fas fa-user-plus text-amber-600"></i>
                      <span>
                        {selectedCrew.length > 0
                          ? `Choose / modify crew roster (${selectedCrew.length} selected)`
                          : 'Select crew members from directory...'}
                      </span>
                    </span>
                    <i className={`fas ${crewDropdownOpen ? 'fa-chevron-up' : 'fa-chevron-down'} text-zinc-500`}></i>
                  </button>

                  {crewDropdownOpen && (
                    <div className="mt-2 p-3 bg-white rounded-2xl border-2 border-zinc-900 shadow-[0_6px_0_#d6d2ca] space-y-3 z-20">
                      {/* Search Bar & Quick Buttons */}
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <i className="fas fa-search absolute left-2.5 top-2.5 text-zinc-400 text-xs"></i>
                          <input
                            type="text"
                            value={crewSearch}
                            onChange={(e) => setCrewSearch(e.target.value)}
                            placeholder="Search member name..."
                            className="w-full pl-7 pr-2.5 py-1.5 text-xs font-medium rounded-lg border border-zinc-300 outline-none"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleSelectAllCrew}
                          className="text-[10px] font-bold px-2 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200 border border-zinc-300 cursor-pointer"
                        >
                          Select All
                        </button>
                        <button
                          type="button"
                          onClick={handleClearCrew}
                          className="text-[10px] font-bold px-2 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200 border border-zinc-300 cursor-pointer"
                        >
                          Clear
                        </button>
                      </div>

                      {/* Candidate Members List with Checkboxes */}
                      <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                        {filteredCandidates.map((rider) => {
                          const isSelected = selectedCrew.includes(rider.name);
                          return (
                            <label
                              key={rider.id}
                              className={`flex items-center justify-between p-2 rounded-xl border transition cursor-pointer text-xs ${
                                isSelected
                                  ? 'bg-amber-50 border-amber-400 text-amber-950 font-bold'
                                  : 'bg-zinc-50/60 border-zinc-200 text-zinc-700 hover:bg-zinc-100'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => handleToggleCrew(rider.name)}
                                  className="w-4 h-4 rounded text-zinc-900 cursor-pointer"
                                />
                                <span className="w-5 h-5 rounded-full bg-zinc-900 text-[#f9c74f] flex items-center justify-center text-[10px] font-black">
                                  {rider.name.charAt(0).toUpperCase()}
                                </span>
                                <span>{rider.name}</span>
                              </div>

                              {rider.role && (
                                <span className="text-[9px] uppercase px-1.5 py-0.5 rounded-md bg-zinc-200 text-zinc-700 font-bold">
                                  {rider.role}
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>

                      {/* Add Custom Guest Rider Name */}
                      <div className="pt-2 border-t border-zinc-200 flex items-center gap-2">
                        <input
                          type="text"
                          value={customCrewInput}
                          onChange={(e) => setCustomCrewInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddCustomCrew();
                            }
                          }}
                          placeholder="Type custom guest rider name..."
                          className="flex-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-zinc-300 outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => handleAddCustomCrew()}
                          className="px-3 py-1.5 text-xs font-black bg-[#1e1e1e] text-[#f9c74f] rounded-lg cursor-pointer"
                        >
                          + Add
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 5. OPTIONAL NOTES / DISCLAIMER */}
              <div className="p-4 bg-zinc-50 rounded-2xl border-2 border-zinc-900 shadow-[0_2px_0_#d6d2ca] space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-zinc-900 text-[#f9c74f] flex items-center justify-center text-xs font-black">
                    <i className="fas fa-sticky-note"></i>
                  </span>
                  <div>
                    <label className="text-xs font-black uppercase tracking-wider text-zinc-900 block">
                      Optional Notes / Disclaimer
                    </label>
                    <span className="text-[10px] text-zinc-500 font-medium">
                      Special route context, safety advisory, rider notes, or trail disclaimers.
                    </span>
                  </div>
                </div>

                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Helmet and lights mandatory. Fariq joined for this mission. Pace controlled at 25km/h. Road conditions dry."
                  className="neo-input text-xs w-full p-2.5 bg-white font-medium resize-none"
                />
              </div>

              {/* 6. STYLE VARIANT (WITH CUSTOM OPTION & COLOR PICKER / HEX) */}
              <div className="p-4 bg-zinc-50 rounded-2xl border-2 border-zinc-900 shadow-[0_2px_0_#d6d2ca] space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-zinc-900 text-[#f9c74f] flex items-center justify-center text-xs font-black">
                    <i className="fas fa-paint-brush"></i>
                  </span>
                  <div>
                    <label className="text-xs font-black uppercase tracking-wider text-zinc-900 block">
                      Style Variant &amp; Accent Presentation
                    </label>
                    <span className="text-[10px] text-zinc-500 font-medium">
                      Select built-in accents or choose Custom to pick any color.
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-black uppercase tracking-wider mb-1 text-zinc-700">
                      Style Variant
                    </label>
                    <select
                      value={variant}
                      onChange={(e) => setVariant(e.target.value as any)}
                      className="neo-input text-xs sm:text-sm w-full p-2.5 font-bold cursor-pointer bg-white"
                    >
                      <option value="default">Default Yellow Accent</option>
                      <option value="alt-accent">Orange Accent</option>
                      <option value="green-accent">Green Accent</option>
                      <option value="custom">🎨 Custom Color (Choose Any Color)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-black uppercase tracking-wider mb-1 text-zinc-700">
                      Header Icon
                    </label>
                    <select
                      value={icon}
                      onChange={(e) => setIcon(e.target.value)}
                      className="neo-input text-xs sm:text-sm w-full p-2.5 font-bold cursor-pointer bg-white"
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
                      className="w-4 h-4 rounded text-zinc-900 cursor-pointer"
                    />
                    <label htmlFor="isDuoCheck" className="text-xs font-bold text-zinc-800 cursor-pointer">
                      Duo Ride Badge
                    </label>
                  </div>
                </div>

                {/* Custom Color Selector & Palette (When variant is 'custom') */}
                {variant === 'custom' && (
                  <div className="p-3.5 bg-purple-50/70 rounded-2xl border-2 border-zinc-900 shadow-[0_2px_0_#d6d2ca] space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-lg bg-zinc-900 text-[#f9c74f] flex items-center justify-center text-[10px]">
                          <i className="fas fa-palette"></i>
                        </span>
                        <span className="text-xs font-black uppercase tracking-wider text-zinc-900">
                          Custom Mission Color Selection
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className="w-5 h-5 rounded-full border-2 border-zinc-900 shadow-xs inline-block"
                          style={{ backgroundColor: customColor }}
                        ></span>
                        <span className="font-mono text-xs font-black text-zinc-800 uppercase bg-white px-2 py-0.5 rounded-lg border border-zinc-300">
                          {customColor}
                        </span>
                      </div>
                    </div>

                    {/* Color Picker Input & Hex */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                        <input
                          type="color"
                          value={customColor}
                          onChange={(e) => setCustomColor(e.target.value)}
                          className="w-12 h-10 rounded-xl border-2 border-zinc-900 cursor-pointer p-0.5 bg-white shrink-0"
                          title="Pick custom color from palette"
                        />
                        <input
                          type="text"
                          value={customColor}
                          onChange={(e) => setCustomColor(e.target.value)}
                          placeholder="#7C3AED"
                          className="neo-input text-xs font-mono font-bold flex-1 p-2 bg-white uppercase"
                          maxLength={7}
                        />
                      </div>

                      {/* Live Preview Badge */}
                      <div
                        className="px-3.5 py-1.5 rounded-full border-2 text-white font-black text-xs flex items-center gap-1.5 shadow-xs shrink-0"
                        style={{
                          backgroundColor: customColor,
                          borderColor: customColor,
                        }}
                      >
                        <i className="fas fa-flag"></i>
                        <span>Mission {missionTag || '001'} Accent Preview</span>
                      </div>
                    </div>

                    {/* Preset Quick Swatches */}
                    <div>
                      <span className="text-[10px] font-black uppercase text-zinc-500 block mb-1.5">
                        Curated Race Color Swatches:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {PRESET_CUSTOM_COLORS.map((swatch) => (
                          <button
                            key={swatch.hex}
                            type="button"
                            onClick={() => setCustomColor(swatch.hex)}
                            className={`px-2.5 py-1 rounded-xl text-[10px] font-black border transition flex items-center gap-1.5 cursor-pointer shadow-xs ${
                              customColor.toLowerCase() === swatch.hex.toLowerCase()
                                ? 'ring-2 ring-zinc-900 ring-offset-1 font-extrabold scale-105'
                                : 'hover:opacity-90'
                            }`}
                            style={{
                              backgroundColor: swatch.hex,
                              color: '#ffffff',
                              borderColor: '#1e1e1e',
                            }}
                          >
                            <span
                              className="w-2 h-2 rounded-full border border-white/60"
                              style={{ backgroundColor: swatch.hex }}
                            ></span>
                            <span>{swatch.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Form Actions */}
              <div className="flex justify-end gap-2 pt-3 border-t-2 border-zinc-200">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="btn-secondary py-2.5 px-5 text-xs font-bold cursor-pointer"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary py-2.5 px-6 text-xs sm:text-sm font-black flex items-center gap-2 cursor-pointer shadow-[0_3px_0_#1e1e1e]"
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
