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
import { ContentReport, AdminMembershipApplication } from '../types';

export const AdminDashboard: React.FC = () => {
  const { user, profile, isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState<'reports' | 'applications'>('applications');

  // Reports
  const [reports, setReports] = useState<ContentReport[]>([]);
  const [loadingReports, setLoadingReports] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');

  // Applications
  const [applications, setApplications] = useState<AdminMembershipApplication[]>([]);
  const [loadingApps, setLoadingApps] = useState(true);
  const [recommendComments, setRecommendComments] = useState<Record<string, string>>({});

  useEffect(() => {
    const qReports = query(collection(db, 'reports'), orderBy('createdAt', 'desc'));
    const unsubReports = onSnapshot(
      qReports,
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

    const qApps = query(collection(db, 'applications'), orderBy('createdAt', 'desc'));
    const unsubApps = onSnapshot(
      qApps,
      (snap) => {
        const list: AdminMembershipApplication[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<AdminMembershipApplication, 'id'>) }));
        setApplications(list);
        setLoadingApps(false);
      },
      (err) => {
        console.error('Error listening to applications in AdminDashboard:', err);
        setLoadingApps(false);
      }
    );

    return () => {
      unsubReports();
      unsubApps();
    };
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

  const handleAddRecommendation = async (
    app: AdminMembershipApplication,
    recommendation: 'APPROVE' | 'REJECT'
  ) => {
    if (!user) return;
    const comment = recommendComments[app.id]?.trim() || (recommendation === 'APPROVE' ? 'Rider looks experienced and friendly!' : 'More active ride logs recommended.');

    const newRec = {
      adminId: user.uid,
      adminName: profile?.displayName || user.displayName || 'Moderator',
      recommendation,
      comment,
      createdAt: new Date().toISOString(),
    };

    const existing = (app.adminRecommendations || []).filter((r) => r.adminId !== user.uid);
    const updated = [...existing, newRec];

    try {
      await updateDoc(doc(db, 'applications', app.id), {
        adminRecommendations: updated,
        updatedAt: new Date().toISOString(),
      });
      setRecommendComments((prev) => ({ ...prev, [app.id]: '' }));
      alert(`Recommendation (${recommendation}) submitted for Super Admin review!`);
    } catch (err: unknown) {
      console.error('Error submitting recommendation:', err);
      alert('Failed to submit recommendation.');
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

  const pendingApps = applications.filter((a) => a.status === 'PENDING');

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Hero */}
      <div className="hero mb-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-100 border border-red-300 text-xs font-black text-red-900 mb-2">
          <i className="fas fa-shield-alt text-red-600"></i> Authorized Moderator Hub
        </div>
        <h1 className="text-3xl font-black text-zinc-900">
          Moderator Dashboard
        </h1>
        <p className="text-xs text-zinc-600 max-w-lg mx-auto mt-1">
          Review community membership applications, recommend candidates to the Super Admin, and moderate reported content.
        </p>

        {/* Tab switcher */}
        <div className="flex justify-center gap-2 mt-5">
          <button
            type="button"
            onClick={() => setActiveTab('applications')}
            className={`py-2 px-4 rounded-full text-xs font-black transition flex items-center gap-2 border-2 border-zinc-900 ${
              activeTab === 'applications'
                ? 'bg-[#1e1e1e] text-[#f9c74f] shadow-[0_3px_0_#d6d2ca]'
                : 'bg-white text-zinc-800 hover:bg-zinc-100'
            }`}
          >
            <i className="fas fa-id-card"></i>
            <span>Membership Applications</span>
            {pendingApps.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-amber-500 text-black text-[10px] font-black flex items-center justify-center">
                {pendingApps.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('reports')}
            className={`py-2 px-4 rounded-full text-xs font-black transition flex items-center gap-2 border-2 border-zinc-900 ${
              activeTab === 'reports'
                ? 'bg-[#1e1e1e] text-[#f9c74f] shadow-[0_3px_0_#d6d2ca]'
                : 'bg-white text-zinc-800 hover:bg-zinc-100'
            }`}
          >
            <i className="fas fa-flag"></i>
            <span>Content Reports</span>
            {reports.filter((r) => r.status === 'PENDING').length > 0 && (
              <span className="w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center">
                {reports.filter((r) => r.status === 'PENDING').length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* APPLICATIONS SECTION */}
      {activeTab === 'applications' && (
        <div className="neo-card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold">Admin Member Applications Review</h2>
              <p className="text-xs text-zinc-600">
                Admins can review applicant qualifications and recommend approval or rejection for the Super Admin's final decision.
              </p>
            </div>
            <span className="text-xs font-bold bg-amber-100 text-amber-900 px-3 py-1 rounded-full border border-amber-300">
              {pendingApps.length} Pending
            </span>
          </div>

          {loadingApps ? (
            <div className="text-center py-8 text-xs font-bold text-zinc-500">
              <i className="fas fa-spinner fa-spin mr-2"></i> Loading applications...
            </div>
          ) : applications.length === 0 ? (
            <div className="text-center py-8 text-zinc-400 italic">
              No applications submitted yet.
            </div>
          ) : (
            <div className="space-y-4">
              {applications.map((app) => (
                <div
                  key={app.id}
                  className="p-4 bg-zinc-50 border-2 border-zinc-900 rounded-2xl shadow-[0_3px_0_#d6d2ca]"
                >
                  <div className="flex items-start justify-between flex-wrap gap-2 mb-2">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-zinc-200 border-2 border-zinc-900 overflow-hidden flex items-center justify-center font-bold text-xs shrink-0">
                        {app.applicantPhotoURL ? (
                          <img src={app.applicantPhotoURL} alt="" className="w-full h-full object-cover" />
                        ) : (
                          app.applicantName.charAt(0).toUpperCase()
                        )}
                      </div>
                      <div>
                        <h4 className="font-black text-sm text-zinc-900">{app.applicantName}</h4>
                        <span className="text-[11px] text-zinc-500">{app.applicantEmail}</span>
                      </div>
                    </div>

                    <span
                      className={`text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full border ${
                        app.status === 'PENDING'
                          ? 'bg-amber-100 text-amber-900 border-amber-400'
                          : app.status === 'APPROVED'
                          ? 'bg-emerald-100 text-emerald-900 border-emerald-400'
                          : 'bg-rose-100 text-rose-900 border-rose-400'
                      }`}
                    >
                      {app.status}
                    </span>
                  </div>

                  <div className="bg-white p-3 rounded-xl border border-zinc-200 text-xs space-y-2 mb-3">
                    <div>
                      <span className="font-bold text-zinc-700 block">Motivation:</span>
                      <p className="text-zinc-800 italic">{app.reason}</p>
                    </div>
                    <div className="pt-1.5 border-t border-zinc-100">
                      <span className="font-bold text-zinc-700 block">Cycling Experience:</span>
                      <p className="text-zinc-800">{app.cyclingExperience}</p>
                    </div>
                    {app.requestedTitle && (
                      <div className="pt-1.5 border-t border-zinc-100 flex items-center gap-2">
                        <span className="font-bold text-zinc-700">Requested Custom Title:</span>
                        <span className="bg-[#f9c74f]/30 px-2 py-0.5 rounded font-black text-amber-900 border border-[#f9c74f]">
                          {app.requestedTitle}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Existing recommendations */}
                  {app.adminRecommendations && app.adminRecommendations.length > 0 && (
                    <div className="mb-3 bg-blue-50/70 p-2.5 rounded-xl border border-blue-200 text-xs">
                      <span className="font-bold text-blue-900 block mb-1">
                        Previous Moderator Feedback:
                      </span>
                      {app.adminRecommendations.map((r, i) => (
                        <div key={i} className="text-[11px] flex items-center justify-between">
                          <span>
                            <strong>{r.adminName}:</strong> {r.comment}
                          </span>
                          <span
                            className={`font-bold px-1.5 py-0.2 rounded text-[10px] ${
                              r.recommendation === 'APPROVE'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {r.recommendation}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add recommendation form for regular admin */}
                  {app.status === 'PENDING' && (
                    <div className="pt-2 border-t border-zinc-200">
                      <label className="block text-[11px] font-bold text-zinc-600 mb-1">
                        Leave Your Moderator Recommendation for Super Admin:
                      </label>
                      <div className="flex gap-2 mb-2">
                        <input
                          type="text"
                          value={recommendComments[app.id] || ''}
                          onChange={(e) =>
                            setRecommendComments((prev) => ({ ...prev, [app.id]: e.target.value }))
                          }
                          placeholder="Your notes on applicant fit, activity level..."
                          className="neo-input text-xs flex-1 p-2"
                        />
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleAddRecommendation(app, 'REJECT')}
                          className="px-3 py-1.5 rounded-xl border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-800 text-xs font-bold transition flex items-center gap-1"
                        >
                          <i className="fas fa-thumbs-down"></i> Recommend Rejection
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAddRecommendation(app, 'APPROVE')}
                          className="btn-primary py-1.5 px-4 text-xs font-black flex items-center gap-1"
                        >
                          <i className="fas fa-thumbs-up"></i> Recommend Approval
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* REPORTS SECTION */}
      {activeTab === 'reports' && (
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

                    <span className="text-xs text-zinc-500 font-mono">
                      {new Date(report.createdAt).toLocaleDateString()}
                    </span>
                  </div>

                  <div className="p-3 bg-red-50/50 border border-red-200 rounded-xl mb-3 text-xs">
                    <div className="font-bold text-red-900 mb-1">
                      Reason: <span className="font-normal">{report.reason}</span>
                    </div>
                    <div className="text-zinc-600 italic">
                      "{report.targetExcerpt}"
                    </div>
                  </div>

                  <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-zinc-100">
                    <span className="text-[0.7rem] text-zinc-500">
                      Reporter: {report.reporterEmail}
                    </span>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleUpdateReportStatus(report.id, 'DISMISSED')}
                        className="btn-secondary text-[0.7rem] py-1 px-3"
                      >
                        Dismiss
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUpdateReportStatus(report.id, 'REVIEWED')}
                        className="btn-primary text-[0.7rem] py-1 px-3 font-bold"
                      >
                        Mark Reviewed
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
