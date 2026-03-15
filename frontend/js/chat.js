// =============================================
// frontend/js/chat.js
// 역할: 실시간 채팅 관리 (Polling 방식), 메시지 렌더링, 스팸 차단
// 의존성: timer.js (getCurrentTotalMs), auth.js (유저 정보)
// =============================================

// =============================================
// 전역 상태
// =============================================
let lastSendTime = 0;           // 마지막 메시지 전송 시각 (스팸 방지)
let lastMessage = "";           // 마지막 전송 메시지 내용 (중복 방지)
const MAX_MESSAGES = 100;       // 채팅창 최대 메시지 개수
let lastChatHash = "";          // [추가] 마지막 채팅 목록 데이터 해시(비교용)

// =============================================
// renderChat(messageData)
// 목적: 수신된 메시지를 HTML 문자열로 생성 (DOM 생성 대신 문자열로 반환하여 성능 개선)
// =============================================
function createChatHtml(messageData) {
  const { nickname, message, liveTime, isYesterdayKing, created_at } = messageData;

  const liveMs = parseLiveTimeToMs(liveTime);
  let badge = "";
  if (isYesterdayKing) {
    badge = '<span class="text-yellow-400 text-xs">🥇</span>';
  } else if (liveMs >= 10 * 60 * 60 * 1000) {
    badge = '<span class="text-xs">🔥</span>';
  }

  const timeStr = created_at
    ? new Date(created_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
    : new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

  return `
    <div class="flex flex-col gap-1 animate-fade-in mb-3">
      <div class="flex items-center gap-2">
        <span class="text-xs font-bold text-primary">${escapeHtml(nickname)}</span>
        ${badge}
        <span class="text-[10px] text-slate-500">${timeStr}</span>
      </div>
      <p class="text-sm text-slate-300 glass border-none bg-white/5 py-2 px-3 rounded-lg rounded-tl-none inline-block max-w-[80%]">
        ${escapeHtml(message)}
      </p>
    </div>
  `;
}

// =============================================
// sendChat()
// 목적: 메시지 전송 및 화면 즉시 반영
// =============================================
async function sendChat() {
  const input = document.getElementById("chat-input");
  if (!input) return;

  const message = input.value.trim();
  const sessionToken = localStorage.getItem("sessionToken");
  const userInfo = JSON.parse(localStorage.getItem("userInfo") || "{}");

  if (!message) return;
  if (!sessionToken) {
    showChatAlert("채팅을 이용하려면 로그인이 필요합니다.");
    return;
  }

  if (!checkSpamChat(message)) return;

  const totalMs = typeof getCurrentTotalMs === "function" ? getCurrentTotalMs() : 0;
  const { h, m, s } = typeof transTime === "function" ? transTime(totalMs) : { h: "00", m: "00", s: "00" };
  const liveTime = `${h}:${m}:${s}`;

  input.value = "";
  lastMessage = message;
  lastSendTime = Date.now();

  try {
    await fetch(`${API_BASE}/api/chat/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        message,
        liveTime,
        nickname: userInfo.nickname || "익명",
      }),
    });

    // 전송 후 즉시 목록 새로고침
    await fetchChatHistory();
  } catch (err) {
    console.error("[채팅] 전송 실패:", err);
    showChatAlert("메시지 전송에 실패했습니다.");
  }
}

// =============================================
// fetchChatHistory()
// 목적: 서버에서 채팅 기록 가져오기 (비교 후 바뀐 경우만 렌더링)
// =============================================
async function fetchChatHistory() {
  const chatContainer = document.getElementById("chat-messages");
  if (!chatContainer) return;

  try {
    const res = await fetch(`${API_BASE}/api/chat/history`);
    if (!res.ok) return;

    const { messages } = await res.json();
    
    // [중요] 데이터가 이전과 완전히 똑같으면 아무 작업도 하지 않음 (깜빡임 방지 핵심)
    const currentHash = JSON.stringify(messages);
    if (lastChatHash === currentHash) return;
    lastChatHash = currentHash;

    // 현재 스크롤이 바닥인지 확인
    const isAtBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 100;

    // 한 번에 HTML 조립해서 갈아끼우기
    const fullHtml = messages.map(msg => createChatHtml(msg)).join('');
    chatContainer.innerHTML = fullHtml;

    if (isAtBottom) {
      scrollConfirm(chatContainer, true);
    }
  } catch (err) {
    console.warn("[채팅] 기록 로드 실패:", err);
  }
}

// =============================================
// initChat()
// 목적: 초기화 및 이벤트 바인딩
// =============================================
function initChat() {
  const sendBtn = document.getElementById("chat-send-btn");
  const chatInput = document.getElementById("chat-input");

  if (sendBtn) {
    sendBtn.addEventListener("click", sendChat);
  }

  if (chatInput) {
    chatInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") sendChat();
    });
  }

  fetchChatHistory();
  setInterval(fetchChatHistory, 3000); // 3초마다 폴링

  document.addEventListener("midnight-reset", () => {
    const chatContainer = document.getElementById("chat-messages");
    if (chatContainer) {
      chatContainer.innerHTML = '<div class="text-center text-xs text-slate-500 py-4">🌅 새로운 하루가 시작되었습니다!</div>';
      lastChatHash = ""; // 해시 초기화
    }
  });
}

// =============================================
// 유틸리티 및 보조 함수들
// =============================================
function scrollConfirm(container, force = false) {
  if (!container) return;
  if (force) {
    container.scrollTop = container.scrollHeight;
  }
}

// 렌더링 방식 변경으로 limitChat은 fetch 시점에서 처리됨

function checkSpamChat(message) {
  const now = Date.now();
  if (now - lastSendTime < 2000) {
    showChatAlert("2초 후에 다시 보내주세요.");
    return false;
  }
  if (message === lastMessage) {
    showChatAlert("중복된 메시지입니다.");
    return false;
  }
  if (message.length < 1 || message.length > 200) {
    showChatAlert("1자 이상 200자 이하로 입력해주세요.");
    return false;
  }
  return true;
}

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

function parseLiveTimeToMs(liveTime) {
  if (!liveTime) return 0;
  const parts = liveTime.split(":").map(Number);
  return parts.length === 3 ? (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000 : 0;
}

function showChatAlert(message) {
  const alertEl = document.getElementById("chat-alert");
  if (alertEl) {
    alertEl.textContent = message;
    alertEl.classList.remove("hidden");
    setTimeout(() => alertEl.classList.add("hidden"), 3000);
  } else {
    alert(message);
  }
}

// 초기화 실행
document.addEventListener("DOMContentLoaded", initChat);