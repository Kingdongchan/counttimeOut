// =============================================
// backend/src/index.ts
// Cloudflare Workers 메인 서버
// 역할: REST API + Durable Objects 라우팅
// ⚠️ 중요: 모든 민감한 검증은 여기서 이중으로 처리 (프론트 믿지 말 것!)
// =============================================

// --- 타입 정의 ---
interface Env {
  DB: D1Database;
  R2: R2Bucket;
  CHAT_ROOM: DurableObjectNamespace;
  TIMER_SYNC: DurableObjectNamespace;
  ADMIN_EMAIL: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
}

// =============================================
// 메인 Workers 핸들러
// =============================================
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS 헤더 (프론트엔드 도메인으로 교체 필요)
    // ⚠️ 필수 수정: 배포 후 실제 Pages 도메인으로 변경
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*", // 배포 시 "https://countTimeout.pages.dev"로 변경
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    // OPTIONS preflight 처리
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // --- API 라우팅 ---

      // [시간 동기화] 서버 정확 시간 반환 (타이머 오차 보정용)
      if (path === "/api/time" && request.method === "GET") {
        return jsonResponse({ serverTime: Date.now() }, corsHeaders);
      }

      // [구글 로그인] 토큰 검증 및 유저 등록/갱신
      if (path === "/api/auth/google" && request.method === "POST") {
        return await handleGoogleAuth(request, env, corsHeaders);
      }

      // [세션 확인] 자동 로그인 토큰 유효성 검증
      if (path === "/api/auth/check" && request.method === "GET") {
        return await handleAuthCheck(request, env, corsHeaders);
      }

      // [로그아웃] 세션 삭제
      if (path === "/api/auth/logout" && request.method === "POST") {
        return await handleLogout(request, env, corsHeaders);
      }

      // [닉네임] 최초 설정 (처음 방문자 - 24시간 제한 없음)
      if (path === "/api/nickname/set" && request.method === "POST") {
        return await handleNicknameSet(request, env, corsHeaders);
      }

      // [닉네임] 변경 (24시간 쿨다운 적용)
      if (path === "/api/nickname/change" && request.method === "POST") {
        return await handleNicknameChange(request, env, corsHeaders);
      }

      // [닉네임] 중복 확인 (닉네임 입력 중 실시간 체크)
      if (path === "/api/nickname/check" && request.method === "GET") {
        return await handleNicknameCheck(request, env, corsHeaders);
      }

      // [타이머] 오늘 누적 기록 조회
      if (path === "/api/timer/get" && request.method === "GET") {
        return await handleGetTimer(request, env, corsHeaders);
      }

      // [타이머] 생존 시간 업데이트
      if (path === "/api/timer/update" && request.method === "POST") {
        return await handleUpdateTimer(request, env, corsHeaders);
      }

      // [리더보드] 실시간 순위 조회
      if (path === "/api/leaderboard" && request.method === "GET") {
        return await handleLeaderboard(request, env, corsHeaders);
      }

      // [채팅] 메시지 전송
      if (path === "/api/chat/send" && request.method === "POST") {
        return await handleSendChat(request, env, corsHeaders);
      }

      // [채팅] 최근 메시지 로드
      if (path === "/api/chat/history" && request.method === "GET") {
        return await handleChatHistory(request, env, corsHeaders);
      }

      // [WebSocket] 실시간 채팅 연결 (Durable Objects)
      if (path === "/api/ws/chat") {
        return await handleWebSocket(request, env, corsHeaders);
      }

      // [자정 리셋] 일일 기록 이동 (Cron 또는 관리자 호출)
      if (path === "/api/admin/midnight-reset" && request.method === "POST") {
        return await handleMidnightReset(request, env, corsHeaders);
      }

      // [관리자] 유저 타이머 강제 종료
      if (path === "/api/admin/force-stop" && request.method === "POST") {
        return await handleAdminForceStop(request, env, corsHeaders);
      }

      return jsonResponse({ error: "존재하지 않는 경로입니다" }, corsHeaders, 404);

    } catch (err) {
      console.error("서버 오류:", err);
      return jsonResponse({ error: "서버 내부 오류" }, corsHeaders, 500);
    }
  },

  // Cron 트리거: 매일 자정 자동 리셋
  // ⚠️ wrangler.toml에 [triggers] crons = ["0 0 * * *"] 추가 필요
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    await midnightReset(env);
  },
};


// =============================================
// [구글 OAuth] 토큰 검증 및 유저 처리
// =============================================
async function handleGoogleAuth(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const { idToken } = await request.json() as { idToken: string };

  if (!idToken) {
    return jsonResponse({ error: "토큰이 없습니다" }, corsHeaders, 400);
  }

  // ⚠️ 보안: 구글 서버에서 직접 토큰 검증 (프론트 데이터 절대 믿지 말 것!)
  const googleResponse = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`
  );

  if (!googleResponse.ok) {
    return jsonResponse({ error: "유효하지 않은 구글 토큰" }, corsHeaders, 401);
  }

  const googleUser = await googleResponse.json() as {
    sub: string; email: string; name: string; picture: string;
  };

  // 관리자 여부 판별 (이메일 비교)
  // ⚠️ 보안: 이 검증은 반드시 백엔드에서만 수행. 프론트 role 값 믿지 말 것!
  const role = googleUser.email === env.ADMIN_EMAIL ? "admin" : "user";

  // DB에 유저 등록 또는 갱신 (UPSERT)
  await env.DB.prepare(`
    INSERT INTO users (id, email, name, picture, role)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      picture = excluded.picture
  `).bind(googleUser.sub, googleUser.email, googleUser.name, googleUser.picture, role).run();

  // 세션 토큰 생성 및 저장
  const sessionId = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO sessions (session_id, user_id) VALUES (?, ?)
  `).bind(sessionId, googleUser.sub).run();

  // daily_record 초기화 (신규 유저 오늘 기록 없으면 생성)
  await env.DB.prepare(`
    INSERT OR IGNORE INTO daily_record (user_id, nickname)
    VALUES (?, ?)
  `).bind(googleUser.sub, googleUser.name).run();

  return jsonResponse({
    sessionId,
    user: {
      id: googleUser.sub,
      name: googleUser.name,
      picture: googleUser.picture,
      email: googleUser.email,
      role,
    }
  }, corsHeaders);
}


// =============================================
// [세션 확인] 자동 로그인 처리
// =============================================
async function handleAuthCheck(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const sessionId = request.headers.get("Authorization")?.replace("Bearer ", "");

  if (!sessionId) {
    return jsonResponse({ valid: false }, corsHeaders, 401);
  }

  const result = await env.DB.prepare(`
    SELECT s.user_id, u.name, u.nickname, u.picture, u.email, u.role, u.nickname_changed_at
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.session_id = ?
  `).bind(sessionId).first() as any;

  if (!result) {
    return jsonResponse({ valid: false }, corsHeaders, 401);
  }

  return jsonResponse({ valid: true, user: result }, corsHeaders);
}


// =============================================
// [로그아웃] 세션 삭제
// =============================================
async function handleLogout(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const sessionId = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (sessionId) {
    await env.DB.prepare("DELETE FROM sessions WHERE session_id = ?").bind(sessionId).run();
  }
  return jsonResponse({ success: true }, corsHeaders);
}


// =============================================
// [닉네임] 최초 설정
// 목적: 처음 방문한 유저의 닉네임을 최초로 등록
// 규칙: 최초 설정은 24시간 제한 없음. nickname이 null인 경우에만 허용.
// =============================================
async function handleNicknameSet(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const userId = await getAuthUserId(request, env);
  if (!userId) return jsonResponse({ error: "인증 필요" }, corsHeaders, 401);

  const { nickname } = await request.json() as { nickname: string };

  // 닉네임 유효성 검사
  const validation = validateNickname(nickname);
  if (!validation.valid) {
    return jsonResponse({ error: validation.message }, corsHeaders, 400);
  }

  // 이미 닉네임이 설정된 유저는 이 API 사용 불가 (변경은 /change 사용)
  const user = await env.DB.prepare(
    "SELECT nickname FROM users WHERE id = ?"
  ).bind(userId).first() as any;

  if (user?.nickname !== null && user?.nickname !== undefined) {
    return jsonResponse({ error: "이미 닉네임이 설정되어 있습니다. 변경은 별도 API를 이용하세요." }, corsHeaders, 409);
  }

  // 닉네임 중복 확인
  const duplicate = await env.DB.prepare(
    "SELECT id FROM users WHERE nickname = ? AND id != ?"
  ).bind(nickname.trim(), userId).first();

  if (duplicate) {
    return jsonResponse({ error: "이미 사용 중인 별명입니다.", code: "DUPLICATE" }, corsHeaders, 409);
  }

  // 닉네임 저장 (최초 설정은 nickname_changed_at을 현재 시각으로)
  await env.DB.prepare(`
    UPDATE users SET nickname = ?, nickname_changed_at = ? WHERE id = ?
  `).bind(nickname.trim(), Date.now(), userId).run();

  // daily_record의 nickname도 동기화
  await env.DB.prepare(`
    INSERT INTO daily_record (user_id, nickname)
    VALUES (?, ?)
    ON CONFLICT (user_id) DO UPDATE SET nickname = excluded.nickname
  `).bind(userId, nickname.trim()).run();

  return jsonResponse({ success: true, nickname: nickname.trim() }, corsHeaders);
}


// =============================================
// [닉네임] 변경 (24시간 쿨다운)
// 목적: 기존 닉네임을 새 닉네임으로 변경
// 규칙: 마지막 변경 후 24시간(86400000ms) 이후에만 가능
// =============================================
async function handleNicknameChange(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const userId = await getAuthUserId(request, env);
  if (!userId) return jsonResponse({ error: "인증 필요" }, corsHeaders, 401);

  const { nickname } = await request.json() as { nickname: string };

  // 닉네임 유효성 검사
  const validation = validateNickname(nickname);
  if (!validation.valid) {
    return jsonResponse({ error: validation.message }, corsHeaders, 400);
  }

  // 현재 유저 정보 조회
  const user = await env.DB.prepare(
    "SELECT nickname, nickname_changed_at FROM users WHERE id = ?"
  ).bind(userId).first() as any;

  // 24시간 쿨다운 체크
  const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24시간
  const now = Date.now();

  if (user?.nickname_changed_at) {
    const elapsed = now - user.nickname_changed_at;
    if (elapsed < COOLDOWN_MS) {
      const remainingMs = COOLDOWN_MS - elapsed;
      const remainingHours = Math.floor(remainingMs / (60 * 60 * 1000));
      const remainingMins = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
      return jsonResponse({
        error: `별명은 24시간에 한 번만 변경할 수 있습니다.`,
        code: "COOLDOWN",
        remainingMs,
        remainingHours,
        remainingMins,
      }, corsHeaders, 429);
    }
  }

  // 닉네임 중복 확인 (자기 자신 제외)
  const duplicate = await env.DB.prepare(
    "SELECT id FROM users WHERE nickname = ? AND id != ?"
  ).bind(nickname.trim(), userId).first();

  if (duplicate) {
    return jsonResponse({ error: "이미 사용 중인 별명입니다.", code: "DUPLICATE" }, corsHeaders, 409);
  }

  // 닉네임 변경 및 변경 시각 기록
  await env.DB.prepare(`
    UPDATE users SET nickname = ?, nickname_changed_at = ? WHERE id = ?
  `).bind(nickname.trim(), now, userId).run();

  // daily_record 닉네임도 동기화
  await env.DB.prepare(`
    INSERT INTO daily_record (user_id, nickname)
    VALUES (?, ?)
    ON CONFLICT (user_id) DO UPDATE SET nickname = excluded.nickname
  `).bind(userId, nickname.trim()).run();

  return jsonResponse({ success: true, nickname: nickname.trim() }, corsHeaders);
}


// =============================================
// [닉네임] 중복 확인 (실시간 체크용)
// 목적: 닉네임 입력 중 즉시 중복 여부 반환
// =============================================
async function handleNicknameCheck(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const url = new URL(request.url);
  const nickname = url.searchParams.get("nickname") || "";

  const validation = validateNickname(nickname);
  if (!validation.valid) {
    return jsonResponse({ available: false, message: validation.message }, corsHeaders);
  }

  const existing = await env.DB.prepare(
    "SELECT id FROM users WHERE nickname = ?"
  ).bind(nickname.trim()).first();

  return jsonResponse({
    available: !existing,
    message: existing ? "이미 사용 중인 별명입니다." : "사용 가능한 별명입니다.",
  }, corsHeaders);
}


// =============================================
// 닉네임 유효성 검사 공통 함수
// 규칙: 2~12자, 특수문자 불허 (한글/영문/숫자/언더스코어만)
// =============================================
function validateNickname(nickname: string): { valid: boolean; message: string } {
  if (!nickname || nickname.trim().length === 0) {
    return { valid: false, message: "별명을 입력해주세요." };
  }
  const trimmed = nickname.trim();
  if (trimmed.length < 2) {
    return { valid: false, message: "별명은 2자 이상이어야 합니다." };
  }
  if (trimmed.length > 12) {
    return { valid: false, message: "별명은 12자 이하여야 합니다." };
  }
  // 허용: 한글, 영문(대소문자), 숫자, 언더스코어(_)
  const allowed = /^[가-힣a-zA-Z0-9_]+$/;
  if (!allowed.test(trimmed)) {
    return { valid: false, message: "별명은 한글, 영문, 숫자, _만 사용할 수 있습니다." };
  }
  return { valid: true, message: "" };
}


// =============================================
// [타이머] 오늘 누적 기록 조회
// =============================================
async function handleGetTimer(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const userId = await getAuthUserId(request, env);
  if (!userId) return jsonResponse({ error: "인증 필요" }, corsHeaders, 401);

  const record = await env.DB.prepare(`
    SELECT today_accumulated_ms, last_start_time, current_tab_id
    FROM daily_record WHERE user_id = ?
  `).bind(userId).first() as any;

  return jsonResponse(record || { today_accumulated_ms: 0 }, corsHeaders);
}


// =============================================
// [타이머] 생존 시간 업데이트 (주기적 ping)
// =============================================
async function handleUpdateTimer(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const userId = await getAuthUserId(request, env);
  if (!userId) return jsonResponse({ error: "인증 필요" }, corsHeaders, 401);

  const { accumulatedMs, tabId } = await request.json() as {
    accumulatedMs: number; tabId: string;
  };

  // 탭 중복 검사: DB의 current_tab_id와 비교
  const record = await env.DB.prepare(
    "SELECT current_tab_id FROM daily_record WHERE user_id = ?"
  ).bind(userId).first() as any;

  if (record?.current_tab_id && record.current_tab_id !== tabId) {
    return jsonResponse({ error: "중복 탭 감지됨", blocked: true }, corsHeaders, 409);
  }

  const nickname = await getUserCurrentNickname(userId, env);
  if (!nickname) {
    return jsonResponse({ error: "닉네임을 찾을 수 없습니다." }, corsHeaders, 400);
  }

  await env.DB.prepare(`
    INSERT INTO daily_record (user_id, nickname, today_accumulated_ms, current_tab_id, last_start_time, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (user_id) DO UPDATE SET
      today_accumulated_ms = excluded.today_accumulated_ms,
      current_tab_id = excluded.current_tab_id,
      last_start_time = excluded.last_start_time,
      updated_at = CURRENT_TIMESTAMP
  `).bind(userId, nickname, accumulatedMs, tabId, Date.now()).run();

  return jsonResponse({ success: true }, corsHeaders);
}


// =============================================
// [리더보드] 실시간 순위 상위 100명 조회
// =============================================
async function handleLeaderboard(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const rows = await env.DB.prepare(`
    SELECT dr.user_id, dr.nickname, dr.today_accumulated_ms,
           u.picture,
           RANK() OVER (ORDER BY dr.today_accumulated_ms DESC) as current_rank
    FROM daily_record dr
    JOIN users u ON dr.user_id = u.id
    WHERE dr.today_accumulated_ms > 0
    ORDER BY dr.today_accumulated_ms DESC
    LIMIT 100
  `).all();

  return jsonResponse({ leaderboard: rows.results }, corsHeaders);
}


// =============================================
// [채팅] 메시지 전송
// =============================================
async function handleSendChat(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const userId = await getAuthUserId(request, env);
  if (!userId) return jsonResponse({ error: "인증 필요" }, corsHeaders, 401);

  const { message, liveTime } = await request.json() as {
    message: string; liveTime: string;
  };

  // ⚠️ 보안: 프론트에서 받은 닉네임 사용하지 않고, DB에서 직접 조회
  const nickname = await getUserCurrentNickname(userId, env);
  if (!nickname) {
    return jsonResponse({ error: "유저 정보를 찾을 수 없습니다." }, corsHeaders, 404);
  }

  // 메시지 유효성 검사 (백엔드에서도 이중 검증)
  if (!message || message.length < 2 || message.length > 200) {
    return jsonResponse({ error: "메시지 길이 오류" }, corsHeaders, 400);
  }

  await env.DB.prepare(`
    INSERT INTO chat_logs (user_id, nickname, message, live_time)
    VALUES (?, ?, ?, ?)
  `).bind(userId, nickname, message, liveTime).run();

  return jsonResponse({ success: true }, corsHeaders);
}


// =============================================
// [채팅] 최근 메시지 히스토리 조회
// =============================================
async function handleChatHistory(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const rows = await env.DB.prepare(`
    SELECT log_id, nickname, message, live_time, created_at
    FROM chat_logs
    ORDER BY created_at DESC
    LIMIT 30
  `).all();

  // 최신순 → 오래된 순으로 뒤집어서 반환 (채팅은 위→아래 시간순)
  const messages = (rows.results as any[]).reverse();
  return jsonResponse({ messages }, corsHeaders);
}


// =============================================
// [WebSocket] Durable Objects로 실시간 채팅 연결
// =============================================
async function handleWebSocket(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  // 전 세계 단일 채팅방 (싱글톤 패턴)
  const id = env.CHAT_ROOM.idFromName("global-chat");
  const chatRoom = env.CHAT_ROOM.get(id);
  return chatRoom.fetch(request);
}


// =============================================
// [관리자] 자정 리셋 API 핸들러
// ⚠️ 보안: 관리자 이메일 검증 후에만 실행
// =============================================
async function handleMidnightReset(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  // 관리자 권한 검증
  const userId = await getAuthUserId(request, env);
  const user = userId ? await env.DB.prepare(
    "SELECT role FROM users WHERE id = ?"
  ).bind(userId).first() as any : null;

  // ⚠️ 보안: 반드시 role을 DB에서 조회. 프론트에서 전달한 role 절대 신뢰 금지!
  if (!user || user.role !== "admin") {
    return jsonResponse({ error: "권한 없음" }, corsHeaders, 403);
  }

  await midnightReset(env);
  return jsonResponse({ success: true, message: "자정 리셋 완료" }, corsHeaders);
}


// =============================================
// [관리자] 특정 유저 타이머 강제 종료
// =============================================
async function handleAdminForceStop(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const adminId = await getAuthUserId(request, env);
  const admin = adminId ? await env.DB.prepare(
    "SELECT role FROM users WHERE id = ?"
  ).bind(adminId).first() as any : null;

  // ⚠️ 보안: 관리자 이중 검증
  if (!admin || admin.role !== "admin") {
    return jsonResponse({ error: "권한 없음" }, corsHeaders, 403);
  }

  const { targetUserId } = await request.json() as { targetUserId: string };

  await env.DB.prepare(`
    UPDATE daily_record
    SET current_tab_id = 'ADMIN_BLOCKED',
        last_start_time = NULL
    WHERE user_id = ?
  `).bind(targetUserId).run();

  return jsonResponse({ success: true }, corsHeaders);
}


// =============================================
// 자정 리셋 공통 로직 (Cron & API 공유)
// =============================================
async function midnightReset(env: Env): Promise<void> {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  // 오늘 누적 기록을 history_record로 이동
  await env.DB.prepare(`
    INSERT OR REPLACE INTO history_record (record_date, user_id, final_ms, final_rank)
    SELECT
      ? as record_date,
      user_id,
      today_accumulated_ms as final_ms,
      RANK() OVER (ORDER BY today_accumulated_ms DESC) as final_rank
    FROM daily_record
    WHERE today_accumulated_ms > 0
  `).bind(today).run();

  // daily_record 초기화
  await env.DB.prepare(`
    UPDATE daily_record
    SET today_accumulated_ms = 0,
        last_start_time = NULL,
        current_tab_id = NULL,
        updated_at = CURRENT_TIMESTAMP
  `).run();
}


// =============================================
// 유틸리티: 세션 토큰으로 user_id 조회
// =============================================
async function getAuthUserId(request: Request, env: Env): Promise<string | null> {
  const sessionId = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!sessionId) return null;

  const session = await env.DB.prepare(
    "SELECT user_id FROM sessions WHERE session_id = ?"
  ).bind(sessionId).first() as any;

  return session?.user_id || null;
}


// =============================================
// 유틸리티: JSON 응답 생성
// =============================================
function jsonResponse(data: unknown, corsHeaders: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

// =============================================
// 유틸리티: 유저의 현재 닉네임 조회
// =============================================
async function getUserCurrentNickname(userId: string, env: Env): Promise<string | null> {
  const user = await env.DB.prepare(
    "SELECT name, nickname FROM users WHERE id = ?"
  ).bind(userId).first() as any;

  return user?.nickname || user?.name || null;
}


// =============================================
// Durable Object: 실시간 채팅방
// 목적: WebSocket 연결 유지 및 메시지 브로드캐스트
// =============================================
export class ChatRoom {
  private sessions: Set<WebSocket> = new Set();
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    // WebSocket 업그레이드 확인
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader !== "websocket") {
      return new Response("WebSocket 연결이 필요합니다", { status: 426 });
    }

    // WebSocket 쌍 생성
    const [client, server] = Object.values(new WebSocketPair());

    // 새 연결 등록
    this.sessions.add(server);
    server.accept();

    // 메시지 수신 시 전체 브로드캐스트
    server.addEventListener("message", (event: MessageEvent) => {
      this.broadcast(event.data as string, server);
    });

    // 연결 종료 시 세션 목록에서 제거
    server.addEventListener("close", () => {
      this.sessions.delete(server);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  // 모든 연결된 클라이언트에게 메시지 전송 (발신자 제외 옵션)
  private broadcast(message: string, sender?: WebSocket): void {
    this.sessions.forEach((session) => {
      if (session !== sender && session.readyState === WebSocket.READY_STATE_OPEN) {
        session.send(message);
      }
    });
  }
}


// =============================================
// Durable Object: 타이머 동기화 (향후 확장용)
// 현재는 뼈대만 구현, 추후 실시간 순위 push에 활용
// =============================================
export class TimerSync {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    return new Response("TimerSync 준비 완료", { status: 200 });
  }
}
