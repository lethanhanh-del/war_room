const KEY_STORAGE = 'war_room_access_key';

export function getAccessKey() {
  try {
    return localStorage.getItem(KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export function setAccessKey(v) {
  try {
    if (v) localStorage.setItem(KEY_STORAGE, v);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* bỏ qua */
  }
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function fetchDashboard({ force = false } = {}) {
  const headers = {};
  const key = getAccessKey();
  if (key) headers['x-access-key'] = key;
  const res = await fetch(`/api/dashboard${force ? '?force=1' : ''}`, { headers, cache: 'no-store' });
  let json = {};
  try {
    json = await res.json();
  } catch {
    /* rỗng */
  }
  if (!res.ok) throw new ApiError(json.error || `Lỗi ${res.status}`, res.status);
  return json;
}
