const express = require('express');
const https = require('https');
const cors = require('cors');
const morgan = require('morgan');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// --- CONSTANTS ---
const CONFIG = {
  PAYPHONE_HOSTNAME: 'pay.payphonetodoesposible.com',
  PAYPHONE_PORT: 443,
  DEFAULT_PORT: 3000,
  TAX_RATE: 0.15, // Mantenemos el IVA estándar de Ecuador para cálculos de PayPhone y base.
  CURRENCY: 'USD',
  COUNTRY_CODE: 'EC',
  DEFAULT_PROVINCE: 'Pichincha',
  DEFAULT_CITY: 'Quito',
  DEFAULT_ADDRESS: 'Dirección Principal',
  DEFAULT_POSTAL_CODE: '170150',
  DEFAULT_FIRST_NAME: 'Cliente',
  DEFAULT_LAST_NAME: 'Vélours',
  LOCAL_SERVER_URL: 'http://localhost:3000',
  HTTP_STATUS: {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    NOT_FOUND: 404,
    INTERNAL_SERVER_ERROR: 500
  },
  ORDER_STATUS: {
    PENDING: 'Pending',
    PAID: 'Paid',
    FAILED: 'Failed',
    REFUNDED: 'Refunded'
  }
};

const DB_PATH = path.join(__dirname, 'database.json');

// --- HELPERS DE RESPUESTA ---
function sendSuccessResponse(res, status, data, message = 'Operación exitosa') {
  return res.status(status).json({
    success: true,
    message,
    data
  });
}

function sendErrorResponse(res, status, errorMessage, errorDetails = null) {
  // Aseguramos que ningún error se trague silenciosamente registrándolo siempre.
  if (errorDetails) {
    console.error(`[ERROR] ${errorMessage}:`, errorDetails);
  } else {
    console.error(`[ERROR] ${errorMessage}`);
  }

  return res.status(status).json({
    success: false,
    error: {
      message: errorMessage,
      details: errorDetails ? errorDetails.message || errorDetails : undefined
    }
  });
}

// --- CORE UTILS ---
/**
 * Realiza una solicitud POST con el módulo nativo https de Node.js a la API de PayPhone.
 * Esto evita problemas de compatibilidad de HTTP/2 y chunked-encoding de 'fetch' (undici).
 */
function executePayphonePostRequest(requestPath, requestBody, bearerToken) {
  return new Promise((resolve, reject) => {
    const dataString = JSON.stringify(requestBody);
    const options = {
      hostname: CONFIG.PAYPHONE_HOSTNAME,
      port: CONFIG.PAYPHONE_PORT,
      path: requestPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(dataString),
        'Authorization': `Bearer ${bearerToken}`
      }
    };

    const request = https.request(options, (response) => {
      let responseBody = '';
      response.on('data', (chunk) => {
        responseBody += chunk;
      });
      response.on('end', () => {
        resolve({
          status: response.statusCode,
          ok: response.statusCode >= 200 && response.statusCode < 300,
          text: responseBody
        });
      });
    });

    request.on('error', (requestError) => {
      reject(requestError);
    });

    request.write(dataString);
    request.end();
  });
}

async function readDatabaseData() {
  try {
    const fileData = await fs.readFile(DB_PATH, 'utf8');
    return JSON.parse(fileData);
  } catch (readError) {
    console.error("Error leyendo database.json, inicializando base vacía", readError);
    return { products: [], orders: [] };
  }
}

async function writeDatabaseData(databaseData) {
  await fs.writeFile(DB_PATH, JSON.stringify(databaseData, null, 2), 'utf8');
}

// --- BUSINESS LOGIC HELPERS ---

function validateAndCalculateOrderTotals(database, items, shippingCost) {
  let subtotalAmount = 0;
  const validatedOrderItems = [];

  for (const currentItem of items) {
    const matchedProduct = database.products.find((databaseProduct) => databaseProduct.id === currentItem.id);
    if (!matchedProduct) {
      throw new Error(`Producto no encontrado en inventario: ${currentItem.id}`);
    }
    
    const itemSubtotal = matchedProduct.price * currentItem.quantity;
    subtotalAmount += itemSubtotal;
    
    validatedOrderItems.push({
      id: matchedProduct.id,
      name: matchedProduct.name,
      price: matchedProduct.price,
      quantity: currentItem.quantity,
      size: currentItem.size || 'M',
      subtotal: itemSubtotal
    });
  }

  // Ecuador: 15% de IVA sobre el subtotal de productos gravados.
  const taxAmount = Math.round(subtotalAmount * CONFIG.TAX_RATE * 100) / 100;
  const shippingAmount = shippingCost || 0;
  const totalAmount = Math.round((subtotalAmount + taxAmount + shippingAmount) * 100) / 100;

  return { validatedOrderItems, subtotalAmount, taxAmount, shippingAmount, totalAmount };
}

function formatClientPhoneNumber(rawPhoneNumber) {
  // E.164 phone formatting para evitar errores del API de PayPhone (+593 para Ecuador)
  let formattedPhone = rawPhoneNumber.replace(/\s+/g, '');
  if (!formattedPhone.startsWith('+')) {
    if (formattedPhone.startsWith('0')) {
      formattedPhone = `+593${formattedPhone.slice(1)}`;
    } else {
      formattedPhone = `+593${formattedPhone}`;
    }
  }
  return formattedPhone;
}

function generatePayphonePayload(buyer, validatedItems, subtotal, tax, shipping, clientTxId, storeId) {
  const formattedPhone = formatClientPhoneNumber(buyer.phoneNumber);
  const nameParts = buyer.name.trim().split(/\s+/);
  const firstName = nameParts[0] || CONFIG.DEFAULT_FIRST_NAME;
  const lastName = nameParts.slice(1).join(' ') || CONFIG.DEFAULT_LAST_NAME;

  // Cálculo matemático exacto de centavos requerido por la pasarela de pagos
  const centsSubtotal = Math.round(subtotal * 100);
  const centsTax = Math.round(tax * 100);
  const centsShipping = Math.round(shipping * 100);
  const centsAmount = centsSubtotal + centsTax + centsShipping;

  return {
    amount: centsAmount,
    amountWithoutTax: 0,
    amountWithTax: centsSubtotal,
    tax: centsTax,
    service: centsShipping,
    tip: 0,
    clientTransactionId: clientTxId,
    reference: `Pago de pedido ${clientTxId} en Velours Studio`,
    storeId: storeId,
    currency: CONFIG.CURRENCY,
    responseUrl: `${CONFIG.LOCAL_SERVER_URL}/confirm-payment`,
    cancellationUrl: `${CONFIG.LOCAL_SERVER_URL}/`,
    documentId: buyer.documentId,
    phoneNumber: formattedPhone,
    email: buyer.email,
    order: {
      billTo: {
        firstName: firstName,
        lastName: lastName,
        phoneNumber: formattedPhone,
        email: buyer.email,
        country: CONFIG.COUNTRY_CODE,
        state: buyer.province || CONFIG.DEFAULT_PROVINCE,
        locality: buyer.city || CONFIG.DEFAULT_CITY,
        address1: buyer.address || CONFIG.DEFAULT_ADDRESS,
        address2: "S/N",
        postalCode: CONFIG.DEFAULT_POSTAL_CODE
      },
      lineItems: buildPayphoneLineItems(validatedItems, centsShipping)
    }
  };
}

function buildPayphoneLineItems(validatedItems, centsShipping) {
  const lineItems = validatedItems.map((item) => ({
    productName: item.name,
    unitPrice: Math.round(item.price * 100),
    quantity: item.quantity,
    totalAmount: Math.round(item.price * (1 + CONFIG.TAX_RATE) * item.quantity * 100),
    taxAmount: Math.round(item.price * CONFIG.TAX_RATE * item.quantity * 100),
    productSKU: item.id,
    productDescription: `Prenda talla ${item.size}`
  }));

  // El servicio de envío se trata como una línea sin impuestos para que el total coincida en PayPhone.
  if (centsShipping > 0) {
    lineItems.push({
      productName: "Envío Servientrega",
      unitPrice: centsShipping,
      quantity: 1,
      totalAmount: centsShipping,
      taxAmount: 0,
      productSKU: "SHIPPING-01",
      productDescription: "Servicio de transporte a domicilio"
    });
  }

  return lineItems;
}

// --- SERVIDOR Y ENDPOINTS ---
const app = express();
const PORT = process.env.PORT || CONFIG.DEFAULT_PORT;

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/confirm-payment', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'success.html'));
});

app.get('/api/products', async (req, res) => {
  try {
    const database = await readDatabaseData();
    return sendSuccessResponse(res, CONFIG.HTTP_STATUS.OK, database.products, 'Productos obtenidos exitosamente');
  } catch (databaseError) {
    return sendErrorResponse(res, CONFIG.HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Error al obtener los productos', databaseError);
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const { buyer, items, shippingCost } = req.body;
    
    if (!buyer || !items || items.length === 0) {
      return sendErrorResponse(res, CONFIG.HTTP_STATUS.BAD_REQUEST, 'Datos de la orden incompletos');
    }

    const database = await readDatabaseData();
    
    let orderTotals;
    try {
      orderTotals = validateAndCalculateOrderTotals(database, items, shippingCost);
    } catch (validationError) {
      return sendErrorResponse(res, CONFIG.HTTP_STATUS.NOT_FOUND, validationError.message, validationError);
    }

    // Identificador único para evitar colisiones de id de cliente en PayPhone
    const clientTxId = `tx${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;

    const newOrder = {
      id: clientTxId,
      clientTxId: clientTxId,
      buyer: {
        name: buyer.name,
        email: buyer.email,
        documentId: buyer.documentId,
        phoneNumber: buyer.phoneNumber,
        province: buyer.province || CONFIG.DEFAULT_PROVINCE,
        city: buyer.city || CONFIG.DEFAULT_CITY,
        address: buyer.address || CONFIG.DEFAULT_ADDRESS
      },
      items: orderTotals.validatedOrderItems,
      subtotal: orderTotals.subtotalAmount,
      tax: orderTotals.taxAmount,
      shipping: orderTotals.shippingAmount,
      total: orderTotals.totalAmount,
      status: CONFIG.ORDER_STATUS.PENDING,
      payphoneTransactionId: null,
      payphoneResponse: null,
      createdAt: new Date().toISOString()
    };

    database.orders.push(newOrder);
    await writeDatabaseData(database);

    const serverToken = process.env.PAYPHONE_SERVER_TOKEN;
    const storeId = process.env.STORE_ID;
    const isConfigured = serverToken && serverToken !== 'YOUR_PAYPHONE_SERVER_TOKEN_HERE' && serverToken.trim() !== '';

    if (!isConfigured) {
      console.log("[SIMULACIÓN] PayPhone no está configurado en .env. Usando checkout de simulación.");
      return sendSuccessResponse(res, CONFIG.HTTP_STATUS.CREATED, { ...newOrder, simulation: true }, 'Orden simulada creada exitosamente');
    }

    return await processPayphonePrepare(res, newOrder, serverToken, storeId);
  } catch (internalError) {
    return sendErrorResponse(res, CONFIG.HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Error interno del servidor al procesar la orden', internalError);
  }
});

async function processPayphonePrepare(res, order, serverToken, storeId) {
  const payphonePayload = generatePayphonePayload(order.buyer, order.items, order.subtotal, order.tax, order.shipping, order.clientTxId, storeId);
  console.log('[PAYPHONE API] Request Payload sent to Prepare:', JSON.stringify(payphonePayload, null, 2));

  try {
    const payphoneHttpResponse = await executePayphonePostRequest('/api/button/Prepare', payphonePayload, serverToken);
    console.log('[PAYPHONE API] Raw Response (Prepare):', payphoneHttpResponse.text);
    const parsedPayphoneResult = JSON.parse(payphoneHttpResponse.text);

    if (payphoneHttpResponse.ok && (parsedPayphoneResult.payWithCard || parsedPayphoneResult.payWithPayPhone || parsedPayphoneResult.paypage)) {
      return sendSuccessResponse(res, CONFIG.HTTP_STATUS.CREATED, {
        ...order,
        paypage: parsedPayphoneResult.payWithCard || parsedPayphoneResult.paypage || parsedPayphoneResult.payWithPayPhone,
        payWithCard: parsedPayphoneResult.payWithCard,
        payWithPayPhone: parsedPayphoneResult.payWithPayPhone,
        paymentId: parsedPayphoneResult.paymentId,
        simulation: false
      }, 'Transacción preparada en PayPhone');
    }

    return sendErrorResponse(res, CONFIG.HTTP_STATUS.BAD_REQUEST, 'Error al preparar transacción con PayPhone', parsedPayphoneResult);
  } catch (gatewayError) {
    return sendErrorResponse(res, CONFIG.HTTP_STATUS.BAD_REQUEST, 'La pasarela PayPhone retornó un error de formato o conexión', gatewayError);
  }
}

app.post('/api/orders/confirm', async (req, res) => {
  try {
    const { transactionId, clientTxId } = req.body;

    if (!transactionId || !clientTxId) {
      return sendErrorResponse(res, CONFIG.HTTP_STATUS.BAD_REQUEST, 'Faltan parámetros transactionId o clientTxId');
    }

    const database = await readDatabaseData();
    const targetOrderIndex = database.orders.findIndex((databaseOrder) => databaseOrder.clientTxId === clientTxId);

    if (targetOrderIndex === -1) {
      return sendErrorResponse(res, CONFIG.HTTP_STATUS.NOT_FOUND, 'Orden no encontrada');
    }

    const currentOrder = database.orders[targetOrderIndex];
    const serverToken = process.env.PAYPHONE_SERVER_TOKEN;
    const isConfigured = serverToken && serverToken !== 'YOUR_PAYPHONE_SERVER_TOKEN_HERE' && serverToken.trim() !== '';

    if (!isConfigured) {
      return await handleSimulatedConfirmation(res, database, currentOrder, targetOrderIndex, transactionId, clientTxId);
    }

    return await handlePayphoneConfirmation(res, database, currentOrder, targetOrderIndex, transactionId, clientTxId, serverToken);
  } catch (internalError) {
    return sendErrorResponse(res, CONFIG.HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Error interno del servidor al procesar la confirmación', internalError);
  }
});

async function handleSimulatedConfirmation(res, database, currentOrder, orderIndex, transactionId, clientTxId) {
  console.log(`[SIMULACIÓN] Confirmando orden ${clientTxId} de forma local.`);
  
  currentOrder.status = CONFIG.ORDER_STATUS.PAID;
  currentOrder.payphoneTransactionId = transactionId;
  currentOrder.payphoneResponse = {
    transactionId: parseInt(transactionId) || 999999,
    status: 'Approved',
    clientTxId: clientTxId,
    amount: Math.round(currentOrder.total * 100),
    currency: CONFIG.CURRENCY,
    message: 'Aprobado (Simulación)',
    cardBrand: 'VISA Test',
    cardNumber: 'XXXXXXXXXXXX1111'
  };
  
  database.orders[orderIndex] = currentOrder;
  await writeDatabaseData(database);

  return sendSuccessResponse(res, CONFIG.HTTP_STATUS.OK, { order: currentOrder }, 'Pago confirmado exitosamente (Simulación)');
}

async function handlePayphoneConfirmation(res, database, currentOrder, orderIndex, transactionId, clientTxId, serverToken) {
  console.log(`[PAYPHONE API] Confirmando transacción ${transactionId} con el backend de PayPhone...`);

  let parsedConfirmationResult;
  try {
    const confirmationHttpResponse = await executePayphonePostRequest('/api/button/V2/Confirm', {
      id: parseInt(transactionId),
      clientTxId: clientTxId
    }, serverToken);
    
    console.log('[PAYPHONE API] Raw Response (Confirm):', confirmationHttpResponse.text);
    parsedConfirmationResult = JSON.parse(confirmationHttpResponse.text);
  } catch (networkError) {
    return sendErrorResponse(res, CONFIG.HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Error interno al procesar la confirmación con PayPhone', networkError);
  }

  const payphoneStatus = parsedConfirmationResult.transactionStatus || parsedConfirmationResult.status;

  if (payphoneStatus === 'Approved') {
    currentOrder.status = CONFIG.ORDER_STATUS.PAID;
    currentOrder.payphoneTransactionId = transactionId;
    currentOrder.payphoneResponse = parsedConfirmationResult;
    
    database.orders[orderIndex] = currentOrder;
    await writeDatabaseData(database);

    return sendSuccessResponse(res, CONFIG.HTTP_STATUS.OK, { order: currentOrder }, 'Pago verificado y aprobado por PayPhone');
  }

  currentOrder.status = CONFIG.ORDER_STATUS.FAILED;
  currentOrder.payphoneTransactionId = transactionId;
  currentOrder.payphoneResponse = parsedConfirmationResult;

  database.orders[orderIndex] = currentOrder;
  await writeDatabaseData(database);

  return sendErrorResponse(res, CONFIG.HTTP_STATUS.BAD_REQUEST, `El pago no fue aprobado. Estado de PayPhone: ${payphoneStatus}`, { order: currentOrder, result: parsedConfirmationResult });
}

app.post('/api/orders/reverse', async (req, res) => {
  try {
    const { clientTxId } = req.body;

    if (!clientTxId) {
      return sendErrorResponse(res, CONFIG.HTTP_STATUS.BAD_REQUEST, 'Falta el parámetro clientTxId');
    }

    const database = await readDatabaseData();
    const targetOrderIndex = database.orders.findIndex((databaseOrder) => databaseOrder.clientTxId === clientTxId);

    if (targetOrderIndex === -1) {
      return sendErrorResponse(res, CONFIG.HTTP_STATUS.NOT_FOUND, 'Orden no encontrada');
    }

    const currentOrder = database.orders[targetOrderIndex];

    // Restricción de negocio: el reembolso solo aplica a órdenes ya pagadas.
    if (currentOrder.status !== CONFIG.ORDER_STATUS.PAID) {
      return sendErrorResponse(res, CONFIG.HTTP_STATUS.BAD_REQUEST, 'Solo se pueden reversar órdenes con estado Paid');
    }

    const serverToken = process.env.PAYPHONE_SERVER_TOKEN;
    const isConfigured = serverToken && serverToken !== 'YOUR_PAYPHONE_SERVER_TOKEN_HERE' && serverToken.trim() !== '';

    if (!isConfigured) {
      console.log(`[SIMULACIÓN] Reversando orden ${clientTxId} de forma local.`);
      currentOrder.status = CONFIG.ORDER_STATUS.REFUNDED;
      currentOrder.payphoneResponse = {
        ...currentOrder.payphoneResponse,
        transactionStatus: 'Refunded',
        status: 'Refunded',
        message: 'Reversado (Simulación)'
      };
      database.orders[targetOrderIndex] = currentOrder;
      await writeDatabaseData(database);
      
      return sendSuccessResponse(res, CONFIG.HTTP_STATUS.OK, { order: currentOrder }, 'Pago reversado exitosamente (Simulación)');
    }

    return await executePayphoneReverse(res, database, currentOrder, targetOrderIndex, clientTxId, serverToken);
  } catch (internalError) {
    return sendErrorResponse(res, CONFIG.HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Error interno del servidor al procesar el reverso', internalError);
  }
});

async function executePayphoneReverse(res, database, currentOrder, orderIndex, clientTxId, serverToken) {
  console.log(`[PAYPHONE API] Iniciando reverso para la transacción local ${clientTxId}...`);
  
  let reverseParsedResult;
  let reverseHttpResponse;
  try {
    reverseHttpResponse = await executePayphonePostRequest('/api/Reverse/Client', {
      clientTransactionId: clientTxId
    }, serverToken);
    
    console.log('[PAYPHONE API] Raw Response (Reverse):', reverseHttpResponse.text);
    reverseParsedResult = JSON.parse(reverseHttpResponse.text);
  } catch (networkError) {
    return sendErrorResponse(res, CONFIG.HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Error interno al procesar el reverso con PayPhone', networkError);
  }

  if (reverseHttpResponse.ok) {
    currentOrder.status = CONFIG.ORDER_STATUS.REFUNDED;
    currentOrder.payphoneResponse = {
      ...currentOrder.payphoneResponse,
      reverseResult: reverseParsedResult,
      transactionStatus: 'Refunded',
      status: 'Refunded'
    };
    database.orders[orderIndex] = currentOrder;
    await writeDatabaseData(database);
    return sendSuccessResponse(res, CONFIG.HTTP_STATUS.OK, { order: currentOrder }, 'Reverso completado en PayPhone');
  }

  return sendErrorResponse(res, CONFIG.HTTP_STATUS.BAD_REQUEST, 'La pasarela no pudo procesar el reverso', reverseParsedResult);
}

app.get('/api/orders/:id', async (req, res) => {
  try {
    const orderId = req.params.id;
    const database = await readDatabaseData();
    const targetOrder = database.orders.find((databaseOrder) => databaseOrder.id === orderId);

    if (!targetOrder) {
      return sendErrorResponse(res, CONFIG.HTTP_STATUS.NOT_FOUND, 'Orden no encontrada');
    }

    return sendSuccessResponse(res, CONFIG.HTTP_STATUS.OK, targetOrder, 'Orden obtenida exitosamente');
  } catch (internalError) {
    return sendErrorResponse(res, CONFIG.HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Error al consultar la orden', internalError);
  }
});

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` Tienda Online de Ropa de Vélours Studio `);
  console.log(` Servidor backend corriendo en http://localhost:${PORT} `);
  console.log(`==================================================`);
});
