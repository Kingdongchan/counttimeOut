// =============================================
// frontend/js/auth.js
// 역할: Google OAuth 2.0 로그인, 세션 관리, 관리자 권한 처리
//
// ⚠️ .gitignore 필수 확인 (맥북 사용자 전용):
//   .DS_Store, .env, .dev.vars는 반드시 .gitignore에 포함할 것!
//   민감 정보가 GitHub에 올라가면 즉시 키를 재발급 받아야 함.
// =============================================

// =============================================
// 설정 상수
// ⚠️ 필수 수정: 아래 두 값은 반드시 본인 것으로 교체!
// 구글 콘솔 → APIs & Services → Credentials → OAuth 2.0 Client IDs
// =============================================

// ⚠️ 중요 필수 수정: Google Cloud Console에서 발급받은 클라이언트 ID 입력
// https://console.cloud.google.com → 사용자 인증 정보 → OAuth 클라이언트 ID
const GOOGLE_CLIENT_ID = "여기에_복사한_CLIENT_ID.apps.googleusercontent.com";

// ⚠️ 보안 절대 금지: Client Secret은 절대 프론트엔드에 넣지 말 것!
// Client Secret은 backend/wrangler.toml의 환경변수로만 관리:
// 터미널: wrangler secret put GOOGLE_CLIENT_SECRET

// ⚠️ 필수 수정: wrangler deploy 후 실제 Workers URL로 교체
const API_BASE = "https://killcount-backend.여기에_서브도메인.workers.dev";

// 관리자 이메일 (프론트엔드 UI 표시용 - 실제 권한은 백엔드에서 이중 검증)
// ⚠️ 보안: 이 값을 바꿔도 실제 관리자 권한은 백엔드 DB에서 결정됨
const ADMIN_EMAIL = "samesamechan0412@gmail.com";


// =============================================
// initAuth()
// 목적: 페이지 로드 시 기존 로그인 상태 확인 → 자동 로그인 처리
// 흐름: LocalStorage 토큰 확인 → 서버 검증 → UI 업데이트
// =============================================
async function initAuth() {
  console.log("[인증] 로그인 상태 확인 중...");

  // Google Identity Services SDK 로드
  await loadGoogleSDK();

  const sessionToken = localStorage.getItem("sessionToken");

  if (!sessionToken) {
    // 토큰 없음 → 로그인 버튼 표시
    showLoginUI();
    return;
  }

  try {
    // 서버에서 세션 유효성 검증
    const res = await fetch(`${API_BASE}/api/auth/check`, {
      headers: { "Authorization": `Bearer ${sessionToken}` },
    });

    const data = await res.json();

    if (data.valid && data.user) {
      // 인증 성공 → 유저 UI 표시 및 타이머 시작
      const user = data.user;

      // 세션에 role 포함 저장 (UI 표시용만 - 실제 권한은 백엔드가 결정)
      localStorage.setItem("userInfo", JSON.stringify(user));

      updateUserUI(user);

      // 관리자 권한 확인
      isAdminCheck(user);

      // timer.js 시작 (타이머 서비스 초기화)
      if (typeof startTimerService === "function") {
        await startTimerService();
      }

      // chat.js 초기화
      if (typeof initChat === "function") {
        await initChat();
      }

      // 로그인 성공 이벤트 발행 (다른 모듈에서 감지 가능)
      document.dispatchEvent(new CustomEvent("auth-success", { detail: user }));

      console.log(`[인증] 자동 로그인 성공: ${user.name}`);

    } else {
      // 세션 만료 → 토큰 삭제 후 로그인 화면
      localStorage.removeItem("sessionToken");
      localStorage.removeItem("userInfo");
      showLoginUI();
    }

  } catch (err) {
    console.error("[인증] 서버 연결 실패:", err);
    showLoginUI(); // 오프라인이어도 로그인 버튼은 표시
  }
}


// =============================================
// signGoogle() / signInWithGoogle()
// 목적: 구글 OAuth 팝업 실행 → 서버 등록 → 세션 시작
// =============================================
async function signGoogle() {
  console.log("[인증] 구글 로그인 시작...");

  if (typeof google === "undefined") {
    alert("구글 로그인 라이브러리 로드 중입니다. 잠시 후 다시 시도해주세요.");
    return;
  }

  // Google One Tap 또는 팝업 로그인 실행
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleCallback,
    auto_select: false,
    cancel_on_tap_outside: true,
  });

  // 팝업 방식으로 로그인 창 표시
  google.accounts.id.prompt((notification) => {
    if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
      // One Tap이 안 되면 버튼 렌더링으로 대체
      console.log("[인증] One Tap 불가, 버튼 방식으로 전환");
    }
  });
}

// 별칭: 함수명 통일을 위해 두 이름 모두 사용 가능하게
const signInWithGoogle = signGoogle;


// =============================================
// handleGoogleCallback(response)
// 목적: 구글이 보내준 ID 토큰을 백엔드로 전달 → 세션 발급
// ⚠️ 보안: ID 토큰 검증은 반드시 백엔드에서 수행 (프론트에서 디코딩만으론 불충분)
// =============================================
async function handleGoogleCallback(response) {
  const idToken = response.credential;

  try {
    // 백엔드로 Google ID 토큰 전송 → 검증 + 세션 발급
    const res = await fetch(`${API_BASE}/api/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });

    if (!res.ok) throw new Error("서버 인증 실패");

    const data = await res.json();
    const { sessionId, user } = data;

    // 세션 토큰 저장
    localStorage.setItem("sessionToken", sessionId);
    localStorage.setItem("userInfo", JSON.stringify(user));

    // UI 업데이트
    updateUserUI(user);

    // 관리자 권한 확인
    isAdminCheck(user);

    // 타이머 시작
    if (typeof startTimerService === "function") {
      await startTimerService();
    }

    // 채팅 초기화
    if (typeof initChat === "function") {
      await initChat();
    }

    // 로그인 성공 이벤트 발행
    document.dispatchEvent(new CustomEvent("auth-success", { detail: user }));

    console.log(`[인증] 로그인 성공: ${user.name} (${user.role})`);

  } catch (err) {
    console.error("[인증] 로그인 처리 실패:", err);
    alert("로그인에 실패했습니다. 다시 시도해주세요.");
  }
}


// =============================================
// signOut() / sighOut()
// 목적: 세션 안전 종료 + 브라우저 흔적 삭제
// =============================================
async function signOut() {
  console.log("[인증] 로그아웃 처리 중...");

  const sessionToken = localStorage.getItem("sessionToken");

  // 1단계: 타이머 최종 기록 저장
  if (typeof stopTimer === "function") {
    await stopTimer();
  }

  // 2단계: 서버에서 세션 삭제
  if (sessionToken) {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${sessionToken}` },
      });
    } catch (err) {
      console.warn("[인증] 서버 로그아웃 실패 (로컬만 삭제):", err);
    }
  }

  // 3단계: 로컬 데이터 전부 삭제
  localStorage.removeItem("sessionToken");
  localStorage.removeItem("userInfo");
  localStorage.removeItem("tabId");
  localStorage.removeItem("activeTabId");

  // 4단계: 구글 세션도 초기화
  if (typeof google !== "undefined") {
    google.accounts.id.disableAutoSelect();
  }

  // 5단계: UI 리셋 및 로그인 화면 표시
  showLoginUI();

  // 채팅 입력 비활성화
  const chatInput = document.getElementById("chat-input");
  const chatSendBtn = document.getElementById("chat-send-btn");
  if (chatInput) chatInput.disabled = true;
  if (chatSendBtn) chatSendBtn.disabled = true;

  console.log("[인증] 로그아웃 완료");
}

// 별칭 (오타 대비)
const sighOut = signOut;


// =============================================
// getUserProfile(token)
// 목적: 유저 프로필 + 어제 순위 데이터 가져와 UI 갱신
// =============================================
async function getUserProfile(token) {
  try {
    const res = await fetch(`${API_BASE}/api/auth/check`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    const data = await res.json();

    if (data.valid) {
      updateUserUI(data.user);
      return data.user;
    }
  } catch (err) {
    console.error("[인증] 프로필 로드 실패:", err);
  }
  return null;
}


// =============================================
// isAdminCheck(user)
// 목적: 관리자 여부 판별 후 관리자 대시보드 버튼 표시
// ⚠️ 보안: 이 함수는 UI 표시용. 실제 관리자 기능 실행 시
//          백엔드에서 반드시 role을 DB 기준으로 재검증!
// =============================================
function isAdminCheck(user) {
  const adminPanel = document.getElementById("admin-panel");
  const adminBtn = document.getElementById("admin-dashboard-btn");

  // role은 백엔드에서 받아온 값 (프론트 조작 불가)
  if (user && user.role === "admin") {
    if (adminPanel) adminPanel.classList.remove("hidden");
    if (adminBtn) adminBtn.classList.remove("hidden");
    console.log("[관리자] 관리자 권한 확인됨");
  } else {
    if (adminPanel) adminPanel.classList.add("hidden");
    if (adminBtn) adminBtn.classList.add("hidden");
  }
}


// =============================================
// getAdminPower()
// 목적: 관리자 전용 API 기능 실행 (채팅 삭제, 타이머 강제 종료)
// ⚠️ 보안: 이 함수 호출 자체보다 백엔드 API에서의 검증이 더 중요!
//   프론트에서 role 체크는 UX용. 실제 보안은 Workers에서 담당.
// =============================================
async function getAdminPower(action, payload = {}) {
  const sessionToken = localStorage.getItem("sessionToken");
  const userInfo = JSON.parse(localStorage.getItem("userInfo") || "{}");

  // 프론트 1차 검사 (UX 최적화용, 보안 기능 아님)
  if (userInfo.role !== "admin") {
    alert("관리자 권한이 없습니다.");
    return;
  }

  try {
    let endpoint = "";
    let body = payload;

    switch (action) {
      case "force-stop":
        endpoint = "/api/admin/force-stop";
        break;
      case "midnight-reset":
        endpoint = "/api/admin/midnight-reset";
        break;
      default:
        console.error("[관리자] 알 수 없는 액션:", action);
        return;
    }

    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${sessionToken}`,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    console.log("[관리자] 액션 결과:", data);
    return data;

  } catch (err) {
    console.error("[관리자] API 호출 실패:", err);
  }
}


// =============================================
// updateUserUI(user)
// 목적: 로그인된 유저 정보를 화면에 반영
// =============================================
function updateUserUI(user) {
  // 로그인 버튼 숨기기
  const loginBtn = document.getElementById("login-btn");
  if (loginBtn) loginBtn.classList.add("hidden");

  // 유저 프로필 영역 표시
  const userProfile = document.getElementById("user-profile");
  if (userProfile) userProfile.classList.remove("hidden");

  // 아바타 이미지
  const avatarImg = document.getElementById("user-avatar");
  if (avatarImg && user.picture) {
    avatarImg.src = user.picture;
    avatarImg.alt = `${user.name} 프로필`;
  }

  // 닉네임 표시
  const nameEl = document.getElementById("user-name");
  if (nameEl) nameEl.textContent = user.name;

  // 채팅 입력 활성화
  const chatInput = document.getElementById("chat-input");
  const chatSendBtn = document.getElementById("chat-send-btn");
  if (chatInput) {
    chatInput.disabled = false;
    chatInput.placeholder = "메시지를 입력하세요...";
  }
  if (chatSendBtn) chatSendBtn.disabled = false;
}


// =============================================
// showLoginUI()
// 목적: 비로그인 상태 UI 표시
// =============================================
function showLoginUI() {
  // 로그인 버튼 표시
  const loginBtn = document.getElementById("login-btn");
  if (loginBtn) loginBtn.classList.remove("hidden");

  // 유저 프로필 숨기기
  const userProfile = document.getElementById("user-profile");
  if (userProfile) userProfile.classList.add("hidden");

  // 관리자 패널 숨기기
  const adminPanel = document.getElementById("admin-panel");
  if (adminPanel) adminPanel.classList.add("hidden");

  // 채팅 비활성화 (로그인 필요 안내)
  const chatInput = document.getElementById("chat-input");
  if (chatInput) {
    chatInput.disabled = true;
    chatInput.placeholder = "채팅하려면 로그인하세요";
  }
}


// =============================================
// loadGoogleSDK()
// 목적: Google Identity Services 스크립트 동적 로드
// =============================================
function loadGoogleSDK() {
  return new Promise((resolve) => {
    if (typeof google !== "undefined") {
      resolve(); // 이미 로드됨
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    document.head.appendChild(script);
  });
}


// =============================================
// 페이지 로드 시 자동 실행
// =============================================
document.addEventListener("DOMContentLoaded", () => {
  initAuth();
});
