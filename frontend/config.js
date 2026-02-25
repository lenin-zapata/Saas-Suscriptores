// frontend/config.js
const esLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

const CONFIG = {
    // Si es local usa el puerto 8787, si es prod usa la URL de tu Worker en Cloudflare
    BACKEND_URL: esLocal ? 'http://127.0.0.1:8787' : 'https://api-suscripciones.js-group.workers.dev',
    
    // Si es local usa el puerto 5500, si es prod usa la URL de Cloudflare Pages
    FRONTEND_URL: esLocal ? 'http://127.0.0.1:5500/frontend' : 'https://jsmemberly.pages.dev',
    
    // Cambia esto cuando crees tu proyecto PROD en Supabase
    SUPABASE_URL: 'https://kfqdefzuwejwmupgvelg.supabase.co',
    SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmcWRlZnp1d2Vqd211cGd2ZWxnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0MTcwMzYsImV4cCI6MjA4Njk5MzAzNn0.Wdr14R9gZ6Osy8RrVaYXC6CKUtBoYqbE9tV3oiekCPE',
};