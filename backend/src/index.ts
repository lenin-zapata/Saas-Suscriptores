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
    if (url.pathname.startsWith('/checkin/')) {
      const id = url.pathname.split('/')[2];
      const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
      const { data } = await admin.from('historial_suscripciones')
        .select('fecha_fin, estado_pago, tenant_id, suscriptores(nombre_completo, foto_url)')
        .eq('suscriptor_id', id).order('fecha_fin', { ascending: false }).limit(1);

      let res = { color: "#EF4444", icono: "❌", msg: "Acceso Denegado", nombre: "Desconocido", foto: "https://via.placeholder.com/150" };

      if (data && data.length > 0) {
        const h = data[0];
        const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
        res.nombre = (h.suscriptores as any).nombre_completo;
        res.foto = (h.suscriptores as any).foto_url || res.foto;

        if (h.estado_pago === 'Pagado' && h.fecha_fin >= hoy) {
          res = { ...res, color: "#10B981", icono: "✅", msg: "Pase Autorizado" };
          await admin.from('asistencias').insert([{ tenant_id: h.tenant_id, suscriptor_id: id }]);
        }
      }

      return new Response(`
        <html>
          <body style="background:${res.color}; color:white; font-family:sans-serif; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; margin:0;">
            <h1 style="font-size:5rem;">${res.icono}</h1>
            <img src="${res.foto}" style="width:180px; height:180px; border-radius:50%; border:5px solid white; object-fit:cover; margin:20px 0;">
            <h2>${res.msg}</h2>
            <p style="font-size:1.5rem;">${res.nombre}</p>
          </body>
        </html>`, { headers: { 'Content-Type': 'text/html' } });
    }
    return new Response("Not Found", { status: 404 });
  }
}