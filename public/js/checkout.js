// Elementos del DOM de Checkout
const catalogView = document.getElementById('catalog-view');
const checkoutView = document.getElementById('checkout-view');
const goToCheckoutBtnInCart = document.getElementById('go-to-checkout-btn');
const backToShopBtn = document.getElementById('back-to-shop-btn');
const checkoutSummaryItemsList = document.getElementById('checkout-summary-items-list');

// Totales de Checkout
const checkoutSubtotalVal = document.getElementById('checkout-summary-subtotal');
const checkoutTaxVal = document.getElementById('checkout-summary-tax');
const checkoutShippingVal = document.getElementById('checkout-summary-shipping');
const checkoutTotalVal = document.getElementById('checkout-summary-total');

// Inputs Formulario
const clientNameInput = document.getElementById('client-name');
const clientEmailInput = document.getElementById('client-email');
const clientPhoneInput = document.getElementById('client-phone');
const clientDocumentInput = document.getElementById('client-document');
const clientProvinceInput = document.getElementById('client-province');
const clientCityInput = document.getElementById('client-city');
const clientAddressInput = document.getElementById('client-address');
const simulatedPayphoneBtn = document.getElementById('simulated-payphone-btn');

// --- OPERACIONES DE NAVEGACIÓN ---

// Cambiar a vista de checkout
function openCheckoutView() {
  if (cart.length === 0) {
    showToast("Agrega al menos una prenda a tu bolsa para pagar");
    return;
  }

  // Cerrar carrito
  cartDrawer.classList.remove('active');
  pageOverlay.classList.remove('active');
  document.body.style.overflow = '';

  // Alternar vistas
  catalogView.style.display = 'none';
  checkoutView.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Renderizar resumen de compra
  updateCheckoutSummary();
}

// Volver a la vista del catálogo
function closeCheckoutView() {
  checkoutView.classList.remove('active');
  catalogView.style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Renderizar e-commerce totals en checkout
function updateCheckoutSummary() {
  if (cart.length === 0) {
    checkoutSummaryItemsList.innerHTML = '<p style="color: var(--text-muted);">Sin ítems</p>';
    return;
  }

  // Listar ítems simplificados
  checkoutSummaryItemsList.innerHTML = cart.map(item => `
    <div class="order-summary-item">
      <div>
        <div class="summary-item-name">${item.name}</div>
        <div class="summary-item-meta">Talla: ${item.size} x ${item.quantity}</div>
      </div>
      <span class="summary-item-price">$${(item.price * item.quantity).toFixed(2)}</span>
    </div>
  `).join('');

  // Totales
  const subtotal = cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);
  const tax = subtotal * 0.15; // IVA 15%
  const shipping = subtotal >= 50 ? 0 : 5.00;
  const total = subtotal + tax + shipping;

  checkoutSubtotalVal.textContent = `$${subtotal.toFixed(2)}`;
  checkoutTaxVal.textContent = `$${tax.toFixed(2)}`;
  checkoutShippingVal.textContent = shipping === 0 ? 'GRATIS' : `$${shipping.toFixed(2)}`;
  checkoutTotalVal.textContent = `$${total.toFixed(2)}`;
}

// --- PROCESO DE COMPRA ---

// Validar formulario de cliente
function validateCheckoutForm() {
  const name = clientNameInput.value.trim();
  const email = clientEmailInput.value.trim();
  const phone = clientPhoneInput.value.trim();
  const doc = clientDocumentInput.value.trim();
  const province = clientProvinceInput.value.trim();
  const city = clientCityInput.value.trim();
  const address = clientAddressInput.value.trim();

  if (!name || !email || !phone || !doc || !province || !city || !address) {
    showToast("Por favor completa todos los campos de envío");
    return false;
  }

  // Validaciones básicas de regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    showToast("El correo electrónico no es válido");
    return false;
  }

  if (phone.length < 9) {
    showToast("El número de teléfono debe tener al menos 9 dígitos");
    return false;
  }

  if (doc.length < 10) {
    showToast("La cédula o RUC debe tener al menos 10 dígitos");
    return false;
  }

  return { 
    name, 
    email, 
    phoneNumber: phone, 
    documentId: doc,
    province,
    city,
    address
  };
}

// Iniciar proceso de pago (Crear orden en backend y simular PayPhone)
async function processOrderCheckout() {
  const buyerData = validateCheckoutForm();
  if (!buyerData) return;

  // Deshabilitar botón temporalmente
  simulatedPayphoneBtn.disabled = true;
  simulatedPayphoneBtn.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> Preparando Orden...';

  try {
    const subtotal = cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);
    const shipping = subtotal >= 50 ? 0 : 5.00;

    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        buyer: buyerData,
        items: cart.map(item => ({ id: item.id, quantity: item.quantity, size: item.size })),
        shippingCost: shipping
      })
    });

    const responseData = await response.json();

    if (!response.ok) {
      throw new Error(responseData.error?.message || responseData.error || 'Error al procesar la orden en el servidor');
    }

    const order = responseData.data;
    console.log('[BACKEND] Orden creada:', order);

    // Redireccionar al formulario de PayPhone si está disponible
    if (order.paypage) {
      showToast("Redireccionando a pasarela segura PayPhone...");
      setTimeout(() => {
        window.location.href = order.paypage;
      }, 1200);
    } else {
      simulatePayPhonePayment(order);
    }

  } catch (error) {
    console.error("Error en checkout:", error);
    showToast(error.message);
    simulatedPayphoneBtn.disabled = false;
    simulatedPayphoneBtn.innerHTML = '<i class="bx bx-credit-card"></i> Pagar con Tarjeta (PayPhone)';
  }
}

// Simulación del cobro PayPhone (Redirección con parámetros)
function simulatePayPhonePayment(order) {
  showToast("Redireccionando a Pasarela PayPhone (Prueba)...");
  
  setTimeout(() => {
    // Generar un ID de transacción aleatorio (representa el ID de transacción de Payphone)
    const mockTransactionId = Math.floor(100000 + Math.random() * 900000);
    
    // Redireccionar a success.html simulando el retorno de PayPhone con query params
    window.location.href = `/success.html?id=${mockTransactionId}&clientTxId=${order.clientTxId}`;
  }, 1500);
}

// --- EVENTOS ---
goToCheckoutBtnInCart.addEventListener('click', openCheckoutView);
backToShopBtn.addEventListener('click', closeCheckoutView);
simulatedPayphoneBtn.addEventListener('click', processOrderCheckout);
