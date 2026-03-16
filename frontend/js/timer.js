// =============================================
// frontend/js/timer.js
// 역할: 실시간 타이머 제어, 서버 시간 보정, 기록 관리, 리더보드 연동
// 의존성: auth.js (userId, sessionToken 필요)
// =============================================

// =============================================
// 전역 상태 변수
// =============================================
let sessionStartTime = null;        
let baseAccumulatedMs = 0;          
let serverTimeOffset = 0;           
let timerInterval = null;           
let isTimerRunning = false;         
let isSingleTabActive = true;       
let midnightTimeout = null;         
let syncInterval = null;            

// 전역 API 주소 설정 (window.API_BASE가 없으면 기본값 사용)
var current_api = window.API_BASE || "https://counttimeout-backend.samesamechan0412.workers.dev";

// DB 업데이트 주기 (ms)
const DB_SYNC_INTERVAL = 30000; 

// =============================================
// transTime(ms)
// 목적: 밀리초 → { h, m, s } 객체 변환
// =============================================
window.transTime = function(ms) {
    try {
        let cleanVal = String(ms || 0).replace(/[^0-9.-]/g, ''); 
        let safeMs = Math.floor(Number(cleanVal)) || 0;
        if (safeMs < 0) safeMs = 0;

        const totalSeconds = Math.floor(safeMs / 1000);
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;

        return {
            h: String(h).padStart(2, '0'),
            m: String(m).padStart(2, '0'),
            s: String(s).padStart(2, '0')
        };
    } catch (e) {
        console.error("🚨 [transTime] 치명적 계산 오류:", e);
        return { h: "00", m: "00", s: "00" };
    }
};

// =============================================
// fairServer()
// 목적: 서버 시간 보정
// =============================================
async function fairServer() {
  try {
    const clientBefore = Date.now();
    const res = await fetch(`${API_BASE}/api/time`);
    const { serverTime } = await res.json();
    const clientAfter = Date.now();
    const networkLatency = (clientAfter - clientBefore) / 2;
    serverTimeOffset = serverTime - clientAfter + networkLatency;
    console.log(`[타이머] 서버-클라이언트 시간 오차: ${serverTimeOffset}ms`);
  } catch (err) {
    console.warn("[타이머] 서버 시간 동기화 실패:", err);
    serverTimeOffset = 0;
  }
}

function getServerNow() {
  return Date.now() + serverTimeOffset;
}

// =============================================
// realTimer()
// 목적: 1초마다 화면 갱신
// =============================================
function realTimer() {
  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    if (!isTimerRunning || !isSingleTabActive) return;

    const currentSessionMs = sessionStartTime ? getServerNow() - sessionStartTime : 0;
    const totalMs = baseAccumulatedMs + currentSessionMs;
    const { h, m, s } = transTime(totalMs);

    const hoursEl = document.getElementById("timer-hours");
    const minsEl = document.getElementById("timer-minutes");
    const secsEl = document.getElementById("timer-seconds");

    if (hoursEl) hoursEl.textContent = h;
    if (minsEl) minsEl.textContent = m;
    if (secsEl) secsEl.textContent = s;

    const headerTimer = document.getElementById("header-timer");
    if (headerTimer) headerTimer.textContent = `${h}:${m}:${s}`;
  }, 1000);
}

// =============================================
// initTimer()
// 목적: 데이터 로드 및 시작
// =============================================
async function initTimer() {
  const sessionToken = localStorage.getItem("sessionToken");
  if (!sessionToken) return;

  try {
    const res = await fetch(`${API_BASE}/api/timer/get`, {
      headers: { "Authorization": `Bearer ${sessionToken}` },
    });
    if (!res.ok) throw new Error("로드 실패");

    const data = await res.json();
    baseAccumulatedMs = data.today_accumulated_ms || 0;
 
    const initialTime = transTime(baseAccumulatedMs);
    document.getElementById("timer-hours").textContent = initialTime.h;
    document.getElementById("timer-minutes").textContent = initialTime.m;
    document.getElementById("timer-seconds").textContent = initialTime.s;

    sessionStartTime = getServerNow();
    isTimerRunning = true;
    realTimer();
    startDbSync();
  } catch (err) {
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

// =============================================
// saveTimerToDb()
// 목적: DB 저장 + 리더보드 실시간 업데이트 (POST 전송)
// =============================================
async function saveTimerToDb() {
  const sessionToken = localStorage.getItem("sessionToken");
  const tabId = localStorage.getItem("tabId");
  if (!sessionToken || !tabId) return;

  const currentSessionMs = sessionStartTime ? getServerNow() - sessionStartTime : 0;
  const totalMs = Math.floor(baseAccumulatedMs + currentSessionMs);

  try {
    // 1. 타이머 상세 정보 업데이트 (daily_record)
    const resUpdate = await fetch(`${API_BASE}/api/timer/update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ accumulatedMs: totalMs, tabId }),
    });
    const updateData = await resUpdate.json();
    if (updateData.blocked) freezeTimer("중복 접속 감지");

    // 2. [추가] 리더보드 전광판 업데이트 (POST /api/leaderboard)
    // 이 요청이 성공해야 다른 유저들 화면에 내 점수가 뜹니다.
    await fetch(`${API_BASE}/api/leaderboard`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ score: totalMs, status: "surviving" }),
    });

  } catch (err) {
    console.warn("[타이머] 동기화 실패:", err);
  }
}

// (이하 자정 리셋 및 탭 가드 로직은 기존과 동일하되 API_BASE 참조 유지)
function storePersonalrecord() {
  baseAccumulatedMs = 0;
  sessionStartTime = getServerNow();
  const { h, m, s } = transTime(0);
  document.getElementById("timer-hours").textContent = "00";
  document.getElementById("timer-minutes").textContent = "00";
  document.getElementById("timer-seconds").textContent = "00";
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
    overlay.querySelector("#tab-block-message").textContent = message;
    overlay.classList.remove("hidden");
  }
}

function resumeTimer() {
  isSingleTabActive = true;
  isTimerRunning = true;
  const myTabId = localStorage.getItem("tabId");
  localStorage.setItem("activeTabId", myTabId);
  const overlay = document.getElementById("tab-block-overlay");
  if (overlay) overlay.classList.add("hidden");
  realTimer();
  startDbSync();
}

async function startTimerService() {
  console.log("[타이머] 서비스 초기화 시작...");
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

async function stopTimer() {
  await saveTimerToDb();
  isTimerRunning = false;
  if (timerInterval) clearInterval(timerInterval);
  if (syncInterval) clearInterval(syncInterval);
  if (midnightTimeout) clearTimeout(midnightTimeout);
  document.getElementById("timer-hours").textContent = "00";
  document.getElementById("timer-minutes").textContent = "00";
  document.getElementById("timer-seconds").textContent = "00";
  console.log("[타이머] 정지 완료");
}