import { Badge, Button, Code, Group, Paper, ScrollArea, Stack, Tabs, Text, Title } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { api, notifyOk } from '@/lib/api';
import { duration } from '@/lib/format';

interface CoreState {
    running?: boolean;
    version?: string;
    uptime?: number;
    logs?: string[];
}

interface Cores {
    xray: CoreState;
    openvpn: CoreState;
    wireguard: CoreState;
    amneziawg: CoreState;
    caddy: { enabled: boolean; applied: boolean; error: string | null; caddyfile: string };
}

const CORES = [
    { id: 'xray', label: 'Xray' },
    { id: 'wireguard', label: 'WireGuard' },
    { id: 'amneziawg', label: 'AmneziaWG' },
    { id: 'openvpn', label: 'OpenVPN' },
] as const;

export function SystemPage() {
    const { data, refetch } = useQuery({ queryKey: ['cores'], queryFn: () => api<Cores>('/api/system/cores'), refetchInterval: 5000 });
    const config = useQuery({ queryKey: ['xray-config'], queryFn: () => api<unknown>('/api/system/xray/config'), enabled: false });
    const [busy, setBusy] = useState<string | null>(null);

    const restart = async (core: string) => {
        setBusy(core);
        try {
            await api(`/api/system/${core}/restart`, { method: 'POST' });
            notifyOk(`${core} restarted`);
            await refetch();
        } finally {
            setBusy(null);
        }
    };

    if (!data) return null;

    return (
        <Stack>
            <Title order={3}>Cores & logs</Title>
            <Tabs defaultValue="xray" onChange={(v) => v === 'xray-config' && config.refetch()}>
                <Tabs.List>
                    {CORES.map((c) => (
                        <Tabs.Tab key={c.id} value={c.id} rightSection={<Badge size="xs" color={data[c.id].running ? 'teal' : 'gray'} variant="dot" />}>
                            {c.label}
                        </Tabs.Tab>
                    ))}
                    <Tabs.Tab value="caddy">Caddy</Tabs.Tab>
                    <Tabs.Tab value="xray-config">Xray config</Tabs.Tab>
                </Tabs.List>
                {CORES.map((c) => {
                    const core = data[c.id];
                    return (
                        <Tabs.Panel key={c.id} value={c.id} pt="md">
                            <Paper withBorder p="md" className="glass">
                                <Group justify="space-between" mb="sm">
                                    <Group gap="xs">
                                        <Badge color={core.running ? 'teal' : 'red'} variant="light">
                                            {core.running ? 'running' : 'stopped'}
                                        </Badge>
                                        {core.version && <Text size="sm">v{core.version}</Text>}
                                        {core.running && core.uptime ? (
                                            <Text size="xs" c="dimmed">
                                                uptime {duration(core.uptime)}
                                            </Text>
                                        ) : null}
                                    </Group>
                                    <Button size="xs" variant="light" leftSection={<IconRefresh size={14} />} loading={busy === c.id} onClick={() => restart(c.id)}>
                                        Restart
                                    </Button>
                                </Group>
                                <div className="logbox">{core.logs?.length ? core.logs.join('\n') : 'No log output'}</div>
                            </Paper>
                        </Tabs.Panel>
                    );
                })}
                <Tabs.Panel value="caddy" pt="md">
                    <Paper withBorder p="md" className="glass">
                        <Group justify="space-between" mb="sm">
                            <Group gap="xs">
                                <Badge color={data.caddy.applied ? 'teal' : 'red'} variant="light">
                                    {data.caddy.enabled ? (data.caddy.applied ? 'applied' : 'not applied') : 'managed externally'}
                                </Badge>
                                {data.caddy.error && (
                                    <Text size="xs" c="red">
                                        {data.caddy.error}
                                    </Text>
                                )}
                            </Group>
                            <Button size="xs" variant="light" leftSection={<IconRefresh size={14} />} loading={busy === 'caddy'} onClick={() => restart('caddy')}>
                                Re-apply
                            </Button>
                        </Group>
                        <Code block>{data.caddy.caddyfile || 'Set a domain or server address first'}</Code>
                    </Paper>
                </Tabs.Panel>
                <Tabs.Panel value="xray-config" pt="md">
                    <Paper withBorder p="md" className="glass">
                        <ScrollArea h={600}>
                            <Code block>{config.data ? JSON.stringify(config.data, null, 2) : 'Loading…'}</Code>
                        </ScrollArea>
                    </Paper>
                </Tabs.Panel>
            </Tabs>
        </Stack>
    );
}
