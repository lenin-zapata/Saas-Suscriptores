import { createClient } from '@supabase/supabase-js';

// --- MOTOR CRIPTOGRÁFICO PARA PLACETOPAY (CORREGIDO) ---
async function generarAuthPlaceToPay() {
    const login = "6dd490faf9cb87a9862245da41170ff2";
    const tranKeySecreto = "024h1IlD";

    // 1. Generamos un Nonce de 16 bytes
    const nonceArray = new Uint8Array(16);
    crypto.getRandomValues(nonceArray);
    
    // Función segura para convertir Uint8Array a Base64 en Cloudflare
    const toBase64 = (bytes: Uint8Array) => {
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    };

    const nonceBase64 = toBase64(nonceArray);

    // 2. EL SECRETO DEL ERROR 102: Quitar los milisegundos de la fecha
    // Forzamos el formato ISO estricto: "YYYY-MM-DDTHH:mm:ssZ"
    const seed = new Date().toISOString().split('.')[0] + 'Z'; 

    // 3. Preparamos los datos para el Hash (Nonce + Seed + TranKey)
    const encoder = new TextEncoder();
    const seedBytes = encoder.encode(seed);
    const tranKeyBytes = encoder.encode(tranKeySecreto);

    const dataToHash = new Uint8Array(nonceArray.length + seedBytes.length + tranKeyBytes.length);
    dataToHash.set(nonceArray, 0);
    dataToHash.set(seedBytes, nonceArray.length);
    dataToHash.set(tranKeyBytes, nonceArray.length + seedBytes.length);

    // 4. Hasheamos con SHA-256
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataToHash);
    const tranKeyHashBase64 = toBase64(new Uint8Array(hashBuffer));

    return {
        login: login,
        tranKey: tranKeyHashBase64,
        nonce: nonceBase64,
        seed: seed
    };
}

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_KEY: string;
  GROQ_API_KEY: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization', 
};

export default {
  // =========================================================================
  // 1. EVENTO FETCH (Atiende las peticiones HTTP del Frontend)
  // =========================================================================
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    const authHeader = request.headers.get('Authorization');
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader ? authHeader : '' } }
    });

    const url = new URL(request.url);

    // --- ENDPOINTS DE LECTURA ---
    if (url.pathname === '/planes' && request.method === 'GET') {
      const { data } = await supabase.from('planes').select('*');
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/suscriptores' && request.method === 'GET') {
      const { data } = await supabase.from('suscriptores').select('*');
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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
              - Starter ($29/mes, $290/anual): Hasta 100 clientes activos, pases de acceso con código QR, staff ilimitado y dashboard de métricas básicas.
              - Pro ($69/mes, $690/anual): Hasta 500 clientes activos, todo lo del plan Starter + envío de recordatorios automáticos de pago a clientes por WhatsApp.
              - Elite ($149/mes, $1490/anual): Clientes ilimitados sin restricciones, todo lo de Pro + reportes financieros avanzados (Ingreso Recurrente MRR, Flujo de Caja, Tasa de Abandono) y soporte prioritario 24/7.
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
            throw new Error("Error en la comunicación con la Inteligencia Artificial.");
        }

        const data = await aiResponse.json() as any;
        const textoRespuesta = data.choices[0].message.content;

        return new Response(JSON.stringify({ respuesta: textoRespuesta }), { status: 200, headers: corsHeaders });

      } catch (e: any) {
        console.error("❌ Error 500 en /chat:", e.message);
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    // --- REGISTRO DE SOCIO CON FOTO ---
    if (url.pathname === '/suscriptores' && request.method === 'POST') {
      try {
        const body = await request.json() as any;
        const { data: cliente, error: errC } = await supabase.from('suscriptores').insert([{
            tenant_id: body.tenant_id,
            nombre_completo: body.nombre_completo,
            telefono: body.telefono,
            email: body.email,
            foto_url: body.foto_url,
            contacto_emergencia: body.contacto_emergencia,
            estado: 'Activo'
        }]).select().single();

        if (errC) throw errC;

        const fechaFin = new Date();
        fechaFin.setMonth(fechaFin.getMonth() + parseInt(body.meses_duracion));

        await supabase.from('historial_suscripciones').insert([{
            tenant_id: body.tenant_id,
            suscriptor_id: cliente.id,
            plan_id: body.plan_id,
            fecha_inicio: new Date().toISOString().split('T')[0],
            fecha_fin: fechaFin.toISOString().split('T')[0],
            estado_pago: 'Pagado',
            // NUEVO: Guardamos la preferencia del cliente
            renovacion_automatica: body.renovacion_automatica
        }]);

        return new Response(JSON.stringify({ ok: true }), { status: 201, headers: corsHeaders });
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
        icono: "❌", 
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
          res = { ...res, color: "#10B981", icono: "✅", msg: "Pase Autorizado" };
          
          // Registramos la asistencia
          await admin.from('asistencias').insert([{ tenant_id: h.tenant_id, suscriptor_id: id, metodo_acceso: 'QR' }]);
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
                <h1 style="font-size: 4rem; margin: 0 0 10px 0;">${res.icono}</h1>
                <img src="${res.foto}" alt="Foto del Socio" style="width: 160px; height: 160px; border-radius: 50%; border: 6px solid white; object-fit: cover; margin: 15px auto; box-shadow: 0 4px 15px rgba(0,0,0,0.3); background-color: white;">
                <h2 style="font-size: 1.8rem; margin: 10px 0; font-weight: bold;">${res.msg}</h2>
                <p style="font-size: 1.4rem; margin: 0; font-weight: 500;">${res.nombre}</p>
            </div>
        </body>
        </html>`, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }

    // --- INTEGRACIÓN PAYPAL (API REST V2) ---
    if (url.pathname === '/api/pagos/generar-link' && request.method === 'POST') {
        try {
            const body = await request.json() as any;

            // 1. Tus credenciales de Sandbox de PayPal (las sacaremos en el siguiente paso)
            const PAYPAL_CLIENT_ID = "TU_CLIENT_ID_AQUI";
            const PAYPAL_SECRET = "TU_SECRET_AQUI";

            // 2. Obtener el Token de Acceso (OAuth 2.0)
            const auth = btoa(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`);
            const tokenResponse = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: 'grant_type=client_credentials'
            });
            
            const tokenData = await tokenResponse.json() as any;
            const accessToken = tokenData.access_token;

            // 3. Crear la orden de cobro
            const orderPayload = {
                intent: "CAPTURE",
                purchase_units: [{
                    reference_id: `GYM-${Date.now()}`,
                    description: `Suscripción - ${body.nombre_cliente}`,
                    amount: {
                        currency_code: "USD",
                        value: body.precio_cobrado.toString()
                    }
                }],
                payment_source: {
                    paypal: {
                        experience_context: {
                            payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
                            user_action: "PAY_NOW",
                            return_url: "https://tudominio.com/pago-exitoso",
                            cancel_url: "https://tudominio.com/pago-cancelado"
                        }
                    }
                }
            };

            const orderResponse = await fetch('https://api-m.sandbox.paypal.com/v2/checkout/orders', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(orderPayload)
            });

            const orderData = await orderResponse.json() as any;

            // 4. Extraer el link exacto donde el cliente debe poner su tarjeta o cuenta
            const linkPago = orderData.links.find((link: any) => link.rel === "payer-action").href;

            return new Response(JSON.stringify({ exito: true, url_pago: linkPago }), { 
                status: 200, 
                headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            });

        } catch (error: any) {
            console.error("❌ Error con PayPal:", error);
            return new Response(JSON.stringify({ exito: false, mensaje: "Error conectando con pasarela" }), { 
                status: 500, headers: corsHeaders 
            });
        }
    }

    return new Response("Not Found", { status: 404 });
  },

  // =========================================================================
  // 2. EVENTO SCHEDULED (El Cron Job Automático que corre en segundo plano)
  // =========================================================================
  async scheduled(event: any, env: Env, ctx: ExecutionContext): Promise<void> {
    // Usamos SERVICE_KEY para tener acceso a todos los tenants en este proceso global
    const adminSupabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
    
    // Ajustamos la fecha para Ecuador (GMT-5)
    const fechaEcuador = new Date(new Date().getTime() - (5 * 60 * 60 * 1000));
    const hoy = fechaEcuador.toISOString().split('T')[0]; 

    try {
        console.log(`⏱️ Iniciando revisión automática de pagos para el: ${hoy}`);

        // 1. Buscamos suscripciones vencidas de gimnasios Pro o Elite
        const { data: suscripciones, error } = await adminSupabase
            .from('historial_suscripciones')
            .select(`
                id,
                fecha_fin,
                estado_pago,
                suscriptores!inner (nombre_completo, telefono),
                tenants!inner (nombre_negocio, plan_saas)
            `)
            .eq('estado_pago', 'Pagado')
            .lt('fecha_fin', hoy) 
            .in('tenants.plan_saas', ['Pro', 'elite']);

        if (error) throw error;

        if (!suscripciones || suscripciones.length === 0) {
            console.log("✅ No hay suscripciones vencidas de planes Premium para alertar hoy.");
            return;
        }

        console.log(`⚠️ Se encontraron ${suscripciones.length} suscripciones vencidas. Iniciando actualizaciones...`);

        // 2. Procesamos cada suscripción encontrada
        for (const sub of suscripciones) {
            
            // A. Cambiamos el estado a 'Atrasado' en Supabase
            await adminSupabase
                .from('historial_suscripciones')
                .update({ estado_pago: 'Atrasado' })
                .eq('id', sub.id);

            // B. Variables tipadas para la simulación de WhatsApp
            const nombre = (sub.suscriptores as any).nombre_completo;
            const telefono = (sub.suscriptores as any).telefono;
            const gym = (sub.tenants as any).nombre_negocio;
            const plan = (sub.tenants as any).plan_saas;

            console.log(`
            =========================================
            📲 SIMULACIÓN DE WHATSAPP ENVIADO
            Destino: ${telefono}
            Gimnasio: ${gym} (Plan: ${plan.toUpperCase()})
            Mensaje: "Hola ${nombre}, notamos que tu mensualidad en ${gym} se venció el ${sub.fecha_fin}. ¡Te extrañamos en el entrenamiento! Escríbenos para regularizar tu cuenta."
            =========================================`);
        }

        console.log("✅ Revisión automática completada con éxito.");

    } catch (error: any) {
        console.error("❌ Error grave en el Cron Job:", error.message);
    }
  }
};