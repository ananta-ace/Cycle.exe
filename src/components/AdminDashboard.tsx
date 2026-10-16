import React, { useState, useEffect } from 'react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  updateDoc,
  doc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { ContentReport, MissionReport } from '../types';
import { missionMetaList } from '../data';

export const AdminDashboard: React.FC = () => {
  const { isAdmin } = useAuth();
  const [reports, setReports] = useState<ContentReport[]>([]);
  const [loadingReports, setLoadingReports] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');

  useEffect(() => {
    const q = query(collection(db, 'reports'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: ContentReport[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<ContentReport, 'id'>) }));
        setReports(list);
        setLoadingReports(false);
      },
      (err) => {
        console.error('Error listening to reports:', err);
        setLoadingReports(false);
      }
    );

    return () => unsub();
  }, []);

  const handleUpdateReportStatus = async (
    reportId: string,
    newStatus: 'REVIEWED' | 'DISMISSED' | 'ACTION_TAKEN',
    notes: string = ''
  ) => {
    try {
      await updateDoc(doc(db, 'reports', reportId), {
        status: newStatus,
        moderatorNotes: notes || `Reviewed by moderator at ${new Date().toLocaleTimeString()}`,
      });
    } catch (err) {
      console.error('Failed to update report:', err);
    }
  };

  if (!isAdmin) {
    return (
      <div className="neo-card max-w-md mx-auto text-center py-12">
        <i className="fas fa-shield-alt text-4xl text-red-600 mb-3"></i>
        <h2 className="text-xl font-bold mb-1">Access Restricted</h2>
        <p className="text-xs text-zinc-600">The Admin Dashboard is only accessible to authorized moderators.</p>
      </div>
    );
  }

  const filteredReports = reports.filter((r) => {
    if (filterStatus === 'ALL') return true;
    return r.status === filterStatus;
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Hero */}
      <div className="hero mb-6">
        <h1>
          <i className="fas fa-shield-alt"></i> Moderator Dashboard
        </h1>
        <p>Review community reports, handle bullying or spam, and monitor content quality.</p>
      </div>

      {/* Moderation Queue */}
      <div className="neo-card">
        <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-red-100 text-red-600 border-2 border-red-600 flex items-center justify-center font-bold">
              <i className="fas fa-flag"></i>
            </div>
            <div>
              <h2 className="text-xl font-bold">Community Moderation Queue</h2>
              <p className="text-xs text-zinc-600">Review reported comments and posts for policy violations.</p>
            </div>
          </div>

          <div className="flex gap-2">
            {['ALL', 'PENDING', 'REVIEWED', 'DISMISSED'].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setFilterStatus(st)}
                className={`text-xs font-bold px-3 py-1.5 rounded-full border border-zinc-900 transition ${
                  filterStatus === st ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-800 hover:bg-zinc-100'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        {loadingReports ? (
          <div className="text-center py-8 text-xs text-zinc-500 font-bold">
            <i className="fas fa-spinner fa-spin mr-2"></i> Loading reports...
          </div>
        ) : filteredReports.length === 0 ? (
          <div className="p-8 text-center text-zinc-500 italic bg-[#f6f3ee] rounded-2xl border border-dashed border-zinc-300">
            <i className="fas fa-check-circle text-2xl text-emerald-600 mb-2 block"></i>
            No reported content matching this filter.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredReports.map((report) => (
              <div
                key={report.id}
                className="p-4 bg-white border-2 border-zinc-900 rounded-2xl shadow-[0_4px_0_#d6d2ca]"
              >
                <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider bg-zinc-100 px-2.5 py-0.5 rounded-md border border-zinc-300">
                      {report.targetType}
                    </span>
                    <span
                      className={`text-[0.65rem] font-bold uppercase px-2 py-0.5 rounded-full ${
                        report.status === 'PENDING'
                          ? 'bg-amber-100 text-amber-800'
                          : report.status === 'ACTION_TAKEN'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {report.status}
                    </span>
                  </div>
                  <span className="text-xs text-zinc-500">
                    Reported {new Date(report.createdAt).toLocaleDateString()}
                  </span>
                </div>

                <div className="text-sm font-bold text-red-700 mb-1">
                  <i className="fas fa-exclamation-triangle mr-1"></i> {report.reason}
                </div>

                <div className="p-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-xs text-zinc-700 italic mb-3">
                  &quot;{report.targetExcerpt}&quot;
                </div>

                <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-zinc-200">
                  <span className="text-[0.7rem] text-zinc-500">
                    Reported by: {report.reporterEmail}
                  </span>

                  <div className="flex gap-2">
                    {report.status === 'PENDING' && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleUpdateReportStatus(report.id, 'DISMISSED', 'Reviewed - no violation')}
                          className="btn-secondary text-xs py-1 px-3"
                        >
                          <i className="fas fa-times text-zinc-500"></i> Dismiss
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUpdateReportStatus(report.id, 'REVIEWED', 'Reviewed by moderator')}
                          className="btn-primary text-xs py-1 px-3 font-bold"
                        >
                          <i className="fas fa-check"></i> Mark Reviewed
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Published Missions Monitor */}
      <div className="neo-card">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 border-2 border-emerald-700 flex items-center justify-center font-bold">
              <i className="fas fa-flag-checkered"></i>
            </div>
            <div>
              <h2 className="text-lg font-bold">Published Missions Overview</h2>
              <p className="text-xs text-zinc-600">Active and past group rides visible to the community.</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {missionMetaList.map((m: MissionReport) => (
            <div key={m.id} className="p-3.5 bg-[#f6f3ee] border-2 border-zinc-900 rounded-2xl">
              <div className="text-xs font-bold uppercase text-[#b45309] mb-1">
                Mission {m.num || m.id}
              </div>
              <div className="font-bold text-sm mb-1">{m.name || m.title}</div>
              <div className="text-xs text-zinc-600 mb-2">
                <i className="fas fa-road mr-1"></i> {m.totalDist || `${m.distanceTargetKm} km`}
              </div>
              <span className="text-[0.65rem] font-bold uppercase bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-400">
                {m.status || 'PUBLISHED'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
