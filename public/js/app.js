// Estado Global de la Tienda
let products = [];
let cart = [];
try {
  const savedCart = localStorage.getItem('velours_cart');
  cart = savedCart ? JSON.parse(savedCart) : [];
  if (!Array.isArray(cart)) cart = [];
} catch (err) {
  console.error("Error al inicializar el carrito:", err);
  cart = [];
}
let selectedSize = 'M';
let activeProductId = null;

// Elementos DOM
const productsContainer = document.getElementById('products-catalog-container');
const cartDrawer = document.getElementById('shopping-cart-drawer');
const cartToggleBtn = document.getElementById('cart-toggle-btn');
const cartCloseBtn = document.getElementById('cart-close-btn');
const pageOverlay = document.getElementById('page-overlay');
const cartBadgeCount = document.getElementById('cart-badge-count');
const cartItemsContainer = document.getElementById('cart-items-list-container');
const cartSubtotalVal = document.getElementById('cart-subtotal-val');
const cartShippingVal = document.getElementById('cart-shipping-val');
const cartTotalVal = document.getElementById('cart-total-val');
const goToCheckoutBtn = document.getElementById('go-to-checkout-btn');

// Modal Detalle
const productDetailModal = document.getElementById('product-detail-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalImg = document.getElementById('modal-product-image');
const modalTitle = document.getElementById('modal-product-title');
const modalPrice = document.getElementById('modal-product-price');
const modalDesc = document.getElementById('modal-product-desc');
const modalSizes = document.getElementById('modal-product-sizes');
const modalAddToCartBtn = document.getElementById('modal-add-to-cart-btn');

// Toast
const toast = document.getElementById('notification-toast');
const toastMsg = document.getElementById('toast-message');

// --- CARGA DE DATOS ---

// Obtener productos desde Express
async function fetchProducts() {
  try {
    const res = await fetch('/api/products');
    const responseData = await res.json();
    if (!res.ok || !responseData.success) {
      throw new Error(responseData.error?.message || responseData.message || "Error al obtener los productos");
    }
    products = responseData.data;
    renderProducts();
  } catch (err) {
    console.error("Error cargando productos:", err);
    productsContainer.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 4rem 0; color: #ff4a4a;">
        <i class="bx bx-error-circle" style="font-size: 3rem; margin-bottom: 1rem;"></i>
        <p>No pudimos cargar la colección. Intenta de nuevo más tarde.</p>
      </div>
    `;
  }
}

// Renderizar las tarjetas de producto en el catálogo
function renderProducts() {
  if (products.length === 0) return;
  
  productsContainer.innerHTML = products.map(product => `
    <div class="product-card">
      <div class="product-img-wrapper" onclick="openProductModal('${product.id}')" style="cursor: pointer;">
        <span class="product-category">${product.category}</span>
        <img src="${product.image}" alt="${product.name}" class="product-img" loading="lazy">
      </div>
      <div class="product-info">
        <h3 class="product-name" onclick="openProductModal('${product.id}')" style="cursor: pointer;">${product.name}</h3>
        <p class="product-desc">${product.description}</p>
        <div class="product-footer">
          <span class="product-price">$${product.price.toFixed(2)}</span>
          <button class="add-cart-btn" onclick="addToCart('${product.id}', 'M', 1); event.stopPropagation();">
            <i class="bx bx-plus-circle"></i> Agregar
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

// --- MÉTODOS DEL CARRITO ---

// Agregar producto al carrito
function addToCart(productId, size, quantity = 1) {
  const product = products.find(p => p.id === productId);
  if (!product) return;

  const existingItemIndex = cart.findIndex(item => item.id === productId && item.size === size);

  if (existingItemIndex > -1) {
    cart[existingItemIndex].quantity += quantity;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      price: product.price,
      image: product.image,
      size: size,
      quantity: quantity
    });
  }

  saveCart();
  updateCartUI();
  showToast(`¡${product.name} (${size}) agregado a la bolsa!`);
}

// Guardar en LocalStorage
function saveCart() {
  localStorage.setItem('velours_cart', JSON.stringify(cart));
}

// Actualizar cantidad en carrito
function updateItemQuantity(productId, size, change) {
  const index = cart.findIndex(item => item.id === productId && item.size === size);
  if (index === -1) return;

  cart[index].quantity += change;

  if (cart[index].quantity <= 0) {
    cart.splice(index, 1);
  }

  saveCart();
  updateCartUI();
}

// Eliminar de carrito
function removeFromCart(productId, size) {
  cart = cart.filter(item => !(item.id === productId && item.size === size));
  saveCart();
  updateCartUI();
  showToast("Prenda eliminada de la bolsa");
}

// Calcular Totales y Renderizar Carrito
function updateCartUI() {
  // Cantidad total en el badge
  const totalQty = cart.reduce((acc, item) => acc + item.quantity, 0);
  cartBadgeCount.textContent = totalQty;

  if (cart.length === 0) {
    cartItemsContainer.innerHTML = `
      <p class="cart-empty-msg">Tu bolsa de compras está vacía.</p>
    `;
    cartSubtotalVal.textContent = '$0.00';
    cartShippingVal.textContent = '$0.00';
    cartTotalVal.textContent = '$0.00';
    return;
  }

  // Renderizar ítems
  cartItemsContainer.innerHTML = cart.map(item => `
    <div class="cart-item">
      <img src="${item.image}" alt="${item.name}" class="cart-item-img">
      <div class="cart-item-details">
        <h4 class="cart-item-name">${item.name}</h4>
        <p class="cart-item-meta">Talla: ${item.size}</p>
        <span class="cart-item-price">$${item.price.toFixed(2)}</span>
      </div>
      <div class="cart-item-actions">
        <div class="qty-controls">
          <button class="qty-btn" onclick="updateItemQuantity('${item.id}', '${item.size}', -1)">-</button>
          <span class="qty-val">${item.quantity}</span>
          <button class="qty-btn" onclick="updateItemQuantity('${item.id}', '${item.size}', 1)">+</button>
        </div>
        <button class="cart-item-remove" onclick="removeFromCart('${item.id}', '${item.size}')">Eliminar</button>
      </div>
    </div>
  `).join('');

  // Totales
  const subtotal = cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);
  // Envío gratis sobre $50
  const shipping = subtotal >= 50 ? 0 : 5.00;
  const total = subtotal + shipping;

  cartSubtotalVal.textContent = `$${subtotal.toFixed(2)}`;
  cartShippingVal.textContent = shipping === 0 ? 'GRATIS' : `$${shipping.toFixed(2)}`;
  cartTotalVal.textContent = `$${total.toFixed(2)}`;
}

// --- MODAL DE DETALLE DE PRODUCTO ---

function openProductModal(productId) {
  const product = products.find(p => p.id === productId);
  if (!product) return;

  activeProductId = productId;
  selectedSize = product.sizes[0]; // Selecciona la primera talla disponible por defecto

  modalImg.src = product.image;
  modalImg.alt = product.name;
  modalTitle.textContent = product.name;
  modalPrice.textContent = `$${product.price.toFixed(2)}`;
  modalDesc.textContent = product.description;

  // Renderizar selector de tallas
  modalSizes.innerHTML = product.sizes.map(size => `
    <button class="size-btn ${size === selectedSize ? 'active' : ''}" onclick="selectSize('${size}')">${size}</button>
  `).join('');

  productDetailModal.classList.add('active');
  pageOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function selectSize(size) {
  selectedSize = size;
  const buttons = modalSizes.querySelectorAll('.size-btn');
  buttons.forEach(btn => {
    if (btn.textContent === size) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function closeModal() {
  productDetailModal.classList.remove('active');
  // Solo apaga el overlay si el carrito tampoco está activo
  if (!cartDrawer.classList.contains('active')) {
    pageOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }
}

// --- UTILERÍAS ---

function showToast(message) {
  toastMsg.textContent = message;
  toast.classList.add('active');
  setTimeout(() => {
    toast.classList.remove('active');
  }, 3000);
}

function toggleCartDrawer() {
  const isActive = cartDrawer.classList.toggle('active');
  pageOverlay.classList.toggle('active', isActive || productDetailModal.classList.contains('active'));
  document.body.style.overflow = isActive ? 'hidden' : '';
}

// --- EVENTOS ---

cartToggleBtn.addEventListener('click', toggleCartDrawer);
cartCloseBtn.addEventListener('click', toggleCartDrawer);
modalCloseBtn.addEventListener('click', closeModal);
pageOverlay.addEventListener('click', () => {
  cartDrawer.classList.remove('active');
  closeModal();
});

modalAddToCartBtn.addEventListener('click', () => {
  if (activeProductId) {
    addToCart(activeProductId, selectedSize, 1);
    closeModal();
  }
});

// Logo Click para refrescar o volver al catálogo
document.getElementById('logo-btn').addEventListener('click', (e) => {
  e.preventDefault();
  const catalogView = document.getElementById('catalog-view');
  const checkoutView = document.getElementById('checkout-view');
  catalogView.style.display = 'block';
  checkoutView.classList.remove('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// Carga Inicial
fetchProducts();
updateCartUI();
