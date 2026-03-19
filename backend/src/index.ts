import { createClient } from '@supabase/supabase-js';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_KEY: string;
  GROQ_API_KEY: string;
  WA_PHONE_ID: string; // <-- NUEVO
  WA_TOKEN: string;    // <-- NUEVO
  ENVIRONMENT: string;         // <-- NUEVO
  PAYPAL_API_URL: string;      // <-- NUEVO
  PAYPAL_SAAS_CLIENT_ID: string; // <-- NUEVO
  PAYPAL_SAAS_SECRET: string;  // <-- NUEVO
  BREVO_API_KEY: string;
}

export default {
    
  // =========================================================================
  // 1. EVENTO FETCH (Atiende las peticiones HTTP del Frontend)
  // =========================================================================
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    //if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    // 1. Definimos quiénes tienen la llave para entrar a tu API
    const origenesPermitidos = [
      'https://jsmemberly.com',       // <-- TU NUEVO DOMINIO OFICIAL
      'https://www.jsmemberly.com',   // <-- POR SI ENTRAN CON WWW
      'https://jsmemberly.pages.dev', // (Opcional, déjalo por si acaso)
      'http://127.0.0.1:5500'         
    ];

    // 2. Le preguntamos a la petición: "¿Desde qué página vienes?"
    const origenPeticion = request.headers.get('Origin') || '';

    // 3. Si vienes de un lugar permitido, te abro la puerta. Si no, uso el principal por defecto.
    const originSeguro = origenesPermitidos.includes(origenPeticion) 
      ? origenPeticion 
      : 'https://www.jsmemberly.com/';

    // 4. Armamos los cabeceros dinámicamente para esta petición exacta
    const corsHeaders = {
      'Access-Control-Allow-Origin': originSeguro,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // 5. Respondemos a la petición de verificación (Preflight) del navegador
    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    const authHeader = request.headers.get('Authorization');
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader ? authHeader : '' } }
    });

    const url = new URL(request.url);

    // --- ENDPOINTS DE LECTURA ---
    if (url.pathname === '/planes' && request.method === 'GET') {
      try {
        const { data, error } = await supabase.from('planes').select('*');
        if (error) throw error; // Si Supabase falla, lanzamos el error
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } catch (e: any) {
        // Devolvemos el error con los corsHeaders para que el frontend lo pueda leer
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    if (url.pathname === '/suscriptores' && request.method === 'GET') {
      try {
        const { data, error } = await supabase.from('suscriptores').select('*');
        if (error) throw error; // Si Supabase falla, lanzamos el error
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } catch (e: any) {
        // Devolvemos el error con los corsHeaders para que el frontend lo pueda leer
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // --- CHATBOT DE VENTAS CON IA (GROQ / LLAMA 3) ---
    if (url.pathname === '/chat' && request.method === 'POST') {
      try {
        if (!env.GROQ_API_KEY) {
            throw new Error("Falta la variable GROQ_API_KEY en .dev.vars o en Cloudflare.");
        }

        const body = await request.json() as any;
        const mensajeUsuario = body.mensaje || "Hola";

        // ==============================================================
        // NUEVO: DETECCIÓN Y CAPTURA DE PROSPECTOS (LEADS) VÍA REGEX
        // ==============================================================
        // 1. Definimos los patrones matemáticos para atrapar datos
        const regexEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
        // Atrapa teléfonos de al menos 8 dígitos, con o sin el "+" (Ideal para +593 o locales)
        const regexTelefono = /(\+?\d[\d\s-]{7,14}\d)/; 

        // 2. Buscamos coincidencias en el mensaje del usuario
        const posibleEmail = mensajeUsuario.match(regexEmail);
        const posibleTelefono = mensajeUsuario.match(regexTelefono);
        
        // 3. Si encuentra algo, lo asignamos a una variable
        const datoContacto = (posibleEmail ? posibleEmail[0] : null) || (posibleTelefono ? posibleTelefono[0] : null);

        // 4. Si atrapamos un dato, lo guardamos silenciosamente en Supabase
        if (datoContacto) {
            console.log("🚀 ¡Nuevo prospecto capturado! ->", datoContacto);
            
            const { error: dbError } = await supabase.from('prospectos_chat').insert([{
                dato_contacto: datoContacto,
                mensaje_original: mensajeUsuario
            }]);
            
            if (dbError) console.error("Error guardando prospecto:", dbError.message);
        }
        // ==============================================================

        // 1. Usamos la API de Groq (Compatible con el estándar de OpenAI)
        const groqUrl = "https://api.groq.com/openai/v1/chat/completions";

        // 2. Preparamos el payload con el modelo ultrarrápido Llama 3
        const payload = {
          model: "llama-3.3-70b-versatile",
          messages: [
            { 
              role: "system", 
              content: `Eres el asistente virtual de ventas de 'JS MemberLy', un software SaaS moderno para gestionar gimnasios. Tu objetivo es ser muy amable, profesional y convencer a los dueños de gimnasios de usar nuestro sistema. 

              Planes y características principales:
              - Starter ($20/mes, $200/anual): Hasta 100 clientes activos, pases de acceso con código QR, staff ilimitado y dashboard de métricas básicas.
              - Pro ($45/mes, $450/anual): Hasta 500 clientes activos, todo lo del plan Starter + envío de recordatorios automáticos de pago a clientes por WhatsApp.
              - Elite ($125/mes, $1250/anual): Clientes ilimitados sin restricciones, todo lo de Pro + reportes financieros avanzados (Ingreso Recurrente MRR, Flujo de Caja, Tasa de Abandono) y soporte prioritario 24/7.
              (Aclara que el plan anual incluye dos meses gratis pagando el año completo).

              REGLAS ESTRICTAS:
              1. Responde en español, muy conciso (máximo 3 oraciones) y usa emojis.
              2. Si el usuario pide hablar con un humano, asesor, soporte, o dice que quiere contratar, dile EXACTAMENTE: "¡Claro que sí! 🤝 Un asesor humano puede ayudarte a resolver esto de inmediato. Por favor, déjame tu número de WhatsApp o correo electrónico y te contactaremos hoy mismo."
              3. Si detectas que el usuario te acaba de dar su número de teléfono o correo electrónico, responde EXACTAMENTE: "¡Perfecto! 📝 He guardado tus datos. Un experto de JS MemberLy se pondrá en contacto contigo muy pronto para asesorarte."`
            },
            { 
              role: "user", 
              content: mensajeUsuario 
            }
          ],
          temperature: 0.3
        };

        const aiResponse = await fetch(groqUrl, {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${env.GROQ_API_KEY}`,
            'Content-Type': 'application/json' 
          },
          body: JSON.stringify(payload)
        });

        if (!aiResponse.ok) {
            const errorGroq = await aiResponse.text();
            console.error("❌ Rechazo de Groq API:", errorGroq);
            
            // 🚨 GUARDAR EN CAJA NEGRA
            const adminSupabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
            await adminSupabase.from('errores_sistema').insert([{ 
                origen: 'Chatbot IA (Groq)', 
                mensaje: errorGroq.substring(0, 500) // Guardamos máximo 500 caracteres
            }]);

            // 🛟 PLAN B: Respuesta amigable para no perder al cliente
            const respuestaEmergencia = "¡Hola! 👋 En este momento mi sistema inteligente se está actualizando, pero me encantaría ayudarte. Por favor, déjame tu número de WhatsApp y un asesor humano te contactará de inmediato.";
            return new Response(JSON.stringify({ respuesta: respuestaEmergencia }), { status: 200, headers: corsHeaders });
        }

        const data = await aiResponse.json() as any;
        const textoRespuesta = data.choices[0].message.content;

        return new Response(JSON.stringify({ respuesta: textoRespuesta }), { status: 200, headers: corsHeaders });

      } catch (e: any) {
        // Si todo el servidor falla, también lo guardamos
        const adminSupabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
        await adminSupabase.from('errores_sistema').insert([{ origen: 'Endpoint /chat', mensaje: e.message }]);
        
        return new Response(JSON.stringify({ error: "Servicio no disponible temporalmente." }), { status: 500, headers: corsHeaders });
      }
    }

    // --- REGISTRO DE SOCIO CON FOTO ---
    if (url.pathname === '/suscriptores' && request.method === 'POST') {
      try {
        const body = await request.json() as any;
        const { data: cliente, error: errC } = await supabase.from('suscriptores').insert([{
            tenant_id: body.tenant_id,
            nombre_completo: body.nombre_completo,
            identificacion: body.identificacion,
            direccion: body.direccion,
            telefono: body.telefono,
            email: body.email,
            foto_url: body.foto_url,
            contacto_emergencia: body.contacto_emergencia,
            estado: 'Activo'
        }]).select().single();

        if (errC) throw errC;

        // 🧠 MAGIA DE FECHAS: Tomamos la fecha enviada por el formulario
        // Le sumamos 'T12:00:00' para anclarla al mediodía y evitar que reste 1 día por la zona horaria
        const fechaInicio = new Date(body.fecha_inicio + 'T12:00:00');
        
        // Calculamos el vencimiento sumando los días exactos del plan
        const fechaFin = new Date(fechaInicio);
        fechaFin.setDate(fechaFin.getDate() + parseInt(body.dias_duracion));

        await supabase.from('historial_suscripciones').insert([{
            tenant_id: body.tenant_id,
            suscriptor_id: cliente.id,
            plan_id: body.plan_id,
            precio_cobrado: body.precio_cobrado, // 💰 BUG DE PRECIO ARREGLADO
            fecha_inicio: fechaInicio.toISOString().split('T')[0], // 📅 FECHA HISTÓRICA
            fecha_fin: fechaFin.toISOString().split('T')[0],
            estado_pago: 'Pagado',
            renovacion_automatica: body.renovacion_automatica
        }]);

        return new Response(JSON.stringify({ ok: true }), { status: 201, headers: corsHeaders });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: corsHeaders });
      }
    }

    // =========================================================================
    // ESCANEO SEGURO (SOLO DESDE EL PANEL CON TOKEN)
    // =========================================================================
    if (url.pathname === '/api/escaneo-panel' && request.method === 'POST') {
        try {
            // 1. Validar seguridad (Solo personal logueado)
            const token = request.headers.get('Authorization')?.split('Bearer ')[1];
            if (!token) throw new Error("No autorizado");
            const { data: userAuth, error: authErr } = await supabase.auth.getUser(token);
            if (authErr || !userAuth.user) throw new Error("Token inválido");

            const body = await request.json() as any;
            const clienteId = body.suscriptor_id;
            const tenantId = body.tenant_id;

            // 2. Buscar al cliente
            const { data: cliente, error: errC } = await supabase.from('suscriptores').select('*').eq('id', clienteId).eq('tenant_id', tenantId).single();
            if (errC || !cliente) throw new Error("Cliente no encontrado");

            // 3. Buscar la última suscripción
            const { data: subs, error: errS } = await supabase.from('historial_suscripciones')
                .select('*')
                .eq('suscriptor_id', clienteId)
                .order('fecha_fin', { ascending: false })
                .limit(1);

            if (errS || !subs || subs.length === 0) {
                return new Response(JSON.stringify({ estado: 'Denegado', nombre: cliente.nombre_completo, motivo: 'No tiene planes registrados' }), { status: 200, headers: corsHeaders });
            }

            const sub = subs[0];
            const hoy = new Date();
            hoy.setHours(0,0,0,0);
            const fFin = new Date(sub.fecha_fin);
            fFin.setHours(0,0,0,0);

            // 4. Verificar si está expirado
            if (fFin < hoy) {
                return new Response(JSON.stringify({ estado: 'Denegado', nombre: cliente.nombre_completo, motivo: 'Plan expirado', foto: cliente.foto_url }), { status: 200, headers: corsHeaders });
            }

            // 5. Registrar la asistencia oficial (Usando Service Key para saltar el bloqueo RLS)
            const adminSupabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
            const { error: errAsistencia } = await adminSupabase.from('asistencias').insert([{
                tenant_id: tenantId,
                suscriptor_id: clienteId,
                metodo_acceso: 'QR',
                fecha_entrada: new Date().toISOString()
            }]);

            if (errAsistencia) {
                console.error("Error al registrar asistencia en BD:", errAsistencia.message);
            }

            // 6. Calcular alerta de los 3 días
            const diffTime = fFin.getTime() - hoy.getTime();
            const diasRestantes = Math.ceil(diffTime / (1000 * 3600 * 24));
            let alerta = null;
            if (diasRestantes <= 3 && diasRestantes > 0) alerta = diasRestantes;

            return new Response(JSON.stringify({ estado: 'Autorizado', nombre: cliente.nombre_completo, alerta_dias: alerta, foto: cliente.foto_url }), { status: 200, headers: corsHeaders });

        } catch (e: any) {
            return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: corsHeaders });
        }
    }

    // --- VALIDACIÓN DE QR (PANTALLA VERDE/ROJA) ---
    if (request.method === 'GET' && url.pathname.startsWith('/checkin/')) {
      const id = url.pathname.split('/')[2];
      const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
      
      // 1. Consultamos el historial y TRAEMOS LA FOTO del suscriptor
      const { data } = await admin.from('historial_suscripciones')
        .select('fecha_fin, estado_pago, tenant_id, suscriptores(nombre_completo, foto_url)')
        .eq('suscriptor_id', id)
        .order('fecha_fin', { ascending: false })
        .limit(1);

      // 2. Valores por defecto (Asumimos Pantalla Roja inicialmente)
      let res = { 
        color: "#EF4444", 
        icono: "", 
        msg: "Acceso Denegado", 
        nombre: "Cliente Desconocido", 
        foto: "https://via.placeholder.com/150?text=Sin+Foto" 
      };

      if (data && data.length > 0) {
        const h = data[0];
        const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
        
        // Asignamos el nombre
        res.nombre = (h.suscriptores as any).nombre_completo;
        
        // Si el cliente tiene una foto guardada en Supabase, la usamos
        if ((h.suscriptores as any).foto_url) {
            res.foto = (h.suscriptores as any).foto_url;
        }

        // 3. Validamos si está al día (Cambiamos a Pantalla Verde)
        if (h.estado_pago === 'Pagado' && h.fecha_fin >= hoy) {
          res = { ...res, color: "#10B981", icono: "", msg: "Pase Autorizado" };
          
          // ESCUDO ANTI-SPAM: Buscamos si ya se registró en los últimos 5 minutos
          const hace5Min = new Date(Date.now() - 5 * 60 * 1000).toISOString();
          const { data: asistenciasRecientes } = await admin.from('asistencias')
            .select('id')
            .eq('suscriptor_id', id)
            .gte('fecha_entrada', hace5Min);

          // Solo insertamos si NO hay asistencias recientes (Evita que el QR marque doble)
          if (!asistenciasRecientes || asistenciasRecientes.length === 0) {
              await admin.from('asistencias').insert([{ 
                  tenant_id: h.tenant_id, 
                  suscriptor_id: id, 
                  metodo_acceso: 'QR',
                  fecha_entrada: new Date().toISOString() // <-- Enviamos la fecha explícitamente
              }]);
          }
        }
      }

      // 4. Renderizamos el HTML (La pantalla que ve el recepcionista)
      return new Response(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Validación de Pase</title>
        </head>
        <body style="background-color: ${res.color}; color: white; font-family: system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center;">
            <div style="background: rgba(0,0,0,0.2); padding: 40px 20px; border-radius: 24px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); width: 85%; max-width: 350px;">
                
                <img src="${res.foto}" alt="Foto del Socio" style="width: 160px; height: 160px; border-radius: 50%; border: 6px solid white; object-fit: cover; margin: 15px auto; box-shadow: 0 4px 15px rgba(0,0,0,0.3); background-color: white;">
                
                <h2 style="font-size: 1.8rem; margin: 10px 0; font-weight: bold;">${res.msg}</h2>
                <p style="font-size: 1.4rem; margin: 0; font-weight: 500;">${res.nombre}</p>
            </div>
        </body>
        </html>`, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }

    // --- INTEGRACIÓN PAYPAL (SUSCRIPCIONES RECURRENTES POR GIMNASIO) ---
    if (url.pathname === '/api/pagos/generar-link' && request.method === 'POST') {
        try {
            const body = await request.json() as any;
            if (!body.tenant_id) throw new Error("Falta el tenant_id");

            // 1. Llaves dinámicas del gimnasio
            const { data: tenantInfo } = await supabase.from('tenants').select('paypal_client_id, paypal_secret').eq('id', body.tenant_id).single();
            if (!tenantInfo || !tenantInfo.paypal_client_id) throw new Error("El gimnasio no ha configurado PayPal.");

            // NOTA: Si pruebas con Sandbox, cambia api-m.paypal a api-m.sandbox.paypal.com
            const URL_PAYPAL = env.PAYPAL_API_URL;
            const auth = btoa(`${tenantInfo.paypal_client_id}:${tenantInfo.paypal_secret}`);
            
            // 2. Obtener Token de Acceso
            const tokenResponse = await fetch(`${URL_PAYPAL}/v1/oauth2/token`, {
                method: 'POST',
                headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'grant_type=client_credentials'
            });
            const tokenData = await tokenResponse.json() as any;
            const accessToken = tokenData.access_token;

            // 3. CREAR PRODUCTO EN PAYPAL
            const prodRes = await fetch(`${URL_PAYPAL}/v1/catalogs/products`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: `Membresía - ${body.nombre_cliente}`,
                    type: "SERVICE",
                    category: "SPORTING_GOODS_STORES"
                })
            });
            const prodData = await prodRes.json() as any;

            // 4. CREAR PLAN DE COBRO RECURRENTE (POR DÍAS)
            const dias = parseInt(body.dias_duracion) || 30;
            
            const planRes = await fetch(`${URL_PAYPAL}/v1/billing/plans`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    product_id: prodData.id,
                    name: `Membresía ${dias} días - ${body.nombre_cliente}`,
                    status: "ACTIVE",
                    billing_cycles: [{
                        frequency: { interval_unit: "DAY", interval_count: dias },
                        tenure_type: "REGULAR",
                        sequence: 1,
                        total_cycles: 0, 
                        pricing_scheme: { fixed_price: { value: parseFloat(body.precio_cobrado).toFixed(2), currency_code: "USD" } }
                    }],
                    payment_preferences: { auto_bill_outstanding: true, setup_fee_failure_action: "CONTINUE", payment_failure_threshold: 3 }
                })
            });
            const planData = await planRes.json() as any;

            // 5. GENERAR EL LINK DE SUSCRIPCIÓN CON LA ETIQUETA SECRETA
            const subRes = await fetch(`${URL_PAYPAL}/v1/billing/subscriptions`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    plan_id: planData.id,
                    // ESTA LÍNEA ES VITAL: Le pegamos una etiqueta al cobro para que el Webhook sepa quién pagó
                    custom_id: `GYM|${body.tenant_id}|${body.suscriptor_id}|${body.plan_id}|${dias}|${body.precio_cobrado}`,
                    application_context: {
                        return_url: "https://www.jsmemberly.com/panel.html", 
                        cancel_url: "https://www.jsmemberly.com/panel.html",
                        user_action: "SUBSCRIBE_NOW"
                    }
                })
            });
            const subData = await subRes.json() as any;
            
            // El link que le mandaremos al cliente
            const linkPago = subData.links.find((l: any) => l.rel === "approve").href;

            return new Response(JSON.stringify({ exito: true, url_pago: linkPago }), { status: 200, headers: corsHeaders });

        } catch (error: any) {
            console.error("❌ Error creando suscripción PayPal:", error);
            return new Response(JSON.stringify({ exito: false, mensaje: error.message }), { status: 500, headers: corsHeaders });
        }
    }

    /* // =========================================================================
    // COBRO DE LA SUSCRIPCIÓN SAAS (TUS INGRESOS COMO DUEÑO DE JS MEMBERLY)
    // =========================================================================
    if (url.pathname === '/api/suscripcion-saas/generar-link' && request.method === 'POST') {
        try {
            const body = await request.json() as any;

            // 1. LLAVES DINÁMICAS (Se leen del entorno)
            const MIS_LLAVES_SAAS_CLIENT_ID = env.PAYPAL_SAAS_CLIENT_ID; 
            const MIS_LLAVES_SAAS_SECRET = env.PAYPAL_SAAS_SECRET;
            const URL_PAYPAL = env.PAYPAL_API_URL;

            const auth = btoa(`${MIS_LLAVES_SAAS_CLIENT_ID}:${MIS_LLAVES_SAAS_SECRET}`);
            // Usa la variable en el fetch:
            const tokenResponse = await fetch(`${URL_PAYPAL}/v1/oauth2/token`, { 
                method: 'POST',
                headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'grant_type=client_credentials'
            });
            const tokenData = await tokenResponse.json() as any;
            const accessToken = tokenData.access_token;

            // 🌟 MAGIA: Detectar si es mensual o anual desde el texto (ej. "starter anual")
            const esAnual = body.plan_elegido.toLowerCase().includes('anual');
            const periodoCobro = esAnual ? "YEAR" : "MONTH";

            // 2. CREAR EL PRODUCTO SAAS EN PAYPAL
            const prodRes = await fetch(`${URL_PAYPAL}/v1/catalogs/products`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: `JS MemberLy - Plan ${body.plan_elegido.toUpperCase()}`,
                    type: "SERVICE",
                    category: "SOFTWARE"
                })
            });
            const prodData = await prodRes.json() as any;

            // 3. CREAR EL PLAN DE SUSCRIPCIÓN (MENSUAL O ANUAL)
            const planRes = await fetch(`${URL_PAYPAL}/v1/billing/plans`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    product_id: prodData.id,
                    name: `Suscripción SaaS ${esAnual ? 'Anual' : 'Mensual'}`,
                    status: "ACTIVE",
                    billing_cycles: [{
                        frequency: { interval_unit: periodoCobro, interval_count: 1 }, // Aquí se aplica el MONTH o YEAR
                        tenure_type: "REGULAR",
                        sequence: 1,
                        total_cycles: 0, // Infinito hasta cancelar
                        pricing_scheme: { fixed_price: { value: parseFloat(body.precio_cobrar).toFixed(2), currency_code: "USD" } }
                    }],
                    payment_preferences: { auto_bill_outstanding: true, setup_fee_failure_action: "CONTINUE", payment_failure_threshold: 3 }
                })
            });
            const planData = await planRes.json() as any;

            // 4. GENERAR LINK DE PAGO
            const subRes = await fetch(`${URL_PAYPAL}/v1/billing/subscriptions`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    plan_id: planData.id,
                    // Enviamos el ID del gimnasio y nombre en "custom_id" para que el Webhook sepa quién pagó
                    custom_id: `SAAS|${body.gym_nombre}|${body.admin_nombre}`,
                    application_context: {
                        return_url: "https://jsmemberly.pages.dev/index.html?pago_saas=exitoso", 
                        cancel_url: "https://jsmemberly.pages.dev/index.html?pago_saas=cancelado",
                        user_action: "SUBSCRIBE_NOW"
                    }
                })
            });
            const subData = await subRes.json() as any;
            const linkPago = subData.links.find((link: any) => link.rel === "approve").href;

            return new Response(JSON.stringify({ exito: true, url_pago: linkPago }), { status: 200, headers: corsHeaders });

        } catch (error: any) {
            console.error("❌ Error generando cobro SaaS:", error);
            return new Response(JSON.stringify({ exito: false, mensaje: error.message }), { status: 500, headers: corsHeaders });
        }
    } */

    // =========================================================================
    // COBRO DE LA SUSCRIPCIÓN SAAS (TUS INGRESOS COMO DUEÑO DE JS MEMBERLY)
    // =========================================================================
    if (url.pathname === '/api/suscripcion-saas/generar-link' && request.method === 'POST') {
        try {
            const body = await request.json() as any;

            // --- 1. CREACIÓN DEL GIMNASIO EN ESTADO PENDIENTE ---
            const adminSupabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
            const limite = body.plan_elegido.includes('starter') ? 100 : (body.plan_elegido.includes('pro') ? 500 : 2000);
            const planLimpio = body.plan_elegido.replace(' anual', '').replace(' mensual', '').trim();

            const { data: nuevoTenant, error: errTenant } = await adminSupabase
                .from('tenants')
                .insert([{
                    nombre_negocio: body.gym_nombre,
                    pais: body.pais,
                    identificacion_fiscal: body.id_nacional,
                    plan_saas: planLimpio,
                    limite_clientes: limite,
                    estado_suscripcion: 'pendiente_pago',
                    zona_horaria: body.zona_horaria || 'America/Guayaquil'
                }])
                .select().single();

            if (errTenant) throw errTenant;
            const tenantIdReal = nuevoTenant.id;

            // --- 2. LLAVES DINÁMICAS Y PAYPAL ---
            const MIS_LLAVES_SAAS_CLIENT_ID = env.PAYPAL_SAAS_CLIENT_ID; 
            const MIS_LLAVES_SAAS_SECRET = env.PAYPAL_SAAS_SECRET;
            const URL_PAYPAL = env.PAYPAL_API_URL;

            const auth = btoa(`${MIS_LLAVES_SAAS_CLIENT_ID}:${MIS_LLAVES_SAAS_SECRET}`);
            const tokenResponse = await fetch(`${URL_PAYPAL}/v1/oauth2/token`, { 
                method: 'POST',
                headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'grant_type=client_credentials'
            });
            const tokenData = await tokenResponse.json() as any;
            const accessToken = tokenData.access_token;

            const esAnual = body.plan_elegido.toLowerCase().includes('anual');
            const periodoCobro = esAnual ? "YEAR" : "MONTH";

            const prodRes = await fetch(`${URL_PAYPAL}/v1/catalogs/products`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: `JS MemberLy - Plan ${body.plan_elegido.toUpperCase()}`,
                    type: "SERVICE",
                    category: "SOFTWARE"
                })
            });
            const prodData = await prodRes.json() as any;

            const planRes = await fetch(`${URL_PAYPAL}/v1/billing/plans`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    product_id: prodData.id,
                    name: `Suscripción SaaS ${esAnual ? 'Anual' : 'Mensual'}`,
                    status: "ACTIVE",
                    billing_cycles: [{
                        frequency: { interval_unit: periodoCobro, interval_count: 1 },
                        tenure_type: "REGULAR",
                        sequence: 1,
                        total_cycles: 0, 
                        pricing_scheme: { fixed_price: { value: parseFloat(body.precio_cobrar).toFixed(2), currency_code: "USD" } }
                    }],
                    payment_preferences: { auto_bill_outstanding: true, setup_fee_failure_action: "CONTINUE", payment_failure_threshold: 3 }
                })
            });
            const planData = await planRes.json() as any;

            // --- 3. GENERAR LINK DE PAGO ENLAZADO AL GIMNASIO ---
            const subRes = await fetch(`${URL_PAYPAL}/v1/billing/subscriptions`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    plan_id: planData.id,
                    // Enviamos el UUID real de la base de datos al Webhook
                    custom_id: `SAAS|${tenantIdReal}|${body.admin_nombre}`,
                    application_context: {
                        return_url: "https://www.jsmemberly.com/index.html?pago_saas=exitoso", 
                        cancel_url: "https://www.jsmemberly.com/index.html?pago_saas=cancelado",
                        user_action: "SUBSCRIBE_NOW"
                    }
                })
            });
            const subData = await subRes.json() as any;
            const linkPago = subData.links.find((link: any) => link.rel === "approve").href;

            // Devolvemos el tenant_id al frontend para que lo almacene
            return new Response(JSON.stringify({ exito: true, url_pago: linkPago, tenant_id: tenantIdReal }), { status: 200, headers: corsHeaders });

        } catch (error: any) {
            console.error("❌ Error generando cobro SaaS:", error);
            return new Response(JSON.stringify({ exito: false, mensaje: error.message }), { status: 500, headers: corsHeaders });
        }
    }

    // --- NUEVO: CREAR GIMNASIO CON 14 DÍAS DE PRUEBA ---
    if (url.pathname === '/api/registro-trial' && request.method === 'POST') {
        try {
            const body = await request.json() as any;
            const adminSupabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
            
            // Lógica de límites
            const limite = body.plan_elegido.includes('starter') ? 100 : (body.plan_elegido.includes('pro') ? 500 : 2000);
            const planLimpio = body.plan_elegido.replace(' anual', '').replace(' mensual', '').trim();

            // 🧠 MAGIA: Calculamos exactamente 14 días a partir de hoy
            const fechaFinTrial = new Date();
            fechaFinTrial.setDate(fechaFinTrial.getDate() + 14);

            const { data: nuevoTenant, error: errTenant } = await adminSupabase
                .from('tenants')
                .insert([{
                    nombre_negocio: body.gym_nombre,
                    pais: body.pais,
                    identificacion_fiscal: body.id_nacional,
                    plan_saas: planLimpio,
                    limite_clientes: limite,
                    estado_suscripcion: 'prueba', // Lo marcamos como prueba
                    fecha_fin_saas: fechaFinTrial.toISOString(), // ⏰ CADUCA EN 14 DÍAS
                    zona_horaria: body.zona_horaria || 'America/Guayaquil'
                }])
                .select().single();

            if (errTenant) throw errTenant;

            return new Response(JSON.stringify({ exito: true, tenant_id: nuevoTenant.id }), { status: 200, headers: corsHeaders });
        } catch (error: any) {
            console.error("Error en trial:", error);
            return new Response(JSON.stringify({ exito: false, mensaje: error.message }), { status: 500, headers: corsHeaders });
        }
    }

    // --- ENVÍO SEGURO DE WHATSAPP (OCULTO DEL FRONTEND) ---
    if (url.pathname === '/api/whatsapp' && request.method === 'POST') {
        try {
            const body = await request.json() as any;
            
            // Usamos las variables protegidas del Worker
            const PHONE_NUMBER_ID = env.WA_PHONE_ID;
            const TOKEN = env.WA_TOKEN;
            
            const metaUrl = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;
            
            const payload = {
                messaging_product: "whatsapp",
                to: body.telefono,
                type: "template",
                template: {
                    name: body.plantilla,
                    language: { code: "es_EC" },
                    components: [{
                        type: "body",
                        parameters: body.parametros.map((param: string) => ({ type: "text", text: param }))
                    }]
                }
            };

            const respuesta = await fetch(metaUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const data = await respuesta.json() as any;
            if (data.error) throw new Error(data.error.message);

            return new Response(JSON.stringify({ exito: true }), { status: 200, headers: corsHeaders });
        } catch (error: any) {
            console.error("Error en WA Backend:", error);
            return new Response(JSON.stringify({ exito: false, mensaje: error.message }), { status: 500, headers: corsHeaders });
        }
    }

    // --- ENVÍO DE CORREO DE INVITACIÓN A STAFF (VÍA BREVO) ---
    if (url.pathname === '/api/enviar-invitacion' && request.method === 'POST') {
        try {
            const body = await request.json() as any;
            
            if (!env.BREVO_API_KEY) {
                throw new Error("La llave de Brevo no está configurada.");
            }

            // Diseño del correo en HTML
            let htmlCuerpo = `
                <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                    <div style="background-color: #059669; padding: 30px; text-align: center;">
                        <h1 style="color: white; margin: 0; font-size: 24px;">¡Bienvenido al Equipo!</h1>
                    </div>
                    <div style="padding: 30px; background-color: #ffffff; color: #374151;">
                        <p style="font-size: 16px;">Hola <strong>${body.nombre_staff}</strong>,</p>
                        <p style="font-size: 16px;">Has sido invitado para unirte como <strong>${body.rol.toUpperCase()}</strong> al sistema de gestión de <strong>${body.nombre_gym}</strong>.</p>
                        
                        <div style="background-color: #f3f4f6; border-left: 4px solid #059669; padding: 15px; margin: 25px 0;">
                            <p style="margin: 0; font-size: 14px; color: #4b5563;">
                                Para activar tu cuenta, ingresa a la plataforma y selecciona la opción <strong>"Crear mi cuenta de acceso"</strong> utilizando exactamente este correo electrónico: <br>
                                <strong style="color: #111827; display: block; margin-top: 5px;">${body.email_staff}</strong>
                            </p>
                        </div>
                        
                        <div style="text-align: center; margin-top: 30px;">
                            <a href="https://www.jsmemberly.com/panel.html?action=activar_cuenta&email=${encodeURIComponent(body.email_staff)}" style="background-color: #059669; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block;">Aceptar Invitación y Registrarme</a>
                        </div>
                    </div>
                    <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
                        <p style="margin: 0; font-size: 12px; color: #9ca3af;">Enviado automáticamente por JS MemberLy.</p>
                    </div>
                </div>
            `;

            // Enviamos la orden a Brevo
            const resBrevo = await fetch('https://api.brevo.com/v3/smtp/email', {
                method: 'POST',
                headers: { 
                    'api-key': env.BREVO_API_KEY, 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    // ⚠️ RECUERDA: Cambiar este correo por el tuyo verificado en Brevo
                    sender: { name: 'Equipo JS MemberLy', email: 'equipo@jsmemberly.com' }, 
                    to: [{ email: body.email_staff }],
                    subject: `Invitación a JS MemberLy - ${body.nombre_gym}`,
                    htmlContent: htmlCuerpo 
                })
            });

            if (!resBrevo.ok) {
                const dataError = await resBrevo.json();
                throw new Error(dataError.message || "Error al enviar correo por Brevo");
            }

            return new Response(JSON.stringify({ exito: true }), { status: 200, headers: corsHeaders });
        } catch (error: any) {
            console.error("Error enviando invitación:", error);
            return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
        }
    }

    // --- CREACIÓN DIRECTA DE STAFF (SIN DOBLE CORREO) ---
    if (url.pathname === '/api/registrar-staff' && request.method === 'POST') {
        try {
            const body = await request.json() as any;
            const adminSupabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

            // 1. Verificamos que el admin lo haya invitado (que exista en perfiles_staff)
            const { data: perfil } = await adminSupabase.from('perfiles_staff').select('id').eq('email', body.email).single();
            
            if (!perfil) {
                throw new Error("Acceso denegado: No tienes una invitación activa.");
            }

            // 2. Creamos el usuario en Auth saltándonos el correo de confirmación
            const { data: authData, error: authError } = await adminSupabase.auth.admin.createUser({
                email: body.email,
                password: body.password,
                email_confirm: true // 🛑 EL TRUCO DE MAGIA ESTÁ AQUÍ
            });

            if (authError) throw authError;

            // 3. Actualizamos el ID temporal en perfiles_staff por el ID real de Auth
            await adminSupabase.from('perfiles_staff').update({ id: authData.user.id }).eq('email', body.email);

            return new Response(JSON.stringify({ exito: true }), { status: 200, headers: corsHeaders });
        } catch (error: any) {
            console.error("Error registrando staff:", error);
            return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
        }
    }

    // =========================================================================
    // 🎧 WEBHOOK DE PAYPAL (Suscripciones y Pagos Únicos)
    // =========================================================================
    if (url.pathname === '/api/webhooks/paypal' && request.method === 'POST') {
        try {
            const body = await request.json() as any;
            
            // 1. Aceptamos tanto suscripciones (SALE) como pagos únicos (CAPTURE)
            if (body.event_type === 'PAYMENT.SALE.COMPLETED' || body.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
                
                // Extraemos la etiqueta (PayPal usa 'custom' para suscripciones y 'custom_id' para pagos únicos)
                const customId = body.resource.custom || body.resource.custom_id || "";
                if (!customId) return new Response("Ignorado: Sin custom_id", { status: 200 });

                const adminSupabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
                const datos = customId.split('|');
                const tipoCobro = datos[0];

                if (tipoCobro === 'SAAS') {
                    // -----------------------------------------------------------------
                    // ESCENARIO A: Un Gimnasio te pagó a TI (Suscripción de JS MemberLy)
                    // Formato esperado: SAAS | tenantId | nombreAdmin
                    // -----------------------------------------------------------------
                    const tenantId = datos[1];
                    
                    // Actualizamos la tabla tenants
                    await adminSupabase.from('tenants').update({ 
                        estado_suscripcion: 'activa' 
                    }).eq('id', tenantId);

                    console.log(`✅ [SAAS] Gimnasio ${tenantId} ha pagado su mensualidad/anualidad.`);

                } else if (tipoCobro === 'GYM') {
                    // -----------------------------------------------------------------
                    // EL CLIENTE FINAL LE PAGÓ AL GIMNASIO (Un mes o Suscripción)
                    // -----------------------------------------------------------------
                    const tenantId = datos[1];
                    const suscriptorId = datos[2];
                    const planId = datos[3];
                    const diasDuracion = parseInt(datos[4]);
                    const precioCobrado = parseFloat(datos[5]);

                    // === 🧠 NUEVA LÓGICA INTELIGENTE DE FECHAS ===
                    // Ajustamos la fecha de hoy a Ecuador
                    const hoyDate = new Date(new Date().getTime() - (5 * 60 * 60 * 1000));
                    hoyDate.setUTCHours(0, 0, 0, 0);
                    
                    let fechaInicioCalculada = new Date(hoyDate);

                    // 1. Buscamos la fecha de fin de la ÚLTIMA suscripción de este cliente
                    const { data: ultimaSub } = await adminSupabase
                        .from('historial_suscripciones')
                        .select('fecha_fin')
                        .eq('suscriptor_id', suscriptorId)
                        .eq('tenant_id', tenantId)
                        .order('fecha_fin', { ascending: false })
                        .limit(1);

                    // 2. Si tiene una suscripción anterior, verificamos si aún no se vence
                    if (ultimaSub && ultimaSub.length > 0 && ultimaSub[0].fecha_fin) {
                        const partesAnterior = ultimaSub[0].fecha_fin.split('-');
                        const fechaFinAnterior = new Date(Date.UTC(parseInt(partesAnterior[0]), parseInt(partesAnterior[1]) - 1, parseInt(partesAnterior[2])));
                        
                        // Si la fecha de fin anterior es mayor o igual a hoy, empezamos DESDE AHÍ
                        if (fechaFinAnterior >= hoyDate) {
                            fechaInicioCalculada = fechaFinAnterior;
                        }
                    }

                    // 3. Calculamos la nueva fecha fin sumando los días a la fecha elegida
                    const nuevaFechaFin = new Date(fechaInicioCalculada);
                    nuevaFechaFin.setUTCDate(nuevaFechaFin.getUTCDate() + diasDuracion);
                    
                    const strFechaInicio = fechaInicioCalculada.toISOString().split('T')[0];
                    const strFechaFin = nuevaFechaFin.toISOString().split('T')[0];
                    // ===============================================

                    // Apagamos las suscripciones viejas
                    await adminSupabase.from('historial_suscripciones')
                        .update({ estado_pago: 'Inactivo' })
                        .eq('suscriptor_id', suscriptorId)
                        .eq('tenant_id', tenantId);

                    // MAGIA: Determinamos el nuevo estado
                    const nuevoEstado = (body.event_type === 'PAYMENT.SALE.COMPLETED') ? 'Suscrito' : 'Pagado';

                    // Insertamos el nuevo mes con las fechas exactas
                    await adminSupabase.from('historial_suscripciones').insert([{
                        tenant_id: tenantId,
                        suscriptor_id: suscriptorId,
                        plan_id: planId,
                        precio_cobrado: precioCobrado,
                        fecha_inicio: strFechaInicio,  // <-- FECHA INTELIGENTE
                        fecha_fin: strFechaFin,        // <-- FECHA INTELIGENTE
                        estado_pago: nuevoEstado, 
                        renovacion_automatica: true, 
                        recordatorio_enviado: false
                    }]);

                    // C. Extraemos datos para enviar el recibo por WhatsApp
                    const { data: gymData } = await adminSupabase.from('tenants').select('nombre_negocio, plan_saas, estado_suscripcion').eq('id', tenantId).single();
                    const { data: clienteData } = await adminSupabase.from('suscriptores').select('nombre_completo, telefono').eq('id', suscriptorId).single();

                    // 🛑 REGLA DE NEGOCIO: Solo enviamos recibo si NO están en prueba y NO son plan Starter
                    const puedeEnviarWA = gymData && gymData.estado_suscripcion !== 'prueba' && gymData.plan_saas !== 'starter';

                    if (puedeEnviarWA && clienteData && clienteData.telefono) {
                        const telefonoLimpio = clienteData.telefono.replace(/\D/g, '');
                        const nombreGym = gymData.nombre_negocio;
                        
                        // Enviamos petición a la API de Meta
                        const metaUrl = `https://graph.facebook.com/v18.0/${env.WA_PHONE_ID}/messages`;
                        const payloadWA = {
                            messaging_product: "whatsapp",
                            to: telefonoLimpio,
                            type: "template",
                            template: {
                                name: "recibo_pago_gym",
                                language: { code: "es_EC" },
                                components: [
                                    { type: "header", parameters: [{ type: "text", text: nombreGym }] },
                                    { type: "body", parameters: [
                                        { type: "text", text: clienteData.nombre_completo },
                                        { type: "text", text: nombreGym },
                                        { type: "text", text: precioCobrado.toString() },
                                        { type: "text", text: nuevaFechaFin.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) }
                                    ]}
                                ]
                            }
                        };

                        await fetch(metaUrl, {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${env.WA_TOKEN}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify(payloadWA)
                        });
                    }
                    console.log(`✅ [GYM] Cliente ${suscriptorId} renovado automáticamente por ${diasDuracion} días.`);
                }
            }

            // A PayPal SIEMPRE hay que contestarle con un 200 rápido para que sepa que recibimos el mensaje
            return new Response("Webhook procesado", { status: 200 });

        } catch (error: any) {
            console.error("❌ Error grave en Webhook:", error);
            // 🚨 GUARDAR EN CAJA NEGRA
            const adminSupabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
            await adminSupabase.from('errores_sistema').insert([{ 
                origen: 'Webhook PayPal', 
                mensaje: error.message || JSON.stringify(error)
            }]);
            
            return new Response(`Error: ${error.message}`, { status: 500 });
        }
    }

    // =========================================================================
    // 🪙 CAPTURAR PAGO ÚNICO (El paso final de PayPal)
    // =========================================================================
    if (url.pathname === '/api/capturar-orden' && request.method === 'GET') {
        try {
            const tokenOrden = url.searchParams.get('token');
            const tenantId = url.searchParams.get('tenant_id');
            if (!tokenOrden || !tenantId) throw new Error("Faltan parámetros");

            // 1. Buscamos las llaves del gimnasio
            const adminSupabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
            const { data: tenant } = await adminSupabase.from('tenants').select('paypal_client_id, paypal_secret').eq('id', tenantId).single();
            if (!tenant) throw new Error("Tenant no encontrado");

            // BUSCAR - Descomentar sandbox para hacer pruebas
            const URL_PAYPAL = env.PAYPAL_API_URL || 'https://api-m.sandbox.paypal.com'; 
            //const URL_PAYPAL = 'https://api-m.sandbox.paypal.com';

            // 2. Nos autenticamos con PayPal
            const auth = btoa(`${tenant.paypal_client_id}:${tenant.paypal_secret}`);
            const tokenRes = await fetch(`${URL_PAYPAL}/v1/oauth2/token`, {
                method: 'POST',
                headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'grant_type=client_credentials'
            });
            const tokenData = await tokenRes.json() as any;

            if (!tokenData.access_token) {
                console.error("❌ Fallo Autenticación PayPal:", tokenData);
                throw new Error("No se pudo obtener el Access Token");
            }

            // 3. ¡CAPTURAMOS EL DINERO! 
            const captureRes = await fetch(`${URL_PAYPAL}/v2/checkout/orders/${tokenOrden}/capture`, {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${tokenData.access_token}`, 
                    'Content-Type': 'application/json' 
                },
                body: JSON.stringify({}) // PayPal exige un body vacío
            });
            
            const captureData = await captureRes.json() as any;

            // EL SEGURO: Si PayPal rechaza el cobro, te mostramos el error real
            if (!captureRes.ok || captureData.status !== 'COMPLETED') {
                console.error("❌ PayPal rechazó la captura:", captureData);
                return Response.redirect("https://www.jsmemberly.com/index.html?pago=error", 302);
            }

            console.log("✅ ¡Dinero capturado con éxito! PayPal disparará el Webhook al instante.");
            
            // 4. Mandamos al cliente a su panel verde
            return Response.redirect("https://www.jsmemberly.com/index.html?pago=exitoso", 302);
        } catch (error: any) {
            console.error("❌ Error grave capturando orden única:", error.message);
            return Response.redirect("https://www.jsmemberly.com/index.html?pago=error", 302);
        }
    }

    // Al final del todo, donde tienes el "Not Found", cámbialo a esto:
    return new Response(JSON.stringify({ error: "Ruta no encontrada" }), { 
      status: 404, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  },

  // =========================================================================
  // 2. EVENTO SCHEDULED (El Cron Job Automático que corre en segundo plano)
  // =========================================================================
  async scheduled(event: any, env: Env, ctx: ExecutionContext): Promise<void> {
    // SERVICE_KEY nos da permisos de superadministrador para ver TODOS los gimnasios
    const adminSupabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
    
    // =========================================================================
    // 🧹 1. RECOLECTOR DE BASURA (Borrar gimnasios "pendientes" de hace >48h)
    // =========================================================================
    try {
        const anteayer = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const { error: errBorrado } = await adminSupabase
            .from('tenants')
            .delete()
            .eq('estado_suscripcion', 'pendiente_pago')
            .lt('fecha_creacion', anteayer);
        
        if (errBorrado) console.error("⚠️ Error en recolector de basura:", errBorrado.message);
        else console.log("🧹 Limpieza de registros pendientes completada.");
    } catch (e) {
        console.error("⚠️ Error ejecutando recolector de basura:", e);
    }

    // 1. Ajustamos la fecha para la zona horaria de Ecuador (GMT-5) y normalizamos a medianoche
    const fechaEcuador = new Date(new Date().getTime() - (5 * 60 * 60 * 1000));
    fechaEcuador.setUTCHours(0, 0, 0, 0); 
    const hoyStr = fechaEcuador.toISOString().split('T')[0];

    console.log(`🚀 Ejecutando Motor de Cobros Automático para la fecha: ${hoyStr}`);

    try {
        // 2. Buscamos todas las suscripciones activas ('Pagado') de la base de datos completa
        const { data: suscripciones, error } = await adminSupabase
            .from('historial_suscripciones')
            .select(`
                *,
                planes ( nombre_plan, dias_duracion ),
                suscriptores ( nombre_completo, telefono ),
                tenants ( id, nombre_negocio, paypal_client_id, paypal_secret, plan_saas, estado_suscripcion )
            `)
            .eq('estado_pago', 'Pagado');

        if (error) throw error;
        if (!suscripciones || suscripciones.length === 0) {
            console.log("✅ No hay suscripciones activas para procesar hoy.");
            return;
        }

        // --- HELPER 1: Envío directo de WhatsApp desde el Worker (SOPORTA ENCABEZADOS) ---
        const enviarWA = async (telefono: string, plantilla: string, paramsHeader: string[] = [], paramsBody: string[] = []) => {
            const telLimpio = telefono.replace(/\D/g, '');
            const metaUrl = `https://graph.facebook.com/v18.0/${env.WA_PHONE_ID}/messages`;
            
            const componentesPlantilla = [];
            
            // Si le mandamos datos para el encabezado
            if (paramsHeader.length > 0) {
                componentesPlantilla.push({
                    type: "header",
                    parameters: paramsHeader.map(param => ({ type: "text", text: param }))
                });
            }
            
            // Si le mandamos datos para el cuerpo
            if (paramsBody.length > 0) {
                componentesPlantilla.push({
                    type: "body",
                    parameters: paramsBody.map(param => ({ type: "text", text: param }))
                });
            }

            const payload = {
                messaging_product: "whatsapp",
                to: telLimpio,
                type: "template",
                template: {
                    name: plantilla,
                    language: { code: "es_EC" }, // Coincide con el Spanish (ECU) de tu foto
                    components: componentesPlantilla
                }
            };
            
            try {
                const res = await fetch(metaUrl, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${env.WA_TOKEN}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json() as any;
                if (data.error) console.error(`❌ Meta rechazó WA para ${telLimpio}:`, data.error.message);
                else console.log(`✅ WA enviado con éxito a ${telLimpio}`);
            } catch (err: any) {
                console.error("❌ Error de red conectando con Meta:", err.message);
            }
        };

        // --- HELPER 2: Generación Inteligente de link de PayPal (CON RASTREO) ---
        const generarLinkPago = async (tenant: any, clienteNombre: string, precio: number, esSuscripcion: boolean, dias: number, suscriptorId: string, planId: string) => {
            if (!tenant.paypal_client_id || !tenant.paypal_secret) return "https://www.jsmemberly.com/error-pago";
            try {
                const URL_PAYPAL = env.PAYPAL_API_URL || 'https://api-m.paypal.com';
                const auth = btoa(`${tenant.paypal_client_id}:${tenant.paypal_secret}`);
                
                // 1. Obtener Token
                const tokenResponse = await fetch(`${URL_PAYPAL}/v1/oauth2/token`, { 
                    method: 'POST',
                    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: 'grant_type=client_credentials'
                });
                const tokenData = await tokenResponse.json() as any;
                if (!tokenData.access_token) {
                    console.error("❌ ERROR PAYPAL (TOKEN):", tokenData);
                    throw new Error("Credenciales inválidas para este entorno.");
                }
                const accessToken = tokenData.access_token;
                
                const customId = `GYM|${tenant.id}|${suscriptorId}|${planId}|${dias}|${precio}`;

                if (esSuscripcion) {
                    // 2. Crear Producto
                    const prodRes = await fetch(`${URL_PAYPAL}/v1/catalogs/products`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: `Membresía - ${clienteNombre}`, type: "SERVICE"})
                    });
                    const prodData = await prodRes.json() as any;
                    if (!prodData.id) {
                        console.error("❌ ERROR PAYPAL (PRODUCTO):", prodData);
                        throw new Error("Fallo al crear producto");
                    }

                    // 3. Crear Plan
                    const planRes = await fetch(`${URL_PAYPAL}/v1/billing/plans`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            product_id: prodData.id,
                            name: `Membresía ${dias} días Automática`,
                            status: "ACTIVE",
                            billing_cycles: [{ frequency: { interval_unit: "DAY", interval_count: dias }, tenure_type: "REGULAR", sequence: 1, total_cycles: 0, pricing_scheme: { fixed_price: { value: parseFloat(precio.toString()).toFixed(2), currency_code: "USD" } } }],
                            payment_preferences: { auto_bill_outstanding: true, setup_fee_failure_action: "CONTINUE", payment_failure_threshold: 3 }
                        })
                    });
                    const planData = await planRes.json() as any;
                    if (!planData.id) {
                        console.error("❌ ERROR PAYPAL (PLAN):", planData);
                        throw new Error("Fallo al crear plan de cobro");
                    }

                    // 4. Crear Suscripción
                    const subRes = await fetch(`${URL_PAYPAL}/v1/billing/subscriptions`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            plan_id: planData.id,
                            custom_id: customId,
                            application_context: { return_url: "https://www.jsmemberly.com/panel.html", cancel_url: "https://www.jsmemberly.com/panel.html", user_action: "SUBSCRIBE_NOW" }
                        })
                    });
                    const subData = await subRes.json() as any;
                    if (!subData.links) {
                        console.error("❌ ERROR PAYPAL (FINAL):", subData);
                        throw new Error("Sin links de suscripción");
                    }
                    return subData.links.find((l: any) => l.rel === "approve").href;

                } else {
                    const orderPayload = {
                        intent: "CAPTURE",
                        purchase_units: [{
                            reference_id: `GYM-${Date.now()}`,
                            description: `Suscripción 1 Mes - ${clienteNombre}`,
                            custom_id: customId,
                            amount: { currency_code: "USD", value: parseFloat(precio.toString()).toFixed(2) }
                        }],
                        payment_source: {
                            paypal: {
                                experience_context: { 
                                    payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED", 
                                    user_action: "PAY_NOW", 
                                    // Aquí redirigimos al backend primero para capturar el dinero
                                    return_url: `https://api.jsmemberly.com//api/capturar-orden?tenant_id=${tenant.id}`, 
                                    cancel_url: "https://www.jsmemberly.com/" 
                                }
                            }
                        }
                    };
                    const orderResponse = await fetch(`${URL_PAYPAL}/v2/checkout/orders`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify(orderPayload)
                    });
                    const orderData = await orderResponse.json() as any;
                    if (!orderData.links) {
                        console.error("❌ ERROR PAYPAL (PAGO ÚNICO):", orderData);
                        throw new Error("Sin links de pago único");
                    }
                    return orderData.links.find((link: any) => link.rel === "payer-action").href;
                }
            } catch (e: any) {
                console.error("Error PayPal:", e.message);
                //return "https://www.jsmemberly.com/error-pago";
                return null; // Retornamos null para detectar que está mal configurado
            }
        };

        // Memoria para agrupar los reportes por gimnasio ---
        const reportesPorGym: Record<string, {
            tenant: any;
            vencenHoy: any[];
            vencidos15: any[];
        }> = {};

        // 3. Procesamos cada suscripción
        for (const sub of suscripciones) {
            if (!sub.fecha_fin || !sub.suscriptores || !sub.tenants) continue;

            const tenant = sub.tenants;
            const telefono = sub.suscriptores.telefono;
            if (!telefono) continue; 

            // === 🌍 CEREBRO DE ZONA HORARIA ===
            const zonaHorariaGym = tenant.zona_horaria || 'America/Guayaquil';
            const now = new Date();
            
            // Extraemos la fecha y hora exactas en el país del gimnasio
            const formatter = new Intl.DateTimeFormat('en-US', { 
                timeZone: zonaHorariaGym, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hour12: false 
            });
            const parts = formatter.formatToParts(now);
            
            const anioLocal = parseInt(parts.find(p => p.type === 'year')?.value || '0');
            const mesLocal = parseInt(parts.find(p => p.type === 'month')?.value || '1') - 1; // 0-indexed en JS
            const diaLocal = parseInt(parts.find(p => p.type === 'day')?.value || '1');
            let horaLocal = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
            if (horaLocal === 24) horaLocal = 0; // Ajuste de medianoche

            // ⛔ REGLA DE CORTESÍA: Solo enviamos WhatsApps si son exactamente las 9:00 AM en SU país
            if (horaLocal !== 9) continue; 
            // ==================================

            // Calculamos los días restantes basados en su medianoche local
            const fechaHoyGym = new Date(anioLocal, mesLocal, diaLocal); 
            const partesFecha = sub.fecha_fin.split('-'); 
            const fechaFin = new Date(parseInt(partesFecha[0]), parseInt(partesFecha[1]) - 1, parseInt(partesFecha[2]));
            
            const diffTime = fechaFin.getTime() - fechaHoyGym.getTime();
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)); 

            const nombreCliente = sub.suscriptores.nombre_completo;
            const renovacionAuto = sub.renovacion_automatica === true; 
            const recordatorioEnviado = sub.recordatorio_enviado === true; 
            const nombreGym = tenant.nombre_negocio;
            const planSaasGym = tenant.plan_saas?.toLowerCase() || 'starter';

            // RECOLECTAR DATOS PARA EL REPORTE DE EMAIL ---
            if (diffDays === 0 || diffDays === -15) {
                if (!reportesPorGym[tenant.id]) {
                    reportesPorGym[tenant.id] = { tenant, vencenHoy: [], vencidos15: [] };
                }
                
                const datosCliente = { 
                    nombre: nombreCliente, 
                    telefono: telefono, 
                    plan: sub.planes?.nombre_plan || 'Desconocido' 
                };

                if (diffDays === 0) reportesPorGym[tenant.id].vencenHoy.push(datosCliente);
                else if (diffDays === -15) reportesPorGym[tenant.id].vencidos15.push(datosCliente);
            }

            // =========================================================================
            // REGLA: Avisar 3 días ANTES a TODOS (Con Link Dinámico)
            // =========================================================================
            if (diffDays === 3 && !recordatorioEnviado) {
                
                // 🛑 NUEVO: BLOQUEO DE WHATSAPP EN FASE DE PRUEBA (Ahorro de costos)
                if (tenant.estado_suscripcion === 'prueba') {
                    console.log(`🔒 [${zonaHorariaGym}] Gimnasio en Prueba. Se omite WA a ${nombreCliente} para ahorrar costos.`);
                    // Lo marcamos como "enviado" para que el robot no se quede atascado intentando cada hora
                    await adminSupabase.from('historial_suscripciones').update({ recordatorio_enviado: true }).eq('id', sub.id);
                    continue; 
                }

                if (planSaasGym === 'starter') {
                    console.log(`🔒 [${zonaHorariaGym}] Tenant en Plan Starter. Se omite WA para ${nombreCliente}.`);
                    await adminSupabase.from('historial_suscripciones').update({ recordatorio_enviado: true }).eq('id', sub.id);
                    continue; 
                }

                // --- 🛑 NUEVA VALIDACIÓN: ¿Tiene PayPal configurado? ---
                if (!tenant.paypal_client_id || !tenant.paypal_secret) {
                    console.log(`⚠️ [${zonaHorariaGym}] Gimnasio ${nombreGym} NO tiene PayPal. Se omite el envío de link a ${nombreCliente}.`);
                    // Lo marcamos como "enviado" para que el robot no se quede atascado intentando cada hora
                    await adminSupabase.from('historial_suscripciones').update({ recordatorio_enviado: true }).eq('id', sub.id);
                    continue;
                }
                // -------------------------------------------------------

                console.log(`🔔 [${zonaHorariaGym} - 9:00 AM] Enviando aviso a ${nombreCliente} (${nombreGym})`);
                
                const diasPlan = sub.planes?.dias_duracion || 30;
                const linkPago = await generarLinkPago(tenant, nombreCliente, sub.precio_cobrado, renovacionAuto, diasPlan, sub.suscriptor_id, sub.plan_id);
                
                // --- 🛑 VALIDACIÓN 2: ¿PayPal rechazó las credenciales (Mal configurado)? ---
                if (!linkPago) {
                    console.log(`❌ [${zonaHorariaGym}] Gimnasio ${nombreGym} tiene PayPal MAL CONFIGURADO. Se cancela el mensaje a ${nombreCliente}.`);
                    // Lo marcamos como enviado para que el robot no se quede atascado intentando cada hora
                    await adminSupabase.from('historial_suscripciones').update({ recordatorio_enviado: true }).eq('id', sub.id);
                    continue;
                }

                // 🛑 NUEVO: Buscamos el teléfono del administrador del gimnasio
                const { data: adminGym } = await adminSupabase
                    .from('perfiles_staff')
                    .select('telefono')
                    .eq('tenant_id', tenant.id)
                    .eq('rol', 'admin')
                    .limit(1)
                    .single();
                
                const telefonoSoporteGym = adminGym && adminGym.telefono ? adminGym.telefono : "nuestra recepción";

                const paramsHeaderAviso: string[] = [nombreGym]; 
                const paramsBodyAviso = [nombreCliente, nombreGym, linkPago, telefonoSoporteGym]; 
                
                await enviarWA(telefono, 'recordatorio_pago', paramsHeaderAviso, paramsBodyAviso);
                await adminSupabase.from('historial_suscripciones').update({ recordatorio_enviado: true }).eq('id', sub.id);
            }

            /* // =========================================================================
            // REGLA 2: SÍ TIENE RENOVACIÓN AUTOMÁTICA -> Cobrar 1 día DESPUÉS (-1)
            // =========================================================================
            if (renovacionAuto && diffDays === -1) {
                console.log(`💳 Procesando renovación automática para ${nombreCliente} (${nombreGym})`);
                
                // Simulación de transacción exitosa (Aquí se integraría el cobro real por token de tarjeta)
                const transaccionExitosa = true; 
                
                if (transaccionExitosa) {
                    const diasPlan = sub.planes?.dias_duracion || 30;
                    
                    // Calculamos nueva fecha basándonos en hoy
                    const nuevaFechaFin = new Date(fechaEcuador);
                    nuevaFechaFin.setDate(nuevaFechaFin.getDate() + diasPlan);
                    const nuevaFechaFinStr = nuevaFechaFin.toISOString().split('T')[0];

                    // 1. Apagamos la suscripción vieja (Inactivo) del cliente en ESTE tenant
                    await adminSupabase.from('historial_suscripciones')
                        .update({ estado_pago: 'Inactivo' })
                        .eq('suscriptor_id', sub.suscriptor_id)
                        .eq('tenant_id', sub.tenant_id);

                    // 2. Insertamos el nuevo mes pagado
                    await adminSupabase.from('historial_suscripciones').insert([{
                        tenant_id: sub.tenant_id,
                        suscriptor_id: sub.suscriptor_id,
                        plan_id: sub.plan_id,
                        precio_cobrado: sub.precio_cobrado,
                        fecha_inicio: hoyStr,
                        fecha_fin: nuevaFechaFinStr,
                        estado_pago: 'Pagado',
                        renovacion_automatica: true 
                    }]);
                    
                    // 3. Enviamos Recibo
                    // Variables: [ {{1}} Cliente, {{2}} Gimnasio, {{3}} Precio, {{4}} Nueva Fecha Fin ]
                    const parametrosRecibo = [
                        nombreCliente, 
                        nombreGym, 
                        sub.precio_cobrado.toString(), 
                        nuevaFechaFin.toLocaleDateString('es-ES') 
                    ];

                    // 3. Enviamos Recibo
                    // SEGÚN TU CAPTURA DE PANTALLA:
                    // Encabezado {{1}}: Nombre del Gimnasio
                    const paramsHeaderRecibo = [nombreGym]; 
                    
                    // Cuerpo {{1}}: Cliente, {{2}}: Gimnasio, {{3}}: Precio, {{4}}: Fecha
                    const paramsBodyRecibo = [
                        nombreCliente, 
                        nombreGym, 
                        sub.precio_cobrado.toString(), 
                        nuevaFechaFin.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) 
                    ];
                    
                    await enviarWA(telefono, 'recibo_pago_gym', paramsHeaderRecibo, paramsBodyRecibo);
                }
            } */
        }

        // =========================================================================
        // 📧 ENVÍO DE REPORTES A ADMINISTRADORES (TEXTO + EXCEL CSV)
        // =========================================================================
        for (const tenantId in reportesPorGym) {
            const reporte = reportesPorGym[tenantId];
            
            // Si no hay nada que reportar hoy, saltamos este gimnasio
            if (reporte.vencenHoy.length === 0 && reporte.vencidos15.length === 0) continue;

            try {
                // 1. Buscamos a los administradores de este gimnasio
                const { data: admins } = await adminSupabase
                    .from('perfiles_staff')
                    .select('email, nombre')
                    .eq('tenant_id', tenantId)
                    .eq('rol', 'admin');

                if (!admins || admins.length === 0) continue;
                const correosDestino = admins.map(a => a.email);

                // 2. Armamos el archivo Excel (CSV)
                let csvContent = "\ufeffEstado,Cliente,WhatsApp,Plan\n"; // \ufeff arregla las tildes en Excel
                
                reporte.vencenHoy.forEach(c => csvContent += `VENCE HOY,"${c.nombre}","${c.telefono}","${c.plan}"\n`);
                reporte.vencidos15.forEach(c => csvContent += `SIN RENOVAR (15 Días),"${c.nombre}","${c.telefono}","${c.plan}"\n`);

                // Convertimos el CSV a Base64 de forma segura para evitar errores con tildes/eñes
                const bytes = new TextEncoder().encode(csvContent);
                let base64Csv = btoa(String.fromCharCode(...bytes));

                // 3. Armamos el cuerpo del correo en texto/HTML
                let htmlCuerpo = `
                    <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px;">
                        <h2 style="color: #059669;">Reporte Diario - ${reporte.tenant.nombre_negocio}</h2>
                        <p>Hola equipo, adjunto encontrarán el reporte de estado de membresías para el día de hoy (${hoyStr}).</p>
                `;

                if (reporte.vencenHoy.length > 0) {
                    htmlCuerpo += `<h3 style="color: #D97706;">🔴 Vencen Hoy (${reporte.vencenHoy.length})</h3><ul>`;
                    reporte.vencenHoy.forEach(c => htmlCuerpo += `<li><strong>${c.nombre}</strong> (Plan: ${c.plan}) - WhatsApp: ${c.telefono}</li>`);
                    htmlCuerpo += `</ul>`;
                }

                if (reporte.vencidos15.length > 0) {
                    htmlCuerpo += `<h3 style="color: #DC2626;">❌ 15 Días Sin Renovar (${reporte.vencidos15.length})</h3><ul>`;
                    reporte.vencidos15.forEach(c => htmlCuerpo += `<li><strong>${c.nombre}</strong> (Plan: ${c.plan}) - WhatsApp: ${c.telefono}</li>`);
                    htmlCuerpo += `</ul><p style="font-size: 12px; color: #666;">Te sugerimos contactar a estos clientes para ofrecerles una promoción de regreso.</p>`;
                }

                htmlCuerpo += `
                        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                        <p style="font-size: 12px; color: #999;">Este es un mensaje automático generado por tu asistente <strong>JS MemberLy</strong>. El reporte completo en Excel está adjunto a este correo.</p>
                    </div>
                `;

                // 4. Enviamos el correo usando BREVO
                if (env.BREVO_API_KEY) {
                    
                    const destinatariosBrevo = correosDestino.map(correo => ({ email: correo }));

                    const resBrevo = await fetch('https://api.brevo.com/v3/smtp/email', {
                        method: 'POST',
                        headers: { 
                            'api-key': env.BREVO_API_KEY, 
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        },
                        body: JSON.stringify({
                            // ⚠️ IMPORTANTE: Pon aquí el correo que validaste en Brevo
                            sender: { name: 'Reportes JS MemberLy', email: 'reportes@jsmemberly.com' }, 
                            to: destinatariosBrevo,
                            subject: `📊 JS MemberLy - Reporte Diario de Membresías - ${reporte.tenant.nombre_negocio}`,
                            htmlContent: htmlCuerpo, 
                            attachment: [
                                { name: `Reporte_${hoyStr}.csv`, content: base64Csv }
                            ]
                        })
                    });

                    const dataBrevo = await resBrevo.json() as any;

                    // 🛑 NUEVO: Si Brevo nos rechaza el correo, lanzamos el error a la consola
                    if (!resBrevo.ok) {
                        throw new Error(`Rechazo de Brevo: ${dataBrevo.message || JSON.stringify(dataBrevo)}`);
                    }

                    console.log(`✅ Reporte enviado por Brevo a los admins de ${reporte.tenant.nombre_negocio}`);
                } else {
                    console.log(`⚠️ Faltan credenciales de BREVO_API_KEY. Reporte generado pero no enviado.`);
                }

            } catch (err: any) {
                console.error(`❌ Error enviando reporte a ${tenantId}:`, err.message);
            }
        }

        console.log("✅ Motor de cobros automático finalizado con éxito.");

    } catch (error: any) {
        console.error("❌ Error grave en el Motor de Cobros (Cron):", error.message);
        // 🚨 GUARDAR EN CAJA NEGRA
        await adminSupabase.from('errores_sistema').insert([{ 
            origen: 'Motor de Cobros (Cron)', 
            mensaje: error.message 
        }]);
    }
  }
};