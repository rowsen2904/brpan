import { AreaChart, DonutChart } from '@mantine/charts';
import { Badge, Grid, Group, Paper, Progress, SimpleGrid, Skeleton, Stack, Table, Text, Title } from '@mantine/core';
import { IconActivity, IconArrowsExchange, IconClockExclamation, IconUserCheck, IconUserOff, IconUsers } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';

import { StatCard } from '@/components/common';
import { api } from '@/lib/api';
import { bytes, duration, rate } from '@/lib/format';
import { PROTOCOL_META, type Protocol, type UsagePoint } from '@/lib/types';

interface Core {
    enabled: boolean;
    running: boolean;
    version?: string;
    uptime: number;
}

interface Dashboard {
    users: {
        total: number;
        active: number;
        disabled: number;
        limited: number;
        expired: number;
        online: number;
        onlineDay: number;
        neverOnline: number;
        expiringSoon: number;
        lifetimeTraffic: number;
        devices: number;
    };
    system: {
        hostname: string;
        platform: string;
        cpus: number;
        cpuModel: string;
        cpuUsage: number;
        load: number[];
        memory: { total: number; free: number };
        disk: { total: number; free: number } | null;
        uptime: number;
        net: { rate: { rx: number; tx: number }; total: { rx: number; tx: number } | null };
    };
    cores: { xray: Core; openvpn: Core; wireguard: Core; amneziawg: Core; caddy: { enabled: boolean; applied: boolean; error: string | null } };
    traffic: Record<'today' | 'week' | 'month', { up: number; down: number }>;
    series: UsagePoint[];
    protocols: { protocol: string; up: number; down: number }[];
    topUsers: { id: number; username: string; total: number }[];
}

function CoreRow({ name, core }: { name: string; core: Core }) {
    const color = !core.enabled ? 'gray' : core.running ? 'teal' : 'red';
    const label = !core.enabled ? 'disabled' : core.running ? 'running' : 'stopped';
    return (
        <Group justify="space-between">
            <Text size="sm">
                {name} {core.version && <Text span c="dimmed" size="xs">v{core.version}</Text>}
            </Text>
            <Group gap="xs">
                {core.running && <Text size="xs" c="dimmed">{duration(core.uptime)}</Text>}
                <Badge color={color} variant="light" size="sm">
                    {label}
                </Badge>
            </Group>
        </Group>
    );
}

function Meter({ label, value, total, text }: { label: string; value: number; total: number; text: string }) {
    const pct = total > 0 ? (value / total) * 100 : 0;
    return (
        <div>
            <Group justify="space-between" mb={4}>
                <Text size="sm">{label}</Text>
                <Text size="xs" c="dimmed">
                    {text}
                </Text>
            </Group>
            <Progress value={pct} color={pct > 85 ? 'red' : pct > 65 ? 'orange' : 'cyan'} size="md" />
        </div>
    );
}

export function DashboardPage() {
    const { data } = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/api/dashboard'), refetchInterval: 5000 });

    if (!data) {
        return (
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
                {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} h={100} radius="md" />
                ))}
            </SimpleGrid>
        );
    }

    const { users, system, traffic, cores } = data;
    const sum = (t: { up: number; down: number }) => t.up + t.down;
    const memUsed = system.memory.total - system.memory.free;
    const series = data.series.map((p) => ({ date: p.date.slice(5), Upload: +(p.up / 1024 ** 3).toFixed(3), Download: +(p.down / 1024 ** 3).toFixed(3) }));
    const donut = data.protocols
        .filter((p) => p.up + p.down > 0)
        .map((p) => ({
            name: PROTOCOL_META[p.protocol as Protocol]?.label ?? p.protocol,
            value: +((p.up + p.down) / 1024 ** 3).toFixed(3),
            color: `${PROTOCOL_META[p.protocol as Protocol]?.color ?? 'gray'}.6`,
        }));

    return (
        <Stack>
            <Title order={3}>Dashboard</Title>
            <SimpleGrid cols={{ base: 1, xs: 2, lg: 3, xl: 6 }}>
                <StatCard title="Users" value={users.total} hint={`${users.devices} devices`} icon={<IconUsers />} />
                <StatCard title="Online" value={users.online} hint={`${users.onlineDay} in 24h`} icon={<IconActivity />} color="teal" />
                <StatCard title="Active" value={users.active} hint={`${users.neverOnline} never connected`} icon={<IconUserCheck />} color="green" />
                <StatCard
                    title="Limited / expired"
                    value={`${users.limited} / ${users.expired}`}
                    hint={`${users.disabled} disabled`}
                    icon={<IconUserOff />}
                    color="orange"
                />
                <StatCard title="Expiring in 3 days" value={users.expiringSoon} icon={<IconClockExclamation />} color="red" />
                <StatCard title="Traffic today" value={bytes(sum(traffic.today))} hint={`30d: ${bytes(sum(traffic.month))}`} icon={<IconArrowsExchange />} color="grape" />
            </SimpleGrid>

            <Grid>
                <Grid.Col span={{ base: 12, lg: 8 }}>
                    <Paper withBorder p="md" className="glass" h="100%">
                        <Group justify="space-between" mb="md">
                            <Text fw={600}>Traffic, last 30 days (GB)</Text>
                            <Text size="xs" c="dimmed">
                                7d: {bytes(sum(traffic.week))} · lifetime: {bytes(users.lifetimeTraffic)}
                            </Text>
                        </Group>
                        <AreaChart
                            h={260}
                            data={series}
                            dataKey="date"
                            type="stacked"
                            withDots={false}
                            curveType="monotone"
                            series={[
                                { name: 'Download', color: 'cyan.6' },
                                { name: 'Upload', color: 'teal.6' },
                            ]}
                        />
                    </Paper>
                </Grid.Col>
                <Grid.Col span={{ base: 12, lg: 4 }}>
                    <Paper withBorder p="md" className="glass" h="100%">
                        <Text fw={600} mb="md">
                            Protocols, 30 days (GB)
                        </Text>
                        {donut.length ? (
                            <Group justify="center">
                                <DonutChart data={donut} size={180} thickness={24} withTooltip tooltipDataSource="segment" />
                            </Group>
                        ) : (
                            <Text c="dimmed" size="sm" ta="center" mt="xl">
                                No traffic yet
                            </Text>
                        )}
                        <Stack gap={4} mt="md">
                            {donut.map((d) => (
                                <Group key={d.name} justify="space-between">
                                    <Badge variant="dot" color={d.color.split('.')[0]}>
                                        {d.name}
                                    </Badge>
                                    <Text size="xs">{d.value} GB</Text>
                                </Group>
                            ))}
                        </Stack>
                    </Paper>
                </Grid.Col>
            </Grid>

            <Grid>
                <Grid.Col span={{ base: 12, md: 6, lg: 4 }}>
                    <Paper withBorder p="md" className="glass" h="100%">
                        <Text fw={600} mb="md">
                            Server · {system.hostname}
                        </Text>
                        <Stack gap="sm">
                            <Meter label={`CPU · ${system.cpus} cores`} value={system.cpuUsage} total={1} text={`${(system.cpuUsage * 100).toFixed(1)}% · load ${system.load.map((l) => l.toFixed(2)).join(' ')}`} />
                            <Meter label="Memory" value={memUsed} total={system.memory.total} text={`${bytes(memUsed)} / ${bytes(system.memory.total)}`} />
                            {system.disk && (
                                <Meter label="Disk" value={system.disk.total - system.disk.free} total={system.disk.total} text={`${bytes(system.disk.total - system.disk.free)} / ${bytes(system.disk.total)}`} />
                            )}
                            <Group justify="space-between">
                                <Text size="sm">Network</Text>
                                <Text size="xs" c="dimmed">
                                    ↓ {rate(system.net.rate.rx)} · ↑ {rate(system.net.rate.tx)}
                                </Text>
                            </Group>
                            <Group justify="space-between">
                                <Text size="sm">Uptime</Text>
                                <Text size="xs" c="dimmed">
                                    {duration(system.uptime * 1000)}
                                </Text>
                            </Group>
                        </Stack>
                    </Paper>
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 6, lg: 4 }}>
                    <Paper withBorder p="md" className="glass" h="100%">
                        <Text fw={600} mb="md">
                            Cores
                        </Text>
                        <Stack gap="sm">
                            <CoreRow name="Xray" core={cores.xray} />
                            <CoreRow name="WireGuard" core={cores.wireguard} />
                            <CoreRow name="AmneziaWG" core={cores.amneziawg} />
                            <CoreRow name="OpenVPN" core={cores.openvpn} />
                            <Group justify="space-between">
                                <Text size="sm">Caddy (TLS)</Text>
                                <Badge color={!cores.caddy.enabled ? 'gray' : cores.caddy.applied ? 'teal' : 'red'} variant="light" size="sm">
                                    {!cores.caddy.enabled ? 'external' : cores.caddy.applied ? 'configured' : 'not applied'}
                                </Badge>
                            </Group>
                        </Stack>
                    </Paper>
                </Grid.Col>
                <Grid.Col span={{ base: 12, lg: 4 }}>
                    <Paper withBorder p="md" className="glass" h="100%">
                        <Text fw={600} mb="sm">
                            Top users, 30 days
                        </Text>
                        <Table>
                            <Table.Tbody>
                                {data.topUsers.map((u, i) => (
                                    <Table.Tr key={u.id}>
                                        <Table.Td w={24}>
                                            <Text size="xs" c="dimmed">
                                                {i + 1}
                                            </Text>
                                        </Table.Td>
                                        <Table.Td>
                                            <Text size="sm">{u.username}</Text>
                                        </Table.Td>
                                        <Table.Td ta="right">
                                            <Text size="sm">{bytes(u.total)}</Text>
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                        {!data.topUsers.length && (
                            <Text c="dimmed" size="sm" ta="center">
                                No traffic yet
                            </Text>
                        )}
                    </Paper>
                </Grid.Col>
            </Grid>
        </Stack>
    );
}
