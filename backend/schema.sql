-- =============================================
-- 데이터베이스: stayalive_db
-- 엔진: Cloudflare D1 (SQLite 문법)
-- 목적: CountTimeout 게임의 유저·기록·채팅·세션 관리
-- ⚠️ 중요: Cloudflare D1 콘솔 또는 wrangler d1 execute 명령어로 실행
-- =============================================


-- =============================================
-- 1. users 테이블
-- 목적: Google OAuth로 로그인한 유저 계정 정보 저장
-- 연결: 모든 테이블의 user_id FK 기준점
-- =============================================
CREATE TABLE IF NOT EXISTS users (
    -- Google OAuth sub 값을 기본 키로 사용 (고유한 구글 유저 ID)
    id                  TEXT PRIMARY KEY,

    -- 구글 계정 이메일 (유니크 보장, 관리자 판별에도 사용)
    email               TEXT UNIQUE NOT NULL,

    -- 구글 계정 표시 이름 (원본 보존용 - 닉네임과 별개)
    name                TEXT NOT NULL,

    -- 구글 프로필 사진 URL
    picture             TEXT,

    -- 권한 구분: 'user' | 'admin'
    -- ⚠️ 보안: 프론트엔드 표시용 참고값. 실제 권한 검증은 반드시 백엔드(Workers)에서 이중 검증할 것!
    role                TEXT NOT NULL DEFAULT 'user',

    -- 유저가 직접 설정한 별명 (null이면 닉네임 미설정 = 최초 방문자)
    -- null 여부로 "처음 방문자인지" 판별함
    nickname            TEXT UNIQUE,

    -- 닉네임을 마지막으로 변경한 시각 (Unix 타임스탬프 ms)
    -- null이면 아직 한 번도 변경 안 함 (최초 설정은 제한 없음)
    -- 24시간(86400000ms) 이내 재변경 차단에 사용
    nickname_changed_at INTEGER,

    -- 최초 가입일
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 닉네임 중복 방지 인덱스 (UNIQUE 제약이 있지만 조회 속도도 향상)
CREATE INDEX IF NOT EXISTS idx_users_nickname ON users(nickname);


-- =============================================
-- 2. daily_record 테이블
-- 목적: 오늘(00:00 기준) 각 유저의 생존 누적 시간 실시간 관리
-- 연결: users.id → user_id
-- ⚠️ 중요: 매일 자정(서버 기준)에 history_record로 이동 후 초기화
-- =============================================
CREATE TABLE IF NOT EXISTS daily_record (
    -- 기록 날짜 (YYYY-MM-DD 형식)
    date                    TEXT NOT NULL,

    -- users 테이블의 id
    user_id                 TEXT NOT NULL,

    -- 화면에 표시할 닉네임 (구글 이름과 동기화)
    nickname                TEXT NOT NULL,

    -- 오늘 총 누적 생존 시간 (밀리초 단위)
    -- ⚠️ 중요: 밀리초 저장으로 동률자 발생 시 ms 단위 정밀 순위 처리
    today_accumulated_ms    INTEGER NOT NULL DEFAULT 0,

    -- 현재 세션이 '시작된 서버 타임스탬프' (밀리초)
    -- null이면 현재 오프라인 상태
    last_start_time         INTEGER,

    -- 탭 중복 방지: 현재 활성화된 탭의 고유 ID
    -- singleTabGuard()가 여기에 기록 및 비교함
    current_tab_id          TEXT,

    -- 마지막 업데이트 시각 (데이터 무결성 확인용)
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- 복합 기본 키: 날짜 + 유저 조합으로 하루 1건 보장
    PRIMARY KEY (date, user_id),

    -- 외래 키: users 테이블 연결
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);


-- =============================================
-- 3. history_record 테이블
-- 목적: 매일 자정 daily_record 최종 데이터를 영구 보존
-- 연결: users.id → user_id
-- 용도: 명예의 전당, 어제의 1위(🥇) 배지, 전적 조회
-- =============================================
CREATE TABLE IF NOT EXISTS history_record (
    -- 기록된 날짜 (YYYY-MM-DD 형식)
    date        TEXT NOT NULL,

    -- 해당 유저의 ID
    user_id     TEXT NOT NULL,

    -- 해당 날의 최종 생존 시간 (밀리초)
    count       INTEGER NOT NULL DEFAULT 0,

    -- 복합 기본 키: 날짜 + 유저 조합으로 하루 1건 보장
    PRIMARY KEY (date, user_id),

    -- 외래 키: users 테이블 연결
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);


-- =============================================
-- 4. chat_logs 테이블
-- 목적: 실시간 채팅 메시지 영구 기록
-- 연결: users.id → user_id
-- ⚠️ 참고: 자정 초기화 여부는 추후 결정 필요 (현재는 누적 보관)
-- =============================================
CREATE TABLE IF NOT EXISTS chat_logs (
    -- 자동 증가 기본 키
    log_id      INTEGER PRIMARY KEY AUTOINCREMENT,

    -- 메시지를 보낸 유저 ID
    user_id     TEXT NOT NULL,

    -- 메시지 전송 당시 닉네임 (유저 이름 변경에도 기록 유지)
    nickname    TEXT NOT NULL,

    -- 실제 메시지 내용 (최대 200자 제한은 JS에서 처리)
    message     TEXT NOT NULL,

    -- 메시지 전송 당시 유저의 생존 시간 ("HH:MM:SS" 형식 문자열)
    -- 채팅 배지(🔥 등) 판별에 활용
    live_time   TEXT,

    -- 메시지 전송 시각
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- 외래 키: users 테이블 연결
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);


-- =============================================
-- 5. sessions 테이블
-- 목적: 자동 로그인 유지를 위한 세션 토큰 관리
-- 연결: users.id → user_id
-- ⚠️ 보안: session_id는 반드시 서버에서 crypto.randomUUID()로 생성할 것
-- =============================================
CREATE TABLE IF NOT EXISTS sessions (
    -- 서버가 발급한 고유 세션 토큰 (UUID v4)
    session_id  TEXT PRIMARY KEY,

    -- 해당 세션의 유저 ID
    user_id     TEXT NOT NULL,

    -- 세션 생성 시각
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- 외래 키: users 테이블 연결
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);


-- =============================================
-- INDEX 생성
-- 목적: 자주 조회되는 컬럼의 검색 속도 최적화
-- =============================================

-- chat_logs: user_id로 특정 유저 채팅 기록 조회 빠르게
CREATE INDEX IF NOT EXISTS idx_chat_logs_user_id
    ON chat_logs(user_id);

-- chat_logs: 최신 메시지 정렬 조회 빠르게 (initChat의 최근 30개 로드)
CREATE INDEX IF NOT EXISTS idx_chat_logs_created_at
    ON chat_logs(created_at DESC);

-- history_record: 날짜별 랭킹 조회 빠르게 (명예의 전당)
CREATE INDEX IF NOT EXISTS idx_history_record_date
    ON history_record(date);

-- history_record: 생존 시간 순 정렬 빠르게 (랭킹 산출)
CREATE INDEX IF NOT EXISTS idx_history_count
    ON history_record(count DESC);

-- daily_record: 실시간 리더보드 정렬 빠르게
CREATE INDEX IF NOT EXISTS idx_daily_accumulated_ms
    ON daily_record(today_accumulated_ms DESC);

-- sessions: user_id로 세션 조회 빠르게 (로그인 상태 확인)
CREATE INDEX IF NOT EXISTS idx_sessions_user_id
    ON sessions(user_id);
