// frontend/js/language.js

const translations = {
    'ko': {
        'language_switcher': 'KR / EN',
        'rules_title': '규칙',
        'donate_link': '후원하기',
        'rewards_link': '후원 공지',
        'minigame_link': '미니 게임',
        'update_notes_link': '업데이트 노트',
        'login_button': '구글 로그인',
        'live_session_badge': '라이브 세션 진행 중',
        'my_survival_time': '나의 현재 생존 시간',
        'time_unit_hour': '시간',
        'time_unit_minute': '분',
        'time_unit_second': '초',
        'competitors_today': '금일 경쟁자',
        'current_rank': '현재 순위',
        'session_average': '세션 평균',
        'realtime_chat_title': '실시간 채팅',
        'online_users_status': '연결 중...', 
        'chat_login_placeholder': '채팅하려면 로그인하세요',
        'leaderboard_title': '글로벌 리더보드',
        'leaderboard_subtitle': '오늘의 실시간 생존 순위',
        'leaderboard_tab_live': '실시간',
        'leaderboard_tab_alltime': '역대 기록',
        'rank_column': '순위',
        'competitor_column': '경쟁자',
        'status_column': '상태',
        'survival_time_column': '생존 시간',
        'load_more_leaderboard': '상위 100명 전체 보기',
        'rules_section_title': '게임 규칙',
        'rule1_title': '페이지 체류 = 생존',
        'rule1_desc': '이 페이지에 머무는 동안 타이머가 올라갑니다. 창을 닫으면 기록이 멈춥니다.',
        'rule2_title': '하루 단위 경쟁',
        'rule2_desc': '매일 자정(UTC+0)에 초기화됩니다. 전날 기록은 어제 기록에 보존됩니다.',
        'rule3_title': '탭 하나만 허용',
        'rule3_desc': '여러 탭에서 동시 접속하면 마지막 탭만 기록됩니다. 공정한 경쟁을 위해!',
        'rule4_title': '수익 기부',
        'rule4_desc': '수익금의 50%는 기부됩니다. 플레이만으로 사회에 좋은 영향을 만들어보세요.',
        'admin_panel_title': '관리자 패널',
        'admin_panel_subtitle': '백엔드에서도 이중 검증됨',
        'admin_reset_button': '자정 리셋 실행',
        'admin_force_stop_button': '유저 타이머 강제 종료',
        'hall_of_fame_title': '기부 마라톤 명예의 전당',
        'hall_of_fame_desc': '여러분의 기부금의 50%는 도움이 필요한 곳에 기부됩니다.<br>함께 세상을 따뜻하게 만드는 <span class="text-primary font-semibold">페이서</span>가 되어주세요!',
        'toss_donate_button': '🇰🇷 토스로 기부하기',
        'buymeacoffee_donate_button': '☕ International Support',
        // 모달 1 (닉네임 설정)
        'nickname_modal_title': '별명을 정해주세요',
        'nickname_modal_subtitle': '랭킹과 채팅에 표시될 나만의 이름입니다',
        'nickname_modal_google_account': '구글 계정:',
        'nickname_modal_nickname_label': '별명',
        'nickname_modal_placeholder': '2~12자, 한글/영문/숫자/_',
        'nickname_rule1': '한글, 영문, 숫자, _ 사용 가능',
        'nickname_rule2': '2자 이상 12자 이하',
        'nickname_rule3': '설정 후 24시간마다 한 번 변경 가능',
        'nickname_set_button': '시작하기',
        // 모달 2 (프로필/닉네임 변경)
        'profile_modal_nickname_change_title': '별명 변경',
        'profile_modal_cooldown_message': '{hours}시간 {minutes}분 후에 변경 가능합니다.', // Placeholder for dynamic values
        'profile_modal_new_nickname_placeholder': '새 별명 (2~12자)',
        'profile_modal_change_button': '변경하기',
        'profile_modal_logout_button': '로그아웃',
        // 탭 차단 오버레이
        'tab_block_title': '다중 탭 감지',
        'tab_block_message': '다른 탭에서 이미 실행 중입니다.',
        'tab_block_resume_button': '이 탭에서 계속하기',
        // 리더보드 로딩/빈 상태 메시지
        'leaderboard_loading': '순위를 불러오는 중...', 
        'leaderboard_empty': '아직 기록이 없습니다. 첫 번째 생존자가 되어보세요!',
        'leaderboard_error': '리더보드를 불러올 수 없습니다. 서버 연결을 확인해주세요.',
        // 리더보드 항목 내
        'leaderboard_entry_live': '접속 중',
        'leaderboard_entry_me': '나',
        'chat_loading_history': '채팅 기록을 불러오는 중입니다...', 
        'chat_new_day_message': '🌅 새로운 하루가 시작되었습니다!',
        'chat_send_button': '전송',
    },
    'en': {
        'language_switcher': 'EN / KR',
        'rules_title': 'Rules',
        'donate_link': 'Donate',
        'rewards_link': 'Sponsor Notice',
        'minigame_link': 'Mini Game',
        'update_notes_link': 'Update Notes',
        'login_button': 'Google Login',
        'live_session_badge': 'LIVE Session in Progress',
        'my_survival_time': 'My Current Survival Time',
        'time_unit_hour': 'Hours',
        'time_unit_minute': 'Minutes',
        'time_unit_second': 'Seconds',
        'competitors_today': 'Competitors Today',
        'current_rank': 'Current Rank',
        'session_average': 'Session Average',
        'realtime_chat_title': 'Realtime Chat',
        'online_users_status': 'Connecting...', 
        'chat_login_placeholder': 'Login to chat',
        'leaderboard_title': 'Global Leaderboard',
        'leaderboard_subtitle': 'Realtime Survival Ranking Today',
        'leaderboard_tab_live': 'Realtime',
        'leaderboard_tab_alltime': 'All Time',
        'rank_column': 'Rank',
        'competitor_column': 'Competitor',
        'status_column': 'Status',
        'survival_time_column': 'Survival Time',
        'load_more_leaderboard': 'View All Top 100',
        'rules_section_title': 'Game Rules',
        'rule1_title': 'Page Stay = Survival',
        'rule1_desc': 'Your timer runs as long as you stay on this page. Closing the window stops your record.',
        'rule2_title': 'Daily Competition',
        'rule2_desc': 'Resets daily at midnight (UTC+0). Previous day\'s records are preserved.',
        'rule3_title': 'One Tab Only',
        'rule3_desc': 'Only the last active tab records your time if multiple tabs are open for fair play.',
        'rule4_title': 'Donation of Profits',
        'rule4_desc': '50% of profits are donated. Make a positive impact by just playing.',
        'admin_panel_title': 'Admin Panel',
        'admin_panel_subtitle': 'Double-checked by backend',
        'admin_reset_button': 'Run Midnight Reset',
        'admin_force_stop_button': 'Force Stop User Timer',
        'hall_of_fame_title': 'Donation Marathon Hall of Fame',
        'hall_of_fame_desc': '50% of your donations will be contributed to those in need.<br>Become a <span class="text-primary font-semibold">Pacer</span> to make the world a warmer place with us!',
        'toss_donate_button': '🇰🇷 Donate with Toss',
        'buymeacoffee_donate_button': '☕ International Support',
        // Modal 1 (Nickname setting)
        'nickname_modal_title': 'Set Your Nickname',
        'nickname_modal_subtitle': 'Your unique name for rankings and chat',
        'nickname_modal_google_account': 'Google Account:',
        'nickname_modal_nickname_label': 'Nickname',
        'nickname_modal_placeholder': '2-12 characters, alphanumeric/_',
        'nickname_rule1': 'Korean, English, numbers, _ allowed',
        'nickname_rule2': '2 to 12 characters',
        'nickname_rule3': 'Can be changed once every 24 hours after setting',
        'nickname_set_button': 'Start',
        // Modal 2 (Profile/Nickname Change)
            'profile_modal_nickname_change_title': 'Change Nickname',
        'profile_modal_cooldown_message': 'Can change after {hours} hours {minutes} minutes.', // Placeholder for dynamic values
        'profile_modal_new_nickname_placeholder': 'New Nickname (2-12 chars)',
        'profile_modal_change_button': 'Change',
        'profile_modal_logout_button': 'Logout',
        // Tab Block Overlay
        'tab_block_title': 'Multiple Tab Detected',
        'tab_block_message': 'Already running in another tab.',
        'tab_block_resume_button': 'Continue on this tab',
        // Leaderboard Loading/Empty State Messages
        'leaderboard_loading': 'Loading ranks...', 
        'leaderboard_empty': 'No records yet. Be the first survivor!',
        'leaderboard_error': 'Could not load leaderboard. Check server connection.',
        // Leaderboard Entry Details
        'leaderboard_entry_live': 'LIVE',
        'leaderboard_entry_me': 'ME',
        'chat_loading_history': 'Loading chat history...', 
        'chat_new_day_message': '🌅 A new day has begun!',
        'chat_send_button': 'Send',
    }
};

let currentLanguage = localStorage.getItem('language') || 'ko';

function setLanguage(lang) {
    currentLanguage = lang;
    localStorage.setItem('language', lang);
    applyTranslations();
}

function switchLanguage() {
    const newLang = currentLanguage === 'ko' ? 'en' : 'ko';
    setLanguage(newLang);
}

function applyTranslations() {
    const elements = document.querySelectorAll('[data-i18n-key]');
    elements.forEach(element => {
        const key = element.getAttribute('data-i18n-key');
        if (translations[currentLanguage] && translations[currentLanguage][key]) {
            element.innerHTML = translations[currentLanguage][key];
        }
    });

    // Update the language switcher text explicitly
    const langSwitcher = document.getElementById('language-switcher');
    if (langSwitcher) {
        langSwitcher.querySelector('span').textContent = translations[currentLanguage]['language_switcher'].split(' / ')[0]; // Display only current language
    }

    // Special handling for placeholders
    const nicknameInput = document.getElementById('nickname-modal-placeholder-input'); // Assuming this ID or data-i18n-key for placeholder
    if (nicknameInput) {
        nicknameInput.placeholder = translations[currentLanguage]['nickname_modal_placeholder'];
    }
    const nicknameChangeInput = document.getElementById('profile-modal-new-nickname-placeholder-input'); // Assuming this ID or data-i18n-key for placeholder
    if (nicknameChangeInput) {
        nicknameChangeInput.placeholder = translations[currentLanguage]['profile_modal_new_nickname_placeholder'];
    }
     const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.placeholder = translations[currentLanguage]['chat_login_placeholder'];
    }

    // Special handling for profile_modal_cooldown_message with placeholders
    const cooldownMsgElement = document.getElementById('nickname-cooldown-msg');
    if (cooldownMsgElement && cooldownMsgElement.dataset.cooldownHours && cooldownMsgElement.dataset.cooldownMinutes) {
        const hours = cooldownMsgElement.dataset.cooldownHours;
        const minutes = cooldownMsgElement.dataset.cooldownMinutes;
        let message = translations[currentLanguage]['profile_modal_cooldown_message'];
        message = message.replace('{hours}', hours).replace('{minutes}', minutes);
        cooldownMsgElement.querySelector('span:nth-child(2)').textContent = message; // Assuming the message is in the second span
    }
}

// Initialize language on page load
document.addEventListener('DOMContentLoaded', () => {
    applyTranslations();
    // Set initial text for the language switcher
    const langSwitcher = document.getElementById('language-switcher');
    if (langSwitcher) {
        langSwitcher.querySelector('span').textContent = translations[currentLanguage]['language_switcher'].split(' / ')[0];
    }
});

// Expose setLanguage and switchLanguage globally if needed by other scripts or inline HTML
window.setLanguage = setLanguage;
window.switchLanguage = switchLanguage;
