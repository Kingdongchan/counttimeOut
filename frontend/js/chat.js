// =============================================
// frontend/js/chat.js
// 역할: 실시간 채팅 WebSocket 관리, 메시지 렌더링, 스팸 차단
// 의존성: timer.js (getCurrentTotalMs), auth.js (유저 정보)
// =============================================

// =============================================
// 전역 상태
// =============================================
let socket = null;              // WebSocket 연결 객체
let lastSendTime = 0;           // 마지막 메시지 전송 시각 (스팸 방지)
let lastMessage = "";           // 마지막 전송 메시지 내용 (중복 방지)
const MAX_MESSAGES = 100;       // 채팅창 최대 메시지 개수 (메모리 관리)

// ⚠️ 필수 수정: wrangler deploy 후 실제 Workers URL로 교체
// WebSocket은 https → wss, http → ws로 프로토콜 변경
const WS_URL = "wss://killcount-backend.여기에_서브도메인.workers.dev/api/ws/chat";
const API_BASE = "https://killcount-backend.여기에_서브도메인.workers.dev";


// =============================================
// renderChat(messageData)
// 목적: 수신된 메시지를 채팅창에 HTML로 렌더링
// 아이콘: 10시간+ → 🔥, 어제 1위 → 🥇
// =============================================
function renderChat(messageData) {
  const chatContainer = document.getElementById("chat-messages");
  if (!chatContainer) return;

  const { nickname, message, liveTime, isYesterdayKing, created_at } = messageData;

  // 생존 시간으로 배지 결정
  const liveMs = parseLiveTimeToMs(liveTime);
  let badge = "";
  if (isYesterdayKing) {
    badge = '<span class="text-yellow-400 text-xs">🥇</span>';       // 어제 1위
  } else if (liveMs >= 10 * 60 * 60 * 1000) {
    badge = '<span class="text-xs">🔥</span>';                        // 10시간 이상 생존
  }

  // 메시지 시각 포맷 (HH:MM)
  const timeStr = created_at
    ? new Date(created_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
    : new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

  // 메시지 DOM 생성
  const msgEl = document.createElement("div");
  msgEl.className = "flex flex-col gap-1 animate-fade-in";
  msgEl.innerHTML = `
    <div class="flex items-center gap-2">
      <span class="text-xs font-bold text-primary">${escapeHtml(nickname)}</span>
      ${badge}
      <span class="text-[10px] text-slate-500">${timeStr}</span>
    </div>
    <p class="text-sm text-slate-300 glass border-none bg-white/5 py-2 px-3 rounded-lg rounded-tl-none inline-block max-w-[80%]">
      ${escapeHtml(message)}
    </p>
  `;

  chatContainer.appendChild(msgEl);

  // 메시지 개수 제한 (limitChat 로직)
  limitChat(chatContainer);

  // 자동 스크롤
  scrollConfirm(chatContainer, false);
}


// =============================================
// sendChat()
// 목적: 메시지 유효성 검사 후 서버 전송 및 화면 즉시 반영
// =============================================
async function sendChat() {
  const input = document.getElementById("chat-input");
  if (!input) return;

  const message = input.value.trim();
  const sessionToken = localStorage.getItem("sessionToken");
  const userInfo = JSON.parse(localStorage.getItem("userInfo") || "{}");

  // 로그인 확인
  if (!sessionToken) {
    showChatAlert("채팅을 이용하려면 로그인이 필요합니다.");
    return;
  }

  // 스팸 검사 (checkSpamChat이 false면 전송 차단)
  if (!checkSpamChat(message)) return;

  // 현재 생존 시간 가져오기 (timer.js의 함수 활용)
  const totalMs = typeof getCurrentTotalMs === "function" ? getCurrentTotalMs() : 0;
  const { h, m, s } = typeof transTime === "function"
    ? transTime(totalMs)
    : { h: "00", m: "00", s: "00" };
  const liveTime = `${h}:${m}:${s}`;

  // 입력창 즉시 비우기 (UX 개선)
  input.value = "";
  lastMessage = message;
  lastSendTime = Date.now();

  try {
    // 서버에 메시지 저장
    await fetch(`${API_BASE}/api/chat/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        message,
        liveTime,
        nickname: userInfo.name || "익명",
      }),
    });

    // WebSocket으로 실시간 브로드캐스트
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: "chat",
        nickname: userInfo.name || "익명",
        message,
        liveTime,
        created_at: new Date().toISOString(),
      }));
    }

    // 내 화면에도 즉시 렌더링 (자신의 메시지는 WebSocket echo 없이 직접 추가)
    renderChat({
      nickname: userInfo.name || "익명",
      message,
      liveTime,
      isYesterdayKing: userInfo.isYesterdayKing || false,
      created_at: new Date().toISOString(),
    });

    // 전송 후 강제 스크롤
    const chatContainer = document.getElementById("chat-messages");
    if (chatContainer) scrollConfirm(chatContainer, true);

  } catch (err) {
    console.error("[채팅] 전송 실패:", err);
    showChatAlert("메시지 전송에 실패했습니다. 다시 시도해주세요.");
  }
}


// =============================================
// scrollConfirm(container, force)
// 목적: 스크롤 위치 파악 후 조건부 자동 스크롤
// force: true면 강제 스크롤 (내가 전송했을 때)
// =============================================
function scrollConfirm(container, force = false) {
  if (!container) return;

  const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;

  if (force || isAtBottom) {
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
  }
}


// =============================================
// limitChat(container)
// 목적: 채팅 메시지 최대 100개 유지 (메모리 최적화)
// 선입선출: 가장 오래된 메시지부터 제거
// =============================================
function limitChat(container) {
  const messages = container.querySelectorAll(".flex.flex-col.gap-1");
  while (messages.length > MAX_MESSAGES) {
    messages[0].remove();
  }
}


// =============================================
// checkSpamChat(message)
// 목적: 도배·중복·길이 검사로 깨끗한 채팅 환경 유지
// 반환: true(통과) / false(차단)
// =============================================
function checkSpamChat(message) {
  const now = Date.now();

  // 1. 시간 검사: 2초 이내 연속 전송 차단
  if (now - lastSendTime < 2000) {
    showChatAlert("잠시 후 다시 시도해주세요. (2초 제한)");
    return false;
  }

  // 2. 중복 검사: 직전과 동일한 내용 차단
  if (message === lastMessage) {
    showChatAlert("동일한 메시지는 연속으로 보낼 수 없습니다.");
    return false;
  }

  // 3. 길이 검사: 2자 미만 또는 200자 초과 차단
  if (message.length < 2) {
    showChatAlert("메시지는 2자 이상 입력해주세요.");
    return false;
  }

  if (message.length > 200) {
    showChatAlert("메시지는 200자 이하로 입력해주세요.");
    return false;
  }

  return true; // 모든 검사 통과
}


// =============================================
// initChat()
// 목적: 페이지 로드 시 과거 메시지 로드 + WebSocket 연결
// =============================================
async function initChat() {
  const chatContainer = document.getElementById("chat-messages");
  const sendBtn = document.getElementById("chat-send-btn");
  const chatInput = document.getElementById("chat-input");

  if (!chatContainer) return;

  // 과거 메시지 30개 로드
  try {
    const res = await fetch(`${API_BASE}/api/chat/history`);
    const { messages } = await res.json();

    messages.forEach((msg) => renderChat(msg));

    // 로드 완료 후 최하단 스크롤
    scrollConfirm(chatContainer, true);

  } catch (err) {
    console.warn("[채팅] 이전 메시지 로드 실패:", err);
  }

  // WebSocket 연결
  connectWebSocket();

  // 이벤트 바인딩: 전송 버튼 클릭
  if (sendBtn) {
    sendBtn.addEventListener("click", sendChat);
  }

  // 이벤트 바인딩: Enter 키 전송
  if (chatInput) {
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendChat();
      }
    });
  }

  // 자정 리셋 이벤트 감지 (timer.js에서 발행)
  document.addEventListener("midnight-reset", () => {
    if (chatContainer) {
      chatContainer.innerHTML = "";
      // 자정 공지 메시지 추가
      const notice = document.createElement("div");
      notice.className = "text-center text-xs text-slate-500 py-4";
      notice.textContent = "🌅 새로운 하루의 생존 경쟁이 시작되었습니다!";
      chatContainer.appendChild(notice);
    }
  });
}


// =============================================
// connectWebSocket()
// 목적: 서버와 실시간 WebSocket 통로 개설 및 재연결 관리
// =============================================
function connectWebSocket() {
  // 기존 연결이 있으면 닫기
  if (socket) {
    socket.close();
  }

  try {
    socket = new WebSocket(WS_URL);

    socket.addEventListener("open", () => {
      console.log("[채팅] WebSocket 연결 성공");

      // 채팅창에 연결 상태 표시
      const statusEl = document.getElementById("chat-status");
      if (statusEl) {
        statusEl.textContent = "서버와 연결되었습니다";
        statusEl.className = "text-xs text-green-400";
        setTimeout(() => {
          statusEl.textContent = "";
        }, 3000);
      }
    });

    socket.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data);

        // 타입에 따른 처리
        if (data.type === "chat") {
          // 다른 유저의 메시지 렌더링 (내 메시지는 sendChat에서 직접 처리)
          const myNickname = JSON.parse(localStorage.getItem("userInfo") || "{}").name;
          if (data.nickname !== myNickname) {
            renderChat(data);
          }
        }
      } catch (err) {
        console.error("[채팅] 메시지 파싱 오류:", err);
      }
    });

    socket.addEventListener("close", () => {
      console.warn("[채팅] WebSocket 연결 끊김, 5초 후 재연결...");
      setTimeout(connectWebSocket, 5000); // 자동 재연결
    });

    socket.addEventListener("error", (err) => {
      console.error("[채팅] WebSocket 오류:", err);
    });

  } catch (err) {
    console.error("[채팅] WebSocket 초기화 실패:", err);
  }
}


// =============================================
// 유틸리티 함수들
// =============================================

// XSS 방지: 사용자 입력 이스케이프 (필수 보안 처리)
// ⚠️ 보안: 절대 innerHTML에 원본 사용자 텍스트를 직접 넣지 말 것!
function escapeHtml(text) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

// "HH:MM:SS" 형식 문자열 → 밀리초 변환 (배지 판별용)
function parseLiveTimeToMs(liveTime) {
  if (!liveTime) return 0;
  const parts = liveTime.split(":").map(Number);
  if (parts.length !== 3) return 0;
  const [h, m, s] = parts;
  return (h * 3600 + m * 60 + s) * 1000;
}

// 채팅 경고 메시지 표시 (alert 대신 인라인 메시지)
function showChatAlert(message) {
  const alertEl = document.getElementById("chat-alert");
  if (alertEl) {
    alertEl.textContent = message;
    alertEl.classList.remove("hidden");
    setTimeout(() => alertEl.classList.add("hidden"), 3000);
  } else {
    // fallback: alert 사용
    alert(message);
  }
}
