// frontend/js/donation.js

const donationModalHTML = `
<!-- Modal Overlay Backdrop -->
<div id="donation-modal-overlay" class="fixed inset-0 z-[70] bg-slate-950/60 backdrop-blur-md flex items-center justify-center p-6 hidden">
  <!-- Donation Certificate Modal -->
  <div class="relative w-full max-w-xl glass-panel p-10 flex flex-col items-center">
    <!-- Close Button -->
    <button id="donation-modal-close" class="absolute top-6 right-6 text-slate-500 hover:text-primary transition-colors">
      <span class="material-symbols-outlined text-3xl">close</span>
    </button>
    <!-- Header Section -->
    <div class="text-center mb-8">
      <span class="text-[10px] text-primary font-bold tracking-[0.4em] uppercase mb-2 block">기부 확인증</span>
      <h1 class="text-3xl font-headline font-extrabold tracking-tighter text-white uppercase">기부 증서</h1>
      <div class="w-16 h-1 bg-primary mx-auto mt-4"></div>
    </div>
    <!-- Image Section (A4 Placeholder) -->
    <div class="w-full mb-6 flex justify-center">
      <div class="w-full max-w-2xl h-64 bg-white rounded-lg shadow-xl border border-slate-200 relative overflow-hidden flex items-center justify-center">
        <span class="material-symbols-outlined text-slate-200 text-5xl">description</span>
        </div>
    </div>
    <!-- Donation Stats -->
    <div class="w-full text-center py-6 border-t border-white/5">
      <h2 class="text-primary font-headline font-black text-4xl tracking-tighter">총 기부금: ₩0</h2>
    </div>
  </div>
</div>
`;

function initializeDonationModal() {
  document.body.insertAdjacentHTML('beforeend', donationModalHTML);

  const modalOverlay = document.getElementById('donation-modal-overlay');
  const closeButton = document.getElementById('donation-modal-close');
  const rewardsLink = document.querySelector('a[data-i18n-key="rewards_link"]');

  if (rewardsLink) {
    rewardsLink.addEventListener('click', (event) => {
      event.preventDefault();
      modalOverlay.classList.remove('hidden');
    });
  }

  if (closeButton) {
    closeButton.addEventListener('click', () => {
      modalOverlay.classList.add('hidden');
    });
  }

  if (modalOverlay) {
    modalOverlay.addEventListener('click', (event) => {
      if (event.target === modalOverlay) {
        modalOverlay.classList.add('hidden');
      }
    });
  }
}

// Call this function when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', initializeDonationModal);
