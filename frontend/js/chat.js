/**
 * chat.js 
 * - 기능: 실시간 채팅 수신/발신, 도배 방지, 시간 표시 최적화
 * - 특이사항: DB의 UTC timestamp를 한국 시간(KST)으로 변환하여 항상 노출
 */

let lastSendTime = 0;           // 마지막 전송 시간 (도배 방지용)
let lastMessage = "";           // 마지막 전송 메시지 (중복 방지용)
const MAX_MESSAGES = 50;        // 화면에 표시할 최대 메시지 수
let lastChatHash = "";          // 이전 데이터와 비교하여 깜빡임 방지 (UX 개선)
let chatInterval = null;        // 폴링 인터벌 관리 변수
let isFetchingChat = false;     // 데이터 중복 호출 방지 플래그

// [1. 메시지 HTML 생성 함수]
function createChatHtml(messageData) {
  const { nickname, message, liveTime, isYesterdayKing, created_at } = messageData;
  
  // 생존 시간에 따른 배지 결정
  const liveMs = parseLiveTimeToMs(liveTime);
  let badge = "";
  if (isYesterdayKing) {
    badge = '<span class="text-yellow-400 text-xs" title="어제의 왕">🥇</span>';
  } else if (liveMs >= 10 * 60 * 60 * 1000) { 
    badge = '<span class="text-xs" title="10시간 돌파">🔥</span>';
  }

  // [시간 파싱 로직 강화: 한국 시간(KST) 적용 및 상시 노출] 
  let timeStr = "";
  try {
    if (created_at) {
      // 1. DB 문자열 "2026-03-18 12:00:00" -> ISO "2026-03-18T12:00:00Z" 변환 (UTC 명시)
      const dateStr = created_at.includes("T") ? created_at : created_at.replace(" ", "T") + "Z";
      const dateObj = new Date(dateStr);
      
      if (!isNaN(dateObj)) {
        // 2. 브라우저 설정을 따라 한국 시간으로 변환 (오전/오후 포함)
        timeStr = dateObj.toLocaleTimeString("ko-KR", { 
          hour: "2-digit", 
          minute: "2-digit",
          hour12: true 
        });
      }
    }
  } catch (e) {
    console.error("시간 변환 오류:", e);
  }

  // 시간이 없거나 오류 시 현재 시간으로 대체
  if (!timeStr) {
    timeStr = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: true });
  }

  return `
    <div class="flex flex-col gap-1 animate-fade-in mb-4 group">
      <div class="flex items-center gap-2">
        <span class="text-[11px] font-bold text-blue-400">${escapeHtml(nickname)}</span>
        ${badge}
        <span class="text-[10px] text-slate-500 font-medium">${timeStr}</span>
      </div>
      <div class="relative inline-block max-w-[85%]">
        <p class="text-sm text-slate-200 bg-white/10 backdrop-blur-md py-2 px-3 rounded-2xl rounded-tl-none border border-white/5 shadow-sm">
          ${escapeHtml(message)}
        </p>
        ${liveTime ? `<span class="absolute -right-12 bottom-1 text-[9px] text-orange-500/80 font-mono font-bold">${liveTime}</span>` : ''}
      </div>
    </div>
  `;
}

// [2. 메시지 전송 함수]
async function sendChat() {
  const input = document.getElementById("chat-input");
  if (!input) return;

  const message = input.value.trim();
  const sessionToken = localStorage.getItem("sessionToken");
  const userInfo = JSON.parse(localStorage.getItem("userInfo") || "{}");

  if (!message) return;
  if (!sessionToken) {
    showChatAlert("로그인이 필요한 서비스입니다.");
    return;
  }

  // 도배 방지 체크
  if (!checkSpamChat(message)) return;

  // 메인 타이머에서 현재 생존 시간 가져오기
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
        nickname: userInfo.nickname || userInfo.name || "익명",
      }),
    });

    if (res.ok) {
      await fetchChatHistory(); // 전송 즉시 갱신
    }
  } catch (err) {
    console.error("[채팅] 전송 실패:", err);
    showChatAlert("서버 연결에 실패했습니다.");
  }
}

// [3. 채팅 기록 로드 및 화면 갱신]
async function fetchChatHistory() {
  const chatContainer = document.getElementById("chat-messages");
  if (!chatContainer || isFetchingChat) return; 

  isFetchingChat = true;

  try {
    const res = await fetch(`${API_BASE}/api/chat/history`);
    if (!res.ok) throw new Error("데이터를 가져올 수 없습니다.");

    const data = await res.json();
    const messages = data.messages || [];
    
    // [중요] 데이터가 이전과 동일하면 DOM 업데이트를 건너뜀 (깜빡임 방지)
    const currentHash = JSON.stringify(messages);
    if (lastChatHash === currentHash) return;
    lastChatHash = currentHash;

    // 현재 스크롤 위치 확인
    const isAtBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 100;

    // HTML 생성
    const fullHtml = messages.map(msg => createChatHtml(msg)).join('');
    chatContainer.innerHTML = fullHtml;

    // 바닥 근처였을 때만 자동 스크롤 하단 이동
    if (isAtBottom || chatContainer.innerHTML.length < 500) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  } catch (err) {
    console.warn("[채팅] 기록 로드 중 오류:", err);
  } finally {
    isFetchingChat = false; 
  }
}

// [4. 채팅 초기화 및 이벤트 바인딩]
function initChat() {
  const sendBtn = document.getElementById("chat-send-btn");
  const chatInput = document.getElementById("chat-input");

  if (sendBtn) sendBtn.onclick = sendChat;
  if (chatInput) {
    chatInput.onkeypress = (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendChat();
      }
    };
  }

  // 중복 인터벌 방지
  if (chatInterval) clearInterval(chatInterval);

  fetchChatHistory(); 
  chatInterval = setInterval(fetchChatHistory, 4000); // 4초 주기 갱신

  // 자정 리셋 시 채팅창 비우기
  if (!window.isMidnightEventRegistered) {
      document.addEventListener("midnight-reset", () => {
        const chatContainer = document.getElementById("chat-messages");
        if (chatContainer) {
          chatContainer.innerHTML = '<div class="text-center text-[10px] text-slate-500 py-6 italic opacity-50">🌅 새로운 하루가 시작되었습니다.</div>';
          lastChatHash = ""; 
        }
      });
      window.isMidnightEventRegistered = true;
  }
}

// [5. 유틸리티 함수]
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

function escapeHtml(text) {
  if (!text) return "";
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}

function parseLiveTimeToMs(liveTime) {
  if (!liveTime || typeof liveTime !== 'string') return 0;
  const parts = liveTime.split(":").map(Number);
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  return 0;
}

function showChatAlert(message) {
  const alertEl = document.getElementById("chat-alert");
  if (alertEl) {
    alertEl.textContent = message;
    alertEl.classList.remove("hidden");
    setTimeout(() => alertEl.classList.add("hidden"), 2500);
  } else {
    console.log("Chat Alert:", message);
  }
}

// 초기화 실행
document.addEventListener("DOMContentLoaded", initChat);