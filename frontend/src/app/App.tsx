import { BrowserRouter, Route, Routes } from 'react-router-dom';

import NotFoundPage from '@/app/NotFoundPage';
import IntakePage from '@/features/intake/IntakePage';
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
      </Routes>
    </BrowserRouter>
  );
}