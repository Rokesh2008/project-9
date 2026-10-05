type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  studentId?: string | null;
};

export function getUser(): AuthUser | null {
  const raw = sessionStorage.getItem('user');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setUser(user: AuthUser) {
  sessionStorage.setItem('user', JSON.stringify(user));
}

export function clearAuth() {
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('user');
}
