import { Navigate, Outlet } from 'react-router-dom';
import { getToken } from './session';

export default function RequireAuth() {
  return getToken() ? <Outlet /> : <Navigate to="/panel/login" replace />;
}