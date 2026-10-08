import { BrowserRouter, Route, Routes } from 'react-router-dom';
import MetricsPage from '@/features/panel/MetricsPage';

import NotFoundPage from '@/app/NotFoundPage';
import IntakePage from '@/features/intake/IntakePage';
import CaseDetailPage from '@/features/panel/CaseDetailPage';
import CasesPage from '@/features/panel/CasesPage';
import LoginPage from '@/features/panel/LoginPage';
import PanelLayout from '@/features/panel/PanelLayout';
import RequireAuth from '@/features/panel/RequireAuth';
import TrackingPage from '@/features/tracking/TrackingPage';
import PublicLayout from '@/shared/ui/PublicLayout';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/" element={<IntakePage />} />
          <Route path="/seguimiento" element={<TrackingPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>

        <Route path="/panel/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<PanelLayout />}>
            <Route path="/panel" element={<CasesPage />} />
            <Route path="/panel/casos/:claimId" element={<CaseDetailPage />} />
            <Route path="/panel/metricas" element={<MetricsPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}