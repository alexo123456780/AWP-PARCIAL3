// Puertos fijos: el build de la PWA incrusta la URL de la API (VITE_API_URL) y el SW la guarda en IndexedDB.
export const APP_PORT = 4180;
export const API_PORT = 4181;
export const APP_ORIGIN = `http://localhost:${APP_PORT}`;
export const API_ORIGIN = `http://localhost:${API_PORT}`;
