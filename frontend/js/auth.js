// =============================================
// frontend/js/auth.js
// 역할: Google OAuth 2.0 로그인, 세션 관리, 닉네임 설정/변경, 관리자 권한
//
// 닉네임 흐름:
//   1. 구글 로그인 성공
//   2. 서버에서 user.nickname === null 이면 → 최초 설정 모달 표시
//   3. 닉네임 입력 후 저장 → 게임 시작
//   4. 이후 방문: localStorage 세션으로 자동 로그인 → 게임 바로 시작
//   5. 프로필 아바타 클릭 → 프로필 모달 (닉네임 변경 + 24시간 쿨다운 표시)
//
// ⚠️ .gitignore 필수: .DS_Store, .env, .dev.vars 는 절대 커밋 금지!
// =============================================

// ⚠️ 필수 수정 1: Google Cloud Console → 사용자 인증 정보 → OAuth 2.0 클라이언트 ID
const GOOGLE_CLIENT_ID = "525190783722-vm0ip4dli22ld0i2lgkreqv7165uc3k0.apps.googleusercontent.com";

// ⚠️ 필수 수정 2: wrangler deploy 후 실제 Workers URL로 교체
const API_BASE = "https://counttimeout-backend.samesamechan0412.workers.dev";

// 닉네임 중복 확인 debounce 타이머
let nicknameCheckTimer = null;

// =============================================
// initAuth()
// 목적: 페이지 로드 시 기존 로그인 상태 확인 → 닉네임 분기
// =============================================
async function initAuth() {
  await loadGoogleSDK();
  const sessionToken = localStorage.getItem("sessionToken");

  if (!sessionToken) {
    showLoginUI();
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/auth/check`, {
      headers: { "Authorization": `Bearer ${sessionToken}` },
    });
    const data = await res.json();

    if (data.valid && data.user) {
      const user = data.user;
      localStorage.setItem("userInfo", JSON.stringify(user));

      // nickname === null 이면 최초 방문자 → 닉네임 설정 모달
      if (!user.nickname) {
        const loginBtn = document.getElementById("login-btn");
        if (loginBtn) loginBtn.classList.add("hidden");
        showNicknameSetModal(user);
        return;
      }

      // 닉네임 있음 → 바로 게임 시작
      updateUserUI(user);
      isAdminCheck(user);
      await launchGame();
    } else {
      clearSession();
      showLoginUI();
    }
  } catch (err) {
    console.error("[인증] 서버 연결 실패:", err);
    showLoginUI();
  }
}

// =============================================
// signGoogle()
// =============================================
async function signGoogle() {
  if (typeof google === "undefined") {
    alert("구글 로그인 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
    return;
  }
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleCallback,
    auto_select: false,
    cancel_on_tap_outside: true,
  });
  google.accounts.id.prompt();
}
const signInWithGoogle = signGoogle;

// =============================================
// handleGoogleCallback(response)
// 목적: 구글 토큰 → 백엔드 검증 → 닉네임 분기
// ⚠️ 보안: 토큰 검증은 반드시 백엔드에서 수행
// =============================================
async function handleGoogleCallback(response) {
  const idToken = response.credential;
  try {
    const res = await fetch(`${API_BASE}/api/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    if (!res.ok) throw new Error("서버 인증 실패");

    const data = await res.json();
    const { sessionId, user } = data;

    localStorage.setItem("sessionToken", sessionId);
    localStorage.setItem("userInfo", JSON.stringify(user));

    // ★ 핵심: nickname === null 이면 최초 방문자 → 설정 모달
    if (!user.nickname) {
      const loginBtn = document.getElementById("login-btn");
      if (loginBtn) loginBtn.classList.add("hidden");
      showNicknameSetModal(user);
    } else {
      // 기존 유저 → 바로 게임 시작
      updateUserUI(user);
      isAdminCheck(user);
      await launchGame();
    }
  } catch (err) {
    console.error("[인증] 로그인 처리 실패:", err);
    alert("로그인에 실패했습니다. 다시 시도해주세요.");
  }
}

// =============================================
// showNicknameSetModal(user)
// 목적: 처음 방문자에게 닉네임 설정 모달 표시
// 특징: X 버튼 없음 (닉네임 입력 전까지 게임 불가)
// =============================================
function showNicknameSetModal(user) {
  const modal = document.getElementById("nickname-set-modal");
  if (!modal) return;

  // 구글 이름 힌트 표시
  const hintEl = document.getElementById("nickname-set-hint");
  if (hintEl) hintEl.textContent = user.name || "";

  const input = document.getElementById("nickname-set-input");
  if (input) { input.value = ""; setTimeout(() => input.focus(), 100); }

  setNicknameStatus("set", "", "");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
}

// =============================================
// submitNicknameSet()
// 목적: 최초 닉네임 설정 제출
// =============================================
async function submitNicknameSet() {
  const input = document.getElementById("nickname-set-input");
  const nickname = input?.value?.trim() || "";
  const sessionToken = localStorage.getItem("sessionToken");

  if (!nickname) {
    setNicknameStatus("set", "error", "별명을 입력해주세요.");
    return;
  }

  setModalLoading("set", true);

  try {
    const res = await fetch(`${API_BASE}/api/nickname/set`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ nickname }),
    });
    const data = await res.json();

    if (!res.ok) {
      setNicknameStatus("set", "error", data.error || "오류가 발생했습니다.");
      setModalLoading("set", false);
      return;
    }

    // 성공: localStorage 업데이트
    const userInfo = JSON.parse(localStorage.getItem("userInfo") || "{}");
    userInfo.nickname = data.nickname;
    userInfo.nickname_changed_at = Date.now();
    localStorage.setItem("userInfo", JSON.stringify(userInfo));

    closeModal("nickname-set-modal");
    updateUserUI(userInfo);
    isAdminCheck(userInfo);
    await launchGame();

  } catch (err) {
    console.error("[닉네임] 설정 실패:", err);
    setNicknameStatus("set", "error", "서버 오류가 발생했습니다. 다시 시도해주세요.");
    setModalLoading("set", false);
  }
}

// =============================================
// showProfileModal()
// 목적: 프로필 아바타 클릭 시 프로필 모달 표시
// 포함: 현재 닉네임 + 변경 폼 + 쿨다운 상태 + 로그아웃
// =============================================
function showProfileModal() {
  const modal = document.getElementById("profile-modal");
  if (!modal) return;

  const userInfo = JSON.parse(localStorage.getItem("userInfo") || "{}");

  // 현재 닉네임/프로필 표시
  const currentNicknameEl = document.getElementById("profile-current-nickname");
  if (currentNicknameEl) currentNicknameEl.textContent = userInfo.nickname || "-";

  const profileImg = document.getElementById("profile-modal-img");
  if (profileImg) profileImg.src = userInfo.picture || "assets/img/guest-avatar.png";

  const googleNameEl = document.getElementById("profile-google-name");
  if (googleNameEl) googleNameEl.textContent = userInfo.name || "";

  // 쿨다운 계산
  const changedAt = userInfo.nickname_changed_at;
  const COOLDOWN_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const changeInput = document.getElementById("nickname-change-input");
  const changeBtn = document.getElementById("nickname-change-btn");
  const cooldownEl = document.getElementById("nickname-cooldown-msg");

  if (changedAt && (now - changedAt) < COOLDOWN_MS) {
    // 쿨다운 중
    const remainingMs = COOLDOWN_MS - (now - changedAt);
    const rH = Math.floor(remainingMs / (60 * 60 * 1000));
    const rM = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
    if (changeInput) changeInput.disabled = true;
    if (changeBtn) changeBtn.disabled = true;
    if (cooldownEl) {
      cooldownEl.textContent = `${rH}시간 ${rM}분 후에 변경 가능합니다.`;
      cooldownEl.classList.remove("hidden");
    }
  } else {
    // 변경 가능
    if (changeInput) { changeInput.disabled = false; changeInput.value = ""; }
    if (changeBtn) changeBtn.disabled = false;
    if (cooldownEl) cooldownEl.classList.add("hidden");
  }

  setNicknameStatus("change", "", "");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
}

// =============================================
// submitNicknameChange()
// 목적: 닉네임 변경 제출 (24시간 쿨다운 서버에서도 검증)
// =============================================
async function submitNicknameChange() {
  const input = document.getElementById("nickname-change-input");
  const nickname = input?.value?.trim() || "";
  const sessionToken = localStorage.getItem("sessionToken");

  if (!nickname) {
    setNicknameStatus("change", "error", "새 별명을 입력해주세요.");
    return;
  }

  setModalLoading("change", true);

  try {
    const res = await fetch(`${API_BASE}/api/nickname/change`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ nickname }),
    });
    const data = await res.json();

    if (!res.ok) {
      if (data.code === "COOLDOWN") {
        setNicknameStatus("change", "error",
          `${data.remainingHours}시간 ${data.remainingMins}분 후에 변경 가능합니다.`
        );
      } else {
        setNicknameStatus("change", "error", data.error || "오류가 발생했습니다.");
      }
      setModalLoading("change", false);
      return;
    }

    // 성공
    const userInfo = JSON.parse(localStorage.getItem("userInfo") || "{}");
    userInfo.nickname = data.nickname;
    userInfo.nickname_changed_at = Date.now();
    localStorage.setItem("userInfo", JSON.stringify(userInfo));

    const nameEl = document.getElementById("user-name");
    if (nameEl) nameEl.textContent = data.nickname;

    setNicknameStatus("change", "success", `"${data.nickname}"으로 변경되었습니다. ✓`);
    setModalLoading("change", false);

    setTimeout(() => closeModal("profile-modal"), 2000);

  } catch (err) {
    console.error("[닉네임] 변경 실패:", err);
    setNicknameStatus("change", "error", "서버 오류가 발생했습니다.");
    setModalLoading("change", false);
  }
}

// =============================================
// checkNicknameDuplicate(type)
// 목적: 입력 중 실시간 중복 확인 (500ms debounce)
// =============================================
function checkNicknameDuplicate(type) {
  const inputId = type === "set" ? "nickname-set-input" : "nickname-change-input";
  const input = document.getElementById(inputId);
  if (!input) return;

  const nickname = input.value.trim();
  if (nickname.length < 2) { setNicknameStatus(type, "", ""); return; }

  clearTimeout(nicknameCheckTimer);
  setNicknameStatus(type, "loading", "확인 중...");

  nicknameCheckTimer = setTimeout(async () => {
    try {
      const res = await fetch(
        `${API_BASE}/api/nickname/check?nickname=${encodeURIComponent(nickname)}`
      );
      const data = await res.json();
      if (data.available) {
        setNicknameStatus(type, "success", "사용 가능한 별명입니다. ✓");
      } else {
        setNicknameStatus(type, "error", data.message || "이미 사용 중인 별명입니다.");
      }
    } catch { setNicknameStatus(type, "", ""); }
  }, 500);
}

// =============================================
// signOut()
// =============================================
async function signOut() {
  const sessionToken = localStorage.getItem("sessionToken");
  
  // 1. 타이머 중단
  if (typeof stopTimer === "function") await stopTimer();
  
  // 2. 서버에 로그아웃 알림
  if (sessionToken) {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${sessionToken}` },
      });
    } catch (e) {
      console.error("Logout API 에러:", e);
    }
  }

  // 3. 로컬 데이터 삭제 
  localStorage.removeItem("sessionToken");
  localStorage.removeItem("userInfo");
  localStorage.removeItem("accessToken");

  // 4. 관리자 버튼 즉시 숨기기 
  if (typeof updateAdminVisibility === "function") {
    updateAdminVisibility();
  }

  // 5. 페이지 새로고침하여 상태 초기화
  location.reload();
}
const sighOut = signOut;

// =============================================
// launchGame(): 타이머 + 채팅 시작
// =============================================
async function launchGame() {
  if (typeof startTimerService === "function") await startTimerService();
  if (typeof initChat === "function") await initChat();
  document.dispatchEvent(new CustomEvent("auth-success",
    { detail: JSON.parse(localStorage.getItem("userInfo") || "{}") }
  ));
}

// =============================================
// isAdminCheck(user)
// ⚠️ 보안: UI 표시용. 실제 API는 백엔드에서 role 재검증
// =============================================
function isAdminCheck(user) {
  const adminPanel = document.getElementById("admin-panel");
  const adminBtn = document.getElementById("admin-dashboard-btn");
  const isAdmin = user && user.role === "admin";
  adminPanel?.[isAdmin ? "classList" : "classList"][isAdmin ? "remove" : "add"]("hidden");
  adminBtn?.[isAdmin ? "classList" : "classList"][isAdmin ? "remove" : "add"]("hidden");
}

// =============================================
// getAdminPower()
// ⚠️ 보안: 프론트 role 체크는 UX용. 실제 보안은 Workers가 담당.
// =============================================
async function getAdminPower(action, payload = {}) {
  const sessionToken = localStorage.getItem("sessionToken");
  const userInfo = JSON.parse(localStorage.getItem("userInfo") || "{}");
  if (userInfo.role !== "admin") { alert("관리자 권한이 없습니다."); return; }
  const endpoints = { "force-stop": "/api/admin/force-stop", "midnight-reset": "/api/admin/midnight-reset" };
  const endpoint = endpoints[action];
  if (!endpoint) return;
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${sessionToken}` },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (err) { console.error("[관리자] API 호출 실패:", err); }
}

// =============================================
// updateUserUI(user): 헤더 UI 업데이트
// ※ 닉네임 우선, 없으면 구글 이름 fallback
// =============================================
function updateUserUI(user) {
  document.getElementById("login-btn")?.classList.add("hidden");
  document.getElementById("user-profile")?.classList.remove("hidden");

  const avatarImg = document.getElementById("user-avatar");
  if (avatarImg && user.picture) {
    avatarImg.src = user.picture;
    avatarImg.alt = `${user.nickname || user.name} 프로필`;
  }

  const nameEl = document.getElementById("user-name");
  // ★ 닉네임이 있으면 닉네임, 없으면 구글 이름
  if (nameEl) nameEl.textContent = user.nickname || user.name;

  const chatInput = document.getElementById("chat-input");
  const chatSendBtn = document.getElementById("chat-send-btn");
  if (chatInput) { chatInput.disabled = false; chatInput.placeholder = "메시지를 입력하세요..."; }
  if (chatSendBtn) chatSendBtn.disabled = false;
}

function showLoginUI() {
  document.getElementById("login-btn")?.classList.remove("hidden");
  document.getElementById("user-profile")?.classList.add("hidden");
  document.getElementById("admin-panel")?.classList.add("hidden");
  const chatInput = document.getElementById("chat-input");
  if (chatInput) { chatInput.disabled = true; chatInput.placeholder = "채팅하려면 로그인하세요"; }
}

// =============================================
// 유틸리티
// =============================================
function clearSession() {
  ["sessionToken", "userInfo", "tabId", "activeTabId"].forEach(k => localStorage.removeItem(k));
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) { modal.classList.add("hidden"); modal.classList.remove("flex"); }
}

// status: "error" | "success" | "loading" | ""
function setNicknameStatus(type, status, message) {
  const el = document.getElementById(`nickname-${type}-status`);
  if (!el) return;
  el.textContent = message;
  const colors = { error: "text-red-400", success: "text-green-400", loading: "text-slate-400", "": "text-transparent" };
  el.className = `text-xs mt-1 min-h-[16px] ${colors[status] || "text-transparent"}`;
}

function setModalLoading(type, isLoading) {
  const btn = document.getElementById(`nickname-${type}-btn`);
  if (!btn) return;
  btn.disabled = isLoading;
  btn.textContent = isLoading ? "저장 중..." : (type === "set" ? "시작하기" : "변경하기");
}

function loadGoogleSDK() {
  return new Promise((resolve) => {
    if (typeof google !== "undefined") { resolve(); return; }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true; script.defer = true; script.onload = resolve;
    document.head.appendChild(script);
  });
}

document.addEventListener("DOMContentLoaded", () => { initAuth(); });
