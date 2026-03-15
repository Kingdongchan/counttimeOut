// =============================================
// frontend/js/timer.js
// 역할: 실시간 타이머 제어, 서버 시간 보정, 기록 관리
// 의존성: auth.js (userId, sessionToken 필요)
// =============================================

// =============================================
// 전역 상태 변수
// =============================================
let sessionStartTime = null;        // 현재 세션 시작 시각 (서버 보정된 타임스탬프)
let baseAccumulatedMs = 0;          // DB에서 불러온 오늘 누적 ms (이전 세션 합산)
let serverTimeOffset = 0;           // 서버-클라이언트 시간 오차 (ms)
let timerInterval = null;           // setInterval 참조 (정지 시 사용)
let isTimerRunning = false;         // 타이머 실행 상태
let isSingleTabActive = true;       // 탭 중복 여부 (false면 타이머 동작 안 함)
let midnightTimeout = null;         // 자정 리셋 타이머
let syncInterval = null;            // 서버 동기화 주기 인터벌

// ⚠️ 필수 수정: 실제 백엔드 Workers URL로 교체 (wrangler deploy 후 확인)
// 예시: "https://counttimeout-backend.your-subdomain.workers.dev"
// const API_BASE = "https://counttimeout-backend.samesamechan0412.workers.dev";

// DB 업데이트 주기 (ms) - 너무 짧으면 D1 요금 증가
const DB_SYNC_INTERVAL = 30000; // 30초마다 DB에 기록 저장


// =============================================
// transTime(ms)
// 목적: 밀리초 → { h, m, s } 객체 변환
// 반환: 항상 두 자리 패딩된 문자열 객체
// =============================================
function transTime(ms) {
  try {
    // 숫자가 아니거나 음수일 경우 대비
    const totalSeconds = Math.floor(Number(ms || 0) / 1000);
    
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;

    // 반드시 두 자리 문자열로 반환하도록 보장
    return {
      h: String(h).padStart(2, '0'),
      m: String(m).padStart(2, '0'),
      s: String(s).padStart(2, '0')
    };
  } catch (e) {
    console.error("transTime 에러:", e);
    return { h: "00", m: "00", s: "00" };
  }
}


// =============================================
// fairServer()
// 목적: 서버 시간과 브라우저 시간 오차 계산·보정
// ⚠️ 보안: 유저가 컴퓨터 시계를 조작해도 서버 기준으로 고정
// =============================================
async function fairServer() {
  try {
    const clientBefore = Date.now();

    // 백엔드 /api/time 호출로 서버 시각 수신
    const res = await fetch(`${API_BASE}/api/time`);
    const { serverTime } = await res.json();

    const clientAfter = Date.now();

    // 네트워크 왕복 시간의 절반을 반영한 보정값 계산
    const networkLatency = (clientAfter - clientBefore) / 2;
    serverTimeOffset = serverTime - clientAfter + networkLatency;

    console.log(`[타이머] 서버-클라이언트 시간 오차: ${serverTimeOffset}ms`);
  } catch (err) {
    // 서버 연결 실패 시 오차 0으로 유지 (타이머는 계속 동작)
    console.warn("[타이머] 서버 시간 동기화 실패, 로컬 시간 사용:", err);
    serverTimeOffset = 0;
  }
}


// =============================================
// getServerNow()
// 목적: 보정된 "현재 서버 시각" 반환 (내부 유틸)
// =============================================
function getServerNow() {
  return Date.now() + serverTimeOffset;
}


// =============================================
// realTimer()
// 목적: 1초마다 화면의 시·분·초를 갱신
// ⚠️ 중요: CSS 클래스(timer-glow 등)는 절대 건드리지 않음
// =============================================
function realTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
  }

  timerInterval = setInterval(() => {
    // 타이머 멈춤 상태면 갱신 안 함
    if (!isTimerRunning || !isSingleTabActive) return;

    // 현재까지 총 생존 시간 계산
    // = 이전 세션 누적 + 이번 세션 경과 시간
    const currentSessionMs = sessionStartTime
      ? getServerNow() - sessionStartTime
      : 0;
    const totalMs = baseAccumulatedMs + currentSessionMs;

    // ms → 시:분:초 변환
    const { h, m, s } = transTime(totalMs);

    // DOM 업데이트 (id 속성으로 각 영역 찾아서 숫자만 변경)
    const hoursEl = document.getElementById("timer-hours");
    const minsEl = document.getElementById("timer-minutes");
    const secsEl = document.getElementById("timer-seconds");

    if (hoursEl) hoursEl.textContent = h;
    if (minsEl) minsEl.textContent = m;
    if (secsEl) secsEl.textContent = s;

    // 헤더의 Global Metric 타이머도 업데이트 (있을 경우)
    const headerTimer = document.getElementById("header-timer");
    if (headerTimer) headerTimer.textContent = `${h}:${m}:${s}`;

  }, 1000);
}


// =============================================
// initTimer()
// 목적: DB에서 오늘 누적 기록 불러와 타이머 시작
// 흐름: DB조회 → baseAccumulatedMs 설정 → realTimer() 호출
// =============================================
async function initTimer() {
  const sessionToken = localStorage.getItem("sessionToken");
  if (!sessionToken) {
    console.log("[타이머] 로그인 필요, 타이머 시작 안 함");
    return;
  }

  try {
    // 오늘 누적 기록 조회
    const res = await fetch(`${API_BASE}/api/timer/get`, {
      headers: { "Authorization": `Bearer ${sessionToken}` },
    });

    if (!res.ok) throw new Error("타이머 데이터 로드 실패");

   let data = {today_accumulated_ms:0};
   try { 
        data = await res.json(); 
      } catch (e) { 
        // 에러가 나도 기본값 data를 유지함
      }

    // DB에 저장된 누적 ms를 기준값으로 설정
    baseAccumulatedMs = data.today_accumulated_ms || 0;
 
    // 즉시 타이머 UI 업데이트
    const initialTime = transTime(baseAccumulatedMs);
    const hoursEl = document.getElementById("timer-hours");
    const minsEl = document.getElementById("timer-minutes");
    const secsEl = document.getElementById("timer-seconds");
    if (hoursEl) hoursEl.textContent = initialTime.h;
    if (minsEl) minsEl.textContent = initialTime.m;
    if (secsEl) secsEl.textContent = initialTime.s;
    const headerTimer = document.getElementById("header-timer");
    if (headerTimer) headerTimer.textContent = `${initialTime.h}:${initialTime.m}:${initialTime.s}`;

    // 현재 세션 시작 시점 기록 (서버 보정 시간 기준)
    sessionStartTime = getServerNow();

    console.log(`[타이머] 오늘 누적 기록 로드: ${baseAccumulatedMs}ms`);

    // 화면 타이머 시작
    isTimerRunning = true;
    realTimer();

    // DB 주기적 동기화 시작
    startDbSync();

  } catch (err) {
    console.warn("[타이머] DB 로드 실패, 0부터 시작:", err);
    baseAccumulatedMs = 0;
    sessionStartTime = getServerNow();
    isTimerRunning = true;
    realTimer();
  }
}


// =============================================
// startDbSync()
// 목적: 주기적으로 현재 누적 시간을 DB에 저장
// ⚠️ 중요: 브라우저를 갑자기 닫아도 최대 30초 오차만 발생
// =============================================
function startDbSync() {
  if (syncInterval) clearInterval(syncInterval);

  syncInterval = setInterval(async () => {
    if (!isTimerRunning || !isSingleTabActive) return;
    await saveTimerToDb();
  }, DB_SYNC_INTERVAL);
}


// =============================================
// saveTimerToDb()
// 목적: 현재 총 누적 ms를 DB에 저장
// 호출 시점: 주기 동기화, 로그아웃, 페이지 언로드
// =============================================
async function saveTimerToDb() {
  const sessionToken = localStorage.getItem("sessionToken");
  const tabId = localStorage.getItem("tabId");
  if (!sessionToken || !tabId) return;

  const currentSessionMs = sessionStartTime ? getServerNow() - sessionStartTime : 0;
  const totalMs = baseAccumulatedMs + currentSessionMs;

  try {
    const res = await fetch(`${API_BASE}/api/timer/update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ accumulatedMs: totalMs, tabId }),
    });

    const data = await res.json();

    // 중복 탭 감지 시 타이머 정지
    if (data.blocked) {
      freezeTimer("다른 탭에서 접속이 감지되었습니다.");
    }
  } catch (err) {
    console.warn("[타이머] DB 저장 실패:", err);
  }
}


// =============================================
// storePersonalrecord()
// 목적: 자정 리셋 처리 및 어제 기록 보존
// =============================================
function storePersonalrecord() {
  // baseAccumulatedMs를 0으로 리셋 (어제 기록은 서버에서 history_record로 이동됨)
  baseAccumulatedMs = 0;
  sessionStartTime = getServerNow();

  // 화면 리셋
  const { h, m, s } = transTime(0);
  const hoursEl = document.getElementById("timer-hours");
  const minsEl = document.getElementById("timer-minutes");
  const secsEl = document.getElementById("timer-seconds");
  if (hoursEl) hoursEl.textContent = "00";
  if (minsEl) minsEl.textContent = "00";
  if (secsEl) secsEl.textContent = "00";

  // 채팅 리셋 이벤트 발행 (chat.js가 청취)
  document.dispatchEvent(new CustomEvent("midnight-reset"));

  console.log("[타이머] 자정 리셋 완료 - 새로운 하루 시작!");
}


// =============================================
// scheduleMidnightReset()
// 목적: 다음 자정(00:00:00)까지 남은 시간 계산 후 리셋 예약
// =============================================
function scheduleMidnightReset() {
  if (midnightTimeout) clearTimeout(midnightTimeout);

  const now = new Date();
  // 내일 00:00:00 계산
  const midnight = new Date(now);
  midnight.setDate(midnight.getDate() + 1);
  midnight.setHours(0, 0, 0, 0);

  const msUntilMidnight = midnight.getTime() - now.getTime();

  midnightTimeout = setTimeout(() => {
    storePersonalrecord();
    scheduleMidnightReset(); // 다음날 자정도 예약
  }, msUntilMidnight);

  console.log(`[타이머] 자정 리셋 예약: ${Math.round(msUntilMidnight / 1000 / 60)}분 후`);
}


// =============================================
// singleTabGuard()
// 목적: 다중 탭 중복 접속 차단 (시간 조작 방지)
// 원리: localStorage 이벤트로 탭 간 통신
// =============================================
function singleTabGuard() {
  // 이 탭의 고유 ID 생성 (랜덤 UUID)
  const myTabId = crypto.randomUUID();
  localStorage.setItem("tabId", myTabId);
  localStorage.setItem("activeTabId", myTabId);

  console.log(`[탭 관리] 내 탭 ID: ${myTabId}`);

  // 다른 탭에서 localStorage 변경 시 이벤트 감지
  window.addEventListener("storage", (event) => {
    if (event.key === "activeTabId" && event.newValue !== myTabId) {
      // 다른 탭이 활성화됨 → 이 탭의 타이머 정지
      isSingleTabActive = false;
      freezeTimer("다른 탭에서 이미 실행 중입니다.\n이 탭의 타이머가 일시정지되었습니다.");
    }
  });

  // 페이지 언로드 시 tabId 정리
  window.addEventListener("beforeunload", async () => {
    await saveTimerToDb();
    // 내가 마지막 활성 탭이었다면 기록 제거
    if (localStorage.getItem("activeTabId") === myTabId) {
      localStorage.removeItem("activeTabId");
    }
  });
}


// =============================================
// freezeTimer(message)
// 목적: 중복 탭 또는 관리자 차단 시 타이머 정지 및 UI 오버레이
// =============================================
function freezeTimer(message) {
  isTimerRunning = false;
  if (timerInterval) clearInterval(timerInterval);
  if (syncInterval) clearInterval(syncInterval);

  // 화면에 차단 오버레이 표시
  const overlay = document.getElementById("tab-block-overlay");
  if (overlay) {
    overlay.querySelector("#tab-block-message").textContent = message;
    overlay.classList.remove("hidden");
  }
}


// =============================================
// resumeTimer()
// 목적: 이 탭이 다시 활성화될 때 타이머 재개
// =============================================
function resumeTimer() {
  isSingleTabActive = true;
  isTimerRunning = true;

  const myTabId = localStorage.getItem("tabId");
  localStorage.setItem("activeTabId", myTabId);

  // 오버레이 숨기기
  const overlay = document.getElementById("tab-block-overlay");
  if (overlay) overlay.classList.add("hidden");

  realTimer();
  startDbSync();
}


// =============================================
// startTimerService()
// 목적: 모든 타이머 기능을 올바른 순서로 초기화
// 호출: auth.js에서 로그인 성공 후 호출
// =============================================
async function startTimerService() {
  console.log("[타이머] 서비스 초기화 시작...");

  // 1단계: 탭 중복 방지 먼저 설정
  singleTabGuard();

  // 2단계: 서버 시간 오차 보정
  await fairServer();

  // 3단계: DB에서 오늘 누적 기록 로드 후 타이머 시작
  await initTimer();

  // 4단계: 자정 리셋 예약
  scheduleMidnightReset();

  // 5단계: 10분마다 서버 시간 재보정 (장시간 오차 누적 방지)
  setInterval(fairServer, 10 * 60 * 1000);

  console.log("[타이머] 서비스 초기화 완료!");
}


// =============================================
// getCurrentTotalMs()
// 목적: 현재 총 생존 시간(ms) 반환 (chat.js에서 사용)
// =============================================
function getCurrentTotalMs() {
  const currentSessionMs = sessionStartTime ? getServerNow() - sessionStartTime : 0;
  return baseAccumulatedMs + currentSessionMs;
}


// =============================================
// stopTimer()
// 목적: 로그아웃 시 타이머 완전 정지 및 DB 최종 저장
// 호출: auth.js의 signOut()에서 호출
// =============================================
async function stopTimer() {
  // DB에 마지막 기록 저장
  await saveTimerToDb();

  // 모든 인터벌 정지
  isTimerRunning = false;
  if (timerInterval) clearInterval(timerInterval);
  if (syncInterval) clearInterval(syncInterval);
  if (midnightTimeout) clearTimeout(midnightTimeout);

  // 화면 초기화
  const hoursEl = document.getElementById("timer-hours");
  const minsEl = document.getElementById("timer-minutes");
  const secsEl = document.getElementById("timer-seconds");
  if (hoursEl) hoursEl.textContent = "00";
  if (minsEl) minsEl.textContent = "00";
  if (secsEl) secsEl.textContent = "00";

  console.log("[타이머] 정지 완료");
}
