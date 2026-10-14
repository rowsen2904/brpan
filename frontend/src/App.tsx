import { Navigate, Route, Routes } from 'react-router-dom';

import { Layout } from './components/Layout';
import { auth } from './lib/api';
import { DashboardPage } from './pages/Dashboard';
import { LoginPage } from './pages/Login';
import { ProtocolsPage } from './pages/Protocols';
import { SettingsPage } from './pages/Settings';
import { SubscriptionPage } from './pages/Subscription';
import { SystemPage } from './pages/System';
import { UsersPage } from './pages/Users';

function Protected({ children }: { children: React.ReactNode }) {
    return auth.token ? <>{children}</> : <Navigate to="/login" replace />;
}

export function App() {
    return (
        <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/sub/:token" element={<SubscriptionPage />} />
            <Route
                element={
                    <Protected>
                        <Layout />
                    </Protected>
                }
            >
                <Route path="/" element={<DashboardPage />} />
                <Route path="/users" element={<UsersPage />} />
                <Route path="/protocols" element={<ProtocolsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/system" element={<SystemPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );
}
