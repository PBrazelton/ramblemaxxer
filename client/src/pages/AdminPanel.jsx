/**
 * client/src/pages/AdminPanel.jsx
 * Admin dashboard — Students tab + Invites tab + Programs tab.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { COLORS, STATUS_COLOR, FONT, BG, BORDER, api, ProgressRing, BottomSheet, StickyHeader, ErrMsg, sharedStyles, programColor } from "../lib/ui.jsx";

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

  const generateInvite = async (email) => {
    const res = await api.post("/api/admin/invites", { email: email || undefined });
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
          {["students", "invites", "programs", "tools"].map(t => (
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
        {tab === "programs" && <ProgramsTab />}
        {tab === "tools" && <ToolsTab />}
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
  const [inviteEmail, setInviteEmail] = useState("");

  // Build invite tree
  const byInviter = {};
  for (const inv of invites) {
    if (!byInviter[inv.inviter_id]) byInviter[inv.inviter_id] = { name: inv.inviter_name, invites: [] };
    byInviter[inv.inviter_id].invites.push(inv);
  }

  const handleGenerate = () => {
    onGenerate(inviteEmail.trim());
    setInviteEmail("");
  };

  return (
    <div>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <input
          type="email"
          placeholder="email (optional — sends invite)"
          value={inviteEmail}
          onChange={e => setInviteEmail(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleGenerate()}
          style={{
            flex: 1, fontFamily: FONT.mono, fontSize: "0.8rem", padding: "0.6rem 0.8rem",
            border: `1px solid ${BORDER}`, borderRadius: 4, background: "#fafaf8", outline: "none",
          }}
        />
        <button onClick={handleGenerate} style={{
          fontFamily: FONT.mono, fontSize: "0.8rem", padding: "0.6rem 1rem",
          background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer",
          whiteSpace: "nowrap",
        }}>
          {inviteEmail.trim() ? "Send Invite" : "Generate Link"}
        </button>
      </div>

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

  const allProgs = Object.values(data.programs || {});

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
      {allProgs.map(prog => {
        const color = programColor(prog.code);
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
              <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: programColor(r.program), marginRight: 6 }} />
              {r.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Programs Tab ─────────────────────────────────────────────────────────────
const CORE_KNOWLEDGE_AREAS = [
  "Artistic Knowledge and Inquiry",
  "College Writing Seminar",
  "Ethical Knowledge and Inquiry",
  "Historical Knowledge and Inquiry",
  "Literary Knowledge and Inquiry",
  "Philosophical Knowledge and Inquiry",
  "Quantitative Knowledge and Inquiry",
  "Scientific Knowledge and Inquiry",
  "Societal and Cultural Knowledge and Inquiry",
  "Theological and Religious Knowledge and Inquiry",
];

const TYPE_OPTIONS = ["major", "minor", "core", "college", "requirement"];

function emptyCategory() {
  return {
    name: "", description: "", slots: 1, creditsPerSlot: 3,
    wildcard: null, isFixed: false, tierStructure: null, constraints: null, notes: null,
    eligibleCourses: [], _mode: "list",
  };
}

function programToForm(p) {
  return {
    code: p.code,
    name: p.name,
    type: p.type,
    department: p.department || "",
    college: p.college || "",
    totalCredits: p.total_credits || "",
    uniqueCreditsRequired: p.unique_credits_required || "",
    doubleDipPolicy: p.double_dip_policy || "",
    notes: Array.isArray(p.notes) ? p.notes.join("\n") : (p.notes || ""),
    coreWaivers: p.core_waivers_list || (Array.isArray(p.core_waivers) ? p.core_waivers : []),
    categories: (p.categories || []).map(cat => ({
      name: cat.name,
      description: cat.description || "",
      slots: cat.slots,
      creditsPerSlot: cat.credits_per_slot || 3,
      wildcard: cat.wildcard || null,
      isFixed: !!cat.is_fixed,
      tierStructure: cat.tier_structure || null,
      constraints: cat.constraints || null,
      notes: cat.notes || "",
      eligibleCourses: (cat.eligible_courses || []).map(ec =>
        typeof ec === "string" ? { courseCode: ec, isRequired: false } : { courseCode: ec.course_code, isRequired: !!ec.is_required }
      ),
      _mode: cat.wildcard ? "wildcard" : (cat.is_fixed ? "fixed" : "list"),
    })),
    overlapRules: (p.overlap_rules || []).map(r => ({
      partnerProgram: r.program_a === p.code ? r.program_b : r.program_a,
      maxSharedCourses: r.max_shared_courses || "",
      maxFromSingleDept: r.max_from_single_dept || "",
      details: r.details || "",
    })),
    studentCount: p.student_count || 0,
    isActive: p.is_active !== 0,
  };
}

function formToPayload(form) {
  return {
    code: form.code,
    name: form.name,
    type: form.type,
    department: form.department || null,
    college: form.college || null,
    totalCredits: parseInt(form.totalCredits) || null,
    uniqueCreditsRequired: parseInt(form.uniqueCreditsRequired) || null,
    doubleDipPolicy: form.doubleDipPolicy || null,
    notes: form.notes.trim() ? form.notes.trim().split("\n").filter(Boolean) : null,
    coreWaivers: form.coreWaivers.length > 0 ? form.coreWaivers : null,
    categories: form.categories.map(cat => {
      const out = {
        name: cat.name,
        description: cat.description || null,
        slots: parseInt(cat.slots) || 1,
        creditsPerSlot: parseInt(cat.creditsPerSlot) || 3,
        tierStructure: cat.tierStructure || null,
        constraints: cat.constraints || null,
        notes: cat.notes || null,
      };
      if (cat._mode === "wildcard" && cat.wildcard) {
        out.wildcard = cat.wildcard;
      } else if (cat._mode === "fixed") {
        out.isFixed = true;
        out.eligibleCourses = cat.eligibleCourses.map(ec => ({ courseCode: ec.courseCode, isRequired: ec.isRequired }));
      } else {
        out.eligibleCourses = cat.eligibleCourses.map(ec => ({ courseCode: ec.courseCode, isRequired: ec.isRequired }));
      }
      return out;
    }),
    overlapRules: form.overlapRules.filter(r => r.partnerProgram).map(r => ({
      partnerProgram: r.partnerProgram,
      maxSharedCourses: parseInt(r.maxSharedCourses) || null,
      maxFromSingleDept: parseInt(r.maxFromSingleDept) || null,
      details: r.details || null,
    })),
  };
}

function ProgramsTab() {
  const [programs, setPrograms] = useState([]);
  const [view, setView] = useState("list"); // "list" | "editor"
  const [editingCode, setEditingCode] = useState(null); // null = create
  const [loading, setLoading] = useState(true);

  const loadPrograms = useCallback(() => {
    setLoading(true);
    api.get("/api/admin/programs").then(data => { setPrograms(data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  useEffect(() => { loadPrograms(); }, [loadPrograms]);

  const openEditor = (code) => {
    setEditingCode(code);
    setView("editor");
  };

  const backToList = () => {
    setView("list");
    setEditingCode(null);
    loadPrograms();
  };

  if (view === "editor") {
    return <ProgramEditor code={editingCode} onBack={backToList} />;
  }

  return (
    <div>
      <button onClick={() => openEditor(null)} style={{
        ...sharedStyles.button, fontSize: "0.8rem", padding: "0.5rem 1rem", marginBottom: "1rem",
      }}>+ New Program</button>

      {loading && (
        <div style={{ fontFamily: FONT.mono, fontSize: "0.8rem", color: "#888", textAlign: "center", padding: "2rem" }}>
          Loading programs...
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {programs.map(p => {
          const color = programColor(p.code);
          return (
            <div key={p.code} style={{
              background: "#fff", border: `1px solid ${BORDER}`, borderLeft: `4px solid ${color}`,
              borderRadius: 8, padding: "0.8rem 1rem", opacity: p.is_active ? 1 : 0.5,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.3rem" }}>
                <div style={{ fontFamily: FONT.serif, fontSize: "0.95rem", fontWeight: 600, color, flex: 1 }}>
                  {p.name}
                </div>
                <span style={{
                  fontFamily: FONT.mono, fontSize: "0.55rem", padding: "2px 6px", borderRadius: 3,
                  background: p.type === "major" ? "#e8f5e9" : p.type === "minor" ? "#e3f2fd" : "#f5f0e8",
                  color: p.type === "major" ? "#22863a" : p.type === "minor" ? "#1565c0" : "#7a4a1a",
                }}>{p.type}</span>
                {!p.is_active && (
                  <span style={{ fontFamily: FONT.mono, fontSize: "0.55rem", padding: "2px 6px", borderRadius: 3, background: "#fde8e8", color: "#c43b2d" }}>inactive</span>
                )}
              </div>
              <div style={{ fontFamily: FONT.mono, fontSize: "0.65rem", color: "#888", marginBottom: "0.5rem" }}>
                {p.code} {p.department ? `· ${p.department}` : ""} · {p.category_count} categories · {p.student_count} student{p.student_count !== 1 ? "s" : ""}
              </div>
              <button onClick={() => openEditor(p.code)} style={btnStyle("#1a1a1a")}>Edit</button>
            </div>
          );
        })}
      </div>

      {!loading && programs.length === 0 && (
        <div style={{ fontFamily: FONT.mono, fontSize: "0.8rem", color: "#888", textAlign: "center", padding: "2rem" }}>
          No programs yet. Create one to get started.
        </div>
      )}
    </div>
  );
}

// ── Program Editor ───────────────────────────────────────────────────────────
function ProgramEditor({ code, onBack }) {
  const isCreate = !code;
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (isCreate) {
      setForm({
        code: "", name: "", type: "major", department: "", college: "College of Arts and Sciences",
        totalCredits: "", uniqueCreditsRequired: 21, doubleDipPolicy: "CAS_DEFAULT",
        notes: "", coreWaivers: [], categories: [emptyCategory()],
        overlapRules: [], studentCount: 0, isActive: true,
      });
    } else {
      api.get(`/api/admin/programs/${code}`).then(data => {
        setForm(programToForm(data));
      }).catch(() => setError("Failed to load program"));
    }
  }, [code, isCreate]);

  if (!form) return <div style={{ fontFamily: FONT.mono, fontSize: "0.8rem", color: "#888", padding: "2rem", textAlign: "center" }}>Loading...</div>;

  const updateField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const updateCategory = (idx, field, value) => {
    setForm(prev => {
      const cats = [...prev.categories];
      cats[idx] = { ...cats[idx], [field]: value };
      return { ...prev, categories: cats };
    });
  };

  const removeCategory = (idx) => {
    setForm(prev => ({ ...prev, categories: prev.categories.filter((_, i) => i !== idx) }));
  };

  const moveCategory = (idx, dir) => {
    setForm(prev => {
      const cats = [...prev.categories];
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= cats.length) return prev;
      [cats[idx], cats[newIdx]] = [cats[newIdx], cats[idx]];
      return { ...prev, categories: cats };
    });
  };

  const addCourseToCategory = (catIdx, courseCode) => {
    setForm(prev => {
      const cats = [...prev.categories];
      const cat = { ...cats[catIdx] };
      if (cat.eligibleCourses.some(ec => ec.courseCode === courseCode)) return prev;
      cat.eligibleCourses = [...cat.eligibleCourses, { courseCode, isRequired: false }];
      cats[catIdx] = cat;
      return { ...prev, categories: cats };
    });
  };

  const removeCourseFromCategory = (catIdx, courseCode) => {
    setForm(prev => {
      const cats = [...prev.categories];
      const cat = { ...cats[catIdx] };
      cat.eligibleCourses = cat.eligibleCourses.filter(ec => ec.courseCode !== courseCode);
      cats[catIdx] = cat;
      return { ...prev, categories: cats };
    });
  };

  const toggleCourseRequired = (catIdx, courseCode) => {
    setForm(prev => {
      const cats = [...prev.categories];
      const cat = { ...cats[catIdx] };
      cat.eligibleCourses = cat.eligibleCourses.map(ec =>
        ec.courseCode === courseCode ? { ...ec, isRequired: !ec.isRequired } : ec
      );
      cats[catIdx] = cat;
      return { ...prev, categories: cats };
    });
  };

  const handleTypeChange = (newType) => {
    const prev = form.type;
    const updates = { type: newType };
    if (prev === "major" && newType === "minor" && form.uniqueCreditsRequired === 21) {
      updates.uniqueCreditsRequired = 8;
    } else if (prev === "minor" && newType === "major" && form.uniqueCreditsRequired === 8) {
      updates.uniqueCreditsRequired = 21;
    }
    setForm(f => ({ ...f, ...updates }));
  };

  const suggestCode = () => {
    if (!form.department) return;
    const suffix = form.type === "minor" ? "MIN" : form.type === "major" ? "BA" : form.type.toUpperCase();
    updateField("code", `${form.department.toUpperCase()}-${suffix}`);
  };

  const handleSave = async () => {
    setError("");
    setSaving(true);
    const payload = formToPayload(form);
    try {
      if (isCreate) {
        const res = await api.post("/api/admin/programs", payload);
        if (res.error) { setError(res.error); setSaving(false); return; }
      } else {
        const res = await api.put(`/api/admin/programs/${code}`, payload);
        if (res.error) { setError(res.error); setSaving(false); return; }
      }
      onBack();
    } catch (e) {
      setError("Failed to save program");
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!confirm(`${form.isActive ? "Deactivate" : "Reactivate"} ${form.code}?`)) return;
    if (form.isActive) {
      await api.del(`/api/admin/programs/${code}?deactivate=true`);
    } else {
      await api.put(`/api/admin/programs/${code}/activate`);
    }
    onBack();
  };

  const handleDelete = async () => {
    if (!confirm(`Permanently delete ${form.code}? This cannot be undone.`)) return;
    const res = await api.del(`/api/admin/programs/${code}`);
    if (res.error) { setError(res.error); return; }
    onBack();
  };

  const toggleCoreWaiver = (area) => {
    setForm(prev => {
      const waivers = prev.coreWaivers.includes(area)
        ? prev.coreWaivers.filter(a => a !== area)
        : [...prev.coreWaivers, area];
      return { ...prev, coreWaivers: waivers };
    });
  };

  const addOverlapRule = () => {
    setForm(prev => ({
      ...prev,
      overlapRules: [...prev.overlapRules, { partnerProgram: "", maxSharedCourses: "", maxFromSingleDept: "", details: "" }],
    }));
  };

  const updateOverlapRule = (idx, field, value) => {
    setForm(prev => {
      const rules = [...prev.overlapRules];
      rules[idx] = { ...rules[idx], [field]: value };
      return { ...prev, overlapRules: rules };
    });
  };

  const removeOverlapRule = (idx) => {
    setForm(prev => ({ ...prev, overlapRules: prev.overlapRules.filter((_, i) => i !== idx) }));
  };

  return (
    <div>
      <button onClick={onBack} style={{
        fontFamily: FONT.mono, fontSize: "0.75rem", color: "#666", background: "none",
        border: "none", cursor: "pointer", padding: 0, marginBottom: "1rem",
      }}>
        &larr; Back to list
      </button>

      <h2 style={{ fontFamily: FONT.serif, fontSize: "1.3rem", fontWeight: 700, marginBottom: "1rem" }}>
        {isCreate ? "New Program" : `Edit ${form.code}`}
      </h2>

      {/* ── Metadata ───────────────────────────────────────────────── */}
      <div style={sectionStyle}>
        <div style={sectionLabel}>Program Info</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
          <div>
            <label style={labelStyle}>Code</label>
            {isCreate ? (
              <div style={{ display: "flex", gap: 4 }}>
                <input value={form.code} onChange={e => updateField("code", e.target.value.toUpperCase())}
                  placeholder="e.g. PSYC-BA" style={{ ...inputStyle, flex: 1 }} />
                <button onClick={suggestCode} style={{ ...btnStyle("#5a6a7a"), fontSize: "0.6rem", padding: "0.3rem 0.5rem" }}>auto</button>
              </div>
            ) : (
              <div style={{ ...inputStyle, background: "#eee", color: "#666" }}>{form.code}</div>
            )}
          </div>
          <div>
            <label style={labelStyle}>Type</label>
            <select value={form.type} onChange={e => handleTypeChange(e.target.value)} style={inputStyle}>
              {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Name</label>
            <input value={form.name} onChange={e => updateField("name", e.target.value)}
              placeholder="e.g. Psychology (BA)" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Department</label>
            <input value={form.department} onChange={e => updateField("department", e.target.value.toUpperCase())}
              placeholder="e.g. PSYC" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>College</label>
            <input value={form.college} onChange={e => updateField("college", e.target.value)}
              placeholder="College of Arts and Sciences" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Total Credits</label>
            <input type="number" value={form.totalCredits} onChange={e => updateField("totalCredits", e.target.value)}
              placeholder="33" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Unique Credits Required</label>
            <input type="number" value={form.uniqueCreditsRequired} onChange={e => updateField("uniqueCreditsRequired", e.target.value)}
              placeholder="21" style={inputStyle} />
          </div>
        </div>
        <div style={{ marginTop: "0.5rem" }}>
          <label style={labelStyle}>Notes (one per line)</label>
          <textarea value={form.notes} onChange={e => updateField("notes", e.target.value)}
            rows={2} placeholder="e.g. At least 17 hours at Loyola."
            style={{ ...inputStyle, resize: "vertical", width: "100%", boxSizing: "border-box" }} />
        </div>
      </div>

      {/* ── Categories ─────────────────────────────────────────────── */}
      <div style={sectionStyle}>
        <div style={sectionLabel}>Categories</div>
        {form.categories.map((cat, idx) => (
          <CategoryCard
            key={idx}
            cat={cat}
            idx={idx}
            total={form.categories.length}
            onChange={(field, value) => updateCategory(idx, field, value)}
            onRemove={() => removeCategory(idx)}
            onMove={(dir) => moveCategory(idx, dir)}
            onAddCourse={(code) => addCourseToCategory(idx, code)}
            onRemoveCourse={(code) => removeCourseFromCategory(idx, code)}
            onToggleRequired={(code) => toggleCourseRequired(idx, code)}
          />
        ))}
        <button onClick={() => setForm(prev => ({ ...prev, categories: [...prev.categories, emptyCategory()] }))}
          style={{ ...btnStyle("#5a6a7a"), marginTop: "0.5rem" }}>+ Add Category</button>
      </div>

      {/* ── Advanced ───────────────────────────────────────────────── */}
      <button onClick={() => setShowAdvanced(!showAdvanced)} style={{
        fontFamily: FONT.mono, fontSize: "0.75rem", color: "#666", background: "none",
        border: "none", cursor: "pointer", padding: "0.5rem 0", marginBottom: "0.5rem",
      }}>
        {showAdvanced ? "\u25BC" : "\u25B6"} Advanced (core waivers, overlap rules)
      </button>

      {showAdvanced && (
        <>
          <div style={sectionStyle}>
            <div style={sectionLabel}>Core Waivers</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
              {CORE_KNOWLEDGE_AREAS.map(area => {
                const checked = form.coreWaivers.includes(area);
                return (
                  <button key={area} onClick={() => toggleCoreWaiver(area)} style={{
                    fontFamily: FONT.mono, fontSize: "0.6rem", padding: "4px 8px",
                    borderRadius: 4, cursor: "pointer",
                    border: `1px solid ${checked ? "#22863a" : BORDER}`,
                    background: checked ? "#e8f5e9" : "#fff",
                    color: checked ? "#22863a" : "#666",
                  }}>{area.replace(" and Inquiry", "")}</button>
                );
              })}
            </div>
          </div>

          <div style={sectionStyle}>
            <div style={sectionLabel}>Overlap Rules</div>
            {form.overlapRules.map((rule, idx) => (
              <div key={idx} style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginBottom: "0.4rem" }}>
                <input value={rule.partnerProgram} onChange={e => updateOverlapRule(idx, "partnerProgram", e.target.value.toUpperCase())}
                  placeholder="GLST-BA" style={{ ...inputStyle, flex: 1 }} />
                <input type="number" value={rule.maxSharedCourses} onChange={e => updateOverlapRule(idx, "maxSharedCourses", e.target.value)}
                  placeholder="max" style={{ ...inputStyle, width: 50 }} />
                <input value={rule.details} onChange={e => updateOverlapRule(idx, "details", e.target.value)}
                  placeholder="details" style={{ ...inputStyle, flex: 1 }} />
                <button onClick={() => removeOverlapRule(idx)} style={{ ...btnStyle("#c43b2d"), padding: "0.3rem 0.5rem" }}>x</button>
              </div>
            ))}
            <button onClick={addOverlapRule} style={{ ...btnStyle("#5a6a7a"), fontSize: "0.6rem" }}>+ Add Rule</button>
          </div>
        </>
      )}

      {/* ── Actions ────────────────────────────────────────────────── */}
      {error && <ErrMsg>{error}</ErrMsg>}

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
        <button onClick={handleSave} disabled={saving} style={{
          ...sharedStyles.button, flex: 1, opacity: saving ? 0.6 : 1,
        }}>
          {saving ? "Saving..." : (isCreate ? "Create Program" : "Save Changes")}
        </button>
      </div>

      {!isCreate && (
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
          <button onClick={handleDeactivate} style={{ ...btnStyle(form.isActive ? "#c43b2d" : "#22863a"), flex: 1, padding: "0.5rem" }}>
            {form.isActive ? "Deactivate" : "Reactivate"}
          </button>
          {form.studentCount === 0 && (
            <button onClick={handleDelete} style={{ ...btnStyle("#c43b2d"), flex: 1, padding: "0.5rem" }}>
              Delete Permanently
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Category Card ────────────────────────────────────────────────────────────
function CategoryCard({ cat, idx, total, onChange, onRemove, onMove, onAddCourse, onRemoveCourse, onToggleRequired }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div style={{
      background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8,
      marginBottom: "0.5rem", overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.6rem 0.8rem",
        background: "#fafaf8", borderBottom: collapsed ? "none" : `1px solid ${BORDER}`,
        cursor: "pointer",
      }} onClick={() => setCollapsed(!collapsed)}>
        <span style={{ fontFamily: FONT.mono, fontSize: "0.7rem", color: "#888" }}>
          {collapsed ? "\u25B6" : "\u25BC"}
        </span>
        <span style={{ fontFamily: FONT.mono, fontSize: "0.8rem", fontWeight: 600, flex: 1 }}>
          {cat.name || `Category ${idx + 1}`}
        </span>
        <span style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: "#888" }}>
          {cat.slots} slot{cat.slots !== 1 ? "s" : ""} · {cat.eligibleCourses.length} courses
        </span>
        <div style={{ display: "flex", gap: 2 }} onClick={e => e.stopPropagation()}>
          <button onClick={() => onMove(-1)} disabled={idx === 0} style={tinyBtnStyle}>&uarr;</button>
          <button onClick={() => onMove(1)} disabled={idx === total - 1} style={tinyBtnStyle}>&darr;</button>
          <button onClick={onRemove} style={{ ...tinyBtnStyle, color: "#c43b2d" }}>x</button>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div style={{ padding: "0.6rem 0.8rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem", marginBottom: "0.5rem" }}>
            <div>
              <label style={labelStyle}>Name</label>
              <input value={cat.name} onChange={e => onChange("name", e.target.value)} style={inputStyle} placeholder="e.g. Foundation" />
            </div>
            <div>
              <label style={labelStyle}>Slots</label>
              <input type="number" value={cat.slots} onChange={e => onChange("slots", parseInt(e.target.value) || 1)} style={inputStyle} min={1} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>Description</label>
              <input value={cat.description} onChange={e => onChange("description", e.target.value)} style={inputStyle} placeholder="optional" />
            </div>
            <div>
              <label style={labelStyle}>Credits/Slot</label>
              <input type="number" value={cat.creditsPerSlot} onChange={e => onChange("creditsPerSlot", parseInt(e.target.value) || 3)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Notes</label>
              <input value={cat.notes || ""} onChange={e => onChange("notes", e.target.value)} style={inputStyle} placeholder="optional" />
            </div>
          </div>

          {/* Mode toggle */}
          <div style={{ display: "flex", gap: "0.3rem", marginBottom: "0.5rem" }}>
            {["list", "wildcard", "fixed"].map(mode => (
              <button key={mode} onClick={() => onChange("_mode", mode)} style={{
                fontFamily: FONT.mono, fontSize: "0.6rem", padding: "3px 8px",
                borderRadius: 3, cursor: "pointer",
                border: `1px solid ${cat._mode === mode ? "#1a1a1a" : BORDER}`,
                background: cat._mode === mode ? "#1a1a1a" : "#fff",
                color: cat._mode === mode ? "#fff" : "#666",
              }}>{mode}</button>
            ))}
          </div>

          {cat._mode === "wildcard" && (
            <div>
              <label style={labelStyle}>Wildcard Pattern</label>
              <input value={cat.wildcard || ""} onChange={e => onChange("wildcard", e.target.value)}
                style={inputStyle} placeholder="e.g. ANY_PSYC_200_PLUS, ANY_GLST_TAGGED" />
              <div style={{ fontFamily: FONT.mono, fontSize: "0.55rem", color: "#aaa", marginTop: 4 }}>
                Patterns: ANY_DEPT_200_PLUS, ANY_DEPT_ELECTIVE, ANY_GLST_TAGGED
              </div>
            </div>
          )}

          {(cat._mode === "list" || cat._mode === "fixed") && (
            <div>
              {/* Course chips */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginBottom: "0.5rem" }}>
                {cat.eligibleCourses.map(ec => (
                  <span key={ec.courseCode} style={{
                    fontFamily: FONT.mono, fontSize: "0.6rem", padding: "3px 6px",
                    borderRadius: 4, display: "inline-flex", alignItems: "center", gap: 4,
                    background: ec.isRequired ? "#e8f5e9" : "#f5f0e8",
                    border: `1px solid ${ec.isRequired ? "#22863a" : BORDER}`,
                  }}>
                    {cat._mode === "fixed" && (
                      <button onClick={() => onToggleRequired(ec.courseCode)} style={{
                        width: 12, height: 12, borderRadius: 2, border: `1px solid ${ec.isRequired ? "#22863a" : "#ccc"}`,
                        background: ec.isRequired ? "#22863a" : "transparent", color: "#fff",
                        cursor: "pointer", fontSize: 8, display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
                      }}>{ec.isRequired ? "\u2713" : ""}</button>
                    )}
                    {ec.courseCode}
                    <button onClick={() => onRemoveCourse(ec.courseCode)} style={{
                      background: "none", border: "none", cursor: "pointer", color: "#c43b2d",
                      fontSize: "0.7rem", padding: 0, lineHeight: 1,
                    }}>x</button>
                  </span>
                ))}
                {cat.eligibleCourses.length === 0 && (
                  <span style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: "#aaa" }}>No courses added yet</span>
                )}
              </div>

              <CourseSearchAdd onAdd={onAddCourse} />
              <BulkAddByRule onAdd={onAddCourse} existing={cat.eligibleCourses} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Course Search + Add ──────────────────────────────────────────────────────
function CourseSearchAdd({ onAdd }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const timerRef = useRef(null);

  const search = (q) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!q.trim()) { setResults([]); setShowDropdown(false); return; }
    timerRef.current = setTimeout(() => {
      api.get(`/api/courses/search?q=${encodeURIComponent(q)}&limit=20`)
        .then(data => { setResults(data.results || data); setShowDropdown(true); })
        .catch(() => {});
    }, 300);
  };

  return (
    <div style={{ position: "relative", marginBottom: "0.4rem" }}>
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); search(e.target.value); }}
        onFocus={() => results.length > 0 && setShowDropdown(true)}
        onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
        placeholder="Search courses to add..."
        style={{ ...inputStyle, width: "100%", boxSizing: "border-box", fontSize: "0.7rem" }}
      />
      {showDropdown && results.length > 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10,
          background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 4,
          maxHeight: 200, overflowY: "auto", boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
        }}>
          {results.map(c => (
            <button key={c.code} onClick={() => { onAdd(c.code); setQuery(""); setShowDropdown(false); }} style={{
              display: "block", width: "100%", textAlign: "left", padding: "6px 10px",
              fontFamily: FONT.mono, fontSize: "0.65rem", border: "none",
              borderBottom: `1px solid ${BORDER}`, background: "#fff", cursor: "pointer",
            }}>
              <span style={{ fontWeight: 600 }}>{c.code}</span>
              <span style={{ color: "#888", marginLeft: 6 }}>{c.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Bulk Add by Rule ─────────────────────────────────────────────────────────
function BulkAddByRule({ onAdd, existing }) {
  const [dept, setDept] = useState("");
  const [minNumber, setMinNumber] = useState("");
  const [preview, setPreview] = useState(null);

  const loadPreview = async () => {
    if (!dept.trim()) return;
    const min = parseInt(minNumber) || 0;
    const data = await api.get(`/api/admin/programs/courses/filter?dept=${encodeURIComponent(dept.toUpperCase())}&minNumber=${min}`);
    const existingCodes = new Set(existing.map(ec => ec.courseCode));
    const filtered = data.filter(c => !existingCodes.has(c.code));
    setPreview(filtered);
  };

  const addAll = () => {
    if (!preview) return;
    for (const c of preview) onAdd(c.code);
    setPreview(null);
    setDept("");
    setMinNumber("");
  };

  return (
    <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: "0.4rem", marginTop: "0.3rem" }}>
      <div style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: "#888", marginBottom: "0.3rem" }}>Bulk add by rule</div>
      <div style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
        <input value={dept} onChange={e => setDept(e.target.value.toUpperCase())}
          placeholder="DEPT" style={{ ...inputStyle, width: 60, fontSize: "0.65rem" }} />
        <input type="number" value={minNumber} onChange={e => setMinNumber(e.target.value)}
          placeholder="min #" style={{ ...inputStyle, width: 55, fontSize: "0.65rem" }} />
        <button onClick={loadPreview} style={{ ...btnStyle("#5a6a7a"), fontSize: "0.6rem", padding: "0.3rem 0.5rem" }}>Preview</button>
        {preview && (
          <button onClick={addAll} style={{ ...btnStyle("#22863a"), fontSize: "0.6rem", padding: "0.3rem 0.5rem" }}>
            Add {preview.length} &rarr;
          </button>
        )}
      </div>
      {preview && preview.length === 0 && (
        <div style={{ fontFamily: FONT.mono, fontSize: "0.55rem", color: "#aaa", marginTop: 4 }}>No new courses match</div>
      )}
    </div>
  );
}

// ── Shared styles ────────────────────────────────────────────────────────────
const inputStyle = {
  fontFamily: FONT.mono, fontSize: "0.75rem", padding: "0.4rem 0.6rem",
  border: `1px solid ${BORDER}`, borderRadius: 4, background: "#fafaf8", outline: "none",
  width: "100%", boxSizing: "border-box",
};

const labelStyle = {
  fontFamily: FONT.mono, fontSize: "0.6rem", fontWeight: 600, color: "#888",
  display: "block", marginBottom: 2,
};

const sectionStyle = {
  background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8,
  padding: "1rem", marginBottom: "1rem",
};

// ── Tools Tab ────────────────────────────────────────────────────────────────
function ToolsTab() {
  const [scrapeStatus, setScrapeStatus] = useState(null);
  const [polling, setPolling] = useState(false);

  const loadStatus = useCallback(async () => {
    const data = await api.get("/api/admin/scrape-locus/status");
    setScrapeStatus(data);
    return data;
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // Poll while running
  useEffect(() => {
    if (!polling) return;
    const id = setInterval(async () => {
      const data = await loadStatus();
      if (data.status !== "running") setPolling(false);
    }, 3000);
    return () => clearInterval(id);
  }, [polling, loadStatus]);

  const startScrape = async () => {
    await api.post("/api/admin/scrape-locus");
    setPolling(true);
    loadStatus();
  };

  const isRunning = scrapeStatus?.status === "running";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "1rem" }}>
        <div style={{ fontFamily: FONT.serif, fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>
          LOCUS Course Offerings
        </div>
        <p style={{ fontFamily: FONT.mono, fontSize: "0.7rem", color: "#666", marginBottom: "0.75rem", lineHeight: 1.5 }}>
          Scrapes class schedules from Loyola's public search (molo.luc.edu).
          Updates which courses are offered each term, with sections, instructors, and times.
          Takes about 3 minutes. Run weekly during registration.
        </p>

        {scrapeStatus?.stats && (
          <div style={{ fontFamily: FONT.mono, fontSize: "0.65rem", color: "#888", marginBottom: "0.75rem" }}>
            {scrapeStatus.stats.offerings} sections, {scrapeStatus.stats.courseTerms} course-terms
            {scrapeStatus.stats.terms?.map(t => (
              <span key={t.term} style={{ marginLeft: 8, background: "#e8f5e9", padding: "1px 5px", borderRadius: 3, color: "#2e7d32" }}>
                {t.term}: {t.c}
              </span>
            ))}
            {scrapeStatus.finishedAt && (
              <span style={{ marginLeft: 8 }}>
                Last run: {new Date(scrapeStatus.finishedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        )}

        <button onClick={startScrape} disabled={isRunning} style={{
          fontFamily: FONT.mono, fontSize: "0.75rem", padding: "0.5rem 1rem",
          background: isRunning ? "#ccc" : "#1a7a5a", color: "#fff",
          border: "none", borderRadius: 4, cursor: isRunning ? "not-allowed" : "pointer",
        }}>
          {isRunning ? "Scraping..." : "Refresh LOCUS Data"}
        </button>

        {isRunning && (
          <div style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: "#888", marginTop: "0.5rem" }}>
            Running — this page will update automatically.
          </div>
        )}

        {scrapeStatus?.status === "error" && (
          <div style={{ fontFamily: FONT.mono, fontSize: "0.65rem", color: "#c43b2d", marginTop: "0.5rem" }}>
            Error: {scrapeStatus.error}
          </div>
        )}

        {scrapeStatus?.log && scrapeStatus.status !== "idle" && (
          <details style={{ marginTop: "0.75rem" }}>
            <summary style={{ fontFamily: FONT.mono, fontSize: "0.65rem", color: "#888", cursor: "pointer" }}>
              Scrape log
            </summary>
            <pre style={{
              fontFamily: FONT.mono, fontSize: "0.55rem", background: "#1a1a1a", color: "#ccc",
              padding: "0.5rem", borderRadius: 4, marginTop: "0.3rem", maxHeight: 300,
              overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all",
            }}>
              {scrapeStatus.log}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

const sectionLabel = {
  fontFamily: FONT.serif, fontSize: "1rem", fontWeight: 700, marginBottom: "0.8rem",
};

const tinyBtnStyle = {
  fontFamily: FONT.mono, fontSize: "0.6rem", padding: "2px 6px",
  background: "#f5f0e8", color: "#666", border: `1px solid ${BORDER}`,
  borderRadius: 3, cursor: "pointer",
};
