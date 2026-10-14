import { ActionIcon, AppShell, Burger, Group, NavLink, ScrollArea, Text, ThemeIcon, Tooltip, useMantineColorScheme } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconAdjustments, IconLayoutDashboard, IconLogout, IconMoon, IconPlugConnected, IconServer, IconSun, IconUsers } from '@tabler/icons-react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { auth } from '@/lib/api';

import { Logo } from './Logo';

const NAV = [
    { to: '/', label: 'Dashboard', icon: IconLayoutDashboard },
    { to: '/users', label: 'Users', icon: IconUsers },
    { to: '/protocols', label: 'Protocols', icon: IconPlugConnected },
    { to: '/system', label: 'Cores & logs', icon: IconServer },
    { to: '/settings', label: 'Settings', icon: IconAdjustments },
];

export function Layout() {
    const [opened, { toggle, close }] = useDisclosure();
    const location = useLocation();
    const navigate = useNavigate();
    const { colorScheme, toggleColorScheme } = useMantineColorScheme();

    return (
        <AppShell header={{ height: 60 }} navbar={{ width: 250, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="md">
            <AppShell.Header>
                <Group h="100%" px="md" justify="space-between">
                    <Group gap="sm">
                        <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
                        <Logo />
                    </Group>
                    <Group gap="xs">
                        <Tooltip label="Toggle theme">
                            <ActionIcon variant="default" size="lg" onClick={toggleColorScheme}>
                                {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
                            </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Log out">
                            <ActionIcon
                                variant="default"
                                size="lg"
                                onClick={() => {
                                    auth.set(null);
                                    navigate('/login');
                                }}
                            >
                                <IconLogout size={18} />
                            </ActionIcon>
                        </Tooltip>
                    </Group>
                </Group>
            </AppShell.Header>
            <AppShell.Navbar p="sm">
                <AppShell.Section grow component={ScrollArea}>
                    {NAV.map((item) => (
                        <NavLink
                            key={item.to}
                            label={item.label}
                            active={item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)}
                            leftSection={
                                <ThemeIcon variant="light" size="md">
                                    <item.icon size={16} />
                                </ThemeIcon>
                            }
                            onClick={() => {
                                navigate(item.to);
                                close();
                            }}
                            styles={{ root: { borderRadius: 'var(--mantine-radius-md)', marginBottom: 4 } }}
                        />
                    ))}
                </AppShell.Section>
                <AppShell.Section>
                    <Text size="xs" c="dimmed" ta="center">
                        BRPAN · lightweight VPN panel
                    </Text>
                </AppShell.Section>
            </AppShell.Navbar>
            <AppShell.Main>
                <Outlet />
            </AppShell.Main>
        </AppShell>
    );
}
