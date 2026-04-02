function createMiniGameOverlay() {
    const overlayHTML = `
<div id="minigame-overlay" class="hidden fixed inset-0 z-[70] bg-slate-950/60 backdrop-blur-md flex items-center justify-center p-6">
    <div class="relative w-full max-w-xl glass-panel p-10 flex flex-col items-center">
        <button id="close-minigame" class="absolute top-6 right-6 text-slate-500 hover:text-primary transition-colors">
            <span class="material-symbols-outlined text-3xl">close</span>
        </button>
        <div class="text-center mb-10">
            <span class="text-[10px] text-primary font-bold tracking-[0.4em] uppercase mb-2 block">Additional Features</span>
            <h1 class="text-3xl font-headline font-extrabold tracking-tighter text-white uppercase">SELECT Mini Game</h1>
            <div class="w-16 h-1 bg-primary mx-auto mt-4"></div>
        </div>
        <div class="w-full space-y-4">
            <button onclick="window.open('https://daily-mystery.pages.dev/', '_blank')" class="group relative w-full h-24 glass-panel hover:bg-white/5 overflow-hidden transition-all duration-300 active:scale-[0.98] flex items-center px-8 border-l-4 border-l-transparent hover:border-l-primary">
                <div class="mr-6 bg-primary/10 p-3 rounded-lg group-hover:bg-primary/20 transition-colors">
                    <span class="material-symbols-outlined text-primary text-3xl">Cards</span>
                </div>
                <div class="text-left flex-1">
                    <h3 class="font-headline font-bold text-lg text-white group-hover:text-primary transition-colors uppercase tracking-tight">Daily Mystery</h3>
                    <p class="text-[10px] text-slate-500 uppercase tracking-widest font-medium">오름차순으로 빠르게 버튼을 눌러서 상대와 경쟁하세요.</p>
                </div>
                <div class="opacity-0 group-hover:opacity-100 transition-opacity">
                    <span class="material-symbols-outlined text-primary">chevron_right</span>
                </div>
                <div class="absolute -right-10 -bottom-10 w-24 h-24 bg-primary/5 rounded-full blur-2xl group-hover:bg-primary/20 transition-all"></div>
            </button>
            <button onclick="window.open('https://word.growgardens.app', '_blank')" class="group relative w-full h-24 glass-panel hover:bg-white/5 overflow-hidden transition-all duration-300 active:scale-[0.98] flex items-center px-8 border-l-4 border-l-transparent hover:border-l-primary">
                <div class="mr-6 bg-primary/10 p-3 rounded-lg group-hover:bg-primary/20 transition-colors">
                    <span class="material-symbols-outlined text-primary text-3xl">extension</span>
                </div>
                <div class="text-left flex-1">
                    <h3 class="font-headline font-bold text-lg text-white group-hover:text-primary transition-colors uppercase tracking-tight">ONE SHOT</h3>
                    <p class="text-[10px] text-slate-500 uppercase tracking-widest font-medium">금일 단어의 유사도 순위를 확인하고, 상위권 단어들을 힌트 삼아 연관 단어를 던져 정답을 도출하세요.</p>
                </div>
                <div class="opacity-0 group-hover:opacity-100 transition-opacity">
                    <span class="material-symbols-outlined text-primary">chevron_right</span>
                </div>
                <div class="absolute -right-10 -bottom-10 w-24 h-24 bg-primary/5 rounded-full blur-2xl group-hover:bg-primary/20 transition-all"></div>
            </button>
            <button onclick="window.open('https://n-back-game.pages.dev', '_blank')" class="group relative w-full h-24 glass-panel hover:bg-white/5 overflow-hidden transition-all duration-300 active:scale-[0.98] flex items-center px-8 border-l-4 border-l-transparent hover:border-l-primary">
                <div class="mr-6 bg-primary/10 p-3 rounded-lg group-hover:bg-primary/20 transition-colors">
                    <span class="material-symbols-outlined text-primary text-3xl">ads_click</span>
                </div>
                <div class="text-left flex-1">
                    <h3 class="font-headline font-bold text-lg text-white group-hover:text-primary transition-colors uppercase tracking-tight">N-BACK CHALLENGE</h3>
                    <p class="text-[10px] text-slate-500 uppercase tracking-widest font-medium">패턴을 기억해서 집중력을 길러보세요.</p>
                </div>
                <div class="opacity-0 group-hover:opacity-100 transition-opacity">
                    <span class="material-symbols-outlined text-primary">chevron_right</span>
                </div>
                <div class="absolute -right-10 -bottom-10 w-24 h-24 bg-primary/5 rounded-full blur-2xl group-hover:bg-primary/20 transition-all"></div>
            </button>
            <button onclick="window.open('https://planetpop.oozygreen.com/', '_blank')" class="group relative w-full h-24 glass-panel hover:bg-white/5 overflow-hidden transition-all duration-300 active:scale-[0.98] flex items-center px-8 border-l-4 border-l-transparent hover:border-l-primary">
                <div class="mr-6 bg-primary/10 p-3 rounded-lg group-hover:bg-primary/20 transition-colors">
                    <span class="material-symbols-outlined text-primary text-3xl">Planet</span>
                </div>
                <div class="text-left flex-1">
                    <h3 class="font-headline font-bold text-lg text-white group-hover:text-primary transition-colors uppercase tracking-tight">Planet Pop</h3>
                    <p class="text-[10px] text-slate-500 uppercase tracking-widest font-medium">방향이 바뀌는 반중력 수박게임</p>
                </div>
                <div class="opacity-0 group-hover:opacity-100 transition-opacity">
                    <span class="material-symbols-outlined text-primary">chevron_right</span>
                </div>
                <div class="absolute -right-10 -bottom-10 w-24 h-24 bg-primary/5 rounded-full blur-2xl group-hover:bg-primary/20 transition-all"></div>
            </button>
            <button class="group relative w-full h-24 glass-panel hover:bg-white/5 overflow-hidden transition-all duration-300 active:scale-[0.98] flex items-center px-8 border-l-4 border-l-transparent hover:border-l-primary">
                <div class="mr-6 bg-primary/10 p-3 rounded-lg group-hover:bg-primary/20 transition-colors">
                    <span class="material-symbols-outlined text-primary text-3xl">palette</span>
                </div>
                <div class="text-left flex-1">
                    <h3 class="font-headline font-bold text-lg text-white group-hover:text-primary transition-colors uppercase tracking-tight">게임 준비 중입니다...</h3>
                    <p class="text-[10px] text-slate-500 uppercase tracking-widest font-medium">게임 준비 중입니다...</p>
                </div>
                <div class="opacity-0 group-hover:opacity-100 transition-opacity">
                    <span class="material-symbols-outlined text-primary">chevron_right</span>
                </div>
                <div class="absolute -right-10 -bottom-10 w-24 h-24 bg-primary/5 rounded-full blur-2xl group-hover:bg-primary/20 transition-all"></div>
            </button>
        </div>
    </div>
</div>
    `;

    document.body.insertAdjacentHTML('beforeend', overlayHTML);

    const overlay = document.getElementById('minigame-overlay');
    const closeButton = document.getElementById('close-minigame');

    function showOverlay() {
        overlay.classList.remove('hidden');
        overlay.classList.add('flex');
    }

    function hideOverlay() {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
    }

    closeButton.addEventListener('click', hideOverlay);
    overlay.addEventListener('click', function(event) {
        if (event.target === overlay) {
            hideOverlay();
        }
    });


    // Expose a function to be called from index.html
    window.openMiniGameOverlay = showOverlay;
}

// Initialize the overlay
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createMiniGameOverlay);
} else {
    createMiniGameOverlay();
}
