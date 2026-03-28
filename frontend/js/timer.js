// =============================================
// frontend/js/timer.js
// 역할:
// 1. 실시간 타이머 표시
// 2. 서버 기준 날짜 변경 감지
// 3. 밴 상태 / 자정 상태를 프론트에서도 즉시 반영
// =============================================

let sessionStartTime = null;
let baseAccumulatedMs = 0;
let serverTimeOffset = 0;
let timerInterval = null;
let isTimerRunning = false;
let isSingleTabActive = true;
let midnightTimeout = null;
let syncInterval = null;
let activeDateKey = null;

const DB_SYNC_INTERVAL = 60000;

window.transTime = function(ms) {
  try {
    let cleanVal = String(ms || 0).replace(/[^0-9.-]/g, "");
    let safeMs = Math.floor(Number(cleanVal)) || 0;
    if (safeMs < 0) safeMs = 0;

    const totalSeconds = Math.floor(safeMs / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;

    return {
      h: String(h).padStart(2, "0"),
      m: String(m).padStart(2, "0"),
      s: String(s).padStart(2, "0"),
    };
  } catch (error) {
    console.error("🚨 [transTime] 치명적 계산 오류:", error);
    return { h: "00", m: "00", s: "00" };
  }
};

async function fairServer() {
  try {
    const clientBefore = Date.now();
    const res = await fetch(`${API_BASE}/api/time`);
    const { serverTime } = await res.json();
    const clientAfter = Date.now();
    const networkLatency = (clientAfter - clientBefore) / 2;
    serverTimeOffset = serverTime - clientAfter + networkLatency;
    console.log(`[타이머] 서버-클라이언트 시간 오차: ${serverTimeOffset}ms`);
  } catch (error) {
    console.warn("[타이머] 서버 시간 동기화 실패:", error);
    serverTimeOffset = 0;
  }
}

function getServerNow() {
  return Date.now() + serverTimeOffset;
}

function getKstDateKey(baseMs = Date.now()) {
  return new Date(baseMs + (9 * 60 * 60 * 1000)).toISOString().split("T")[0];
}

function updateTimerDisplay(totalMs) {
  const { h, m, s } = transTime(totalMs);

  const hoursEl = document.getElementById("timer-hours");
  const minsEl = document.getElementById("timer-minutes");
  const secsEl = document.getElementById("timer-seconds");
  const headerTimer = document.getElementById("header-timer");

  if (hoursEl) hoursEl.textContent = h;
  if (minsEl) minsEl.textContent = m;
  if (secsEl) secsEl.textContent = s;
  if (headerTimer) headerTimer.textContent = `${h}:${m}:${s}`;
}

function realTimer() {
  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    detectDateBoundary();
    if (!isTimerRunning || !isSingleTabActive) return;

    const currentSessionMs = sessionStartTime ? getServerNow() - sessionStartTime : 0;
    const totalMs = baseAccumulatedMs + currentSessionMs;
    updateTimerDisplay(totalMs);
  }, 1000);
}

async function initTimer() {
  const sessionToken = localStorage.getItem("sessionToken");
  if (!sessionToken) return;

  try {
    const res = await fetch(`${API_BASE}/api/timer/get`, {
      headers: { "Authorization": `Bearer ${sessionToken}` },
    });
    if (!res.ok) throw new Error("로드 실패");

    const data = await res.json();
    activeDateKey = data.date || getKstDateKey();

    if (data.banned) {
      baseAccumulatedMs = 0;
      sessionStartTime = null;
      isTimerRunning = false;
      updateTimerDisplay(0);
      freezeTimer(data.message || "IP 밴 상태입니다.");
      return;
    }

    baseAccumulatedMs = data.today_accumulated_ms || 0;
    updateTimerDisplay(baseAccumulatedMs);

    sessionStartTime = getServerNow();
    isTimerRunning = true;
    realTimer();
    startDbSync();
  } catch (error) {
    console.warn("[타이머] 초기 로드 실패:", error);
    activeDateKey = getKstDateKey();
    baseAccumulatedMs = 0;
    sessionStartTime = getServerNow();
    isTimerRunning = true;
    realTimer();
  }
}

function startDbSync() {
  if (syncInterval) clearInterval(syncInterval);

  syncInterval = setInterval(async () => {
    if (!isTimerRunning || !isSingleTabActive) return;
    await saveTimerToDb();
  }, DB_SYNC_INTERVAL);
}

async function saveTimerToDb() {
  const sessionToken = localStorage.getItem("sessionToken");
  const tabId = localStorage.getItem("tabId");
  if (!sessionToken || !tabId) return;

  const currentSessionMs = sessionStartTime ? getServerNow() - sessionStartTime : 0;
  const totalMs = Math.floor(baseAccumulatedMs + currentSessionMs);

  try {
    const resUpdate = await fetch(`${API_BASE}/api/timer/update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ accumulatedMs: totalMs, tabId }),
    });

    const updateData = await resUpdate.json();
    if (updateData.blocked && !updateData.banned) {
      freezeTimer("중복 접속 감지");
      return;
    }

    if (updateData.banned) {
      baseAccumulatedMs = 0;
      sessionStartTime = null;
      updateTimerDisplay(0);
      freezeTimer("IP 밴 상태입니다.");
      return;
    }

    if (typeof updateData.serverAccumulatedMs === "number") {
      baseAccumulatedMs = updateData.serverAccumulatedMs;
      sessionStartTime = getServerNow();
    }

    if (updateData.date) {
      activeDateKey = updateData.date;
    }

    await fetch(`${API_BASE}/api/leaderboard`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ score: baseAccumulatedMs, status: "surviving" }),
    });
  } catch (error) {
    console.warn("[타이머] 동기화 실패:", error);
  }
}

function storePersonalrecord() {
  // ⚠️ 중요:
  // 프론트는 날짜가 바뀌면 즉시 0초부터 다시 보이게 하고,
  // 최종 어제 기록 이관은 백엔드가 서버 날짜 기준으로 처리합니다.
  baseAccumulatedMs = 0;
  sessionStartTime = getServerNow();
  activeDateKey = getKstDateKey();
  updateTimerDisplay(0);
  document.dispatchEvent(new CustomEvent("midnight-reset"));
}

function scheduleMidnightReset() {
  if (midnightTimeout) clearTimeout(midnightTimeout);

  const now = new Date();
  const midnight = new Date(now);
  midnight.setDate(midnight.getDate() + 1);
  midnight.setHours(0, 0, 0, 0);

  const msUntilMidnight = midnight.getTime() - now.getTime();
  midnightTimeout = setTimeout(() => {
    storePersonalrecord();
    scheduleMidnightReset();
  }, msUntilMidnight);
}

function detectDateBoundary() {
  const currentDateKey = getKstDateKey();
  if (!activeDateKey) {
    activeDateKey = currentDateKey;
    return;
  }

  if (activeDateKey !== currentDateKey) {
    storePersonalrecord();
  }
}

function singleTabGuard() {
  const myTabId = crypto.randomUUID();
  localStorage.setItem("tabId", myTabId);
  localStorage.setItem("activeTabId", myTabId);

  window.addEventListener("storage", (event) => {
    if (event.key === "activeTabId" && event.newValue !== myTabId) {
      isSingleTabActive = false;
      freezeTimer("다른 탭에서 이미 실행 중입니다.");
    }
  });

  window.addEventListener("beforeunload", async () => {
    await saveTimerToDb();
    if (localStorage.getItem("activeTabId") === myTabId) {
      localStorage.removeItem("activeTabId");
    }
  });
}

function freezeTimer(message) {
  isTimerRunning = false;
  if (timerInterval) clearInterval(timerInterval);
  if (syncInterval) clearInterval(syncInterval);

  const overlay = document.getElementById("tab-block-overlay");
  if (overlay) {
    const messageEl = overlay.querySelector("#tab-block-message");
    if (messageEl) messageEl.textContent = message;
    overlay.classList.remove("hidden");
  }
}

function resumeTimer() {
  // ⚠️ 중요:
  // BANNED 상태로 막힌 경우에는 관리자가 IP 해제하기 전까지 재개되면 안 됩니다.
  const blockMessage = document.getElementById("tab-block-message")?.textContent || "";
  if (blockMessage.includes("밴")) return;

  isSingleTabActive = true;
  isTimerRunning = true;
  const myTabId = localStorage.getItem("tabId");
  localStorage.setItem("activeTabId", myTabId);

  const overlay = document.getElementById("tab-block-overlay");
  if (overlay) overlay.classList.add("hidden");

  sessionStartTime = getServerNow();
  realTimer();
  startDbSync();
}

async function startTimerService() {
  console.log("[타이머] 서비스 초기화 시작...");
  activeDateKey = getKstDateKey();
  singleTabGuard();
  await fairServer();
  await initTimer();
  scheduleMidnightReset();
  setInterval(fairServer, 10 * 60 * 1000);
  console.log("[타이머] 서비스 초기화 완료!");
}

function getCurrentTotalMs() {
  const currentSessionMs = sessionStartTime ? getServerNow() - sessionStartTime : 0;
  return baseAccumulatedMs + currentSessionMs;
}
