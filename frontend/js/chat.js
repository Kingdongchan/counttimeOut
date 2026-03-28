/**
 * frontend/js/chat.js
 * 역할:
 * 1. 실시간 채팅 송수신
 * 2. 닉네임 옆 배지(🥇🥈🥉🔥👑) 표시
 * 3. 채팅에 프로필 사진 표시
 */

let lastSendTime = 0;
let lastMessage = "";
let lastRenderedChatId = 0;
let chatInterval = null;
let isFetchingChat = false;
const CHAT_POLL_INTERVAL_MS = 4000;
const DEFAULT_AVATAR = "https://ui-avatars.com/api/?name=User&background=0f172a&color=f8fafc";

function createChatHtml(messageData) {
  const { id, nickname, message, created_at, picture, badges = [] } = messageData;
  const timeStr = formatChatTime(created_at);
  const badgeHtml = badges.map((badge) => {
    const titleMap = {
      "🛠️": "관리자",
      "🥇": "금일 1등",
      "🥈": "금일 2등",
      "🥉": "금일 3등",
      "🔥": "10시간 돌파",
      "👑": "역대 1위",
    };

    return `<span class="text-sm leading-none" title="${titleMap[badge] || "배지"}">${badge}</span>`;
  }).join("");

  return `
    <div class="flex gap-3 animate-fade-in mb-4" data-chat-id="${Number(id) || 0}">
      <div class="shrink-0">
        <img
          src="${escapeHtml(picture || DEFAULT_AVATAR)}"
          alt="${escapeHtml(nickname || "프로필")}"
          class="w-10 h-10 rounded-full object-cover border border-white/10 bg-slate-800"
          onerror="this.onerror=null;this.src='${DEFAULT_AVATAR}'"
        />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-[12px] font-bold text-blue-300">${escapeHtml(nickname)}</span>
          ${badgeHtml ? `<span class="flex items-center gap-1">${badgeHtml}</span>` : ""}
          <span class="text-[10px] text-slate-500 font-medium">${timeStr}</span>
        </div>
        <div class="mt-1 relative inline-block max-w-[90%]">
          <p class="text-sm text-slate-100 bg-white/10 backdrop-blur-md py-2 px-3 rounded-2xl rounded-tl-none border border-white/5 shadow-sm break-words">
            ${escapeHtml(message)}
          </p>
        </div>
      </div>
    </div>
  `;
}

async function sendChat() {
  const input = document.getElementById("chat-input");
  if (!input) return;

  const message = input.value.trim();
  const sessionToken = localStorage.getItem("sessionToken");
  if (!message) return;

  if (!sessionToken) {
    showChatAlert("로그인이 필요한 서비스입니다.");
    return;
  }

  if (!checkSpamChat(message)) return;

  const totalMs = typeof getCurrentTotalMs === "function" ? getCurrentTotalMs() : 0;
  const { h, m, s } = typeof transTime === "function" ? transTime(totalMs) : { h: "00", m: "00", s: "00" };
  const liveTimeStr = `${h}:${m}:${s}`;

  input.value = "";
  lastMessage = message;
  lastSendTime = Date.now();

  try {
    const res = await fetch(`${API_BASE}/api/chat/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        message,
        liveTime: liveTimeStr,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showChatAlert(data.error || "채팅 전송에 실패했습니다.");
      return;
    }

    await fetchChatHistory();
  } catch (err) {
    console.error("[채팅] 전송 실패:", err);
    showChatAlert("서버 연결에 실패했습니다.");
  }
}

function isChatNearBottom(chatContainer) {
  return chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 100;
}

function updateLastRenderedChatId(messages) {
  if (!Array.isArray(messages) || !messages.length) return;
  const latestId = Number(messages[messages.length - 1]?.id || 0);
  if (latestId > lastRenderedChatId) {
    lastRenderedChatId = latestId;
  }
}

function renderInitialChat(messages, chatContainer) {
  if (!Array.isArray(messages) || !messages.length) {
    chatContainer.innerHTML = "";
    lastRenderedChatId = 0;
    return;
  }

  chatContainer.innerHTML = messages.map((msg) => createChatHtml(msg)).join("");
  updateLastRenderedChatId(messages);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function appendNewMessages(messages, chatContainer, shouldStickToBottom) {
  if (!Array.isArray(messages) || !messages.length) return;

  const nextMessages = messages.filter((msg) => Number(msg?.id || 0) > lastRenderedChatId);
  if (!nextMessages.length) return;

  chatContainer.insertAdjacentHTML("beforeend", nextMessages.map((msg) => createChatHtml(msg)).join(""));
  updateLastRenderedChatId(nextMessages);

  if (shouldStickToBottom || nextMessages.length <= 2) {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
}

async function fetchChatHistory(forceInitialLoad = false) {
  const chatContainer = document.getElementById("chat-messages");
  if (!chatContainer || isFetchingChat) return;

  isFetchingChat = true;

  try {
    const shouldLoadFullHistory = forceInitialLoad || lastRenderedChatId === 0;
    const requestUrl = shouldLoadFullHistory
      ? `${API_BASE}/api/chat/history`
      : `${API_BASE}/api/chat/history?since=${lastRenderedChatId}`;
    const res = await fetch(requestUrl);
    if (!res.ok) throw new Error("데이터를 가져올 수 없습니다.");

    const data = await res.json();
    const messages = data.messages || [];

    if (shouldLoadFullHistory) {
      renderInitialChat(messages, chatContainer);
      return;
    }

    appendNewMessages(messages, chatContainer, isChatNearBottom(chatContainer));
  } catch (err) {
    console.warn("[채팅] 기록 로드 중 오류:", err);
  } finally {
    isFetchingChat = false;
  }
}

function initChat() {
  const sendBtn = document.getElementById("chat-send-btn");
  const chatInput = document.getElementById("chat-input");

  if (sendBtn) sendBtn.onclick = sendChat;
  if (chatInput) {
    chatInput.onkeypress = (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendChat();
      }
    };
  }

  if (chatInterval) clearInterval(chatInterval);

  fetchChatHistory(true);
  chatInterval = setInterval(fetchChatHistory, CHAT_POLL_INTERVAL_MS);

  if (!window.isMidnightEventRegistered) {
    document.addEventListener("midnight-reset", () => {
      const chatContainer = document.getElementById("chat-messages");
      if (chatContainer) {
        chatContainer.innerHTML = '<div class="text-center text-[10px] text-slate-500 py-6 italic opacity-50">🌅 새로운 하루가 시작되었습니다.</div>';
        lastRenderedChatId = 0;
      }
    });

    window.isMidnightEventRegistered = true;
  }
}

function checkSpamChat(message) {
  const now = Date.now();

  if (now - lastSendTime < 1500) {
    showChatAlert("메시지를 너무 빨리 보낼 수 없습니다.");
    return false;
  }

  if (message === lastMessage && (now - lastSendTime < 10000)) {
    showChatAlert("중복된 메시지입니다.");
    return false;
  }

  if (message.length > 150) {
    showChatAlert("글자 수를 줄여주세요. (최대 150자)");
    return false;
  }

  return true;
}

function formatChatTime(createdAt) {
  try {
    if (!createdAt) throw new Error("createdAt 없음");

    const normalized = createdAt.includes("T")
      ? createdAt
      : createdAt.replace(" ", "T") + "Z";

    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) throw new Error("시간 파싱 실패");

    return date.toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch (_err) {
    return new Date().toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  }
}

function escapeHtml(text) {
  if (!text) return "";
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" };
  return String(text).replace(/[&<>"']/g, (character) => map[character]);
}

function showChatAlert(message) {
  const alertEl = document.getElementById("chat-alert");
  if (!alertEl) {
    window.alert(message);
    return;
  }

  alertEl.textContent = message;
  alertEl.classList.remove("hidden");

  clearTimeout(showChatAlert.timeoutId);
  showChatAlert.timeoutId = setTimeout(() => {
    alertEl.classList.add("hidden");
  }, 2500);
}

showChatAlert.timeoutId = null;
