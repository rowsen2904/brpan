import { Alert, Badge, Button, Checkbox, Divider, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Switch, Text, Textarea, TextInput } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';

import { api, notifyOk } from '@/lib/api';
import { GB } from '@/lib/format';
import { PROTOCOL_META, PROTOCOLS, type Protocol, type ResetStrategy, type Squad, type User } from '@/lib/types';

interface Values {
    username: string;
    enabled: boolean;
    trafficLimitGb: number;
    resetStrategy: ResetStrategy;
    expireAt: Date | null;
    deviceLimit: number;
    squadIds: string[];
    note: string;
    telegramId: string;
    email: string;
}

function defaultSquads(squads: Squad[]): string[] {
    const main = squads.find((sq) => sq.name.toLowerCase() === 'main') ?? squads[0];
    return main ? [String(main.id)] : [];
}

function toValues(user: User | null | undefined, squads: Squad[]): Values {
    return {
        username: user?.username ?? '',
        enabled: user ? user.status !== 'DISABLED' : true,
        trafficLimitGb: user ? +(user.trafficLimit / GB).toFixed(2) : 0,
        resetStrategy: user?.resetStrategy ?? 'NO_RESET',
        expireAt: user?.expireAt ? new Date(user.expireAt) : user ? null : dayjs().add(30, 'day').toDate(),
        deviceLimit: user?.deviceLimit ?? 0,
        squadIds: user ? user.squadIds.map(String) : defaultSquads(squads),
        note: user?.note ?? '',
        telegramId: user?.telegramId ?? '',
        email: user?.email ?? '',
    };
}

function payload(v: Values, includeSquads: boolean) {
    return {
        ...(includeSquads ? { squadIds: v.squadIds.map(Number) } : {}),
        username: v.username.trim(),
        status: v.enabled ? 'ACTIVE' : 'DISABLED',
        trafficLimit: Math.round((v.trafficLimitGb || 0) * GB),
        resetStrategy: v.resetStrategy,
        expireAt: v.expireAt ? dayjs(v.expireAt).valueOf() : null,
        deviceLimit: v.deviceLimit || 0,
        note: v.note,
        telegramId: v.telegramId || null,
        email: v.email || null,
    };
}

export function UserFormModal({ opened, onClose, user }: { opened: boolean; onClose: () => void; user?: User | null }) {
    const qc = useQueryClient();
    const [loading, setLoading] = useState(false);
    const [bulk, setBulk] = useState(false);
    const [bulkCount, setBulkCount] = useState<number>(10);
    const { data: squads = [] } = useQuery({ queryKey: ['squads'], queryFn: () => api<Squad[]>('/api/squads') });
    const form = useForm<Values>({
        initialValues: toValues(user, squads),
        validate: {
            username: (v) => (bulk || /^[\w.@+-]{1,64}$/.test(v.trim()) ? null : 'Letters, digits and _.@+- only'),
        },
    });

    useEffect(() => {
        if (opened) {
            form.setValues(toValues(user, squads));
            form.resetDirty();
            setBulk(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [opened, user?.id, squads.length]);

    const customProtocols = !!user && user.squadIds.length === 0;
    const includeSquads = !user || !customProtocols || form.isDirty('squadIds');
    const preview = useMemo(() => {
        const set = new Set<Protocol>();
        for (const sq of squads) if (form.values.squadIds.includes(String(sq.id))) sq.protocols.forEach((p) => set.add(p));
        return PROTOCOLS.filter((p) => set.has(p));
    }, [squads, form.values.squadIds]);

    const extend = (days: number) => {
        const base = form.values.expireAt && form.values.expireAt > new Date() ? dayjs(form.values.expireAt) : dayjs();
        form.setFieldValue('expireAt', base.add(days, 'day').toDate());
    };

    const submit = form.onSubmit(async (values) => {
        setLoading(true);
        try {
            if (user) {
                await api(`/api/users/${user.id}`, { method: 'PATCH', body: payload(values, includeSquads) });
                notifyOk('User updated');
            } else if (bulk) {
                const { username, ...template } = payload(values, true);
                await api('/api/users/bulk-create', { body: { prefix: username || 'user', count: bulkCount, template } });
                notifyOk(`${bulkCount} users created`);
            } else {
                await api('/api/users', { body: payload(values, true) });
                notifyOk('User created');
            }
            await qc.invalidateQueries({ queryKey: ['users'] });
            await qc.invalidateQueries({ queryKey: ['user'] });
            onClose();
        } finally {
            setLoading(false);
        }
    });

    return (
        <Modal opened={opened} onClose={onClose} title={user ? `Edit ${user.username}` : 'Create user'} size="lg" centered>
            <form onSubmit={submit}>
                <Stack>
                    {!user && <Switch label="Bulk create (random suffix, same template)" checked={bulk} onChange={(e) => setBulk(e.currentTarget.checked)} />}
                    <SimpleGrid cols={{ base: 1, sm: bulk ? 2 : 1 }}>
                        <TextInput label={bulk ? 'Username prefix' : 'Username'} placeholder={bulk ? 'client_' : 'john'} required={!bulk} {...form.getInputProps('username')} />
                        {bulk && <NumberInput label="Count" min={1} max={500} value={bulkCount} onChange={(v) => setBulkCount(Number(v) || 1)} />}
                    </SimpleGrid>

                    <Divider label="Limits" labelPosition="left" />
                    <SimpleGrid cols={{ base: 1, sm: 3 }}>
                        <NumberInput label="Traffic limit, GB" description="0 = unlimited" min={0} decimalScale={2} {...form.getInputProps('trafficLimitGb')} />
                        <Select
                            label="Traffic reset"
                            description="Periodic usage reset"
                            data={[
                                { value: 'NO_RESET', label: 'Never' },
                                { value: 'DAY', label: 'Daily' },
                                { value: 'WEEK', label: 'Weekly' },
                                { value: 'MONTH', label: 'Monthly' },
                            ]}
                            allowDeselect={false}
                            {...form.getInputProps('resetStrategy')}
                        />
                        <NumberInput label="Device limit" description="0 = unlimited" min={0} max={1000} {...form.getInputProps('deviceLimit')} />
                    </SimpleGrid>
                    <div>
                        <DateTimePicker
                            label="Expires at"
                            description="Empty = never"
                            clearable
                            valueFormat="DD.MM.YYYY HH:mm"
                            value={form.values.expireAt}
                            onChange={(v) => form.setFieldValue('expireAt', v ? dayjs(v).toDate() : null)}
                        />
                        <Group gap={6} mt={6}>
                            {[7, 30, 90, 180, 365].map((d) => (
                                <Button key={d} size="compact-xs" variant="light" onClick={() => extend(d)}>
                                    +{d}d
                                </Button>
                            ))}
                            <Button size="compact-xs" variant="subtle" color="gray" onClick={() => form.setFieldValue('expireAt', null)}>
                                Never
                            </Button>
                        </Group>
                    </div>

                    <Divider label="Squads" labelPosition="left" />
                    <Checkbox.Group value={form.values.squadIds} onChange={(v) => form.setFieldValue('squadIds', v)}>
                        <Stack gap={6}>
                            {squads.map((sq) => (
                                <Paper key={sq.id} withBorder p="xs" radius="md">
                                    <Checkbox
                                        value={String(sq.id)}
                                        label={
                                            <Group gap={6}>
                                                <Text size="sm" fw={600}>
                                                    {sq.name}
                                                </Text>
                                                <Text size="xs" c="dimmed">
                                                    {sq.protocols.length} protocols · {sq.members} users
                                                </Text>
                                            </Group>
                                        }
                                    />
                                </Paper>
                            ))}
                        </Stack>
                    </Checkbox.Group>
                    {customProtocols && !form.isDirty('squadIds') && (
                        <Text size="xs" c="dimmed">
                            This user has a custom protocol set. Pick squads to replace it, or leave as is.
                        </Text>
                    )}
                    {includeSquads && preview.length === 0 && (
                        <Alert color="orange" variant="light">
                            No squad selected — the user will get no servers in the subscription.
                        </Alert>
                    )}
                    {includeSquads && preview.length > 0 && (
                        <Group gap={4}>
                            {preview.map((p) => (
                                <Badge key={p} size="xs" variant="dot" color={PROTOCOL_META[p].color}>
                                    {PROTOCOL_META[p].label}
                                </Badge>
                            ))}
                        </Group>
                    )}

                    <Divider label="Details" labelPosition="left" />
                    <SimpleGrid cols={{ base: 1, sm: 2 }}>
                        <TextInput label="Telegram ID" {...form.getInputProps('telegramId')} />
                        <TextInput label="Email" {...form.getInputProps('email')} />
                    </SimpleGrid>
                    <Textarea label="Note" autosize minRows={2} {...form.getInputProps('note')} />
                    <Switch label="Enabled" {...form.getInputProps('enabled', { type: 'checkbox' })} />
                    <Text size="xs" c="dimmed">
                        Device limit is enforced by HWID for Happ / v2RayTun / INCY subscriptions, by concurrent sessions for OpenVPN and, if enabled in settings, by
                        unique IPs for all other protocols.
                    </Text>
                    <Group justify="flex-end">
                        <Button variant="default" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" loading={loading}>
                            {user ? 'Save' : 'Create'}
                        </Button>
                    </Group>
                </Stack>
            </form>
        </Modal>
    );
}
