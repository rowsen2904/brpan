import { AreaChart } from '@mantine/charts';
import { ActionIcon, Anchor, Badge, Button, Drawer, Group, Paper, SimpleGrid, Stack, Table, Tabs, Text, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconDeviceMobile, IconDownload, IconEdit, IconKey, IconLink, IconRefresh, IconTrash, IconWorld } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { api, notifyOk } from '@/lib/api';
import { bytes, date, daysLeft, fromNow } from '@/lib/format';
import { PROTOCOL_META, type UserDetails } from '@/lib/types';

import { Copy, LinkRow, OnlineDot, ProtocolBadge, StatusBadge, TrafficCell } from './common';

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <Paper withBorder p="xs" radius="md">
            <Text size="xs" c="dimmed">
                {label}
            </Text>
            <Text size="sm" component="div" mt={2}>
                {children}
            </Text>
        </Paper>
    );
}

export function UserDrawer({ userId, onClose, onEdit }: { userId: number | null; onClose: () => void; onEdit: (id: number) => void }) {
    const qc = useQueryClient();
    const { data } = useQuery({
        queryKey: ['user', userId],
        queryFn: () => api<UserDetails>(`/api/users/${userId}`),
        enabled: userId !== null,
        refetchInterval: 10_000,
    });

    const refresh = () => {
        void qc.invalidateQueries({ queryKey: ['user', userId] });
        void qc.invalidateQueries({ queryKey: ['users'] });
    };

    const action = (path: string, message: string, confirm?: string) => {
        const run = async () => {
            await api(`/api/users/${userId}/${path}`, { method: 'POST' });
            notifyOk(message);
            refresh();
        };
        if (!confirm) return void run();
        modals.openConfirmModal({
            title: 'Confirm',
            children: <Text size="sm">{confirm}</Text>,
            labels: { confirm: 'Confirm', cancel: 'Cancel' },
            confirmProps: { color: 'red' },
            onConfirm: run,
        });
    };

    const deleteDevice = async (deviceId?: number) => {
        await api(`/api/users/${userId}/devices${deviceId ? `/${deviceId}` : ''}`, { method: 'DELETE' });
        notifyOk('Device removed');
        refresh();
    };

    const u = data?.user;
    const sub = data?.subscription;
    const left = u ? daysLeft(u.expireAt) : null;

    return (
        <Drawer opened={userId !== null} onClose={onClose} position="right" size="xl" title={u ? <Group gap="xs"><OnlineDot onlineAt={u.onlineAt} /><Text fw={600}>{u.username}</Text><StatusBadge status={u.status} blocked={!!u.blockedUntil && u.blockedUntil > Date.now()} /></Group> : 'User'}>
            {u && sub && (
                <Stack>
                    <Group gap="xs">
                        <Button size="xs" leftSection={<IconEdit size={14} />} onClick={() => onEdit(u.id)}>
                            Edit
                        </Button>
                        <Button size="xs" variant="light" leftSection={<IconRefresh size={14} />} onClick={() => action('reset', 'Traffic reset')}>
                            Reset traffic
                        </Button>
                        {u.status === 'DISABLED' ? (
                            <Button size="xs" variant="light" color="teal" onClick={() => action('enable', 'User enabled')}>
                                Enable
                            </Button>
                        ) : (
                            <Button size="xs" variant="light" color="orange" onClick={() => action('disable', 'User disabled')}>
                                Disable
                            </Button>
                        )}
                        <Button
                            size="xs"
                            variant="light"
                            color="red"
                            leftSection={<IconKey size={14} />}
                            onClick={() => action('revoke', 'Credentials revoked', 'All keys, links and the subscription URL will be regenerated. Old configs stop working immediately.')}
                        >
                            Revoke keys
                        </Button>
                    </Group>

                    <Tabs defaultValue="links" keepMounted={false}>
                        <Tabs.List>
                            <Tabs.Tab value="links" leftSection={<IconLink size={14} />}>
                                Links
                            </Tabs.Tab>
                            <Tabs.Tab value="info">Overview</Tabs.Tab>
                            <Tabs.Tab value="devices" leftSection={<IconDeviceMobile size={14} />}>
                                Devices ({data.devices.length})
                            </Tabs.Tab>
                            <Tabs.Tab value="ips" leftSection={<IconWorld size={14} />}>
                                IPs
                            </Tabs.Tab>
                        </Tabs.List>

                        <Tabs.Panel value="links" pt="md">
                            <Stack gap="xs">
                                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                                    Subscription
                                </Text>
                                <LinkRow label="Subscription URL" value={sub.url} badge={<Badge size="xs" variant="light">all clients</Badge>} />
                                {sub.happ && <LinkRow label="Happ (encrypted)" value={sub.happ} badge={<Badge size="xs" color="grape" variant="light">happ://crypt</Badge>} />}
                                <LinkRow label="Happ (plain)" value={sub.happPlain} />
                                {sub.outline && <LinkRow label="Outline dynamic key" value={sub.outline} badge={<Badge size="xs" color="orange" variant="light">ssconf</Badge>} />}
                                <LinkRow label="Clash / Mihomo" value={sub.clash} qr={false} />
                                <LinkRow label="sing-box" value={sub.singbox} qr={false} />
                                <Group gap="xs">
                                    {sub.wireguard && (
                                        <Button component="a" href={sub.wireguard} size="xs" variant="light" color="red" leftSection={<IconDownload size={14} />}>
                                            WireGuard .conf
                                        </Button>
                                    )}
                                    {sub.amneziawg && (
                                        <Button component="a" href={sub.amneziawg} size="xs" variant="light" color="violet" leftSection={<IconDownload size={14} />}>
                                            AmneziaWG .conf
                                        </Button>
                                    )}
                                    {sub.openvpn && (
                                        <Button component="a" href={sub.openvpn} size="xs" variant="light" color="yellow" leftSection={<IconDownload size={14} />}>
                                            OpenVPN .ovpn
                                        </Button>
                                    )}
                                    <Anchor href={sub.url} target="_blank" size="xs">
                                        Open subscription page
                                    </Anchor>
                                </Group>
                                <Text size="xs" c="dimmed" tt="uppercase" fw={600} mt="sm">
                                    Direct keys
                                </Text>
                                {sub.links.map((l) =>
                                    l.link ? <LinkRow key={l.protocol} label={l.label} value={l.link} badge={<Text size="xs" c="dimmed">{PROTOCOL_META[l.protocol].clients}</Text>} /> : null,
                                )}
                                {!sub.links.length && (
                                    <Text size="sm" c="dimmed">
                                        No enabled protocols for this user
                                    </Text>
                                )}
                            </Stack>
                        </Tabs.Panel>

                        <Tabs.Panel value="info" pt="md">
                            <Stack>
                                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                                    <Field label="Traffic">
                                        <TrafficCell user={u} />
                                    </Field>
                                    <Field label="Lifetime traffic">{bytes(u.lifetimeUsed)}</Field>
                                    <Field label="Expires">
                                        {date(u.expireAt)} {left !== null && <Text span size="xs" c={left < 3 ? 'red' : 'dimmed'}>({left > 0 ? `${left}d left` : 'expired'})</Text>}
                                    </Field>
                                    <Field label="Reset strategy">{u.resetStrategy.replace('_', ' ').toLowerCase()} · last {date(u.lastResetAt)}</Field>
                                    <Field label="Device limit">{u.deviceLimit || '∞'} · {data.devices.length} registered</Field>
                                    <Field label="Last online">{fromNow(u.onlineAt)}</Field>
                                    <Field label="Subscription updated">
                                        {fromNow(u.subUpdatedAt)}
                                        {u.subUserAgent && (
                                            <Text size="xs" c="dimmed" lineClamp={1}>
                                                {u.subUserAgent}
                                            </Text>
                                        )}
                                    </Field>
                                    <Field label="Created">{date(u.createdAt)}</Field>
                                    <Field label="UUID">
                                        <Group gap={4} wrap="nowrap">
                                            <Text size="xs" className="mono">
                                                {u.uuid}
                                            </Text>
                                            <Copy value={u.uuid} size="sm" />
                                        </Group>
                                    </Field>
                                    <Field label="WireGuard IP">{u.wgIp}</Field>
                                    {u.telegramId && <Field label="Telegram ID">{u.telegramId}</Field>}
                                    {u.email && <Field label="Email">{u.email}</Field>}
                                </SimpleGrid>
                                <Group gap={6}>
                                    {u.protocols.map((p) => (
                                        <ProtocolBadge key={p} protocol={p} />
                                    ))}
                                </Group>
                                {u.note && (
                                    <Paper withBorder p="xs">
                                        <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                                            {u.note}
                                        </Text>
                                    </Paper>
                                )}
                                <Paper withBorder p="md">
                                    <Text size="sm" fw={600} mb="sm">
                                        Usage, 30 days (MB)
                                    </Text>
                                    <AreaChart
                                        h={180}
                                        data={data.usage.map((p) => ({ date: p.date.slice(5), Download: +(p.down / 1024 ** 2).toFixed(1), Upload: +(p.up / 1024 ** 2).toFixed(1) }))}
                                        dataKey="date"
                                        type="stacked"
                                        withDots={false}
                                        series={[
                                            { name: 'Download', color: 'cyan.6' },
                                            { name: 'Upload', color: 'teal.6' },
                                        ]}
                                    />
                                </Paper>
                            </Stack>
                        </Tabs.Panel>

                        <Tabs.Panel value="devices" pt="md">
                            <Stack>
                                <Group justify="space-between">
                                    <Text size="sm" c="dimmed">
                                        Devices are registered by HWID when an app fetches the subscription.
                                    </Text>
                                    {data.devices.length > 0 && (
                                        <Button size="xs" variant="light" color="red" onClick={() => deleteDevice()}>
                                            Remove all
                                        </Button>
                                    )}
                                </Group>
                                <Table striped>
                                    <Table.Thead>
                                        <Table.Tr>
                                            <Table.Th>Device</Table.Th>
                                            <Table.Th>HWID</Table.Th>
                                            <Table.Th>Last seen</Table.Th>
                                            <Table.Th />
                                        </Table.Tr>
                                    </Table.Thead>
                                    <Table.Tbody>
                                        {data.devices.map((d) => (
                                            <Table.Tr key={d.id}>
                                                <Table.Td>
                                                    <Text size="sm">{[d.platform, d.os_version, d.model].filter(Boolean).join(' · ') || 'Unknown'}</Text>
                                                    <Text size="xs" c="dimmed" lineClamp={1}>
                                                        {d.user_agent}
                                                    </Text>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Text size="xs" className="mono">
                                                        {d.hwid}
                                                    </Text>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Text size="xs">{fromNow(d.updated_at)}</Text>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Tooltip label="Remove">
                                                        <ActionIcon variant="subtle" color="red" onClick={() => deleteDevice(d.id)}>
                                                            <IconTrash size={14} />
                                                        </ActionIcon>
                                                    </Tooltip>
                                                </Table.Td>
                                            </Table.Tr>
                                        ))}
                                    </Table.Tbody>
                                </Table>
                                {!data.devices.length && (
                                    <Text size="sm" c="dimmed" ta="center">
                                        No devices yet
                                    </Text>
                                )}
                            </Stack>
                        </Tabs.Panel>

                        <Tabs.Panel value="ips" pt="md">
                            <Table striped>
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>IP</Table.Th>
                                        <Table.Th>Core</Table.Th>
                                        <Table.Th>Last seen</Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {data.ips.map((ip) => (
                                        <Table.Tr key={ip.ip}>
                                            <Table.Td className="mono">{ip.ip}</Table.Td>
                                            <Table.Td>{ip.protocol}</Table.Td>
                                            <Table.Td>{fromNow(ip.last_seen)}</Table.Td>
                                        </Table.Tr>
                                    ))}
                                </Table.Tbody>
                            </Table>
                            {!data.ips.length && (
                                <Text size="sm" c="dimmed" ta="center" mt="md">
                                    No connections recorded
                                </Text>
                            )}
                        </Tabs.Panel>
                    </Tabs>
                </Stack>
            )}
        </Drawer>
    );
}
