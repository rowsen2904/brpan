import { ActionIcon, Badge, Button, Checkbox, Group, Menu, Pagination, Paper, ScrollArea, Select, Stack, Table, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import {
    IconCalendarPlus,
    IconCopy,
    IconDots,
    IconEdit,
    IconKey,
    IconPlayerPause,
    IconPlayerPlay,
    IconPlus,
    IconRefresh,
    IconSearch,
    IconTrash,
} from '@tabler/icons-react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { OnlineDot, StatusBadge, TrafficCell } from '@/components/common';
import { UserDrawer } from '@/components/UserDrawer';
import { UserFormModal } from '@/components/UserForm';
import { api, notifyOk } from '@/lib/api';
import { date, daysLeft, fromNow } from '@/lib/format';
import type { User } from '@/lib/types';

const PAGE = 25;

type BulkAction = 'enable' | 'disable' | 'delete' | 'reset' | 'revoke' | 'extend';

export function UsersPage() {
    const qc = useQueryClient();
    const [search, setSearch] = useState('');
    const [debounced] = useDebouncedValue(search, 300);
    const [status, setStatus] = useState<string | null>(null);
    const [sort, setSort] = useState('created_at');
    const [page, setPage] = useState(1);
    const [selected, setSelected] = useState<number[]>([]);
    const [viewId, setViewId] = useState<number | null>(null);
    const [editUser, setEditUser] = useState<User | null>(null);
    const [formOpen, setFormOpen] = useState(false);

    const params = new URLSearchParams({ offset: String((page - 1) * PAGE), limit: String(PAGE), sort, order: sort === 'username' ? 'asc' : 'desc' });
    if (debounced) params.set('search', debounced);
    if (status) params.set('status', status);

    const { data, isFetching } = useQuery({
        queryKey: ['users', params.toString()],
        queryFn: () => api<{ total: number; users: User[] }>(`/api/users?${params}`),
        placeholderData: keepPreviousData,
        refetchInterval: 15_000,
    });

    const users = data?.users ?? [];
    const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE));

    const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });

    const bulk = (action: BulkAction, ids = selected) => {
        const run = async (days?: number) => {
            await api('/api/users/bulk', { body: { ids, action, days } });
            notifyOk('Done');
            setSelected([]);
            await refresh();
            await qc.invalidateQueries({ queryKey: ['user'] });
        };
        if (action === 'extend') return void run(30);
        if (action === 'enable' || action === 'disable' || action === 'reset') return void run();
        modals.openConfirmModal({
            title: action === 'delete' ? 'Delete users' : 'Revoke credentials',
            children: <Text size="sm">{action === 'delete' ? `Delete ${ids.length} user(s)? This cannot be undone.` : `Regenerate keys and subscription URLs for ${ids.length} user(s)?`}</Text>,
            labels: { confirm: 'Confirm', cancel: 'Cancel' },
            confirmProps: { color: 'red' },
            onConfirm: () => run(),
        });
    };

    const openEdit = async (id: number) => {
        const res = await api<{ user: User }>(`/api/users/${id}`);
        setEditUser(res.user);
        setFormOpen(true);
    };

    const allSelected = users.length > 0 && users.every((u) => selected.includes(u.id));

    return (
        <Stack>
            <Group justify="space-between">
                <Title order={3}>
                    Users{' '}
                    <Text span c="dimmed" size="sm">
                        {data?.total ?? ''}
                    </Text>
                </Title>
                <Group gap="xs">
                    <ActionIcon variant="default" size="lg" onClick={refresh} loading={isFetching}>
                        <IconRefresh size={16} />
                    </ActionIcon>
                    <Button
                        leftSection={<IconPlus size={16} />}
                        onClick={() => {
                            setEditUser(null);
                            setFormOpen(true);
                        }}
                    >
                        Create
                    </Button>
                </Group>
            </Group>

            <Paper withBorder p="sm" className="glass">
                <Group gap="sm" wrap="wrap">
                    <TextInput
                        placeholder="Search by username, uuid, note, telegram, email"
                        leftSection={<IconSearch size={14} />}
                        value={search}
                        onChange={(e) => {
                            setSearch(e.currentTarget.value);
                            setPage(1);
                        }}
                        style={{ flex: 1, minWidth: 220 }}
                    />
                    <Select
                        placeholder="All statuses"
                        clearable
                        w={160}
                        value={status}
                        onChange={(v) => {
                            setStatus(v);
                            setPage(1);
                        }}
                        data={['ACTIVE', 'ONLINE', 'DISABLED', 'LIMITED', 'EXPIRED']}
                    />
                    <Select
                        w={180}
                        value={sort}
                        allowDeselect={false}
                        onChange={(v) => setSort(v ?? 'created_at')}
                        data={[
                            { value: 'created_at', label: 'Newest first' },
                            { value: 'online_at', label: 'Recently online' },
                            { value: 'traffic_used', label: 'Most traffic' },
                            { value: 'expire_at', label: 'Expire date' },
                            { value: 'username', label: 'Username' },
                        ]}
                    />
                </Group>
                {selected.length > 0 && (
                    <Group gap="xs" mt="sm">
                        <Badge variant="light">{selected.length} selected</Badge>
                        <Button size="compact-sm" variant="light" color="teal" onClick={() => bulk('enable')}>
                            Enable
                        </Button>
                        <Button size="compact-sm" variant="light" color="orange" onClick={() => bulk('disable')}>
                            Disable
                        </Button>
                        <Button size="compact-sm" variant="light" onClick={() => bulk('reset')}>
                            Reset traffic
                        </Button>
                        <Button size="compact-sm" variant="light" onClick={() => bulk('extend')}>
                            +30 days
                        </Button>
                        <Button size="compact-sm" variant="light" color="red" onClick={() => bulk('revoke')}>
                            Revoke
                        </Button>
                        <Button size="compact-sm" variant="light" color="red" onClick={() => bulk('delete')}>
                            Delete
                        </Button>
                    </Group>
                )}
            </Paper>

            <Paper withBorder className="glass">
                <ScrollArea>
                    <Table highlightOnHover verticalSpacing="sm" miw={900}>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th w={40}>
                                    <Checkbox
                                        checked={allSelected}
                                        indeterminate={!allSelected && users.some((u) => selected.includes(u.id))}
                                        onChange={() => setSelected(allSelected ? [] : users.map((u) => u.id))}
                                    />
                                </Table.Th>
                                <Table.Th>User</Table.Th>
                                <Table.Th>Status</Table.Th>
                                <Table.Th>Traffic</Table.Th>
                                <Table.Th>Expires</Table.Th>
                                <Table.Th>Devices</Table.Th>
                                <Table.Th>Online</Table.Th>
                                <Table.Th w={90} />
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {users.map((u) => {
                                const left = daysLeft(u.expireAt);
                                return (
                                    <Table.Tr key={u.id} style={{ cursor: 'pointer' }} onClick={() => setViewId(u.id)}>
                                        <Table.Td onClick={(e) => e.stopPropagation()}>
                                            <Checkbox
                                                checked={selected.includes(u.id)}
                                                onChange={(e) => setSelected((s) => (e.currentTarget.checked ? [...s, u.id] : s.filter((x) => x !== u.id)))}
                                            />
                                        </Table.Td>
                                        <Table.Td>
                                            <Group gap={8} wrap="nowrap">
                                                <OnlineDot onlineAt={u.onlineAt} />
                                                <div>
                                                    <Text size="sm" fw={500}>
                                                        {u.username}
                                                    </Text>
                                                    {u.note && (
                                                        <Text size="xs" c="dimmed" lineClamp={1} maw={220}>
                                                            {u.note}
                                                        </Text>
                                                    )}
                                                </div>
                                            </Group>
                                        </Table.Td>
                                        <Table.Td>
                                            <StatusBadge status={u.status} blocked={!!u.blockedUntil && u.blockedUntil > Date.now()} />
                                        </Table.Td>
                                        <Table.Td>
                                            <TrafficCell user={u} />
                                        </Table.Td>
                                        <Table.Td>
                                            <Text size="sm">{u.expireAt ? date(u.expireAt, false) : '∞'}</Text>
                                            {left !== null && (
                                                <Text size="xs" c={left < 3 ? 'red' : 'dimmed'}>
                                                    {left > 0 ? `${left}d left` : 'expired'}
                                                </Text>
                                            )}
                                        </Table.Td>
                                        <Table.Td>
                                            <Text size="sm">{u.deviceLimit || '∞'}</Text>
                                        </Table.Td>
                                        <Table.Td>
                                            <Text size="xs" c="dimmed">
                                                {fromNow(u.onlineAt)}
                                            </Text>
                                        </Table.Td>
                                        <Table.Td onClick={(e) => e.stopPropagation()}>
                                            <Group gap={4} wrap="nowrap">
                                                <Tooltip label="Copy subscription URL">
                                                    <ActionIcon
                                                        variant="subtle"
                                                        onClick={() => {
                                                            void navigator.clipboard.writeText(u.subscriptionUrl);
                                                            notifyOk('Subscription URL copied');
                                                        }}
                                                    >
                                                        <IconCopy size={16} />
                                                    </ActionIcon>
                                                </Tooltip>
                                                <Menu position="bottom-end" withinPortal>
                                                    <Menu.Target>
                                                        <ActionIcon variant="subtle" color="gray">
                                                            <IconDots size={16} />
                                                        </ActionIcon>
                                                    </Menu.Target>
                                                    <Menu.Dropdown>
                                                        <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => openEdit(u.id)}>
                                                            Edit
                                                        </Menu.Item>
                                                        <Menu.Item leftSection={<IconRefresh size={14} />} onClick={() => bulk('reset', [u.id])}>
                                                            Reset traffic
                                                        </Menu.Item>
                                                        <Menu.Item leftSection={<IconCalendarPlus size={14} />} onClick={() => bulk('extend', [u.id])}>
                                                            Extend 30 days
                                                        </Menu.Item>
                                                        {u.status === 'DISABLED' ? (
                                                            <Menu.Item leftSection={<IconPlayerPlay size={14} />} onClick={() => bulk('enable', [u.id])}>
                                                                Enable
                                                            </Menu.Item>
                                                        ) : (
                                                            <Menu.Item leftSection={<IconPlayerPause size={14} />} onClick={() => bulk('disable', [u.id])}>
                                                                Disable
                                                            </Menu.Item>
                                                        )}
                                                        <Menu.Item leftSection={<IconKey size={14} />} color="red" onClick={() => bulk('revoke', [u.id])}>
                                                            Revoke keys
                                                        </Menu.Item>
                                                        <Menu.Item leftSection={<IconTrash size={14} />} color="red" onClick={() => bulk('delete', [u.id])}>
                                                            Delete
                                                        </Menu.Item>
                                                    </Menu.Dropdown>
                                                </Menu>
                                            </Group>
                                        </Table.Td>
                                    </Table.Tr>
                                );
                            })}
                        </Table.Tbody>
                    </Table>
                    {data && !users.length && (
                        <Text c="dimmed" ta="center" py="xl">
                            No users found
                        </Text>
                    )}
                </ScrollArea>
            </Paper>
            {pages > 1 && (
                <Group justify="center">
                    <Pagination value={page} onChange={setPage} total={pages} />
                </Group>
            )}

            <UserDrawer userId={viewId} onClose={() => setViewId(null)} onEdit={openEdit} />
            <UserFormModal opened={formOpen} onClose={() => setFormOpen(false)} user={editUser} />
        </Stack>
    );
}
