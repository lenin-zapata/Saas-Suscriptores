import { createClient } from '@supabase/supabase-js';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_KEY: string;
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
            estado_pago: 'Pagado'
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