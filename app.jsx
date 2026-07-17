const { useState, useEffect, useMemo, useCallback } = React;
const {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, AreaChart, Area
} = Recharts;

/* ============================================================
   TOKENS — Ledger / terminal: tinta-noturna azul-marinho + âmbar
   ============================================================ */
const T = {
  bg: "#0A0A12",
  surface0: "#101018",
  surface1: "#16161F",
  surface2: "#1D1D29",
  border: "#26262F",
  borderStrong: "#38384A",
  textPrimary: "#F5F5F8",
  textSecondary: "#9797A8",
  textMuted: "#63636F",
  amber: "#8B7CFF",
  amberDim: "#4A3FA8",
  amberBg: "#1E1A3D",
  emerald: "#00D68A",
  emeraldBg: "#0B2C21",
  red: "#FF5C6C",
  redBg: "#2E1218",
  blue: "#3FA9FF",
  blueBg: "#0F2337",
};

const PIE_COLORS = ["#8B7CFF", "#00D68A", "#3FA9FF", "#FF5C6C", "#FFB84F", "#4FE0D0", "#C97EF0", "#6C7BFF"];

const CATEGORIES_META = ["Casa", "Carro", "Viagem", "Notebook", "Investimentos", "Faculdade", "Emergência", "Outro"];
const INVESTMENT_TYPES = ["CDB", "Tesouro Direto", "FII", "ETF", "Ações", "Caixinha", "LCI/LCA", "Poupança", "Cripto", "Outro"];
const EXPENSE_CATEGORIES = ["Moradia", "Alimentação", "Transporte", "Saúde", "Educação", "Lazer", "Assinaturas", "Outros"];
const DEBT_TYPES = ["Cartão de crédito", "Empréstimo", "Financiamento", "Outro"];
const IR_ISENTO_TYPES = ["LCI/LCA", "Poupança"];

/* ============================================================
   UTIL
   ============================================================ */
const uid = () => Math.random().toString(36).slice(2, 10);
const fmtBRL = (n) => (Number.isFinite(n) ? n : 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtPct = (n) => `${(Number.isFinite(n) ? n : 0).toFixed(1)}%`;
const fmtDateShort = (d) => {
  if (!d) return "-";
  const dt = new Date(d + "T00:00:00");
  if (isNaN(dt)) return "-";
  return dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
};
const monthKey = (d) => (d || "").slice(0, 7);
const todayISO = () => new Date().toISOString().slice(0, 10);
const currentMonthKey = () => todayISO().slice(0, 7);

function monthLabel(key) {
  const [y, m] = key.split("-");
  const names = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${names[parseInt(m, 10) - 1]}/${y.slice(2)}`;
}

function lastNMonthKeys(n) {
  const arr = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    arr.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return arr;
}

function monthsBetween(startISO, endISO) {
  const s = new Date(startISO + "T00:00:00");
  const e = new Date(endISO + "T00:00:00");
  return Math.max(0, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()));
}

// Estimativa simplificada de IR (renda fixa: tabela regressiva; renda variável/cripto: 15% flat;
// isentos: poupança e LCI/LCA). Não considera vendas parciais, isenções de R$20mil/mês em ações
// nem compensação de perdas — é só uma referência aproximada.
function estimateIRRate(inv) {
  if (IR_ISENTO_TYPES.includes(inv.type)) return 0;
  if (["Ações", "ETF", "FII", "Cripto"].includes(inv.type)) return 15;
  const firstContribDate = inv.contributions.reduce((min, c) => (!min || c.date < min ? c.date : min), null);
  if (!firstContribDate) return 17.5;
  const days = Math.max(0, (new Date() - new Date(firstContribDate + "T00:00:00")) / 86400000);
  if (days <= 180) return 22.5;
  if (days <= 360) return 20;
  if (days <= 720) return 17.5;
  return 15;
}

/* ============================================================
   DADOS INICIAIS (exemplo — editável / removível)
   ============================================================ */
function emptyData() {
  return {
    isExample: false,
    accounts: [{ id: uid(), name: "Conta principal", balance: 0 }],
    emergencyFund: { current: 0, target: 0 },
    goals: [],
    investments: [],
    transactions: [],
    debts: [],
    recurringTemplates: [],
  };
}

// Preenche campos que não existiam em versões antigas dos dados salvos, pra não quebrar
// ao carregar um JSON exportado/persistido antes dessas funcionalidades existirem.
function normalizeData(raw) {
  const d = { ...raw };
  if (!Array.isArray(d.accounts)) {
    d.accounts = [{ id: uid(), name: "Conta principal", balance: Number(d.cashBalance || 0) }];
  }
  delete d.cashBalance;
  if (!Array.isArray(d.debts)) d.debts = [];
  if (!Array.isArray(d.recurringTemplates)) d.recurringTemplates = [];
  if (!Array.isArray(d.goals)) d.goals = [];
  if (!Array.isArray(d.investments)) d.investments = [];
  if (!Array.isArray(d.transactions)) d.transactions = [];
  d.transactions = d.transactions.map((t) => ({ category: t.type === "receita" ? "" : "Outros", ...t }));
  if (!d.emergencyFund) d.emergencyFund = { current: 0, target: 0 };
  return d;
}

function seedData() {
  const now = new Date();
  const iso = (offsetMonths, day = 10) => {
    const d = new Date(now.getFullYear(), now.getMonth() - offsetMonths, day);
    return d.toISOString().slice(0, 10);
  };
  return {
    isExample: true,
    accounts: [
      { id: uid(), name: "Conta principal", balance: 4200 },
      { id: uid(), name: "Carteira", balance: 150 },
    ],
    emergencyFund: { current: 3000, target: 9000 },
    goals: [
      {
        id: uid(), name: "Comprar um carro", category: "Carro", target: 50000, current: 18750,
        startDate: iso(8, 1), deadline: iso(-16, 1),
      },
      {
        id: uid(), name: "Notebook para programar", category: "Notebook", target: 6000, current: 4100,
        startDate: iso(4, 1), deadline: iso(-2, 1),
      },
      {
        id: uid(), name: "Reserva para faculdade", category: "Faculdade", target: 12000, current: 2400,
        startDate: iso(3, 1), deadline: iso(-20, 1),
      },
    ],
    investments: [
      {
        id: uid(), broker: "Nubank", type: "CDB", currentValue: 8460, dividends: 120,
        contributions: [
          { id: uid(), date: iso(9), amount: 5000 },
          { id: uid(), date: iso(6), amount: 3000 },
        ],
        dividendHistory: [
          { id: uid(), date: iso(6), amount: 60 },
          { id: uid(), date: iso(1), amount: 60 },
        ],
      },
      {
        id: uid(), broker: "XP Investimentos", type: "FII", currentValue: 6820, dividends: 340,
        contributions: [
          { id: uid(), date: iso(7), amount: 3000 },
          { id: uid(), date: iso(3), amount: 2800 },
        ],
        dividendHistory: [
          { id: uid(), date: iso(5), amount: 90 },
          { id: uid(), date: iso(2), amount: 110 },
          { id: uid(), date: iso(0), amount: 140 },
        ],
      },
      {
        id: uid(), broker: "Tesouro Direto", type: "Tesouro Direto", currentValue: 3150, dividends: 0,
        contributions: [{ id: uid(), date: iso(5), amount: 3000 }],
        dividendHistory: [],
      },
    ],
    transactions: (() => {
      const list = [];
      for (let i = 5; i >= 0; i--) {
        list.push({ id: uid(), date: iso(i, 5), type: "receita", category: "", description: "Salário CPLU", amount: 2200 });
        list.push({ id: uid(), date: iso(i, 8), type: "despesa_fixa", category: "Moradia", description: "Aluguel + contas", amount: 950 });
        list.push({ id: uid(), date: iso(i, 12), type: "despesa_fixa", category: "Educação", description: "Faculdade UNINOVE", amount: 420 });
        list.push({ id: uid(), date: iso(i, 18), type: "despesa_variavel", category: "Alimentação", description: "Mercado e transporte", amount: 380 + (i % 3) * 40 });
      }
      return list;
    })(),
    debts: [
      {
        id: uid(), name: "Cartão Nubank", type: "Cartão de crédito",
        totalAmount: 3000, remainingAmount: 1200, monthlyPayment: 300, dueDay: 10,
      },
    ],
    recurringTemplates: [
      { id: uid(), description: "Salário CPLU", type: "receita", category: "", amount: 2200, dayOfMonth: 5 },
      { id: uid(), description: "Aluguel + contas", type: "despesa_fixa", category: "Moradia", amount: 950, dayOfMonth: 8 },
    ],
  };
}

/* ============================================================
   AUTENTICAÇÃO + PERSISTÊNCIA (Firebase Auth + Firestore)
   ============================================================ */

// Pra cada modelo recorrente, garante que já exista um lançamento gerado a partir dele
// no mês atual (marcado com templateId); se não existir, cria um na data de hoje.
function generateRecurringTransactions(data) {
  const curMonth = currentMonthKey();
  const already = new Set(
    data.transactions.filter((t) => t.templateId && monthKey(t.date) === curMonth).map((t) => t.templateId)
  );
  const generated = [];
  data.recurringTemplates.forEach((tpl) => {
    if (already.has(tpl.id)) return;
    generated.push({
      id: uid(), templateId: tpl.id, date: todayISO(), type: tpl.type,
      category: tpl.category || "", description: tpl.description, amount: Number(tpl.amount || 0),
    });
  });
  if (generated.length === 0) return data;
  return { ...data, transactions: [...generated, ...data.transactions] };
}

// user === undefined: verificando sessão · null: deslogado · objeto: logado
function useAuth() {
  const [user, setUser] = useState(undefined);
  useEffect(() => window.auth.onAuthStateChanged(setUser), []);
  return user;
}

function useAppState(uid) {
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!uid) return;
    setLoaded(false);
    (async () => {
      try {
        const snap = await window.db.collection("users").doc(uid).get();
        if (snap.exists) {
          setData(generateRecurringTransactions(normalizeData(snap.data())));
        } else {
          setData(emptyData());
        }
      } catch (e) {
        setData(emptyData());
      } finally {
        setLoaded(true);
      }
    })();
  }, [uid]);

  useEffect(() => {
    if (!loaded || !data || !uid) return;
    const t = setTimeout(() => {
      window.db.collection("users").doc(uid).set(data).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [data, loaded, uid]);

  return [data, setData, loaded];
}

/* ============================================================
   ÍCONES (linhas simples, sem libs externas)
   ============================================================ */
const Icon = ({ name, size = 16, color = "currentColor" }) => {
  const s = { width: size, height: size, display: "inline-block", verticalAlign: "-3px" };
  const common = { fill: "none", stroke: color, strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case "wallet": return <svg style={s} viewBox="0 0 24 24" {...common}><path d="M3 7a2 2 0 012-2h13a1 1 0 011 1v3" /><rect x="3" y="7" width="18" height="13" rx="2" /><circle cx="16" cy="13.5" r="1.4" fill={color} stroke="none" /></svg>;
    case "trend": return <svg style={s} viewBox="0 0 24 24" {...common}><polyline points="3,17 9,11 13,15 21,6" /><polyline points="15,6 21,6 21,12" /></svg>;
    case "shield": return <svg style={s} viewBox="0 0 24 24" {...common}><path d="M12 3l7 3v6c0 5-3.5 7.5-7 9-3.5-1.5-7-4-7-9V6z" /></svg>;
    case "coins": return <svg style={s} viewBox="0 0 24 24" {...common}><ellipse cx="9" cy="7" rx="6" ry="3" /><path d="M3 7v5c0 1.66 2.69 3 6 3s6-1.34 6-3V7" /><path d="M9 12v5c0 1.66 2.69 3 6 3s6-1.34 6-3v-5" /><ellipse cx="15" cy="12" rx="6" ry="3" /></svg>;
    case "target": return <svg style={s} viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="0.6" fill={color} stroke="none" /></svg>;
    case "chart": return <svg style={s} viewBox="0 0 24 24" {...common}><line x1="4" y1="20" x2="20" y2="20" /><rect x="6" y="12" width="3" height="6" /><rect x="11" y="7" width="3" height="11" /><rect x="16" y="15" width="3" height="3" /></svg>;
    case "layers": return <svg style={s} viewBox="0 0 24 24" {...common}><polygon points="12,3 21,8 12,13 3,8" /><polyline points="3,13 12,18 21,13" /><polyline points="3,17.5 12,22.5 21,17.5" /></svg>;
    case "compass": return <svg style={s} viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="9" /><polygon points="15,9 13,13 9,15 11,11" /></svg>;
    case "bell": return <svg style={s} viewBox="0 0 24 24" {...common}><path d="M6 9a6 6 0 0112 0c0 5 2 6 2 6H4s2-1 2-6" /><path d="M10 20a2 2 0 004 0" /></svg>;
    case "plus": return <svg style={s} viewBox="0 0 24 24" {...common}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
    case "trash": return <svg style={s} viewBox="0 0 24 24" {...common}><polyline points="3,6 5,6 21,6" /><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /></svg>;
    case "x": return <svg style={s} viewBox="0 0 24 24" {...common}><line x1="5" y1="5" x2="19" y2="19" /><line x1="19" y1="5" x2="5" y2="19" /></svg>;
    case "arrow-up": return <svg style={s} viewBox="0 0 24 24" {...common}><line x1="12" y1="19" x2="12" y2="5" /><polyline points="6,11 12,5 18,11" /></svg>;
    case "arrow-down": return <svg style={s} viewBox="0 0 24 24" {...common}><line x1="12" y1="5" x2="12" y2="19" /><polyline points="6,13 12,19 18,13" /></svg>;
    case "alert": return <svg style={s} viewBox="0 0 24 24" {...common}><path d="M12 3l10 18H2z" /><line x1="12" y1="10" x2="12" y2="15" /><circle cx="12" cy="18" r="0.6" fill={color} stroke="none" /></svg>;
    case "check": return <svg style={s} viewBox="0 0 24 24" {...common}><polyline points="4,13 9,18 20,6" /></svg>;
    case "refresh": return <svg style={s} viewBox="0 0 24 24" {...common}><polyline points="1,4 1,10 7,10" /><path d="M3.5 15A9 9 0 1021 12" /></svg>;
    default: return null;
  }
};

/* ============================================================
   PRIMITIVOS DE UI
   ============================================================ */
const ACCENT_ICON = { amber: "coins", emerald: "trend", red: "trend", blue: "wallet", neutral: "layers" };

function StatCard({ label, value, sub, accent = "amber", trend, icon }) {
  const accentColor = { amber: T.amber, emerald: T.emerald, red: T.red, blue: T.blue, neutral: T.textMuted }[accent] || T.amber;
  const accentBg = { amber: T.amberBg, emerald: T.emeraldBg, red: T.redBg, blue: T.blueBg, neutral: T.surface2 }[accent] || T.amberBg;
  return (
    <div style={{
      background: T.surface1, border: `1px solid ${T.border}`, borderRadius: 16, padding: "18px 18px 16px",
      display: "flex", flexDirection: "column", gap: 10, minWidth: 0,
      boxShadow: "0 1px 2px rgba(0,0,0,0.25), 0 8px 20px -12px rgba(0,0,0,0.4)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: T.textSecondary, letterSpacing: 0.2, fontWeight: 500 }}>{label}</span>
        <span style={{
          width: 26, height: 26, borderRadius: 8, background: accentBg, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}><Icon name={icon || ACCENT_ICON[accent] || "coins"} size={13} color={accentColor} /></span>
      </div>
      <span style={{
        fontFamily: "'Manrope', 'Inter', sans-serif", fontSize: 23, fontWeight: 700, color: T.textPrimary,
        fontVariantNumeric: "tabular-nums", letterSpacing: -0.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>{value}</span>
      {sub && <span style={{ fontSize: 12, color: T.textMuted }}>{sub}</span>}
      {trend !== undefined && (
        <span style={{ fontSize: 12, color: trend >= 0 ? T.emerald : T.red, display: "flex", alignItems: "center", gap: 3, fontWeight: 600 }}>
          <Icon name={trend >= 0 ? "arrow-up" : "arrow-down"} size={12} color={trend >= 0 ? T.emerald : T.red} />
          {fmtPct(Math.abs(trend))}
        </span>
      )}
    </div>
  );
}

function ProgressBar({ pct, accent = T.amber, height = 8 }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div style={{
      width: "100%", height, borderRadius: height, overflow: "hidden", background: T.surface0,
    }}>
      <div style={{
        width: `${clamped}%`, height: "100%", borderRadius: height, background: accent,
        transition: "width 0.4s ease",
      }} />
    </div>
  );
}

function Badge({ children, tone = "neutral" }) {
  const map = {
    neutral: { bg: T.surface2 || T.surface1, fg: T.textSecondary, bd: T.border },
    amber: { bg: T.amberBg, fg: T.amber, bd: T.amberDim },
    emerald: { bg: T.emeraldBg, fg: T.emerald, bd: "#1F5C48" },
    red: { bg: T.redBg, fg: T.red, bd: "#6E2A28" },
    blue: { bg: T.blueBg, fg: T.blue, bd: "#274A78" },
  };
  const c = map[tone] || map.neutral;
  return (
    <span style={{
      fontSize: 11, padding: "3px 8px", borderRadius: 20, background: c.bg, color: c.fg,
      border: `1px solid ${c.bd}`, whiteSpace: "nowrap", fontWeight: 500, letterSpacing: 0.2,
    }}>{children}</span>
  );
}

function Btn({ children, onClick, variant = "ghost", small, style = {} }) {
  const base = {
    fontFamily: "inherit", fontSize: small ? 12 : 13, cursor: "pointer",
    borderRadius: 10, padding: small ? "7px 12px" : "10px 16px", display: "inline-flex",
    alignItems: "center", gap: 6, transition: "background 0.15s, border-color .15s, opacity .15s", fontWeight: 600,
  };
  const variants = {
    primary: { background: T.amber, color: "#FFFFFF", border: `1px solid ${T.amber}`, boxShadow: `0 4px 14px -6px ${T.amber}` },
    ghost: { background: T.surface1, color: T.textSecondary, border: `1px solid ${T.border}` },
    danger: { background: "transparent", color: T.red, border: `1px solid #5A2029` },
  };
  return (
    <button onClick={onClick} style={{ ...base, ...variants[variant], ...style }}
      onMouseEnter={(e) => { if (variant === "ghost") e.currentTarget.style.borderColor = T.borderStrong; if (variant === "primary") e.currentTarget.style.opacity = 0.9; }}
      onMouseLeave={(e) => { if (variant === "ghost") e.currentTarget.style.borderColor = T.border; if (variant === "primary") e.currentTarget.style.opacity = 1; }}
    >{children}</button>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: T.textSecondary }}>
      {label}
      {children}
    </label>
  );
}

const inputStyle = {
  background: T.surface0, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textPrimary,
  padding: "9px 12px", fontSize: 13, fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box",
};

function TextInput(props) {
  return <input {...props} style={{ ...inputStyle, ...(props.style || {}) }}
    onFocus={(e) => { e.target.style.borderColor = T.amber; }}
    onBlur={(e) => { e.target.style.borderColor = T.border; }} />;
}
function Select(props) {
  return <select {...props} style={{ ...inputStyle, ...(props.style || {}) }} />;
}

function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKeyDown = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div role="presentation" style={{
      position: "fixed", inset: 0, background: "rgba(4,7,14,0.7)", zIndex: 50,
      display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 16px", overflowY: "auto",
    }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} style={{
        background: T.surface1, border: `1px solid ${T.border}`, borderRadius: 16, padding: 22,
        width: "100%", maxWidth: wide ? 560 : 420, boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 15, color: T.textPrimary, fontWeight: 600 }}>{title}</h3>
          <button onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, padding: 4 }}>
            <Icon name="x" size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SplashScreen() {
  return (
    <div style={{
      background: T.bg, minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 18, fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; }
        @keyframes fd-splash-pulse { 0%,100% { opacity:.35; transform: scaleX(.3); } 50% { opacity:1; transform: scaleX(1); } }
        .fd-splash-bar { animation: fd-splash-pulse 1.4s ease-in-out infinite; transform-origin: left; }
      `}</style>
      <span style={{
        width: 72, height: 72, borderRadius: 20, background: `linear-gradient(135deg, ${T.amber}, #6C5CE0)`,
        display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 12px 32px -8px ${T.amber}`,
      }}>
        <Icon name="trend" size={36} color="#fff" />
      </span>
      <div style={{ textAlign: "center" }}>
        <p style={{ fontFamily: "'Manrope', 'Inter', sans-serif", fontSize: 24, fontWeight: 800, letterSpacing: -0.5, color: T.textPrimary, margin: 0 }}>
          VoidLine <span style={{ color: T.amber }}>Invest</span>
        </p>
        <p style={{ fontSize: 12.5, color: T.textMuted, margin: "6px 0 0", letterSpacing: 0.3 }}>
          controle financeiro pessoal
        </p>
      </div>
      <div style={{ width: 140, height: 3, borderRadius: 2, background: T.surface1, overflow: "hidden", marginTop: 10 }}>
        <div className="fd-splash-bar" style={{ width: "100%", height: "100%", background: `linear-gradient(90deg, ${T.amber}, #6C5CE0)`, borderRadius: 2 }} />
      </div>
    </div>
  );
}

const AUTH_ERROR_MESSAGES = {
  "auth/invalid-email": "E-mail inválido.",
  "auth/user-disabled": "Esta conta foi desativada.",
  "auth/user-not-found": "Não existe conta com esse e-mail.",
  "auth/wrong-password": "Senha incorreta.",
  "auth/invalid-credential": "E-mail ou senha incorretos.",
  "auth/email-already-in-use": "Já existe uma conta com esse e-mail.",
  "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
  "auth/popup-closed-by-user": "Login cancelado.",
  "auth/network-request-failed": "Falha de conexão. Tente novamente.",
  "auth/too-many-requests": "Muitas tentativas. Aguarde um pouco e tente de novo.",
};

function GoogleG({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.81.54-1.85.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.98v2.33A9 9 0 009 18z" />
      <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 013.68 9c0-.59.1-1.16.27-1.7V4.97H.98A9 9 0 000 9c0 1.45.35 2.83.98 4.03z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 00.98 4.97L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58z" />
    </svg>
  );
}

function LoginScreen() {
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const runAuth = async (fn) => {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(AUTH_ERROR_MESSAGES[e.code] || "Não foi possível entrar. Tente de novo.");
    } finally {
      setBusy(false);
    }
  };

  const submitEmail = () => runAuth(() => (
    mode === "signin"
      ? window.auth.signInWithEmailAndPassword(email, password)
      : window.auth.createUserWithEmailAndPassword(email, password)
  ));

  const submitGoogle = () => runAuth(() => window.auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()));

  return (
    <div style={{
      background: T.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Inter', system-ui, sans-serif", padding: 16,
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; }
      `}</style>
      <div style={{
        width: "100%", maxWidth: 380, minWidth: 0, background: T.surface1, border: `1px solid ${T.border}`, borderRadius: 20,
        padding: 28, boxShadow: "0 20px 60px rgba(0,0,0,0.5)", boxSizing: "border-box",
      }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <span style={{
            width: 52, height: 52, borderRadius: 16, background: `linear-gradient(135deg, ${T.amber}, #6C5CE0)`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icon name="trend" size={26} color="#fff" />
          </span>
          <p style={{ fontFamily: "'Manrope', 'Inter', sans-serif", fontSize: 19, fontWeight: 800, margin: 0 }}>
            VoidLine <span style={{ color: T.amber }}>Invest</span>
          </p>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 18, background: T.surface0, borderRadius: 12, padding: 4 }}>
          {[["signin", "Entrar"], ["signup", "Criar conta"]].map(([m, label]) => (
            <button key={m} onClick={() => { setMode(m); setError(""); }} style={{
              flex: 1, padding: "8px", borderRadius: 9, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
              background: mode === m ? T.surface2 : "transparent", color: mode === m ? T.textPrimary : T.textMuted,
            }}>{label}</button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="E-mail">
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" autoComplete="email" />
          </Field>
          <Field label="Senha">
            <TextInput
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" autoComplete={mode === "signin" ? "current-password" : "new-password"}
              onKeyDown={(e) => { if (e.key === "Enter" && email && password && !busy) submitEmail(); }}
            />
          </Field>
          {error && <p style={{ fontSize: 12, color: T.red, margin: 0 }}>{error}</p>}
          <Btn variant="primary" onClick={submitEmail} style={{ justifyContent: "center", opacity: busy ? 0.7 : 1 }}>
            {busy ? "Aguarde..." : mode === "signin" ? "Entrar" : "Criar conta"}
          </Btn>

          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0" }}>
            <div style={{ flex: 1, height: 1, background: T.border }} />
            <span style={{ fontSize: 11, color: T.textMuted }}>ou</span>
            <div style={{ flex: 1, height: 1, background: T.border }} />
          </div>

          <Btn variant="ghost" onClick={submitGoogle} style={{ justifyContent: "center", opacity: busy ? 0.7 : 1 }}>
            <GoogleG size={15} /> entrar com Google
          </Btn>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "28px 0 12px" }}>
      <h2 style={{ fontSize: 13, letterSpacing: 0.6, textTransform: "uppercase", color: T.textSecondary, margin: 0, fontWeight: 600 }}>{children}</h2>
      {right}
    </div>
  );
}

function EmptyState({ text, cta, onClick }) {
  return (
    <div style={{
      border: `1px dashed ${T.border}`, borderRadius: 16, padding: "28px 20px", textAlign: "center", color: T.textMuted,
    }}>
      <p style={{ margin: "0 0 12px", fontSize: 13 }}>{text}</p>
      {cta && <Btn variant="primary" small onClick={onClick}><Icon name="plus" size={13} />{cta}</Btn>}
    </div>
  );
}

function ChartFrame({ title, children, height = 260 }) {
  return (
    <div style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: 16, padding: "16px 18px 8px" }}>
      <p style={{ fontSize: 12, color: T.textSecondary, textTransform: "uppercase", letterSpacing: 0.4, margin: "0 0 10px" }}>{title}</p>
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
    </div>
  );
}

const chartCommon = {
  grid: <CartesianGrid stroke={T.border} strokeDasharray="3 5" vertical={false} />,
  axisProps: { stroke: T.textMuted, fontSize: 11, tickLine: false, axisLine: { stroke: T.border } },
  tooltipStyle: { background: T.surface0, border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12, color: T.textPrimary },
};

/* ============================================================
   CÁLCULOS DERIVADOS
   ============================================================ */
function useComputed(data) {
  return useMemo(() => {
    if (!data) return null;
    const { goals, investments, transactions, accounts, debts, emergencyFund } = data;

    const invWithTotals = investments.map((inv) => {
      const invested = inv.contributions.reduce((s, c) => s + Number(c.amount || 0), 0);
      const profit = inv.currentValue - invested;
      const rentab = invested > 0 ? (profit / invested) * 100 : 0;
      const irRate = estimateIRRate(inv);
      const irEstimado = profit > 0 ? (profit * irRate) / 100 : 0;
      return { ...inv, invested, profit, rentab, irRate, irEstimado };
    });

    const totalInvested = invWithTotals.reduce((s, i) => s + i.invested, 0);
    const totalCurrentValue = invWithTotals.reduce((s, i) => s + i.currentValue, 0);
    const totalProfit = totalCurrentValue - totalInvested;
    const totalDividends = invWithTotals.reduce((s, i) => s + Number(i.dividends || 0), 0);
    const rentabilidade = totalInvested > 0 ? ((totalProfit + totalDividends) / totalInvested) * 100 : 0;
    const totalRendimentos = totalProfit + totalDividends;
    const totalIREstimado = invWithTotals.reduce((s, i) => s + i.irEstimado, 0);
    const totalCash = accounts.reduce((s, a) => s + Number(a.balance || 0), 0);
    const totalDebts = debts.reduce((s, d) => s + Number(d.remainingAmount || 0), 0);
    const patrimonioTotal = totalCash + totalCurrentValue;
    const patrimonioLiquido = patrimonioTotal - totalDebts;

    const curMonth = currentMonthKey();
    const monthTx = transactions.filter((t) => monthKey(t.date) === curMonth);
    const receitasMes = monthTx.filter((t) => t.type === "receita").reduce((s, t) => s + Number(t.amount || 0), 0);
    const despesasMes = monthTx.filter((t) => t.type !== "receita").reduce((s, t) => s + Number(t.amount || 0), 0);
    const economiaMes = receitasMes - despesasMes;
    const taxaPoupanca = receitasMes > 0 ? (economiaMes / receitasMes) * 100 : 0;

    const despesasPorCategoriaMes = EXPENSE_CATEGORIES.map((cat) => ({
      name: cat,
      value: monthTx.filter((t) => t.type !== "receita" && (t.category || "Outros") === cat).reduce((s, t) => s + Number(t.amount || 0), 0),
    })).filter((c) => c.value > 0);

    const rendaPassivaMensal = invWithTotals.reduce((s, inv) => {
      return s + inv.dividendHistory.filter((d) => monthKey(d.date) === curMonth).reduce((a, d) => a + Number(d.amount || 0), 0);
    }, 0);
    const rendaPassivaAnual = rendaPassivaMensal * 12;

    const allContributions = invWithTotals.flatMap((i) => i.contributions.map((c) => ({ ...c, invId: i.id })));
    const allDividends = invWithTotals.flatMap((i) => i.dividendHistory.map((d) => ({ ...d, invId: i.id })));

    const goalsComputed = goals.map((g) => {
      const remaining = Math.max(0, g.target - g.current);
      const pct = g.target > 0 ? Math.min(100, (g.current / g.target) * 100) : 0;
      const monthsLeft = monthsBetween(todayISO(), g.deadline);
      const suggestedMonthly = monthsLeft > 0 ? remaining / monthsLeft : remaining;
      const isOverdue = new Date(g.deadline) < new Date() && pct < 100;
      let status = "Não iniciada";
      if (pct >= 100) status = "Concluída";
      else if (g.current > 0) status = "Em andamento";
      return { ...g, remaining, pct, monthsLeft, suggestedMonthly, isOverdue, status };
    });

    const bestInvestment = invWithTotals.reduce((best, i) => (!best || i.rentab > best.rentab ? i : best), null);
    const biggestContribution = allContributions.reduce((best, c) => (!best || c.amount > best.amount ? c : best), null);
    const monthsWithContrib = new Set(allContributions.map((c) => monthKey(c.date))).size || 1;
    const mediaAportesMensais = totalInvested / monthsWithContrib;

    // Alertas
    const alerts = [];
    goalsComputed.forEach((g) => {
      if (g.isOverdue) alerts.push({ id: `overdue-${g.id}`, tone: "red", text: `Meta "${g.name}" está com o prazo vencido.` });
      if (g.pct >= 100) alerts.push({ id: `done-${g.id}`, tone: "emerald", text: `Meta "${g.name}" atingiu 100%! Objetivo concluído.` });
      else if (g.pct >= 75) alerts.push({ id: `75-${g.id}`, tone: "amber", text: `Meta "${g.name}" já passou de 75% do objetivo.` });
      else if (g.pct >= 50) alerts.push({ id: `50-${g.id}`, tone: "amber", text: `Meta "${g.name}" atingiu metade do caminho (50%).` });
      else if (g.pct >= 25) alerts.push({ id: `25-${g.id}`, tone: "blue", text: `Meta "${g.name}" já alcançou 25% do valor.` });
    });
    if (despesasMes > receitasMes && receitasMes > 0) {
      alerts.push({ id: "budget", tone: "red", text: "As despesas do mês ultrapassaram as receitas." });
    }
    invWithTotals.forEach((i) => {
      if (i.rentab < 0) alerts.push({ id: `neg-${i.id}`, tone: "red", text: `Investimento em ${i.broker} (${i.type}) está com rentabilidade negativa.` });
    });
    if (emergencyFund.current < emergencyFund.target) {
      alerts.push({ id: "reserve", tone: "amber", text: "A reserva de emergência está abaixo da meta definida." });
    }
    const todayDay = new Date().getDate();
    debts.forEach((deb) => {
      if (deb.dueDay && deb.dueDay - todayDay >= 0 && deb.dueDay - todayDay <= 5) {
        alerts.push({ id: `debt-${deb.id}`, tone: "amber", text: `Fatura/parcela de "${deb.name}" vence em ${deb.dueDay - todayDay === 0 ? "hoje" : `${deb.dueDay - todayDay} dia(s)`}.` });
      }
    });

    return {
      investments: invWithTotals, totalInvested, totalCurrentValue, totalProfit, totalDividends,
      rentabilidade, totalRendimentos, totalIREstimado, totalCash, totalDebts, patrimonioTotal, patrimonioLiquido,
      receitasMes, despesasMes, economiaMes, taxaPoupanca, despesasPorCategoriaMes,
      rendaPassivaMensal, rendaPassivaAnual, allContributions, allDividends, goalsComputed,
      bestInvestment, biggestContribution, mediaAportesMensais, alerts, curMonth,
    };
  }, [data]);
}

/* ============================================================
   APP
   ============================================================ */
function App() {
  const user = useAuth();
  const [data, setData, loaded] = useAppState(user ? user.uid : null);
  const computed = useComputed(data);
  const [tab, setTab] = useState("dashboard");
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [modal, setModal] = useState(null); // {type, payload}
  const [confirmReset, setConfirmReset] = useState(null); // 'example' | 'clear' | null
  const fileInputRef = React.useRef(null);

  const update = useCallback((fn) => setData((prev) => { const next = structuredClone(prev); fn(next); next.isExample = false; return next; }), [setData]);

  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `voidline-invest-backup-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importData = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        setData(generateRecurringTransactions(normalizeData(parsed)));
      } catch (err) {
        window.alert("Arquivo inválido — não foi possível importar esses dados.");
      }
    };
    reader.readAsText(file);
  };

  const [splashMinElapsed, setSplashMinElapsed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSplashMinElapsed(true), 700);
    return () => clearTimeout(t);
  }, []);

  if (user === undefined || !splashMinElapsed) {
    return <SplashScreen />;
  }
  if (user === null) {
    return <LoginScreen />;
  }
  if (!loaded || !data || !computed) {
    return <SplashScreen />;
  }

  const NAV = [
    { id: "dashboard", label: "Painel", icon: "compass" },
    { id: "metas", label: "Metas", icon: "target" },
    { id: "investimentos", label: "Investimentos", icon: "layers" },
    { id: "financeiro", label: "Financeiro", icon: "wallet" },
    { id: "projecoes", label: "Projeções", icon: "trend" },
    { id: "indicadores", label: "Indicadores", icon: "chart" },
  ];

  return (
    <div style={{
      background: T.bg, color: T.textPrimary, minHeight: "100vh", fontFamily: "'Inter', system-ui, sans-serif",
      display: "flex",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 4px; }
        button { font-family: inherit; }
        input[type=date] { color-scheme: dark; }
        .navbtn { display:flex; align-items:center; gap:10px; padding:11px 14px; border-radius:12px; cursor:pointer; font-size:13.5px; font-weight:500; color:${T.textSecondary}; border:1px solid transparent; }
        .navbtn:hover { background:${T.surface1}; color:${T.textPrimary}; }
        .navbtn.active { background:linear-gradient(135deg, ${T.amber}, #6C5CE0); color:#FFFFFF; box-shadow:0 4px 16px -6px ${T.amber}; }
        .row-hover:hover { background:${T.surface2}; }
        .fd-main { padding: 22px 26px 90px; }
        .fd-grid-main { display:grid; grid-template-columns: 1.4fr 1fr; }
        .fd-grid-2 { display:grid; grid-template-columns: 1fr 1fr; }
        .fd-alerts-panel { width: 320px; max-width: 92vw; }
        .fd-tx-scroll { overflow-x: auto; }
        @media (max-width:1024px) {
          .fd-sidebar { display:none !important; }
          .fd-mobilenav { display:flex !important; }
        }
        @media (max-width:700px) {
          .fd-main { padding: 14px 12px 84px; }
          .fd-grid-main, .fd-grid-2 { grid-template-columns: 1fr; }
          h1 { font-size: 17px !important; }
        }
        @media (max-width:420px) {
          .fd-main { padding: 10px 8px 84px; }
        }
      `}</style>

      {/* SIDEBAR */}
      <div className="fd-sidebar" style={{
        width: 220, borderRight: `1px solid ${T.border}`, padding: "22px 14px", display: "flex", flexDirection: "column", gap: 4, flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px 26px" }}>
          <span style={{
            width: 32, height: 32, borderRadius: 10, background: `linear-gradient(135deg, ${T.amber}, #6C5CE0)`,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}><Icon name="trend" size={17} color="#fff" /></span>
          <span style={{ fontFamily: "'Manrope', 'Inter', sans-serif", fontSize: 15, fontWeight: 800, letterSpacing: -0.3 }}>VoidLine <span style={{ color: T.amber }}>Invest</span></span>
        </div>
        {NAV.map((n) => (
          <div key={n.id} className={`navbtn ${tab === n.id ? "active" : ""}`} onClick={() => setTab(n.id)}>
            <Icon name={n.icon} size={15} /> {n.label}
          </div>
        ))}
        <div style={{
          marginTop: "auto", padding: "16px 14px", borderRadius: 14, background: T.surface1,
          border: `1px solid ${T.border}`,
        }}>
          <p style={{ fontSize: 11, color: T.textMuted, margin: 0, lineHeight: 1.5, textTransform: "uppercase", letterSpacing: 0.3 }}>
            Patrimônio total
          </p>
          <span style={{ fontFamily: "'Manrope', 'Inter', sans-serif", fontSize: 18, color: T.textPrimary, fontWeight: 800, letterSpacing: -0.3 }}>{fmtBRL(computed.patrimonioTotal)}</span>
        </div>
        <div style={{
          marginTop: 8, padding: "10px 12px", borderRadius: 14, background: T.surface1, border: `1px solid ${T.border}`,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{
            width: 24, height: 24, borderRadius: "50%", background: T.surface2, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", fontSize: 11, fontWeight: 700, color: T.textSecondary,
          }}>
            {user.photoURL ? <img src={user.photoURL} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (user.email || "?")[0].toUpperCase()}
          </span>
          <span style={{ fontSize: 11.5, color: T.textSecondary, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user.email}
          </span>
          <button onClick={() => window.auth.signOut()} title="Sair" style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", flexShrink: 0, padding: 2 }}>
            <Icon name="x" size={13} />
          </button>
        </div>
      </div>

      {/* MOBILE NAV */}
      <div className="fd-mobilenav" style={{
        display: "none", position: "fixed", bottom: 0, left: 0, right: 0, background: T.surface1,
        borderTop: `1px solid ${T.border}`, zIndex: 40, padding: "8px 4px calc(8px + env(safe-area-inset-bottom))", justifyContent: "space-around",
      }}>
        {NAV.map((n) => (
          <div key={n.id} onClick={() => setTab(n.id)} style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 2, fontSize: 10,
            color: tab === n.id ? T.amber : T.textMuted, cursor: "pointer", padding: 4,
          }}>
            <Icon name={n.icon} size={16} color={tab === n.id ? T.amber : T.textMuted} />
            {n.label}
          </div>
        ))}
      </div>

      {/* MAIN */}
      <div className="fd-main" style={{ flex: 1, minWidth: 0, maxWidth: 1180 }}>
        {/* TOPBAR */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 19, margin: 0, fontWeight: 600 }}>{NAV.find((n) => n.id === tab)?.label}</h1>
            <p style={{ margin: "3px 0 0", fontSize: 12, color: T.textMuted, fontFamily: "'Manrope', 'Inter', sans-serif" }}>
              atualizado automaticamente · {new Date().toLocaleDateString("pt-BR")}
            </p>
          </div>
          <div style={{ position: "relative", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input ref={fileInputRef} type="file" accept="application/json" style={{ display: "none" }} onChange={importData} />
            <Btn small variant="ghost" onClick={exportData}>
              <Icon name="wallet" size={13} /> exportar dados
            </Btn>
            <Btn small variant="ghost" onClick={() => fileInputRef.current && fileInputRef.current.click()}>
              <Icon name="plus" size={13} /> importar dados
            </Btn>
            <Btn small variant="ghost" onClick={() => setConfirmReset("example")}>
              <Icon name="refresh" size={13} /> carregar exemplo
            </Btn>
            <Btn small variant="ghost" onClick={() => setConfirmReset("clear")}>
              <Icon name="trash" size={13} /> limpar dados
            </Btn>
            <Btn small variant="ghost" onClick={() => window.auth.signOut()} title={user.email}>
              <Icon name="x" size={13} /> sair
            </Btn>
            <div style={{ position: "relative" }}>
              <Btn variant="ghost" onClick={() => setAlertsOpen((v) => !v)}>
                <Icon name="bell" size={14} />
                Alertas
                {computed.alerts.length > 0 && (
                  <span style={{ background: T.red, color: "#fff", fontSize: 10, borderRadius: 10, padding: "1px 6px", marginLeft: 2 }}>{computed.alerts.length}</span>
                )}
              </Btn>
              {alertsOpen && (
                <div className="fd-alerts-panel" style={{
                  position: "absolute", right: 0, top: 42, maxHeight: 360, overflowY: "auto",
                  background: T.surface1, border: `1px solid ${T.border}`, borderRadius: 16, padding: 10, zIndex: 30,
                  boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
                }}>
                  {computed.alerts.length === 0 && <p style={{ fontSize: 12, color: T.textMuted, padding: 8 }}>Nenhum alerta no momento.</p>}
                  {computed.alerts.map((a) => (
                    <div key={a.id} style={{ display: "flex", gap: 8, padding: "8px 6px", borderBottom: `1px solid ${T.border}` }}>
                      <Icon name="alert" size={14} color={{ red: T.red, amber: T.amber, emerald: T.emerald, blue: T.blue }[a.tone]} />
                      <span style={{ fontSize: 12, color: T.textSecondary, lineHeight: 1.4 }}>{a.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {tab === "dashboard" && <Dashboard data={data} c={computed} />}
        {tab === "metas" && <Metas data={data} c={computed} update={update} modal={modal} setModal={setModal} />}
        {tab === "investimentos" && <Investimentos data={data} c={computed} update={update} modal={modal} setModal={setModal} />}
        {tab === "financeiro" && <Financeiro data={data} c={computed} update={update} modal={modal} setModal={setModal} />}
        {tab === "projecoes" && <Projecoes data={data} c={computed} />}
        {tab === "indicadores" && <Indicadores data={data} c={computed} />}
      </div>

      {confirmReset && (
        <Modal
          title={confirmReset === "example" ? "Carregar dados de exemplo" : "Limpar todos os dados"}
          onClose={() => setConfirmReset(null)}
        >
          <p style={{ fontSize: 13, color: T.textSecondary, lineHeight: 1.6, margin: "0 0 16px" }}>
            {confirmReset === "example"
              ? "Isso vai substituir tudo o que está no painel por dados fictícios de demonstração. Não é possível desfazer."
              : "Isso vai apagar metas, investimentos, lançamentos e saldos cadastrados. Não é possível desfazer."}
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn variant="ghost" onClick={() => setConfirmReset(null)}>Cancelar</Btn>
            <Btn variant="danger" onClick={() => { setData(confirmReset === "example" ? seedData() : emptyData()); setConfirmReset(null); }}>
              {confirmReset === "example" ? "Carregar exemplo" : "Apagar tudo"}
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function Dashboard({ data, c }) {
  const patrimonioHistory = useMemo(() => buildPatrimonioHistory(data, c), [data, c]);
  const walletDist = c.investments.map((i, idx) => ({ name: `${i.broker} (${i.type})`, value: i.currentValue }));
  if (c.totalCash > 0) walletDist.push({ name: "Dinheiro em conta", value: c.totalCash });

  return (
    <div>
      <SectionTitle>Visão geral</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
        <StatCard label="Patrimônio total" value={fmtBRL(c.patrimonioTotal)} accent="amber" sub="Conta + investimentos" />
        <StatCard label="Patrimônio líquido" value={fmtBRL(c.patrimonioLiquido)} accent={c.patrimonioLiquido >= 0 ? "emerald" : "red"} sub="Patrimônio - dívidas" />
        <StatCard label="Dinheiro em conta" value={fmtBRL(c.totalCash)} accent="blue" sub={`${data.accounts.length} conta(s)`} />
        <StatCard label="Dívidas totais" value={fmtBRL(c.totalDebts)} accent={c.totalDebts > 0 ? "red" : "neutral"} />
        <StatCard label="Total investido" value={fmtBRL(c.totalInvested)} accent="blue" sub={`Valor atual: ${fmtBRL(c.totalCurrentValue)}`} />
        <StatCard label="Reserva de emergência" value={fmtBRL(data.emergencyFund.current)}
          accent={data.emergencyFund.current >= data.emergencyFund.target ? "emerald" : "amber"}
          sub={`Meta: ${fmtBRL(data.emergencyFund.target)}`} />
        <StatCard label="Renda passiva mensal" value={fmtBRL(c.rendaPassivaMensal)} accent="emerald" />
        <StatCard label="Renda passiva anual" value={fmtBRL(c.rendaPassivaAnual)} accent="emerald" sub="Projetado (mensal × 12)" />
        <StatCard label="Total de rendimentos" value={fmtBRL(c.totalRendimentos)} accent={c.totalRendimentos >= 0 ? "emerald" : "red"} sub="Lucro + dividendos" />
        <StatCard label="Rentabilidade" value={fmtPct(c.rentabilidade)} accent={c.rentabilidade >= 0 ? "emerald" : "red"} trend={c.rentabilidade} />
        <StatCard label="Economia do mês" value={fmtBRL(c.economiaMes)} accent={c.economiaMes >= 0 ? "emerald" : "red"} />
        <StatCard label="Taxa de poupança" value={fmtPct(c.taxaPoupanca)} accent={c.taxaPoupanca >= 0 ? "emerald" : "red"} />
      </div>

      <SectionTitle>Gráficos</SectionTitle>
      <div className="fd-grid-main" style={{ gap: 12 }}>
        <ChartFrame title="Evolução do patrimônio">
          <AreaChart data={patrimonioHistory}>
            {chartCommon.grid}
            <XAxis dataKey="label" {...chartCommon.axisProps} />
            <YAxis {...chartCommon.axisProps} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} width={40} />
            <Tooltip contentStyle={chartCommon.tooltipStyle} formatter={(v) => fmtBRL(v)} />
            <Area type="monotone" dataKey="patrimonio" stroke={T.amber} fill={T.amber} fillOpacity={0.15} strokeWidth={2} />
          </AreaChart>
        </ChartFrame>
        <ChartFrame title="Distribuição da carteira">
          {walletDist.length === 0 ? <EmptyState text="Sem dados para exibir." /> : (
            <PieChart>
              <Pie data={walletDist} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                {walletDist.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke={T.surface1} strokeWidth={2} />)}
              </Pie>
              <Tooltip contentStyle={chartCommon.tooltipStyle} formatter={(v) => fmtBRL(v)} />
            </PieChart>
          )}
        </ChartFrame>
      </div>

      <div className="fd-grid-2" style={{ marginTop: 12, gap: 12 }}>
        <ChartFrame title="Receitas x despesas (últimos 6 meses)" height={230}>
          <BarChart data={buildReceitaDespesa(data)}>
            {chartCommon.grid}
            <XAxis dataKey="label" {...chartCommon.axisProps} />
            <YAxis {...chartCommon.axisProps} tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`} width={40} />
            <Tooltip contentStyle={chartCommon.tooltipStyle} formatter={(v) => fmtBRL(v)} />
            <Legend wrapperStyle={{ fontSize: 11, color: T.textSecondary }} />
            <Bar dataKey="Receitas" fill={T.emerald} radius={[3, 3, 0, 0]} />
            <Bar dataKey="Despesas" fill={T.red} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ChartFrame>
        <ChartFrame title="Evolução das metas" height={230}>
          {c.goalsComputed.length === 0 ? <EmptyState text="Nenhuma meta cadastrada." /> : (
            <BarChart data={c.goalsComputed.map((g) => ({ name: g.name.length > 12 ? g.name.slice(0, 12) + "…" : g.name, Progresso: Number(g.pct.toFixed(1)) }))} layout="vertical" margin={{ left: 10 }}>
              {chartCommon.grid}
              <XAxis type="number" domain={[0, 100]} {...chartCommon.axisProps} tickFormatter={(v) => `${v}%`} />
              <YAxis type="category" dataKey="name" {...chartCommon.axisProps} width={100} />
              <Tooltip contentStyle={chartCommon.tooltipStyle} formatter={(v) => `${v}%`} />
              <Bar dataKey="Progresso" fill={T.amber} radius={[0, 3, 3, 0]} />
            </BarChart>
          )}
        </ChartFrame>
      </div>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
        <ChartFrame title="Gastos por categoria (mês atual)" height={240}>
          {c.despesasPorCategoriaMes.length === 0 ? <EmptyState text="Nenhuma despesa categorizada este mês." /> : (
            <PieChart>
              <Pie data={c.despesasPorCategoriaMes} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                {c.despesasPorCategoriaMes.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke={T.surface1} strokeWidth={2} />)}
              </Pie>
              <Tooltip contentStyle={chartCommon.tooltipStyle} formatter={(v) => fmtBRL(v)} />
              <Legend wrapperStyle={{ fontSize: 11, color: T.textSecondary }} />
            </PieChart>
          )}
        </ChartFrame>
      </div>
    </div>
  );
}

function buildPatrimonioHistory(data, c) {
  const months = lastNMonthKeys(9);
  let runningCash = 0;
  const monthlyFlow = {};
  months.forEach((m) => { monthlyFlow[m] = 0; });
  data.transactions.forEach((t) => {
    const k = monthKey(t.date);
    if (!(k in monthlyFlow)) return;
    monthlyFlow[k] += t.type === "receita" ? Number(t.amount || 0) : -Number(t.amount || 0);
  });
  const investedByMonth = {};
  months.forEach((m) => { investedByMonth[m] = 0; });
  c.allContributions.forEach((ct) => {
    const k = monthKey(ct.date);
    if (k in investedByMonth) investedByMonth[k] += Number(ct.amount || 0);
  });

  let cumCash = c.totalCash - months.reduce((s, m) => s + monthlyFlow[m], 0);
  const totalContribAll = c.allContributions.reduce((s, ct) => s + Number(ct.amount || 0), 0);
  let cumInvested = totalContribAll - months.reduce((s, m) => s + investedByMonth[m], 0);
  // escala os aportes acumulados pra refletir lucro/prejuízo, senão o último ponto do
  // gráfico (só aportes) diverge do card "Patrimônio total" (aportes + rendimento)
  const growthFactor = totalContribAll > 0 ? c.totalCurrentValue / totalContribAll : 1;

  return months.map((m) => {
    cumCash += monthlyFlow[m];
    cumInvested += investedByMonth[m];
    return { label: monthLabel(m), patrimonio: Math.round(cumCash + cumInvested * growthFactor) };
  });
}

function buildReceitaDespesa(data) {
  const months = lastNMonthKeys(6);
  return months.map((m) => {
    const tx = data.transactions.filter((t) => monthKey(t.date) === m);
    const receitas = tx.filter((t) => t.type === "receita").reduce((s, t) => s + Number(t.amount || 0), 0);
    const despesas = tx.filter((t) => t.type !== "receita").reduce((s, t) => s + Number(t.amount || 0), 0);
    return { label: monthLabel(m), Receitas: receitas, Despesas: despesas };
  });
}

/* ============================================================
   METAS
   ============================================================ */
function Metas({ data, c, update, modal, setModal }) {
  const emptyForm = { name: "", category: CATEGORIES_META[0], target: "", current: "", startDate: todayISO(), deadline: "", linkedInvestmentId: "" };
  const [form, setForm] = useState(emptyForm);
  const [amountDraft, setAmountDraft] = useState("");

  const openNew = () => { setForm(emptyForm); setModal({ type: "goal-new" }); };
  const openEdit = (g) => { setForm({ name: g.name, category: g.category, target: g.target, current: g.current, startDate: g.startDate, deadline: g.deadline, linkedInvestmentId: g.linkedInvestmentId || "" }); setModal({ type: "goal-edit", id: g.id }); };

  const save = () => {
    if (!form.name || !form.target || !form.deadline) return;
    update((d) => {
      if (modal.type === "goal-new") {
        d.goals.push({ id: uid(), name: form.name, category: form.category, target: Number(form.target), current: Number(form.current || 0), startDate: form.startDate, deadline: form.deadline, linkedInvestmentId: form.linkedInvestmentId || null });
      } else {
        const g = d.goals.find((x) => x.id === modal.id);
        Object.assign(g, { name: form.name, category: form.category, target: Number(form.target), current: Number(form.current || 0), startDate: form.startDate, deadline: form.deadline, linkedInvestmentId: form.linkedInvestmentId || null });
      }
    });
    setModal(null);
  };

  const remove = (id) => update((d) => { d.goals = d.goals.filter((g) => g.id !== id); });
  const addToGoal = (id, amount) => update((d) => { const g = d.goals.find((x) => x.id === id); g.current = Math.max(0, g.current + amount); });

  return (
    <div>
      <SectionTitle right={<Btn variant="primary" small onClick={openNew}><Icon name="plus" size={13} />Nova meta</Btn>}>Metas financeiras</SectionTitle>

      {c.goalsComputed.length === 0 && <EmptyState text="Você ainda não tem metas cadastradas." cta="Criar primeira meta" onClick={openNew} />}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
        {c.goalsComputed.map((g) => (
          <div key={g.id} style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: 16, padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div>
                <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{g.name}</p>
                <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  <Badge tone="neutral">{g.category}</Badge>
                  <Badge tone={g.status === "Concluída" ? "emerald" : g.isOverdue ? "red" : g.status === "Em andamento" ? "amber" : "neutral"}>{g.isOverdue ? "Atrasada" : g.status}</Badge>
                  {g.linkedInvestmentId && (() => {
                    const linked = c.investments.find((i) => i.id === g.linkedInvestmentId);
                    return linked ? <Badge tone="blue">Vinculada: {linked.broker}</Badge> : null;
                  })()}
                </div>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={() => openEdit(g)} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", fontSize: 11 }}>editar</button>
                <button onClick={() => remove(g.id)} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer" }}><Icon name="trash" size={13} /></button>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "'Manrope', 'Inter', sans-serif", fontSize: 13, marginBottom: 6 }}>
              <span style={{ color: T.textSecondary }}>Guardado: <b style={{ color: T.textPrimary }}>{fmtBRL(g.current)}</b></span>
              <span style={{ color: T.amber, fontWeight: 600 }}>{fmtPct(g.pct)}</span>
            </div>
            <ProgressBar pct={g.pct} accent={g.pct >= 100 ? T.emerald : T.amber} />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12, fontSize: 12, color: T.textSecondary }}>
              <span>Objetivo: <b style={{ color: T.textPrimary }}>{fmtBRL(g.target)}</b></span>
              <span>Falta: <b style={{ color: T.textPrimary }}>{fmtBRL(g.remaining)}</b></span>
              <span>Prazo: <b style={{ color: T.textPrimary }}>{fmtDateShort(g.deadline)}</b></span>
              <span>Guardar/mês: <b style={{ color: T.textPrimary }}>{fmtBRL(g.suggestedMonthly)}</b></span>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <Btn small variant="ghost" onClick={() => addToGoal(g.id, 100)}>+ R$100</Btn>
              <Btn small variant="ghost" onClick={() => { setAmountDraft(""); setModal({ type: "goal-add", id: g.id }); }}>+ Outro valor</Btn>
            </div>
          </div>
        ))}
      </div>

      {modal && modal.type === "goal-add" && (
        <Modal title="Adicionar valor à meta" onClose={() => setModal(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label="Valor a adicionar (R$)">
              <TextInput type="number" autoFocus value={amountDraft} onChange={(e) => setAmountDraft(e.target.value)} placeholder="Ex: 250" />
            </Field>
            <Btn variant="primary" onClick={() => {
              const v = Number(amountDraft);
              if (amountDraft !== "" && !isNaN(v)) addToGoal(modal.id, v);
              setModal(null);
            }} style={{ justifyContent: "center", marginTop: 6 }}>Adicionar</Btn>
          </div>
        </Modal>
      )}

      {modal && (modal.type === "goal-new" || modal.type === "goal-edit") && (
        <Modal title={modal.type === "goal-new" ? "Nova meta" : "Editar meta"} onClose={() => setModal(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label="Nome da meta"><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex: Comprar um carro" /></Field>
            <Field label="Categoria">
              <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES_META.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
              </Select>
            </Field>
            <Field label="Investimento vinculado (opcional)">
              <Select value={form.linkedInvestmentId} onChange={(e) => setForm({ ...form, linkedInvestmentId: e.target.value })}>
                <option value="">Nenhum</option>
                {data.investments.map((inv) => <option key={inv.id} value={inv.id}>{inv.broker} ({inv.type})</option>)}
              </Select>
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Valor objetivo (R$)"><TextInput type="number" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} /></Field>
              <Field label="Valor atual (R$)"><TextInput type="number" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} /></Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Data de início"><TextInput type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
              <Field label="Prazo final"><TextInput type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></Field>
            </div>
            <Btn variant="primary" onClick={save} style={{ justifyContent: "center", marginTop: 6 }}>Salvar meta</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ============================================================
   INVESTIMENTOS
   ============================================================ */
function Investimentos({ data, c, update, modal, setModal }) {
  const emptyForm = { broker: "", type: INVESTMENT_TYPES[0], currentValue: "", initialAmount: "", initialDate: todayISO(), dividends: "" };
  const [form, setForm] = useState(emptyForm);

  const openNew = () => { setForm(emptyForm); setModal({ type: "inv-new" }); };
  const openEdit = (inv) => { setForm({ broker: inv.broker, type: inv.type, currentValue: inv.currentValue, dividends: inv.dividends, initialAmount: "", initialDate: todayISO() }); setModal({ type: "inv-edit", id: inv.id }); };
  const remove = (id) => update((d) => { d.investments = d.investments.filter((i) => i.id !== id); });

  const save = () => {
    if (!form.broker || !form.currentValue) return;
    update((d) => {
      if (modal.type === "inv-edit") {
        const inv = d.investments.find((i) => i.id === modal.id);
        Object.assign(inv, { broker: form.broker, type: form.type, currentValue: Number(form.currentValue), dividends: Number(form.dividends || 0) });
      } else {
        d.investments.push({
          id: uid(), broker: form.broker, type: form.type, currentValue: Number(form.currentValue),
          dividends: Number(form.dividends || 0),
          contributions: form.initialAmount ? [{ id: uid(), date: form.initialDate, amount: Number(form.initialAmount) }] : [],
          dividendHistory: [],
        });
      }
    });
    setModal(null);
  };

  const [amountModal, setAmountModal] = useState({ open: false, invId: null, kind: null, value: "", date: todayISO() });
  const addContribution = (id) => setAmountModal({ open: true, invId: id, kind: "aporte", value: "", date: todayISO() });
  const addDividend = (id) => setAmountModal({ open: true, invId: id, kind: "dividendo", value: "", date: todayISO() });
  const editValue = (id) => {
    const inv = data.investments.find((x) => x.id === id);
    setAmountModal({ open: true, invId: id, kind: "valor", value: String(inv.currentValue), date: todayISO() });
  };
  const confirmAmountModal = () => {
    const v = Number(amountModal.value);
    if (amountModal.value === "" || isNaN(v)) return;
    update((d) => {
      const inv = d.investments.find((x) => x.id === amountModal.invId);
      if (amountModal.kind === "aporte") {
        inv.contributions.push({ id: uid(), date: amountModal.date, amount: v });
      } else if (amountModal.kind === "dividendo") {
        inv.dividendHistory.push({ id: uid(), date: amountModal.date, amount: v });
        inv.dividends = Number(inv.dividends || 0) + v;
      } else if (amountModal.kind === "valor") {
        inv.currentValue = v;
      }
    });
    setAmountModal({ open: false, invId: null, kind: null, value: "", date: todayISO() });
  };

  return (
    <div>
      <SectionTitle right={<Btn variant="primary" small onClick={openNew}><Icon name="plus" size={13} />Novo investimento</Btn>}>Investimentos</SectionTitle>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 18 }}>
        <StatCard label="Total investido" value={fmtBRL(c.totalInvested)} accent="blue" />
        <StatCard label="Lucro total" value={fmtBRL(c.totalProfit)} accent={c.totalProfit >= 0 ? "emerald" : "red"} />
        <StatCard label="Patrimônio investido" value={fmtBRL(c.totalCurrentValue)} accent="amber" />
        <StatCard label="Dividendos recebidos" value={fmtBRL(c.totalDividends)} accent="emerald" />
      </div>

      {c.investments.length === 0 && <EmptyState text="Nenhum investimento cadastrado." cta="Cadastrar investimento" onClick={openNew} />}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {c.investments.map((inv) => {
          const participacao = c.totalCurrentValue > 0 ? (inv.currentValue / c.totalCurrentValue) * 100 : 0;
          return (
            <div key={inv.id} style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: 16, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{inv.broker}</p>
                    <Badge tone="blue">{inv.type}</Badge>
                    <Badge tone="neutral">{fmtPct(participacao)} da carteira</Badge>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: "4px 20px", marginTop: 10, fontSize: 12, color: T.textSecondary, fontFamily: "'Manrope', 'Inter', sans-serif" }}>
                    <span>Investido: <b style={{ color: T.textPrimary }}>{fmtBRL(inv.invested)}</b></span>
                    <span>Valor atual: <b style={{ color: T.textPrimary }}>{fmtBRL(inv.currentValue)}</b></span>
                    <span>Lucro: <b style={{ color: inv.profit >= 0 ? T.emerald : T.red }}>{fmtBRL(inv.profit)}</b></span>
                    <span>Rentab.: <b style={{ color: inv.rentab >= 0 ? T.emerald : T.red }}>{fmtPct(inv.rentab)}</b></span>
                    <span>Dividendos: <b style={{ color: T.textPrimary }}>{fmtBRL(inv.dividends)}</b></span>
                    <span>Aportes: <b style={{ color: T.textPrimary }}>{inv.contributions.length}</b></span>
                    <span>IR estimado: <b style={{ color: T.textPrimary }}>{inv.irRate === 0 ? "isento" : `${fmtBRL(inv.irEstimado)} (${inv.irRate}%)`}</b></span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => openEdit(inv)} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", fontSize: 11 }}>editar</button>
                    <button onClick={() => remove(inv.id)} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer" }}><Icon name="trash" size={13} /></button>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <Btn small variant="ghost" onClick={() => addContribution(inv.id)}>+ aporte</Btn>
                    <Btn small variant="ghost" onClick={() => addDividend(inv.id)}>+ dividendo</Btn>
                    <Btn small variant="ghost" onClick={() => editValue(inv.id)}>atualizar valor</Btn>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {modal && (modal.type === "inv-new" || modal.type === "inv-edit") && (
        <Modal title={modal.type === "inv-new" ? "Novo investimento" : "Editar investimento"} onClose={() => setModal(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label="Banco / Corretora"><TextInput value={form.broker} onChange={(e) => setForm({ ...form, broker: e.target.value })} placeholder="Ex: Nubank, XP, Rico..." /></Field>
            <Field label="Tipo">
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {INVESTMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
            {modal.type === "inv-new" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Aporte inicial (R$)"><TextInput type="number" value={form.initialAmount} onChange={(e) => setForm({ ...form, initialAmount: e.target.value })} /></Field>
                <Field label="Data do aporte"><TextInput type="date" value={form.initialDate} onChange={(e) => setForm({ ...form, initialDate: e.target.value })} /></Field>
              </div>
            )}
            <Field label="Valor atual (R$)"><TextInput type="number" value={form.currentValue} onChange={(e) => setForm({ ...form, currentValue: e.target.value })} placeholder="Se igual ao aporte, deixe o mesmo valor" /></Field>
            <Field label="Dividendos já recebidos (R$)"><TextInput type="number" value={form.dividends} onChange={(e) => setForm({ ...form, dividends: e.target.value })} /></Field>
            <Btn variant="primary" onClick={save} style={{ justifyContent: "center", marginTop: 6 }}>{modal.type === "inv-new" ? "Salvar investimento" : "Salvar alterações"}</Btn>
          </div>
        </Modal>
      )}

      {amountModal.open && (
        <Modal
          title={amountModal.kind === "aporte" ? "Novo aporte" : amountModal.kind === "dividendo" ? "Novo dividendo" : "Atualizar valor atual"}
          onClose={() => setAmountModal({ open: false, invId: null, kind: null, value: "", date: todayISO() })}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label="Valor (R$)">
              <TextInput type="number" autoFocus value={amountModal.value} onChange={(e) => setAmountModal({ ...amountModal, value: e.target.value })} />
            </Field>
            {amountModal.kind !== "valor" && (
              <Field label="Data">
                <TextInput type="date" value={amountModal.date} onChange={(e) => setAmountModal({ ...amountModal, date: e.target.value })} />
              </Field>
            )}
            <Btn variant="primary" onClick={confirmAmountModal} style={{ justifyContent: "center", marginTop: 6 }}>Confirmar</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ============================================================
   FINANCEIRO
   ============================================================ */
function Financeiro({ data, c, update, modal, setModal }) {
  const emptyForm = { type: "receita", category: "", description: "", amount: "", date: todayISO() };
  const [form, setForm] = useState(emptyForm);
  const [filterText, setFilterText] = useState("");
  const [filterType, setFilterType] = useState("todos");
  const [filterMonth, setFilterMonth] = useState("todos");
  const [accountForm, setAccountForm] = useState({ name: "", balance: "" });
  const [debtForm, setDebtForm] = useState({ name: "", type: DEBT_TYPES[0], totalAmount: "", remainingAmount: "", monthlyPayment: "", dueDay: "" });
  const [templateForm, setTemplateForm] = useState({ description: "", type: "despesa_fixa", category: EXPENSE_CATEGORIES[0], amount: "", dayOfMonth: "" });

  const openNew = () => { setForm(emptyForm); setModal({ type: "tx-new" }); };
  const openEdit = (t) => { setForm({ type: t.type, category: t.category || "", description: t.description, amount: t.amount, date: t.date }); setModal({ type: "tx-edit", id: t.id }); };
  const save = () => {
    if (!form.description || !form.amount) return;
    const payload = { date: form.date, type: form.type, category: form.type === "receita" ? "" : (form.category || "Outros"), description: form.description, amount: Number(form.amount) };
    update((d) => {
      if (modal.type === "tx-edit") {
        Object.assign(d.transactions.find((t) => t.id === modal.id), payload);
      } else {
        d.transactions.unshift({ id: uid(), ...payload });
      }
    });
    setModal(null);
  };
  const remove = (id) => update((d) => { d.transactions = d.transactions.filter((t) => t.id !== id); });

  const addAccount = () => {
    if (!accountForm.name) return;
    update((d) => { d.accounts.push({ id: uid(), name: accountForm.name, balance: Number(accountForm.balance || 0) }); });
    setAccountForm({ name: "", balance: "" });
  };
  const removeAccount = (id) => update((d) => { d.accounts = d.accounts.filter((a) => a.id !== id); });
  const updateAccountBalance = (id, value) => update((d) => { d.accounts.find((a) => a.id === id).balance = Number(value || 0); });

  const addDebt = () => {
    if (!debtForm.name || debtForm.remainingAmount === "") return;
    update((d) => {
      d.debts.push({
        id: uid(), name: debtForm.name, type: debtForm.type,
        totalAmount: Number(debtForm.totalAmount || 0), remainingAmount: Number(debtForm.remainingAmount || 0),
        monthlyPayment: Number(debtForm.monthlyPayment || 0), dueDay: Number(debtForm.dueDay || 0),
      });
    });
    setDebtForm({ name: "", type: DEBT_TYPES[0], totalAmount: "", remainingAmount: "", monthlyPayment: "", dueDay: "" });
  };
  const removeDebt = (id) => update((d) => { d.debts = d.debts.filter((x) => x.id !== id); });

  const addTemplate = () => {
    if (!templateForm.description || !templateForm.amount) return;
    update((d) => {
      d.recurringTemplates.push({
        id: uid(), description: templateForm.description, type: templateForm.type,
        category: templateForm.type === "receita" ? "" : templateForm.category,
        amount: Number(templateForm.amount), dayOfMonth: Number(templateForm.dayOfMonth || 1),
      });
    });
    setTemplateForm({ description: "", type: "despesa_fixa", category: EXPENSE_CATEGORIES[0], amount: "", dayOfMonth: "" });
  };
  const removeTemplate = (id) => update((d) => { d.recurringTemplates = d.recurringTemplates.filter((x) => x.id !== id); });

  const typeLabel = { receita: "Receita", despesa_fixa: "Despesa fixa", despesa_variavel: "Despesa variável" };
  const typeTone = { receita: "emerald", despesa_fixa: "red", despesa_variavel: "amber" };

  const monthOptions = lastNMonthKeys(12).reverse();
  const filtered = [...data.transactions]
    .filter((t) => filterType === "todos" || t.type === filterType)
    .filter((t) => filterMonth === "todos" || monthKey(t.date) === filterMonth)
    .filter((t) => !filterText || t.description.toLowerCase().includes(filterText.toLowerCase()))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div>
      <SectionTitle right={<Btn variant="primary" small onClick={openNew}><Icon name="plus" size={13} />Novo lançamento</Btn>}>Controle financeiro</SectionTitle>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 18 }}>
        <StatCard label="Receitas (mês)" value={fmtBRL(c.receitasMes)} accent="emerald" />
        <StatCard label="Gastos (mês)" value={fmtBRL(c.despesasMes)} accent="red" />
        <StatCard label="Economia do mês" value={fmtBRL(c.economiaMes)} accent={c.economiaMes >= 0 ? "emerald" : "red"} />
        <StatCard label="Taxa de poupança" value={fmtPct(c.taxaPoupanca)} accent={c.taxaPoupanca >= 0 ? "emerald" : "red"} />
      </div>

      <SectionTitle>Contas</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginBottom: 18 }}>
        {data.accounts.map((a) => (
          <div key={a.id} style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{a.name}</span>
              <button onClick={() => removeAccount(a.id)} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer" }}><Icon name="trash" size={13} /></button>
            </div>
            <TextInput type="number" defaultValue={a.balance} onBlur={(e) => updateAccountBalance(a.id, e.target.value)} />
          </div>
        ))}
        <div style={{ background: T.surface1, border: `1px dashed ${T.border}`, borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          <TextInput placeholder="Nome da nova conta" value={accountForm.name} onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })} />
          <TextInput type="number" placeholder="Saldo inicial" value={accountForm.balance} onChange={(e) => setAccountForm({ ...accountForm, balance: e.target.value })} />
          <Btn small variant="primary" onClick={addAccount}><Icon name="plus" size={12} />Adicionar conta</Btn>
        </div>
      </div>

      <div style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: 16, padding: 16, marginBottom: 18, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: T.textSecondary }}>Reserva de emergência</span>
        <TextInput type="number" defaultValue={data.emergencyFund.current} onBlur={(e) => update((d) => { d.emergencyFund.current = Number(e.target.value); })} style={{ width: 130 }} />
        <span style={{ fontSize: 12, color: T.textMuted }}>meta</span>
        <TextInput type="number" defaultValue={data.emergencyFund.target} onBlur={(e) => update((d) => { d.emergencyFund.target = Number(e.target.value); })} style={{ width: 130 }} />
      </div>

      <SectionTitle>Dívidas</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
        {data.debts.length === 0 && <EmptyState text="Nenhuma dívida cadastrada." />}
        {data.debts.map((deb) => (
          <div key={deb.id} style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>{deb.name}</span>
                <Badge tone="red">{deb.type}</Badge>
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: 12, color: T.textSecondary, fontFamily: "'Manrope', 'Inter', sans-serif" }}>
                <span>Restante: <b style={{ color: T.textPrimary }}>{fmtBRL(deb.remainingAmount)}</b></span>
                <span>Parcela/mês: <b style={{ color: T.textPrimary }}>{fmtBRL(deb.monthlyPayment)}</b></span>
                {deb.dueDay > 0 && <span>Vencimento: <b style={{ color: T.textPrimary }}>dia {deb.dueDay}</b></span>}
              </div>
            </div>
            <button onClick={() => removeDebt(deb.id)} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer" }}><Icon name="trash" size={13} /></button>
          </div>
        ))}
        <div style={{ background: T.surface1, border: `1px dashed ${T.border}`, borderRadius: 14, padding: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: 10, alignItems: "end" }}>
          <Field label="Nome"><TextInput value={debtForm.name} onChange={(e) => setDebtForm({ ...debtForm, name: e.target.value })} placeholder="Ex: Cartão Nubank" /></Field>
          <Field label="Tipo">
            <Select value={debtForm.type} onChange={(e) => setDebtForm({ ...debtForm, type: e.target.value })}>
              {DEBT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Valor total (R$)"><TextInput type="number" value={debtForm.totalAmount} onChange={(e) => setDebtForm({ ...debtForm, totalAmount: e.target.value })} /></Field>
          <Field label="Restante (R$)"><TextInput type="number" value={debtForm.remainingAmount} onChange={(e) => setDebtForm({ ...debtForm, remainingAmount: e.target.value })} /></Field>
          <Field label="Parcela/mês (R$)"><TextInput type="number" value={debtForm.monthlyPayment} onChange={(e) => setDebtForm({ ...debtForm, monthlyPayment: e.target.value })} /></Field>
          <Field label="Dia de vencimento"><TextInput type="number" min="1" max="31" value={debtForm.dueDay} onChange={(e) => setDebtForm({ ...debtForm, dueDay: e.target.value })} /></Field>
          <Btn small variant="primary" onClick={addDebt}><Icon name="plus" size={12} />Adicionar dívida</Btn>
        </div>
      </div>

      <SectionTitle>Lançamentos recorrentes</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
        {data.recurringTemplates.length === 0 && <EmptyState text="Nenhum lançamento recorrente configurado." />}
        {data.recurringTemplates.map((tpl) => (
          <div key={tpl.id} style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12.5 }}>
              <span style={{ fontWeight: 600 }}>{tpl.description}</span>
              <Badge tone={typeTone[tpl.type]}>{typeLabel[tpl.type]}</Badge>
              {tpl.category && <Badge tone="neutral">{tpl.category}</Badge>}
              <span style={{ color: T.textSecondary }}>{fmtBRL(tpl.amount)} · todo dia {tpl.dayOfMonth}</span>
            </div>
            <button onClick={() => removeTemplate(tpl.id)} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer" }}><Icon name="trash" size={13} /></button>
          </div>
        ))}
        <div style={{ background: T.surface1, border: `1px dashed ${T.border}`, borderRadius: 14, padding: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: 10, alignItems: "end" }}>
          <Field label="Descrição"><TextInput value={templateForm.description} onChange={(e) => setTemplateForm({ ...templateForm, description: e.target.value })} placeholder="Ex: Salário, aluguel..." /></Field>
          <Field label="Tipo">
            <Select value={templateForm.type} onChange={(e) => setTemplateForm({ ...templateForm, type: e.target.value })}>
              <option value="receita">Receita</option>
              <option value="despesa_fixa">Despesa fixa</option>
              <option value="despesa_variavel">Despesa variável</option>
            </Select>
          </Field>
          {templateForm.type !== "receita" && (
            <Field label="Categoria">
              <Select value={templateForm.category} onChange={(e) => setTemplateForm({ ...templateForm, category: e.target.value })}>
                {EXPENSE_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Valor (R$)"><TextInput type="number" value={templateForm.amount} onChange={(e) => setTemplateForm({ ...templateForm, amount: e.target.value })} /></Field>
          <Field label="Dia do mês"><TextInput type="number" min="1" max="31" value={templateForm.dayOfMonth} onChange={(e) => setTemplateForm({ ...templateForm, dayOfMonth: e.target.value })} /></Field>
          <Btn small variant="primary" onClick={addTemplate}><Icon name="plus" size={12} />Adicionar recorrência</Btn>
        </div>
      </div>

      <SectionTitle>Lançamentos</SectionTitle>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <TextInput placeholder="Buscar por descrição..." value={filterText} onChange={(e) => setFilterText(e.target.value)} style={{ maxWidth: 220 }} />
        <Select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ maxWidth: 180 }}>
          <option value="todos">Todos os tipos</option>
          <option value="receita">Receita</option>
          <option value="despesa_fixa">Despesa fixa</option>
          <option value="despesa_variavel">Despesa variável</option>
        </Select>
        <Select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} style={{ maxWidth: 150 }}>
          <option value="todos">Todos os meses</option>
          {monthOptions.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </Select>
      </div>

      <div style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: 16, overflow: "hidden" }}>
        <div className="fd-tx-scroll">
          <div style={{ minWidth: 700 }}>
            <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 120px 130px 120px 96px", padding: "10px 16px", fontSize: 11, color: T.textMuted, textTransform: "uppercase", borderBottom: `1px solid ${T.border}` }}>
              <span>Data</span><span>Descrição</span><span>Categoria</span><span>Tipo</span><span style={{ textAlign: "right" }}>Valor</span><span></span>
            </div>
            {filtered.length === 0 && <div style={{ padding: 20 }}><EmptyState text="Nenhum lançamento encontrado." /></div>}
            {filtered.slice(0, 60).map((t) => (
              <div key={t.id} className="row-hover" style={{ display: "grid", gridTemplateColumns: "90px 1fr 120px 130px 120px 96px", padding: "10px 16px", fontSize: 12.5, borderBottom: `1px solid ${T.border}`, alignItems: "center" }}>
                <span style={{ color: T.textMuted, fontFamily: "'Manrope', 'Inter', sans-serif" }}>{fmtDateShort(t.date)}</span>
                <span>{t.description}</span>
                <span>{t.category && <Badge tone="neutral">{t.category}</Badge>}</span>
                <span><Badge tone={typeTone[t.type]}>{typeLabel[t.type]}</Badge></span>
                <span style={{ textAlign: "right", fontFamily: "'Manrope', 'Inter', sans-serif", color: t.type === "receita" ? T.emerald : T.red }}>
                  {t.type === "receita" ? "+" : "-"}{fmtBRL(t.amount)}
                </span>
                <span style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                  <button onClick={() => openEdit(t)} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", fontSize: 11, padding: 0, whiteSpace: "nowrap" }}>editar</button>
                  <button onClick={() => remove(t.id)} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", padding: 0, display: "flex" }}><Icon name="trash" size={13} /></button>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {modal && (modal.type === "tx-new" || modal.type === "tx-edit") && (
        <Modal title={modal.type === "tx-new" ? "Novo lançamento" : "Editar lançamento"} onClose={() => setModal(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label="Tipo">
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="receita">Receita</option>
                <option value="despesa_fixa">Despesa fixa</option>
                <option value="despesa_variavel">Despesa variável</option>
              </Select>
            </Field>
            {form.type !== "receita" && (
              <Field label="Categoria">
                <Select value={form.category || "Outros"} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {EXPENSE_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Descrição"><TextInput value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Ex: Salário, aluguel, mercado..." /></Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Valor (R$)"><TextInput type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
              <Field label="Data"><TextInput type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            </div>
            <Btn variant="primary" onClick={save} style={{ justifyContent: "center", marginTop: 6 }}>{modal.type === "tx-new" ? "Salvar lançamento" : "Salvar alterações"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ============================================================
   PROJEÇÕES
   ============================================================ */
function Projecoes({ data, c }) {
  const [monthlyContribution, setMonthlyContribution] = useState(500);
  const [annualRate, setAnnualRate] = useState(10);
  const [selectedGoal, setSelectedGoal] = useState(c.goalsComputed[0]?.id || "");

  const i = Math.pow(1 + annualRate / 100, 1 / 12) - 1;
  const pv = c.totalCurrentValue;
  const years = [1, 3, 5, 10, 20, 30];

  const projection = years.map((y) => {
    const n = y * 12;
    const fvContrib = i > 0 ? monthlyContribution * ((Math.pow(1 + i, n) - 1) / i) : monthlyContribution * n;
    const fvPv = pv * Math.pow(1 + i, n);
    const total = fvContrib + fvPv;
    const aportado = pv + monthlyContribution * n;
    return { year: y, total, aportado, rendimento: total - aportado, passivaMensal: (total * (annualRate / 100)) / 12 };
  });

  const chartData = projection.map((p) => ({ label: `${p.year}a`, Patrimônio: Math.round(p.total), Aportado: Math.round(p.aportado) }));

  const goal = c.goalsComputed.find((g) => g.id === selectedGoal);
  let requiredMonthly = null;
  if (goal) {
    const n = Math.max(1, goal.monthsLeft);
    const target = goal.remaining;
    requiredMonthly = i > 0 ? (target * i) / (Math.pow(1 + i, n) - 1) : target / n;
  }

  return (
    <div>
      <SectionTitle>Simulador de projeções</SectionTitle>
      <div style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: 16, padding: 18, display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 18 }}>
        <Field label="Aporte mensal (R$)"><TextInput type="number" value={monthlyContribution} onChange={(e) => setMonthlyContribution(Number(e.target.value))} style={{ width: 150 }} /></Field>
        <Field label="Rentabilidade anual esperada (%)"><TextInput type="number" value={annualRate} onChange={(e) => setAnnualRate(Number(e.target.value))} style={{ width: 150 }} /></Field>
        <Field label="Patrimônio investido atual"><span style={{ ...inputStyle, display: "flex", alignItems: "center", width: 150, color: T.textMuted }}>{fmtBRL(pv)}</span></Field>
      </div>

      <ChartFrame title="Projeção patrimonial (aportado vs. total)" height={280}>
        <AreaChart data={chartData}>
          {chartCommon.grid}
          <XAxis dataKey="label" {...chartCommon.axisProps} />
          <YAxis {...chartCommon.axisProps} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} width={45} />
          <Tooltip contentStyle={chartCommon.tooltipStyle} formatter={(v) => fmtBRL(v)} />
          <Legend wrapperStyle={{ fontSize: 11, color: T.textSecondary }} />
          <Area type="monotone" dataKey="Aportado" stroke={T.blue} fill={T.blue} fillOpacity={0.12} strokeWidth={2} />
          <Area type="monotone" dataKey="Patrimônio" stroke={T.amber} fill={T.amber} fillOpacity={0.18} strokeWidth={2} />
        </AreaChart>
      </ChartFrame>

      <div style={{ overflowX: "auto", marginTop: 14 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: T.textMuted, textTransform: "uppercase", fontSize: 11 }}>
              {["Prazo", "Total projetado", "Total aportado", "Rendimento", "Renda passiva/mês"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "8px 10px", borderBottom: `1px solid ${T.border}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {projection.map((p) => (
              <tr key={p.year} className="row-hover">
                <td style={{ padding: "10px", borderBottom: `1px solid ${T.border}`, fontFamily: "'Manrope', 'Inter', sans-serif" }}>{p.year} {p.year === 1 ? "ano" : "anos"}</td>
                <td style={{ padding: "10px", borderBottom: `1px solid ${T.border}`, fontFamily: "'Manrope', 'Inter', sans-serif", color: T.amber }}>{fmtBRL(p.total)}</td>
                <td style={{ padding: "10px", borderBottom: `1px solid ${T.border}`, fontFamily: "'Manrope', 'Inter', sans-serif" }}>{fmtBRL(p.aportado)}</td>
                <td style={{ padding: "10px", borderBottom: `1px solid ${T.border}`, fontFamily: "'Manrope', 'Inter', sans-serif", color: T.emerald }}>{fmtBRL(p.rendimento)}</td>
                <td style={{ padding: "10px", borderBottom: `1px solid ${T.border}`, fontFamily: "'Manrope', 'Inter', sans-serif" }}>{fmtBRL(p.passivaMensal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SectionTitle>Quanto investir por mês para atingir uma meta</SectionTitle>
      <div style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: 16, padding: 18 }}>
        {c.goalsComputed.length === 0 ? <EmptyState text="Cadastre uma meta na aba Metas para simular." /> : (
          <>
            <Field label="Selecione a meta">
              <Select value={selectedGoal} onChange={(e) => setSelectedGoal(e.target.value)} style={{ maxWidth: 320 }}>
                {c.goalsComputed.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </Select>
            </Field>
            {goal && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, marginTop: 16 }}>
                <StatCard label="Falta guardar" value={fmtBRL(goal.remaining)} accent="blue" />
                <StatCard label="Meses restantes" value={`${goal.monthsLeft}`} accent="blue" />
                <StatCard label={`Aporte necessário/mês (${annualRate}% a.a.)`} value={fmtBRL(requiredMonthly)} accent="amber" />
                <StatCard label="Sem rendimento (linear)" value={fmtBRL(goal.suggestedMonthly)} accent="neutral" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   INDICADORES
   ============================================================ */
function Indicadores({ data, c }) {
  const aportesEvo = useMemo(() => {
    const months = lastNMonthKeys(8);
    return months.map((m) => ({
      label: monthLabel(m),
      Aportes: c.allContributions.filter((ct) => monthKey(ct.date) === m).reduce((s, ct) => s + Number(ct.amount || 0), 0),
    }));
  }, [c]);

  const rendaPassivaEvo = useMemo(() => {
    const months = lastNMonthKeys(8);
    return months.map((m) => ({
      label: monthLabel(m),
      Dividendos: c.allDividends.filter((dv) => monthKey(dv.date) === m).reduce((s, dv) => s + Number(dv.amount || 0), 0),
    }));
  }, [c]);

  return (
    <div>
      <SectionTitle>Indicadores financeiros</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
        <StatCard label="Patrimônio líquido" value={fmtBRL(c.patrimonioLiquido)} accent="amber" sub="Patrimônio - dívidas" />
        <StatCard label="Total aportado" value={fmtBRL(c.totalInvested)} accent="blue" />
        <StatCard label="Total rendido" value={fmtBRL(c.totalRendimentos)} accent={c.totalRendimentos >= 0 ? "emerald" : "red"} />
        <StatCard label="Rentabilidade acumulada" value={fmtPct(c.rentabilidade)} accent={c.rentabilidade >= 0 ? "emerald" : "red"} />
        <StatCard label="Melhor investimento" value={c.bestInvestment ? c.bestInvestment.broker : "-"} sub={c.bestInvestment ? `${fmtPct(c.bestInvestment.rentab)} de rentabilidade` : ""} accent="emerald" />
        <StatCard label="Maior aporte" value={c.biggestContribution ? fmtBRL(c.biggestContribution.amount) : fmtBRL(0)} sub={c.biggestContribution ? fmtDateShort(c.biggestContribution.date) : ""} accent="blue" />
        <StatCard label="Total de dividendos" value={fmtBRL(c.totalDividends)} accent="emerald" />
        <StatCard label="Média de aportes/mês" value={fmtBRL(c.mediaAportesMensais)} accent="blue" />
        <StatCard label="IR estimado (não realizado)" value={fmtBRL(c.totalIREstimado)} accent="red" sub="Sobre lucro em aberto, se vendido hoje" />
      </div>

      <div className="fd-grid-2" style={{ gap: 12 }}>
        <ChartFrame title="Evolução dos aportes" height={230}>
          <BarChart data={aportesEvo}>
            {chartCommon.grid}
            <XAxis dataKey="label" {...chartCommon.axisProps} />
            <YAxis {...chartCommon.axisProps} tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`} width={40} />
            <Tooltip contentStyle={chartCommon.tooltipStyle} formatter={(v) => fmtBRL(v)} />
            <Bar dataKey="Aportes" fill={T.blue} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ChartFrame>
        <ChartFrame title="Crescimento da renda passiva" height={230}>
          <LineChart data={rendaPassivaEvo}>
            {chartCommon.grid}
            <XAxis dataKey="label" {...chartCommon.axisProps} />
            <YAxis {...chartCommon.axisProps} tickFormatter={(v) => `${v}`} width={40} />
            <Tooltip contentStyle={chartCommon.tooltipStyle} formatter={(v) => fmtBRL(v)} />
            <Line type="monotone" dataKey="Dividendos" stroke={T.emerald} strokeWidth={2} dot={{ r: 3, fill: T.emerald }} />
          </LineChart>
        </ChartFrame>
      </div>

      <SectionTitle>Investimentos por rentabilidade</SectionTitle>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: T.textMuted, textTransform: "uppercase", fontSize: 11 }}>
              {["Corretora", "Tipo", "Investido", "Valor atual", "Lucro", "Rentabilidade", "IR estimado"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "8px 10px", borderBottom: `1px solid ${T.border}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...c.investments].sort((a, b) => b.rentab - a.rentab).map((inv) => (
              <tr key={inv.id} className="row-hover">
                <td style={{ padding: "10px", borderBottom: `1px solid ${T.border}` }}>{inv.broker}</td>
                <td style={{ padding: "10px", borderBottom: `1px solid ${T.border}` }}><Badge tone="blue">{inv.type}</Badge></td>
                <td style={{ padding: "10px", borderBottom: `1px solid ${T.border}`, fontFamily: "'Manrope', 'Inter', sans-serif" }}>{fmtBRL(inv.invested)}</td>
                <td style={{ padding: "10px", borderBottom: `1px solid ${T.border}`, fontFamily: "'Manrope', 'Inter', sans-serif" }}>{fmtBRL(inv.currentValue)}</td>
                <td style={{ padding: "10px", borderBottom: `1px solid ${T.border}`, fontFamily: "'Manrope', 'Inter', sans-serif", color: inv.profit >= 0 ? T.emerald : T.red }}>{fmtBRL(inv.profit)}</td>
                <td style={{ padding: "10px", borderBottom: `1px solid ${T.border}`, fontFamily: "'Manrope', 'Inter', sans-serif", color: inv.rentab >= 0 ? T.emerald : T.red }}>{fmtPct(inv.rentab)}</td>
                <td style={{ padding: "10px", borderBottom: `1px solid ${T.border}`, fontFamily: "'Manrope', 'Inter', sans-serif" }}>{inv.irRate === 0 ? "isento" : `${fmtBRL(inv.irEstimado)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
