import React, { useState, useEffect, useMemo, useRef } from "react";
import confetti from "canvas-confetti";
import { Stamp, Plus, Trash2, CalendarDays, Clock, X, Check, LogIn, LogOut } from "lucide-react";
import { watchAuth, signIn, logOut, loadRemoteData, saveRemoteData } from "./firebase";

// ---- design tokens ----
const INK = "#1C2B33";
const INK_SOFT = "#5B6B72";
const PAPER = "#EEEAE0";
const PAPER_CARD = "#F7F4EC";
const JADE = "#2F6F4E";
const JADE_SOFT = "#DCE7DE";
const BRICK = "#B5533C";
const BRICK_SOFT = "#F1DED8";
const AMBER = "#B8823D";
const LINE = "#CFC8B4";

const FONT_DISPLAY = "'Shippori Mincho', serif";
const FONT_BODY = "'Zen Kaku Gothic New', 'Noto Sans JP', sans-serif";
const FONT_MONO = "'JetBrains Mono', monospace";

// ---- date helpers ----
function toISO(d) {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addMonths(dateStr, n) {
  const d = new Date(dateStr);
  return new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
}
function fmtJP(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
function yearsMonthsBetween(startStr, endStr) {
  const start = new Date(startStr);
  const end = new Date(endStr);
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) months -= 1;
  if (months < 0) months = 0;
  return { years: Math.floor(months / 12), months: months % 12 };
}

// 会社の付与ルール：入社日にかかわらず、毎年9/16の基準日にまとめて付与される。
// 日数は 10→11→12→14→16→18→20（以降20日で継続）の順で進む。
const BASE_MONTH_INDEX = 8; // 9月（0始まり）
const BASE_DAY = 16;
const GRANT_DAYS_SEQUENCE = [10, 11, 12, 14, 16, 18, 20];

function firstBaseDateOnOrAfter(dateISO) {
  const d = new Date(dateISO);
  let candidate = new Date(d.getFullYear(), BASE_MONTH_INDEX, BASE_DAY);
  if (toISO(candidate) < dateISO) {
    candidate = new Date(d.getFullYear() + 1, BASE_MONTH_INDEX, BASE_DAY);
  }
  return candidate;
}

function computeLegalGrants(hireDate, today) {
  const grants = [];
  let date = firstBaseDateOnOrAfter(hireDate);
  let idx = 0;
  let guard = 0;
  while (guard < 60) {
    const days = idx < GRANT_DAYS_SEQUENCE.length ? GRANT_DAYS_SEQUENCE[idx] : 20;
    grants.push({ id: `grant-${idx}`, date: toISO(date), days, kind: "grant", note: "自動付与（基準日9/16）", auto: true });
    if (toISO(date) > toISO(today)) { guard = 999; break; }
    idx += 1;
    date = new Date(date.getFullYear() + 1, BASE_MONTH_INDEX, BASE_DAY);
    guard += 1;
  }
  return grants;
}

const LOCAL_KEY = "yukyu-techo-data-v1";
const DEFAULT_HIRE_DATE = "2022-04-01"; // 毎回入力しなくて済むよう、入社日を固定しておく

const ALLOWED_EMAILS = (import.meta.env.VITE_ALLOWED_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function isAllowedEmail(email) {
  if (ALLOWED_EMAILS.length === 0) return true; // 未設定の場合は制限しない（設定忘れ防止）
  return !!email && ALLOWED_EMAILS.includes(email.toLowerCase());
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    // 壊れたデータは無視する
  }
  return null;
}

function saveLocal(data) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    return false;
  }
}

// 端末が対応していれば軽く振動させる（iOS Safariは非対応なので何も起きないだけ）
function vibrate(pattern) {
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(pattern);
  } catch (e) {
    // 対応していない環境では何もしない
  }
}

function fireConfettiAt(el) {
  let origin = { x: 0.5, y: 0.35 };
  if (el) {
    const rect = el.getBoundingClientRect();
    origin = {
      x: (rect.left + rect.width / 2) / window.innerWidth,
      y: (rect.top + rect.height / 2) / window.innerHeight,
    };
  }
  confetti({
    particleCount: 90,
    spread: 75,
    startVelocity: 32,
    origin,
    colors: ["#2F6F4E", "#B8823D", "#B5533C", "#EEEAE0"],
    zIndex: 9999,
  });
}

function authErrorMessage(e) {
  const code = e && e.code;
  if (code === "auth/unauthorized-domain") {
    return "このサイトのドメインがFirebaseで許可されていません。Firebaseコンソール → Authentication → Settings → 承認済みドメイン、に今のサイトのドメインを追加してください。";
  }
  if (code === "auth/popup-blocked") {
    return "ログイン用のポップアップがブロックされました。ブラウザのポップアップ許可設定を確認してください。";
  }
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
    return "";
  }
  return `ログインに失敗しました（${code || "unknown error"}）。しばらくしてからもう一度お試しください。`;
}

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [hireDate, setHireDate] = useState(null);
  const [adjustments, setAdjustments] = useState([]);
  const [usages, setUsages] = useState([]);
  const [setupInput, setSetupInput] = useState(DEFAULT_HIRE_DATE);
  const [showAddUsage, setShowAddUsage] = useState(false);
  const [showAddAdjust, setShowAddAdjust] = useState(false);
  const [usageForm, setUsageForm] = useState({ date: toISO(new Date()), days: "1", note: "" });
  const [adjustForm, setAdjustForm] = useState({ date: toISO(new Date()), days: "", note: "" });
  const [error, setError] = useState("");
  const [usageView, setUsageView] = useState("list");
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [unauthorized, setUnauthorized] = useState(false);
  const [syncState, setSyncState] = useState("idle"); // idle | syncing | synced | error

  const today = new Date();
  const skipNextSync = useRef(false);
  const riskCardRef = useRef(null);
  const prevRiskyRef = useRef(null);
  const isFirstRiskCheck = useRef(true);

  // 起動時：まずローカルの内容を即座に表示する（オフラインでも動く）
  useEffect(() => {
    const local = loadLocal();
    if (local) {
      setHireDate(local.hireDate || DEFAULT_HIRE_DATE);
      setAdjustments(local.adjustments || []);
      setUsages(local.usages || []);
    } else {
      setHireDate(DEFAULT_HIRE_DATE);
      setAdjustments([]);
      setUsages([]);
      saveLocal({ hireDate: DEFAULT_HIRE_DATE, adjustments: [], usages: [] });
    }
    setLoaded(true);
  }, []);

  // ログイン状態の監視。ログインしたらクラウド上のデータを取りに行き、
  // クラウド側にまだ何もなければ、今ローカルにある内容を初回アップロードする。
  useEffect(() => {
    const unsub = watchAuth(async (u) => {
      setUser(u);
      setAuthLoading(false);
      if (!u) {
        return;
      }
      if (!isAllowedEmail(u.email)) {
        // 許可されていないアカウントは、データに一切触れさせずすぐにログアウトする
        setUnauthorized(true);
        setSyncState("idle");
        await logOut();
        return;
      }
      setUnauthorized(false);
      setAuthError("");
      try {
        setSyncState("syncing");
        const remote = await loadRemoteData(u.uid);
        if (remote) {
          skipNextSync.current = true;
          setHireDate(remote.hireDate || DEFAULT_HIRE_DATE);
          setAdjustments(remote.adjustments || []);
          setUsages(remote.usages || []);
          saveLocal(remote);
        } else {
          const local = loadLocal() || { hireDate: DEFAULT_HIRE_DATE, adjustments: [], usages: [] };
          await saveRemoteData(u.uid, local);
        }
        setSyncState("synced");
      } catch (e) {
        setSyncState("error");
      }
    });
    return () => unsub();
  }, []);

  async function handleSignIn() {
    setAuthError("");
    setUnauthorized(false);
    try {
      await signIn();
    } catch (e) {
      setAuthError(authErrorMessage(e));
    }
  }

  async function saveAll(newHireDate, newAdjustments, newUsages) {
    const data = { hireDate: newHireDate, adjustments: newAdjustments, usages: newUsages };
    setHireDate(newHireDate);
    setAdjustments(newAdjustments);
    setUsages(newUsages);

    const okLocal = saveLocal(data);
    if (!okLocal) setError("この端末への保存に失敗しました（ブラウザの空き容量をご確認ください）。");
    else setError("");

    if (user) {
      setSyncState("syncing");
      try {
        await saveRemoteData(user.uid, data);
        setSyncState("synced");
      } catch (e) {
        setSyncState("error");
      }
    }
  }

  const legalGrants = useMemo(() => {
    if (!hireDate) return [];
    return computeLegalGrants(hireDate, today);
  }, [hireDate]);

  const pastLegalGrants = legalGrants.filter((g) => g.date <= toISO(today));
  const nextGrant = legalGrants.find((g) => g.date > toISO(today));

  const tenure = hireDate ? yearsMonthsBetween(hireDate, toISO(today)) : null;

  const balanceInfo = useMemo(() => {
    const todayISO = toISO(today);
    const buckets = [
      ...pastLegalGrants.map((g) => ({ id: g.id, date: g.date, days: g.days, note: g.note, auto: true })),
      ...adjustments.filter((a) => a.days > 0).map((a) => ({ id: a.id, date: a.date, days: a.days, note: a.note, auto: false })),
    ]
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((b) => ({ ...b, remaining: b.days, expiry: toISO(addMonths(b.date, 24)), expired: false }));

    const consumptions = [
      ...usages.map((u) => ({ date: u.date, days: Number(u.days) })),
      ...adjustments.filter((a) => a.days < 0).map((a) => ({ date: a.date, days: Math.abs(a.days) })),
    ].sort((a, b) => (a.date < b.date ? -1 : 1));

    function expireAsOf(dateISO) {
      buckets.forEach((b) => {
        if (!b.expired && b.expiry <= dateISO) b.expired = true;
      });
    }

    consumptions.forEach((c) => {
      expireAsOf(c.date);
      let amt = c.days;
      for (const b of buckets) {
        if (amt <= 0) break;
        if (b.expired || b.remaining <= 0) continue;
        const take = Math.min(amt, b.remaining);
        b.remaining = Math.round((b.remaining - take) * 10) / 10;
        amt = Math.round((amt - take) * 10) / 10;
      }
    });
    expireAsOf(todayISO);

    let balance = 0;
    let expiredTotal = 0;
    const expiringSoon = [];
    buckets.forEach((b) => {
      if (b.remaining <= 0) return;
      if (b.expired) {
        expiredTotal += b.remaining;
      } else {
        balance += b.remaining;
        const daysUntilExpiry = Math.round((new Date(b.expiry) - today) / (1000 * 60 * 60 * 24));
        if (daysUntilExpiry <= 90) expiringSoon.push({ date: b.expiry, days: b.remaining });
      }
    });

    const activeBuckets = buckets.filter((b) => !b.expired && b.remaining > 0).sort((a, b) => (a.expiry < b.expiry ? -1 : 1));
    const nearestExpiry = activeBuckets.length > 0 ? activeBuckets[0] : null;

    return {
      buckets,
      balance: Math.round(balance * 10) / 10,
      expiredTotal: Math.round(expiredTotal * 10) / 10,
      expiringSoon: expiringSoon.sort((a, b) => (a.date < b.date ? -1 : 1)),
      nearestExpiry,
    };
  }, [pastLegalGrants, adjustments, usages, hireDate]);

  // 失効間近（90日以内）の付与分が実際に消化されたタイミングを検知する。
  // 前回の描画時と比べて「同じ付与分の残日数が減っていれば」消化とみなし、振動。
  // 0まで減っていれば、そのタイミングで紙吹雪を出す。
  useEffect(() => {
    const nearest = balanceInfo.nearestExpiry;
    const daysLeftNow = nearest ? Math.max(0, Math.round((new Date(nearest.expiry) - today) / (1000 * 60 * 60 * 24))) : null;
    const atRiskNow = !!(nearest && daysLeftNow <= EXPIRY_RISK_WINDOW_DAYS);
    const currentSnapshot = atRiskNow ? { id: nearest.id, remaining: nearest.remaining } : null;

    if (isFirstRiskCheck.current) {
      isFirstRiskCheck.current = false;
      prevRiskyRef.current = currentSnapshot;
      return;
    }

    const prev = prevRiskyRef.current;
    if (prev && currentSnapshot && prev.id === currentSnapshot.id && currentSnapshot.remaining < prev.remaining) {
      vibrate(40);
      if (currentSnapshot.remaining <= 0) {
        vibrate([30, 30, 30, 30, 60]);
        fireConfettiAt(riskCardRef.current);
      }
    } else if (prev && !currentSnapshot && prev.remaining > 0) {
      // 追跡していた付与分が消化しきってリスクが無くなったケース（バケットの入れ替わりを含む）
      vibrate([30, 30, 30, 30, 60]);
      fireConfettiAt(riskCardRef.current);
    }
    prevRiskyRef.current = currentSnapshot;
  }, [balanceInfo]);

  const totalUsed =
    usages.reduce((s, u) => s + Number(u.days), 0) +
    adjustments.filter((a) => a.days < 0).reduce((s, a) => s + Math.abs(a.days), 0);
  const remaining = balanceInfo.balance;

  const ledger = useMemo(() => {
    const grantItems = balanceInfo.buckets.map((b) => ({
      id: b.id, date: b.date, days: b.days, note: b.note, auto: b.auto,
      type: "grant", remaining: b.remaining, expiry: b.expiry, expired: b.expired,
    }));
    const usageItems = usages.map((u) => ({ id: u.id, date: u.date, days: -Math.abs(Number(u.days)), note: u.note, auto: false, type: "usage" }));
    const negAdjustItems = adjustments
      .filter((a) => a.days < 0)
      .map((a) => ({ id: a.id, date: a.date, days: a.days, note: a.note, auto: false, type: "usage" }));
    return [...grantItems, ...usageItems, ...negAdjustItems].sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [balanceInfo, usages, adjustments]);

  function handleSetup() {
    if (!setupInput) {
      setError("入社日を入力してください。");
      return;
    }
    setError("");
    saveAll(setupInput, [], []);
  }

  function handleAddUsage() {
    const days = Number(usageForm.days);
    if (!usageForm.date || !days || days <= 0) {
      setError("日付と日数を正しく入力してください。");
      return;
    }
    setError("");
    vibrate(15);
    const entry = { id: `u-${Date.now()}`, date: usageForm.date, days, note: usageForm.note };
    saveAll(hireDate, adjustments, [...usages, entry]);
    setUsageForm({ date: toISO(new Date()), days: "1", note: "" });
    setShowAddUsage(false);
  }

  function handleAddAdjust() {
    const days = Number(adjustForm.days);
    if (!adjustForm.date || !days) {
      setError("日付と日数を正しく入力してください（マイナスも可）。");
      return;
    }
    setError("");
    vibrate(15);
    const entry = { id: `a-${Date.now()}`, date: adjustForm.date, days, note: adjustForm.note || "手動調整" };
    saveAll(hireDate, [...adjustments, entry], usages);
    setAdjustForm({ date: toISO(new Date()), days: "", note: "" });
    setShowAddAdjust(false);
  }

  function deleteEntry(item) {
    if (item.type === "usage") {
      if (item.id.startsWith("u-")) saveAll(hireDate, adjustments, usages.filter((u) => u.id !== item.id));
      else if (item.id.startsWith("a-")) saveAll(hireDate, adjustments.filter((a) => a.id !== item.id), usages);
    } else if (item.type === "grant" && !item.auto) {
      saveAll(hireDate, adjustments.filter((a) => a.id !== item.id), usages);
    }
  }

  function resetAll() {
    if (window.confirm("入社日・記録をすべて削除して最初からやり直しますか？")) {
      saveAll(null, [], []);
      setSetupInput("");
    }
  }

  if (!loaded || authLoading) {
    return (
      <div style={{ minHeight: "100vh", background: PAPER, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_BODY, color: INK_SOFT }}>
        読み込み中…
      </div>
    );
  }

  if (unauthorized) {
    return <NotAuthorizedPage onRetry={handleSignIn} />;
  }

  if (!user) {
    return <LoginGate onSignIn={handleSignIn} error={authError} />;
  }

  return (
    <div style={{ minHeight: "100vh", background: PAPER, fontFamily: FONT_BODY, color: INK, paddingBottom: 48 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@500;700&family=Zen+Kaku+Gothic+New:wght@400;500;700&family=JetBrains+Mono:wght@500;700&display=swap');
        * { box-sizing: border-box; }
        input:focus, button:focus, select:focus { outline: 2px solid ${JADE}; outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
      `}</style>

      <header style={{ borderBottom: `1px solid ${LINE}`, padding: "20px 20px 18px" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", border: `2px solid ${JADE}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Stamp size={22} color={JADE} />
            </div>
            <div>
              <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, margin: 0, letterSpacing: "0.02em" }}>有給手帳</h1>
              <p style={{ margin: "2px 0 0", fontSize: 11.5, color: INK_SOFT }}>勤続年数と有給休暇を記録する</p>
            </div>
          </div>
          <AuthButton user={user} authLoading={authLoading} syncState={syncState} />
        </div>
      </header>

      <main style={{ maxWidth: 640, margin: "0 auto", padding: "24px 20px" }}>
        {!hireDate ? (
          <SetupCard value={setupInput} onChange={setSetupInput} onSubmit={handleSetup} error={error} />
        ) : (
          <>
            <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
              <StatCard label="勤続年数" value={`${tenure.years}年${tenure.months}ヶ月`} sub={`入社日 ${fmtJP(hireDate)}`} />
              <StatCard
                label="有給残日数"
                value={`${remaining}日`}
                sub={
                  balanceInfo.expiringSoon.length > 0
                    ? `うち ${balanceInfo.expiringSoon.reduce((s, e) => s + e.days, 0)}日 が90日以内に失効`
                    : `取得 ${totalUsed}日`
                }
                accent={remaining <= 0 ? BRICK : balanceInfo.expiringSoon.length > 0 ? BRICK : JADE}
              />
            </section>

            <ExpiryRiskCard nearestExpiry={balanceInfo.nearestExpiry} today={today} anchorRef={riskCardRef} />

            {nextGrant && (
              <section style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, padding: "10px 14px", background: JADE_SOFT, borderRadius: 4 }}>
                <CalendarDays size={16} color={JADE} />
                <span style={{ fontSize: 12.5 }}>
                  次回の付与予定：<strong>{fmtJP(nextGrant.date)}</strong>（{nextGrant.days}日）
                </span>
              </section>
            )}

            <section style={{ display: "flex", gap: 10, marginBottom: 22 }}>
              <ActionButton label="取得を記録" icon={<Stamp size={15} />} onClick={() => { setShowAddUsage(true); setShowAddAdjust(false); }} color={BRICK} />
              <ActionButton label="調整を記録" icon={<Plus size={15} />} onClick={() => { setShowAddAdjust(true); setShowAddUsage(false); }} color={JADE} />
            </section>

            {showAddUsage && (
              <EntryForm
                title="有給取得を記録"
                dateValue={usageForm.date} daysValue={usageForm.days} noteValue={usageForm.note}
                onDate={(v) => setUsageForm({ ...usageForm, date: v })}
                onDays={(v) => setUsageForm({ ...usageForm, days: v })}
                onNote={(v) => setUsageForm({ ...usageForm, note: v })}
                onCancel={() => setShowAddUsage(false)} onSubmit={handleAddUsage}
                daysLabel="取得日数" allowNegative={false}
              />
            )}
            {showAddAdjust && (
              <EntryForm
                title="残日数を手動で調整"
                dateValue={adjustForm.date} daysValue={adjustForm.days} noteValue={adjustForm.note}
                onDate={(v) => setAdjustForm({ ...adjustForm, date: v })}
                onDays={(v) => setAdjustForm({ ...adjustForm, days: v })}
                onNote={(v) => setAdjustForm({ ...adjustForm, note: v })}
                onCancel={() => setShowAddAdjust(false)} onSubmit={handleAddAdjust}
                daysLabel="増減日数（マイナス可）" allowNegative={true}
                helper="以前からの繰越分の反映や、記録漏れの補正に使えます。"
              />
            )}

            {error && (
              <div style={{ background: BRICK_SOFT, border: `1px solid ${BRICK}`, borderRadius: 4, padding: "10px 14px", marginBottom: 16 }}>
                <p style={{ color: BRICK, fontSize: 12, margin: 0, lineHeight: 1.6 }}>{error}</p>
              </div>
            )}

            <section style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${LINE}`, paddingBottom: 6, marginBottom: 12 }}>
                <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 700, margin: 0, letterSpacing: "0.02em" }}>取得一覧</h2>
                <div style={{ display: "flex", gap: 6 }}>
                  <ToggleTab label="リスト" active={usageView === "list"} onClick={() => setUsageView("list")} />
                  <ToggleTab label="カレンダー" active={usageView === "calendar"} onClick={() => setUsageView("calendar")} />
                </div>
              </div>
              {usages.length === 0 ? (
                <p style={{ fontSize: 12.5, color: INK_SOFT }}>まだ取得記録がありません。</p>
              ) : usageView === "list" ? (
                <UsageList usages={usages} onDelete={(id) => saveAll(hireDate, adjustments, usages.filter((u) => u.id !== id))} />
              ) : (
                <UsageCalendar
                  usages={usages} month={calendarMonth}
                  onPrevMonth={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}
                  onNextMonth={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}
                />
              )}
            </section>

            <section>
              <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 700, margin: "0 0 10px", letterSpacing: "0.02em", borderBottom: `1px solid ${LINE}`, paddingBottom: 6 }}>
                すべての記録（通帳）
              </h2>
              {ledger.length === 0 ? (
                <p style={{ fontSize: 12.5, color: INK_SOFT }}>まだ記録がありません。</p>
              ) : (
                <div>
                  {ledger.map((item) => (
                    <LedgerRow key={item.id} item={item} onDelete={() => deleteEntry(item)} />
                  ))}
                </div>
              )}
            </section>

            <div style={{ marginTop: 24, textAlign: "center" }}>
              <button onClick={resetAll} style={{ background: "none", border: "none", fontSize: 11.5, color: INK_SOFT, textDecoration: "underline", cursor: "pointer", fontFamily: FONT_BODY }}>
                入社日を変更 / 全データをリセット
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function AuthButton({ user, authLoading, syncState }) {
  if (authLoading || !user) return null;
  const syncLabel = syncState === "syncing" ? "同期中…" : syncState === "error" ? "同期エラー" : "同期済み";
  const syncColor = syncState === "error" ? BRICK : INK_SOFT;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
      <span style={{ fontSize: 10.5, color: syncColor }}>{syncLabel}</span>
      <button
        onClick={logOut}
        title={user.email || ""}
        style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: `1px solid ${LINE}`, borderRadius: 999, padding: "5px 10px", fontSize: 11, color: INK_SOFT, cursor: "pointer", fontFamily: FONT_BODY }}
      >
        <LogOut size={12} /> ログアウト
      </button>
    </div>
  );
}

function NotAuthorizedPage({ onRetry }) {
  return (
    <div style={{ minHeight: "100vh", background: PAPER, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_BODY, color: INK, padding: 20 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@500;700&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap');
      `}</style>
      <div style={{ background: PAPER_CARD, border: `1px solid ${BRICK}`, borderRadius: 4, padding: "32px 28px", maxWidth: 340, width: "100%", textAlign: "center" }}>
        <div style={{ width: 52, height: 52, borderRadius: "50%", border: `2px solid ${BRICK}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
          <X size={26} color={BRICK} />
        </div>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, margin: "0 0 8px" }}>認証されていない為表示できません</h1>
        <p style={{ fontSize: 12, color: INK_SOFT, lineHeight: 1.7, margin: "0 0 22px" }}>
          このGoogleアカウントには、このアプリを開く権限がありません。許可されたアカウントでログインし直してください。
        </p>
        <button
          onClick={onRetry}
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: INK, color: "#fff", border: "none", borderRadius: 3, padding: "11px 0", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT_BODY }}
        >
          <LogIn size={15} /> 別のアカウントでログインし直す
        </button>
      </div>
    </div>
  );
}

function LoginGate({ onSignIn, error }) {
  return (
    <div style={{ minHeight: "100vh", background: PAPER, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_BODY, color: INK, padding: 20 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@500;700&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap');
      `}</style>
      <div style={{ background: PAPER_CARD, border: `1px solid ${LINE}`, borderRadius: 4, padding: "32px 28px", maxWidth: 340, width: "100%", textAlign: "center" }}>
        <div style={{ width: 52, height: 52, borderRadius: "50%", border: `2px solid ${JADE}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
          <Stamp size={26} color={JADE} />
        </div>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, margin: "0 0 8px" }}>有給手帳</h1>
        <p style={{ fontSize: 12, color: INK_SOFT, lineHeight: 1.7, margin: "0 0 22px" }}>
          第三者に内容を見られないよう、ログインするまで記録は表示されません。
        </p>
        <button
          onClick={onSignIn}
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: JADE, color: "#fff", border: "none", borderRadius: 3, padding: "11px 0", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT_BODY }}
        >
          <LogIn size={15} /> Googleでログイン
        </button>
        {error && (
          <p style={{ fontSize: 11, color: BRICK, marginTop: 14, lineHeight: 1.6, textAlign: "left" }}>{error}</p>
        )}
      </div>
    </div>
  );
}

const EXPIRY_RISK_WINDOW_DAYS = 90;

function ExpiryRiskCard({ nearestExpiry, today, anchorRef }) {
  const daysLeft = nearestExpiry ? Math.max(0, Math.round((new Date(nearestExpiry.expiry) - today) / (1000 * 60 * 60 * 24))) : null;
  const atRisk = nearestExpiry && daysLeft <= EXPIRY_RISK_WINDOW_DAYS;

  if (!atRisk) {
    return (
      <section ref={anchorRef} style={{ background: PAPER_CARD, border: `1px solid ${LINE}`, borderRadius: 4, padding: "16px 18px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.03em" }}>失効が近い有給</span>
          <span style={{ fontFamily: FONT_MONO, fontSize: 13, color: JADE, fontWeight: 700 }}>0日</span>
        </div>
        <div style={{ height: 8, background: JADE, borderRadius: 4, opacity: 0.85 }} />
        <p style={{ margin: "8px 0 0", fontSize: 11.5, color: INK_SOFT }}>
          失効する有給はありません{nearestExpiry ? `（次に近いのは ${fmtJP(nearestExpiry.expiry)} ）` : ""}
        </p>
      </section>
    );
  }

  const urgency = daysLeft <= 30 ? BRICK : AMBER;
  const progressPct = Math.min(100, Math.max(0, (nearestExpiry.remaining / nearestExpiry.days) * 100));

  return (
    <section ref={anchorRef} style={{ background: PAPER_CARD, border: `1px solid ${LINE}`, borderRadius: 4, padding: "16px 18px", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.03em" }}>失効が近い有給</span>
        <span style={{ fontFamily: FONT_MONO, fontSize: 13, color: urgency, fontWeight: 700 }}>
          {nearestExpiry.remaining}日・あと{daysLeft}日
        </span>
      </div>
      <div style={{ height: 8, background: LINE, borderRadius: 4, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${progressPct}%`, background: urgency, transition: "width 0.4s ease" }} />
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 11.5, color: INK_SOFT }}>
        {fmtJP(nearestExpiry.date)}付与（{nearestExpiry.days}日）のうち未消化の{nearestExpiry.remaining}日が、{fmtJP(nearestExpiry.expiry)}に時効消滅します
      </p>
    </section>
  );
}

function SetupCard({ value, onChange, onSubmit, error }) {
  return (
    <section style={{ background: PAPER_CARD, border: `1px solid ${LINE}`, borderRadius: 4, padding: 24 }}>
      <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 700, margin: "0 0 6px" }}>はじめに、入社日を入力</h2>
      <p style={{ fontSize: 12.5, color: INK_SOFT, margin: "0 0 18px", lineHeight: 1.6 }}>
        毎年9/16の基準日に、10日→11日→12日→14日→16日→18日→20日（以降20日）の順で自動付与されるものとして計算します。既にある残日数は後から「調整」で反映できます。
      </p>
      <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 6 }}>入社日</label>
      <input
        type="date" value={value} onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", padding: "10px 12px", border: `1px solid ${LINE}`, borderRadius: 3, fontFamily: FONT_MONO, fontSize: 14, background: "#fff", marginBottom: 14 }}
      />
      {error && <p style={{ color: BRICK, fontSize: 12, marginBottom: 12 }}>{error}</p>}
      <button
        onClick={onSubmit}
        style={{ width: "100%", padding: "11px 0", background: JADE, color: "#fff", border: "none", borderRadius: 3, fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT_BODY, letterSpacing: "0.03em" }}
      >
        手帳をひらく
      </button>
    </section>
  );
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{ background: PAPER_CARD, border: `1px solid ${LINE}`, borderRadius: 4, padding: "14px 16px" }}>
      <div style={{ fontSize: 11.5, color: INK_SOFT, marginBottom: 6, letterSpacing: "0.03em" }}>{label}</div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 22, fontWeight: 700, color: accent || INK, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: INK_SOFT, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function ActionButton({ label, icon, onClick, color }) {
  return (
    <button
      onClick={onClick}
      style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "10px 0", background: "#fff", border: `1px solid ${color}`, color, borderRadius: 3, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT_BODY }}
    >
      {icon}
      {label}
    </button>
  );
}

function EntryForm({ title, dateValue, daysValue, noteValue, onDate, onDays, onNote, onCancel, onSubmit, daysLabel, allowNegative, helper }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 4, padding: 18, marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>
        <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: INK_SOFT }}>
          <X size={16} />
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: 10, marginBottom: 10 }}>
        <div>
          <label style={{ fontSize: 11, color: INK_SOFT, display: "block", marginBottom: 4 }}>日付</label>
          <input type="date" value={dateValue} onChange={(e) => onDate(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: `1px solid ${LINE}`, borderRadius: 3, fontFamily: FONT_MONO, fontSize: 13 }} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: INK_SOFT, display: "block", marginBottom: 4 }}>{daysLabel}</label>
          <input
            type="number" step={allowNegative ? "1" : "0.5"} value={daysValue} onChange={(e) => onDays(e.target.value)}
            style={{ width: "100%", padding: "8px 10px", border: `1px solid ${LINE}`, borderRadius: 3, fontFamily: FONT_MONO, fontSize: 13 }}
          />
        </div>
      </div>
      <label style={{ fontSize: 11, color: INK_SOFT, display: "block", marginBottom: 4 }}>メモ（任意）</label>
      <input
        type="text" value={noteValue} onChange={(e) => onNote(e.target.value)} placeholder="例：夏季休暇、通院 など"
        style={{ width: "100%", padding: "8px 10px", border: `1px solid ${LINE}`, borderRadius: 3, fontSize: 13, marginBottom: helper ? 6 : 14, fontFamily: FONT_BODY }}
      />
      {helper && <p style={{ fontSize: 10.5, color: INK_SOFT, margin: "0 0 14px" }}>{helper}</p>}
      <button
        onClick={onSubmit}
        style={{ width: "100%", padding: "9px 0", background: INK, color: "#fff", border: "none", borderRadius: 3, fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: FONT_BODY }}
      >
        <Check size={14} /> 記録する
      </button>
    </div>
  );
}

function ToggleTab({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{ padding: "5px 12px", fontSize: 11.5, fontWeight: 700, borderRadius: 999, border: `1px solid ${active ? JADE : LINE}`, background: active ? JADE : "#fff", color: active ? "#fff" : INK_SOFT, cursor: "pointer", fontFamily: FONT_BODY }}
    >
      {label}
    </button>
  );
}

function UsageList({ usages, onDelete }) {
  const sorted = [...usages].sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <div>
      {sorted.map((u) => (
        <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: `1px dashed ${LINE}` }}>
          <div style={{ width: 26, height: 26, borderRadius: "50%", border: `1.5px solid ${BRICK}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: BRICK }}>
            <Stamp size={12} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 500 }}>{u.note || "取得"}</div>
            <div style={{ fontSize: 10.5, color: INK_SOFT, fontFamily: FONT_MONO }}>{fmtJP(u.date)}</div>
          </div>
          <div style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 13, color: BRICK, flexShrink: 0 }}>{u.days}日</div>
          <button onClick={() => onDelete(u.id)} style={{ background: "none", border: "none", cursor: "pointer", color: INK_SOFT, padding: 4, flexShrink: 0 }}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function UsageCalendar({ usages, month, onPrevMonth, onNextMonth }) {
  const year = month.getFullYear();
  const m = month.getMonth();
  const firstWeekday = new Date(year, m, 1).getDay();
  const daysInMonth = new Date(year, m + 1, 0).getDate();

  const usageByDate = {};
  usages.forEach((u) => { usageByDate[u.date] = (usageByDate[u.date] || 0) + Number(u.days); });

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <button onClick={onPrevMonth} style={{ background: "none", border: `1px solid ${LINE}`, borderRadius: 3, padding: "4px 10px", cursor: "pointer", fontSize: 13, fontFamily: FONT_BODY }}>‹</button>
        <span style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: 700 }}>{year}年{m + 1}月</span>
        <button onClick={onNextMonth} style={{ background: "none", border: `1px solid ${LINE}`, borderRadius: 3, padding: "4px 10px", cursor: "pointer", fontSize: 13, fontFamily: FONT_BODY }}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
        {WEEKDAY_LABELS.map((w) => (<div key={w} style={{ textAlign: "center", fontSize: 10.5, color: INK_SOFT, fontWeight: 700 }}>{w}</div>))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const dateISO = toISO(new Date(year, m, d));
          const used = usageByDate[dateISO];
          const isFull = used >= 1;
          const isHalf = used > 0 && used < 1;
          return (
            <div key={i} title={used ? `${used}日取得` : undefined}
              style={{
                aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4,
                fontSize: 12, fontFamily: FONT_MONO,
                background: isFull ? BRICK : isHalf ? BRICK_SOFT : "transparent",
                color: isFull ? "#fff" : isHalf ? BRICK : INK,
                border: used ? "none" : `1px solid ${LINE}`, fontWeight: used ? 700 : 400,
              }}
            >
              {d}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 12, fontSize: 10.5, color: INK_SOFT }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: BRICK, display: "inline-block" }} /> 全日</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: BRICK_SOFT, display: "inline-block" }} /> 半日</span>
      </div>
    </div>
  );
}

function LedgerRow({ item, onDelete }) {
  const isGrant = item.type === "grant";
  const color = isGrant ? (item.expired ? INK_SOFT : JADE) : BRICK;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px dashed ${LINE}` }}>
      <div style={{ width: 30, height: 30, borderRadius: "50%", border: `1.5px solid ${color}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color }}>
        {isGrant ? <Plus size={14} /> : <Stamp size={13} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{item.note || (isGrant ? "付与" : "取得")}</div>
        <div style={{ fontSize: 10.5, color: INK_SOFT, fontFamily: FONT_MONO }}>{fmtJP(item.date)}{item.auto ? "・自動計算" : ""}</div>
        {isGrant && (
          <div style={{ fontSize: 10.5, color: item.expired ? BRICK : INK_SOFT, marginTop: 2 }}>
            {item.expired ? `失効済み（${fmtJP(item.expiry)}）` : `残り${item.remaining}日・失効日 ${fmtJP(item.expiry)}`}
          </div>
        )}
      </div>
      <div style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 14, color, flexShrink: 0 }}>{isGrant ? "+" : ""}{item.days}日</div>
      {!item.auto && (
        <button onClick={onDelete} style={{ background: "none", border: "none", cursor: "pointer", color: INK_SOFT, padding: 4, flexShrink: 0 }}>
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}
