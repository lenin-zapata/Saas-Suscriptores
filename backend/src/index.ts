import { createClient } from '@supabase/supabase-js';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_KEY: string;
}

// 1. ¡NUEVO! Agregamos "Authorization" para que el navegador deje pasar el Token
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization', 
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    // 2. ¡NUEVO! Capturamos el Token que nos envía la página web
    const authHeader = request.headers.get('Authorization');

    // 3. ¡NUEVO! Le pasamos ese Token a Supabase para que aplique tu RLS
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: authHeader ? authHeader : ''
        }
      }
    });

    const url = new URL(request.url);

    // --- NUEVO ENDPOINT: GET (Leer Planes) ---
    if (url.pathname === '/planes' && request.method === 'GET') {
      const { data, error } = await supabase.from('planes').select('*');
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
      return new Response(JSON.stringify(data), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // --- ENDPOINT GET (Leer suscriptores - SE MANTIENE IGUAL) ---
    if (url.pathname === '/suscriptores' && request.method === 'GET') {
      const { data, error } = await supabase.from('suscriptores').select('*');
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
      return new Response(JSON.stringify(data), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // --- ENDPOINT POST ACTUALIZADO (Crear Cliente + Historial) ---
    if (url.pathname === '/suscriptores' && request.method === 'POST') {
      try {
        const body = await request.json() as any;
        
        // 1. Insertamos al cliente primero
        const { data: cliente, error: errCliente } = await supabase.from('suscriptores').insert([
            {
              tenant_id: body.tenant_id,
              nombre_completo: body.nombre_completo,
              telefono: body.telefono,
              email: body.email,
              estado: 'Activo'
            }
          ]).select().single(); // .single() nos devuelve el objeto exacto recién creado con su ID

        if (errCliente) throw errCliente;

        // 2. Calculamos las fechas con JavaScript puro
        const fechaInicio = new Date();
        const fechaFin = new Date();
        fechaFin.setMonth(fechaFin.getMonth() + parseInt(body.meses_duracion)); // Sumamos los meses del plan

        // 3. Insertamos su primera transacción en el historial
        const { error: errHistorial } = await supabase.from('historial_suscripciones').insert([
          {
            tenant_id: body.tenant_id,
            suscriptor_id: cliente.id,
            plan_id: body.plan_id,
            fecha_inicio: fechaInicio.toISOString().split('T')[0], // Formato YYYY-MM-DD
            fecha_fin: fechaFin.toISOString().split('T')[0],
            estado_pago: 'Pagado' // Entra pagado por defecto
          }
        ]);

        if (errHistorial) throw errHistorial;

        return new Response(JSON.stringify({ mensaje: "Cliente y suscripción creados con éxito" }), { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message || "Error interno" }), { status: 400, headers: corsHeaders });
      }
    }

    return new Response("Endpoint no encontrado", { status: 404, headers: corsHeaders });
  },

  
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // IMPORTANTE: Usamos la Service Key para saltar la seguridad RLS al hacer tareas de administrador
    const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
    
    console.log(`\n⏰ [${new Date().toISOString()}] Iniciando auditoría automática...`);

    // Obtenemos la fecha de hoy en formato YYYY-MM-DD
    const hoy = new Date().toISOString().split('T')[0];

    // --- FASE 1: ACTUALIZACIÓN DE ESTADOS ---
    console.log(`🔍 Buscando suscripciones vencidas (Fecha Fin < ${hoy})...`);
    
    const { data: actualizados, error: errUpdate } = await supabaseAdmin
      .from('historial_suscripciones')
      .update({ estado_pago: 'Atrasado' })
      .eq('estado_pago', 'Pagado') // Solo tocamos los que están pagados
      .lt('fecha_fin', hoy)        // "lt" significa Less Than (Menor que hoy)
      .select();

    if (errUpdate) {
      console.error("❌ Error en Fase 1:", errUpdate.message);
      return;
    }

    if (actualizados && actualizados.length > 0) {
      console.log(`🔄 ¡Se encontraron y actualizaron ${actualizados.length} clientes a 'Atrasado'!`);
    } else {
      console.log(`✅ No hay nuevas suscripciones vencidas hoy.`);
    }

    // --- FASE 2: ENVÍO DE COBRANZAS (Lo que ya tenías) ---
    console.log(`\n💸 Buscando clientes con estado 'Atrasado' para cobrar...`);
    
    const { data: morosos, error: errCobros } = await supabaseAdmin
      .from('historial_suscripciones')
      .select(`fecha_fin, suscriptores (nombre_completo, telefono)`)
      .eq('estado_pago', 'Atrasado');

    if (errCobros) {
      console.error("❌ Error en Fase 2:", errCobros.message);
      return;
    }

    if (morosos && morosos.length > 0) {
      for (const registro of morosos) {
        const cliente = registro.suscriptores as any; 
        const mensaje = `Hola ${cliente.nombre_completo}. Te recordamos que tu membresía venció el ${registro.fecha_fin}. Por favor, regulariza tu pago para seguir entrenando. 💪`;
        
        console.log(`🚀 [SIMULANDO WHATSAPP] -> Destino: ${cliente.telefono} | Mensaje: "${mensaje}"`);
      }
    } else {
      console.log("✅ Ningún mensaje enviado. Todos están al día.");
    }
    console.log(`🏁 Auditoría finalizada.\n`);
  },
};