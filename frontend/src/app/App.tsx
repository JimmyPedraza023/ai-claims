import { BrowserRouter, Route, Routes } from 'react-router-dom';
import IntakePage from '@/features/intake/IntakePage';

// Referrer-Policy: no-referrer, como respaldo mientras no haya cabecera HTTP (vercel.json al desplegar).
if (!document.querySelector('meta[name="referrer"]')) {
  const m = document.createElement('meta');
  m.name = 'referrer';
  m.content = 'no-referrer';
  document.head.appendChild(m);
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<IntakePage />} />
        {/* Después de la rama 8: <Route path="/seguimiento" element={<TrackingPage />} /> */}
        {/* Después: <Route path="/panel/*" element={<PanelRoutes />} /> */}
        <Route path="*" element={<IntakePage />} />
      </Routes>
    </BrowserRouter>
  );
}