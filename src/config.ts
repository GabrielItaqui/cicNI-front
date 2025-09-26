export const API = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
export const endpoints = {
  coParse: (profile: string) => `${API}/v1/co/parse?profile=${profile}`,
  fcParse: (profile: string) => `${API}/v1/fc/parse`,
};
