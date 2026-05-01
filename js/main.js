import { watchNumbers, watchReservation } from './firebase.js';

const CONFIG = {
  totalNumbers:    100,
  pricePerNumber:  20,
  whatsappNumber:  '5511934473466',
};

const state = {
  selected:            new Set(),
  numberStatus:        {},
  buyer:               {},
  currentReservation:  null,
  unsubReservation:    null,
  pixTimer:            null,
  pollTimer:           null,
};

document.addEventListener('DOMContentLoaded', () => {
  renderGrid();
  bindEvents();
  startRealtimeSync();
});

/* =========================================
   FIREBASE REAL-TIME SYNC
   ========================================= */
function startRealtimeSync() {
  watchNumbers((statusMap) => {
    state.numberStatus = statusMap;
    syncGridWithStatus(statusMap);
  });
}

function syncGridWithStatus(statusMap) {
  for (let i = 1; i <= CONFIG.totalNumbers; i++) {
    const btn = document.querySelector(`.num-btn[data-number="${i}"]`);
    if (!btn) continue;

    const status = statusMap[String(i)] || 'available';

    if (btn.classList.contains('selected')) continue;

    btn.classList.remove('sold', 'reserved');
    btn.disabled = false;
    btn.title = '';

    if (status === 'sold') {
      btn.classList.add('sold');
      btn.disabled = true;
      btn.title = 'Número já vendido';
      state.selected.delete(i);
    } else if (status === 'reserved') {
      btn.classList.add('reserved');
      btn.disabled = true;
      btn.title = 'Reservado — aguardando pagamento';
      state.selected.delete(i);
    }
  }
  updateCart();
}

/* =========================================
   GRID DE NUMEROS
   ========================================= */
function renderGrid() {
  const grid = document.getElementById('numbers-grid');
  grid.innerHTML = '';

  for (let i = 1; i <= CONFIG.totalNumbers; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'num-btn';
    btn.textContent = String(i).padStart(2, '0');
    btn.dataset.number = i;
    btn.addEventListener('click', () => handleNumberClick(i, btn));
    grid.appendChild(btn);
  }
}

function handleNumberClick(num, btn) {
  const status = state.numberStatus[String(num)] || 'available';
  if (status !== 'available') return;

  if (state.selected.has(num)) {
    state.selected.delete(num);
    btn.classList.remove('selected');
  } else {
    state.selected.add(num);
    btn.classList.add('selected');
  }
  updateCart();
}

/* =========================================
   CART
   ========================================= */
function updateCart() {
  const count = state.selected.size;
  const total = count * CONFIG.pricePerNumber;

  document.getElementById('cart-count').textContent = count;
  document.getElementById('cart-total').textContent = formatCurrency(total);
  document.getElementById('btn-checkout').disabled = count === 0;
}

/* =========================================
   EVENTS
   ========================================= */
function bindEvents() {
  document.getElementById('btn-checkout').addEventListener('click', openFormModal);

  document.getElementById('close-form').addEventListener('click', closeFormModal);
  document.getElementById('modal-form').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeFormModal();
  });

  document.getElementById('close-pix').addEventListener('click', closePixModal);
  document.getElementById('modal-pix').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closePixModal();
  });

  document.getElementById('buyer-form').addEventListener('submit', handleFormSubmit);
  document.getElementById('buyer-phone').addEventListener('input', maskPhone);
  document.getElementById('buyer-cpf').addEventListener('input', maskCpf);
  document.getElementById('btn-copy-pix').addEventListener('click', copyPix);
  document.getElementById('btn-success-close').addEventListener('click', closeSuccessModal);
  document.getElementById('modal-success').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeSuccessModal();
  });
}

/* =========================================
   FORM MODAL
   ========================================= */
function openFormModal() {
  if (state.selected.size === 0) return;

  const nums  = [...state.selected].sort((a, b) => a - b);
  const total = state.selected.size * CONFIG.pricePerNumber;

  document.getElementById('summary-numbers').textContent =
    nums.map(n => String(n).padStart(2, '0')).join(', ');
  document.getElementById('summary-total').textContent = formatCurrency(total);

  openModal('modal-form');
}

function closeFormModal() { closeModal('modal-form'); }

async function handleFormSubmit(e) {
  e.preventDefault();

  const name  = document.getElementById('buyer-name').value.trim();
  const phone = document.getElementById('buyer-phone').value.trim();
  const cpf   = document.getElementById('buyer-cpf').value.trim();

  clearError('buyer-name',  'err-name');
  clearError('buyer-phone', 'err-phone');
  clearError('buyer-cpf',   'err-cpf');

  let valid = true;
  if (name.length < 3) {
    showError('buyer-name', 'err-name', 'Informe seu nome completo.');
    valid = false;
  }
  if (phone.replace(/\D/g, '').length < 10) {
    showError('buyer-phone', 'err-phone', 'Informe um WhatsApp válido com DDD.');
    valid = false;
  }
  if (!validarCpf(cpf)) {
    showError('buyer-cpf', 'err-cpf', 'Informe um CPF válido.');
    valid = false;
  }
  if (!valid) return;

  state.buyer = { name, phone, cpf };

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processando...';

  try {
    const res = await fetch('/api/reserve', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        numbers:    [...state.selected],
        buyerName:  name,
        buyerPhone: phone,
        buyerCpf:   cpf.replace(/\D/g, ''),
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao processar reserva.');

    state.currentReservation = data;
    closeFormModal();
    openPixModal(data);

  } catch (err) {
    alert(err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML =
      '<i class="fa-solid fa-pix" style="font-size:0.9em"></i> Ir para Pagamento via PIX';
  }
}

/* =========================================
   PIX MODAL (Mercado Pago)
   ========================================= */
function openPixModal(data) {
  const nums = [...state.selected].sort((a, b) => a - b);

  document.getElementById('pix-amount').textContent       = formatCurrency(data.total);
  document.getElementById('pix-numbers-list').textContent =
    nums.map(n => String(n).padStart(2, '00')).join(', ');

  const qrPlaceholder = document.getElementById('qr-placeholder');
  if (data.pixQrCodeB64) {
    qrPlaceholder.innerHTML =
      `<img src="data:image/png;base64,${data.pixQrCodeB64}"
            alt="QR Code PIX" class="qr-image" />`;
  }

  if (data.pixCopyPaste) {
    document.getElementById('pix-key-value').value = data.pixCopyPaste;
  }

  openModal('modal-pix');
  startPixCountdown(10 * 60 * 1000, data.reservationId);
  startPaymentPolling(data.reservationId, nums);

  if (state.unsubReservation) state.unsubReservation();
  state.unsubReservation = watchReservation(data.reservationId, (reservation) => {
    if (reservation.status === 'confirmed') {
      handlePaymentConfirmed(nums);
    } else if (reservation.status === 'expired') {
      handlePaymentExpired();
    }
  });
}

function handlePaymentConfirmed(nums) {
  stopPixCountdown();
  stopPaymentPolling();
  if (state.unsubReservation) { state.unsubReservation(); state.unsubReservation = null; }

  const box = document.getElementById('pix-countdown-box');
  box.innerHTML = '<i class="fa-solid fa-circle-check"></i> <strong>Pagamento confirmado! Concluído com sucesso.</strong>';
  box.style.cssText = 'background:#dcfce7;color:#15803d;border-color:#86efac;';

  setTimeout(() => {
    closeModal('modal-pix');
    box.innerHTML = '<i class="fa-solid fa-clock"></i> Reserva expira em: <strong id="pix-countdown">10:00</strong>';
    box.style.cssText = '';
    openSuccessModal(nums);
  }, 2000);
}

function handlePaymentExpired() {
  stopPixCountdown();
  stopPaymentPolling();
  if (state.unsubReservation) { state.unsubReservation(); state.unsubReservation = null; }
  closeModal('modal-pix');
  alert('Tempo esgotado. Seus números foram liberados.');
}

function startPaymentPolling(reservationId, nums) {
  stopPaymentPolling();
  state.pollTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/status?reservationId=${encodeURIComponent(reservationId)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.status === 'confirmed') {
        handlePaymentConfirmed(nums);
      } else if (data.status === 'rejected' || data.status === 'expired') {
        handlePaymentExpired();
      }
    } catch (_) {}
  }, 5000);
}

function stopPaymentPolling() {
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
}

function closePixModal() {
  stopPixCountdown();
  stopPaymentPolling();
  if (state.unsubReservation) { state.unsubReservation(); state.unsubReservation = null; }
  closeModal('modal-pix');
}

function openSuccessModal(nums) {
  document.getElementById('success-numbers-list').textContent =
    nums.map(n => String(n).padStart(2, '0')).join(', ');
  state.selected.clear();
  updateCart();
  openModal('modal-success');
}

function closeSuccessModal() { closeModal('modal-success'); }

function startPixCountdown(durationMs, reservationId) {
  const endTime = Date.now() + durationMs;
  const display = document.getElementById('pix-countdown');

  stopPixCountdown();

  state.pixTimer = setInterval(async () => {
    const remaining = endTime - Date.now();
    if (remaining <= 0) {
      stopPixCountdown();
      display.textContent = '00:00';
      await fetch('/api/expire', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reservationId }),
      });
      return;
    }
    const m = Math.floor(remaining / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    display.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }, 1000);
}

function stopPixCountdown() {
  if (state.pixTimer) { clearInterval(state.pixTimer); state.pixTimer = null; }
}

/* =========================================
   COPY PIX
   ========================================= */
function copyPix() {
  const key = document.getElementById('pix-key-value').value;
  const btn = document.getElementById('btn-copy-pix');

  if (!key || key === '(chave pix aqui)') {
    alert('Chave PIX não disponível.');
    return;
  }

  const finish = () => {
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Copiado!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = '<i class="fa-solid fa-copy"></i> Copiar';
      btn.classList.remove('copied');
    }, 2000);
  };

  navigator.clipboard.writeText(key).then(finish).catch(() => {
    document.getElementById('pix-key-value').select();
    document.execCommand('copy');
    finish();
  });
}

/* =========================================
   HELPERS
   ========================================= */
function openModal(id) {
  document.getElementById(id).classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
  document.body.style.overflow = '';
}

function showError(inputId, errId, msg) {
  const input = document.getElementById(inputId);
  input.classList.add('error', 'input-shake');
  document.getElementById(errId).textContent = msg;
  setTimeout(() => input.classList.remove('input-shake'), 400);
}

function clearError(inputId, errId) {
  document.getElementById(inputId).classList.remove('error');
  document.getElementById(errId).textContent = '';
}

function formatCurrency(value) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function maskPhone(e) {
  let v = e.target.value.replace(/\D/g, '').slice(0, 11);
  if (v.length >= 7)      v = v.replace(/^(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
  else if (v.length >= 3) v = v.replace(/^(\d{2})(\d+)/, '($1) $2');
  e.target.value = v;
}

function maskCpf(e) {
  let v = e.target.value.replace(/\D/g, '').slice(0, 11);
  if (v.length >= 10)     v = v.replace(/^(\d{3})(\d{3})(\d{3})(\d{0,2})/, '$1.$2.$3-$4');
  else if (v.length >= 7) v = v.replace(/^(\d{3})(\d{3})(\d+)/, '$1.$2.$3');
  else if (v.length >= 4) v = v.replace(/^(\d{3})(\d+)/, '$1.$2');
  e.target.value = v;
}

function validarCpf(cpf) {
  const c = cpf.replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += parseInt(c[i]) * (10 - i);
  let r = (s * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  if (r !== parseInt(c[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += parseInt(c[i]) * (11 - i);
  r = (s * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  return r === parseInt(c[10]);
}
