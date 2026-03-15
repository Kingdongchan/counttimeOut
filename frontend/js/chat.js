// =============================================
// frontend/js/chat.js
// 역할: 실시간 채팅 관리 (Polling 방식), 메시지 렌더링, 스팸 차단
// =============================================

let lastSendTime = 0;           
let lastMessage = "";           
const MAX_MESSAGES = 100;       
let lastChatHash = "";          

// [메시지 HTML 생성]
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

// [메시지 전송]
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

    await fetchChatHistory();
  } catch (err) {
    console.error("[채팅] 전송 실패:", err);
    showChatAlert("메시지 전송에 실패했습니다.");
  }
}

// [채팅 기록 로드 - 순서 교정 포함]
async function fetchChatHistory() {
  const chatContainer = document.getElementById("chat-messages");
  if (!chatContainer) return;

  try {
    const res = await fetch(`${API_BASE}/api/chat/history`);
    if (!res.ok) return;

    const { messages } = await res.json();
    
    const currentHash = JSON.stringify(messages);
    if (lastChatHash === currentHash) return;
    lastChatHash = currentHash;

    // 현재 스크롤이 바닥 근처인지 확인
    const isAtBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 150;

    // [핵심 수정] 서버에서 온 최신순 배열을 뒤집어서 옛날 메시지가 위로 가게 함
    const sortedMessages = [...messages].reverse(); 
    const fullHtml = sortedMessages.map(msg => createChatHtml(msg)).join('');
    
    chatContainer.innerHTML = fullHtml;

    // 새 메시지가 왔을 때 바닥에 있었다면 스크롤 유지
    if (isAtBottom) {
      scrollConfirm(chatContainer, true);
    }
  } catch (err) {
    console.warn("[채팅] 기록 로드 실패:", err);
  }
}

// [초기화]
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
  setInterval(fetchChatHistory, 3000);

  document.addEventListener("midnight-reset", () => {
    const chatContainer = document.getElementById("chat-messages");
    if (chatContainer) {
      chatContainer.innerHTML = '<div class="text-center text-xs text-slate-500 py-4">🌅 새로운 하루가 시작되었습니다!</div>';
      lastChatHash = "";
    }
  });
}

// [유틸리티]
function scrollConfirm(container, force = false) {
  if (!container) return;
  if (force) {
    container.scrollTop = container.scrollHeight;
  }
}

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

document.addEventListener("DOMContentLoaded", initChat);