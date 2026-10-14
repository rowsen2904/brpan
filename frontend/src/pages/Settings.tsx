import { ActionIcon, Alert, Button, Group, NumberInput, Paper, PasswordInput, SegmentedControl, Select, SimpleGrid, Stack, Switch, Table, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import { IconAlertTriangle, IconKey, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { Copy } from '@/components/common';
import { api, notifyOk } from '@/lib/api';
import { date } from '@/lib/format';
import { COUNTRIES } from '@/lib/countries';
import type { Settings } from '@/lib/types';

type General = Pick<Settings, 'domain' | 'serverAddress' | 'remarkPrefix' | 'country' | 'subscription' | 'limits' | 'logging'>;

function GeneralForm({ settings }: { settings: Settings }) {
    const qc = useQueryClient();
    const [saving, setSaving] = useState(false);
    const pick = (s: Settings): General => ({ domain: s.domain, serverAddress: s.serverAddress, remarkPrefix: s.remarkPrefix, country: s.country, subscription: s.subscription, limits: s.limits, logging: s.logging });
    const form = useForm<General>({ initialValues: pick(settings) });
    useEffect(() => {
        form.setValues(pick(settings));
        form.resetDirty();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [settings]);

    const save = form.onSubmit(async (values) => {
        setSaving(true);
        try {
            await api('/api/settings', { method: 'PATCH', body: values });
            notifyOk('Settings saved');
            await qc.invalidateQueries({ queryKey: ['settings'] });
        } finally {
            setSaving(false);
        }
    });

    return (
        <form onSubmit={save}>
            <Stack>
                <Paper withBorder p="md" className="glass">
                    <Text fw={600} mb="sm">
                        Server
                    </Text>
                    <SimpleGrid cols={{ base: 1, md: 2 }}>
                        <TextInput label="Domain" description="Panel, subscriptions, TLS for XHTTP/Trojan/Hysteria2" placeholder="vpn.example.com" {...form.getInputProps('domain')} />
                        <TextInput label="Server address in keys" description="Domain or IP clients connect to" {...form.getInputProps('serverAddress')} />
                        <TextInput label="Remark prefix" description="Shown before protocol name in clients" {...form.getInputProps('remarkPrefix')} />
                        <Select label="Country flag" description="Flag shown before server names in clients" searchable data={COUNTRIES} {...form.getInputProps('country')} />
                    </SimpleGrid>
                    <Text size="xs" c="dimmed" mt="sm">
                        Public base URL: {settings.publicBaseUrl}
                    </Text>
                </Paper>

                <Paper withBorder p="md" className="glass">
                    <Text fw={600} mb="sm">
                        Subscription
                    </Text>
                    <Stack>
                        <SimpleGrid cols={{ base: 1, md: 3 }}>
                            <TextInput label="Profile title" {...form.getInputProps('subscription.profileTitle')} />
                            <NumberInput label="Update interval, hours" min={1} max={168} {...form.getInputProps('subscription.updateIntervalHours')} />
                            <TextInput label="Support URL" placeholder="https://t.me/support" {...form.getInputProps('subscription.supportUrl')} />
                        </SimpleGrid>
                        <Textarea label="Announcement" description="Shown in Happ and on the subscription page" maxLength={200} autosize {...form.getInputProps('subscription.announce')} />
                        <div>
                            <Text size="sm" fw={500}>
                                Happ encrypted links
                            </Text>
                            <Text size="xs" c="dimmed" mb={6}>
                                happ://crypt link hides the subscription URL from the user. crypt4 is the newest format.
                            </Text>
                            <SegmentedControl
                                data={[
                                    { value: 'none', label: 'Off' },
                                    { value: 'v2', label: 'crypt2' },
                                    { value: 'v3', label: 'crypt3' },
                                    { value: 'v4', label: 'crypt4' },
                                ]}
                                {...form.getInputProps('subscription.happCrypto')}
                            />
                        </div>
                        <Switch
                            label="Require HWID for users with a device limit"
                            description="Clients that do not send x-hwid (old apps, browsers) get a warning instead of keys"
                            {...form.getInputProps('subscription.hwidRequired', { type: 'checkbox' })}
                        />
                        <Switch
                            label="Show status notice for disabled/expired users"
                            description="Return a fake key named “Subscription expired” instead of an empty list"
                            {...form.getInputProps('subscription.showDisabledNotice', { type: 'checkbox' })}
                        />
                    </Stack>
                </Paper>

                <Paper withBorder p="md" className="glass">
                    <Text fw={600} mb="sm">
                        IP based device limit
                    </Text>
                    <Stack>
                        <Switch
                            label="Block users that connect from more unique IPs than their device limit"
                            description="Works for every protocol including Outline/WireGuard keys used without subscription"
                            {...form.getInputProps('limits.enforceIpLimit', { type: 'checkbox' })}
                        />
                        <SimpleGrid cols={{ base: 1, sm: 2 }}>
                            <NumberInput label="Window, seconds" min={10} max={3600} {...form.getInputProps('limits.ipWindowSec')} />
                            <NumberInput label="Block duration, minutes" min={1} max={1440} {...form.getInputProps('limits.blockMinutes')} />
                        </SimpleGrid>
                    </Stack>
                </Paper>

                <Paper withBorder p="md" className="glass">
                    <Text fw={600} mb="sm">
                        Connection logging
                    </Text>
                    <Stack>
                        <Switch
                            label="Log visited domains per user"
                            description="Records the destination domain (SNI) of each Xray connection in the database so you can see what a user accesses"
                            {...form.getInputProps('logging.connectionLog', { type: 'checkbox' })}
                        />
                        {form.values.logging.connectionLog && (
                            <Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>
                                This is privacy-invasive and stores browsing metadata of your users. Only the domain is visible — not the page content, URL or
                                messages. WireGuard, AmneziaWG and OpenVPN are not logged (they do not pass through Xray). Make sure this is lawful and disclosed to
                                your users where required.
                            </Alert>
                        )}
                        <NumberInput
                            label="Keep records for, days"
                            description="Older entries are deleted automatically"
                            min={1}
                            max={365}
                            disabled={!form.values.logging.connectionLog}
                            {...form.getInputProps('logging.retentionDays')}
                        />
                        <Group>
                            <Button
                                variant="light"
                                color="red"
                                size="xs"
                                onClick={() =>
                                    modals.openConfirmModal({
                                        title: 'Clear all connection logs',
                                        children: <Text size="sm">Delete every stored domain record for all users? This cannot be undone.</Text>,
                                        labels: { confirm: 'Delete all', cancel: 'Cancel' },
                                        confirmProps: { color: 'red' },
                                        onConfirm: async () => {
                                            await api('/api/system/connections', { method: 'DELETE' });
                                            notifyOk('Connection logs cleared');
                                        },
                                    })
                                }
                            >
                                Clear all logs now
                            </Button>
                        </Group>
                    </Stack>
                </Paper>

                <Group justify="flex-end">
                    <Button type="submit" loading={saving} disabled={!form.isDirty()}>
                        Save settings
                    </Button>
                </Group>
            </Stack>
        </form>
    );
}

function AdminForm() {
    const form = useForm({ initialValues: { username: '', current: '', next: '' } });
    const submit = form.onSubmit(async (v) => {
        await api('/api/auth/password', { body: { current: v.current, next: v.next, username: v.username || undefined } });
        notifyOk('Credentials updated');
        form.reset();
    });
    return (
        <Paper withBorder p="md" className="glass">
            <Text fw={600} mb="sm">
                Administrator
            </Text>
            <form onSubmit={submit}>
                <SimpleGrid cols={{ base: 1, md: 4 }}>
                    <TextInput label="New username" placeholder="unchanged" {...form.getInputProps('username')} />
                    <PasswordInput label="Current password" required {...form.getInputProps('current')} />
                    <PasswordInput label="New password" description="Min 8 characters" required {...form.getInputProps('next')} />
                    <Button type="submit" mt={{ md: 24 }}>
                        Update
                    </Button>
                </SimpleGrid>
            </form>
        </Paper>
    );
}

function Tokens() {
    const qc = useQueryClient();
    const [name, setName] = useState('');
    const [created, setCreated] = useState<string | null>(null);
    const { data } = useQuery({ queryKey: ['tokens'], queryFn: () => api<{ id: number; name: string; created_at: number }[]>('/api/tokens') });
    const create = async () => {
        if (!name) return;
        const res = await api<{ token: string }>('/api/tokens', { body: { name } });
        setCreated(res.token);
        setName('');
        await qc.invalidateQueries({ queryKey: ['tokens'] });
    };
    const remove = (id: number) =>
        modals.openConfirmModal({
            title: 'Delete token',
            children: <Text size="sm">Integrations using this token will stop working.</Text>,
            labels: { confirm: 'Delete', cancel: 'Cancel' },
            confirmProps: { color: 'red' },
            onConfirm: async () => {
                await api(`/api/tokens/${id}`, { method: 'DELETE' });
                await qc.invalidateQueries({ queryKey: ['tokens'] });
            },
        });
    return (
        <Paper withBorder p="md" className="glass">
            <Text fw={600}>API tokens</Text>
            <Text size="xs" c="dimmed" mb="sm">
                For bots and billing: send as <code>Authorization: Bearer &lt;token&gt;</code> to any /api endpoint. See docs/API.md.
            </Text>
            <Group align="flex-end">
                <TextInput label="Name" placeholder="telegram-bot" value={name} onChange={(e) => setName(e.currentTarget.value)} style={{ flex: 1 }} />
                <Button leftSection={<IconKey size={16} />} onClick={create}>
                    Create token
                </Button>
            </Group>
            {created && (
                <Alert color="teal" mt="sm" title="Copy the token now, it is shown only once">
                    <Group gap="xs" wrap="nowrap">
                        <Text className="mono" size="sm">
                            {created}
                        </Text>
                        <Copy value={created} />
                    </Group>
                </Alert>
            )}
            <Table mt="sm">
                <Table.Tbody>
                    {data?.map((t) => (
                        <Table.Tr key={t.id}>
                            <Table.Td>{t.name}</Table.Td>
                            <Table.Td>
                                <Text size="xs" c="dimmed">
                                    {date(t.created_at)}
                                </Text>
                            </Table.Td>
                            <Table.Td w={40}>
                                <ActionIcon variant="subtle" color="red" onClick={() => remove(t.id)}>
                                    <IconTrash size={14} />
                                </ActionIcon>
                            </Table.Td>
                        </Table.Tr>
                    ))}
                </Table.Tbody>
            </Table>
        </Paper>
    );
}

export function SettingsPage() {
    const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/api/settings') });
    return (
        <Stack>
            <Title order={3}>Settings</Title>
            {data && <GeneralForm settings={data} />}
            <AdminForm />
            <Tokens />
        </Stack>
    );
}
