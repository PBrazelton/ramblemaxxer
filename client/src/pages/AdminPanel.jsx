/**
 * client/src/pages/AdminPanel.jsx
 * Admin dashboard — Students tab + Invites tab.
 */

import { useState, useEffect, useCallback } from "react";
import { COLORS, STATUS_COLOR, FONT, BG, BORDER, api, ProgressRing, BottomSheet, StickyHeader } from "../lib/ui.jsx";

export default function AdminPanel({ user, onLogout }) {
  const [tab, setTab] = useState("students");
  const [students, setStudents] = useState([]);
  const [invites, setInvites] = useState([]);
  const [viewingStudent, setViewingStudent] = useState(null);
  const [studentData, setStudentData] = useState(null);
  const [tempPassword, setTempPassword] = useState(null);
  const [newInviteUrl, setNewInviteUrl] = useState(null);

  const loadStudents = useCallback(() => {
    api.get("/api/admin/students").then(setStudents);
  }, []);

  const loadInvites = useCallback(() => {
    api.get("/api/admin/invites").then(setInvites);
  }, []);

  useEffect(() => { loadStudents(); loadInvites(); }, [loadStudents, loadInvites]);

  const viewDashboard = async (id) => {
    setViewingStudent(id);
    const data = await api.get(`/api/admin/students/${id}`);
    setStudentData(data);
  };

  const resetPassword = async (id, name) => {
    if (!confirm(`Reset password for ${name}?`)) return;
    const res = await api.post(`/api/admin/users/${id}/reset-password`);
    setTempPassword({ name, password: res.tempPassword });
  };

  const toggleActive = async (id, name, currentActive) => {
    const action = currentActive ? "deactivate" : "reactivate";
    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} ${name}?`)) return;
    await api.put(`/api/admin/users/${id}`, { active: currentActive ? 0 : 1 });
    loadStudents();
  };

  const generateInvite = async () => {
    const res = await api.post("/api/admin/invites", {});
    setNewInviteUrl(res.inviteUrl);
    loadInvites();
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  return (
    <div style={{ background: BG, minHeight: "100vh" }}>
      <StickyHeader user={user} badge="admin" onLogout={onLogout} />

      {/* Tab bar */}
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "1rem 1rem 0" }}>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
          {["students", "invites"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              fontFamily: FONT.mono, fontSize: "0.8rem", padding: "0.5rem 1rem",
              background: tab === t ? "#1a1a1a" : "#f5f0e8",
              color: tab === t ? "#fff" : "#666",
              border: "none", borderRadius: 4, cursor: "pointer",
              textTransform: "capitalize",
            }}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 1rem 2rem" }}>
        {tab === "students" && (
          <StudentsTab
            students={students}
            currentUserId={user.id}
            onView={viewDashboard}
            onResetPassword={resetPassword}
            onToggleActive={toggleActive}
          />
        )}
        {tab === "invites" && (
          <InvitesTab
            invites={invites}
            onGenerate={generateInvite}
            onCopy={copyToClipboard}
          />
        )}
      </div>

      {/* Student dashboard modal */}
      {viewingStudent && studentData && (
        <BottomSheet onClose={() => { setViewingStudent(null); setStudentData(null); }} maxWidth={680}>
          <StudentDashboardView data={studentData} />
        </BottomSheet>
      )}

      {/* Temp password dialog */}
      {tempPassword && (
        <BottomSheet onClose={() => setTempPassword(null)}>
          <div style={{ fontFamily: FONT.serif, fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            Password Reset
          </div>
          <p style={{ fontFamily: FONT.mono, fontSize: "0.8rem", color: "#666", marginBottom: "0.5rem" }}>
            New temporary password for {tempPassword.name}:
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
            <code style={{
              fontFamily: FONT.mono, fontSize: "1.2rem", fontWeight: 700,
              background: "#f5f0e8", padding: "0.5rem 1rem", borderRadius: 4, flex: 1, textAlign: "center",
            }}>
              {tempPassword.password}
            </code>
            <button onClick={() => copyToClipboard(tempPassword.password)} style={{
              fontFamily: FONT.mono, fontSize: "0.75rem", padding: "0.5rem 0.8rem",
              background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer",
            }}>copy</button>
          </div>
          <p style={{ fontFamily: FONT.mono, fontSize: "0.65rem", color: "#888" }}>
            This password cannot be retrieved again. Share it with the student directly.
          </p>
        </BottomSheet>
      )}

      {/* New invite URL dialog */}
      {newInviteUrl && (
        <BottomSheet onClose={() => setNewInviteUrl(null)}>
          <div style={{ fontFamily: FONT.serif, fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            Invite Created
          </div>
          <div style={{
            fontFamily: FONT.mono, fontSize: "0.7rem", wordBreak: "break-all",
            background: "#f5f0e8", padding: "0.5rem 1rem", borderRadius: 4, marginBottom: "0.5rem",
          }}>
            {newInviteUrl}
          </div>
          <button onClick={() => { copyToClipboard(newInviteUrl); setNewInviteUrl(null); }} style={{
            fontFamily: FONT.mono, fontSize: "0.8rem", padding: "0.5rem 1rem", width: "100%",
            background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer",
          }}>copy & close</button>
        </BottomSheet>
      )}
    </div>
  );
}

// ── Students Tab ─────────────────────────────────────────────────────────────
function StudentsTab({ students, currentUserId, onView, onResetPassword, onToggleActive }) {
  if (students.length === 0) {
    return (
      <div style={{ fontFamily: FONT.mono, fontSize: "0.8rem", color: "#888", textAlign: "center", padding: "2rem" }}>
        No students yet. Generate an invite to get started.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {students.map(s => (
        <div key={s.id} style={{
          background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8,
          padding: "0.8rem 1rem", opacity: s.active === 0 ? 0.5 : 1,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.3rem" }}>
            <div style={{
              width: 32, height: 32, borderRadius: "50%", background: "#1a1a1a", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: FONT.mono, fontSize: "0.75rem", fontWeight: 700, flexShrink: 0,
            }}>
              {s.name.charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: FONT.serif, fontSize: "0.95rem", fontWeight: 600 }}>
                {s.name}
                {s.active === 0 && <span style={{ marginLeft: 6, fontSize: "0.6rem", fontFamily: FONT.mono, background: "#fde8e8", padding: "1px 6px", borderRadius: 3, color: "#c43b2d" }}>inactive</span>}
              </div>
              <div style={{ fontFamily: FONT.mono, fontSize: "0.65rem", color: "#888" }}>
                {s.email} {s.grad_year ? `· Class of ${s.grad_year}` : ""}
              </div>
            </div>
          </div>
          <div style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: "#888", marginBottom: "0.5rem", paddingLeft: 38 }}>
            {s.course_count} courses {s.invited_by_name ? `· invited by ${s.invited_by_name}` : ""}
          </div>
          <div style={{ display: "flex", gap: "0.4rem", paddingLeft: 38 }}>
            <button onClick={() => onView(s.id)} style={btnStyle("#1a7a5a")}>View Dashboard</button>
            {s.id !== currentUserId && (
              <>
                <button onClick={() => onResetPassword(s.id, s.name)} style={btnStyle("#5a6a7a")}>Reset PW</button>
                <button onClick={() => onToggleActive(s.id, s.name, s.active !== 0)} style={btnStyle(s.active === 0 ? "#22863a" : "#c43b2d")}>
                  {s.active === 0 ? "Activate" : "Deactivate"}
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function btnStyle(bg) {
  return {
    fontFamily: FONT.mono, fontSize: "0.65rem", padding: "0.35rem 0.6rem",
    background: bg, color: "#fff", border: "none", borderRadius: 4, cursor: "pointer",
  };
}

// ── Invites Tab ──────────────────────────────────────────────────────────────
function InvitesTab({ invites, onGenerate, onCopy }) {
  // Build invite tree
  const byInviter = {};
  for (const inv of invites) {
    if (!byInviter[inv.inviter_id]) byInviter[inv.inviter_id] = { name: inv.inviter_name, invites: [] };
    byInviter[inv.inviter_id].invites.push(inv);
  }

  return (
    <div>
      <button onClick={onGenerate} style={{
        fontFamily: FONT.mono, fontSize: "0.8rem", padding: "0.6rem 1rem", marginBottom: "1rem",
        background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", width: "100%",
      }}>
        Generate New Invite
      </button>

      {Object.entries(byInviter).map(([inviterId, group]) => (
        <div key={inviterId} style={{ marginBottom: "1rem" }}>
          <div style={{ fontFamily: FONT.serif, fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.4rem" }}>
            {group.name}
          </div>
          {group.invites.map(inv => {
            const isUsed = !!inv.used_at;
            const isExpired = !isUsed && new Date(inv.expires_at) < new Date();
            const status = isUsed ? "used" : isExpired ? "expired" : "pending";
            const statusColor = isUsed ? "#22863a" : isExpired ? "#c43b2d" : "#b08800";

            return (
              <div key={inv.id} style={{
                display: "flex", alignItems: "center", gap: "0.5rem",
                paddingLeft: "1.5rem", marginBottom: "0.4rem",
                borderLeft: `2px solid ${BORDER}`,
              }}>
                <span style={{ fontFamily: FONT.mono, fontSize: "0.65rem", color: "#444" }}>
                  {isUsed ? (inv.invitee_name || inv.email || "unknown") : (inv.email || "open invite")}
                </span>
                <span style={{
                  fontFamily: FONT.mono, fontSize: "0.55rem", padding: "1px 6px", borderRadius: 3,
                  background: `${statusColor}15`, color: statusColor,
                }}>
                  {status}
                </span>
                {isUsed && (
                  <span style={{ fontFamily: FONT.mono, fontSize: "0.55rem", color: "#888" }}>
                    {new Date(inv.used_at).toLocaleDateString()}
                  </span>
                )}
                {status === "pending" && (
                  <button onClick={() => onCopy(`${window.location.origin}/#/register?token=${inv.token}`)} style={{
                    fontFamily: FONT.mono, fontSize: "0.55rem", padding: "2px 6px",
                    background: "#f5f0e8", color: "#666", border: `1px solid ${BORDER}`,
                    borderRadius: 3, cursor: "pointer",
                  }}>copy link</button>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {invites.length === 0 && (
        <div style={{ fontFamily: FONT.mono, fontSize: "0.8rem", color: "#888", textAlign: "center", padding: "2rem" }}>
          No invites yet.
        </div>
      )}
    </div>
  );
}

// ── Student Dashboard View (read-only) ──────────────────────────────────────
function StudentDashboardView({ data }) {
  if (!data?.user) return null;
  const { user: student } = data;

  const majorOrder = ["PLSC-BA", "GLST-BA", "CORE"];
  const programs = majorOrder.map(code => data.programs[code]).filter(Boolean);

  return (
    <div>
      <div style={{ fontFamily: FONT.serif, fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.2rem" }}>
        {student.name}'s Dashboard
      </div>
      <div style={{ fontFamily: FONT.mono, fontSize: "0.7rem", color: "#888", marginBottom: "1rem" }}>
        {student.email} {student.grad_year ? `· Class of ${student.grad_year}` : ""}
      </div>

      {/* Credits summary */}
      <div style={{ display: "flex", gap: "0.8rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        {[
          { label: "Total", value: data.credits.total, color: "#1a1a1a" },
          { label: "Earned", value: data.credits.complete, color: STATUS_COLOR.complete },
          { label: "Enrolled", value: data.credits.enrolled, color: STATUS_COLOR.enrolled },
          { label: "Planned", value: data.credits.planned, color: STATUS_COLOR.planned },
        ].map(c => (
          <div key={c.label} style={{ fontFamily: FONT.mono, fontSize: "0.7rem" }}>
            <span style={{ fontWeight: 700, color: c.color }}>{c.value}</span>
            <span style={{ color: "#888" }}> {c.label.toLowerCase()}</span>
          </div>
        ))}
      </div>

      {/* Programs overview */}
      {programs.map(prog => {
        const color = COLORS[prog.code] || "#444";
        const filled = prog.categories.reduce((s, c) => s + (c.filledCount || 0), 0);
        const total = prog.categories.reduce((s, c) => s + c.slotsNeeded, 0);
        return (
          <div key={prog.code} style={{
            background: "#fafaf8", border: `1px solid ${BORDER}`, borderLeft: `4px solid ${color}`,
            borderRadius: 6, padding: "0.6rem 0.8rem", marginBottom: "0.5rem",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontFamily: FONT.serif, fontSize: "0.85rem", fontWeight: 600, color }}>{prog.name}</div>
              <div style={{ fontFamily: FONT.mono, fontSize: "0.65rem", color: filled === total ? "#22863a" : "#888" }}>
                {filled}/{total}
              </div>
            </div>
          </div>
        );
      })}

      {/* Remaining */}
      {data.remaining.length > 0 && (
        <div style={{ marginTop: "0.8rem" }}>
          <div style={{ fontFamily: FONT.serif, fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.3rem" }}>Remaining</div>
          {data.remaining.map((r, i) => (
            <div key={i} style={{ fontFamily: FONT.mono, fontSize: "0.65rem", color: "#666", marginBottom: "0.2rem" }}>
              <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: COLORS[r.program] || "#888", marginRight: 6 }} />
              {r.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
